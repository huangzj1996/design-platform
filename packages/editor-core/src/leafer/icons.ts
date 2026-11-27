/** One drawable subpath of an icon, in the library's 24x24 view box. */
export interface IconPaint {
  path: string;
  /** Whether the source shape asks for a solid fill in the icon color. */
  filled: boolean;
}

/** Resolved icon paints keyed by {@link iconPaintKey}. */
export type IconPaintMap = Readonly<
  Record<string, readonly IconPaint[] | null | undefined>
>;

export const ICON_VIEWBOX_SIZE = 24;

/** Converts an icon name to the kebab-case key used by icon libraries. */
export function toIconKey(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/** Key for one icon's paints in a scene-wide icon paint map. */
export function iconPaintKey(library: string, icon: string): string {
  return `${library.trim().toLowerCase()}/${toIconKey(icon)}`;
}
