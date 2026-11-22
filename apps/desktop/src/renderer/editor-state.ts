import {
  createDiagnostic,
  type DesignDocument,
  type Diagnostic,
} from '@design-ai/design-schema';
import { errorMessage } from '../shared/error-message';
import {
  DesktopDiagnosticCodes,
  type CreateDesignFileResult,
  type OpenDesignFileResult,
  type SaveDesignFileResult,
} from '../shared/open-design-file';

export type PendingAction = 'open' | 'create' | 'close';

export type SaveStatus = 'idle' | 'saving' | 'error';

const OPEN_FAILURE_TITLE = '无法打开设计稿';
const CREATE_FAILURE_TITLE = '无法新建设计稿';

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
  diagnosticsTitle: OPEN_FAILURE_TITLE,
  warnings: [],
  selectionId: null,
  dirty: false,
  editVersion: 0,
  saveStatus: 'idle',
  saveErrors: [],
  pendingAction: null,
};

/** Keeps the document snapshot's path in sync with its actual save target. */
function withDocumentPath(
  document: DesignDocument,
  filePath: string,
): DesignDocument {
  if (document.filePath === filePath) {
    return document;
  }
  return { ...document, filePath };
}

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
        diagnosticsTitle: OPEN_FAILURE_TITLE,
      };
    case 'imported':
      return withDocument(state, result.document, {
        filePath: null,
        sourcePath: result.sourcePath,
        warnings: result.warnings,
      });
    case 'opened':
      // The selected file is the save target, so a moved document records its
      // actual absolute path in the next snapshot.
      return withDocument(
        state,
        withDocumentPath(result.document, result.filePath),
        { filePath: result.filePath },
      );
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
      diagnosticsTitle: CREATE_FAILURE_TITLE,
      pendingAction: null,
    };
  }
  return withDocument(state, result.document, {
    filePath: result.filePath,
  });
}

export function applyOpenError(
  state: EditorState,
  error: unknown,
): EditorState {
  return {
    ...state,
    diagnostics: [
      createDiagnostic(
        DesktopDiagnosticCodes.openFailed,
        '$',
        errorMessage(error),
      ),
    ],
    diagnosticsTitle: OPEN_FAILURE_TITLE,
  };
}

export function applyCreateError(
  state: EditorState,
  error: unknown,
): EditorState {
  return {
    ...state,
    diagnostics: [
      createDiagnostic(
        DesktopDiagnosticCodes.fileWriteError,
        '$',
        errorMessage(error),
      ),
    ],
    diagnosticsTitle: CREATE_FAILURE_TITLE,
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

  return {
    ...state,
    document: withDocumentPath(state.document, result.filePath),
    filePath: result.filePath,
    dirty: state.dirty && state.editVersion !== savedVersion,
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
