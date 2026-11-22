// @vitest-environment jsdom

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
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
let failWrites: boolean;
let openDesignFile: () => Promise<OpenDesignFileResult>;
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
  directory = await mkdtemp(path.join(tmpdir(), 'design-ai-workflow-'));
  container = document.createElement('div');
  document.body.append(container);
  writeLog = [];
  failWrites = false;
  confirmCloseCalls = 0;
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
      padding: [16, 16, 16, 16],
      fill: '#ffffff',
      children: [
        {
          id: 'title',
          type: 'text',
          text: '旧标题',
          fontSize: 24,
          fill: '#111111',
        },
        { id: 'caption', type: 'text', text: '说明文字' },
      ],
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

async function renderApp({
  saveDelayMs,
}: { saveDelayMs?: number } = {}): Promise<void> {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <App
        openDesignFile={() => openDesignFile()}
        createDesignFile={() => createDesignFile()}
        saveDesignFile={(input) => saveDesignFile(input)}
        subscribeCloseRequest={(listener) => {
          closeListeners.add(listener);
          return () => closeListeners.delete(listener);
        }}
        confirmClose={() => {
          confirmCloseCalls += 1;
        }}
        saveDelayMs={saveDelayMs}
        createCanvasEngine={canvas.factory}
      />,
    );
  });
}

async function settle(rounds = 25): Promise<void> {
  if (vi.isFakeTimers()) {
    await act(async () => {
      for (let round = 0; round < rounds; round += 1) {
        await Promise.resolve();
      }
    });
    return;
  }

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

async function click(element: HTMLElement | Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
  });
  await settle(3);
}

async function clickButton(text: string): Promise<void> {
  await click(buttonByText(text));
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

function sceneNode(id: string) {
  return findSceneNode(canvas.engine?.scene ?? null, id);
}

function control(testId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`,
  );
  if (element === null) {
    throw new Error(`Control "${testId}" not found`);
  }
  return element;
}

async function tapCanvas(id: string | null): Promise<void> {
  await act(async () => {
    canvas.tap(id);
  });
  await settle(3);
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

async function requestClose(): Promise<void> {
  await act(async () => {
    for (const listener of closeListeners) {
      listener();
    }
  });
  await settle();
}

function savedFileAsText(contents: string): unknown {
  return JSON.parse(contents);
}

describe('desktop editing workflow', () => {
  it('creates a blank file immediately and assigns distinct default names', async () => {
    await renderApp();

    expect(
      container.querySelector('[data-testid="home-empty"]'),
    ).not.toBeNull();
    await clickButton('新建设计稿');

    expect(container.textContent).toContain('未命名.json');
    expect(container.textContent).toContain('空白设计稿');
    const first = JSON.parse(
      await readFile(path.join(directory, '未命名.json'), 'utf8'),
    ) as { version: number; children: unknown[]; filePath: string };
    expect(first.version).toBe(1);
    expect(first.children).toEqual([]);
    expect(first.filePath).toBe(path.join(directory, '未命名.json'));

    await clickButton('新建设计稿');
    expect(container.textContent).toContain('未命名-2.json');

    const names = (await readdir(directory)).sort();
    expect(names).toContain('未命名.json');
    expect(names).toContain('未命名-2.json');
    const second = JSON.parse(
      await readFile(path.join(directory, '未命名-2.json'), 'utf8'),
    ) as { filePath: string };
    expect(second.filePath).toBe(path.join(directory, '未命名-2.json'));
  });

  it('creates, edits, selects and deletes elements, then reopens the saved result', async () => {
    const filePath = await writeJson('editable.json', frameWithText);
    await setOpenFile(filePath);
    await renderApp();
    await clickButton('打开设计稿');

    expect(sceneNode('title').text?.content).toBe('旧标题');
    expect(container.textContent).toContain('未选择元素');

    // Canvas clicks and layer-tree clicks select the same element.
    await tapCanvas('caption');
    expect(canvas.engine?.selection?.id).toBe('caption');
    expect(
      container.querySelector('[data-testid="property-panel"]')?.textContent,
    ).toContain('caption');
    await click(layerRow('title'));
    expect(canvas.engine?.selection?.id).toBe('title');
    expect(propertyInput('文案').value).toBe('旧标题');

    // A local text edit keeps the other fields and updates the canvas.
    await setInput('文案', '新标题');
    expect(sceneNode('title').text?.content).toBe('新标题');
    expect(propertyInput('字号').value).toBe('24');

    // Container spacing changes update the canvas layout.
    await click(layerRow('main'));
    const captionBefore = sceneNode('caption').box.y;
    await setInput('间距', '24');
    expect(sceneNode('caption').box.y).toBeGreaterThan(captionBefore);
    await setInput('填充颜色', '#00ff00');
    expect(sceneNode('main').fill).toBe('#00ff00');

    // New title at the root, a new container, and a child inside it.
    await click(control('tool-text'));
    expect(sceneNode('text-1').text?.content).toBe('标题');
    await click(control('tool-frame'));
    await click(layerRow('frame-1'));
    await clickButton('添加文字');
    expect(layerRow('text-2') !== null).toBe(true);
    expect(
      container.querySelector(
        '[data-layer-id="frame-1"] [data-layer-id="text-2"]',
      ),
    ).not.toBeNull();

    // Deleting the container removes all descendants but keeps siblings.
    await click(layerRow('frame-1'));
    await clickButton('删除元素');
    expect(container.querySelector('[data-layer-id="frame-1"]')).toBeNull();
    expect(container.querySelector('[data-layer-id="text-2"]')).toBeNull();
    expect(container.querySelector('[data-layer-id="text-1"]')).not.toBeNull();
    expect(canvas.engine?.selection).toBeNull();
    expect(hasSceneNode(canvas.engine?.scene ?? null, 'frame-1')).toBe(false);
    expect(sceneNode('title').text?.content).toBe('新标题');

    // Closing flushes the debounced save before confirming the close.
    await requestClose();
    expect(confirmCloseCalls).toBe(1);
    expect(writeLog.length).toBeGreaterThan(0);

    const reopened = await readDesignFile(filePath);
    expect(reopened.status).toBe('opened');
    if (reopened.status !== 'opened') {
      return;
    }
    const main = reopened.document.children.find(
      (child) => child.id === 'main',
    );
    expect(main).toMatchObject({ gap: 24, fill: '#00ff00' });
    expect(
      main?.type === 'frame' ? main.children?.map((child) => child.id) : [],
    ).toEqual(['title', 'caption']);
    expect(
      main?.type === 'frame' ? main.children?.[0] : undefined,
    ).toMatchObject({ text: '新标题', fontSize: 24, fill: '#111111' });
    expect(reopened.document.children.map((child) => child.id)).toEqual([
      'main',
      'text-1',
    ]);

    // Reopening starts with no selection and shows the saved content.
    await setOpenFile(filePath);
    await clickButton('打开设计稿');
    expect(container.textContent).toContain('未选择元素');
    expect(sceneNode('title').text?.content).toBe('新标题');
    expect(container.querySelector('[data-layer-id="frame-1"]')).toBeNull();
  });

  it('starts the two-second save timer after the last edit and ignores selections', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const filePath = await writeJson('debounce.json', frameWithText);
    await setOpenFile(filePath);
    const saveCalls: SaveDesignFileInput[] = [];
    saveDesignFile = async (input) => {
      saveCalls.push(input);
      return {
        status: 'skipped',
        filePath: input.filePath ?? filePath,
        fingerprint: 'stub',
      };
    };
    await renderApp({ saveDelayMs: 2000 });

    await clickButton('打开设计稿');
    await click(layerRow('title'));
    await tapCanvas('caption');
    await tapCanvas('title');
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(saveCalls).toHaveLength(0);

    await setInput('文案', '第一次编辑');
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(saveCalls).toHaveLength(0);

    await setInput('文案', '最后一次编辑');
    await act(async () => {
      vi.advanceTimersByTime(1999);
      await Promise.resolve();
    });
    expect(saveCalls).toHaveLength(0);

    await act(async () => {
      vi.advanceTimersByTime(1);
      for (let round = 0; round < 10; round += 1) {
        await Promise.resolve();
      }
    });
    expect(saveCalls).toHaveLength(1);
    expect(
      saveCalls[0]?.document.children[0]?.type === 'frame'
        ? saveCalls[0].document.children[0].children?.[0]
        : undefined,
    ).toMatchObject({ text: '最后一次编辑' });
  });

  it('skips the write when the content is restored to the saved snapshot', async () => {
    const filePath = await writeJson('restore.json', frameWithText);
    await setOpenFile(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    await click(layerRow('title'));

    await setInput('文案', '临时修改');
    await setInput('文案', '旧标题');
    await requestClose();

    expect(confirmCloseCalls).toBe(1);
    expect(writeLog).toHaveLength(0);
  });

  it('flushes a pending save on close and keeps ids, order and styles on reopen', async () => {
    const filePath = await writeJson('close.json', frameWithText);
    await setOpenFile(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    await click(layerRow('title'));
    await setInput('文案', '关闭前保存');

    await requestClose();

    expect(confirmCloseCalls).toBe(1);
    const saved = savedFileAsText(await readFile(filePath, 'utf8')) as {
      filePath: string;
      children: Array<{ children: unknown[] }>;
    };
    expect(saved.filePath).toBe(filePath);
    const reopened = await readDesignFile(filePath);
    expect(reopened.status).toBe('opened');
    if (reopened.status === 'opened') {
      expect(
        reopened.document.children[0]?.type === 'frame'
          ? reopened.document.children[0].children?.map((child) => child.id)
          : [],
      ).toEqual(['title', 'caption']);
    }
  });

  it('saves the current draft before switching and applies the opened document', async () => {
    const firstPath = await writeJson('first.json', frameWithText);
    const secondPath = await writeJson('second.json', {
      version: 1,
      children: [{ id: 'second-title', type: 'text', text: '第二份标题' }],
    });
    await setOpenFile(firstPath);
    await renderApp();
    await clickButton('打开设计稿');
    await click(layerRow('title'));
    await setInput('文案', '切换前保存');

    const secondResult = await readDesignFile(secondPath);
    openDesignFile = async () => secondResult;
    await clickButton('打开设计稿');

    expect(container.textContent).toContain('第二份标题');
    expect(container.textContent).not.toContain('切换前保存');
    const reopened = await readDesignFile(firstPath);
    expect(reopened.status).toBe('opened');
    if (reopened.status === 'opened') {
      expect(
        reopened.document.children[0]?.type === 'frame'
          ? reopened.document.children[0].children?.[0]
          : undefined,
      ).toMatchObject({ text: '切换前保存' });
    }
  });

  it('keeps edits and the last complete file after a failed close save, then retries', async () => {
    const filePath = await writeJson('failure.json', frameWithText);
    await setOpenFile(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    await click(layerRow('title'));
    await setInput('文案', '失败后的编辑');

    failWrites = true;
    await requestClose();

    expect(confirmCloseCalls).toBe(0);
    expect(
      container.querySelector('[data-testid="save-error"]'),
    ).not.toBeNull();
    expect(sceneNode('title').text?.content).toBe('失败后的编辑');
    const onDisk = JSON.parse(await readFile(filePath, 'utf8')) as {
      children: Array<{ children: Array<{ text: string }> }>;
    };
    expect(onDisk.children[0]?.children[0]?.text).toBe('旧标题');

    failWrites = false;
    await clickButton('重试保存');

    expect(confirmCloseCalls).toBe(1);
    expect(container.querySelector('[data-testid="save-error"]')).toBeNull();
    const retried = JSON.parse(await readFile(filePath, 'utf8')) as {
      children: Array<{ children: Array<{ text: string }> }>;
    };
    expect(retried.children[0]?.children[0]?.text).toBe('失败后的编辑');
  });

  it('waits for a successful retry before switching after a failed save', async () => {
    const firstPath = await writeJson('pending-first.json', frameWithText);
    const secondPath = await writeJson('pending-second.json', {
      version: 1,
      children: [{ id: 'pending-second', type: 'text', text: '待切换标题' }],
    });
    await setOpenFile(firstPath);
    await renderApp();
    await clickButton('打开设计稿');
    await click(layerRow('title'));
    await setInput('文案', '切换前的编辑');

    failWrites = true;
    const secondResult = await readDesignFile(secondPath);
    openDesignFile = async () => secondResult;
    await clickButton('打开设计稿');

    expect(container.textContent).toContain('切换前的编辑');
    expect(container.textContent).not.toContain('待切换标题');
    expect(
      container.querySelector('[data-testid="save-error"]'),
    ).not.toBeNull();

    failWrites = false;
    await clickButton('重试保存');

    expect(container.textContent).toContain('待切换标题');
    expect(container.textContent).toContain('pending-second.json');
    const savedFirst = await readDesignFile(firstPath);
    expect(savedFirst.status).toBe('opened');
    if (savedFirst.status === 'opened') {
      expect(
        savedFirst.document.children[0]?.type === 'frame'
          ? savedFirst.document.children[0].children?.[0]
          : undefined,
      ).toMatchObject({ text: '切换前的编辑' });
    }
  });

  it('keeps variables and their bindings when another element is edited', async () => {
    const filePath = await writeJson('variables.json', {
      version: 1,
      variables: {
        'label-title': { type: 'string', value: '变量标题' },
        'color-brand': { type: 'color', value: '#3366ff' },
      },
      children: [
        {
          id: 'variables-frame',
          type: 'frame',
          layout: 'vertical',
          width: 320,
          height: 200,
          gap: 8,
          children: [
            {
              id: 'bound-title',
              type: 'text',
              text: '$label-title',
              fill: '$color-brand',
            },
            { id: 'caption', type: 'text', text: '普通说明' },
          ],
        },
      ],
    });
    await setOpenFile(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    expect(sceneNode('bound-title').text?.content).toBe('变量标题');

    await click(layerRow('caption'));
    await setInput('文案', '编辑后的说明');
    await requestClose();

    const reopened = await readDesignFile(filePath);
    expect(reopened.status).toBe('opened');
    if (reopened.status !== 'opened') {
      return;
    }
    expect(reopened.document.variables).toEqual({
      'label-title': { type: 'string', value: '变量标题' },
      'color-brand': { type: 'color', value: '#3366ff' },
    });
    const frame = reopened.document.children[0];
    if (frame?.type !== 'frame') {
      throw new Error('Expected the variables frame');
    }
    expect(frame.children?.[0]).toMatchObject({
      id: 'bound-title',
      text: '$label-title',
      fill: '$color-brand',
    });
    expect(frame.children?.[1]).toMatchObject({
      id: 'caption',
      text: '编辑后的说明',
    });

    await click(layerRow('bound-title'));
    expect(propertyInput('文案').value).toBe('$label-title');
    expect(sceneNode('bound-title').text?.content).toBe('变量标题');
  });

  it('records the new absolute path when a saved design with variables is moved and reopened', async () => {
    const originalDirectory = path.join(directory, 'original');
    const movedDirectory = path.join(directory, 'moved');
    await mkdir(originalDirectory, { recursive: true });
    await mkdir(movedDirectory, { recursive: true });
    const originalPath = path.join(originalDirectory, 'moved.json');
    const movedPath = path.join(movedDirectory, 'moved.json');
    const savedVariables = {
      'label-title': { type: 'string', value: '变量标题' },
      'color-brand': { type: 'color', value: '#3366ff' },
    };
    await writeFile(
      originalPath,
      JSON.stringify({
        version: 1,
        filePath: originalPath,
        variables: savedVariables,
        children: [
          {
            id: 'moved-frame',
            type: 'frame',
            layout: 'vertical',
            width: 320,
            height: 200,
            gap: 8,
            children: [
              {
                id: 'bound-title',
                type: 'text',
                text: '$label-title',
                fill: '$color-brand',
              },
              { id: 'caption', type: 'text', text: '移动前说明' },
            ],
          },
        ],
      }),
      'utf8',
    );
    await rename(originalPath, movedPath);

    const saveCalls: SaveDesignFileInput[] = [];
    const saveThroughSaver = saveDesignFile;
    saveDesignFile = (input) => {
      saveCalls.push(input);
      return saveThroughSaver(input);
    };

    await setOpenFile(movedPath);
    await renderApp();
    await clickButton('打开设计稿');

    // Opening the moved file and changing only the selection skips the write.
    expect(sceneNode('bound-title').text?.content).toBe('变量标题');
    await click(layerRow('caption'));
    expect(writeLog).toHaveLength(0);

    await setInput('文案', '移动后说明');
    await requestClose();

    expect(confirmCloseCalls).toBe(1);
    expect(saveCalls).toHaveLength(1);
    expect(saveCalls[0]?.filePath).toBe(movedPath);
    expect(saveCalls[0]?.document.filePath).toBe(movedPath);

    // The written snapshot and its target path agree and keep variables.
    const written = savedFileAsText(await readFile(movedPath, 'utf8')) as {
      filePath: string;
      variables: unknown;
      children: Array<{ children: Array<Record<string, unknown>> }>;
    };
    expect(written.filePath).toBe(movedPath);
    expect(written.variables).toEqual(savedVariables);
    expect(written.children[0]?.children[0]).toMatchObject({
      id: 'bound-title',
      text: '$label-title',
      fill: '$color-brand',
    });

    // Reopening the saved file keeps elements and variable references usable.
    const reopened = await readDesignFile(movedPath);
    expect(reopened.status).toBe('opened');
    if (reopened.status !== 'opened') {
      return;
    }
    expect(reopened.document.filePath).toBe(movedPath);
    expect(reopened.document.variables).toEqual(savedVariables);

    await setOpenFile(movedPath);
    await clickButton('打开设计稿');
    expect(sceneNode('bound-title').text?.content).toBe('变量标题');
    expect(sceneNode('caption').text?.content).toBe('移动后说明');

    // Restoring the reopened document's saved content still skips the write.
    await click(layerRow('caption'));
    await setInput('文案', '临时修改');
    await setInput('文案', '移动后说明');
    await requestClose();
    expect(confirmCloseCalls).toBe(2);
    expect(writeLog).toHaveLength(1);
  });

  it('flushes before reading when the current file is reopened', async () => {
    const filePath = await writeJson('reopen-same.json', frameWithText);
    await setOpenFile(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    await click(layerRow('title'));
    await setInput('文案', '重开前的编辑');

    // Reading on demand means the reopened document sees the flushed write.
    openDesignFile = () => readDesignFile(filePath);
    await clickButton('打开设计稿');

    expect(sceneNode('title').text?.content).toBe('重开前的编辑');
    expect(container.textContent).toContain('未选择元素');
  });

  it('saves edits made while a write is in flight before confirming close', async () => {
    const filePath = await writeJson('in-flight.json', frameWithText);
    await setOpenFile(filePath);
    const snapshots: SaveDesignFileInput[] = [];
    let releaseFirstWrite: () => void = () => {};
    let markSaveStarted: () => void = () => {};
    const firstSaveStarted = new Promise<void>((resolve) => {
      markSaveStarted = resolve;
    });
    saveDesignFile = async (input) => {
      snapshots.push(input);
      if (snapshots.length === 1) {
        markSaveStarted();
        await new Promise<void>((resolve) => {
          releaseFirstWrite = resolve;
        });
      }
      return {
        status: 'skipped',
        filePath: input.filePath ?? filePath,
        fingerprint: 'stub',
      };
    };
    await renderApp({ saveDelayMs: 10 });
    await clickButton('打开设计稿');
    await click(layerRow('title'));

    await setInput('文案', '写入中的第一次编辑');
    await firstSaveStarted;
    await setInput('文案', '写入期间的新编辑');
    releaseFirstWrite();
    await settle();

    expect(snapshots).toHaveLength(2);
    expect(
      snapshots[0]?.document.children[0]?.type === 'frame'
        ? snapshots[0].document.children[0].children?.[0]
        : undefined,
    ).toMatchObject({ text: '写入中的第一次编辑' });
    expect(
      snapshots[1]?.document.children[0]?.type === 'frame'
        ? snapshots[1].document.children[0].children?.[0]
        : undefined,
    ).toMatchObject({ text: '写入期间的新编辑' });

    // With the latest content saved, closing no longer needs another write.
    await requestClose();
    expect(confirmCloseCalls).toBe(1);
    expect(snapshots).toHaveLength(2);
  });

  it('assigns a default path when an imported draft is first saved', async () => {
    const penPath = path.join(directory, 'draft.pen');
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
    await clickButton('打开设计稿');
    expect(container.textContent).toContain('draft.pen');
    expect(container.textContent).toContain('未保存');

    await click(layerRow('imported'));
    await setInput('文案', '导入后修改');
    await requestClose();

    expect(confirmCloseCalls).toBe(1);
    const savedPath = path.join(directory, '未命名.json');
    const saved = JSON.parse(await readFile(savedPath, 'utf8')) as {
      filePath: string;
      children: Array<{ id: string; text: string }>;
    };
    expect(saved.filePath).toBe(savedPath);
    expect(saved.children[0]).toMatchObject({
      id: 'imported',
      text: '导入后修改',
    });
  });

  it('writes named variable definitions and references when an imported draft first saves', async () => {
    const penPath = path.join(directory, 'variable-draft.pen');
    await writeFile(
      penPath,
      JSON.stringify({
        version: '2.25',
        variables: {
          'board-bg': { type: 'color', value: '#0E0E11' },
          'label.title': { type: 'string', value: '导入变量标题' },
        },
        children: [
          {
            id: 'imported-frame',
            type: 'frame',
            layout: 'vertical',
            width: 320,
            height: 120,
            fill: '$board-bg',
            children: [
              {
                id: 'imported-title',
                type: 'text',
                content: '$label.title',
                fill: '$board-bg',
              },
              { id: 'imported-caption', type: 'text', content: '导入说明' },
            ],
          },
        ],
      }),
      'utf8',
    );
    await setOpenFile(penPath);
    await renderApp();
    await clickButton('打开设计稿');
    expect(sceneNode('imported-title').text?.content).toBe('导入变量标题');

    await click(layerRow('imported-caption'));
    await setInput('文案', '导入后说明');
    await requestClose();

    expect(confirmCloseCalls).toBe(1);
    const savedPath = path.join(directory, '未命名.json');
    const saved = JSON.parse(await readFile(savedPath, 'utf8')) as {
      filePath: string;
      variables: unknown;
      children: Array<{ children: Array<Record<string, unknown>> }>;
    };
    expect(saved.filePath).toBe(savedPath);
    expect(saved.variables).toEqual({
      'board-bg': { type: 'color', value: '#0E0E11' },
      'label-title': { type: 'string', value: '导入变量标题' },
    });
    expect(saved.children[0]).toMatchObject({ fill: '$board-bg' });
    expect(saved.children[0]?.children[0]).toMatchObject({
      id: 'imported-title',
      text: '$label-title',
      fill: '$board-bg',
    });
    expect(saved.children[0]?.children[1]).toMatchObject({
      id: 'imported-caption',
      text: '导入后说明',
    });

    // The assigned path and the variable references survive a reopen.
    await setOpenFile(savedPath);
    await clickButton('打开设计稿');
    expect(sceneNode('imported-title').text?.content).toBe('导入变量标题');
    expect(sceneNode('imported-frame').fill).toBe('#0E0E11');
  });

  it('organizes the inspector into Pencil sections with unavailable actions disabled', async () => {
    const filePath = await writeJson('inspector.json', frameWithText);
    await setOpenFile(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    await click(layerRow('title'));

    const panel = container.querySelector('[data-testid="property-panel"]');
    expect(panel?.textContent).toContain('对齐');
    expect(panel?.textContent).toContain('位置');
    expect(panel?.textContent).toContain('外观');
    expect(panel?.textContent).toContain('填充');
    expect(panel?.textContent).toContain('描边');
    expect(panel?.textContent).toContain('导出');
    expect(control('create-component').hasAttribute('disabled')).toBe(true);
    expect(control('context-row').hasAttribute('disabled')).toBe(true);
    expect(control('effects-add').hasAttribute('disabled')).toBe(true);
    expect(control('export-layer').hasAttribute('disabled')).toBe(true);
    expect(control('export-format').hasAttribute('disabled')).toBe(true);
    expect(control('export-format').textContent).toContain('PNG');

    // Existing text and icon property editing stays available.
    await click(control('tool-expand'));
    await click(control('shape-icon'));
    expect(sceneNode('icon-1').icon?.icon).toBe('star');
    await setInput('图标名称', 'heart');
    expect(sceneNode('icon-1').icon?.icon).toBe('heart');
  });

  it('edits free positions, rotation and parent-relative alignment', async () => {
    const filePath = await writeJson('positioned.json', {
      version: 1,
      children: [
        {
          id: 'floating',
          type: 'text',
          text: '浮动标题',
          width: 100,
          height: 20,
        },
        {
          id: 'board',
          type: 'frame',
          layout: 'none',
          width: 300,
          height: 200,
          y: 100,
          padding: [10, 10, 10, 10],
          children: [
            {
              id: 'chip',
              type: 'rectangle',
              x: 5,
              y: 5,
              width: 50,
              height: 20,
            },
          ],
        },
      ],
    });
    await setOpenFile(filePath);
    await renderApp();
    await clickButton('打开设计稿');

    await click(layerRow('floating'));
    await setInput('X', '25');
    await setInput('Y', '40');
    await setInput('旋转', '90');
    expect(sceneNode('floating').box).toMatchObject({ x: 25, y: 40 });
    expect(sceneNode('floating').rotation).toBe(90);

    await click(layerRow('board'));
    expect(control('align-right').hasAttribute('disabled')).toBe(true);

    await click(layerRow('chip'));
    expect(control('align-right').hasAttribute('disabled')).toBe(false);
    await click(control('align-right'));
    expect(sceneNode('chip').box.x).toBe(240);
    await click(control('align-bottom'));
    expect(sceneNode('chip').box.y).toBe(170);

    await click(layerRow('board'));
    await setInput('内边距左', '20');
    expect(sceneNode('chip').box.x).toBe(250);

    await requestClose();
    const reopened = await readDesignFile(filePath);
    expect(reopened.status).toBe('opened');
    if (reopened.status !== 'opened') {
      return;
    }
    const board = reopened.document.children[1];
    expect(board?.type).toBe('frame');
    if (board?.type === 'frame') {
      expect(board.children?.[0]).toMatchObject({ x: 230, y: 160 });
    }
    expect(reopened.document.children[0]).toMatchObject({
      x: 25,
      y: 40,
      rotation: 90,
    });
  });

  it('shows computed positions for auto-layout children and distributes them', async () => {
    const filePath = await writeJson('auto-layout.json', {
      version: 1,
      children: [
        {
          id: 'column',
          type: 'frame',
          layout: 'vertical',
          width: 200,
          height: 200,
          children: [
            { id: 'a', type: 'rectangle', width: 20, height: 20 },
            { id: 'b', type: 'rectangle', width: 20, height: 20 },
          ],
        },
      ],
    });
    await setOpenFile(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    await click(layerRow('a'));

    expect(propertyInput('X').disabled).toBe(true);
    expect(propertyInput('Y').disabled).toBe(true);
    expect(propertyInput('X').value).toBe('0');

    await click(layerRow('column'));
    await click(control('matrix-center'));
    expect(control('matrix-center').getAttribute('aria-pressed')).toBe('true');
    expect(sceneNode('a').box).toMatchObject({ x: 90, y: 80 });

    await click(layerRow('a'));
    expect(propertyInput('X').value).toBe('90');
    expect(propertyInput('Y').value).toBe('80');

    await click(layerRow('column'));
    await click(control('gap-space-between'));
    expect(sceneNode('a').box.y).toBe(0);
    expect(sceneNode('b').box.y).toBe(180);

    await click(control('gap-space-around'));
    expect(sceneNode('a').box.y).toBe(40);
    expect(sceneNode('b').box.y).toBe(140);

    await click(control('layout-horizontal'));
    expect(control('layout-horizontal').getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(sceneNode('a').box).toMatchObject({ x: 40, y: 90 });

    await requestClose();
    const reopened = await readDesignFile(filePath);
    expect(reopened.status).toBe('opened');
    if (reopened.status === 'opened') {
      expect(reopened.document.children[0]).toMatchObject({
        type: 'frame',
        layout: 'horizontal',
        justifyContent: 'space_around',
        alignItems: 'center',
      });
    }
  });

  it('switches dimensions between fixed, fill container and fit content', async () => {
    const filePath = await writeJson('dimensions.json', {
      version: 1,
      children: [
        {
          id: 'board',
          type: 'frame',
          layout: 'none',
          width: 200,
          height: 100,
          children: [{ id: 'label', type: 'text', text: 'Hi' }],
        },
      ],
    });
    await setOpenFile(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    await click(layerRow('label'));

    expect(propertyInput('宽度').value).toBe('12');
    expect(propertyInput('高度').value).toBe('19.2');

    await click(control('fill-width'));
    expect(sceneNode('label').box.width).toBe(200);
    await click(control('fill-height'));
    expect(sceneNode('label').box.height).toBe(100);

    await click(control('hug-width'));
    expect(sceneNode('label').box.width).toBe(12);
    expect((control('fill-width') as HTMLInputElement).checked).toBe(false);

    await setInput('宽度', '64');
    expect(sceneNode('label').box.width).toBe(64);
    expect((control('hug-width') as HTMLInputElement).checked).toBe(false);

    await requestClose();
    const reopened = await readDesignFile(filePath);
    expect(reopened.status).toBe('opened');
    if (reopened.status !== 'opened') {
      return;
    }
    const board = reopened.document.children[0];
    expect(board?.type).toBe('frame');
    if (board?.type === 'frame') {
      expect(board.children?.[0]).toMatchObject({
        width: 64,
        height: { mode: 'fill_container' },
      });
    }

    await setOpenFile(filePath);
    await clickButton('打开设计稿');
    expect(sceneNode('label').box).toMatchObject({ width: 64, height: 100 });
  });

  it('saves frame clipping, fill opacity and stroke across reopening', async () => {
    const filePath = await writeJson('clipping.json', {
      version: 1,
      children: [
        {
          id: 'clipper',
          type: 'frame',
          layout: 'none',
          width: 100,
          height: 80,
          fill: '#ffffff',
          children: [
            {
              id: 'overflow',
              type: 'rectangle',
              x: 10,
              y: 10,
              width: 200,
              height: 30,
              fill: '#ff0000',
            },
          ],
        },
      ],
    });
    await setOpenFile(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    await click(layerRow('clipper'));

    await click(control('clip-content'));
    await setInput('填充透明度', '0.4');
    await setInput('不透明度', '0.8');
    await setInput('圆角', '12');
    await setInput('描边颜色', '#112233');
    await setInput('描边宽度', '2');

    expect(sceneNode('clipper')).toMatchObject({
      clipContent: true,
      fillOpacity: 0.4,
      opacity: 0.8,
      cornerRadius: 12,
      stroke: '#112233',
      strokeWidth: 2,
    });

    await click(layerRow('overflow'));
    await setInput('填充透明度', '0.5');
    expect(sceneNode('overflow').fillOpacity).toBe(0.5);

    await requestClose();
    const reopened = await readDesignFile(filePath);
    expect(reopened.status).toBe('opened');
    if (reopened.status !== 'opened') {
      return;
    }
    const clipper = reopened.document.children[0];
    expect(clipper).toMatchObject({
      clipContent: true,
      fillOpacity: 0.4,
      opacity: 0.8,
      cornerRadius: 12,
      stroke: '#112233',
      strokeWidth: 2,
    });
    expect(
      clipper?.type === 'frame' ? clipper.children?.[0] : undefined,
    ).toMatchObject({ fillOpacity: 0.5 });

    await setOpenFile(filePath);
    await clickButton('打开设计稿');
    expect(sceneNode('clipper')).toMatchObject({
      clipContent: true,
      fillOpacity: 0.4,
      opacity: 0.8,
      cornerRadius: 12,
    });
  });
});
