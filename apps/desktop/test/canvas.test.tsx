// @vitest-environment jsdom

import {
  validateDesignDocument,
  type DesignDocument,
} from '@design-ai/design-schema';
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
import { Canvas } from '../src/electron-render/Canvas';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterAll(() => {
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
});

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

function documentFrom(input: unknown): DesignDocument {
  const result = validateDesignDocument(input);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.document;
}

function render(document: DesignDocument | null): void {
  root = createRoot(container);
  act(() => {
    root.render(<Canvas document={document} />);
  });
}

function elementById(id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    `[data-element-id="${id}"]`,
  );
  if (element === null) {
    throw new Error(`No rendered element for ${id}`);
  }
  return element;
}

function boxOf(id: string) {
  const element = elementById(id);
  return {
    x: Number(element.dataset.boxX),
    y: Number(element.dataset.boxY),
    width: Number(element.dataset.boxWidth),
    height: Number(element.dataset.boxHeight),
  };
}

const fiveElementDocument = {
  version: 1,
  children: [
    {
      id: 'frame',
      type: 'frame',
      layout: 'vertical',
      width: 400,
      height: 300,
      padding: [16, 16, 16, 16],
      gap: 8,
      fill: '#ffffff',
      children: [
        {
          id: 'rectangle',
          type: 'rectangle',
          width: 100,
          height: 40,
          fill: '#ff0000',
          stroke: '#000000',
          strokeWidth: 2,
          cornerRadius: 4,
        },
        {
          id: 'ellipse',
          type: 'ellipse',
          width: 40,
          height: 40,
          fill: '#00ff00',
        },
        {
          id: 'text',
          type: 'text',
          text: '标题',
          fontSize: 20,
          fontWeight: 700,
          lineHeight: 1.5,
          textAlign: 'center',
          textWrap: 'wrap',
          fill: '#111111',
        },
        {
          id: 'icon',
          type: 'icon',
          library: 'lucide',
          icon: 'arrow-right',
          width: 24,
          height: 24,
          fill: '#333333',
        },
      ],
    },
  ],
};

describe('Canvas', () => {
  it('renders the five native element types with nesting and sibling order', () => {
    render(documentFrom(fiveElementDocument));

    expect(elementById('frame').dataset.elementType).toBe('frame');
    expect(elementById('rectangle').dataset.elementType).toBe('rectangle');
    expect(elementById('ellipse').dataset.elementType).toBe('ellipse');
    expect(elementById('text').dataset.elementType).toBe('text');
    expect(elementById('icon').dataset.elementType).toBe('icon');

    const frame = elementById('frame');
    expect(
      [...frame.children].map((child) => child.getAttribute('data-element-id')),
    ).toEqual(['rectangle', 'ellipse', 'text', 'icon']);
    expect(elementById('text').textContent).toBe('标题');
  });

  it('applies the computed layout boxes, including free positioning and fill sizes', () => {
    render(documentFrom(fiveElementDocument));

    expect(boxOf('frame')).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    expect(boxOf('rectangle')).toEqual({
      x: 16,
      y: 16,
      width: 100,
      height: 40,
    });
    expect(boxOf('ellipse')).toEqual({
      x: 16,
      y: 64,
      width: 40,
      height: 40,
    });
    expect(boxOf('text')).toEqual({
      x: 16,
      y: 112,
      width: 40,
      height: 30,
    });
    expect(boxOf('icon')).toEqual({
      x: 16,
      y: 150,
      width: 24,
      height: 24,
    });

    const freeLayoutDocument = documentFrom({
      version: 1,
      children: [
        {
          id: 'free-frame',
          type: 'frame',
          layout: 'none',
          width: 300,
          height: 200,
          padding: [10, 20, 30, 40],
          children: [
            {
              id: 'placed',
              type: 'rectangle',
              x: 5,
              y: 6,
              width: 30,
              height: 40,
            },
            {
              id: 'filled',
              type: 'rectangle',
              width: { mode: 'fill_container' },
              height: 10,
            },
          ],
        },
      ],
    });
    act(() => {
      root.render(<Canvas document={freeLayoutDocument} />);
    });

    expect(boxOf('placed')).toEqual({
      x: 45,
      y: 16,
      width: 30,
      height: 40,
    });
    expect(boxOf('filled')).toEqual({
      x: 40,
      y: 10,
      width: 240,
      height: 10,
    });
  });

  it('applies visibility, opacity, rotation, fill, stroke and corner radius', () => {
    render(
      documentFrom({
        version: 1,
        children: [
          {
            id: 'styled-frame',
            type: 'frame',
            width: 200,
            height: 100,
            fill: '#ffffff',
            stroke: '#123456',
            strokeWidth: 3,
            cornerRadius: 8,
            opacity: 0.5,
            visible: false,
            rotation: 30,
            children: [
              {
                id: 'styled-rectangle',
                type: 'rectangle',
                width: 50,
                height: 20,
                fill: '#ff0000',
                stroke: '#00ff00',
                strokeWidth: 2,
                cornerRadius: 4,
              },
              {
                id: 'styled-ellipse',
                type: 'ellipse',
                width: 40,
                height: 40,
                fill: '#0000ff',
              },
            ],
          },
        ],
      }),
    );

    const frame = elementById('styled-frame');
    expect(frame.style.opacity).toBe('0.5');
    expect(frame.style.visibility).toBe('hidden');
    expect(frame.style.transform).toBe('rotate(30deg)');
    expect(frame.style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(frame.style.boxShadow).toContain('inset');
    expect(frame.style.boxShadow).toContain('3px');
    expect(frame.style.borderRadius).toBe('8px');

    const rectangle = elementById('styled-rectangle');
    expect(rectangle.style.backgroundColor).toBe('rgb(255, 0, 0)');
    expect(rectangle.style.boxShadow).toContain('2px');
    expect(rectangle.style.borderRadius).toBe('4px');

    const ellipse = elementById('styled-ellipse');
    expect(ellipse.style.borderRadius).toBe('50%');
  });

  it('renders text typography and wrapping styles', () => {
    render(
      documentFrom({
        version: 1,
        children: [
          {
            id: 'wrapped',
            type: 'text',
            text: 'Hello world',
            width: 40,
            fontSize: 16,
            fontFamily: 'Georgia',
            fontWeight: 700,
            lineHeight: 1.5,
            textAlign: 'center',
            textWrap: 'wrap',
            fill: '#111111',
          },
          {
            id: 'nowrap',
            type: 'text',
            text: 'Hello world',
            width: 40,
            y: 50,
            fontSize: 16,
            textWrap: 'none',
          },
        ],
      }),
    );

    const wrapped = elementById('wrapped');
    expect(wrapped.style.color).toBe('rgb(17, 17, 17)');
    expect(wrapped.style.fontFamily).toBe('Georgia');
    expect(wrapped.style.fontSize).toBe('16px');
    expect(wrapped.style.fontWeight).toBe('700');
    expect(wrapped.style.lineHeight).toBe('1.5');
    expect(wrapped.style.textAlign).toBe('center');
    expect(wrapped.style.whiteSpace).toBe('pre-wrap');
    expect(boxOf('wrapped')).toMatchObject({ width: 40, height: 48 });

    expect(elementById('nowrap').style.whiteSpace).toBe('nowrap');
    expect(boxOf('nowrap')).toMatchObject({ width: 40, height: 19.2 });
  });

  it('renders Lucide icons by name and a sized placeholder for unknown icons', () => {
    render(
      documentFrom({
        version: 1,
        children: [
          {
            id: 'known-icon',
            type: 'icon',
            library: 'lucide',
            icon: 'arrow-right',
            width: 24,
            height: 24,
            fill: '#123456',
          },
          {
            id: 'unknown-icon',
            type: 'icon',
            library: 'lucide',
            icon: 'not-a-real-icon',
            width: 32,
            height: 18,
            y: 40,
          },
          {
            id: 'unknown-library',
            type: 'icon',
            library: 'other',
            icon: 'star',
            width: 20,
            height: 20,
            y: 80,
          },
        ],
      }),
    );

    const known = elementById('known-icon');
    expect(known.dataset.iconLibrary).toBe('lucide');
    expect(known.dataset.iconName).toBe('arrow-right');
    expect(known.dataset.iconResolved).toBe('true');
    expect(known.querySelector('svg')).not.toBeNull();
    expect(known.style.color).toBe('rgb(18, 52, 86)');

    const unknown = elementById('unknown-icon');
    expect(unknown.dataset.iconLibrary).toBe('lucide');
    expect(unknown.dataset.iconName).toBe('not-a-real-icon');
    expect(unknown.dataset.iconResolved).toBe('false');
    expect(unknown.querySelector('svg')).toBeNull();
    expect(boxOf('unknown-icon')).toMatchObject({
      width: 32,
      height: 18,
    });

    const unknownLibrary = elementById('unknown-library');
    expect(unknownLibrary.dataset.iconLibrary).toBe('other');
    expect(unknownLibrary.dataset.iconName).toBe('star');
    expect(unknownLibrary.dataset.iconResolved).toBe('false');
    expect(unknownLibrary.querySelector('svg')).toBeNull();
  });

  it('renders resolved variable values and updates every reference together', () => {
    const input = {
      version: 1,
      variables: {
        'color-brand': { type: 'color', value: '#3366ff' },
        'label-title': { type: 'string', value: '欢迎' },
        'space-gap': { type: 'number', value: 8 },
        'size-width': { type: 'number', value: 120 },
        'show-caption': { type: 'boolean', value: true },
      },
      children: [
        {
          id: 'variable-frame',
          type: 'frame',
          layout: 'vertical',
          width: 240,
          height: 200,
          padding: [10, 10, 10, 10],
          gap: '$space-gap',
          children: [
            {
              id: 'brand-block-a',
              type: 'rectangle',
              width: '$size-width',
              height: 20,
              fill: '$color-brand',
            },
            {
              id: 'brand-block-b',
              type: 'rectangle',
              width: 40,
              height: 20,
              fill: '$color-brand',
            },
            {
              id: 'variable-title',
              type: 'text',
              text: '$label-title',
              fill: '$color-brand',
              visible: '$show-caption',
            },
            {
              id: 'escaped-title',
              type: 'text',
              text: '\\$label-title',
            },
            {
              id: 'embedded-title',
              type: 'text',
              text: 'See $label-title',
            },
          ],
        },
      ],
    };

    const document = documentFrom(input);
    render(document);

    expect(elementById('brand-block-a').style.backgroundColor).toBe(
      'rgb(51, 102, 255)',
    );
    expect(elementById('brand-block-b').style.backgroundColor).toBe(
      'rgb(51, 102, 255)',
    );
    expect(elementById('variable-title').textContent).toBe('欢迎');
    expect(elementById('variable-title').style.color).toBe('rgb(51, 102, 255)');
    expect(elementById('variable-title').style.visibility).not.toBe('hidden');

    expect(boxOf('brand-block-a')).toMatchObject({
      x: 10,
      y: 10,
      width: 120,
      height: 20,
    });
    expect(boxOf('brand-block-b').y).toBe(38);

    expect(elementById('escaped-title').textContent).toBe('$label-title');
    expect(elementById('embedded-title').textContent).toBe('See $label-title');

    const originalFrame = document.children[0];
    expect(originalFrame).toMatchObject({
      gap: '$space-gap',
    });
    if (originalFrame?.type === 'frame') {
      expect(originalFrame.children?.[0]).toMatchObject({
        width: '$size-width',
        fill: '$color-brand',
      });
    }

    const changed = documentFrom({
      ...input,
      variables: {
        'color-brand': { type: 'color', value: '#ff0000' },
        'label-title': { type: 'string', value: '已更新' },
        'space-gap': { type: 'number', value: 16 },
        'size-width': { type: 'number', value: 80 },
        'show-caption': { type: 'boolean', value: false },
      },
    });
    act(() => {
      root.render(<Canvas document={changed} />);
    });

    expect(elementById('brand-block-a').style.backgroundColor).toBe(
      'rgb(255, 0, 0)',
    );
    expect(elementById('brand-block-b').style.backgroundColor).toBe(
      'rgb(255, 0, 0)',
    );
    expect(elementById('variable-title').textContent).toBe('已更新');
    expect(elementById('variable-title').style.visibility).toBe('hidden');
    expect(boxOf('brand-block-a')).toMatchObject({ width: 80 });
    expect(boxOf('brand-block-b').y).toBe(46);
  });

  it('shows the empty states for a missing or blank document', () => {
    render(null);
    expect(container.textContent).toContain('尚未打开设计稿');

    act(() => {
      root.render(
        <Canvas document={documentFrom({ version: 1, children: [] })} />,
      );
    });
    expect(container.textContent).toContain('空白设计稿');
  });
});
