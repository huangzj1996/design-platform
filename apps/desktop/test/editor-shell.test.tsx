// @vitest-environment jsdom

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
import { DesignFileSaver } from '../src/electron-main/save-design-file';
import type {
  OpenDesignFileResult,
  SaveDesignFileInput,
  SaveDesignFileResult,
} from '../src/electron-preload/contract';
import {
  findSceneNode,
  hasSceneNode,
  TestCanvasRegistry,
} from './test-canvas-engine';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
let directory: string;
let saver: DesignFileSaver;
let writeLog: string[];
let openDesignFile: () => Promise<OpenDesignFileResult>;
let saveDesignFile: (
  input: SaveDesignFileInput,
) => Promise<SaveDesignFileResult>;
let closeListeners: Set<() => void>;
let canvas: TestCanvasRegistry;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'design-ai-editor-'));
  container = document.createElement('div');
  document.body.append(container);
  writeLog = [];
  closeListeners = new Set();
  canvas = new TestCanvasRegistry();
  saver = new DesignFileSaver({
    projectDirectory: directory,
    dependencies: {
      writeFile: async (target, contents, options) => {
        writeLog.push(contents);
        await writeFile(target, contents, options);
      },
    },
  });
  openDesignFile = async () => ({ status: 'cancelled' });
  saveDesignFile = (input) => saver.save(input);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  await rm(directory, { recursive: true, force: true });
});

const frameWithText = {
  version: 1,
  children: [
    {
      id: 'main',
      type: 'frame',
      layout: 'vertical',
      width: 400,
      height: 300,
      gap: 8,
      children: [{ id: 'title', type: 'text', text: '旧标题' }],
    },
  ],
};

async function writeJson(name: string, value: unknown): Promise<string> {
  const filePath = path.join(directory, name);
  await writeFile(filePath, JSON.stringify(value), 'utf8');
  return filePath;
}

async function setOpenFile(filePath: string): Promise<void> {
  const result = await readDesignFile(filePath);
  if (result.status === 'opened') {
    saver.rememberSaved(result.filePath, result.document);
  }
  openDesignFile = async () => result;
}

async function settle(rounds = 25): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderApp(): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <App
        openDesignFile={() => openDesignFile()}
        saveDesignFile={(input) => saveDesignFile(input)}
        createCanvasEngine={canvas.factory}
        subscribeCloseRequest={(listener) => {
          closeListeners.add(listener);
          return () => closeListeners.delete(listener);
        }}
        confirmClose={() => {}}
        saveDelayMs={60_000}
      />,
    );
  });
}

function byTestId<T extends HTMLElement = HTMLButtonElement>(
  testId: string,
): T {
  const element = container.querySelector<T>(`[data-testid="${testId}"]`);
  if (element === null) {
    throw new Error(`Element "${testId}" not found`);
  }
  return element;
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (button === undefined) {
    throw new Error(`Button "${text}" not found`);
  }
  return button;
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle(3);
}

async function clickButton(text: string): Promise<void> {
  await click(buttonByText(text));
  await settle();
}

async function openBoard(): Promise<void> {
  const filePath = await writeJson('board.json', frameWithText);
  await setOpenFile(filePath);
  await renderApp();
  await clickButton('打开设计稿');
}

function sceneNode(id: string) {
  return findSceneNode(canvas.engine?.scene ?? null, id);
}

function layerRow(id: string): HTMLElement {
  const row = container.querySelector<HTMLElement>(
    `[data-layer-id="${id}"] .layer-row`,
  );
  if (row === null) {
    throw new Error(`Layer row ${id} not found`);
  }
  return row;
}

async function requestClose(): Promise<void> {
  await act(async () => {
    for (const listener of closeListeners) {
      listener();
    }
  });
  await settle();
}

async function drag(
  target: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        clientX: from.x,
        clientY: from.y,
      }),
    );
  });
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        clientX: to.x,
        clientY: to.y,
      }),
    );
  });
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        clientX: to.x,
        clientY: to.y,
      }),
    );
  });
}

describe('Pencil editor shell', () => {
  it('lays out the shared tab bar, layer sidebar, canvas toolbar and inspector', async () => {
    await openBoard();

    expect(byTestId('tab-bar')).not.toBeNull();
    expect(byTestId('window-chrome')).not.toBeNull();
    expect(byTestId('layer-tree')).not.toBeNull();
    expect(layerRow('title')).not.toBeNull();
    expect(byTestId('sidebar-tab-agent').hasAttribute('disabled')).toBe(true);
    expect(byTestId('sidebar-tab-layers').getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(byTestId('tool-pointer').getAttribute('aria-pressed')).toBe('true');
    expect(byTestId('tool-hand').getAttribute('aria-pressed')).toBe('false');
    expect(byTestId('zoom-percentage').textContent).toBe('100%');
    expect(byTestId('property-panel')).not.toBeNull();
  });

  it('creates text, containers, rectangles, ellipses and icons from the toolbar and menu', async () => {
    await openBoard();

    await click(byTestId('tool-text'));
    expect(sceneNode('text-1').text?.content).toBe('标题');
    expect(canvas.engine?.selection?.id).toBe('text-1');
    expect(layerRow('text-1')).not.toBeNull();
    expect(byTestId('property-panel').textContent).toContain('text-1');

    await click(byTestId('tool-frame'));
    expect(sceneNode('frame-1').type).toBe('frame');
    expect(canvas.engine?.selection?.id).toBe('frame-1');

    await click(byTestId('tool-rectangle'));
    expect(sceneNode('rectangle-1').type).toBe('rectangle');
    expect(canvas.engine?.selection?.id).toBe('rectangle-1');

    expect(container.querySelector('[data-testid="shape-menu"]')).toBeNull();
    await click(byTestId('tool-expand'));
    expect(byTestId('tool-expand').getAttribute('aria-expanded')).toBe('true');
    expect(byTestId('shape-menu')).not.toBeNull();
    expect(byTestId('shape-polygon').hasAttribute('disabled')).toBe(true);

    await click(byTestId('shape-ellipse'));
    expect(sceneNode('ellipse-1').type).toBe('ellipse');
    expect(canvas.engine?.selection?.id).toBe('ellipse-1');
    expect(container.querySelector('[data-testid="shape-menu"]')).toBeNull();

    await click(byTestId('tool-expand'));
    await click(byTestId('shape-icon'));
    expect(sceneNode('icon-1').icon).toMatchObject({
      library: 'lucide',
      icon: 'star',
    });
    expect(canvas.engine?.selection?.id).toBe('icon-1');
  });

  it('zooms and pans the viewport without changing the document or saving', async () => {
    await openBoard();
    expect(byTestId('zoom-percentage').textContent).toBe('100%');
    expect(canvas.engine?.viewport).toEqual({ scale: 1, x: 0, y: 0 });

    await click(byTestId('zoom-out'));
    expect(byTestId('zoom-percentage').textContent).toBe('75%');
    expect(canvas.engine?.viewport?.scale).toBe(0.75);

    await click(byTestId('zoom-in'));
    await click(byTestId('zoom-in'));
    expect(byTestId('zoom-percentage').textContent).toBe('125%');
    expect(canvas.engine?.viewport?.scale).toBe(1.25);

    await click(byTestId('tool-hand'));
    expect(byTestId('tool-hand').getAttribute('aria-pressed')).toBe('true');
    expect(byTestId('tool-pointer').getAttribute('aria-pressed')).toBe('false');

    await drag(byTestId('canvas'), { x: 100, y: 100 }, { x: 140, y: 130 });
    expect(canvas.engine?.viewport).toEqual({
      scale: 1.25,
      x: 40,
      y: 30,
    });

    // A hand-tool drag never selects an element or edits the saved document.
    expect(canvas.engine?.selection).toBeNull();
    expect(writeLog).toHaveLength(0);
    expect(hasSceneNode(canvas.engine?.scene ?? null, 'title')).toBe(true);

    await click(byTestId('tool-pointer'));
    await drag(byTestId('canvas'), { x: 0, y: 0 }, { x: 20, y: 20 });
    expect(canvas.engine?.viewport).toEqual({
      scale: 1.25,
      x: 40,
      y: 30,
    });
  });

  it('keeps created and deleted elements in sync and visible after reopening', async () => {
    await openBoard();

    await click(byTestId('tool-rectangle'));
    expect(sceneNode('rectangle-1').type).toBe('rectangle');
    expect(layerRow('rectangle-1')).not.toBeNull();
    expect(byTestId('property-panel').textContent).toContain('rectangle-1');

    await clickButton('删除元素');
    expect(container.querySelector('[data-layer-id="rectangle-1"]')).toBeNull();
    expect(hasSceneNode(canvas.engine?.scene ?? null, 'rectangle-1')).toBe(
      false,
    );
    expect(canvas.engine?.selection).toBeNull();

    await click(byTestId('tool-text'));
    await requestClose();

    const saved = JSON.parse(
      await readFile(path.join(directory, 'board.json'), 'utf8'),
    ) as { children: Array<{ id: string }> };
    expect(saved.children.map((child) => child.id)).toEqual(['main', 'text-1']);

    const reopened = await readDesignFile(path.join(directory, 'board.json'));
    expect(reopened.status).toBe('opened');
    if (reopened.status === 'opened') {
      expect(reopened.document.children.map((child) => child.id)).toEqual([
        'main',
        'text-1',
      ]);
    }
  });
});
