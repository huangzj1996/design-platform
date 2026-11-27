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
