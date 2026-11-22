import {
  createDiagnostic,
  DiagnosticCodes,
  type Diagnostic,
} from './diagnostics';
import type { FieldValidator } from './types';

const HEX_COLOR_PATTERN =
  /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const DIMENSION_MODES = ['fit_content', 'fill_container'] as const;

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

export function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return (
    typeof value === 'string' && (allowed as readonly string[]).includes(value)
  );
}

function invalid(path: string, message: string): Diagnostic[] {
  return [createDiagnostic(DiagnosticCodes.invalidValue, path, message)];
}

function checkNonNegativeNumber(
  value: unknown,
  path: string,
  label: string,
): Diagnostic[] {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return invalid(path, `${label}必须是非负有限数值`);
  }
  return [];
}

export const stringField: FieldValidator = (value, path) =>
  typeof value === 'string' ? [] : invalid(path, '必须是字符串');

export const nonEmptyStringField: FieldValidator = (value, path) =>
  typeof value === 'string' && value.length > 0
    ? []
    : invalid(path, '必须是非空字符串');

export const booleanField: FieldValidator = (value, path) =>
  typeof value === 'boolean' ? [] : invalid(path, '必须是布尔值');

export const numberField: FieldValidator = (value, path) =>
  typeof value === 'number' && Number.isFinite(value)
    ? []
    : invalid(path, '必须是有限数值');

export const nonNegativeNumberField: FieldValidator = (value, path) =>
  checkNonNegativeNumber(value, path, '数值');

export const positiveNumberField: FieldValidator = (value, path) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? []
    : invalid(path, '必须是正有限数值');

export const opacityField: FieldValidator = (value, path) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1
    ? []
    : invalid(path, '不透明度必须是 0 到 1 之间的数值');

export const colorField: FieldValidator = (value, path) =>
  isHexColor(value) ? [] : invalid(path, '颜色必须是十六进制字符串');

export function enumField<T extends string>(
  values: readonly T[],
): FieldValidator {
  return (value, path) =>
    isOneOf(value, values)
      ? []
      : invalid(path, `必须是 ${values.join('、')} 之一`);
}

export const paddingField: FieldValidator = (value, path) => {
  if (!Array.isArray(value) || value.length !== 4) {
    return invalid(path, '内边距必须是按上、右、下、左排列的四个数值');
  }

  const diagnostics: Diagnostic[] = [];
  value.forEach((entry, index) => {
    diagnostics.push(
      ...checkNonNegativeNumber(entry, `${path}[${index}]`, '内边距'),
    );
  });
  return diagnostics;
};

export const dimensionField: FieldValidator = (value, path) => {
  if (typeof value === 'number') {
    return checkNonNegativeNumber(value, path, '固定尺寸');
  }

  if (!isPlainObject(value)) {
    return invalid(path, '尺寸必须是数值或包含 mode 的尺寸对象');
  }

  const diagnostics: Diagnostic[] = [];
  for (const key of Object.keys(value)) {
    if (key !== 'mode' && key !== 'fallback') {
      diagnostics.push(
        createDiagnostic(
          DiagnosticCodes.unknownField,
          `${path}.${key}`,
          `不支持的尺寸字段 "${key}"`,
        ),
      );
    }
  }

  if (!('mode' in value)) {
    diagnostics.push(...invalid(`${path}.mode`, '尺寸对象必须包含 mode'));
  } else if (!isOneOf(value.mode, DIMENSION_MODES)) {
    diagnostics.push(
      ...invalid(
        `${path}.mode`,
        `尺寸模式必须是 ${DIMENSION_MODES.join('、')} 之一`,
      ),
    );
  }

  if ('fallback' in value) {
    diagnostics.push(
      ...checkNonNegativeNumber(value.fallback, `${path}.fallback`, '备用尺寸'),
    );
  }

  return diagnostics;
};
