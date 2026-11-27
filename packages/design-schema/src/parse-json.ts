import { createDiagnostic, DiagnosticCodes } from './diagnostics';
import type { ValidationResult } from './types';

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
          '$',
          `JSON 解析失败：${message}`,
        ),
      ],
    };
  }

  return validate(input);
}
