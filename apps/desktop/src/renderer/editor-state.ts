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
  filePath: string | null;
  diagnostics: Diagnostic[];
}

export const initialEditorState: EditorState = {
  document: null,
  filePath: null,
  diagnostics: [],
};

/**
 * Applies an open-file result to the editor. A failed or cancelled open leaves
 * the current design untouched; only diagnostics are shown for a failure.
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
    case 'opened':
      return {
        document: result.document,
        filePath: result.filePath,
        diagnostics: [],
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
