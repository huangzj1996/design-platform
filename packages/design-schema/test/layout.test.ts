import { describe, expect, it } from 'vitest';
import {
  findLayoutNode,
  layoutDesignDocument,
  measureElementSize,
  measureText,
  validateDesignDocument,
  type DesignDocument,
  type Diagnostic,
  type LayoutBox,
  type LayoutNode,
} from '../src/legacy';

function validate(input: unknown): DesignDocument {
  const result = validateDesignDocument(input);
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.document;
}

function layoutOf(input: unknown) {
  return layoutDesignDocument(validate(input));
}

function findIn(nodes: LayoutNode[], id: string): LayoutNode | undefined {
  for (const node of nodes) {
    if (node.element.id === id) {
      return node;
    }
    const nested = findIn(node.children, id);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

function findNode(nodes: LayoutNode[], id: string): LayoutNode {
  const node = findIn(nodes, id);
  if (node === undefined) {
    throw new Error(`No layout node for ${id}`);
  }
  return node;
}

function errorsOf(input: unknown): Diagnostic[] {
  const result = validateDesignDocument(input);
  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error('Expected validation to fail');
  }
  return result.errors;
}

function sizesOf(box: LayoutBox) {
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
}

const text = (id: string, value: string, extra: object = {}) => ({
  id,
  type: 'text',
  text: value,
  ...extra,
});

const rectangle = (id: string, extra: object = {}) => ({
  id,
  type: 'rectangle',
  ...extra,
});

describe('measureText', () => {
  it('measures text with deterministic character metrics and default typography', () => {
    expect(measureText('Hi', { fontSize: 16 })).toEqual({
      width: 12,
      height: 19.2,
      lineCount: 1,
      lines: ['Hi'],
    });
    expect(measureText('标题', { fontSize: 16 })).toMatchObject({
      width: 32,
      height: 19.2,
    });
    expect(measureText('A\nB', { fontSize: 10, lineHeight: 2 })).toMatchObject({
      width: 5,
      height: 40,
      lineCount: 2,
    });
  });

  it('wraps text at word boundaries for a fixed width', () => {
    expect(measureText('Hello world', { fontSize: 16 }, 40)).toMatchObject({
      width: 40,
      height: 38.4,
      lineCount: 2,
      lines: ['Hello', 'world'],
    });
    expect(measureText('Hello world', { fontSize: 16 }, 45)).toMatchObject({
      width: 40,
      height: 38.4,
      lines: ['Hello', 'world'],
    });
  });

  it('keeps text on one line when wrapping is disabled', () => {
    const measurement = measureText(
      'Hello world',
      { fontSize: 16, textWrap: 'none' },
      40,
    );

    expect(measurement.lineCount).toBe(1);
    expect(measurement.width).toBe(76);
    expect(measurement.height).toBe(19.2);
  });
});

describe('measureElementSize', () => {
  it('uses the shared size rules for text, auto-layout frames and fixed elements', () => {
    expect(
      measureElementSize({ id: 'label', type: 'text', text: 'Hi' }),
    ).toEqual({ width: 12, height: 19.2 });
    expect(
      measureElementSize({
        id: 'block',
        type: 'rectangle',
        width: 20,
        height: 10,
      }),
    ).toEqual({ width: 20, height: 10 });
    expect(
      measureElementSize({
        id: 'row',
        type: 'frame',
        layout: 'horizontal',
        gap: 4,
        children: [
          { id: 'a', type: 'text', text: 'Hi' },
          { id: 'b', type: 'text', text: '标题' },
        ],
      }),
    ).toEqual({ width: 48, height: 19.2 });
    expect(
      measureElementSize({ id: 'unsized', type: 'rectangle' }),
    ).toBeUndefined();
  });
});

describe('layoutDesignDocument', () => {
  it('defaults a frame without a layout to horizontal and applies gap and padding', () => {
    const document = {
      version: 1,
      children: [
        {
          id: 'frame',
          type: 'frame',
          width: 300,
          height: 200,
          padding: [10, 20, 30, 40],
          gap: 5,
          children: [
            rectangle('a', { width: 50, height: 20 }),
            rectangle('b', { width: 60, height: 30 }),
          ],
        },
      ],
    };

    const layout = layoutOf(document);

    expect(layout.issues).toEqual([]);
    expect(sizesOf(findNode(layout.roots, 'frame').box)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
    expect(sizesOf(findNode(layout.roots, 'a').box)).toEqual({
      x: 40,
      y: 10,
      width: 50,
      height: 20,
    });
    expect(sizesOf(findNode(layout.roots, 'b').box)).toEqual({
      x: 95,
      y: 10,
      width: 60,
      height: 30,
    });
  });

  it('positions vertical children for every main-axis alignment', () => {
    const positions = (justifyContent: string) => {
      const layout = layoutOf({
        version: 1,
        children: [
          {
            id: 'frame',
            type: 'frame',
            layout: 'vertical',
            width: 200,
            height: 300,
            justifyContent,
            children: [
              rectangle('a', { width: 10, height: 50 }),
              rectangle('b', { width: 10, height: 50 }),
            ],
          },
        ],
      });
      return [
        findNode(layout.roots, 'a').box.y,
        findNode(layout.roots, 'b').box.y,
      ];
    };

    expect(positions('start')).toEqual([0, 50]);
    expect(positions('center')).toEqual([100, 150]);
    expect(positions('end')).toEqual([200, 250]);
    expect(positions('space_between')).toEqual([0, 250]);
    expect(positions('space_around')).toEqual([50, 200]);
  });

  it('aligns children on the cross axis', () => {
    const layout = layoutOf({
      version: 1,
      children: [
        {
          id: 'frame',
          type: 'frame',
          layout: 'vertical',
          width: 200,
          height: 300,
          alignItems: 'center',
          children: [
            rectangle('a', { width: 40, height: 50 }),
            rectangle('b', { width: 60, height: 50 }),
          ],
        },
        {
          id: 'end-frame',
          type: 'frame',
          layout: 'vertical',
          width: 200,
          height: 300,
          alignItems: 'end',
          children: [rectangle('c', { width: 40, height: 50 })],
        },
        {
          id: 'row',
          type: 'frame',
          layout: 'horizontal',
          width: 300,
          height: 100,
          alignItems: 'center',
          children: [
            rectangle('d', { width: 20, height: 20 }),
            rectangle('e', { width: 20, height: 40 }),
          ],
        },
      ],
    });

    expect(findNode(layout.roots, 'a').box.x).toBe(80);
    expect(findNode(layout.roots, 'b').box.x).toBe(70);
    expect(findNode(layout.roots, 'c').box.x).toBe(160);
    expect(findNode(layout.roots, 'd').box.y).toBe(40);
    expect(findNode(layout.roots, 'e').box.y).toBe(30);
  });

  it('sizes auto-layout frames to their content when dimensions are omitted', () => {
    const layout = layoutOf({
      version: 1,
      children: [
        {
          id: 'row',
          type: 'frame',
          layout: 'horizontal',
          gap: 4,
          children: [text('a', 'Hi'), text('b', '标题')],
        },
        {
          id: 'column',
          type: 'frame',
          layout: 'vertical',
          gap: 4,
          y: 100,
          children: [text('c', 'Hi'), text('d', '标题')],
        },
      ],
    });

    expect(layout.issues).toEqual([]);
    expect(sizesOf(findNode(layout.roots, 'row').box)).toEqual({
      x: 0,
      y: 0,
      width: 48,
      height: 19.2,
    });
    expect(sizesOf(findNode(layout.roots, 'a').box)).toEqual({
      x: 0,
      y: 0,
      width: 12,
      height: 19.2,
    });
    expect(sizesOf(findNode(layout.roots, 'b').box)).toEqual({
      x: 16,
      y: 0,
      width: 32,
      height: 19.2,
    });
    expect(sizesOf(findNode(layout.roots, 'column').box)).toEqual({
      x: 0,
      y: 100,
      width: 32,
      height: 42.4,
    });
  });

  it('defaults a missing child dimension to fit content in an auto layout', () => {
    const layout = layoutOf({
      version: 1,
      children: [
        {
          id: 'frame',
          type: 'frame',
          width: 200,
          children: [text('title', 'Hi')],
        },
      ],
    });

    expect(sizesOf(findNode(layout.roots, 'frame').box)).toMatchObject({
      width: 200,
      height: 19.2,
    });
    expect(sizesOf(findNode(layout.roots, 'title').box)).toMatchObject({
      width: 12,
      height: 19.2,
    });
  });

  it('distributes fill_container children across the main axis', () => {
    const layout = layoutOf({
      version: 1,
      children: [
        {
          id: 'row',
          type: 'frame',
          layout: 'horizontal',
          width: 300,
          height: 100,
          gap: 10,
          children: [
            rectangle('a', { width: 50, height: 20 }),
            rectangle('b', {
              width: { mode: 'fill_container' },
              height: 20,
            }),
            rectangle('c', {
              width: { mode: 'fill_container' },
              height: 20,
            }),
          ],
        },
        {
          id: 'column',
          type: 'frame',
          layout: 'vertical',
          width: 200,
          height: 300,
          y: 200,
          children: [
            rectangle('d', {
              width: 20,
              height: { mode: 'fill_container' },
            }),
            rectangle('e', {
              width: 20,
              height: { mode: 'fill_container' },
            }),
          ],
        },
      ],
    });

    expect(sizesOf(findNode(layout.roots, 'a').box)).toMatchObject({
      x: 0,
      width: 50,
    });
    expect(sizesOf(findNode(layout.roots, 'b').box)).toMatchObject({
      x: 60,
      width: 115,
    });
    expect(sizesOf(findNode(layout.roots, 'c').box)).toMatchObject({
      x: 185,
      width: 115,
    });
    expect(sizesOf(findNode(layout.roots, 'd').box)).toMatchObject({
      y: 0,
      height: 150,
    });
    expect(sizesOf(findNode(layout.roots, 'e').box)).toMatchObject({
      y: 150,
      height: 150,
    });
  });

  it('stretches fill_container children across the cross axis', () => {
    const layout = layoutOf({
      version: 1,
      children: [
        {
          id: 'row',
          type: 'frame',
          layout: 'horizontal',
          width: 300,
          height: 100,
          children: [
            rectangle('a', {
              width: 50,
              height: { mode: 'fill_container' },
            }),
          ],
        },
        {
          id: 'column',
          type: 'frame',
          layout: 'vertical',
          width: 200,
          height: 300,
          y: 150,
          children: [
            rectangle('b', {
              width: { mode: 'fill_container' },
              height: 20,
            }),
          ],
        },
      ],
    });

    expect(sizesOf(findNode(layout.roots, 'a').box)).toEqual({
      x: 0,
      y: 0,
      width: 50,
      height: 100,
    });
    expect(sizesOf(findNode(layout.roots, 'b').box)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 20,
    });
  });

  it('uses fallback values when the primary size basis is unavailable', () => {
    const layout = layoutOf({
      version: 1,
      children: [
        rectangle('fallback-rectangle', {
          width: { mode: 'fit_content', fallback: 30 },
          height: { mode: 'fill_container', fallback: 40 },
          x: 10,
          y: 20,
        }),
        {
          id: 'fallback-frame',
          type: 'frame',
          layout: 'none',
          width: { mode: 'fill_container', fallback: 120 },
          height: { mode: 'fit_content', fallback: 80 },
          x: 100,
        },
        {
          id: 'fallback-auto',
          type: 'frame',
          width: { mode: 'fill_container', fallback: 70 },
          children: [
            rectangle('child', {
              width: { mode: 'fit_content', fallback: 20 },
              height: 10,
            }),
          ],
        },
      ],
    });

    expect(layout.issues).toEqual([]);
    expect(sizesOf(findNode(layout.roots, 'fallback-rectangle').box)).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
    expect(sizesOf(findNode(layout.roots, 'fallback-frame').box)).toMatchObject(
      {
        width: 120,
        height: 80,
      },
    );
    expect(sizesOf(findNode(layout.roots, 'fallback-auto').box)).toMatchObject({
      width: 70,
      height: 10,
    });
  });

  it('lays out free-positioning frames from child x and y', () => {
    const layout = layoutOf({
      version: 1,
      children: [
        {
          id: 'frame',
          type: 'frame',
          layout: 'none',
          width: 200,
          height: 100,
          padding: [10, 20, 30, 40],
          children: [
            rectangle('a', { x: 5, y: 6, width: 30, height: 40 }),
            rectangle('b', { width: 10, height: 10 }),
          ],
        },
      ],
    });

    expect(sizesOf(findNode(layout.roots, 'a').box)).toEqual({
      x: 45,
      y: 16,
      width: 30,
      height: 40,
    });
    expect(sizesOf(findNode(layout.roots, 'b').box)).toEqual({
      x: 40,
      y: 10,
      width: 10,
      height: 10,
    });
  });

  it('places document roots at their x and y and sizes the canvas bounds', () => {
    const layout = layoutOf({
      version: 1,
      children: [
        text('label', 'Hi', { x: 24, y: 40 }),
        rectangle('block', { x: 100, y: 10, width: 50, height: 30 }),
      ],
    });

    expect(sizesOf(findNode(layout.roots, 'label').box)).toEqual({
      x: 24,
      y: 40,
      width: 12,
      height: 19.2,
    });
    expect(sizesOf(findNode(layout.roots, 'block').box)).toEqual({
      x: 100,
      y: 10,
      width: 50,
      height: 30,
    });
    expect(layout.width).toBe(150);
    expect(layout.height).toBe(59.2);
  });

  it('resolves text auto, fixed-width and fixed-width-height modes', () => {
    const layout = layoutOf({
      version: 1,
      children: [
        text('auto', 'Hi', { x: 0, y: 0, fontSize: 16 }),
        text('fixed-width', 'Hello world', {
          x: 0,
          y: 50,
          width: 40,
          fontSize: 16,
        }),
        text('fixed-both', 'Hello world', {
          x: 0,
          y: 100,
          width: 40,
          height: 100,
          fontSize: 16,
        }),
        text('line-height', 'Hello world', {
          x: 0,
          y: 220,
          width: 40,
          fontSize: 16,
          lineHeight: 2,
        }),
        text('nowrap', 'Hello world', {
          x: 0,
          y: 320,
          width: 10,
          fontSize: 16,
          textWrap: 'none',
        }),
        text('weighted', 'Hi', {
          x: 0,
          y: 360,
          fontSize: 16,
          fontFamily: 'Georgia',
          fontWeight: 700,
        }),
      ],
    });

    expect(layout.issues).toEqual([]);
    expect(sizesOf(findNode(layout.roots, 'auto').box)).toEqual({
      x: 0,
      y: 0,
      width: 12,
      height: 19.2,
    });
    expect(sizesOf(findNode(layout.roots, 'fixed-width').box)).toEqual({
      x: 0,
      y: 50,
      width: 40,
      height: 38.4,
    });
    expect(sizesOf(findNode(layout.roots, 'fixed-both').box)).toEqual({
      x: 0,
      y: 100,
      width: 40,
      height: 100,
    });
    expect(sizesOf(findNode(layout.roots, 'line-height').box)).toEqual({
      x: 0,
      y: 220,
      width: 40,
      height: 64,
    });
    expect(sizesOf(findNode(layout.roots, 'nowrap').box)).toEqual({
      x: 0,
      y: 320,
      width: 10,
      height: 19.2,
    });
    expect(sizesOf(findNode(layout.roots, 'weighted').box)).toEqual({
      x: 0,
      y: 360,
      width: 12,
      height: 19.2,
    });
  });

  it('resolves variable bindings for sizes, spacing, styles and text measurement', () => {
    const layout = layoutOf({
      version: 1,
      variables: {
        'frame-width': { type: 'number', value: 200 },
        'space-gap': { type: 'number', value: 10 },
        'label-title': { type: 'string', value: '标题' },
        'title-size': { type: 'number', value: 20 },
        'color-brand': { type: 'color', value: '#3366ff' },
      },
      children: [
        {
          id: 'frame',
          type: 'frame',
          width: '$frame-width',
          height: 100,
          gap: '$space-gap',
          children: [
            text('title', '$label-title', {
              fontSize: '$title-size',
              fill: '$color-brand',
            }),
            rectangle('block', { width: 20, height: 20 }),
          ],
        },
      ],
    });

    expect(layout.issues).toEqual([]);
    expect(sizesOf(findNode(layout.roots, 'frame').box)).toMatchObject({
      width: 200,
      height: 100,
    });
    expect(sizesOf(findNode(layout.roots, 'title').box)).toMatchObject({
      x: 0,
      width: 40,
      height: 24,
    });
    expect(sizesOf(findNode(layout.roots, 'block').box)).toMatchObject({
      x: 50,
    });

    const titleNode = findNode(layout.roots, 'title');
    expect(titleNode.element).toMatchObject({
      text: '标题',
      fontSize: 20,
      fill: '#3366ff',
    });
  });

  it('finds a resolved layout node by element id anywhere in the tree', () => {
    const layout = layoutOf({
      version: 1,
      children: [
        {
          id: 'outer',
          type: 'frame',
          layout: 'vertical',
          width: 200,
          height: 100,
          children: [
            {
              id: 'inner',
              type: 'frame',
              layout: 'horizontal',
              width: 100,
              height: 20,
              children: [text('label', 'Hi')],
            },
          ],
        },
      ],
    });

    expect(findLayoutNode(layout, 'outer')?.box).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
    expect(findLayoutNode(layout, 'inner')?.box).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 20,
    });
    expect(findLayoutNode(layout, 'label')?.box).toEqual({
      x: 0,
      y: 0,
      width: 12,
      height: 19.2,
    });
    expect(findLayoutNode(layout, 'missing')).toBeUndefined();
  });

  it('accepts every native element type with explicit or measured sizes', () => {
    const document = {
      version: 1,
      children: [
        {
          id: 'frame',
          type: 'frame',
          layout: 'vertical',
          width: 400,
          height: 300,
          gap: 8,
          padding: [16, 16, 16, 16],
          fill: '#ffffff',
          children: [
            rectangle('rectangle', { width: 100, height: 40, fill: '#ff0000' }),
            {
              id: 'ellipse',
              type: 'ellipse',
              width: 40,
              height: 40,
              fill: '#00ff00',
            },
            text('text', '说明', { fontSize: 16 }),
            {
              id: 'icon',
              type: 'icon',
              library: 'lucide',
              icon: 'arrow-right',
              width: 24,
              height: 24,
            },
          ],
        },
      ],
    };

    expect(validate(document).children).toHaveLength(1);
    expect(layoutOf(document).issues).toEqual([]);
  });
});

describe('layout size validation', () => {
  it('reports the missing axis and property for free-positioning frames', () => {
    const errors = errorsOf({
      version: 1,
      children: [
        {
          id: 'frame',
          type: 'frame',
          layout: 'none',
          width: 200,
        },
      ],
    });

    const missing = errors.filter(
      (error) => error.code === 'missing_size_basis',
    );
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      path: '$.children[0].height',
    });
    expect(missing[0]?.message).toContain('height');
    expect(missing[0]?.message).toContain('高度');
  });

  it('requires both axes on rectangles, ellipses and icons', () => {
    const errors = errorsOf({
      version: 1,
      children: [
        rectangle('rectangle'),
        { id: 'ellipse', type: 'ellipse' },
        { id: 'icon', type: 'icon', library: 'lucide', icon: 'star' },
      ],
    });
    const missingPaths = errors
      .filter((error) => error.code === 'missing_size_basis')
      .map((error) => error.path);

    expect(missingPaths).toEqual(
      expect.arrayContaining([
        '$.children[0].width',
        '$.children[0].height',
        '$.children[1].width',
        '$.children[1].height',
        '$.children[2].width',
        '$.children[2].height',
      ]),
    );
  });

  it('reports nested element paths and does not default free leaf sizes to zero', () => {
    const errors = errorsOf({
      version: 1,
      children: [
        {
          id: 'outer',
          type: 'frame',
          layout: 'none',
          width: 300,
          height: 200,
          children: [
            rectangle('sized', { width: 10, height: 10 }),
            rectangle('unsized'),
          ],
        },
      ],
    });

    expect(
      errors
        .filter((error) => error.code === 'missing_size_basis')
        .map((error) => error.path),
    ).toEqual([
      '$.children[0].children[1].width',
      '$.children[0].children[1].height',
    ]);
  });

  it('accepts alignment fields and rejects illegal positioning values', () => {
    const valid = validate({
      version: 1,
      children: [
        {
          id: 'frame',
          type: 'frame',
          width: 100,
          height: 100,
          justifyContent: 'space_between',
          alignItems: 'center',
          children: [
            rectangle('child', { x: -10, y: 12.5, width: 10, height: 10 }),
          ],
        },
      ],
    });
    expect(valid.children).toHaveLength(1);

    const errors = errorsOf({
      version: 1,
      children: [
        {
          id: 'frame',
          type: 'frame',
          width: 100,
          height: 100,
          justifyContent: 'between',
          alignItems: 'baseline',
          children: [
            rectangle('child', { x: '10', y: true, width: 10, height: 10 }),
          ],
        },
      ],
    });
    const invalidPaths = errors
      .filter((error) => error.code === 'invalid_value')
      .map((error) => error.path);

    expect(invalidPaths).toEqual(
      expect.arrayContaining([
        '$.children[0].justifyContent',
        '$.children[0].alignItems',
        '$.children[0].children[0].x',
        '$.children[0].children[0].y',
      ]),
    );
  });
});
