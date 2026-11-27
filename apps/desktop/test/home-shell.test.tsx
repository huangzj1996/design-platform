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
import type {
  CreateDesignFileResult,
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
let failWrites: boolean;
let openDesignFile: () => Promise<OpenDesignFileResult>;
let createDesignFile: () => Promise<CreateDesignFileResult>;
let saveDesignFile: (
  input: SaveDesignFileInput,
) => Promise<SaveDesignFileResult>;
let canvas: TestCanvasRegistry;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'design-ai-home-'));
  container = document.createElement('div');
  document.body.append(container);
  writeLog = [];
  failWrites = false;
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

const frameWithText = {
  version: 2,
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
          textStyle: { content: '旧标题', fontSize: 24 },
          fill: [{ type: 'color', color: '#111111' }],
        },
      ],
    },
  ],
};

const secondDocument = {
  version: 2,
  children: [
    { id: 'second-title', type: 'text', textStyle: { content: '第二份标题' } },
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

async function renderApp(): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <App
        openDesignFile={() => openDesignFile()}
        createDesignFile={() => createDesignFile()}
        saveDesignFile={(input) => saveDesignFile(input)}
        createCanvasEngine={canvas.factory}
        subscribeCloseRequest={() => () => {}}
        confirmClose={() => {}}
        saveDelayMs={60_000}
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

function tabCreateButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    '[data-testid="tab-create"]',
  );
  if (button === null) {
    throw new Error('Tab add button not found');
  }
  return button;
}

async function readSavedTitle(filePath: string): Promise<unknown> {
  const saved = JSON.parse(
    await readFile(filePath, 'utf8'),
  ) as typeof frameWithText;
  return saved.children[0]?.children?.[0];
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

async function editTitle(text: string): Promise<void> {
  await click(layerRow('title'));
  await setInput('文案', text);
}

describe('home shell and project tabs', () => {
  it('switches the home view to list mode', async () => {
    await renderApp();

    const listToggle = container.querySelector<HTMLButtonElement>(
      '[aria-label="列表视图"]',
    );
    if (listToggle === null) {
      throw new Error('List view toggle not found');
    }
    await click(listToggle);
    expect(listToggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens a design from home into a project tab and reuses that tab', async () => {
    const filePath = await writeJson('board.json', frameWithText);
    await setOpenFile(filePath);
    await renderApp();

    await clickButton('打开设计稿');

    expect(container.querySelector('[data-testid="home"]')).toBeNull();
    expect(tabLabels()).toHaveLength(2);
    expect(activeTab().textContent).toContain('board.json');
    expect(sceneNode('title').text).toBe('旧标题');

    await clickTab('主页');
    expect(container.querySelector('[data-testid="home"]')).not.toBeNull();

    await clickButton('打开设计稿');

    expect(tabLabels()).toHaveLength(2);
    expect(activeTab().textContent).toContain('board.json');
    expect(sceneNode('title').text).toBe('旧标题');
  });

  it('imports a Pencil design from the home empty state', async () => {
    const penPath = path.join(directory, 'sample.pen');
    await writeFile(
      penPath,
      JSON.stringify({
        version: '2.25',
        children: [{ id: 'imported', type: 'text', content: '导入文案' }],
      }),
      'utf8',
    );
    await setOpenFile(penPath);
    await renderApp();

    await clickButton('导入 Pencil 设计稿');

    expect(container.querySelector('[data-testid="home"]')).toBeNull();
    expect(activeTab().textContent).toContain('sample.pen');
    expect(sceneNode('imported').text).toBe('导入文案');
  });

  it('creates a design from the tab add button and shows its file name when reopened from home', async () => {
    await renderApp();

    await click(tabCreateButton());

    const createdPath = path.join(directory, '未命名.json');
    expect(activeTab().textContent).toContain('新建聊天');
    expect(container.textContent).toContain('未命名.json');
    await expect(readFile(createdPath, 'utf8')).resolves.toContain(
      '"version": 2',
    );

    await clickTab('主页');
    expect(
      container.querySelector('[data-testid="home-project"]')?.textContent,
    ).toContain('未命名.json');

    await setOpenFile(createdPath);
    await clickButton('打开设计稿');

    expect(tabLabels()).toHaveLength(2);
    expect(tabLabels()[1]).toContain('未命名.json');
    expect(activeTab().textContent).toContain('未命名.json');
    expect(container.querySelector('[data-testid="home"]')).toBeNull();
  });

  it('reopens a created design from the home project list under its file name', async () => {
    await renderApp();
    await clickButton('新建设计稿');
    expect(activeTab().textContent).toContain('新建聊天');

    await clickTab('主页');
    const project = container.querySelector<HTMLElement>(
      '[data-testid="home-project"]',
    );
    if (project === null) {
      throw new Error('Home project card not found');
    }
    await click(project);
    await settle();

    expect(activeTab().textContent).toContain('未命名.json');
  });

  it('saves pending edits before returning home and keeps them in the tab', async () => {
    const filePath = await writeJson('draft.json', frameWithText);
    await setOpenFile(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    await editTitle('离开前保存');

    await clickTab('主页');

    expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(writeLog).toHaveLength(1);
    expect(await readSavedTitle(filePath)).toMatchObject({
      textStyle: { content: '离开前保存' },
    });

    await clickTab('draft.json');
    expect(sceneNode('title').text).toBe('离开前保存');
  });

  it('saves the current design before creating another one from the tab bar', async () => {
    const filePath = await writeJson('before-create.json', frameWithText);
    await setOpenFile(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    await editTitle('新建前保存');

    await click(tabCreateButton());
    await settle();

    expect(tabLabels()).toHaveLength(3);
    expect(activeTab().textContent).toContain('新建聊天');
    expect(writeLog).toHaveLength(1);
    expect(await readSavedTitle(filePath)).toMatchObject({
      textStyle: { content: '新建前保存' },
    });
  });

  it('stays in the editor when saving before home fails, then returns home after retry', async () => {
    const filePath = await writeJson('failed-home.json', frameWithText);
    await setOpenFile(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    await editTitle('失败后仍保留');

    failWrites = true;
    await clickTab('主页');

    expect(container.querySelector('[data-testid="home"]')).toBeNull();
    expect(activeTab().textContent).toContain('failed-home.json');
    expect(sceneNode('title').text).toBe('失败后仍保留');
    expect(
      container.querySelector('[data-testid="save-error"]'),
    ).not.toBeNull();

    failWrites = false;
    await clickButton('重试保存');

    expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="save-error"]')).toBeNull();
    expect(await readSavedTitle(filePath)).toMatchObject({
      textStyle: { content: '失败后仍保留' },
    });
  });

  it('stays on the current project when a save before switching tabs fails, then switches after retry', async () => {
    const firstPath = await writeJson('first.json', frameWithText);
    const secondPath = await writeJson('second.json', secondDocument);
    await setOpenFile(firstPath);
    await renderApp();
    await clickButton('打开设计稿');

    await setOpenFile(secondPath);
    const fileMenuToggle = container.querySelector<HTMLElement>(
      '[data-testid="file-actions-toggle"]',
    );
    if (fileMenuToggle === null) {
      throw new Error('File menu toggle not found');
    }
    await click(fileMenuToggle);
    await clickButton('打开设计稿');
    expect(activeTab().textContent).toContain('second.json');

    await clickTab('first.json');
    await editTitle('切换前保存');

    failWrites = true;
    await clickTab('second.json');

    expect(activeTab().textContent).toContain('first.json');
    expect(sceneNode('title').text).toBe('切换前保存');
    expect(
      container.querySelector('[data-testid="save-error"]'),
    ).not.toBeNull();

    failWrites = false;
    await clickButton('重试保存');

    expect(activeTab().textContent).toContain('second.json');
    expect(sceneNode('second-title').text).toBe('第二份标题');
    expect(await readSavedTitle(firstPath)).toMatchObject({
      textStyle: { content: '切换前保存' },
    });
  });

  it('keeps the home tab and shows the reason when an open fails', async () => {
    const invalidPath = path.join(directory, 'broken.json');
    await writeFile(invalidPath, '{ not json', 'utf8');
    await setOpenFile(invalidPath);
    await renderApp();

    await clickButton('打开设计稿');

    expect(container.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(tabLabels()).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'invalid_json',
    );
  });
});
