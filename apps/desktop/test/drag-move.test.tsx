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
import { findSceneNode, TestCanvasRegistry } from './test-canvas-engine';

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
  directory = await mkdtemp(path.join(tmpdir(), 'design-ai-drag-'));
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

const dragDocument = {
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
): Promise<boolean> {
  let accepted = false;
  await act(async () => {
    accepted = canvas.engine?.drag(id, from, to) ?? false;
  });
  await settle(3);
  return accepted;
}

async function requestClose(): Promise<void> {
  await act(async () => {
    for (const listener of closeListeners) {
      listener();
    }
  });
  await settle();
}

type SavedRectangle = Record<string, unknown> & {
  id: string;
  x?: number | string;
  y?: number | string;
};

interface SavedDocument {
  version: number;
  filePath: string;
  variables: unknown;
  children: Array<Record<string, unknown>>;
}

async function readSaved(filePath: string): Promise<SavedDocument> {
  return JSON.parse(await readFile(filePath, 'utf8')) as SavedDocument;
}

describe('dragging free-positioned elements', () => {
  it('previews and commits top-level and nested landings, then saves and reopens them', async () => {
    const filePath = await writeJson('drag.json', dragDocument);
    await openJson(filePath);
    await renderApp();
    await clickButton('打开设计稿');

    expect(await drag('top', { x: 10, y: 20 }, { x: 33.333, y: 20 })).toBe(
      true,
    );
    expect(propertyInput('X').value).toBe('33.33');
    expect(propertyInput('Y').value).toBe('20');

    // Card padding insets the declaration by 10 on each axis; y is unchanged
    // and keeps its variable reference.
    expect(await drag('chip', { x: 22, y: 28 }, { x: 30, y: 28 })).toBe(true);
    expect(propertyInput('X').value).toBe('20');
    expect(propertyInput('Y').value).toBe('18');

    await requestClose();

    expect(writeLog).toHaveLength(1);
    const saved = await readSaved(filePath);
    expect(saved.version).toBe(2);
    expect(saved.filePath).toBe(filePath);
    expect(saved.variables).toEqual(dragDocument.variables);
    expect(saved.children.map((child) => child.id)).toEqual(['top', 'board']);
    expect(saved.children[0] as SavedRectangle).toMatchObject({
      id: 'top',
      type: 'rectangle',
      x: 33.33,
      y: 20,
      width: 40,
      height: 30,
      fill: [{ type: 'color', color: '#dbeafe' }],
    });

    const board = saved.children[1];
    const card =
      board?.type === 'frame'
        ? (board.children as Array<Record<string, unknown>>)[0]
        : undefined;
    const chip =
      card?.type === 'frame'
        ? (card.children as Array<Record<string, unknown>>)[0]
        : undefined;
    expect(board?.children).toHaveLength(1);
    expect(card).toMatchObject({
      id: 'card',
      type: 'frame',
      layout: 'none',
      x: 20,
      y: 20,
      width: 200,
      height: 120,
      padding: [10, 10, 10, 10],
    });
    expect(card?.children).toHaveLength(1);
    expect(chip as SavedRectangle).toMatchObject({
      id: 'chip',
      type: 'rectangle',
      x: 20,
      y: '$chip-y',
      width: 80,
      height: 40,
    });

    await openJson(filePath);
    await clickButton('打开设计稿');
    const scene = canvas.engine?.scene;
    expect(findSceneNode(scene ?? null, 'top').box).toMatchObject({
      x: 33.33,
      y: 20,
    });
    expect(findSceneNode(scene ?? null, 'chip').box).toMatchObject({
      x: 30,
      y: 28,
    });
  });

  it('reports invalid landings and keeps the last valid document', async () => {
    const filePath = await writeJson('invalid-drag.json', dragDocument);
    await openJson(filePath);
    await renderApp();
    await clickButton('打开设计稿');

    expect(await drag('top', { x: 10, y: 20 }, { x: Number.NaN, y: 20 })).toBe(
      true,
    );
    expect(container.textContent).toContain('无法移动元素');
    expect(propertyInput('X').value).toBe('10');

    await requestClose();
    expect(writeLog).toHaveLength(0);
    const saved = await readSaved(filePath);
    expect(saved.children[0] as SavedRectangle).toMatchObject({
      id: 'top',
      x: 10,
      y: 20,
    });
  });
});
