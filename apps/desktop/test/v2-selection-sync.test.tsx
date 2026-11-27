// @vitest-environment jsdom

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
import { App } from '../src/electron-render/App';
import { readDesignFile } from '../src/electron-main/read-design-file';
import type { OpenDesignFileResult } from '../src/electron-preload/contract';
import { hasSceneNode, TestCanvasRegistry } from './test-canvas-engine';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
let directory: string;
let openDesignFile: () => Promise<OpenDesignFileResult>;
let canvas: TestCanvasRegistry;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'design-ai-selection-'));
  container = document.createElement('div');
  document.body.append(container);
  canvas = new TestCanvasRegistry();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  await rm(directory, { recursive: true, force: true });
});

const nestedDocument = {
  version: 2,
  children: [
    {
      id: 'board',
      type: 'frame',
      layout: 'none',
      width: 400,
      height: 300,
      children: [
        {
          id: 'card',
          type: 'frame',
          x: 20,
          y: 20,
          width: 200,
          height: 120,
          children: [
            {
              id: 'chip',
              type: 'rectangle',
              x: 10,
              y: 10,
              width: 80,
              height: 40,
            },
          ],
        },
        { id: 'label', type: 'text', textStyle: { content: '标题' } },
      ],
    },
  ],
};

async function renderApp(): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <App
        openDesignFile={() => openDesignFile()}
        createCanvasEngine={canvas.factory}
      />,
    );
  });
}

async function openDesign(name: string, document: unknown): Promise<void> {
  const filePath = path.join(directory, name);
  await writeFile(filePath, JSON.stringify(document), 'utf8');
  const result = await readDesignFile(filePath);
  openDesignFile = async () => result;
  await clickButton('打开设计稿');
}

async function renderOpenedDesign(): Promise<void> {
  await renderApp();
  await openDesign('nested.json', nestedDocument);
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 10; round += 1) {
      await Promise.resolve();
    }
  });
}

async function clickButton(text: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) {
    throw new Error(`Button "${text}" not found`);
  }
  await act(async () => {
    button.closest('details')?.querySelector('summary')?.click();
    button.click();
  });
  await settle();
}

function layerRow(id: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(`[data-layer-id="${id}"]`);
  if (row === null) {
    throw new Error(`Layer row ${id} not found`);
  }
  return row;
}

function inspectorLabel(): string | null {
  const panel = container.querySelector('[data-testid="property-panel"]');
  return panel?.querySelector('[title]')?.getAttribute('title') ?? null;
}

async function clickTab(label: string): Promise<void> {
  const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (tab === undefined) {
    throw new Error(`Tab "${label}" not found`);
  }
  await act(async () => {
    tab.click();
  });
  await settle();
}

describe('v2 opened design selection', () => {
  it('highlights the nested rectangle from the layer tree on the canvas and inspector', async () => {
    await renderOpenedDesign();

    expect(
      canvas.engine?.scene?.roots[0]?.children.map((node) => node.id),
    ).toEqual(['card', 'label']);

    await act(async () => {
      layerRow('chip').querySelector<HTMLElement>('.layer-row')?.click();
    });
    await settle();

    expect(canvas.engine?.selection?.id).toBe('chip');
    expect(layerRow('chip').getAttribute('data-selected')).toBe('true');
    expect(layerRow('card').getAttribute('data-selected')).toBe('false');
    expect(inspectorLabel()).toBe('chip');
  });

  it('updates the layer tree and inspector from a canvas tap', async () => {
    await renderOpenedDesign();

    await act(async () => {
      canvas.engine?.tap('label');
    });
    await settle();

    expect(canvas.engine?.selection?.id).toBe('label');
    expect(layerRow('label').getAttribute('data-selected')).toBe('true');
    expect(inspectorLabel()).toBe('标题');

    await act(async () => {
      canvas.engine?.tap(null);
    });
    await settle();

    expect(canvas.engine?.selection).toBeNull();
    expect(layerRow('label').getAttribute('data-selected')).toBe('false');
    expect(
      container.querySelector('[data-testid="property-panel"]'),
    ).toBeNull();
  });

  it('selects an icon from its canvas paint area into the layer tree and inspector', async () => {
    await renderApp();
    await openDesign('icon.json', {
      version: 2,
      children: [
        {
          id: 'icon-board',
          type: 'frame',
          width: 200,
          height: 100,
          children: [
            {
              id: 'star-icon',
              type: 'icon',
              name: '星标',
              library: 'lucide',
              icon: 'star',
              width: 24,
              height: 24,
              x: 8,
              y: 8,
            },
          ],
        },
      ],
    });

    expect(hasSceneNode(canvas.engine?.scene ?? null, 'star-icon')).toBe(true);

    await act(async () => {
      canvas.engine?.tap('star-icon');
    });
    await settle();

    expect(canvas.engine?.selection?.id).toBe('star-icon');
    expect(layerRow('star-icon').getAttribute('data-selected')).toBe('true');
    expect(inspectorLabel()).toBe('星标');
  });

  it('keeps each tab selection in its own session', async () => {
    await renderApp();
    await openDesign('first.json', nestedDocument);
    await act(async () => {
      layerRow('chip').querySelector<HTMLElement>('.layer-row')?.click();
    });
    await settle();

    await openDesign('second.json', {
      version: 2,
      children: [
        {
          id: 'second-board',
          type: 'frame',
          width: 200,
          height: 100,
          children: [
            { id: 'second-block', type: 'rectangle', width: 40, height: 20 },
          ],
        },
      ],
    });
    await act(async () => {
      layerRow('second-block')
        .querySelector<HTMLElement>('.layer-row')
        ?.click();
    });
    await settle();
    expect(canvas.engine?.selection?.id).toBe('second-block');

    await clickTab('first.json');
    expect(canvas.engine?.selection?.id).toBe('chip');
    expect(layerRow('chip').getAttribute('data-selected')).toBe('true');

    await clickTab('second.json');
    expect(canvas.engine?.selection?.id).toBe('second-block');
    expect(layerRow('second-block').getAttribute('data-selected')).toBe('true');
  });
});
