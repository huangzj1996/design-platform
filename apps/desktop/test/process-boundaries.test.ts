import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = fileURLToPath(new URL('../src', import.meta.url));
const PROCESS_DIRECTORIES = [
  'electron-main',
  'electron-preload',
  'electron-render',
] as const;

type ProcessDirectory = (typeof PROCESS_DIRECTORIES)[number];

interface SourceImport {
  specifier: string;
  typeOnly: boolean;
}

async function listSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listSourceFiles(entryPath) : [entryPath];
    }),
  );
  return nested.flat().filter((file) => /\.tsx?$/.test(file));
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (clause === undefined) {
    return false;
  }
  if (clause.isTypeOnly) {
    return true;
  }
  const bindings = clause.namedBindings;
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function importsOf(filePath: string, source: string): SourceImport[] {
  const scriptKind = filePath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const imports: SourceImport[] = [];

  sourceFile.forEachChild((node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: isTypeOnlyImport(node),
      });
    }
  });

  return imports;
}

function processDirectoryOf(filePath: string): ProcessDirectory | null {
  const [top] = path.relative(SOURCE_ROOT, filePath).split(path.sep);
  return PROCESS_DIRECTORIES.find((directory) => directory === top) ?? null;
}

function importedProcess(
  filePath: string,
  specifier: string,
): ProcessDirectory | null {
  if (!specifier.startsWith('.')) {
    return null;
  }
  return processDirectoryOf(path.resolve(path.dirname(filePath), specifier));
}

async function boundaryViolations(
  isViolation: (
    source: ProcessDirectory,
    target: ProcessDirectory,
    typeOnly: boolean,
  ) => boolean,
): Promise<string[]> {
  const violations: string[] = [];

  for (const source of PROCESS_DIRECTORIES) {
    const files = await listSourceFiles(path.join(SOURCE_ROOT, source));
    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      for (const imported of importsOf(file, contents)) {
        const target = importedProcess(file, imported.specifier);
        if (target !== null && isViolation(source, target, imported.typeOnly)) {
          const kind = imported.typeOnly ? 'type import' : 'import';
          violations.push(
            `${path.relative(SOURCE_ROOT, file)}: ${kind} '${imported.specifier}'`,
          );
        }
      }
    }
  }

  return violations;
}

describe('Electron process layout', () => {
  it('groups every desktop source file into the three lowercase process directories', async () => {
    const entries = await readdir(SOURCE_ROOT, { withFileTypes: true });

    expect(entries.filter((entry) => !entry.isDirectory())).toEqual([]);
    expect(entries.map((entry) => entry.name).sort()).toEqual(
      [...PROCESS_DIRECTORIES].sort(),
    );
  });

  it('points Forge and the renderer page at the moved entry files', async () => {
    const forgeConfig = await readFile(
      fileURLToPath(new URL('../forge.config.mts', import.meta.url)),
      'utf8',
    );
    const indexHtml = await readFile(
      fileURLToPath(new URL('../index.html', import.meta.url)),
      'utf8',
    );

    expect(forgeConfig).toContain("entry: 'src/electron-main/main.ts'");
    expect(forgeConfig).toContain("entry: 'src/electron-preload/preload.ts'");
    expect(indexHtml).toContain('/src/electron-render/renderer.tsx');
  });
});

describe('IPC boundary', () => {
  it('keeps renderer code independent from the main process', async () => {
    const violations = await boundaryViolations(
      (source, target) =>
        source === 'electron-render' && target === 'electron-main',
    );

    expect(violations).toEqual([]);
  });

  it('lets the renderer import the preload contract only as types', async () => {
    const violations = await boundaryViolations(
      (source, target, typeOnly) =>
        source === 'electron-render' &&
        target === 'electron-preload' &&
        !typeOnly,
    );

    expect(violations).toEqual([]);
  });

  it('keeps main-process code independent from the renderer', async () => {
    const violations = await boundaryViolations(
      (source, target) =>
        source === 'electron-main' && target === 'electron-render',
    );

    expect(violations).toEqual([]);
  });

  it('keeps the preload script between the two processes', async () => {
    const violations = await boundaryViolations(
      (source, target) =>
        source === 'electron-preload' &&
        (target === 'electron-main' || target === 'electron-render'),
    );

    expect(violations).toEqual([]);
  });

  it('keeps the renderer off native Electron modules', async () => {
    const files = await listSourceFiles(
      path.join(SOURCE_ROOT, 'electron-render'),
    );
    const violations: string[] = [];

    for (const file of files) {
      const contents = await readFile(file, 'utf8');
      for (const imported of importsOf(file, contents)) {
        if (
          imported.specifier === 'electron' ||
          imported.specifier.startsWith('electron/')
        ) {
          violations.push(
            `${path.relative(SOURCE_ROOT, file)}: import '${imported.specifier}'`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
