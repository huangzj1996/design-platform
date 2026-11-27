import {
  createDiagnostic,
  DiagnosticCodes,
  validateDesignDocument,
  type DesignDocument,
  type DesignElement,
  type Diagnostic,
} from '@design-ai/design-schema';
import { findElementParent } from '../document/alignment';
import { deleteElement, findElement } from '../document/edit';
import { moveElement, type ElementPosition } from '../document/move';

type FrameElement = Extract<DesignElement, { type: 'frame' }>;

/** How many design document snapshots one session keeps for undo. */
export const EDIT_HISTORY_LIMIT = 100;

/** Immutable state read by the canvas, layer tree and inspector. */
export interface EditorSnapshot {
  readonly document: DesignDocument;
  /** Selected element ids in selection order, without duplicates. */
  readonly selectedElementIds: readonly string[];
  readonly inspectorExpanded: boolean;
}

/** One atomic session change, expressed as data. */
export type EditorCommand =
  | { type: 'select'; elementIds: readonly string[] }
  | { type: 'set-inspector-expanded'; expanded: boolean }
  | { type: 'replace-document'; document: DesignDocument }
  | {
      type: 'move-element';
      elementId: string;
      /** Design declaration coordinates, relative to the parent content box. */
      position: Partial<ElementPosition>;
    }
  | { type: 'delete-element'; elementId: string }
  | {
      /** Records the save target without adding a design history step. */
      type: 'set-document-path';
      filePath: string;
    }
  | { type: 'undo' }
  | { type: 'redo' };

export interface EditorCommandResult {
  /** False when the command was invalid; the snapshot is then unchanged. */
  ok: boolean;
  /** The published snapshot, equal to the previous one for no-op commands. */
  snapshot: EditorSnapshot;
  /** Validation failures for an invalid document command. */
  diagnostics: Diagnostic[];
  /** Whether this command published a new snapshot. */
  changed: boolean;
}

export interface EditorSelectors {
  elementById(snapshot: EditorSnapshot, id: string): DesignElement | undefined;
  selectedElement(snapshot: EditorSnapshot): DesignElement | undefined;
  selectedElements(snapshot: EditorSnapshot): DesignElement[];
  parentOf(snapshot: EditorSnapshot, id: string): FrameElement | undefined;
  elementsByName(snapshot: EditorSnapshot, name: string): DesignElement[];
}

export interface EditorSession {
  /** Applies one command and returns its result synchronously. */
  dispatch(command: EditorCommand): EditorCommandResult;
  /** The current snapshot; unchanged state returns the same object. */
  getSnapshot(): EditorSnapshot;
  /** Listens for published snapshots and returns an unsubscribe function. */
  subscribe(listener: (snapshot: EditorSnapshot) => void): () => void;
  /** Whether an earlier design document snapshot can be restored. */
  canUndo(): boolean;
  /** Whether an undone design document snapshot can be restored again. */
  canRedo(): boolean;
  readonly selectors: EditorSelectors;
}

function childElements(element: DesignElement): DesignElement[] {
  return element.type === 'frame' ? (element.children ?? []) : [];
}

function existingIds(document: DesignDocument): Set<string> {
  const ids = new Set<string>();
  const pending = [...document.children];
  while (pending.length > 0) {
    const element = pending.pop();
    if (element === undefined) {
      continue;
    }
    ids.add(element.id);
    pending.push(...childElements(element));
  }
  return ids;
}

/** Deduplicates ids in first-seen order, keeping only existing elements. */
function normalizeSelection(
  ids: readonly string[],
  document: DesignDocument,
): string[] {
  const available = existingIds(document);
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const id of ids) {
    if (!seen.has(id) && available.has(id)) {
      seen.add(id);
      selected.push(id);
    }
  }
  return selected;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

function createSelectors(): EditorSelectors {
  return {
    elementById(snapshot, id) {
      return findElement(snapshot.document, id);
    },

    selectedElement(snapshot) {
      if (snapshot.selectedElementIds.length !== 1) {
        return undefined;
      }
      const [id] = snapshot.selectedElementIds;
      return id === undefined ? undefined : findElement(snapshot.document, id);
    },

    selectedElements(snapshot) {
      return snapshot.selectedElementIds.flatMap((id) => {
        const element = findElement(snapshot.document, id);
        return element === undefined ? [] : [element];
      });
    },

    parentOf(snapshot, id) {
      return findElementParent(snapshot.document, id) ?? undefined;
    },

    elementsByName(snapshot, name) {
      const matches: DesignElement[] = [];
      const visit = (elements: readonly DesignElement[]): void => {
        for (const element of elements) {
          if (element.name === name) {
            matches.push(element);
          }
          visit(childElements(element));
        }
      };
      visit(snapshot.document.children);
      return matches;
    },
  };
}

/**
 * Creates an independent editor session around one design document. The
 * session owns the immutable snapshot; views commit changes only through
 * `dispatch` and read the result as one snapshot.
 */
export function createEditorSession(document: DesignDocument): EditorSession {
  let snapshot: EditorSnapshot = {
    document,
    selectedElementIds: [],
    inspectorExpanded: true,
  };
  const listeners = new Set<(snapshot: EditorSnapshot) => void>();
  const selectors = createSelectors();
  /** Documents before each committed edit, oldest first, bounded. */
  let undoStack: DesignDocument[] = [];
  /** Documents superseded by undo, most recently undone last. */
  let redoStack: DesignDocument[] = [];

  function publish(next: EditorSnapshot): EditorCommandResult {
    snapshot = next;
    for (const listener of [...listeners]) {
      listener(next);
    }
    return { ok: true, snapshot: next, diagnostics: [], changed: true };
  }

  /** A valid command that leaves the current snapshot in place. */
  function noChange(): EditorCommandResult {
    return { ok: true, snapshot, diagnostics: [], changed: false };
  }

  /** An invalid command that leaves the current snapshot in place. */
  function invalid(diagnostics: Diagnostic[]): EditorCommandResult {
    return { ok: false, snapshot, diagnostics, changed: false };
  }

  function select(elementIds: readonly string[]): EditorCommandResult {
    const selected = normalizeSelection(elementIds, snapshot.document);
    if (sameIds(selected, snapshot.selectedElementIds)) {
      return noChange();
    }
    return publish({ ...snapshot, selectedElementIds: selected });
  }

  function setInspectorExpanded(expanded: boolean): EditorCommandResult {
    if (snapshot.inspectorExpanded === expanded) {
      return noChange();
    }
    return publish({ ...snapshot, inspectorExpanded: expanded });
  }

  /** Adds one snapshot to the bounded undo stack. */
  function pushUndo(document: DesignDocument): void {
    undoStack.push(document);
    if (undoStack.length > EDIT_HISTORY_LIMIT) {
      undoStack.shift();
    }
  }

  /** Records the document before a committed edit and invalidates redo. */
  function recordEdit(): void {
    pushUndo(snapshot.document);
    redoStack.length = 0;
  }

  /** Publishes an edited or restored document, keeping valid selections. */
  function publishDocument(document: DesignDocument): EditorCommandResult {
    const selectedElementIds = normalizeSelection(
      snapshot.selectedElementIds,
      document,
    );
    return publish({ ...snapshot, document, selectedElementIds });
  }

  /**
   * Validates one edited document, then records and publishes it as a single
   * history step. Invalid documents leave the snapshot and history unchanged.
   */
  function commitDocument(document: DesignDocument): EditorCommandResult {
    const validation = validateDesignDocument(document);
    if (!validation.ok) {
      return invalid(validation.errors);
    }
    recordEdit();
    return publishDocument(validation.document);
  }

  /** An invalid result for a command whose target element is missing. */
  function elementNotFound(
    elementId: string,
    action: string,
  ): EditorCommandResult {
    return invalid([
      createDiagnostic(
        DiagnosticCodes.elementNotFound,
        '$',
        `找不到要${action}的元素 "${elementId}"`,
      ),
    ]);
  }

  function replaceDocument(document: DesignDocument): EditorCommandResult {
    if (document === snapshot.document) {
      return noChange();
    }
    return commitDocument(document);
  }

  function moveElementCommand(command: {
    elementId: string;
    position: Partial<ElementPosition>;
  }): EditorCommandResult {
    if (findElement(snapshot.document, command.elementId) === undefined) {
      return elementNotFound(command.elementId, '移动');
    }
    const document = moveElement(
      snapshot.document,
      command.elementId,
      command.position,
    );
    if (document === snapshot.document) {
      return noChange();
    }
    return commitDocument(document);
  }

  function deleteElementCommand(elementId: string): EditorCommandResult {
    if (findElement(snapshot.document, elementId) === undefined) {
      return elementNotFound(elementId, '删除');
    }
    return commitDocument(deleteElement(snapshot.document, elementId));
  }

  function setDocumentPath(filePath: string): EditorCommandResult {
    if (snapshot.document.filePath === filePath) {
      return noChange();
    }
    // The save target belongs to every version of the document, so restored
    // snapshots keep pointing at it without becoming history steps.
    const withPath = (document: DesignDocument): DesignDocument =>
      document.filePath === filePath ? document : { ...document, filePath };
    undoStack = undoStack.map(withPath);
    redoStack = redoStack.map(withPath);
    return publish({ ...snapshot, document: withPath(snapshot.document) });
  }

  function undoCommand(): EditorCommandResult {
    const document = undoStack.pop();
    if (document === undefined) {
      return noChange();
    }
    redoStack.push(snapshot.document);
    return publishDocument(document);
  }

  function redoCommand(): EditorCommandResult {
    const document = redoStack.pop();
    if (document === undefined) {
      return noChange();
    }
    pushUndo(snapshot.document);
    return publishDocument(document);
  }

  return {
    dispatch(command) {
      switch (command.type) {
        case 'select':
          return select(command.elementIds);
        case 'set-inspector-expanded':
          return setInspectorExpanded(command.expanded);
        case 'replace-document':
          return replaceDocument(command.document);
        case 'move-element':
          return moveElementCommand(command);
        case 'delete-element':
          return deleteElementCommand(command.elementId);
        case 'set-document-path':
          return setDocumentPath(command.filePath);
        case 'undo':
          return undoCommand();
        case 'redo':
          return redoCommand();
      }
    },

    getSnapshot() {
      return snapshot;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    canUndo() {
      return undoStack.length > 0;
    },

    canRedo() {
      return redoStack.length > 0;
    },

    selectors,
  };
}
