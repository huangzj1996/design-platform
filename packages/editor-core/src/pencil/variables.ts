import {
  createDiagnostic,
  isHexColor,
  isPlainObject,
  type DesignVariable,
  type Diagnostic,
  type VariableType,
  type VariableValue,
} from '@design-ai/design-schema';
import { PencilDiagnosticCodes } from './diagnostics';

const VARIABLE_TYPES: readonly VariableType[] = [
  'color',
  'string',
  'number',
  'boolean',
];
const VARIABLES_PATH = '$.variables';

export interface ConvertedVariables {
  variables: DesignVariable[];
  /** Converted native variables indexed by their original Pencil name. */
  bySourceName: Map<string, DesignVariable>;
}

function variablePath(sourceName: string): string {
  return `${VARIABLES_PATH}.${sourceName}`;
}

function warnSkippedVariable(
  warnings: Diagnostic[],
  sourceName: string,
  field: string | undefined,
  message: string,
): void {
  const base = variablePath(sourceName);
  warnings.push(
    createDiagnostic(
      PencilDiagnosticCodes.unsupportedVariable,
      field === undefined ? base : `${base}.${field}`,
      message,
    ),
  );
}

function isVariableType(value: unknown): value is VariableType {
  return (
    typeof value === 'string' &&
    (VARIABLE_TYPES as readonly string[]).includes(value)
  );
}

function isLiteralValue(
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

/**
 * Normalizes a Pencil variable name such as `color.brand` into a native
 * double-hyphen name such as `--color-brand`. Characters outside lowercase
 * ASCII letters and digits become single hyphens. Returns undefined when no
 * usable name segment remains.
 */
export function normalizeVariableName(sourceName: string): string | undefined {
  const base = sourceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base.length === 0 ? undefined : `--${base}`;
}

/**
 * Reserves a unique native name, adding a numeric suffix when two source
 * variables normalize to the same name.
 */
function uniqueVariableName(
  normalized: string,
  usedNames: ReadonlySet<string>,
): string {
  if (!usedNames.has(normalized)) {
    return normalized;
  }
  let suffix = 2;
  while (usedNames.has(`${normalized}-${suffix}`)) {
    suffix += 1;
  }
  return `${normalized}-${suffix}`;
}

function convertVariable(
  sourceName: string,
  entry: unknown,
  usedNames: ReadonlySet<string>,
  warnings: Diagnostic[],
): DesignVariable | undefined {
  if (!isPlainObject(entry)) {
    warnSkippedVariable(
      warnings,
      sourceName,
      undefined,
      `Pencil 变量 "${sourceName}" 必须是对象，已跳过`,
    );
    return undefined;
  }

  for (const key of Object.keys(entry)) {
    if (key !== 'type' && key !== 'value') {
      warnings.push(
        createDiagnostic(
          PencilDiagnosticCodes.unsupportedProperty,
          `${variablePath(sourceName)}.${key}`,
          `Pencil 变量属性 "${key}" 暂不支持，已跳过`,
        ),
      );
    }
  }

  const { type, value } = entry;
  if (!isVariableType(type)) {
    warnSkippedVariable(
      warnings,
      sourceName,
      'type',
      `Pencil 变量 "${sourceName}" 的类型不受支持，已跳过`,
    );
    return undefined;
  }

  if (Array.isArray(value)) {
    warnSkippedVariable(
      warnings,
      sourceName,
      'value',
      `Pencil 主题变量 "${sourceName}" 暂不支持，已跳过`,
    );
    return undefined;
  }

  if (typeof value === 'string' && value.startsWith('$')) {
    warnSkippedVariable(
      warnings,
      sourceName,
      'value',
      `Pencil 变量 "${sourceName}" 引用了其他变量，暂不支持，已跳过`,
    );
    return undefined;
  }

  if (!isLiteralValue(type, value)) {
    warnSkippedVariable(
      warnings,
      sourceName,
      'value',
      `Pencil 变量 "${sourceName}" 的值与类型 ${type} 不匹配，已跳过`,
    );
    return undefined;
  }

  const normalized = normalizeVariableName(sourceName);
  if (normalized === undefined) {
    warnSkippedVariable(
      warnings,
      sourceName,
      'name',
      `Pencil 变量名 "${sourceName}" 无法规范化为原生变量名，已跳过`,
    );
    return undefined;
  }

  return {
    name: uniqueVariableName(normalized, usedNames),
    type,
    value,
  };
}

/**
 * Converts the Pencil document-level `variables` map into native variables.
 * Only literal color, string, number and boolean variables are supported;
 * themed variables and variable-to-variable references are reported and
 * skipped, so properties referencing them fall back to the existing property
 * downgrade rules.
 */
export function convertVariables(
  input: unknown,
  warnings: Diagnostic[],
): ConvertedVariables {
  const variables: DesignVariable[] = [];
  const bySourceName = new Map<string, DesignVariable>();

  if (input === undefined) {
    return { variables, bySourceName };
  }

  if (!isPlainObject(input)) {
    warnings.push(
      createDiagnostic(
        PencilDiagnosticCodes.unsupportedVariable,
        VARIABLES_PATH,
        'Pencil 文档 variables 必须是对象，已忽略全部变量',
      ),
    );
    return { variables, bySourceName };
  }

  const usedNames = new Set<string>();
  for (const [sourceName, entry] of Object.entries(input)) {
    const variable = convertVariable(sourceName, entry, usedNames, warnings);
    if (variable === undefined) {
      continue;
    }
    usedNames.add(variable.name);
    variables.push(variable);
    bySourceName.set(sourceName, variable);
  }

  return { variables, bySourceName };
}
