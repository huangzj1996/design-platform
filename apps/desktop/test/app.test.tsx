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
import { App } from '../src/renderer/App';
import { readDesignFile } from '../src/main/read-design-file';
import type { OpenDesignFileResult } from '../src/shared/open-design-file';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;
let directory: string;
let openDesignFile: () => Promise<OpenDesignFileResult>;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'design-ai-app-'));
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  await rm(directory, { recursive: true, force: true });
});

async function writeJson(name: string, value: unknown): Promise<string> {
  const filePath = path.join(directory, name);
  await writeFile(filePath, JSON.stringify(value), 'utf8');
  return filePath;
}

async function showOpenResult(filePath: string): Promise<void> {
  const result = await readDesignFile(filePath);
  openDesignFile = () => Promise.resolve(result);
}

function renderApp(): void {
  root = createRoot(container);
  act(() => {
    root.render(<App openDesignFile={() => openDesignFile()} />);
  });
}

async function clickOpen(): Promise<void> {
  const button = [...container.querySelectorAll('button')].find((candidate) =>
    candidate.textContent?.includes('打开设计稿'),
  );
  if (!button) {
    throw new Error('Open button not found');
  }
  await act(async () => {
    button.click();
  });
}

function elementById(id: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-element-id="${id}"]`);
}

const frameWithText = {
  version: 1,
  children: [
    {
      id: 'frame-main',
      type: 'frame',
      layout: 'vertical',
      width: 640,
      height: 480,
      children: [
        { id: 'title', type: 'text', text: '产品标题' },
        { id: 'caption', type: 'text', text: '说明文字' },
      ],
    },
  ],
};

describe('desktop open flow', () => {
  it('opens a blank document from a real temporary directory', async () => {
    const filePath = await writeJson('blank.json', {
      version: 1,
      children: [],
    });
    await showOpenResult(filePath);
    renderApp();

    expect(container.textContent).toContain('尚未打开设计稿');

    await clickOpen();

    expect(container.textContent).toContain('空白设计稿');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows the text title and preserves ids, nesting and sibling order', async () => {
    const filePath = await writeJson('frame.json', frameWithText);
    await showOpenResult(filePath);
    renderApp();

    await clickOpen();

    const frame = elementById('frame-main');
    expect(frame?.getAttribute('data-element-type')).toBe('frame');
    expect(frame?.textContent).toContain('产品标题');

    const title = elementById('title');
    const caption = elementById('caption');
    expect(title?.getAttribute('data-element-type')).toBe('text');
    expect(title?.textContent).toBe('产品标题');
    expect(caption?.textContent).toBe('说明文字');

    const directChildIds = [...(frame?.children ?? [])].map((child) =>
      child.getAttribute('data-element-id'),
    );
    expect(directChildIds).toEqual(['title', 'caption']);
  });

  it('keeps the current design and disk file after a failed open, then opens a valid file again', async () => {
    const validPath = await writeJson('valid.json', frameWithText);
    const invalidContents = '{ not json';
    const invalidPath = path.join(directory, 'broken.json');
    await writeFile(invalidPath, invalidContents, 'utf8');

    await showOpenResult(validPath);
    renderApp();
    await clickOpen();
    expect(container.textContent).toContain('产品标题');

    await showOpenResult(invalidPath);
    await clickOpen();

    expect(container.textContent).toContain('产品标题');
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('invalid_json');
    expect(container.textContent).toContain('$');
    await expect(readFile(invalidPath, 'utf8')).resolves.toBe(invalidContents);

    const secondPath = await writeJson('second.json', {
      version: 1,
      children: [
        {
          id: 'frame-second',
          type: 'frame',
          children: [{ id: 'title-second', type: 'text', text: '第二份标题' }],
        },
      ],
    });
    await showOpenResult(secondPath);
    await clickOpen();

    expect(container.textContent).toContain('第二份标题');
    expect(container.textContent).not.toContain('产品标题');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
