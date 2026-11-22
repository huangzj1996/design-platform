import {
  createDiagnostic,
  type DesignDocument,
  type Diagnostic,
} from '@design-ai/design-schema';
import {
  DesktopDiagnosticCodes,
  type OpenDesignFileResult,
} from '../shared/open-design-file';

export interface EditorState {
  document: DesignDocument | null;
  /** Save target of a native document; `null` for an unsaved import. */
  filePath: string | null;
  /** Pencil source of an imported draft, shown until the draft is saved. */
  sourcePath: string | null;
  diagnostics: Diagnostic[];
  warnings: Diagnostic[];
}

export const initialEditorState: EditorState = {
  document: null,
  filePath: null,
  sourcePath: null,
  diagnostics: [],
  warnings: [],
};

/**
 * Applies an open-file result to the editor. A failed or cancelled open leaves
 * the current design untouched; only diagnostics are shown for a failure.
 * An imported Pencil file becomes an unsaved native draft and keeps its
 * conversion warnings visible.
 */
export function applyOpenResult(
  state: EditorState,
  result: OpenDesignFileResult,
): EditorState {
  switch (result.status) {
    case 'cancelled':
      return state;
    case 'failed':
      return { ...state, diagnostics: result.errors };
    case 'imported':
      return {
        document: result.document,
        filePath: null,
        sourcePath: result.sourcePath,
        diagnostics: [],
        warnings: result.warnings,
      };
    case 'opened':
      return {
        document: result.document,
        filePath: result.filePath,
        sourcePath: null,
        diagnostics: [],
        warnings: [],
      };
  }
}

export function applyOpenError(
  state: EditorState,
  error: unknown,
): EditorState {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...state,
    diagnostics: [
      createDiagnostic(DesktopDiagnosticCodes.openFailed, '$', message),
    ],
  };
}

export function documentName(filePath: string | null): string {
  if (filePath === null) {
    return '尚未打开设计稿';
  }
  const segments = filePath.split(/[\\/]/).filter((segment) => segment !== '');
  return segments.at(-1) ?? filePath;
}
