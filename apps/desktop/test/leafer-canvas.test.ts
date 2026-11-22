import { describe, expect, it } from 'vitest';
import { selectedElementId } from '../src/electron-render/leafer-canvas';

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
