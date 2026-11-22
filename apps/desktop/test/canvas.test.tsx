// @vitest-environment jsdom

import {
  validateDesignDocument,
  type DesignDocument,
} from '@design-ai/design-schema';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Canvas } from '../src/electron-render/Canvas';
import type {
  CanvasEngine,
  CanvasEngineFactory,
} from '../src/electron-render/canvas-engine';
import type {
  CanvasScene,
  CanvasSelection,
} from '../src/electron-render/canvas-scene';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

class TestCanvasEngine implements CanvasEngine {
  scene: CanvasScene | null = null;
  selection: CanvasSelection | null = null;
  destroyed = false;

  constructor(private readonly onSelect: (id: string | null) => void) {}

  setScene(scene: CanvasScene, selection: CanvasSelection | null): void {
    this.scene = scene;
    this.selection = selection;
  }

  destroy(): void {
    this.destroyed = true;
  }

  tap(id: string | null): void {
    this.onSelect(id);
  }
}

let container: HTMLDivElement;
let root: Root;
let engine: TestCanvasEngine | null;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  engine = null;
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function documentFrom(input: unknown): DesignDocument {
  const result = validateDesignDocument(input);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.document;
}

const createEngine: CanvasEngineFactory = (_host, options) => {
  engine = new TestCanvasEngine(options.onSelect);
  return engine;
};

async function render(
  document: DesignDocument | null,
  selectionId: string | null = null,
  onSelect?: (id: string | null) => void,
): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <Canvas
        document={document}
        selectionId={selectionId}
        onSelect={onSelect}
        createEngine={createEngine}
      />,
    );
  });
}

async function rerender(
  document: DesignDocument | null,
  selectionId: string | null,
): Promise<void> {
  await act(async () => {
    root.render(
      <Canvas
        document={document}
        selectionId={selectionId}
        createEngine={createEngine}
      />,
    );
  });
}

const documentWithFrame = documentFrom({
  version: 1,
  children: [
    {
      id: 'frame',
      type: 'frame',
      width: 400,
      height: 300,
      children: [
        { id: 'title', type: 'text', text: '标题', width: 100, height: 24 },
        { id: 'rectangle', type: 'rectangle', width: 40, height: 20, y: 30 },
      ],
    },
  ],
});

describe('Canvas', () => {
  it('shows the empty states without creating a canvas engine', async () => {
    await render(null);
    expect(container.textContent).toContain('尚未打开设计稿');
    expect(engine).toBeNull();

    await rerender(documentFrom({ version: 1, children: [] }), null);
    expect(container.textContent).toContain('空白设计稿');
    expect(engine).toBeNull();
  });

  it('hands the variable-resolved scene and selection to the engine', async () => {
    await render(
      documentFrom({
        version: 1,
        variables: { label: { type: 'string', value: '变量标题' } },
        children: [
          {
            id: 'frame',
            type: 'frame',
            width: 200,
            height: 80,
            children: [
              {
                id: 'title',
                type: 'text',
                text: '$label',
                width: 80,
                height: 20,
              },
            ],
          },
        ],
      }),
      'title',
    );

    expect(engine).not.toBeNull();
    expect(engine?.scene?.roots[0]?.id).toBe('frame');
    expect(engine?.scene?.roots[0]?.children[0]).toMatchObject({
      id: 'title',
      text: { content: '变量标题' },
    });
    expect(engine?.selection).toMatchObject({
      id: 'title',
      box: { x: 0, y: 0, width: 80, height: 20 },
      outline: { color: '#4592FF', strokeWidth: 3 },
    });
    expect(engine?.selection?.sizeTag.text).toBe('80 × 20');
  });

  it('forwards canvas taps and clears the selection when empty space is tapped', async () => {
    const onSelect = vi.fn();
    await render(documentWithFrame, null, onSelect);

    await act(async () => {
      engine?.tap('rectangle');
    });
    expect(onSelect).toHaveBeenLastCalledWith('rectangle');

    await act(async () => {
      engine?.tap(null);
    });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('updates the selection without recreating the engine', async () => {
    await render(documentWithFrame, null);
    const created = engine;
    expect(created?.selection).toBeNull();

    await rerender(documentWithFrame, 'rectangle');
    expect(engine).toBe(created);
    expect(engine?.selection?.id).toBe('rectangle');
    expect(engine?.selection?.box).toEqual({
      x: 100,
      y: 0,
      width: 40,
      height: 20,
    });

    await rerender(documentWithFrame, 'title');
    expect(engine).toBe(created);
    expect(engine?.selection?.id).toBe('title');
  });

  it('destroys the engine when unmounted', async () => {
    await render(documentWithFrame, null);
    const created = engine;

    act(() => {
      root.unmount();
    });

    expect(created?.destroyed).toBe(true);
  });
});
