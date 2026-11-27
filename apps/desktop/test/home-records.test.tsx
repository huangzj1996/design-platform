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
  vi,
} from 'vitest';
import { App } from '../src/electron-render/App';
import { readDesignFile } from '../src/electron-main/read-design-file';
import { DesignFileSaver } from '../src/electron-main/save-design-file';
import { SessionStore } from '../src/electron-main/session-store';
import {
  HOME_SESSION_TAB,
  type AppSession,
  type OpenDesignFileResult,
  type SaveDesignFileInput,
  type SaveDesignFileResult,
} from '../src/electron-preload/contract';
import { findSceneNode, TestCanvasRegistry } from './test-canvas-engine';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
let directory: string;
let sessionFilePath: string;
let sessionStore: SessionStore;
let saver: DesignFileSaver;
let openDesignFile: () => Promise<OpenDesignFileResult>;
let openAtCalls: string[];
let canvas: TestCanvasRegistry;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'design-ai-records-'));
  sessionFilePath = path.join(directory, 'userData', 'design-session.json');
  sessionStore = new SessionStore({ filePath: sessionFilePath });
  saver = new DesignFileSaver({ projectDirectory: directory });
  container = document.createElement('div');
  document.body.append(container);
  openDesignFile = async () => ({ status: 'cancelled' });
  openAtCalls = [];
  canvas = new TestCanvasRegistry();
});

afterEach(async () => {
  vi.useRealTimers();
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
      children: [
        {
          id: 'title',
          type: 'text',
          text: '旧标题',
          fontSize: 24,
          fill: '#111111',
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

async function renderApp(): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <App
        openDesignFile={() => openDesignFile()}
        openDesignFileAt={async (filePath): Promise<OpenDesignFileResult> => {
          openAtCalls.push(filePath);
          return readDesignFile(filePath);
        }}
        saveDesignFile={(
          input: SaveDesignFileInput,
        ): Promise<SaveDesignFileResult> => saver.save(input)}
        loadSession={() => sessionStore.load()}
        saveSession={(session) => sessionStore.save(session)}
        subscribeCloseRequest={() => () => {}}
        confirmClose={() => {}}
        saveDelayMs={60_000}
        createCanvasEngine={canvas.factory}
      />,
    );
  });
  await settle();
}

async function restartApp(): Promise<void> {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  container = document.createElement('div');
  document.body.append(container);
  openAtCalls = [];
  canvas = new TestCanvasRegistry();
  await renderApp();
}

async function settle(rounds = 25): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle(3);
}

async function clickButton(text: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) {
    throw new Error(`Button "${text}" not found`);
  }
  await click(button);
  await settle();
}

function cards(): HTMLElement[] {
  return [
    ...container.querySelectorAll<HTMLElement>('[data-testid="home-project"]'),
  ];
}

function cardPaths(): (string | undefined)[] {
  return cards().map((card) => card.dataset.filePath);
}

function cardTexts(): string[] {
  return cards().map(
    (card) => card.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  );
}

async function clickCard(filePath: string): Promise<void> {
  const card = cards().find(
    (candidate) => candidate.dataset.filePath === filePath,
  );
  if (card === undefined) {
    throw new Error(`Home record "${filePath}" not found`);
  }
  await click(card);
  await settle();
}

function activeTab(): HTMLButtonElement {
  const active = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].find((tab) => tab.getAttribute('aria-selected') === 'true');
  if (active === undefined) {
    throw new Error('No active tab');
  }
  return active;
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

function propertyInput(label: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    `[data-testid="property-panel"] [aria-label="${label}"]`,
  );
  if (input === null) {
    throw new Error(`Property input "${label}" not found`);
  }
  return input;
}

async function setInput(label: string, value: string): Promise<void> {
  const input = propertyInput(label);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input) as object,
      'value',
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function recent(
  records: { filePath: string; openedAt: string }[],
  active = HOME_SESSION_TAB,
): AppSession {
  return { activeTab: active, projects: [], recent: records };
}

describe('home file records', () => {
  it('shows actual file names, directories and open times in recent and file order', async () => {
    const now = Date.now();
    const alphaPath = await writeJson('alpha.json', frameWithText);
    const zetaPath = await writeJson('zeta.json', frameWithText);
    const folder = path.basename(directory);
    await sessionStore.save(
      recent([
        {
          filePath: alphaPath,
          openedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
        },
        {
          filePath: zetaPath,
          openedAt: new Date(now - 5 * 60 * 1000).toISOString(),
        },
      ]),
    );

    await renderApp();

    expect(cardPaths()).toEqual([zetaPath, alphaPath]);
    expect(cardTexts()[0]).toContain('zeta.json');
    expect(cardTexts()[0]).toContain(`${folder} /`);
    expect(cardTexts()[0]).toContain('打开于 5 分钟前');
    expect(cardTexts()[1]).toContain('打开于 2 小时前');

    await clickButton('文件');

    expect(cardPaths()).toEqual([alphaPath, zetaPath]);

    const gridTexts = cardTexts();
    const listToggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="列表视图"]',
    );
    if (listToggle === null) {
      throw new Error('List view toggle not found');
    }
    await click(listToggle);

    expect(cardPaths()).toEqual([alphaPath, zetaPath]);
    expect(cardTexts()).toEqual(gridTexts);
  });

  it('opens a record that is not an open tab and keeps it in recent after returning home', async () => {
    const boardPath = await writeJson('board.json', frameWithText);
    await sessionStore.save(
      recent([
        {
          filePath: boardPath,
          openedAt: '2026-11-22T10:30:00.000Z',
        },
      ]),
    );

    await renderApp();
    await clickCard(boardPath);

    expect(openAtCalls).toEqual([boardPath]);
    expect(activeTab().textContent).toContain('board.json');
    expect(sceneNode('title').text?.content).toBe('旧标题');

    await clickButton('主页');

    expect(cardPaths()).toEqual([boardPath]);
    expect(cardTexts()[0]).toContain('打开于 刚刚');
  });

  it('reuses a project tab and browses records again after a restart', async () => {
    const boardPath = await writeJson('board.json', frameWithText);
    const openedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await sessionStore.save({
      activeTab: HOME_SESSION_TAB,
      projects: [{ filePath: boardPath, openedAt }],
      recent: [{ filePath: boardPath, openedAt }],
    });

    await renderApp();

    expect(cards()).toHaveLength(1);
    await clickCard(boardPath);

    expect(openAtCalls).toEqual([boardPath]);
    expect(activeTab().textContent).toContain('board.json');
    expect(sceneNode('title').text?.content).toBe('旧标题');

    await clickButton('主页');
    await clickCard(boardPath);

    // The loaded tab is selected again instead of reopening its file.
    expect(openAtCalls).toEqual([boardPath]);
    expect(activeTab().textContent).toContain('board.json');

    await clickButton('主页');
    await restartApp();

    expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(cardPaths()).toEqual([boardPath]);
    expect(cardTexts()[0]).toContain('打开于 刚刚');

    await clickCard(boardPath);

    expect(openAtCalls).toEqual([boardPath]);
    expect(sceneNode('title').text?.content).toBe('旧标题');
  });

  it('lists the saved design instead of the imported Pencil source after saving', async () => {
    const penPath = path.join(directory, 'draft.pen');
    await writeFile(
      penPath,
      JSON.stringify({
        version: '2.25',
        children: [{ id: 'imported', type: 'text', content: '导入文案' }],
      }),
      'utf8',
    );
    openDesignFile = () => readDesignFile(penPath);

    await renderApp();
    await clickButton('打开设计稿');
    expect(activeTab().textContent).toContain('draft.pen');

    await click(layerRow('imported'));
    await setInput('文案', '导入后修改');
    await clickButton('主页');

    const savedPath = path.join(directory, '未命名.json');
    expect(cardPaths()).toEqual([savedPath]);
    expect(cardTexts()[0]).toContain('未命名.json');
    expect(container.textContent).not.toContain('draft.pen');

    await clickCard(savedPath);

    expect(openAtCalls).toEqual([]);
    expect(sceneNode('imported').text?.content).toBe('导入后修改');
  });
});
