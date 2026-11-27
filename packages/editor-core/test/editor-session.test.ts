import { validateDesignDocument } from '@design-ai/design-schema';
import { describe, expect, it, vi } from 'vitest';
import { createEditorSession } from '../src/session/editor-session';

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
        { id: 'rectangle', type: 'rectangle', name: '矩形', width: 80, height: 40 },
        { id: 'nested', type: 'frame', name: '卡片', width: 120, height: 80, children: [] },
      ],
    },
    { id: 'title', type: 'text', name: '标题', textStyle: { content: '标题' } },
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
          children: [{ id: 'title', type: 'text', textStyle: { content: '新标题' } }],
        },
      ],
    });

    const result = session.dispatch({ type: 'replace-document', document: next });

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
});

describe('session.selectors', () => {
  const session = createEditorSession(document);

  it('finds elements by id and resolves the direct parent', () => {
    const snapshot = session.getSnapshot();

    expect(session.selectors.elementById(snapshot, 'nested')?.type).toBe('frame');
    expect(session.selectors.elementById(snapshot, 'missing')).toBeUndefined();
    expect(session.selectors.parentOf(snapshot, 'rectangle')?.id).toBe('frame');
    expect(session.selectors.parentOf(snapshot, 'frame')).toBeUndefined();
    expect(session.selectors.parentOf(snapshot, 'missing')).toBeUndefined();
  });

  it('returns the single selected element only for exactly one selection', () => {
    const none = session.getSnapshot();
    expect(session.selectors.selectedElement(none)).toBeUndefined();
    expect(session.selectors.selectedElements(none)).toEqual([]);

    const one = session.dispatch({ type: 'select', elementIds: ['title'] }).snapshot;
    expect(session.selectors.selectedElement(one)?.id).toBe('title');

    const many = session.dispatch({
      type: 'select',
      elementIds: ['rectangle', 'title'],
    }).snapshot;
    expect(session.selectors.selectedElement(many)).toBeUndefined();
    expect(session.selectors.selectedElements(many).map((element) => element.id)).toEqual([
      'rectangle',
      'title',
    ]);
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
});
