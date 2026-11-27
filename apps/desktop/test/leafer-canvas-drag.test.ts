// @vitest-environment jsdom

import { validateDesignDocument } from '@design-ai/design-schema';
import { describe, expect, it, vi } from 'vitest';
import { buildCanvasScene } from '../src/electron-render/canvas-scene';

const fakeLeafer = vi.hoisted(() => {
  class FakeNode {
    children: FakeNode[] = [];
    data: { elementId?: unknown } | undefined;
    draggable: unknown;
    x = 0;
    y = 0;
    destroyed = false;

    constructor(input: Record<string, unknown> = {}) {
      Object.assign(this, input);
    }

    add(child: FakeNode): this {
      this.children.push(child);
      return this;
    }

    destroy(): void {
      this.destroyed = true;
    }
  }

  class FakeLeafer extends FakeNode {
    scale = 1;
    private readonly listeners = new Map<
      string,
      Array<(event: unknown) => void>
    >();

    constructor(input: Record<string, unknown> = {}) {
      super(input);
      instances.current = this;
    }

    on(type: string, listener: (event: unknown) => void): this {
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
      return this;
    }

    emit(type: string, event: unknown): void {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }
  }

  const instances: { current: FakeLeafer | null } = { current: null };

  return {
    FakeLeafer,
    FakeNode,
    instances,
    DragEvent: { START: 'drag.start', END: 'drag.end' },
  };
});

vi.mock('leafer-ui', () => ({
  Leafer: fakeLeafer.FakeLeafer,
  Box: fakeLeafer.FakeNode,
  Text: fakeLeafer.FakeNode,
  Group: fakeLeafer.FakeNode,
  Rect: fakeLeafer.FakeNode,
  DragEvent: fakeLeafer.DragEvent,
}));

function documentFrom(input: unknown) {
  const result = validateDesignDocument(input);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.document;
}

const designDocument = documentFrom({
  version: 2,
  children: [
    {
      id: 'board',
      type: 'frame',
      layout: 'none',
      width: 400,
      height: 300,
      children: [
        { id: 'rect', type: 'rectangle', x: 5, y: 6, width: 20, height: 20 },
      ],
    },
  ],
});

describe('Leafer drag handling', () => {
  it('previews the node and reports start and landing positions on release', async () => {
    const { createLeaferEngine } =
      await import('../src/electron-render/leafer-canvas');
    const selected: Array<string | null> = [];
    const moves: Array<{
      id: string;
      from: { x: number; y: number };
      to: { x: number; y: number };
    }> = [];
    const engine = await createLeaferEngine(document.createElement('div'), {
      onSelect: (id) => selected.push(id),
      onMoveElement: (id, from, to) => {
        moves.push({ id, from, to });
        return true;
      },
    });

    engine.setScene(buildCanvasScene(designDocument), null);
    const leafer = fakeLeafer.instances.current;
    expect(leafer).not.toBeNull();
    const content = leafer?.children[0];
    const board = content?.children[0];
    const rect = board?.children[0];
    expect(rect?.data).toEqual({ elementId: 'rect' });
    expect(rect?.draggable).toBe(true);

    const path = { list: [rect, board, content, leafer] };
    leafer?.emit(fakeLeafer.DragEvent.START, { path });
    expect(selected).toEqual(['rect']);

    // Leafer moves the mounted node while the pointer moves.
    if (rect !== undefined) {
      rect.x = 15;
    }
    leafer?.emit(fakeLeafer.DragEvent.END, { path });

    expect(moves).toEqual([
      { id: 'rect', from: { x: 5, y: 6 }, to: { x: 15, y: 6 } },
    ]);
  });

  it('restores the preview position when the editor rejects the landing', async () => {
    const { createLeaferEngine } =
      await import('../src/electron-render/leafer-canvas');
    const engine = await createLeaferEngine(document.createElement('div'), {
      onSelect: () => {},
      onMoveElement: () => false,
    });

    engine.setScene(buildCanvasScene(designDocument), null);
    const leafer = fakeLeafer.instances.current;
    const content = leafer?.children[0];
    const board = content?.children[0];
    const rect = board?.children[0];
    const path = { list: [rect, board, content, leafer] };

    leafer?.emit(fakeLeafer.DragEvent.START, { path });
    if (rect !== undefined) {
      rect.x = 40;
      rect.y = 50;
    }
    leafer?.emit(fakeLeafer.DragEvent.END, { path });

    expect(rect).toMatchObject({ x: 5, y: 6 });
  });

  it('ignores drags that start outside a movable element', async () => {
    const { createLeaferEngine } =
      await import('../src/electron-render/leafer-canvas');
    const moves = vi.fn();
    const engine = await createLeaferEngine(document.createElement('div'), {
      onSelect: () => {},
      onMoveElement: moves,
    });

    engine.setScene(buildCanvasScene(designDocument), null);
    const leafer = fakeLeafer.instances.current;
    const content = leafer?.children[0];

    leafer?.emit(fakeLeafer.DragEvent.START, { path: { list: [content] } });
    leafer?.emit(fakeLeafer.DragEvent.END, { path: { list: [content] } });

    expect(moves).not.toHaveBeenCalled();
  });
});
