import { DiagnosticCodes, type DiagnosticCode } from './diagnostics';
import type {
  DesignDocument,
  DesignElement,
  DesignVariables,
  VariableType,
} from './types';

/**
 * Document variable names contain lowercase letters or digits in segments
 * joined by single hyphens.
 */
const VARIABLE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isVariableName(value: unknown): value is string {
  return typeof value === 'string' && VARIABLE_NAME_PATTERN.test(value);
}

/**
 * Returns the referenced variable name when the whole value is `$name`,
 * using the same name pattern as a variable definition.
 */
export function variableReferenceName(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('$')) {
    return undefined;
  }

  const name = value.slice(1);
  return isVariableName(name) ? name : undefined;
}

/**
 * Returns the literal text when the whole value escapes a variable reference
 * with a leading backslash, for example `\$color-brand`. The backslash is
 * removed so the canvas shows the reference as literal text.
 */
export function unescapeVariableReference(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('\\')) {
    return undefined;
  }
  const candidate = value.slice(1);
  return variableReferenceName(candidate) === undefined ? undefined : candidate;
}

/**
 * Resolves a whole-value variable reference to its literal value. Any other
 * value, including references embedded in longer text and unresolved names,
 * is returned unchanged.
 */
export function resolveVariableValue(
  value: unknown,
  variables: Readonly<DesignVariables>,
): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const literal = unescapeVariableReference(value);
  if (literal !== undefined) {
    return literal;
  }

  const name = variableReferenceName(value);
  if (name === undefined || !Object.hasOwn(variables, name)) {
    return value;
  }

  return variables[name]?.value ?? value;
}

/**
 * Returns a copy of the document with variable references replaced by their
 * literal values. The source document keeps its references so saving preserves
 * the bindings. Resolution is not recursive: a string variable whose value
 * looks like a reference stays literal.
 */
export function resolveDesignDocument(
  document: DesignDocument,
): DesignDocument {
  return {
    ...document,
    children: document.children.map((element) =>
      resolveElement(element, document.variables),
    ),
  };
}

function resolveElement(
  element: DesignElement,
  variables: Readonly<DesignVariables>,
): DesignElement {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(element)) {
    if (key === 'children' && Array.isArray(value)) {
      resolved[key] = value.map((child) =>
        resolveElement(child as DesignElement, variables),
      );
    } else if (key === 'id' || key === 'type') {
      // Identity fields are never bindings, so keep their literal value.
      resolved[key] = value;
    } else {
      resolved[key] = resolveVariableValue(value, variables);
    }
  }

  return resolved as unknown as DesignElement;
}

export function resolveBoundField(
  value: unknown,
  variableTypes: readonly VariableType[] | undefined,
  variables: Readonly<DesignVariables>,
): { value: unknown } | { code: DiagnosticCode; message: string } {
  const literal = unescapeVariableReference(value);
  if (literal !== undefined) {
    return { value: literal };
  }

  const name = variableReferenceName(value);
  if (name === undefined) {
    return { value };
  }

  const variable = Object.hasOwn(variables, name) ? variables[name] : undefined;
  if (variable === undefined) {
    return {
      code: DiagnosticCodes.missingVariable,
      message: `引用的变量 "${name}" 不存在`,
    };
  }

  if (!variableTypes?.includes(variable.type)) {
    return {
      code: DiagnosticCodes.variableTypeMismatch,
      message: `变量 "${name}" 的类型 ${variable.type} 不能绑定到此属性`,
    };
  }

  return { value: variable.value };
}
