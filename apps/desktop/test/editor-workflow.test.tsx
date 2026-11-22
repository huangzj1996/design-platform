// @vitest-environment jsdom

import { readFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
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
import { App } from '../src/renderer/App';
import { createDesignFile as createBlankDesignFile } from '../src/main/create-design-file';
import { readDesignFile } from '../src/main/read-design-file';
import { DesignFileSaver } from '../src/main/save-design-file';
import type {
  CreateDesignFileResult,
  OpenDesignFileResult,
  SaveDesignFileInput,
  SaveDesignFileResult,
} from '../src/shared/open-design-file';

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

function elementById(id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-element-id="${id}"]`);
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

    expect(container.textContent).toContain('尚未打开设计稿');
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

    expect(elementById('title')?.textContent).toBe('旧标题');
    expect(container.textContent).toContain('未选择元素');

    // Canvas clicks and layer-tree clicks select the same element.
    await click(elementById('caption') as HTMLElement);
    expect(
      container.querySelector('[data-testid="property-panel"]')?.textContent,
    ).toContain('caption');
    await click(layerRow('title'));
    expect(propertyInput('文案').value).toBe('旧标题');

    // A local text edit keeps the other fields and updates the canvas.
    await setInput('文案', '新标题');
    expect(elementById('title')?.textContent).toBe('新标题');
    expect(propertyInput('字号').value).toBe('24');

    // Container spacing changes update the canvas layout.
    await click(layerRow('main'));
    const captionBefore = Number(elementById('caption')?.dataset.boxY);
    await setInput('间距', '24');
    expect(Number(elementById('caption')?.dataset.boxY)).toBeGreaterThan(
      captionBefore,
    );
    await setInput('填充颜色', '#00ff00');
    expect(elementById('main')?.style.backgroundColor).toBe('rgb(0, 255, 0)');

    // New title at the root, a new container, and a child inside it.
    await clickButton('新建标题');
    expect(elementById('text-1')?.textContent).toBe('标题');
    await clickButton('新建容器');
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
    expect(elementById('title')?.textContent).toBe('新标题');

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
    expect(elementById('title')?.textContent).toBe('新标题');
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
    expect(elementById('title')?.textContent).toBe('失败后的编辑');
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
      variables: [
        { name: '--label-title', type: 'string', value: '变量标题' },
        { name: '--color-brand', type: 'color', value: '#3366ff' },
      ],
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
              text: '$${--label-title}',
              fill: '$${--color-brand}',
            },
            { id: 'caption', type: 'text', text: '普通说明' },
          ],
        },
      ],
    });
    await setOpenFile(filePath);
    await renderApp();
    await clickButton('打开设计稿');
    expect(elementById('bound-title')?.textContent).toBe('变量标题');

    await click(layerRow('caption'));
    await setInput('文案', '编辑后的说明');
    await requestClose();

    const reopened = await readDesignFile(filePath);
    expect(reopened.status).toBe('opened');
    if (reopened.status !== 'opened') {
      return;
    }
    expect(reopened.document.variables).toEqual([
      { name: '--label-title', type: 'string', value: '变量标题' },
      { name: '--color-brand', type: 'color', value: '#3366ff' },
    ]);
    const frame = reopened.document.children[0];
    if (frame?.type !== 'frame') {
      throw new Error('Expected the variables frame');
    }
    expect(frame.children?.[0]).toMatchObject({
      id: 'bound-title',
      text: '$${--label-title}',
      fill: '$${--color-brand}',
    });
    expect(frame.children?.[1]).toMatchObject({
      id: 'caption',
      text: '编辑后的说明',
    });

    await click(layerRow('bound-title'));
    expect(propertyInput('文案').value).toBe('$${--label-title}');
    expect(elementById('bound-title')?.textContent).toBe('变量标题');
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

    expect(elementById('title')?.textContent).toBe('重开前的编辑');
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
});
