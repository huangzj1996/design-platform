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

interface ModuleReference {
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
  // A default binding is a runtime value even when every named binding is
  // marked `type`.
  const bindings = clause.namedBindings;
  return (
    clause.name === undefined &&
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

function isTypeOnlyExport(node: ts.ExportDeclaration): boolean {
  if (node.isTypeOnly) {
    return true;
  }
  const clause = node.exportClause;
  return (
    clause !== undefined &&
    ts.isNamedExports(clause) &&
    clause.elements.length > 0 &&
    clause.elements.every((element) => element.isTypeOnly)
  );
}

function moduleReferencesOf(
  filePath: string,
  source: string,
): ModuleReference[] {
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
  const references: ModuleReference[] = [];

  sourceFile.forEachChild((node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      references.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: isTypeOnlyImport(node),
      });
      return;
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      references.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: isTypeOnlyExport(node),
      });
    }
  });

  return references;
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
      for (const reference of moduleReferencesOf(file, contents)) {
        const target = importedProcess(file, reference.specifier);
        if (
          target !== null &&
          isViolation(source, target, reference.typeOnly)
        ) {
          const kind = reference.typeOnly ? 'type-only' : 'runtime';
          violations.push(
            `${path.relative(SOURCE_ROOT, file)}: ${kind} reference '${reference.specifier}'`,
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
      for (const reference of moduleReferencesOf(file, contents)) {
        if (
          reference.specifier === 'electron' ||
          reference.specifier.startsWith('electron/')
        ) {
          violations.push(
            `${path.relative(SOURCE_ROOT, file)}: reference '${reference.specifier}'`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
