/**
 * A structural diagnostic produced while validating a design document.
 *
 * `path` uses a JSON-path-like notation rooted at `$`, for example
 * `$.children[0].children[1].id`.
 */
export interface Diagnostic {
  code: string;
  path: string;
  message: string;
}

export const DiagnosticCodes = {
  invalidJson: 'invalid_json',
  invalidStructure: 'invalid_structure',
  missingVersion: 'missing_version',
  invalidVersion: 'invalid_version',
  unsupportedVersion: 'unsupported_version',
  invalidFilePath: 'invalid_file_path',
  unknownField: 'unknown_field',
  unknownNodeType: 'unknown_node_type',
  invalidId: 'invalid_id',
  duplicateId: 'duplicate_id',
  invalidChildren: 'invalid_children',
  missingField: 'missing_field',
  invalidValue: 'invalid_value',
  invalidVariableName: 'invalid_variable_name',
  missingVariable: 'missing_variable',
  variableTypeMismatch: 'variable_type_mismatch',
  missingSizeBasis: 'missing_size_basis',
} as const;

export type DiagnosticCode =
  (typeof DiagnosticCodes)[keyof typeof DiagnosticCodes];

export function createDiagnostic(
  code: string,
  path: string,
  message: string,
): Diagnostic {
  return { code, path, message };
}
