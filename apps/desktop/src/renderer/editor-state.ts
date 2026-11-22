import {
  createDiagnostic,
  type DesignDocument,
  type Diagnostic,
} from '@design-ai/design-schema';
import {
  DesktopDiagnosticCodes,
  type CreateDesignFileResult,
  type OpenDesignFileResult,
  type SaveDesignFileResult,
} from '../shared/open-design-file';

export type PendingAction = 'open' | 'create' | 'close';

export type SaveStatus = 'idle' | 'saving' | 'error';

export interface EditorState {
  document: DesignDocument | null;
  /** Save target of a native document; `null` for an unsaved import. */
  filePath: string | null;
  /** Pencil source of an imported draft, shown until the draft is saved. */
  sourcePath: string | null;
  diagnostics: Diagnostic[];
  diagnosticsTitle: string;
  warnings: Diagnostic[];
  /** Element selected in the layer tree, properties panel and canvas. */
  selectionId: string | null;
  /** Persistent edits since the last successful save; selections do not count. */
  dirty: boolean;
  /** Monotonic counter for persistent edits, used to debounce saves. */
  editVersion: number;
  saveStatus: SaveStatus;
  saveErrors: Diagnostic[];
  /** Close, switch or create waiting for a successful save. */
  pendingAction: PendingAction | null;
}

export const initialEditorState: EditorState = {
  document: null,
  filePath: null,
  sourcePath: null,
  diagnostics: [],
  diagnosticsTitle: '无法打开设计稿',
  warnings: [],
  selectionId: null,
  dirty: false,
  editVersion: 0,
  saveStatus: 'idle',
  saveErrors: [],
  pendingAction: null,
};

/**
 * Applies a fresh document to the editor. Opening always starts from an empty
 * selection and a clean save baseline.
 */
function withDocument(
  state: EditorState,
  document: DesignDocument,
  overrides: Partial<EditorState>,
): EditorState {
  return {
    ...state,
    document,
    sourcePath: null,
    diagnostics: [],
    warnings: [],
    selectionId: null,
    dirty: false,
    editVersion: 0,
    saveStatus: 'idle',
    saveErrors: [],
    pendingAction: null,
    ...overrides,
  };
}

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
      return {
        ...state,
        diagnostics: result.errors,
        diagnosticsTitle: '无法打开设计稿',
      };
    case 'imported':
      return withDocument(state, result.document, {
        filePath: null,
        sourcePath: result.sourcePath,
        warnings: result.warnings,
      });
    case 'opened':
      return withDocument(state, result.document, {
        filePath: result.filePath,
        sourcePath: null,
      });
  }
}

export function applyCreateResult(
  state: EditorState,
  result: CreateDesignFileResult,
): EditorState {
  if (result.status === 'failed') {
    return {
      ...state,
      diagnostics: result.errors,
      diagnosticsTitle: '无法新建设计稿',
      pendingAction: null,
    };
  }
  return withDocument(state, result.document, {
    filePath: result.filePath,
    sourcePath: null,
  });
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
    diagnosticsTitle: '无法打开设计稿',
  };
}

export function applyCreateError(
  state: EditorState,
  error: unknown,
): EditorState {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...state,
    diagnostics: [
      createDiagnostic(DesktopDiagnosticCodes.fileWriteError, '$', message),
    ],
    diagnosticsTitle: '无法新建设计稿',
    pendingAction: null,
  };
}

/** Records one persistent document edit; the selection may change separately. */
export function editDocument(
  state: EditorState,
  document: DesignDocument,
  selectionId: string | null = state.selectionId,
): EditorState {
  return {
    ...state,
    document,
    selectionId,
    dirty: true,
    editVersion: state.editVersion + 1,
    saveStatus: state.saveStatus === 'idle' ? 'idle' : state.saveStatus,
  };
}

export function selectElement(
  state: EditorState,
  selectionId: string | null,
): EditorState {
  return { ...state, selectionId };
}

export function markSaving(state: EditorState): EditorState {
  return { ...state, saveStatus: 'saving', saveErrors: [] };
}

/**
 * Applies a successful write. `savedVersion` is the edit version captured when
 * the snapshot was taken; edits made during the write leave the document dirty.
 */
export function applySaveResult(
  state: EditorState,
  result: Extract<SaveDesignFileResult, { status: 'saved' | 'skipped' }>,
  savedVersion: number,
): EditorState {
  if (state.document === null) {
    return state;
  }

  const document: DesignDocument =
    state.document.filePath === result.filePath
      ? state.document
      : { ...state.document, filePath: result.filePath };

  return {
    ...state,
    document,
    filePath: result.filePath,
    dirty: state.editVersion === savedVersion ? false : state.dirty,
    saveStatus: 'idle',
    saveErrors: [],
  };
}

export function applySaveFailure(
  state: EditorState,
  errors: Diagnostic[],
): EditorState {
  return { ...state, saveStatus: 'error', saveErrors: errors };
}

export function setPendingAction(
  state: EditorState,
  pendingAction: PendingAction | null,
): EditorState {
  return { ...state, pendingAction };
}

export function documentName(filePath: string | null): string {
  if (filePath === null) {
    return '尚未打开设计稿';
  }
  const segments = filePath.split(/[\\/]/).filter((segment) => segment !== '');
  return segments.at(-1) ?? filePath;
}
