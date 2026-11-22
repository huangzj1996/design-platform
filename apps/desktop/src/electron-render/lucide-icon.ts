/** One drawable subpath of a Lucide icon, in the library's 24x24 viewBox. */
export interface IconPath {
  path: string;
  /** Whether the source shape asks for a solid fill in the icon color. */
  filled: boolean;
}

type IconAttributes = Record<string, string | number>;
type IconNode = [
  tag: string,
  attributes: IconAttributes,
  children?: IconNode[],
];

export const ICON_VIEWBOX_SIZE = 24;
const cache = new Map<string, Promise<IconPath[] | null>>();

function numberAttribute(
  attributes: IconAttributes,
  name: string,
  fallback = 0,
): number {
  const value = attributes[name];
  if (typeof value === 'number') {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function circlePath(cx: number, cy: number, radius: number): string {
  return `M ${cx - radius} ${cy} A ${radius} ${radius} 0 1 0 ${
    cx + radius
  } ${cy} A ${radius} ${radius} 0 1 0 ${cx - radius} ${cy} Z`;
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 0 ${
    cx - rx
  } ${cy} Z`;
}

function roundedRectanglePath(
  x: number,
  y: number,
  width: number,
  height: number,
  rx: number,
  ry: number,
): string {
  const right = x + width;
  const bottom = y + height;
  if (rx <= 0 || ry <= 0) {
    return `M ${x} ${y} H ${right} V ${bottom} H ${x} Z`;
  }
  const cornerX = Math.min(rx, width / 2);
  const cornerY = Math.min(ry, height / 2);
  return [
    `M ${x + cornerX} ${y}`,
    `H ${right - cornerX}`,
    `A ${cornerX} ${cornerY} 0 0 1 ${right} ${y + cornerY}`,
    `V ${bottom - cornerY}`,
    `A ${cornerX} ${cornerY} 0 0 1 ${right - cornerX} ${bottom}`,
    `H ${x + cornerX}`,
    `A ${cornerX} ${cornerY} 0 0 1 ${x} ${bottom - cornerY}`,
    `V ${y + cornerY}`,
    `A ${cornerX} ${cornerY} 0 0 1 ${x + cornerX} ${y}`,
    'Z',
  ].join(' ');
}

function pointsPath(points: string, close: boolean): string | null {
  const pairs = points
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(',').map(Number))
    .filter(
      (pair): pair is [number, number] =>
        pair.length === 2 &&
        Number.isFinite(pair[0]) &&
        Number.isFinite(pair[1]),
    );
  if (pairs.length === 0) {
    return null;
  }
  const [first, ...rest] = pairs;
  return [
    `M ${first?.[0] ?? 0} ${first?.[1] ?? 0}`,
    ...rest.map(([x, y]) => `L ${x} ${y}`),
    close ? 'Z' : '',
  ].join(' ');
}

function shapePath(node: IconNode): IconPath | null {
  const [tag, attributes] = node;
  const filled = attributes.fill === 'currentColor';

  switch (tag) {
    case 'path': {
      const path = attributes.d;
      return typeof path === 'string' ? { path, filled } : null;
    }
    case 'circle':
      return {
        path: circlePath(
          numberAttribute(attributes, 'cx'),
          numberAttribute(attributes, 'cy'),
          numberAttribute(attributes, 'r'),
        ),
        filled,
      };
    case 'ellipse':
      return {
        path: ellipsePath(
          numberAttribute(attributes, 'cx'),
          numberAttribute(attributes, 'cy'),
          numberAttribute(attributes, 'rx'),
          numberAttribute(attributes, 'ry'),
        ),
        filled,
      };
    case 'rect': {
      const width = numberAttribute(attributes, 'width');
      const height = numberAttribute(attributes, 'height');
      if (width <= 0 || height <= 0) {
        return null;
      }
      const rx = numberAttribute(
        attributes,
        'rx',
        numberAttribute(attributes, 'ry'),
      );
      const ry = numberAttribute(attributes, 'ry', rx);
      return {
        path: roundedRectanglePath(
          numberAttribute(attributes, 'x'),
          numberAttribute(attributes, 'y'),
          width,
          height,
          rx,
          ry,
        ),
        filled,
      };
    }
    case 'line':
      return {
        path: `M ${numberAttribute(attributes, 'x1')} ${numberAttribute(
          attributes,
          'y1',
        )} L ${numberAttribute(attributes, 'x2')} ${numberAttribute(
          attributes,
          'y2',
        )}`,
        filled,
      };
    case 'polyline':
    case 'polygon': {
      const path = pointsPath(
        String(attributes.points ?? ''),
        tag === 'polygon',
      );
      return path === null ? null : { path, filled };
    }
    default:
      return null;
  }
}

function pathsOf(node: IconNode): IconPath[] {
  const own = shapePath(node);
  const nested = (node[2] ?? []).flatMap(pathsOf);
  return own === null ? nested : [own, ...nested];
}

/** Converts a Lucide icon name to the kebab-case key used by the library. */
export function toIconKey(name: string): string {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

async function loadIconPaths(key: string): Promise<IconPath[] | null> {
  const { dynamicIconImports } = await import('lucide-react/dynamic');
  const load = (
    dynamicIconImports as Record<string, (() => Promise<unknown>) | undefined>
  )[key];
  if (load === undefined) {
    return null;
  }
  const module = await load();
  const data = (module as { __iconData?: { node?: IconNode[] } }).__iconData;
  if (data?.node === undefined) {
    return null;
  }
  return data.node.flatMap(pathsOf);
}

/**
 * Loads the drawable paths of a Lucide icon. Unsupported libraries and unknown
 * icon names resolve to null so the canvas can draw its placeholder.
 */
export function loadLucideIconPaths(
  library: string,
  icon: string,
): Promise<IconPath[] | null> {
  if (library.trim().toLowerCase() !== 'lucide') {
    return Promise.resolve(null);
  }

  const key = toIconKey(icon);
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const loaded = loadIconPaths(key).catch(() => null);
  cache.set(key, loaded);
  return loaded;
}
