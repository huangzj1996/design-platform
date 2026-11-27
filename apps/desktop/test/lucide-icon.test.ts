import { toIconKey } from '@design-ai/editor-core/leafer';
import { describe, expect, it } from 'vitest';
import { loadLucideIconPaths } from '../src/electron-render/lucide-icon';

describe('Lucide icon paths', () => {
  it('normalizes icon names to the kebab-case library keys', () => {
    expect(toIconKey('arrow-right')).toBe('arrow-right');
    expect(toIconKey('ArrowRight')).toBe('arrow-right');
    expect(toIconKey('  arrow_right ')).toBe('arrow-right');
  });

  it('loads paths for known icons, including circles and rectangles', async () => {
    const arrow = await loadLucideIconPaths('lucide', 'arrow-right');
    expect(arrow).not.toBeNull();
    expect(arrow).toHaveLength(2);
    expect(arrow?.every((shape) => /^[Mm]/.test(shape.path))).toBe(true);
    expect(arrow?.every((shape) => !shape.filled)).toBe(true);

    const search = await loadLucideIconPaths('lucide', 'Search');
    expect(search).not.toBeNull();
    expect(search?.some((shape) => shape.path.includes('A'))).toBe(true);

    const square = await loadLucideIconPaths('lucide', 'square');
    expect(square).not.toBeNull();
    expect(square?.some((shape) => shape.path.includes('H'))).toBe(true);

    const tag = await loadLucideIconPaths('lucide', 'tag');
    expect(tag?.some((shape) => shape.filled)).toBe(true);
  });

  it('returns null for unknown icons and other libraries', async () => {
    await expect(
      loadLucideIconPaths('lucide', 'not-a-real-icon'),
    ).resolves.toBeNull();
    await expect(loadLucideIconPaths('other', 'star')).resolves.toBeNull();
  });
});
