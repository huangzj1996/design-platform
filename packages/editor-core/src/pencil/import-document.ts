import {
  createDiagnostic,
  DESIGN_DOCUMENT_VERSION,
  DiagnosticCodes,
  isPlainObject,
  validateDesignDocument,
  type DesignDocument,
  type DesignElement,
  type Diagnostic,
} from '@design-ai/design-schema';
import {
  collectIdUsage,
  convertNode,
  createConversionContext,
  type ConversionContext,
} from './convert';
import {
  PencilDiagnosticCodes,
  type PencilDiagnosticCode,
} from './diagnostics';
import { stripJsonComments } from './json-comments';
import { convertVariables } from './variables';

const PENCIL_VERSION = '2.25';
const ROOT_PATH = '$';
const ROOT_FIELDS = new Set(['version', 'children', 'variables']);
/** Safety cap; each pass removes at least one element, so this is ample. */
const MAX_PRUNE_PASSES = 100;

export interface PencilImportSuccess {
  ok: true;
  document: DesignDocument;
  warnings: Diagnostic[];
}

export interface PencilImportFailure {
  ok: false;
  errors: Diagnostic[];
}

export type PencilImportResult = PencilImportSuccess | PencilImportFailure;

function failure(
  code: PencilDiagnosticCode,
  path: string,
  message: string,
): PencilImportFailure {
  return {
    ok: false,
    errors: [createDiagnostic(code, path, message)],
  };
}

/**
 * Converts Pencil 2.25 text into a native version 1 design document. The
 * conversion is intentionally lossy: unsupported nodes and properties are
 * reported as warnings, and a successful result always passes native
 * validation. Parse, version and structure failures return errors instead.
 */
export function importPencilDocument(text: string): PencilImportResult {
  let input: unknown;
  try {
    input = JSON.parse(stripJsonComments(text));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(
      PencilDiagnosticCodes.invalidJson,
      ROOT_PATH,
      `Pencil 文件解析失败：${message}`,
    );
  }

  if (!isPlainObject(input)) {
    return failure(
      PencilDiagnosticCodes.invalidStructure,
      ROOT_PATH,
      'Pencil 文档根节点必须是对象',
    );
  }

  const version = input.version;
  if (version === undefined) {
    return failure(
      PencilDiagnosticCodes.missingVersion,
      '$.version',
      'Pencil 文档缺少版本号',
    );
  }
  if (typeof version !== 'string') {
    return failure(
      PencilDiagnosticCodes.invalidVersion,
      '$.version',
      `Pencil 文档版本号必须是字符串 "${PENCIL_VERSION}"`,
    );
  }
  if (version !== PENCIL_VERSION) {
    return failure(
      PencilDiagnosticCodes.unsupportedVersion,
      '$.version',
      `不支持的 Pencil 版本 "${version}"，当前只支持 ${PENCIL_VERSION}`,
    );
  }

  const sourceChildren = input.children;
  if (!Array.isArray(sourceChildren)) {
    return failure(
      PencilDiagnosticCodes.invalidStructure,
      '$.children',
      'Pencil 文档 children 必须是有序数组',
    );
  }

  const ctx = createConversionContext();
  const convertedVariables = convertVariables(input.variables, ctx.warnings);
  ctx.variables = convertedVariables.variables;
  ctx.variablesBySourceName = convertedVariables.bySourceName;

  for (const child of sourceChildren) {
    collectIdUsage(child, ctx);
  }

  for (const key of Object.keys(input)) {
    if (!ROOT_FIELDS.has(key)) {
      ctx.warnings.push(
        createDiagnostic(
          PencilDiagnosticCodes.unsupportedProperty,
          `$.${key}`,
          `Pencil 文档属性 "${key}" 暂不支持，已跳过`,
        ),
      );
    }
  }

  const children = sourceChildren
    .map((child, index) => convertNode(child, `$.children[${index}]`, ctx))
    .filter((child) => child !== null);
  const sourceHasNodes = sourceChildren.length > 0;

  if (sourceHasNodes && children.length === 0) {
    return allNodesSkipped(ctx);
  }

  const document: DesignDocument = {
    version: DESIGN_DOCUMENT_VERSION,
    children,
    variables: ctx.variables,
  };
  pruneElementsWithoutSizeBasis(document, ctx);

  if (sourceHasNodes && document.children.length === 0) {
    return allNodesSkipped(ctx);
  }

  const validated = validateDesignDocument(document);
  if (!validated.ok) {
    return {
      ok: false,
      errors: [...ctx.warnings, ...validated.errors],
    };
  }

  return { ok: true, document: validated.document, warnings: ctx.warnings };
}

function allNodesSkipped(ctx: ConversionContext): PencilImportFailure {
  return {
    ok: false,
    errors: [
      ...ctx.warnings,
      createDiagnostic(
        PencilDiagnosticCodes.emptyImport,
        ROOT_PATH,
        'Pencil 文档包含节点，但没有任何节点可以转换',
      ),
    ],
  };
}

/**
 * Native layout rules reject elements whose dimensions have no size basis.
 * Pencil allows such combinations, so the importer drops the offending
 * elements (and reports why) until the document validates. Leaf-most
 * elements are removed first so parents can recover by fitting their content.
 */
function pruneElementsWithoutSizeBasis(
  document: DesignDocument,
  ctx: ConversionContext,
): void {
  for (let pass = 0; pass < MAX_PRUNE_PASSES; pass += 1) {
    const result = validateDesignDocument(document);
    if (result.ok) {
      return;
    }

    const missingSizes = result.errors.filter(
      (error) => error.code === DiagnosticCodes.missingSizeBasis,
    );
    if (missingSizes.length === 0) {
      return;
    }

    const elementPaths = [
      ...new Set(
        missingSizes.map((error) =>
          error.path.replace(/\.(width|height)$/, ''),
        ),
      ),
    ];
    const leafPaths = elementPaths.filter(
      (path) =>
        !elementPaths.some(
          (candidate) =>
            candidate !== path && candidate.startsWith(`${path}.children[`),
        ),
    );

    let removed = false;
    for (const path of leafPaths.sort(comparePathsDescending)) {
      const element = elementAtPath(document, path);
      const sourcePath =
        element === undefined ? path : (ctx.sourcePaths.get(element) ?? path);
      if (removeElementAtPath(document, path)) {
        const reason = missingSizes.find((error) =>
          error.path.startsWith(`${path}.`),
        );
        ctx.warnings.push(
          createDiagnostic(
            PencilDiagnosticCodes.skippedNode,
            sourcePath,
            `节点无法形成合法元素，已跳过：${reason?.message ?? '缺少尺寸依据'}`,
          ),
        );
        removed = true;
      }
    }

    if (!removed) {
      return;
    }
  }
}

function elementIndexes(path: string): number[] {
  return [...path.matchAll(/\.children\[(\d+)\]/g)].map((match) =>
    Number(match[1]),
  );
}

function comparePathsDescending(left: string, right: string): number {
  const leftIndexes = elementIndexes(left);
  const rightIndexes = elementIndexes(right);
  const length = Math.max(leftIndexes.length, rightIndexes.length);
  for (let index = 0; index < length; index += 1) {
    const leftIndex = leftIndexes[index] ?? -1;
    const rightIndex = rightIndexes[index] ?? -1;
    if (leftIndex !== rightIndex) {
      return rightIndex - leftIndex;
    }
  }
  return 0;
}

interface ElementLocation {
  siblings: DesignElement[];
  index: number;
}

/**
 * Resolves a validation path such as `$.children[0].children[2]` to the array
 * that holds the element and its index inside that array.
 */
function locateElement(
  document: DesignDocument,
  path: string,
): ElementLocation | undefined {
  const indexes = elementIndexes(path);
  if (indexes.length === 0) {
    return undefined;
  }

  let siblings = document.children;
  for (const index of indexes.slice(0, -1)) {
    const node = siblings[index];
    if (
      node === undefined ||
      node.type !== 'frame' ||
      node.children === undefined
    ) {
      return undefined;
    }
    siblings = node.children;
  }

  const index = indexes.at(-1);
  if (index === undefined || index < 0 || index >= siblings.length) {
    return undefined;
  }
  return { siblings, index };
}

function elementAtPath(
  document: DesignDocument,
  path: string,
): DesignElement | undefined {
  const location = locateElement(document, path);
  return location?.siblings[location.index];
}

function removeElementAtPath(document: DesignDocument, path: string): boolean {
  const location = locateElement(document, path);
  if (location === undefined) {
    return false;
  }
  location.siblings.splice(location.index, 1);
  return true;
}
