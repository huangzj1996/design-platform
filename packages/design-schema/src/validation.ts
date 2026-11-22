import {
  createDiagnostic,
  DiagnosticCodes,
  type Diagnostic,
} from './diagnostics';
import { isHexColor, isPlainObject } from './fields';
import { getNodeInspector } from './node-inspectors';
import { isSystemAbsolutePath } from './path';
import {
  DESIGN_DOCUMENT_VERSION,
  type DesignDocument,
  type DesignElement,
  type DesignVariable,
  type ValidationResult,
  type VariableType,
} from './types';

const ROOT_PATH = '$';
const ROOT_FIELDS = new Set(['version', 'children', 'filePath', 'variables']);
const VARIABLE_FIELDS = new Set(['name', 'type', 'value']);
const VARIABLE_TYPES: readonly VariableType[] = [
  'color',
  'string',
  'number',
  'boolean',
];

interface ValidationState {
  errors: Diagnostic[];
  ids: Map<string, string>;
}

function fail(path: string, message: string): Diagnostic {
  return createDiagnostic(DiagnosticCodes.invalidStructure, path, message);
}

function childPath(parentPath: string, index: number): string {
  return `${parentPath}.children[${index}]`;
}

function fieldPath(parentPath: string, field: string): string {
  return `${parentPath}.${field}`;
}

/**
 * Parses JSON text and validates the resulting native design document.
 */
export function parseDesignDocument(text: string): ValidationResult {
  let input: unknown;
  try {
    input = JSON.parse(text) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errors: [
        createDiagnostic(
          DiagnosticCodes.invalidJson,
          ROOT_PATH,
          `JSON 解析失败：${message}`,
        ),
      ],
    };
  }

  return validateDesignDocument(input);
}

/**
 * Validates an already parsed value against the native version 1 document
 * contract. Validation dispatches every element to the inspector registered
 * for its `type`.
 */
export function validateDesignDocument(input: unknown): ValidationResult {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [fail(ROOT_PATH, '设计稿根节点必须是对象')],
    };
  }

  const state: ValidationState = { errors: [], ids: new Map() };
  validateVersion(input, state);
  validateRootFields(input, state);
  const filePath = validateFilePath(input, state);
  const variables = validateVariables(input, state);
  const children = validateChildren(input, state);

  if (state.errors.length > 0) {
    return { ok: false, errors: state.errors };
  }

  const document: DesignDocument = {
    version: DESIGN_DOCUMENT_VERSION,
    children,
    variables,
    ...(filePath === undefined ? {} : { filePath }),
  };

  return { ok: true, document };
}

function validateVersion(
  input: Record<string, unknown>,
  state: ValidationState,
): void {
  const version = input.version;
  if (version === undefined) {
    state.errors.push(
      createDiagnostic(
        DiagnosticCodes.missingVersion,
        fieldPath(ROOT_PATH, 'version'),
        '设计稿缺少版本号',
      ),
    );
    return;
  }

  if (typeof version !== 'number' || !Number.isFinite(version)) {
    state.errors.push(
      createDiagnostic(
        DiagnosticCodes.invalidVersion,
        fieldPath(ROOT_PATH, 'version'),
        '设计稿版本号必须是数值',
      ),
    );
    return;
  }

  if (version !== DESIGN_DOCUMENT_VERSION) {
    state.errors.push(
      createDiagnostic(
        DiagnosticCodes.unsupportedVersion,
        fieldPath(ROOT_PATH, 'version'),
        `不支持的设计稿版本 ${version}，当前只支持版本 ${DESIGN_DOCUMENT_VERSION}`,
      ),
    );
  }
}

function validateRootFields(
  input: Record<string, unknown>,
  state: ValidationState,
): void {
  for (const key of Object.keys(input)) {
    if (!ROOT_FIELDS.has(key)) {
      state.errors.push(
        createDiagnostic(
          DiagnosticCodes.unknownField,
          fieldPath(ROOT_PATH, key),
          `设计稿不支持的字段 "${key}"`,
        ),
      );
    }
  }
}

function validateFilePath(
  input: Record<string, unknown>,
  state: ValidationState,
): string | undefined {
  if (input.filePath === undefined) {
    return undefined;
  }

  if (
    typeof input.filePath !== 'string' ||
    !isSystemAbsolutePath(input.filePath)
  ) {
    state.errors.push(
      createDiagnostic(
        DiagnosticCodes.invalidFilePath,
        fieldPath(ROOT_PATH, 'filePath'),
        'filePath 必须是操作系统绝对路径',
      ),
    );
    return undefined;
  }

  return input.filePath;
}

function validateVariables(
  input: Record<string, unknown>,
  state: ValidationState,
): DesignVariable[] {
  if (input.variables === undefined) {
    return [];
  }

  const path = fieldPath(ROOT_PATH, 'variables');
  if (!Array.isArray(input.variables)) {
    state.errors.push(fail(path, 'variables 必须是数组'));
    return [];
  }

  const variables: DesignVariable[] = [];
  input.variables.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isPlainObject(entry)) {
      state.errors.push(fail(entryPath, '变量必须是对象'));
      return;
    }

    for (const key of Object.keys(entry)) {
      if (!VARIABLE_FIELDS.has(key)) {
        state.errors.push(
          createDiagnostic(
            DiagnosticCodes.unknownField,
            fieldPath(entryPath, key),
            `变量不支持的字段 "${key}"`,
          ),
        );
      }
    }

    const { name, type, value } = entry;
    let valid = true;

    if (typeof name !== 'string' || name.length === 0) {
      state.errors.push(
        createDiagnostic(
          DiagnosticCodes.invalidValue,
          fieldPath(entryPath, 'name'),
          '变量名必须是非空字符串',
        ),
      );
      valid = false;
    }

    if (
      typeof type !== 'string' ||
      !(VARIABLE_TYPES as readonly string[]).includes(type)
    ) {
      state.errors.push(
        createDiagnostic(
          DiagnosticCodes.invalidValue,
          fieldPath(entryPath, 'type'),
          `变量类型必须是 ${VARIABLE_TYPES.join('、')} 之一`,
        ),
      );
      valid = false;
    } else if (!isValidVariableValue(type as VariableType, value)) {
      state.errors.push(
        createDiagnostic(
          DiagnosticCodes.invalidValue,
          fieldPath(entryPath, 'value'),
          `变量值必须匹配 ${type} 类型`,
        ),
      );
      valid = false;
    }

    if (valid) {
      variables.push({
        name: name as string,
        type: type as VariableType,
        value: value as string | number | boolean,
      });
    }
  });

  return variables;
}

function isValidVariableValue(type: VariableType, value: unknown): boolean {
  switch (type) {
    case 'color':
      return isHexColor(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
  }
}

function validateChildren(
  input: Record<string, unknown>,
  state: ValidationState,
): DesignElement[] {
  const path = fieldPath(ROOT_PATH, 'children');
  if (!Array.isArray(input.children)) {
    state.errors.push(fail(path, '设计稿 children 必须是有序数组'));
    return [];
  }

  input.children.forEach((child, index) => {
    validateElement(child, childPath(ROOT_PATH, index), state);
  });
  return input.children as DesignElement[];
}

function validateElement(
  element: unknown,
  path: string,
  state: ValidationState,
): void {
  if (!isPlainObject(element)) {
    state.errors.push(fail(path, '元素必须是对象'));
    return;
  }

  validateId(element, path, state);

  const type = element.type;
  if (type === undefined) {
    state.errors.push(
      createDiagnostic(
        DiagnosticCodes.missingField,
        fieldPath(path, 'type'),
        '元素缺少 type',
      ),
    );
    return;
  }

  if (typeof type !== 'string') {
    state.errors.push(fail(fieldPath(path, 'type'), '元素 type 必须是字符串'));
    return;
  }

  const inspector = getNodeInspector(type);
  if (!inspector) {
    state.errors.push(
      createDiagnostic(
        DiagnosticCodes.unknownNodeType,
        fieldPath(path, 'type'),
        `未知的节点类型 "${type}"`,
      ),
    );
    return;
  }

  const allowedFields = new Set([
    'id',
    'type',
    'children',
    ...Object.keys(inspector.fields),
  ]);
  for (const key of Object.keys(element)) {
    if (!allowedFields.has(key)) {
      state.errors.push(
        createDiagnostic(
          DiagnosticCodes.unknownField,
          fieldPath(path, key),
          `节点不支持的字段 "${key}"`,
        ),
      );
    }
  }

  for (const field of inspector.requiredFields ?? []) {
    if (element[field] === undefined) {
      state.errors.push(
        createDiagnostic(
          DiagnosticCodes.missingField,
          fieldPath(path, field),
          `节点缺少必填字段 "${field}"`,
        ),
      );
    }
  }

  for (const [field, validateField] of Object.entries(inspector.fields)) {
    if (element[field] !== undefined) {
      state.errors.push(
        ...validateField(element[field], fieldPath(path, field)),
      );
    }
  }

  validateElementChildren(element, path, inspector.allowsChildren, state);
}

function validateId(
  element: Record<string, unknown>,
  path: string,
  state: ValidationState,
): void {
  const id = element.id;
  const idPath = fieldPath(path, 'id');
  if (typeof id !== 'string' || id.trim().length === 0) {
    state.errors.push(
      createDiagnostic(
        DiagnosticCodes.invalidId,
        idPath,
        '元素 ID 必须是非空字符串',
      ),
    );
    return;
  }

  const firstPath = state.ids.get(id);
  if (firstPath !== undefined) {
    state.errors.push(
      createDiagnostic(
        DiagnosticCodes.duplicateId,
        idPath,
        `重复的元素 ID "${id}"，首次出现在 ${firstPath}`,
      ),
    );
    return;
  }

  state.ids.set(id, idPath);
}

function validateElementChildren(
  element: Record<string, unknown>,
  path: string,
  allowsChildren: boolean,
  state: ValidationState,
): void {
  const childrenPath = fieldPath(path, 'children');

  if (!allowsChildren) {
    if (element.children !== undefined) {
      state.errors.push(
        createDiagnostic(
          DiagnosticCodes.invalidChildren,
          childrenPath,
          '叶节点不能包含 children',
        ),
      );
    }
    return;
  }

  if (element.children === undefined) {
    return;
  }

  if (!Array.isArray(element.children)) {
    state.errors.push(
      createDiagnostic(
        DiagnosticCodes.invalidChildren,
        childrenPath,
        'children 必须是有序数组',
      ),
    );
    return;
  }

  element.children.forEach((child, index) => {
    validateElement(child, childPath(path, index), state);
  });
}
