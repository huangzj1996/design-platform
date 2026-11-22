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
import type { OpenDesignFileResult } from '../src/electron-preload/contract';
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
let openDesignFile: () => Promise<OpenDesignFileResult>;
let canvas: TestCanvasRegistry;

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
  canvas = new TestCanvasRegistry();
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
    root.render(
      <App
        openDesignFile={() => openDesignFile()}
        createCanvasEngine={canvas.factory}
      />,
    );
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

function sceneNode(id: string) {
  return findSceneNode(canvas.engine?.scene ?? null, id);
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
      "id": "path-skipped",
      "type": "path",
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

    const frame = sceneNode('frame-main');
    expect(frame.type).toBe('frame');
    expect(sceneNode('title').type).toBe('text');
    expect(sceneNode('title').text?.content).toBe('产品标题');
    expect(sceneNode('caption').text?.content).toBe('说明文字');
    expect(frame.children.map((child) => child.id)).toEqual([
      'title',
      'caption',
    ]);
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

    const frame = sceneNode('frame-all');
    expect(frame.type).toBe('frame');
    expect(sceneNode('rect-all').type).toBe('rectangle');
    expect(sceneNode('ellipse-all').type).toBe('ellipse');
    expect(sceneNode('text-all').text?.content).toBe('五种元素');
    expect(sceneNode('icon-all').icon).toMatchObject({
      library: 'lucide',
      icon: 'arrow-right',
    });
    expect(frame.children.map((child) => child.id)).toEqual([
      'rect-all',
      'ellipse-all',
      'text-all',
      'icon-all',
    ]);
  });

  it('renders resolved variables after opening while the file keeps the references', async () => {
    const contents = {
      version: 1,
      variables: {
        'color-brand': { type: 'color', value: '#3366ff' },
        'label-title': { type: 'string', value: '变量标题' },
        'space-gap': { type: 'number', value: 12 },
        'show-title': { type: 'boolean', value: false },
      },
      children: [
        {
          id: 'variable-frame',
          type: 'frame',
          layout: 'vertical',
          width: 320,
          height: 200,
          gap: '$space-gap',
          children: [
            {
              id: 'variable-title',
              type: 'text',
              text: '$label-title',
              fill: '$color-brand',
              visible: '$show-title',
            },
            {
              id: 'variable-block',
              type: 'rectangle',
              width: 40,
              height: 20,
              fill: '$color-brand',
            },
          ],
        },
      ],
    };
    const filePath = await writeJson('variables.json', contents);
    await showOpenResult(filePath);
    renderApp();

    await clickOpen();

    expect(sceneNode('variable-title').text?.content).toBe('变量标题');
    expect(sceneNode('variable-title').visible).toBe(false);
    expect(sceneNode('variable-block').fill).toBe('#3366ff');
    expect(sceneNode('variable-block').box.y).toBe(31.2);
    expect(container.querySelector('[role="alert"]')).toBeNull();

    const saved = JSON.parse(await readFile(filePath, 'utf8')) as {
      children: Array<{ gap: string; children: Array<{ text?: string }> }>;
      variables: Record<string, { type: string; value: unknown }>;
    };
    expect(saved.children[0]?.gap).toBe('$space-gap');
    expect(saved.children[0]?.children[0]?.text).toBe('$label-title');
    expect(saved.variables['color-brand']).toEqual({
      type: 'color',
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
    expect(sceneNode('title').text?.content).toBe('产品标题');

    await showOpenResult(invalidPath);
    await clickOpen();

    expect(sceneNode('title').text?.content).toBe('产品标题');
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

    expect(sceneNode('title-second').text?.content).toBe('第二份标题');
    expect(hasSceneNode(canvas.engine?.scene ?? null, 'title')).toBe(false);
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
    expect(sceneNode('frame-imported').type).toBe('frame');
    expect(sceneNode('rect-imported').type).toBe('rectangle');
    expect(sceneNode('ellipse-imported').type).toBe('ellipse');
    expect(sceneNode('text-imported').text?.content).toBe('导入的标题');
    expect(sceneNode('icon-imported').icon?.icon).toBe('arrow-right');
    expect(hasSceneNode(canvas.engine?.scene ?? null, 'hidden')).toBe(false);

    const warnings = container.querySelector('[data-testid="import-warnings"]');
    expect(warnings?.textContent).toContain('unsupported_node');
    expect(warnings?.textContent).toContain('$.children[1]');
    expect(warnings?.textContent).toContain('path');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('opens an imported Pencil file with variable bindings and renders resolved values', async () => {
    const contents = `{
      "version": "2.25",
      "variables": {
        "color.brand": { "type": "color", "value": "#3366FF" },
        "label.title": { "type": "string", "value": "导入变量标题" }
      },
      "children": [
        {
          "id": "frame-variable",
          "type": "frame",
          "layout": "vertical",
          "width": 320,
          "height": 120,
          "fill": "$color.brand",
          "children": [
            { "id": "text-variable", "type": "text", "content": "$label.title", "fill": "$color.brand" },
            { "id": "block-variable", "type": "rectangle", "width": 40, "height": 20, "fill": "$color.brand" }
          ]
        }
      ]
    }`;
    const filePath = path.join(directory, 'variables.pen');
    await writeFile(filePath, contents, 'utf8');
    await showOpenResult(filePath);
    renderApp();

    await clickOpen();

    expect(sceneNode('frame-variable').fill).toBe('#3366FF');
    expect(sceneNode('text-variable').text?.content).toBe('导入变量标题');
    expect(sceneNode('block-variable').fill).toBe('#3366FF');
    expect(
      container.querySelector('[data-testid="import-warnings"]'),
    ).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps the current design when a Pencil import fails and shows the reason', async () => {
    const nativePath = await writeJson('valid.json', frameWithText);
    await showOpenResult(nativePath);
    renderApp();
    await clickOpen();
    expect(sceneNode('title').text?.content).toBe('产品标题');

    const penPath = path.join(directory, 'future.pen');
    await writeFile(penPath, '{ "version": "2.26", "children": [] }', 'utf8');
    await showOpenResult(penPath);
    await clickOpen();

    expect(sceneNode('title').text?.content).toBe('产品标题');
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
