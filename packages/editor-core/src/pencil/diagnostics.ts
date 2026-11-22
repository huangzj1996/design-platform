import { DiagnosticCodes } from '@design-ai/design-schema';

/**
 * Diagnostic codes produced by the Pencil 2.25 import. Parse and version
 * failures reuse the native document codes so both entry points report the
 * same kind of problem. Import-specific codes describe lossy conversion.
 */
export const PencilDiagnosticCodes = {
  invalidJson: DiagnosticCodes.invalidJson,
  invalidStructure: DiagnosticCodes.invalidStructure,
  missingVersion: DiagnosticCodes.missingVersion,
  invalidVersion: DiagnosticCodes.invalidVersion,
  unsupportedVersion: DiagnosticCodes.unsupportedVersion,
  missingId: 'missing_id',
  duplicateId: 'duplicate_id',
  unsupportedNode: 'unsupported_node',
  unsupportedProperty: 'unsupported_property',
  skippedNode: 'skipped_node',
  emptyImport: 'empty_import',
} as const;

export type PencilDiagnosticCode =
  (typeof PencilDiagnosticCodes)[keyof typeof PencilDiagnosticCodes];
