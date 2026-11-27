import { validateDesignDocument } from '@design-ai/design-schema';
import { describe, expect, it, vi } from 'vitest';
import { declarationPosition, dragMoveTarget } from '../src/document/move';
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
  variables: {
    'chip-x': { type: 'number', value: 12 },
    'top-y': { type: 'number', value: 20 },
    'inner-inset': { type: 'number', value: 8 },
  },
  children: [
    { id: 'top', type: 'rectangle', x: 10, y: '$top-y', width: 40, height: 30 },
    {
      id: 'board',
      type: 'frame',
      layout: 'none',
      width: 400,
      height: 300,
      padding: [16, 16, 16, '$inner-inset'],
      children: [
        {
          id: 'chip',
          type: 'rectangle',
          x: '$chip-x',
          y: 5,
          width: 20,
          height: 20,
        },
        {
          id: 'stack',
          type: 'frame',
          layout: 'vertical',
          width: 100,
          height: 100,
          children: [
            {
              id: 'stack-child',
              type: 'rectangle',
              width: 20,
              height: 20,
            },
          ],
        },
      ],
    },
  ],
});

describe('declarationPosition', () => {
  it('keeps canvas coordinates for a top-level element', () => {
    expect(declarationPosition(document, 'top', { x: 30.456, y: 40 })).toEqual({
      x: 30.46,
      y: 40,
    });
  });

  it('subtracts the parent content inset for a free-layout child', () => {
    expect(declarationPosition(document, 'chip', { x: 34, y: 41 })).toEqual({
      x: 26,
      y: 25,
    });
  });

  it('resolves a variable-bound parent inset', () => {
    expect(declarationPosition(document, 'chip', { x: 8, y: 16 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('rejects auto-layout children and unknown elements', () => {
    expect(
      declarationPosition(document, 'stack-child', { x: 10, y: 10 }),
    ).toBeNull();
    expect(
      declarationPosition(document, 'missing', { x: 10, y: 10 }),
    ).toBeNull();
  });
});

describe('dragMoveTarget', () => {
  it('writes only the axis that moved', () => {
    expect(
      dragMoveTarget(document, 'top', { x: 10, y: 20 }, { x: 33.333, y: 20 }),
    ).toEqual({ x: 33.33 });
  });

  it('adds the travel distance to a nested declaration', () => {
    expect(
      dragMoveTarget(document, 'chip', { x: 22, y: 28 }, { x: 30, y: 28 }),
    ).toEqual({ x: 20 });
  });

  it('returns an empty patch when the drag does not move any axis', () => {
    expect(
      dragMoveTarget(document, 'top', { x: 10, y: 20 }, { x: 10, y: 20 }),
    ).toEqual({});
  });

  it('keeps an axis whose canvas position only differs by layout rounding', () => {
    const precise = documentFrom({
      version: 2,
      variables: {
        'precise-x': { type: 'number', value: 10.333333 },
        'precise-y': { type: 'number', value: 20 },
      },
      children: [
        {
          id: 'precise',
          type: 'rectangle',
          x: '$precise-x',
          y: '$precise-y',
          width: 20,
          height: 20,
        },
      ],
    });

    // The scene rounds x to 10.33, so a vertical-only drag must keep both
    // declarations untouched instead of writing 10.33.
    expect(
      dragMoveTarget(
        precise,
        'precise',
        { x: 10.33, y: 20 },
        { x: 10.33, y: 35 },
      ),
    ).toEqual({ y: 35 });

    expect(
      dragMoveTarget(
        precise,
        'precise',
        { x: 10.33, y: 20 },
        { x: 12.33, y: 20 },
      ),
    ).toEqual({ x: 12.33 });
  });

  it('returns null when the element cannot be dragged', () => {
    expect(
      dragMoveTarget(document, 'stack-child', { x: 1, y: 1 }, { x: 2, y: 2 }),
    ).toBeNull();
    expect(
      dragMoveTarget(document, 'missing', { x: 1, y: 1 }, { x: 2, y: 2 }),
    ).toBeNull();
  });
});

describe('move-element command', () => {
  it('commits a top-level landing and keeps the unchanged axis reference', () => {
    const session = createEditorSession(document);
    const listener = vi.fn();
    session.subscribe(listener);

    const result = session.dispatch({
      type: 'move-element',
      elementId: 'top',
      position: { x: 30, y: 20 },
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(result.snapshot);
    expect(session.getSnapshot()).toBe(result.snapshot);
    expect(result.snapshot.document).not.toBe(document);

    const top = result.snapshot.document.children[0];
    expect(top).toMatchObject({ id: 'top', x: 30, y: '$top-y' });
    expect(result.snapshot.document.variables).toEqual(document.variables);
    expect(
      result.snapshot.document.children.map((element) => element.id),
    ).toEqual(['top', 'board']);
  });

  it('writes a changed axis as a number and preserves the variable definition', () => {
    const session = createEditorSession(document);

    const result = session.dispatch({
      type: 'move-element',
      elementId: 'chip',
      position: { x: 26, y: 25 },
    });

    const board = result.snapshot.document.children[1];
    const chip =
      board?.type === 'frame'
        ? board.children?.find((child) => child.id === 'chip')
        : undefined;
    expect(chip).toMatchObject({ id: 'chip', x: 26, y: 25, width: 20 });
    expect(result.snapshot.document.variables['chip-x']).toEqual({
      type: 'number',
      value: 12,
    });
  });

  it('writes only the axis whose resolved position changed', () => {
    const session = createEditorSession(document);

    const result = session.dispatch({
      type: 'move-element',
      elementId: 'top',
      position: { x: 10, y: 50 },
    });

    expect(result.snapshot.document.children[0]).toMatchObject({
      id: 'top',
      x: 10,
      y: 50,
    });
  });

  it('keeps the snapshot for a landing equal to the resolved position', () => {
    const session = createEditorSession(document);
    const before = session.getSnapshot();
    const listener = vi.fn();
    session.subscribe(listener);

    const result = session.dispatch({
      type: 'move-element',
      elementId: 'top',
      position: { x: 10, y: 20 },
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.snapshot).toBe(before);
    expect(result.snapshot.document).toBe(document);
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns diagnostics and keeps the last valid snapshot for invalid input', () => {
    const session = createEditorSession(document);
    session.dispatch({ type: 'select', elementIds: ['top', 'chip'] });
    const before = session.getSnapshot();
    const listener = vi.fn();
    session.subscribe(listener);

    const invalid = session.dispatch({
      type: 'move-element',
      elementId: 'top',
      position: { x: Number.NaN, y: 25 },
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.changed).toBe(false);
    expect(invalid.snapshot).toBe(before);
    expect(invalid.diagnostics.length).toBeGreaterThan(0);

    const missing = session.dispatch({
      type: 'move-element',
      elementId: 'missing',
      position: { x: 1, y: 2 },
    });
    expect(missing.ok).toBe(false);
    expect(missing.snapshot).toBe(before);
    expect(missing.diagnostics[0]?.code).toBe('element_not_found');
    expect(listener).not.toHaveBeenCalled();
  });

  it('preserves the selection and sibling order across a move', () => {
    const session = createEditorSession(document);
    session.dispatch({ type: 'select', elementIds: ['chip', 'top'] });

    const result = session.dispatch({
      type: 'move-element',
      elementId: 'chip',
      position: { x: 3 },
    });

    expect(result.snapshot.selectedElementIds).toEqual(['chip', 'top']);
    const board = result.snapshot.document.children[1];
    expect(
      board?.type === 'frame'
        ? board.children?.map((child) => child.id)
        : undefined,
    ).toEqual(['chip', 'stack']);
  });
});
