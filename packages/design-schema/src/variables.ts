import type { DesignDocument, DesignElement, DesignVariable } from './types';

/**
 * Document variable names start with two hyphens followed by segments of
 * lowercase letters or digits joined by single hyphens.
 */
const VARIABLE_NAME_PATTERN = /^--[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A whole-value reference such as `$${--color-brand}`. */
const VARIABLE_REFERENCE_PATTERN = /^\$\$\{(--[a-z0-9]+(?:-[a-z0-9]+)*)\}$/;

export function isVariableName(value: unknown): value is string {
  return typeof value === 'string' && VARIABLE_NAME_PATTERN.test(value);
}

/**
 * Returns the referenced variable name when the whole value is a variable
 * reference. Characters embedded in a longer string are not references.
 */
export function variableReferenceName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return VARIABLE_REFERENCE_PATTERN.exec(value)?.[1];
}

/**
 * Returns the literal text when the whole value escapes a variable reference
 * with a leading backslash, for example `\$${--color-brand}`. The backslash is
 * removed so the canvas shows the reference as literal text.
 */
export function escapedVariableReference(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('\\')) {
    return undefined;
  }
  const candidate = value.slice(1);
  return variableReferenceName(candidate) === undefined ? undefined : candidate;
}

/**
 * Indexes variables by name. Documents normally have unique names; when a
 * duplicate slips through, the first definition wins.
 */
export function indexVariables(
  variables: readonly DesignVariable[],
): Map<string, DesignVariable> {
  const index = new Map<string, DesignVariable>();
  for (const variable of variables) {
    if (!index.has(variable.name)) {
      index.set(variable.name, variable);
    }
  }
  return index;
}

/**
 * Resolves a whole-value variable reference to its literal value. Any other
 * value, including references embedded in longer text and unresolved names,
 * is returned unchanged.
 */
export function resolveVariableValue(
  value: unknown,
  variables: ReadonlyMap<string, DesignVariable>,
): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const escaped = escapedVariableReference(value);
  if (escaped !== undefined) {
    return escaped;
  }

  const name = variableReferenceName(value);
  if (name === undefined) {
    return value;
  }

  return variables.get(name)?.value ?? value;
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
  const variables = indexVariables(document.variables);
  return {
    ...document,
    children: document.children.map((element) =>
      resolveElement(element, variables),
    ),
  };
}

function resolveElement(
  element: DesignElement,
  variables: ReadonlyMap<string, DesignVariable>,
): DesignElement {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(element)) {
    if (key === 'children' && Array.isArray(value)) {
      resolved[key] = value.map((child) =>
        resolveElement(child as DesignElement, variables),
      );
    } else if (key === 'id' || key === 'type') {
      resolved[key] = value;
    } else {
      resolved[key] = resolveVariableValue(value, variables);
    }
  }

  return resolved as unknown as DesignElement;
}
