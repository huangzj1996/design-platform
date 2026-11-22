import {
  createDiagnostic,
  DiagnosticCodes,
  type Diagnostic,
} from './diagnostics';
import { isHexColor, isOneOf, isPlainObject } from './fields';
import { layoutDesignDocument, layoutIssueToDiagnostic } from './layout';
import { getNodeInspector } from './node-inspectors';
import { isSystemAbsolutePath } from './path';
import {
  DESIGN_DOCUMENT_VERSION,
  type DesignDocument,
  type DesignElement,
  type DesignVariables,
  type FieldValidator,
  type ValidationResult,
  type VariableType,
  type VariableValue,
} from './types';
import {
  isVariableName,
  unescapeVariableReference,
  variableReferenceName,
} from './variables';

const ROOT_PATH = '$';
const ROOT_FIELDS = new Set(['version', 'children', 'filePath', 'variables']);
const VARIABLE_FIELDS = new Set(['type', 'value']);
const VARIABLE_TYPES: readonly VariableType[] = [
  'color',
  'string',
  'number',
  'boolean',
];

interface ValidationState {
  errors: Diagnostic[];
  ids: Map<string, string>;
  variables: DesignVariables;
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
    input = JSON.parse(text);
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

  const state: ValidationState = {
    errors: [],
    ids: new Map(),
    variables: {},
  };
  validateVersion(input, state);
  validateRootFields(input, state);
  const filePath = validateFilePath(input, state);
  state.variables = validateVariables(input, state);
  const children = validateChildren(input, state);

  if (state.errors.length > 0) {
    return { ok: false, errors: state.errors };
  }

  const document: DesignDocument = {
    version: DESIGN_DOCUMENT_VERSION,
    children,
    variables: state.variables,
    ...(filePath === undefined ? {} : { filePath }),
  };

  const layout = layoutDesignDocument(document);
  if (layout.issues.length > 0) {
    return {
      ok: false,
      errors: layout.issues.map(layoutIssueToDiagnostic),
    };
  }

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
): DesignVariables {
  if (input.variables === undefined) {
    return {};
  }

  const path = fieldPath(ROOT_PATH, 'variables');
  if (!isPlainObject(input.variables)) {
    state.errors.push(fail(path, 'variables 必须是对象'));
    return {};
  }

  const variables: DesignVariables = {};
  for (const [name, entry] of Object.entries(input.variables)) {
    const entryPath = fieldPath(path, name);
    if (!isPlainObject(entry)) {
      state.errors.push(fail(entryPath, '变量必须是对象'));
      continue;
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

    const { type, value } = entry;
    const nameIsValid = isVariableName(name);
    const typeIsValid = isVariableType(type);
    const valueIsValid = typeIsValid && isValidVariableValue(type, value);

    if (!nameIsValid) {
      state.errors.push(
        createDiagnostic(
          DiagnosticCodes.invalidVariableName,
          entryPath,
          '变量名必须由小写字母或数字分段组成，分段之间用单连字符连接',
        ),
      );
    }

    if (!typeIsValid) {
      state.errors.push(
        createDiagnostic(
          DiagnosticCodes.invalidValue,
          fieldPath(entryPath, 'type'),
          `变量类型必须是 ${VARIABLE_TYPES.join('、')} 之一`,
        ),
      );
    } else if (!valueIsValid) {
      state.errors.push(
        createDiagnostic(
          DiagnosticCodes.invalidValue,
          fieldPath(entryPath, 'value'),
          `变量值必须匹配 ${type} 类型`,
        ),
      );
    }

    if (nameIsValid && typeIsValid && valueIsValid) {
      variables[name] = { type, value };
    }
  }

  return variables;
}

function isVariableType(value: unknown): value is VariableType {
  return isOneOf(value, VARIABLE_TYPES);
}

function isValidVariableValue(
  type: VariableType,
  value: unknown,
): value is VariableValue {
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
        ...validateBoundField(
          element[field],
          validateField,
          fieldPath(path, field),
          state.variables,
        ),
      );
    }
  }

  validateElementChildren(element, path, inspector.allowsChildren, state);
}

/**
 * Validates a property value that may be a whole-value variable reference.
 * Missing names and type mismatches point at the property using the variable;
 * the resolved literal is then checked against the normal field rules so the
 * same number can be valid for one property and out of range for another.
 */
function validateBoundField(
  value: unknown,
  validator: FieldValidator,
  path: string,
  variables: Readonly<DesignVariables>,
): Diagnostic[] {
  const literal = unescapeVariableReference(value);
  if (literal !== undefined) {
    return validator(literal, path);
  }

  const name = variableReferenceName(value);
  if (name === undefined) {
    return validator(value, path);
  }

  const variable = Object.hasOwn(variables, name) ? variables[name] : undefined;
  if (variable === undefined) {
    return [
      createDiagnostic(
        DiagnosticCodes.missingVariable,
        path,
        `引用的变量 "${name}" 不存在`,
      ),
    ];
  }

  if (
    validator.variableTypes === undefined ||
    !validator.variableTypes.includes(variable.type)
  ) {
    return [
      createDiagnostic(
        DiagnosticCodes.variableTypeMismatch,
        path,
        `变量 "${name}" 的类型 ${variable.type} 不能绑定到此属性`,
      ),
    ];
  }

  return validator(variable.value, path);
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
