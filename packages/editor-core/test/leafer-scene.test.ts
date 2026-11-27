import { Path } from '@leafer-ui/draw';
import { validateDesignDocument } from '@design-ai/design-schema';
import { describe, expect, it } from 'vitest';
import {
  createLeaferScene,
  selectedElementId,
  type LeaferSceneNode,
} from '../src/leafer/scene';

function documentFrom(input: unknown) {
  const result = validateDesignDocument(input);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.document;
}

function findNode(
  nodes: readonly LeaferSceneNode[],
  id: string,
): LeaferSceneNode {
  const visit = (
    candidates: readonly LeaferSceneNode[],
  ): LeaferSceneNode | undefined => {
    for (const node of candidates) {
      if (node.id === id) {
        return node;
      }
      const nested = visit(node.children);
      if (nested !== undefined) {
        return nested;
      }
    }
    return undefined;
  };
  const node = visit(nodes);
  if (node === undefined) {
    throw new Error(`No Leafer node for ${id}`);
  }
  return node;
}

const document = documentFrom({
  version: 2,
  children: [
    {
      id: 'frame',
      type: 'frame',
      layout: 'vertical',
      width: 400,
      height: 300,
      padding: [16, 16, 16, 16],
      gap: 8,
      fill: [{ type: 'color', color: '#ffffff' }],
      clip: true,
      children: [
        {
          id: 'rectangle',
          type: 'rectangle',
          width: 100,
          height: 40,
          fill: [{ type: 'color', color: '#ff0000', opacity: 0.5 }],
          stroke: { fill: [{ type: 'color', color: '#000000' }], width: 2 },
          cornerRadius: 4,
        },
        { id: 'second', type: 'rectangle', width: 40, height: 20 },
      ],
    },
  ],
});

describe('createLeaferScene', () => {
  it('returns mountable nodes with ids, nesting and sibling order', () => {
    const scene = createLeaferScene(document);
    const frame = findNode(scene.roots, 'frame');
    const rectangle = findNode(scene.roots, 'rectangle');

    expect(scene).toMatchObject({ width: 400, height: 300 });
    expect(scene.roots).toHaveLength(1);
    expect(frame.node.tag).toBe('Box');
    expect(frame.children.map((child) => child.id)).toEqual([
      'rectangle',
      'second',
    ]);
    expect(frame.children.map((child) => child.node.tag)).toEqual([
      'Rect',
      'Rect',
    ]);
    expect(rectangle.box).toEqual({ x: 16, y: 16, width: 100, height: 40 });
    expect(rectangle.node.x).toBe(16);
    expect(rectangle.node.y).toBe(16);
    expect(frame.node.children).toHaveLength(2);
    expect(frame.node.children?.[0]).toBe(rectangle.node);
    expect(rectangle.node.data).toEqual({ elementId: 'rectangle' });
  });

  it('maps v2 paint, radius, clipping and opacity onto the node', () => {
    const frame = findNode(createLeaferScene(document).roots, 'frame');
    const rectangle = findNode(createLeaferScene(document).roots, 'rectangle');

    expect(frame.node.overflow).toBe('hide');
    expect(frame.node.fill).toBe('#ffffff');
    expect(rectangle.node.fill).toEqual({
      type: 'solid',
      color: '#ff0000',
      opacity: 0.5,
    });
    expect(rectangle.node.stroke).toBe('#000000');
    expect(rectangle.node.strokeWidth).toBe(2);
    expect(rectangle.node.cornerRadius).toBe(4);
  });

  it('resolves variable references for rendering only', () => {
    const variableDocument = documentFrom({
      version: 2,
      variables: {
        'brand-color': { type: 'color', value: '#3366ff' },
        'box-width': { type: 'number', value: 120 },
      },
      children: [
        {
          id: 'bound',
          type: 'rectangle',
          width: '$box-width',
          height: 20,
          fill: [{ type: 'color', color: '$brand-color' }],
        },
      ],
    });

    const scene = createLeaferScene(variableDocument);
    const bound = findNode(scene.roots, 'bound');

    expect(bound.node.width).toBe(120);
    expect(bound.node.fill).toBe('#3366ff');
    expect(variableDocument.children[0]).toMatchObject({
      width: '$box-width',
      fill: [{ type: 'color', color: '$brand-color' }],
    });
  });

  it('resolves the element id from a nested hit target', () => {
    const frame = { data: { elementId: 'frame' }, parent: null };
    const path = { data: {}, parent: frame };

    expect(selectedElementId(path)).toBe('frame');
    expect(selectedElementId(undefined)).toBeNull();
    expect(
      selectedElementId({ data: { elementId: 42 }, parent: null }),
    ).toBeNull();
  });
});

const fiveElementDocument = documentFrom({
  version: 2,
  variables: {
    'brand-color': { type: 'color', value: '#3366ff' },
    'block-width': { type: 'number', value: 120 },
    'corner-radius': { type: 'number', value: 6 },
    title: { type: 'string', value: '你好' },
    'icon-name': { type: 'string', value: 'Star' },
  },
  children: [
    {
      id: 'frame',
      type: 'frame',
      layout: 'vertical',
      width: 360,
      height: 240,
      padding: 12,
      gap: 8,
      fill: [{ type: 'color', color: '#ffffff' }],
      clip: true,
      children: [
        {
          id: 'rectangle',
          type: 'rectangle',
          width: '$block-width',
          height: 40,
          fill: [{ type: 'color', color: '$brand-color' }],
          stroke: { fill: [{ type: 'color', color: '#000000' }], width: 2 },
          cornerRadius: '$corner-radius',
          opacity: 0.5,
          rotation: 15,
        },
        {
          id: 'ellipse',
          type: 'ellipse',
          width: 40,
          height: 40,
          fill: [{ type: 'color', color: '#00aa00', opacity: 0.5 }],
        },
        {
          id: 'text',
          type: 'text',
          textStyle: {
            content: '$title',
            textGrowth: 'fixed-width-height',
            width: 120,
            height: 48,
            fontFamily: 'Georgia',
            fontSize: 20,
            fontWeight: 700,
            lineHeight: 1.5,
            textAlign: 'center',
          },
          fill: [{ type: 'color', color: '#111111' }],
        },
        {
          id: 'icon',
          type: 'icon',
          width: 48,
          height: 24,
          library: 'lucide',
          icon: '$icon-name',
          fill: [{ type: 'color', color: '$brand-color' }],
        },
      ],
    },
  ],
});

describe('five element types', () => {
  it('creates a mountable node type for every element', () => {
    const scene = createLeaferScene(fiveElementDocument);

    expect(scene).toMatchObject({ width: 360, height: 240 });
    expect(scene.roots).toHaveLength(1);
    expect(scene.roots[0]?.node.tag).toBe('Box');
    expect(findNode(scene.roots, 'rectangle').node.tag).toBe('Rect');
    expect(findNode(scene.roots, 'ellipse').node.tag).toBe('Ellipse');
    expect(findNode(scene.roots, 'text').node.tag).toBe('Text');
    expect(findNode(scene.roots, 'icon').node.tag).toBe('Box');
  });

  it('keeps hierarchy, sibling order and element ids', () => {
    const frame = findNode(
      createLeaferScene(fiveElementDocument).roots,
      'frame',
    );

    expect(frame.type).toBe('frame');
    expect(frame.children.map((child) => child.id)).toEqual([
      'rectangle',
      'ellipse',
      'text',
      'icon',
    ]);
    expect(frame.children.map((child) => child.type)).toEqual([
      'rectangle',
      'ellipse',
      'text',
      'icon',
    ]);
    expect(frame.node.children?.map((child) => child.data)).toEqual([
      { elementId: 'rectangle' },
      { elementId: 'ellipse' },
      { elementId: 'text' },
      { elementId: 'icon' },
    ]);
    expect(frame.node.children?.[0]).toBe(frame.children[0]?.node);
    expect(frame.node.children?.[3]).toBe(frame.children[3]?.node);
  });

  it('reuses layout boxes as relative node geometry', () => {
    const scene = createLeaferScene(fiveElementDocument);
    const boxes = {
      frame: { x: 0, y: 0, width: 360, height: 240 },
      rectangle: { x: 12, y: 12, width: 120, height: 40 },
      ellipse: { x: 12, y: 60, width: 40, height: 40 },
      text: { x: 12, y: 108, width: 120, height: 48 },
      icon: { x: 12, y: 164, width: 48, height: 24 },
    };

    for (const [id, box] of Object.entries(boxes)) {
      const node = findNode(scene.roots, id);
      expect(node.box).toEqual(box);
      expect(node.node).toMatchObject({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      });
    }
  });

  it('renders paint, opacity and rotation while keeping variable references', () => {
    const scene = createLeaferScene(fiveElementDocument);
    const frame = findNode(scene.roots, 'frame');
    const rectangle = findNode(scene.roots, 'rectangle');
    const ellipse = findNode(scene.roots, 'ellipse');

    expect(frame.node.overflow).toBe('hide');
    expect(frame.node.fill).toBe('#ffffff');
    expect(rectangle.node.fill).toBe('#3366ff');
    expect(rectangle.node.stroke).toBe('#000000');
    expect(rectangle.node.strokeWidth).toBe(2);
    expect(rectangle.node.cornerRadius).toBe(6);
    expect(rectangle.node.opacity).toBe(0.5);
    expect(rectangle.node.rotation).toBe(15);
    expect(rectangle.node.origin).toBe('center');
    expect(ellipse.node.fill).toEqual({
      type: 'solid',
      color: '#00aa00',
      opacity: 0.5,
    });

    expect(fiveElementDocument.children[0]).toMatchObject({
      fill: [{ type: 'color', color: '#ffffff' }],
    });
    expect(rectangle.element).toMatchObject({
      width: '$block-width',
      fill: [{ type: 'color', color: '$brand-color' }],
      cornerRadius: '$corner-radius',
    });
  });

  it('renders text content and typography with v2 defaults', () => {
    const scene = createLeaferScene(fiveElementDocument);
    const text = findNode(scene.roots, 'text');

    expect(text.text).toBe('你好');
    expect(text.node).toMatchObject({
      text: '你好',
      fontFamily: 'Georgia',
      fontSize: 20,
      fontWeight: 700,
      lineHeight: { type: 'percent', value: 1.5 },
      textAlign: 'center',
      textWrap: 'break',
      verticalAlign: 'top',
      fill: '#111111',
    });
    expect(text.element).toMatchObject({
      textStyle: { content: '$title' },
    });

    const plain = findNode(
      createLeaferScene(
        documentFrom({
          version: 2,
          children: [
            { id: 'plain', type: 'text', textStyle: { content: 'Hi' } },
          ],
        }),
      ).roots,
      'plain',
    );
    expect(plain.node).toMatchObject({
      fontFamily: 'sans-serif',
      fontSize: 16,
      lineHeight: { type: 'percent', value: 1.2 },
      textWrap: 'none',
      fill: '#1f2328',
    });
  });

  it('renders icons from resolved library and icon names', () => {
    const scene = createLeaferScene(fiveElementDocument);
    const icon = findNode(scene.roots, 'icon');

    expect(icon.icon).toEqual({
      library: 'lucide',
      icon: 'Star',
      color: '#3366ff',
      strokeWidth: 2,
    });
    const paints = icon.node.children ?? [];
    expect(paints.length).toBeGreaterThan(0);
    expect(selectedElementId(paints[0])).toBe('icon');
  });
});

describe('icon paints', () => {
  const starPaints = {
    'lucide/star': [
      { path: 'M12 2 L15 9 L22 9 L16 14 L18 21 L12 17 Z', filled: true },
      { path: 'M12 6 L12 18', filled: false },
    ],
  };

  it('draws icon paths as inner paint nodes scaled to the element box', () => {
    const icon = findNode(
      createLeaferScene(fiveElementDocument, { icons: starPaints }).roots,
      'icon',
    );

    const paints = icon.node.children ?? [];
    expect(paints).toHaveLength(2);
    expect(paints.map((paint) => paint.tag)).toEqual(['Path', 'Path']);
    expect(paints[0]).toBeInstanceOf(Path);

    const filled = paints[0] as Path;
    expect(filled.path).toBe(starPaints['lucide/star'][0]?.path);
    expect(filled.fill).toBe('#3366ff');
    expect(filled.stroke).toBe('#3366ff');
    expect(filled.strokeWidth).toBe(2);
    expect(filled.scaleX).toBe(2);
    expect(filled.scaleY).toBe(1);

    const stroked = paints[1] as Path;
    expect(stroked.fill).toBeUndefined();
    expect(stroked.stroke).toBe('#3366ff');
  });

  it('resolves the icon element from every inner paint node', () => {
    const icon = findNode(
      createLeaferScene(fiveElementDocument, { icons: starPaints }).roots,
      'icon',
    );

    for (const paint of icon.node.children ?? []) {
      expect(paint.data?.elementId).toBeUndefined();
      expect(selectedElementId(paint)).toBe('icon');
    }
  });
});
