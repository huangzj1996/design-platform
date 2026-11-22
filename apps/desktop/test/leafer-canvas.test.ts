import { describe, expect, it } from 'vitest';
import type { CanvasSceneNode } from '../src/electron-render/canvas-scene';
import {
  canvasNodeInput,
  fillPaint,
  selectedElementId,
} from '../src/electron-render/leafer-canvas';

function sceneNode(overrides: Partial<CanvasSceneNode>): CanvasSceneNode {
  return {
    id: 'node',
    type: 'frame',
    box: { x: 1, y: 2, width: 10, height: 20 },
    opacity: 1,
    rotation: 0,
    visible: true,
    children: [],
    ...overrides,
  };
}

describe('canvasNodeInput', () => {
  it('hides overflow only for clipped frames', () => {
    expect(
      canvasNodeInput(sceneNode({ type: 'frame', clipContent: true })),
    ).toMatchObject({ overflow: 'hide' });
    expect(canvasNodeInput(sceneNode({ type: 'frame' })).overflow).toBe(
      undefined,
    );
    expect(
      canvasNodeInput(sceneNode({ type: 'rectangle', clipContent: true }))
        .overflow,
    ).toBe(undefined);
  });

  it('applies fill opacity to the fill without changing element opacity', () => {
    const input = canvasNodeInput(
      sceneNode({
        fill: '#ff0000',
        fillOpacity: 0.5,
        stroke: '#000000',
        strokeWidth: 2,
        opacity: 0.8,
      }),
    );

    expect(input.fill).toEqual({
      type: 'solid',
      color: '#ff0000',
      opacity: 0.5,
    });
    expect(input.stroke).toBe('#000000');
    expect(input.opacity).toBe(0.8);
  });

  it('keeps a plain fill color when fill opacity is full or unset', () => {
    expect(canvasNodeInput(sceneNode({ fill: '#ff0000' })).fill).toBe(
      '#ff0000',
    );
    expect(
      canvasNodeInput(sceneNode({ fill: '#ff0000', fillOpacity: 1 })).fill,
    ).toBe('#ff0000');
  });
});

describe('fillPaint', () => {
  it('builds a solid paint only when a partial opacity applies', () => {
    expect(fillPaint('#123456', 0.5)).toEqual({
      type: 'solid',
      color: '#123456',
      opacity: 0.5,
    });
    expect(fillPaint('#123456', undefined)).toBe('#123456');
    expect(fillPaint('#123456', 1)).toBe('#123456');
    expect(fillPaint(undefined, 0.5)).toBeUndefined();
  });
});

describe('selectedElementId', () => {
  it('finds the nearest element id from a nested hit node', () => {
    const frame = { data: { elementId: 'frame' }, parent: null };
    const iconContainer = { data: { elementId: 'icon' }, parent: frame };
    const iconPath = { data: {}, parent: iconContainer };

    expect(selectedElementId(iconPath)).toBe('icon');
    expect(selectedElementId(frame)).toBe('frame');
  });

  it('returns null for empty space and targets without element ids', () => {
    expect(selectedElementId(undefined)).toBeNull();
    expect(selectedElementId({ data: {}, parent: null })).toBeNull();
    expect(
      selectedElementId({ data: { elementId: 42 }, parent: null }),
    ).toBeNull();
  });
});
