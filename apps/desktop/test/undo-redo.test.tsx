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
let confirmCloseCalls: number;
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
  directory = await mkdtemp(path.join(tmpdir(), 'design-ai-history-'));
  container = document.createElement('div');
  document.body.append(container);
  writeLog = [];
  confirmCloseCalls = 0;
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

const historyDocument = {
  version: 2,
  variables: {
    'chip-x': { type: 'number', value: 12 },
    'chip-y': { type: 'number', value: 18 },
  },
  children: [
    {
      id: 'top',
      type: 'rectangle',
      x: 10,
      y: 20,
      width: 40,
      height: 30,
      fill: [{ type: 'color', color: '#dbeafe' }],
    },
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
          layout: 'none',
          x: 20,
          y: 20,
          width: 200,
          height: 120,
          padding: [10, 10, 10, 10],
          children: [
            {
              id: 'chip',
              type: 'rectangle',
              x: '$chip-x',
              y: '$chip-y',
              width: 80,
              height: 40,
            },
          ],
        },
        { id: 'label', type: 'text', textStyle: { content: '说明' } },
      ],
    },
  ],
};

async function writeJson(name: string, value: unknown): Promise<string> {
  const filePath = path.join(directory, name);
  await writeFile(filePath, JSON.stringify(value), 'utf8');
  return filePath;
}

async function openJson(filePath: string): Promise<void> {
  const result = await readDesignFile(filePath);
  if (result.status === 'opened') {
    saver.rememberSaved(result.filePath, result.document);
  }
  openDesignFile = async () => result;
}

async function renderApp(): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <App
        openDesignFile={() => openDesignFile()}
        saveDesignFile={(input) => saveDesignFile(input)}
        subscribeCloseRequest={(listener) => {
          closeListeners.add(listener);
          return () => closeListeners.delete(listener);
        }}
        confirmClose={() => {
          confirmCloseCalls += 1;
        }}
        createCanvasEngine={canvas.factory}
      />,
    );
  });
}

async function settle(rounds = 25): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) {
    throw new Error(`Button "${text}" not found`);
  }
  return button;
}

async function clickButton(text: string): Promise<void> {
  const button = buttonByText(text);
  await act(async () => {
    button.closest('details')?.querySelector('summary')?.click();
    button.click();
  });
  await settle();
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

async function selectLayer(id: string): Promise<void> {
  await act(async () => {
    layerRow(id).click();
  });
  await settle();
}

function propertyInput(label: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    `[data-testid="property-panel"] [aria-label="${label}"]`,
  );
  if (input === null) {
    throw new Error(`Property input "${label}" not found`);
  }
  return input;
}

async function drag(
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await act(async () => {
    canvas.engine?.drag(id, from, to);
  });
  await settle(3);
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

async function requestClose(): Promise<void> {
  await act(async () => {
    for (const listener of closeListeners) {
      listener();
    }
  });
  await settle();
}

interface SavedDocument {
  version: number;
  children: Array<Record<string, unknown>>;
}

async function readSaved(filePath: string): Promise<SavedDocument> {
  return JSON.parse(await readFile(filePath, 'utf8')) as SavedDocument;
}

describe('undo and redo', () => {
  it('undoes and redoes each drag once and saves the restored landing', async () => {
    const filePath = await writeJson('history.json', historyDocument);
    await openJson(filePath);
    await renderApp();
    await clickButton('打开设计稿');

    expect(buttonByText('撤销').disabled).toBe(true);
    expect(buttonByText('重做').disabled).toBe(true);

    await drag('top', { x: 10, y: 20 }, { x: 33.333, y: 20 });
    expect(propertyInput('X').value).toBe('33.33');
    expect(
      findSceneNode(canvas.engine?.scene ?? null, 'top').box,
    ).toMatchObject({ x: 33.33, y: 20 });
    expect(buttonByText('撤销').disabled).toBe(false);

    await drag('top', { x: 33.33, y: 20 }, { x: 60, y: 20 });
    expect(propertyInput('X').value).toBe('60');

    await clickButton('撤销');
    expect(propertyInput('X').value).toBe('33.33');
    expect(
      findSceneNode(canvas.engine?.scene ?? null, 'top').box,
    ).toMatchObject({ x: 33.33, y: 20 });
    expect(buttonByText('重做').disabled).toBe(false);

    await clickButton('重做');
    expect(propertyInput('X').value).toBe('60');
    expect(
      findSceneNode(canvas.engine?.scene ?? null, 'top').box,
    ).toMatchObject({ x: 60, y: 20 });

    // The restored landing is what autosave persists.
    await clickButton('撤销');
    await requestClose();

    expect(confirmCloseCalls).toBe(1);
    expect(writeLog).toHaveLength(1);
    const saved = await readSaved(filePath);
    expect(saved.version).toBe(2);
    expect(saved.children[0]).toMatchObject({
      id: 'top',
      x: 33.33,
      y: 20,
    });
  });

  it('undoes and redoes with the standard keyboard shortcuts', async () => {
    const filePath = await writeJson('keyboard.json', historyDocument);
    await openJson(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    await drag('top', { x: 10, y: 20 }, { x: 33.333, y: 20 });
    expect(propertyInput('X').value).toBe('33.33');

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }),
      );
    });
    await settle();
    expect(propertyInput('X').value).toBe('10');

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          ctrlKey: true,
          shiftKey: true,
        }),
      );
    });
    await settle();
    expect(propertyInput('X').value).toBe('33.33');
  });

  it('restores a deleted nested element in place without selecting it', async () => {
    const filePath = await writeJson('delete.json', historyDocument);
    await openJson(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    await selectLayer('chip');
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="element-actions"]')
        ?.click();
    });
    await settle();

    await clickButton('删除元素');
    expect(hasSceneNode(canvas.engine?.scene ?? null, 'chip')).toBe(false);
    expect(
      container.querySelector('[data-testid="property-panel"]'),
    ).toBeNull();
    expect(buttonByText('撤销').disabled).toBe(false);

    await clickButton('撤销');
    const scene = canvas.engine?.scene ?? null;
    expect(hasSceneNode(scene, 'chip')).toBe(true);
    expect(
      findSceneNode(scene, 'card').children.map((node) => node.id),
    ).toEqual(['chip']);
    expect(
      findSceneNode(scene, 'board').children.map((node) => node.id),
    ).toEqual(['card', 'label']);
    expect(
      layerRow('chip')
        .closest('[data-layer-id]')
        ?.getAttribute('data-selected'),
    ).toBe('false');
    expect(
      container.querySelector('[data-testid="property-panel"]'),
    ).toBeNull();

    // The restored element and its tree position persist on save and reopen.
    await requestClose();
    const saved = await readSaved(filePath);
    const board = saved.children[1];
    const card =
      board?.type === 'frame'
        ? (board.children as Array<Record<string, unknown>>)[0]
        : undefined;
    expect(card).toMatchObject({ id: 'card' });
    expect(card?.children).toHaveLength(1);
    const cardChildren =
      card === undefined
        ? []
        : (card.children as Array<Record<string, unknown>>);
    expect(cardChildren[0]).toMatchObject({
      id: 'chip',
      x: '$chip-x',
      y: '$chip-y',
    });

    await openJson(filePath);
    await clickButton('打开设计稿');
    expect(
      findSceneNode(canvas.engine?.scene ?? null, 'chip').box,
    ).toMatchObject({ x: 22, y: 28 });
  });

  it('keeps undo history isolated between tabs', async () => {
    const firstPath = await writeJson('history-first.json', {
      version: 2,
      children: [
        { id: 'alpha', type: 'rectangle', x: 5, y: 5, width: 20, height: 20 },
      ],
    });
    const secondPath = await writeJson('history-second.json', {
      version: 2,
      children: [
        { id: 'beta', type: 'rectangle', x: 7, y: 7, width: 20, height: 20 },
      ],
    });
    await openJson(firstPath);
    await renderApp();
    await clickButton('打开设计稿');
    await drag('alpha', { x: 5, y: 5 }, { x: 15, y: 5 });
    expect(propertyInput('X').value).toBe('15');

    await openJson(secondPath);
    await clickButton('打开设计稿');
    await drag('beta', { x: 7, y: 7 }, { x: 17, y: 7 });
    expect(propertyInput('X').value).toBe('17');

    await clickButton('撤销');
    expect(propertyInput('X').value).toBe('7');

    await clickTab('history-first.json');
    expect(propertyInput('X').value).toBe('15');
    await clickButton('撤销');
    expect(propertyInput('X').value).toBe('5');
    expect(buttonByText('撤销').disabled).toBe(true);

    await clickTab('history-second.json');
    expect(propertyInput('X').value).toBe('7');
    expect(buttonByText('重做').disabled).toBe(false);
  });

  it('does not add history or save for selection and inspector changes', async () => {
    const filePath = await writeJson('view-only.json', historyDocument);
    await openJson(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    await selectLayer('chip');

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="inspector-toggle"]')
        ?.click();
    });
    await settle();

    expect(buttonByText('撤销').disabled).toBe(true);
    expect(buttonByText('重做').disabled).toBe(true);

    await requestClose();
    expect(confirmCloseCalls).toBe(1);
    expect(writeLog).toHaveLength(0);
  });
});
