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
} from 'vitest';
import type { CanvasViewport } from '../src/electron-render/canvas-engine';
import { Canvas } from '../src/electron-render/Canvas';
import { TestCanvasRegistry } from './test-canvas-engine';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
let canvas: TestCanvasRegistry;

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
  canvas = new TestCanvasRegistry();
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

async function render(document: DesignDocument | null): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <Canvas
        document={document}
        selectionId={null}
        createEngine={canvas.factory}
      />,
    );
  });
}

async function rerender(
  document: DesignDocument | null,
  viewport?: CanvasViewport,
): Promise<void> {
  await act(async () => {
    root.render(
      <Canvas
        document={document}
        selectionId={null}
        viewport={viewport}
        createEngine={canvas.factory}
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
  it('does not create a canvas engine without a document or elements', async () => {
    await render(null);
    expect(canvas.engine).toBeNull();

    await rerender(documentFrom({ version: 1, children: [] }));
    expect(canvas.engine).toBeNull();
  });

  it('hands the variable-resolved scene to the engine', async () => {
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
    );

    expect(canvas.engine).not.toBeNull();
    expect(canvas.engine?.scene?.roots[0]?.id).toBe('frame');
    expect(canvas.engine?.scene?.roots[0]?.children[0]).toMatchObject({
      id: 'title',
      text: { content: '变量标题' },
    });
  });

  it('forwards viewport changes to the engine without recreating it', async () => {
    await render(documentWithFrame);
    const created = canvas.engine;
    expect(created?.viewport).toEqual({ scale: 1, x: 0, y: 0 });

    await rerender(documentWithFrame, { scale: 1.5, x: 12, y: -8 });

    expect(canvas.engine).toBe(created);
    expect(canvas.engine?.viewport).toEqual({ scale: 1.5, x: 12, y: -8 });
  });

  it('destroys the engine when unmounted', async () => {
    await render(documentWithFrame);
    const created = canvas.engine;

    act(() => {
      root.unmount();
    });

    expect(created?.destroyed).toBe(true);
  });
});
