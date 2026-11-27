import {
  createDiagnostic,
  type DesignDocument,
  type Diagnostic,
} from '@design-ai/design-schema';
import {
  createEditorSession,
  type EditorCommand,
  type EditorSession,
  type EditorSnapshot,
  type ElementPosition,
} from '@design-ai/editor-core';
import { errorMessage } from './error-message';
import type {
  CreateDesignFileResult,
  DesktopDiagnosticCode,
  OpenDesignFileResult,
  SaveDesignFileResult,
} from '../electron-preload/contract';

/** Diagnostic codes for failures detected in the renderer. */
const OPEN_FAILED_CODE: DesktopDiagnosticCode = 'open_failed';
const FILE_WRITE_ERROR_CODE: DesktopDiagnosticCode = 'file_write_error';

export type PendingAction =
  | { type: 'open' }
  | { type: 'create' }
  | { type: 'close' }
  | { type: 'home' }
  | { type: 'project'; projectId: string };

export type SaveStatus = 'idle' | 'saving' | 'error';

export const OPEN_FAILURE_TITLE = '无法打开设计稿';
export const CREATE_FAILURE_TITLE = '无法新建设计稿';
export const MOVE_FAILURE_TITLE = '无法移动元素';
export const DELETE_FAILURE_TITLE = '无法删除元素';
export const HISTORY_FAILURE_TITLE = '无法撤销或重做';

export interface EditorState {
  /** Session owning this tab's document, selection and inspector state. */
  session: EditorSession | null;
  /** Latest published session snapshot, mirrored into React state. */
  snapshot: EditorSnapshot | null;
  /** Save target of a native document; `null` for an unsaved import. */
  filePath: string | null;
  /** Pencil source of an imported draft, shown until the draft is saved. */
  sourcePath: string | null;
  diagnostics: Diagnostic[];
  diagnosticsTitle: string;
  warnings: Diagnostic[];
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
  session: null,
  snapshot: null,
  filePath: null,
  sourcePath: null,
  diagnostics: [],
  diagnosticsTitle: OPEN_FAILURE_TITLE,
  warnings: [],
  dirty: false,
  editVersion: 0,
  saveStatus: 'idle',
  saveErrors: [],
  pendingAction: null,
};

/** The document currently shown by a tab, sourced from its session. */
export function documentOf(state: EditorState): DesignDocument | null {
  return state.snapshot?.document ?? null;
}

/** The first selected element id, used by the single-selection editor UI. */
export function selectionIdOf(state: EditorState): string | null {
  return state.snapshot?.selectedElementIds[0] ?? null;
}

/** The inspector expansion stored by the tab's session snapshot. */
export function inspectorExpandedOf(state: EditorState): boolean {
  return state.snapshot?.inspectorExpanded ?? true;
}

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
 * Applies a fresh document to the editor and creates its session. Opening
 * always starts from an empty selection and a clean save baseline.
 */
function withDocument(
  state: EditorState,
  document: DesignDocument,
  overrides: Partial<EditorState>,
): EditorState {
  const session = createEditorSession(document);
  return {
    ...state,
    session,
    snapshot: session.getSnapshot(),
    sourcePath: null,
    diagnostics: [],
    warnings: [],
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
    case 'opened': {
      // The selected file is the save target, so record its path in the
      // snapshot; a moved file may still carry its previous path.
      const document = withDocumentPath(result.document, result.filePath);
      return withDocument(state, document, { filePath: result.filePath });
    }
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
    diagnostics: [createDiagnostic(OPEN_FAILED_CODE, '$', errorMessage(error))],
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
      createDiagnostic(FILE_WRITE_ERROR_CODE, '$', errorMessage(error)),
    ],
    diagnosticsTitle: CREATE_FAILURE_TITLE,
    pendingAction: null,
  };
}

/**
 * Records one persistent document edit through the session. An invalid
 * document keeps the previous snapshot and the save baseline unchanged.
 */
export function editDocument(
  state: EditorState,
  document: DesignDocument,
  selectionId: string | null = selectionIdOf(state),
): EditorState {
  if (state.session === null) {
    return state;
  }
  const replaced = state.session.dispatch({
    type: 'replace-document',
    document,
  });
  if (!replaced.ok) {
    return state;
  }
  const selected = state.session.dispatch({
    type: 'select',
    elementIds: selectionId === null ? [] : [selectionId],
  });
  return {
    ...state,
    snapshot: selected.snapshot,
    dirty: true,
    editVersion: state.editVersion + 1,
  };
}

/**
 * Applies one document-changing command through the session. Invalid commands
 * keep the last valid snapshot and its history; unchanged commands do not
 * touch the save baseline.
 */
function applyDocumentCommand(
  state: EditorState,
  command: EditorCommand,
  failureTitle: string,
): EditorState {
  if (state.session === null) {
    return state;
  }
  const result = state.session.dispatch(command);
  if (!result.ok) {
    return {
      ...state,
      diagnostics: result.diagnostics,
      diagnosticsTitle: failureTitle,
    };
  }
  if (!result.changed) {
    return state;
  }
  return {
    ...state,
    snapshot: result.snapshot,
    diagnostics: [],
    dirty: true,
    editVersion: state.editVersion + 1,
  };
}

/**
 * Commits one drag landing through the session. Invalid coordinates keep the
 * last valid snapshot and surface the command diagnostics.
 */
export function moveElementInState(
  state: EditorState,
  elementId: string,
  position: Partial<ElementPosition>,
): EditorState {
  return applyDocumentCommand(
    state,
    { type: 'move-element', elementId, position },
    MOVE_FAILURE_TITLE,
  );
}

/** Deletes one element as a single undo step, dropping it from the selection. */
export function deleteElementInState(
  state: EditorState,
  elementId: string,
): EditorState {
  return applyDocumentCommand(
    state,
    { type: 'delete-element', elementId },
    DELETE_FAILURE_TITLE,
  );
}

/** Restores the design document before the last committed edit. */
export function undoInState(state: EditorState): EditorState {
  return applyDocumentCommand(state, { type: 'undo' }, HISTORY_FAILURE_TITLE);
}

/** Reapplies the design document restored by the last undo. */
export function redoInState(state: EditorState): EditorState {
  return applyDocumentCommand(state, { type: 'redo' }, HISTORY_FAILURE_TITLE);
}

/** Commands that only change view state, never the design document. */
type ViewCommand = Extract<
  EditorCommand,
  { type: 'select' | 'set-inspector-expanded' }
>;

/**
 * Applies a view-only command through the session. The design document and
 * the save baseline stay exactly as they were.
 */
function applyViewCommand(
  state: EditorState,
  command: ViewCommand,
): EditorState {
  if (state.session === null) {
    return state;
  }
  const result = state.session.dispatch(command);
  return result.changed ? { ...state, snapshot: result.snapshot } : state;
}

export function selectElement(
  state: EditorState,
  selectionId: string | null,
): EditorState {
  return applyViewCommand(state, {
    type: 'select',
    elementIds: selectionId === null ? [] : [selectionId],
  });
}

/** Toggles the inspector expansion stored by the tab's session snapshot. */
export function toggleInspectorExpanded(state: EditorState): EditorState {
  return applyViewCommand(state, {
    type: 'set-inspector-expanded',
    expanded: !inspectorExpandedOf(state),
  });
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
  if (state.session === null || state.snapshot === null) {
    return state;
  }

  // The saved snapshot records its own path so reopening keeps the target.
  // Recording it is not a design edit, so it leaves undo and redo intact.
  const saved = state.session.dispatch({
    type: 'set-document-path',
    filePath: result.filePath,
  });
  if (!saved.ok) {
    return state;
  }

  return {
    ...state,
    snapshot: saved.snapshot,
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
