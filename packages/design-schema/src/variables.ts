import type { DesignDocument, DesignElement, DesignVariable } from './types';

/**
 * Document variable names start with two hyphens followed by segments of
 * lowercase letters or digits joined by single hyphens.
 */
const VARIABLE_NAME_PATTERN = /^--[a-z0-9]+(?:-[a-z0-9]+)*$/;

const VARIABLE_REFERENCE_PREFIX = '$${';
const VARIABLE_REFERENCE_SUFFIX = '}';

export function isVariableName(value: unknown): value is string {
  return typeof value === 'string' && VARIABLE_NAME_PATTERN.test(value);
}

/**
 * Returns the referenced variable name when the whole value is wrapped in
 * `$${...}`. A reference embedded in a longer string is not resolved, and the
 * inner name must follow the same pattern as a variable definition.
 */
export function variableReferenceName(value: unknown): string | undefined {
  if (
    typeof value !== 'string' ||
    !value.startsWith(VARIABLE_REFERENCE_PREFIX) ||
    !value.endsWith(VARIABLE_REFERENCE_SUFFIX)
  ) {
    return undefined;
  }

  const name = value.slice(
    VARIABLE_REFERENCE_PREFIX.length,
    -VARIABLE_REFERENCE_SUFFIX.length,
  );
  return isVariableName(name) ? name : undefined;
}

/**
 * Returns the literal text when the whole value escapes a variable reference
 * with a leading backslash, for example `\$${--color-brand}`. The backslash is
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
 * Indexes variables by name. Documents normally have unique names; when a
 * duplicate slips through, the first definition wins.
 */
export function indexVariables(
  variables: readonly DesignVariable[],
): Map<string, DesignVariable> {
  const variablesByName = new Map<string, DesignVariable>();
  for (const variable of variables) {
    if (!variablesByName.has(variable.name)) {
      variablesByName.set(variable.name, variable);
    }
  }
  return variablesByName;
}

/**
 * Resolves a whole-value variable reference to its literal value. Any other
 * value, including references embedded in longer text and unresolved names,
 * is returned unchanged.
 */
export function resolveVariableValue(
  value: unknown,
  variablesByName: ReadonlyMap<string, DesignVariable>,
): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const literal = unescapeVariableReference(value);
  if (literal !== undefined) {
    return literal;
  }

  const name = variableReferenceName(value);
  if (name === undefined) {
    return value;
  }

  return variablesByName.get(name)?.value ?? value;
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
  const variablesByName = indexVariables(document.variables);
  return {
    ...document,
    children: document.children.map((element) =>
      resolveElement(element, variablesByName),
    ),
  };
}

function resolveElement(
  element: DesignElement,
  variablesByName: ReadonlyMap<string, DesignVariable>,
): DesignElement {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(element)) {
    if (key === 'children' && Array.isArray(value)) {
      resolved[key] = value.map((child) =>
        resolveElement(child as DesignElement, variablesByName),
      );
    } else if (key === 'id' || key === 'type') {
      // Identity fields are never bindings, so keep their literal value.
      resolved[key] = value;
    } else {
      resolved[key] = resolveVariableValue(value, variablesByName);
    }
  }

  return resolved as unknown as DesignElement;
}
