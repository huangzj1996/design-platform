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

const pencilWithWarning = `{
  "version": "2.25",
  "children": [
    {
      "id": "frame-imported",
      "type": "frame",
      "width": 360,
      "height": 240,
      "layout": "vertical",
      "padding": 12,
      "gap": 6,
      "children": [
        { "id": "rect-imported", "type": "rectangle", "width": 40, "height": 20, "fill": "#FF0000" },
        { "id": "ellipse-imported", "type": "ellipse", "width": 16, "height": 16, "fill": "#00FF00" },
        { "id": "text-imported", "type": "text", "content": "导入的标题" },
        { "id": "icon-imported", "type": "icon", "library": "lucide", "icon": "arrow-right", "width": 20, "height": 20 }
      ]
    },
    {
      "id": "group-skipped",
      "type": "group",
      "children": [{ "id": "hidden", "type": "text", "content": "不应出现" }]
    }
  ]
}`;

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

  it('opens a document containing all five element types and preserves icon identifiers', async () => {
    const filePath = await writeJson('elements.json', {
      version: 1,
      children: [
        {
          id: 'frame-all',
          type: 'frame',
          layout: 'vertical',
          width: 360,
          height: 280,
          padding: [12, 12, 12, 12],
          gap: 6,
          children: [
            {
              id: 'rect-all',
              type: 'rectangle',
              width: 80,
              height: 30,
              fill: '#ff0000',
            },
            {
              id: 'ellipse-all',
              type: 'ellipse',
              width: 30,
              height: 30,
              fill: '#00ff00',
            },
            {
              id: 'text-all',
              type: 'text',
              text: '五种元素',
              fontSize: 18,
            },
            {
              id: 'icon-all',
              type: 'icon',
              library: 'lucide',
              icon: 'arrow-right',
              width: 20,
              height: 20,
            },
          ],
        },
      ],
    });
    await showOpenResult(filePath);
    renderApp();

    await clickOpen();

    const frame = elementById('frame-all');
    if (frame === null) {
      throw new Error('Expected the frame to render');
    }
    expect(frame.getAttribute('data-element-type')).toBe('frame');
    expect(elementById('rect-all')?.getAttribute('data-element-type')).toBe(
      'rectangle',
    );
    expect(elementById('ellipse-all')?.getAttribute('data-element-type')).toBe(
      'ellipse',
    );
    expect(elementById('text-all')?.textContent).toBe('五种元素');
    expect(elementById('icon-all')?.getAttribute('data-icon-library')).toBe(
      'lucide',
    );
    expect(elementById('icon-all')?.getAttribute('data-icon-name')).toBe(
      'arrow-right',
    );
    expect(elementById('icon-all')?.querySelector('svg')).not.toBeNull();
    expect(
      [...frame.children].map((child) => child.getAttribute('data-element-id')),
    ).toEqual(['rect-all', 'ellipse-all', 'text-all', 'icon-all']);
  });

  it('renders resolved variables after opening while the file keeps the references', async () => {
    const contents = {
      version: 1,
      variables: [
        { name: '--color-brand', type: 'color', value: '#3366ff' },
        { name: '--label-title', type: 'string', value: '变量标题' },
        { name: '--space-gap', type: 'number', value: 12 },
        { name: '--show-title', type: 'boolean', value: false },
      ],
      children: [
        {
          id: 'variable-frame',
          type: 'frame',
          layout: 'vertical',
          width: 320,
          height: 200,
          gap: '$${--space-gap}',
          children: [
            {
              id: 'variable-title',
              type: 'text',
              text: '$${--label-title}',
              fill: '$${--color-brand}',
              visible: '$${--show-title}',
            },
            {
              id: 'variable-block',
              type: 'rectangle',
              width: 40,
              height: 20,
              fill: '$${--color-brand}',
            },
          ],
        },
      ],
    };
    const filePath = await writeJson('variables.json', contents);
    await showOpenResult(filePath);
    renderApp();

    await clickOpen();

    expect(elementById('variable-title')?.textContent).toBe('变量标题');
    expect(elementById('variable-title')?.style.visibility).toBe('hidden');
    expect(elementById('variable-block')?.style.backgroundColor).toBe(
      'rgb(51, 102, 255)',
    );
    expect(elementById('variable-block')?.dataset.boxY).toBe('31.2');
    expect(container.querySelector('[role="alert"]')).toBeNull();

    const saved = JSON.parse(await readFile(filePath, 'utf8')) as {
      children: Array<{ gap: string; children: Array<{ text?: string }> }>;
      variables: Array<{ name: string; value: unknown }>;
    };
    expect(saved.children[0]?.gap).toBe('$${--space-gap}');
    expect(saved.children[0]?.children[0]?.text).toBe('$${--label-title}');
    expect(saved.variables[0]).toMatchObject({
      name: '--color-brand',
      value: '#3366ff',
    });
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

  it('imports a Pencil file and displays the conversion warnings', async () => {
    const filePath = path.join(directory, 'sample.pen');
    await writeFile(filePath, pencilWithWarning, 'utf8');
    await showOpenResult(filePath);
    renderApp();

    expect(container.textContent).toContain('尚未打开设计稿');

    await clickOpen();

    expect(container.textContent).toContain('sample.pen');
    expect(elementById('frame-imported')?.dataset.elementType).toBe('frame');
    expect(elementById('rect-imported')?.dataset.elementType).toBe('rectangle');
    expect(elementById('ellipse-imported')?.dataset.elementType).toBe(
      'ellipse',
    );
    expect(elementById('text-imported')?.textContent).toBe('导入的标题');
    expect(elementById('icon-imported')?.dataset.iconName).toBe('arrow-right');
    expect(container.textContent).not.toContain('不应出现');

    const warnings = container.querySelector('[data-testid="import-warnings"]');
    expect(warnings?.textContent).toContain('unsupported_node');
    expect(warnings?.textContent).toContain('$.children[1]');
    expect(warnings?.textContent).toContain('group');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps the current design when a Pencil import fails and shows the reason', async () => {
    const nativePath = await writeJson('valid.json', frameWithText);
    await showOpenResult(nativePath);
    renderApp();
    await clickOpen();
    expect(container.textContent).toContain('产品标题');

    const penPath = path.join(directory, 'future.pen');
    await writeFile(penPath, '{ "version": "2.26", "children": [] }', 'utf8');
    await showOpenResult(penPath);
    await clickOpen();

    expect(container.textContent).toContain('产品标题');
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('unsupported_version');
    expect(alert?.textContent).toContain('$.version');
    expect(
      container.querySelector('[data-testid="import-warnings"]'),
    ).toBeNull();
  });

  it('opens a genuinely empty Pencil document as an empty native draft', async () => {
    const filePath = path.join(directory, 'empty.pen');
    await writeFile(filePath, '{ "version": "2.25", "children": [] }', 'utf8');
    await showOpenResult(filePath);
    renderApp();

    await clickOpen();

    expect(container.textContent).toContain('empty.pen');
    expect(container.textContent).toContain('空白设计稿');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="import-warnings"]'),
    ).toBeNull();
  });
});
