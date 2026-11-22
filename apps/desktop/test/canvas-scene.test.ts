import {
  validateDesignDocument,
  type DesignDocument,
} from '@design-ai/design-schema';
import { describe, expect, it } from 'vitest';
import {
  buildCanvasScene,
  findCanvasSelection,
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

describe('buildCanvasScene', () => {
  it('builds the element tree with nesting, sibling order and layout boxes', () => {
    const scene = buildCanvasScene(documentFrom(fiveElementDocument));

    expect(scene).toMatchObject({ width: 400, height: 300 });
    expect(scene.roots).toHaveLength(1);

    const frame = findSceneNode(scene, 'frame');
    expect(frame).toMatchObject({
      type: 'frame',
      layout: 'vertical',
      box: { x: 0, y: 0, width: 400, height: 300 },
      children: [
        { id: 'rectangle' },
        { id: 'ellipse' },
        { id: 'text' },
        { id: 'icon' },
      ],
    });
    expect(frame.children.map((child) => child.id)).toEqual([
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

  it('keeps visibility, opacity, rotation and paint attributes', () => {
    const scene = buildCanvasScene(
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
                x: 5,
                y: 6,
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

    expect(findSceneNode(scene, 'styled-frame')).toMatchObject({
      visible: false,
      opacity: 0.5,
      rotation: 30,
      fill: '#ffffff',
      stroke: '#123456',
      strokeWidth: 3,
      cornerRadius: 8,
    });
    expect(findSceneNode(scene, 'styled-rectangle')).toMatchObject({
      visible: true,
      opacity: 1,
      rotation: 0,
      fill: '#ff0000',
      stroke: '#00ff00',
      strokeWidth: 2,
      cornerRadius: 4,
    });
    expect(findSceneNode(scene, 'styled-ellipse')).toMatchObject({
      fill: '#0000ff',
      box: { width: 40, height: 40 },
    });
  });

  it('keeps text content and typography', () => {
    const scene = buildCanvasScene(
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
        ],
      }),
    );

    expect(findSceneNode(scene, 'wrapped')).toMatchObject({
      type: 'text',
      box: { width: 40, height: 48 },
      text: {
        content: 'Hello world',
        fontFamily: 'Georgia',
        fontSize: 16,
        fontWeight: 700,
        lineHeight: 1.5,
        textAlign: 'center',
        textWrap: 'wrap',
      },
    });
  });

  it('keeps icon identifiers, color and stroke width', () => {
    const scene = buildCanvasScene(
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
            library: 'other',
            icon: 'star',
            width: 20,
            height: 20,
            y: 30,
            stroke: '#654321',
            strokeWidth: 1,
          },
        ],
      }),
    );

    expect(findSceneNode(scene, 'known-icon').icon).toEqual({
      library: 'lucide',
      icon: 'arrow-right',
      color: '#123456',
      strokeWidth: 2,
    });
    expect(findSceneNode(scene, 'unknown-icon').icon).toEqual({
      library: 'other',
      icon: 'star',
      color: '#654321',
      strokeWidth: 1,
    });
  });

  it('resolves variable values for the scene while the document keeps references', () => {
    const document = documentFrom({
      version: 1,
      variables: {
        'color-brand': { type: 'color', value: '#3366ff' },
        'label-title': { type: 'string', value: '欢迎' },
        'space-gap': { type: 'number', value: 8 },
        'size-width': { type: 'number', value: 120 },
        'show-caption': { type: 'boolean', value: false },
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
              fill: '$color-brand',
            },
            {
              id: 'variable-title',
              type: 'text',
              text: '$label-title',
              fill: '$color-brand',
              visible: '$show-caption',
            },
          ],
        },
      ],
    });

    const scene = buildCanvasScene(document);

    expect(findSceneNode(scene, 'brand-block')).toMatchObject({
      fill: '#3366ff',
      box: { x: 10, y: 10, width: 120 },
    });
    expect(findSceneNode(scene, 'variable-title')).toMatchObject({
      visible: false,
      fill: '#3366ff',
      text: { content: '欢迎' },
      box: { y: 38 },
    });

    const frame = document.children[0];
    expect(frame).toMatchObject({ gap: '$space-gap' });
    if (frame?.type === 'frame') {
      expect(frame.children?.[0]).toMatchObject({
        width: '$size-width',
        fill: '$color-brand',
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
