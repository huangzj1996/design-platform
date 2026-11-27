import {
  validateDesignDocument,
  type DesignDocument,
  type DesignElement,
  type Diagnostic,
} from '@design-ai/design-schema';

type FrameElement = Extract<DesignElement, { type: 'frame' }>;

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
  | { type: 'replace-document'; document: DesignDocument };

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
  elementById(
    snapshot: EditorSnapshot,
    id: string,
  ): DesignElement | undefined;
  selectedElement(snapshot: EditorSnapshot): DesignElement | undefined;
  selectedElements(snapshot: EditorSnapshot): DesignElement[];
  parentOf(
    snapshot: EditorSnapshot,
    id: string,
  ): FrameElement | undefined;
  elementsByName(snapshot: EditorSnapshot, name: string): DesignElement[];
}

export interface EditorSession {
  /** Applies one command and returns its result synchronously. */
  dispatch(command: EditorCommand): EditorCommandResult;
  /** The current snapshot; unchanged state returns the same object. */
  getSnapshot(): EditorSnapshot;
  /** Listens for published snapshots and returns an unsubscribe function. */
  subscribe(listener: (snapshot: EditorSnapshot) => void): () => void;
  readonly selectors: EditorSelectors;
}

function childElements(element: DesignElement): DesignElement[] {
  return element.type === 'frame' ? (element.children ?? []) : [];
}

function findElement(
  elements: readonly DesignElement[],
  id: string,
): DesignElement | undefined {
  const pending = [...elements];
  while (pending.length > 0) {
    const element = pending.pop();
    if (element === undefined) {
      continue;
    }
    if (element.id === id) {
      return element;
    }
    const children = childElements(element);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      pending.push(children[index]);
    }
  }
  return undefined;
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

function sameIds(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((id, index) => id === right[index])
  );
}

function createSelectors(): EditorSelectors {
  return {
    elementById(snapshot, id) {
      return findElement(snapshot.document.children, id);
    },

    selectedElement(snapshot) {
      if (snapshot.selectedElementIds.length !== 1) {
        return undefined;
      }
      const [id] = snapshot.selectedElementIds;
      return id === undefined
        ? undefined
        : findElement(snapshot.document.children, id);
    },

    selectedElements(snapshot) {
      return snapshot.selectedElementIds.flatMap((id) => {
        const element = findElement(snapshot.document.children, id);
        return element === undefined ? [] : [element];
      });
    },

    parentOf(snapshot, id) {
      const visit = (
        elements: readonly DesignElement[],
      ): FrameElement | undefined => {
        for (const element of elements) {
          if (element.type !== 'frame') {
            continue;
          }
          const children = element.children ?? [];
          if (children.some((child) => child.id === id)) {
            return element;
          }
          const nested = visit(children);
          if (nested !== undefined) {
            return nested;
          }
        }
        return undefined;
      };
      return visit(snapshot.document.children);
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

  function publish(next: EditorSnapshot): EditorCommandResult {
    snapshot = next;
    for (const listener of [...listeners]) {
      listener(next);
    }
    return { ok: true, snapshot: next, diagnostics: [], changed: true };
  }

  function unchanged(): EditorCommandResult {
    return { ok: false, snapshot, diagnostics: [], changed: false };
  }

  function select(elementIds: readonly string[]): EditorCommandResult {
    const selected = normalizeSelection(elementIds, snapshot.document);
    if (sameIds(selected, snapshot.selectedElementIds)) {
      return { ...unchanged(), ok: true };
    }
    return publish({ ...snapshot, selectedElementIds: selected });
  }

  function setInspectorExpanded(expanded: boolean): EditorCommandResult {
    if (snapshot.inspectorExpanded === expanded) {
      return { ...unchanged(), ok: true };
    }
    return publish({ ...snapshot, inspectorExpanded: expanded });
  }

  function replaceDocument(document: DesignDocument): EditorCommandResult {
    if (document === snapshot.document) {
      return { ...unchanged(), ok: true };
    }
    const validation = validateDesignDocument(document);
    if (!validation.ok) {
      return { ok: false, snapshot, diagnostics: validation.errors, changed: false };
    }
    const selectedElementIds = normalizeSelection(
      snapshot.selectedElementIds,
      validation.document,
    );
    return publish({
      ...snapshot,
      document: validation.document,
      selectedElementIds,
    });
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

    selectors,
  };
}
