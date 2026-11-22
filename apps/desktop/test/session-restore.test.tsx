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
  vi,
} from 'vitest';
import { App } from '../src/electron-render/App';
import { createDesignFile as createBlankDesignFile } from '../src/electron-main/create-design-file';
import { readDesignFile } from '../src/electron-main/read-design-file';
import { DesignFileSaver } from '../src/electron-main/save-design-file';
import { SessionStore } from '../src/electron-main/session-store';
import {
  HOME_SESSION_TAB,
  type AppSession,
  CreateDesignFileResult,
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
let sessionStore: SessionStore;
let sessionFilePath: string;
let writeLog: string[];
let failWrites: boolean;
let openDesignFile: () => Promise<OpenDesignFileResult>;
let openAtCalls: string[];
let createDesignFile: () => Promise<CreateDesignFileResult>;
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
  directory = await mkdtemp(path.join(tmpdir(), 'design-ai-session-ui-'));
  sessionFilePath = path.join(directory, 'userData', 'design-session.json');
  sessionStore = new SessionStore({ filePath: sessionFilePath });
  container = document.createElement('div');
  document.body.append(container);
  writeLog = [];
  failWrites = false;
  confirmCloseCalls = 0;
  openAtCalls = [];
  closeListeners = new Set();
  canvas = new TestCanvasRegistry();

  saver = new DesignFileSaver({
    projectDirectory: directory,
    dependencies: {
      writeFile: async (target, contents, options) => {
        if (failWrites) {
          throw new Error('磁盘已满');
        }
        writeLog.push(contents);
        await writeFile(target, contents, options);
      },
    },
  });

  openDesignFile = async () => ({ status: 'cancelled' });
  createDesignFile = async () => {
    const result = await createBlankDesignFile(directory);
    if (result.status === 'created') {
      saver.rememberSaved(result.filePath, result.document);
    }
    return result;
  };
  saveDesignFile = (input) => saver.save(input);
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => {
    root.unmount();
  });
  container.remove();
  await rm(directory, { recursive: true, force: true });
});

const firstDesign = {
  version: 1,
  children: [
    {
      id: 'first-frame',
      type: 'frame',
      layout: 'vertical',
      width: 400,
      height: 300,
      children: [{ id: 'first-title', type: 'text', text: '第一份标题' }],
    },
  ],
};

const secondDesign = {
  version: 1,
  children: [{ id: 'second-title', type: 'text', text: '第二份标题' }],
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

async function openDesign(filePath: string): Promise<void> {
  await setOpenFile(filePath);
  await clickButton('打开设计稿');
}

async function openDesignAt(filePath: string): Promise<OpenDesignFileResult> {
  openAtCalls.push(filePath);
  const result = await readDesignFile(filePath);
  if (result.status === 'opened') {
    saver.rememberSaved(result.filePath, result.document);
  }
  return result;
}

async function renderApp(): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <App
        openDesignFile={() => openDesignFile()}
        openDesignFileAt={(filePath) => openDesignAt(filePath)}
        createDesignFile={() => createDesignFile()}
        saveDesignFile={(input) => saveDesignFile(input)}
        loadSession={() => sessionStore.load()}
        saveSession={(session) => sessionStore.save(session)}
        subscribeCloseRequest={(listener) => {
          closeListeners.add(listener);
          return () => closeListeners.delete(listener);
        }}
        confirmClose={() => {
          confirmCloseCalls += 1;
        }}
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
  confirmCloseCalls = 0;
  closeListeners.clear();
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

function buttonByText(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) {
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

function tabButtons(): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
}

function tabLabels(): string[] {
  return tabButtons().map((tab) => tab.textContent?.trim() ?? '');
}

function activeTab(): HTMLButtonElement {
  const active = tabButtons().find(
    (tab) => tab.getAttribute('aria-selected') === 'true',
  );
  if (active === undefined) {
    throw new Error('No active tab');
  }
  return active;
}

async function clickTab(label: string): Promise<void> {
  const tab = tabButtons().find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (tab === undefined) {
    throw new Error(`Tab "${label}" not found`);
  }
  await click(tab);
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

function expectTimestamp(value: string | undefined): void {
  expect(value).toBeDefined();
  expect(Number.isNaN(Date.parse(value ?? ''))).toBe(false);
}

describe('session restore', () => {
  it('starts on the home tab when there is no stored session', async () => {
    await renderApp();

    expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(activeTab().textContent).toContain('主页');
    expect(tabLabels()).toHaveLength(1);

    await requestClose();

    expect(confirmCloseCalls).toBe(1);
    await expect(sessionStore.load()).resolves.toEqual({
      activeTab: HOME_SESSION_TAB,
      projects: [],
      recent: [],
    });
  });

  it('restores the design and selected tab after closing from the editor', async () => {
    const filePath = await writeJson('board.json', firstDesign);
    await renderApp();
    await openDesign(filePath);
    expect(sceneNode('first-title').text?.content).toBe('第一份标题');

    await requestClose();

    expect(confirmCloseCalls).toBe(1);
    const session = await sessionStore.load();
    expect(session.activeTab).toBe(filePath);
    expect(session.projects).toHaveLength(1);
    expect(session.projects[0]?.filePath).toBe(filePath);
    expectTimestamp(session.projects[0]?.openedAt);
    expect(session.recent[0]?.filePath).toBe(filePath);
    expectTimestamp(session.recent[0]?.openedAt);

    await restartApp();

    expect(container.querySelector('[data-testid="home"]')).toBeNull();
    expect(activeTab().textContent).toContain('board.json');
    expect(sceneNode('first-title').text?.content).toBe('第一份标题');
    expect(openAtCalls).toEqual([filePath]);
    expect(confirmCloseCalls).toBe(0);
  });

  it('restores the home page and every project tab after closing from home', async () => {
    const firstPath = await writeJson('first.json', firstDesign);
    const secondPath = await writeJson('second.json', secondDesign);
    await renderApp();
    await openDesign(firstPath);
    await openDesign(secondPath);
    await clickTab('主页');

    await requestClose();

    const session = await sessionStore.load();
    expect(session.activeTab).toBe(HOME_SESSION_TAB);
    expect(session.projects.map((project) => project.filePath)).toEqual([
      firstPath,
      secondPath,
    ]);
    expect(session.recent.map((project) => project.filePath)).toEqual([
      secondPath,
      firstPath,
    ]);
    for (const project of session.projects) {
      expectTimestamp(project.openedAt);
    }

    await restartApp();

    expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(activeTab().textContent).toContain('主页');
    expect(tabLabels()).toHaveLength(3);
    expect(tabLabels()[1]).toContain('first.json');
    expect(tabLabels()[2]).toContain('second.json');
    // The stored tabs stay unloaded until the user selects them.
    expect(openAtCalls).toEqual([]);
    expect(hasSceneNode(canvas.engine?.scene ?? null, 'first-title')).toBe(
      false,
    );

    await clickTab('first.json');
    expect(openAtCalls).toEqual([firstPath]);
    expect(sceneNode('first-title').text?.content).toBe('第一份标题');

    await clickTab('second.json');
    expect(openAtCalls).toEqual([firstPath, secondPath]);
    expect(sceneNode('second-title').text?.content).toBe('第二份标题');
  });

  it('restores the active project and loads other tabs only when selected', async () => {
    const firstPath = await writeJson('first.json', firstDesign);
    const secondPath = await writeJson('second.json', secondDesign);
    await renderApp();
    await openDesign(firstPath);
    await openDesign(secondPath);

    await requestClose();
    await restartApp();

    expect(activeTab().textContent).toContain('second.json');
    expect(sceneNode('second-title').text?.content).toBe('第二份标题');
    expect(openAtCalls).toEqual([secondPath]);
    expect(hasSceneNode(canvas.engine?.scene ?? null, 'first-title')).toBe(
      false,
    );

    await clickTab('first.json');

    expect(openAtCalls).toEqual([secondPath, firstPath]);
    expect(sceneNode('first-title').text?.content).toBe('第一份标题');
  });

  it('returns home with the reason when the active restore target is missing', async () => {
    const existingPath = await writeJson('existing.json', firstDesign);
    const missingPath = path.join(directory, 'missing.json');
    const openedAt = '2026-11-22T10:30:00.000Z';
    await sessionStore.save({
      activeTab: missingPath,
      projects: [
        { filePath: existingPath, openedAt },
        { filePath: missingPath, openedAt },
      ],
      recent: [{ filePath: missingPath, openedAt }],
    } satisfies AppSession);

    await renderApp();

    expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(activeTab().textContent).toContain('主页');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'file_read_error',
    );
    expect(tabLabels()).toHaveLength(3);
    expect(openAtCalls).toEqual([missingPath]);
  });

  it('returns home with the reason when the restore target cannot be parsed', async () => {
    const brokenPath = path.join(directory, 'broken.json');
    await writeFile(brokenPath, '{ not json', 'utf8');
    const openedAt = '2026-11-22T10:30:00.000Z';
    await sessionStore.save({
      activeTab: brokenPath,
      projects: [{ filePath: brokenPath, openedAt }],
      recent: [{ filePath: brokenPath, openedAt }],
    } satisfies AppSession);

    await renderApp();

    expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'invalid_json',
    );
    expect(openAtCalls).toEqual([brokenPath]);
  });

  it('returns home with the reason when a restored tab is missing on demand', async () => {
    const existingPath = await writeJson('existing.json', firstDesign);
    const missingPath = path.join(directory, 'missing.json');
    const openedAt = '2026-11-22T10:30:00.000Z';
    await sessionStore.save({
      activeTab: existingPath,
      projects: [
        { filePath: existingPath, openedAt },
        { filePath: missingPath, openedAt },
      ],
      recent: [
        { filePath: existingPath, openedAt },
        { filePath: missingPath, openedAt },
      ],
    } satisfies AppSession);

    await renderApp();
    expect(sceneNode('first-title').text?.content).toBe('第一份标题');
    expect(openAtCalls).toEqual([existingPath]);

    await clickTab('missing.json');

    expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(activeTab().textContent).toContain('主页');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'file_read_error',
    );
    expect(openAtCalls).toEqual([existingPath, missingPath]);
  });

  it('keeps the editor open when the save before close fails and restores after retry', async () => {
    const filePath = await writeJson('close.json', firstDesign);
    await renderApp();
    await openDesign(filePath);
    await click(layerRow('first-title'));
    await setInput('文案', '关闭前保存');

    failWrites = true;
    await requestClose();

    expect(confirmCloseCalls).toBe(0);
    expect(
      container.querySelector('[data-testid="save-error"]'),
    ).not.toBeNull();
    expect(sceneNode('first-title').text?.content).toBe('关闭前保存');

    failWrites = false;
    await clickButton('重试保存');

    expect(confirmCloseCalls).toBe(1);
    expect(container.querySelector('[data-testid="save-error"]')).toBeNull();
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toMatchObject({
      children: [
        {
          children: [{ id: 'first-title', text: '关闭前保存' }],
        },
      ],
    });

    await restartApp();

    expect(activeTab().textContent).toContain('close.json');
    expect(sceneNode('first-title').text?.content).toBe('关闭前保存');
  });
});
