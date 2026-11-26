import { z } from 'zod';
import {
  createDiagnostic,
  DiagnosticCodes,
  type Diagnostic,
} from './diagnostics';
import { isHexColor, isOneOf, isPlainObject } from './fields';
import {
  dimensionModes,
  frameAlignItems,
  frameJustifyContent,
  frameLayouts,
} from './layout-values';
import { layoutDesignDocument, layoutIssueToDiagnostic } from './layout';
import { getNodeInspector } from './node-inspectors';
import { isSystemAbsolutePath } from './path';
import {
  DESIGN_DOCUMENT_VERSION,
  type DesignDocument,
  type DesignVariables,
  type FieldValidator,
  type NodeInspector,
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

const nonNegativeNumberSchema = z.number().nonnegative();
const dimensionSchemaV2 = z.union([
  nonNegativeNumberSchema,
  z.enum(dimensionModes),
]);
const layoutSchemaV2 = z.enum(frameLayouts);
const justifyContentSchemaV2 = z.enum(frameJustifyContent);
const alignItemsSchemaV2 = z.enum([...frameAlignItems, 'stretch']);
const paddingSidesSchemaV2 = z
  .array(z.unknown())
  .refine(
    (sides) => sides.length === 2 || sides.length === 4,
    '内边距数组必须包含两个或四个数值',
  );

type VariableReference = `$${string}`;
export type NumericValueV2 = number | VariableReference;

export type DimensionV2 = z.infer<typeof dimensionSchemaV2> | VariableReference;

export interface FrameLayoutFieldsV2 {
  clip?: boolean | VariableReference;
  layout?: z.infer<typeof layoutSchemaV2>;
  gap?: NumericValueV2;
  padding?:
    | NumericValueV2
    | [NumericValueV2, NumericValueV2]
    | [NumericValueV2, NumericValueV2, NumericValueV2, NumericValueV2];
  justifyContent?: z.infer<typeof justifyContentSchemaV2>;
  alignItems?: z.infer<typeof alignItemsSchemaV2>;
}

export const dimensionFieldV2 = zodField(
  dimensionSchemaV2,
  '尺寸必须是非负有限数值、fit_content 或 fill_container',
  'number',
);
const spacingField = zodField(
  nonNegativeNumberSchema,
  '间距必须是非负有限数值',
  'number',
);
const paddingFieldV2: FieldValidator = Object.assign(
  (value: unknown, path: string, variables: Readonly<DesignVariables> = {}) => {
    if (!Array.isArray(value)) {
      return spacingField(value, path, variables);
    }

    const sides = paddingSidesSchemaV2.safeParse(value);
    if (!sides.success) {
      return sides.error.issues.map((issue) =>
        createDiagnostic(DiagnosticCodes.invalidValue, path, issue.message),
      );
    }

    return sides.data.flatMap((side, index) =>
      validateBoundField(side, spacingField, `${path}[${index}]`, variables),
    );
  },
  { variableTypes: spacingField.variableTypes },
);

export const frameLayoutFieldsV2 = {
  clip: zodField(z.boolean(), 'clip 必须是布尔值', 'boolean'),
  layout: zodField(layoutSchemaV2, '无效的 Frame 布局'),
  gap: spacingField,
  padding: paddingFieldV2,
  justifyContent: zodField(justifyContentSchemaV2, '无效的主轴分布'),
  alignItems: zodField(alignItemsSchemaV2, '无效的交叉轴对齐'),
};

function zodField(
  schema: z.ZodType,
  message: string,
  variableType?: VariableType,
): FieldValidator {
  const validate: FieldValidator = (value, path) =>
    schema.safeParse(value).success
      ? []
      : [createDiagnostic(DiagnosticCodes.invalidValue, path, message)];
  if (variableType !== undefined) {
    validate.variableTypes = [variableType];
  }
  return validate;
}

interface ValidationState {
  version: number;
  errors: Diagnostic[];
  ids: Map<string, string>;
  variables: DesignVariables;
  inspectNode: (type: string) => NodeInspector | undefined;
}

interface DocumentStructure<Version extends number> {
  version: Version;
  children: unknown[];
  filePath?: string;
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
  return parseDocumentJson(text, validateDesignDocument);
}

export function parseDocumentJson<Document>(
  text: string,
  validate: (input: unknown) => ValidationResult<Document>,
): ValidationResult<Document> {
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

  return validate(input);
}

/**
 * Validates an already parsed value against the native version 1 document
 * contract. Validation dispatches every element to the inspector registered
 * for its `type`.
 */
export function validateDesignDocument(input: unknown): ValidationResult {
  const result = validateDocumentStructure(
    input,
    DESIGN_DOCUMENT_VERSION,
    getNodeInspector,
  );
  if (!result.ok) {
    return result;
  }

  const document = result.document as DesignDocument;
  const layout = layoutDesignDocument(document);
  if (layout.issues.length > 0) {
    return {
      ok: false,
      errors: layout.issues.map(layoutIssueToDiagnostic),
    };
  }

  return { ok: true, document };
}

export function validateDocumentStructure<Version extends number>(
  input: unknown,
  version: Version,
  inspectNode: ValidationState['inspectNode'],
): ValidationResult<DocumentStructure<Version>> {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [fail(ROOT_PATH, '设计稿根节点必须是对象')],
    };
  }

  const state: ValidationState = {
    version,
    errors: [],
    ids: new Map(),
    variables: {},
    inspectNode,
  };
  validateVersion(input, version, state);
  validateRootFields(input, state);
  const filePath = validateFilePath(input, state);
  state.variables = validateVariables(input, state);
  const children = validateChildren(input, state);

  if (state.errors.length > 0) {
    return { ok: false, errors: state.errors };
  }

  return {
    ok: true,
    document: {
      version,
      children,
      variables: state.variables,
      ...(filePath === undefined ? {} : { filePath }),
    },
  };
}

function validateVersion(
  input: Record<string, unknown>,
  expectedVersion: number,
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

  if (version !== expectedVersion) {
    state.errors.push(
      createDiagnostic(
        DiagnosticCodes.unsupportedVersion,
        fieldPath(ROOT_PATH, 'version'),
        `不支持的设计稿版本 ${version}，当前只支持版本 ${expectedVersion}`,
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
): unknown[] {
  const path = fieldPath(ROOT_PATH, 'children');
  if (!Array.isArray(input.children)) {
    state.errors.push(fail(path, '设计稿 children 必须是有序数组'));
    return [];
  }

  validateElementArray(input.children, ROOT_PATH, state);
  return input.children;
}

function validateElementArray(
  children: unknown[],
  path: string,
  state: ValidationState,
): void {
  if (state.version === DESIGN_DOCUMENT_VERSION) {
    children.forEach((child, index) => {
      validateElement(child, childPath(path, index), state);
    });
    return;
  }
  for (let index = 0; index < children.length; index += 1) {
    validateElement(children[index], childPath(path, index), state);
  }
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

  const inspector = state.inspectNode(type);
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

  const errors = validateObjectFields(
    element,
    path,
    inspector,
    state.variables,
    ['id', 'type', 'children'],
  );
  for (const error of errors) {
    state.errors.push(error);
  }
  validateElementChildren(element, path, inspector.allowsChildren, state);
}

export function validateObjectFields(
  object: Record<string, unknown>,
  path: string,
  { fields, requiredFields }: Pick<NodeInspector, 'fields' | 'requiredFields'>,
  variables: Readonly<DesignVariables>,
  structuralFields: readonly string[] = [],
): Diagnostic[] {
  const errors: Diagnostic[] = [];
  const allowedFields = new Set([...structuralFields, ...Object.keys(fields)]);
  for (const key of Object.keys(object)) {
    if (!allowedFields.has(key)) {
      errors.push(
        createDiagnostic(
          DiagnosticCodes.unknownField,
          fieldPath(path, key),
          `节点不支持的字段 "${key}"`,
        ),
      );
    }
  }

  for (const field of requiredFields ?? []) {
    if (object[field] === undefined) {
      errors.push(
        createDiagnostic(
          DiagnosticCodes.missingField,
          fieldPath(path, field),
          `节点缺少必填字段 "${field}"`,
        ),
      );
    }
  }

  for (const [field, validateField] of Object.entries(fields)) {
    if (object[field] !== undefined) {
      const fieldErrors = validateBoundField(
        object[field],
        validateField,
        fieldPath(path, field),
        variables,
      );
      for (const error of fieldErrors) {
        errors.push(error);
      }
    }
  }

  return errors;
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
    return validator(literal, path, variables);
  }

  const name = variableReferenceName(value);
  if (name === undefined) {
    return validator(value, path, variables);
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

  return validator(variable.value, path, variables);
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
  const hasChildren =
    element.children !== undefined ||
    (state.version !== DESIGN_DOCUMENT_VERSION &&
      Object.hasOwn(element, 'children'));
  if (!hasChildren) {
    return;
  }

  const childrenPath = fieldPath(path, 'children');
  if (!allowsChildren) {
    state.errors.push(
      createDiagnostic(
        DiagnosticCodes.invalidChildren,
        childrenPath,
        '叶节点不能包含 children',
      ),
    );
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

  validateElementArray(element.children, path, state);
}
