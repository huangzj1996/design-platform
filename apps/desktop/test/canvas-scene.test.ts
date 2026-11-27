import {
  validateDesignDocument,
  type DesignDocument,
} from '@design-ai/design-schema';
import { describe, expect, it } from 'vitest';
import {
  buildCanvasScene,
  collectCanvasIconKeys,
  findCanvasSelection,
  loadCanvasIconPaints,
} from '../src/electron-render/canvas-scene';
import { findSceneNode } from './test-canvas-engine';

function documentFrom(input: unknown): DesignDocument {
  const result = validateDesignDocument(input);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.document;
}

const fiveElementDocument = {
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
      children: [
        {
          id: 'rectangle',
          type: 'rectangle',
          width: 100,
          height: 40,
          fill: [{ type: 'color', color: '#ff0000' }],
          stroke: { fill: [{ type: 'color', color: '#000000' }], width: 2 },
          cornerRadius: 4,
        },
        {
          id: 'ellipse',
          type: 'ellipse',
          width: 40,
          height: 40,
          fill: [{ type: 'color', color: '#00ff00' }],
        },
        {
          id: 'text',
          type: 'text',
          textStyle: {
            content: '标题',
            textGrowth: 'fixed-width-height',
            width: 40,
            height: 30,
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
          library: 'lucide',
          icon: 'arrow-right',
          width: 24,
          height: 24,
        },
      ],
    },
  ],
};

describe('buildCanvasScene', () => {
  it('adapts the document with nesting, sibling order and layout boxes', () => {
    const scene = buildCanvasScene(documentFrom(fiveElementDocument));

    expect(scene).toMatchObject({ width: 400, height: 300 });
    expect(scene.roots).toHaveLength(1);

    const frame = findSceneNode(scene, 'frame');
    expect(frame.type).toBe('frame');
    expect(frame.box).toEqual({ x: 0, y: 0, width: 400, height: 300 });
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

    expect(findSceneNode(scene, 'rectangle').box).toEqual({
      x: 16,
      y: 16,
      width: 100,
      height: 40,
    });
    expect(findSceneNode(scene, 'ellipse').box).toEqual({
      x: 16,
      y: 64,
      width: 40,
      height: 40,
    });
    expect(findSceneNode(scene, 'text').box).toEqual({
      x: 16,
      y: 112,
      width: 40,
      height: 30,
    });
    expect(findSceneNode(scene, 'icon').box).toEqual({
      x: 16,
      y: 150,
      width: 24,
      height: 24,
    });
  });

  it('loads icon paints and draws them inside the icon element', async () => {
    const document = documentFrom(fiveElementDocument);

    expect(collectCanvasIconKeys(document)).toEqual(['lucide/arrow-right']);
    const icons = await loadCanvasIconPaints(collectCanvasIconKeys(document));
    expect(icons['lucide/arrow-right']?.map((paint) => paint.filled)).toEqual([
      false,
      false,
    ]);

    const icon = findSceneNode(buildCanvasScene(document, icons), 'icon');
    expect(icon.node.children?.map((child) => child.tag)).toEqual([
      'Path',
      'Path',
    ]);
  });

  it('resolves icon keys through variables and deduplicates them', () => {
    const document = documentFrom({
      version: 2,
      variables: {
        'icon-name': { type: 'string', value: 'Star' },
      },
      children: [
        {
          id: 'first-icon',
          type: 'icon',
          library: 'lucide',
          icon: '$icon-name',
          width: 24,
          height: 24,
        },
        {
          id: 'second-icon',
          type: 'icon',
          library: 'lucide',
          icon: 'star',
          width: 24,
          height: 24,
        },
      ],
    });

    expect(collectCanvasIconKeys(document)).toEqual(['lucide/star']);
  });

  it('resolves variable values for the scene while the document keeps references', () => {
    const document = documentFrom({
      version: 2,
      variables: {
        'color-brand': { type: 'color', value: '#3366ff' },
        'label-title': { type: 'string', value: '欢迎' },
        'space-gap': { type: 'number', value: 8 },
        'size-width': { type: 'number', value: 120 },
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
              id: 'brand-block',
              type: 'rectangle',
              width: '$size-width',
              height: 20,
              fill: [{ type: 'color', color: '$color-brand' }],
            },
            {
              id: 'variable-title',
              type: 'text',
              textStyle: { content: '$label-title' },
              fill: [{ type: 'color', color: '$color-brand' }],
            },
          ],
        },
      ],
    });

    const scene = buildCanvasScene(document);

    expect(findSceneNode(scene, 'brand-block')).toMatchObject({
      box: { x: 10, y: 10, width: 120 },
    });
    expect(findSceneNode(scene, 'brand-block').node.fill).toBe('#3366ff');
    expect(findSceneNode(scene, 'variable-title').text).toBe('欢迎');
    expect(findSceneNode(scene, 'variable-title').node.fill).toBe('#3366ff');
    expect(findSceneNode(scene, 'variable-title').box.y).toBe(38);

    const frame = document.children[0];
    expect(frame).toMatchObject({ gap: '$space-gap' });
    if (frame?.type === 'frame') {
      expect(frame.children?.[0]).toMatchObject({
        width: '$size-width',
        fill: [{ type: 'color', color: '$color-brand' }],
      });
    }
  });
});

describe('findCanvasSelection', () => {
  const scene = buildCanvasScene(documentFrom(fiveElementDocument));

  it('describes the selected element outline and size tag', () => {
    const selection = findCanvasSelection(scene, 'rectangle');

    expect(selection).not.toBeNull();
    if (selection === null) {
      return;
    }

    expect(selection.box).toEqual({ x: 16, y: 16, width: 100, height: 40 });
    expect(selection.rotation).toBe(0);
    expect(selection.outline).toEqual({ color: '#4592FF', strokeWidth: 3 });
    expect(selection.sizeTag).toMatchObject({
      text: '100 × 40',
      fill: '#4592FF',
      color: '#FFFFFF',
      fontSize: 13,
      fontWeight: 600,
      cornerRadius: 7,
    });
    expect(selection.sizeTag.box).toMatchObject({ height: 24 });
    expect(selection.sizeTag.box.y).toBe(16 + 40 + 7);
    expect(
      selection.sizeTag.box.x + selection.sizeTag.box.width / 2,
    ).toBeCloseTo(16 + 100 / 2);
  });

  it('accumulates nested offsets for the selected element', () => {
    const selection = findCanvasSelection(scene, 'text');

    expect(selection?.box).toEqual({ x: 16, y: 112, width: 40, height: 30 });
    expect(selection?.sizeTag.text).toBe('40 × 30');
  });

  it('returns null for a missing selection or an unknown element', () => {
    expect(findCanvasSelection(scene, null)).toBeNull();
    expect(findCanvasSelection(scene, 'missing')).toBeNull();
  });
});
