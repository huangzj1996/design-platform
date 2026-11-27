import { validateDesignDocument } from '@design-ai/design-schema';
import { describe, expect, it, vi } from 'vitest';
import {
  createEditorSession,
  EDIT_HISTORY_LIMIT,
  type EditorSession,
  type EditorSnapshot,
} from '../src/session/editor-session';

function documentFrom(input: unknown) {
  const result = validateDesignDocument(input);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.document;
}

const document = documentFrom({
  version: 2,
  children: [
    {
      id: 'frame',
      type: 'frame',
      name: '画板',
      layout: 'none',
      width: 400,
      height: 300,
      children: [
        {
          id: 'rectangle',
          type: 'rectangle',
          name: '矩形',
          width: 80,
          height: 40,
        },
        {
          id: 'nested',
          type: 'frame',
          name: '卡片',
          width: 120,
          height: 80,
          children: [],
        },
      ],
    },
    { id: 'title', type: 'text', name: '标题', textStyle: { content: '标题' } },
  ],
});

const boundDocument = documentFrom({
  version: 2,
  variables: {
    'chip-x': { type: 'number', value: 12 },
    'chip-y': { type: 'number', value: 18 },
  },
  children: [
    {
      id: 'board',
      type: 'frame',
      layout: 'none',
      width: 400,
      height: 300,
      children: [
        {
          id: 'chip',
          type: 'rectangle',
          x: '$chip-x',
          y: '$chip-y',
          width: 80,
          height: 40,
        },
        { id: 'sibling', type: 'rectangle', width: 20, height: 20 },
      ],
    },
  ],
});

describe('createEditorSession', () => {
  it('starts with the document, no selection and the inspector expanded', () => {
    const session = createEditorSession(document);

    const snapshot = session.getSnapshot();
    expect(snapshot.document).toBe(document);
    expect(snapshot.selectedElementIds).toEqual([]);
    expect(snapshot.inspectorExpanded).toBe(true);
    expect(session.getSnapshot()).toBe(snapshot);
  });

  it('publishes one snapshot for a valid selection change', () => {
    const session = createEditorSession(document);
    const listener = vi.fn();
    session.subscribe(listener);

    const result = session.dispatch({
      type: 'select',
      elementIds: ['rectangle', 'title'],
    });

    expect(result.ok).toBe(true);
    expect(result.snapshot.selectedElementIds).toEqual(['rectangle', 'title']);
    expect(result.snapshot.document).toBe(document);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(result.snapshot);
    expect(session.getSnapshot()).toBe(result.snapshot);
  });

  it('deduplicates ids, keeps their order and drops unknown ids', () => {
    const session = createEditorSession(document);

    const result = session.dispatch({
      type: 'select',
      elementIds: ['title', 'missing', 'rectangle', 'title'],
    });

    expect(result.snapshot.selectedElementIds).toEqual(['title', 'rectangle']);
  });

  it('keeps the current snapshot when the selection is unchanged', () => {
    const session = createEditorSession(document);
    const first = session.dispatch({
      type: 'select',
      elementIds: ['rectangle', 'title'],
    }).snapshot;
    const listener = vi.fn();
    session.subscribe(listener);

    const same = session.dispatch({
      type: 'select',
      elementIds: ['rectangle', 'title', 'title'],
    });

    expect(same.snapshot).toBe(first);
    expect(session.getSnapshot()).toBe(first);
    expect(listener).not.toHaveBeenCalled();
  });

  it('replaces the document and keeps only selections that still exist', () => {
    const session = createEditorSession(document);
    session.dispatch({ type: 'select', elementIds: ['rectangle', 'title'] });
    const next = documentFrom({
      version: 2,
      children: [
        {
          id: 'frame',
          type: 'frame',
          width: 400,
          height: 300,
          children: [
            { id: 'title', type: 'text', textStyle: { content: '新标题' } },
          ],
        },
      ],
    });

    const result = session.dispatch({
      type: 'replace-document',
      document: next,
    });

    expect(result.ok).toBe(true);
    expect(result.snapshot.document).toEqual(next);
    expect(result.snapshot.selectedElementIds).toEqual(['title']);
  });

  it('returns diagnostics and keeps the snapshot for an invalid document', () => {
    const session = createEditorSession(document);
    const before = session.getSnapshot();
    const listener = vi.fn();
    session.subscribe(listener);

    const result = session.dispatch({
      type: 'replace-document',
      document: { version: 1, children: [], variables: {} } as never,
    });

    expect(result.ok).toBe(false);
    expect(result.snapshot).toBe(before);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0]?.code).toBe('unsupported_version');
    expect(listener).not.toHaveBeenCalled();
  });

  it('publishes inspector expansion changes once and preserves the document', () => {
    const session = createEditorSession(document);
    const listener = vi.fn();
    session.subscribe(listener);

    const collapsed = session.dispatch({
      type: 'set-inspector-expanded',
      expanded: false,
    });
    expect(collapsed.snapshot.inspectorExpanded).toBe(false);
    expect(collapsed.snapshot.document).toBe(document);
    expect(listener).toHaveBeenCalledTimes(1);

    const unchanged = session.dispatch({
      type: 'set-inspector-expanded',
      expanded: false,
    });
    expect(unchanged.snapshot).toBe(collapsed.snapshot);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const session = createEditorSession(document);
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);

    unsubscribe();
    session.dispatch({ type: 'select', elementIds: ['title'] });

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps selection and inspector state isolated per session', () => {
    const other = documentFrom({
      version: 2,
      children: [
        {
          id: 'other',
          type: 'rectangle',
          name: '另一份',
          width: 10,
          height: 10,
        },
      ],
    });
    const first = createEditorSession(document);
    const second = createEditorSession(other);

    first.dispatch({ type: 'select', elementIds: ['rectangle', 'title'] });
    first.dispatch({ type: 'set-inspector-expanded', expanded: false });
    second.dispatch({ type: 'select', elementIds: ['other'] });

    expect(first.getSnapshot().selectedElementIds).toEqual([
      'rectangle',
      'title',
    ]);
    expect(first.getSnapshot().inspectorExpanded).toBe(false);
    expect(second.getSnapshot().selectedElementIds).toEqual(['other']);
    expect(second.getSnapshot().inspectorExpanded).toBe(true);
    // View commands keep each design document exactly as it was.
    expect(first.getSnapshot().document).toBe(document);
    expect(second.getSnapshot().document).toBe(other);
  });
});

describe('session.selectors', () => {
  it('finds elements by id and resolves the direct parent', () => {
    const session = createEditorSession(document);
    const snapshot = session.getSnapshot();

    expect(session.selectors.elementById(snapshot, 'nested')?.type).toBe(
      'frame',
    );
    expect(session.selectors.elementById(snapshot, 'missing')).toBeUndefined();
    expect(session.selectors.parentOf(snapshot, 'rectangle')?.id).toBe('frame');
    expect(session.selectors.parentOf(snapshot, 'frame')).toBeUndefined();
    expect(session.selectors.parentOf(snapshot, 'missing')).toBeUndefined();
  });

  it('returns the single selected element only for exactly one selection', () => {
    const session = createEditorSession(document);
    const none = session.getSnapshot();
    expect(session.selectors.selectedElement(none)).toBeUndefined();
    expect(session.selectors.selectedElements(none)).toEqual([]);

    const one = session.dispatch({
      type: 'select',
      elementIds: ['title'],
    }).snapshot;
    expect(session.selectors.selectedElement(one)?.id).toBe('title');

    const many = session.dispatch({
      type: 'select',
      elementIds: ['rectangle', 'title'],
    }).snapshot;
    expect(session.selectors.selectedElement(many)).toBeUndefined();
    expect(
      session.selectors.selectedElements(many).map((element) => element.id),
    ).toEqual(['rectangle', 'title']);
  });

  it('returns every element with an exact name in tree order', () => {
    const named = documentFrom({
      version: 2,
      children: [
        { id: 'a', type: 'rectangle', name: '同名', width: 10, height: 10 },
        {
          id: 'group',
          type: 'frame',
          width: 100,
          height: 100,
          children: [
            { id: 'b', type: 'rectangle', name: '同名', width: 10, height: 10 },
            { id: 'c', type: 'rectangle', name: '别的', width: 10, height: 10 },
          ],
        },
      ],
    });
    const namedSession = createEditorSession(named);

    expect(
      namedSession.selectors
        .elementsByName(namedSession.getSnapshot(), '同名')
        .map((element) => element.id),
    ).toEqual(['a', 'b']);
  });

  it('answers every query from the snapshot passed in, including an earlier one', () => {
    const session = createEditorSession(document);
    const before = session.getSnapshot();
    const selected = session.dispatch({
      type: 'select',
      elementIds: ['rectangle'],
    }).snapshot;
    const next = documentFrom({
      version: 2,
      children: [
        {
          id: 'frame',
          type: 'frame',
          layout: 'none',
          width: 400,
          height: 300,
          children: [
            {
              id: 'replacement',
              type: 'rectangle',
              name: '替换',
              width: 10,
              height: 10,
            },
          ],
        },
      ],
    });
    const after = session.dispatch({
      type: 'replace-document',
      document: next,
    }).snapshot;

    // The earlier snapshot keeps its own elements and tree relationships even
    // after the session has moved on.
    expect(session.selectors.elementById(before, 'rectangle')?.name).toBe(
      '矩形',
    );
    expect(session.selectors.elementById(after, 'rectangle')).toBeUndefined();
    expect(session.selectors.parentOf(before, 'rectangle')?.id).toBe('frame');
    expect(session.selectors.parentOf(after, 'rectangle')).toBeUndefined();
    expect(
      session.selectors
        .elementsByName(before, '矩形')
        .map((element) => element.id),
    ).toEqual(['rectangle']);
    expect(session.selectors.elementsByName(after, '矩形')).toEqual([]);
    expect(session.selectors.selectedElement(selected)?.id).toBe('rectangle');
    expect(session.selectors.selectedElement(before)).toBeUndefined();
    expect(session.selectors.selectedElements(after)).toEqual([]);
  });
});

describe('session history', () => {
  function childrenOf(
    session: EditorSession,
    snapshot: EditorSnapshot,
    id: string,
  ) {
    const element = session.selectors.elementById(snapshot, id);
    return element?.type === 'frame' ? (element.children ?? []) : [];
  }

  it('undoes and redoes one move with its declaration and variable binding', () => {
    const session = createEditorSession(boundDocument);
    session.dispatch({ type: 'select', elementIds: ['chip'] });

    const moved = session.dispatch({
      type: 'move-element',
      elementId: 'chip',
      position: { x: 40 },
    });
    expect(session.selectors.elementById(moved.snapshot, 'chip')).toMatchObject(
      { x: 40, y: '$chip-y' },
    );
    expect(session.canUndo()).toBe(true);
    expect(session.canRedo()).toBe(false);

    const undone = session.dispatch({ type: 'undo' });
    expect(undone.ok).toBe(true);
    expect(undone.changed).toBe(true);
    expect(undone.snapshot.document).toBe(boundDocument);
    expect(
      session.selectors.elementById(undone.snapshot, 'chip'),
    ).toMatchObject({ x: '$chip-x', y: '$chip-y' });
    expect(undone.snapshot.selectedElementIds).toEqual(['chip']);
    expect(session.canUndo()).toBe(false);
    expect(session.canRedo()).toBe(true);

    const redone = session.dispatch({ type: 'redo' });
    expect(redone.ok).toBe(true);
    expect(redone.changed).toBe(true);
    expect(
      session.selectors.elementById(redone.snapshot, 'chip'),
    ).toMatchObject({ x: 40, y: '$chip-y' });
    expect(redone.snapshot.selectedElementIds).toEqual(['chip']);
    expect(session.canRedo()).toBe(false);
  });

  it('undoes and redoes a replaced document', () => {
    const session = createEditorSession(document);
    const replacement = documentFrom({
      version: 2,
      children: [{ id: 'other', type: 'rectangle', width: 10, height: 10 }],
    });
    session.dispatch({ type: 'replace-document', document: replacement });
    expect(session.getSnapshot().document).toEqual(replacement);

    const undone = session.dispatch({ type: 'undo' });
    expect(undone.changed).toBe(true);
    expect(undone.snapshot.document).toBe(document);

    const redone = session.dispatch({ type: 'redo' });
    expect(redone.changed).toBe(true);
    expect(redone.snapshot.document).toEqual(replacement);
  });

  it('keeps selection and inspector changes out of the history', () => {
    const session = createEditorSession(boundDocument);
    const listener = vi.fn();
    session.subscribe(listener);

    session.dispatch({ type: 'select', elementIds: ['chip'] });
    session.dispatch({ type: 'set-inspector-expanded', expanded: false });

    expect(session.canUndo()).toBe(false);
    expect(session.canRedo()).toBe(false);
    const before = session.getSnapshot();
    const undo = session.dispatch({ type: 'undo' });
    expect(undo.ok).toBe(true);
    expect(undo.changed).toBe(false);
    expect(undo.snapshot).toBe(before);
    expect(session.getSnapshot().document).toBe(boundDocument);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('restores a deleted element in place and keeps the remaining selection', () => {
    const session = createEditorSession(boundDocument);
    session.dispatch({ type: 'select', elementIds: ['chip', 'sibling'] });

    const deleted = session.dispatch({
      type: 'delete-element',
      elementId: 'chip',
    });
    expect(deleted.ok).toBe(true);
    expect(deleted.snapshot.selectedElementIds).toEqual(['sibling']);
    expect(
      session.selectors.elementById(deleted.snapshot, 'chip'),
    ).toBeUndefined();

    const undone = session.dispatch({ type: 'undo' });
    // The restored element keeps its id, parent and sibling order, but is only
    // selected again when the current selection still contains it.
    expect(
      session.selectors.elementById(undone.snapshot, 'chip'),
    ).toMatchObject({ id: 'chip', type: 'rectangle' });
    expect(session.selectors.parentOf(undone.snapshot, 'chip')?.id).toBe(
      'board',
    );
    expect(
      childrenOf(session, undone.snapshot, 'board').map(
        (element) => element.id,
      ),
    ).toEqual(['chip', 'sibling']);
    expect(undone.snapshot.selectedElementIds).toEqual(['sibling']);
    expect(session.selectors.selectedElement(undone.snapshot)?.id).toBe(
      'sibling',
    );
    expect(
      session.selectors
        .selectedElements(undone.snapshot)
        .map((element) => element.id),
    ).toEqual(['sibling']);

    const redone = session.dispatch({ type: 'redo' });
    expect(
      session.selectors.elementById(redone.snapshot, 'chip'),
    ).toBeUndefined();
    expect(redone.snapshot.selectedElementIds).toEqual(['sibling']);
  });

  it('reports diagnostics and keeps the history for an unknown delete target', () => {
    const session = createEditorSession(boundDocument);
    const before = session.getSnapshot();

    const result = session.dispatch({
      type: 'delete-element',
      elementId: 'missing',
    });

    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.snapshot).toBe(before);
    expect(result.diagnostics[0]?.code).toBe('element_not_found');
    expect(session.canUndo()).toBe(false);
  });

  it('drops the redo stack after a new document edit', () => {
    const session = createEditorSession(boundDocument);
    session.dispatch({
      type: 'move-element',
      elementId: 'chip',
      position: { x: 40 },
    });
    session.dispatch({ type: 'undo' });
    expect(session.canRedo()).toBe(true);

    session.dispatch({
      type: 'move-element',
      elementId: 'chip',
      position: { y: 30 },
    });

    expect(session.canRedo()).toBe(false);
    const redo = session.dispatch({ type: 'redo' });
    expect(redo.changed).toBe(false);
    expect(
      session.selectors.elementById(session.getSnapshot(), 'chip'),
    ).toMatchObject({ x: '$chip-x', y: 30 });
  });

  it('records a save target without adding a history step or clearing redo', () => {
    const session = createEditorSession(boundDocument);
    session.dispatch({
      type: 'move-element',
      elementId: 'chip',
      position: { x: 40 },
    });
    session.dispatch({ type: 'undo' });
    expect(session.canRedo()).toBe(true);

    const saved = session.dispatch({
      type: 'set-document-path',
      filePath: '/tmp/chip.json',
    });
    expect(saved.ok).toBe(true);
    expect(saved.changed).toBe(true);
    expect(saved.snapshot.document.filePath).toBe('/tmp/chip.json');
    expect(session.canUndo()).toBe(false);
    expect(session.canRedo()).toBe(true);

    // The path is metadata, so the redo result keeps the save target too.
    const redone = session.dispatch({ type: 'redo' });
    expect(redone.changed).toBe(true);
    expect(
      session.selectors.elementById(redone.snapshot, 'chip'),
    ).toMatchObject({ x: 40 });
    expect(redone.snapshot.document.filePath).toBe('/tmp/chip.json');
  });

  it('keeps only a bounded number of document snapshots', () => {
    const session = createEditorSession(
      documentFrom({
        version: 2,
        children: [{ id: 'item', type: 'rectangle', width: 10, height: 10 }],
      }),
    );
    for (let x = 1; x <= EDIT_HISTORY_LIMIT + 5; x += 1) {
      session.dispatch({
        type: 'move-element',
        elementId: 'item',
        position: { x },
      });
    }

    let undone = 0;
    while (session.dispatch({ type: 'undo' }).changed) {
      undone += 1;
    }
    expect(undone).toBe(EDIT_HISTORY_LIMIT);
    expect(session.canUndo()).toBe(false);
  });

  it('keeps history isolated between sessions', () => {
    const firstDocument = documentFrom({
      version: 2,
      children: [{ id: 'first', type: 'rectangle', width: 10, height: 10 }],
    });
    const secondDocument = documentFrom({
      version: 2,
      children: [{ id: 'second', type: 'rectangle', width: 10, height: 10 }],
    });
    const first = createEditorSession(firstDocument);
    const second = createEditorSession(secondDocument);

    first.dispatch({
      type: 'move-element',
      elementId: 'first',
      position: { x: 10 },
    });
    second.dispatch({
      type: 'move-element',
      elementId: 'second',
      position: { x: 20 },
    });

    const undoneFirst = first.dispatch({ type: 'undo' });
    expect(undoneFirst.snapshot.document).toBe(firstDocument);
    expect(
      second.selectors.elementById(second.getSnapshot(), 'second'),
    ).toMatchObject({ x: 20 });
    expect(second.canUndo()).toBe(true);
    expect(first.canRedo()).toBe(true);
    expect(second.canRedo()).toBe(false);

    const undoneSecond = second.dispatch({ type: 'undo' });
    expect(undoneSecond.snapshot.document).toBe(secondDocument);
    expect(
      first.selectors.elementById(first.getSnapshot(), 'first')?.x,
    ).toBeUndefined();
  });
});
