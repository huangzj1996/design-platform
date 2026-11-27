import { Box, Ellipse, Path, Rect, Text, type UI } from '@leafer-ui/draw';
import {
  layoutDesignDocument,
  resolveVariableValue,
  type DesignDocument,
  type DesignElement,
  type DesignVariables,
  type ElementType,
  type LayoutBox,
  type LayoutNode,
} from '@design-ai/design-schema';
import { ICON_VIEWBOX_SIZE, iconPaintKey, type IconPaintMap } from './icons';

type FillLayer = NonNullable<DesignElement['fill']>[number];

/** Resolved drawing data of one icon element. */
export interface LeaferSceneIcon {
  library: string;
  icon: string;
  /** Stroke and filled-path color used by the icon's paint nodes. */
  color: string;
  strokeWidth: number;
}

/** One design element adapted to a mountable LeaferJS node. */
export interface LeaferSceneNode {
  /** Element id carried by the source design and the node's `data`. */
  id: string;
  type: ElementType;
  /** The source element, keeping its declarations and variable references. */
  element: DesignElement;
  /** Resolved layout box relative to the parent's border box. */
  box: LayoutBox;
  /** Mountable LeaferJS node, including its child nodes. */
  node: UI;
  /** Resolved text content for text elements. */
  text?: string;
  /** Resolved drawing data for icon elements. */
  icon?: LeaferSceneIcon;
  children: LeaferSceneNode[];
}

/** The mountable node tree for one laid-out design document. */
export interface LeaferScene {
  /** Bounding size of all root elements. */
  width: number;
  height: number;
  roots: LeaferSceneNode[];
}

export interface LeaferSceneOptions {
  /** Resolved icon paints keyed by `iconPaintKey`. Missing icons use a placeholder. */
  icons?: IconPaintMap;
}

const DEFAULT_FOREGROUND_COLOR = '#1f2328';
const DEFAULT_FONT_FAMILY = 'sans-serif';
// Kept in sync with design-schema's text measurement defaults so the painted
// text matches its laid-out box.
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_LINE_HEIGHT = 1.2;
const DEFAULT_ICON_STROKE_WIDTH = 2;
const ICON_PLACEHOLDER_COLOR = '#8250df';
/** Dashed frame and question mark used until an icon's paths are available. */
const ICON_PLACEHOLDER_FRAME = 'M 3 3 H 21 V 21 H 3 Z';
const ICON_PLACEHOLDER_MARK =
  'M 9 9 A 3 3 0 1 1 15 9 C 15 12 12 11.5 12 14 M 12 17 L 12 17.1';

type Paint = string | { type: 'solid'; color: string; opacity: number };

function resolvedString(
  value: unknown,
  variables: Readonly<DesignVariables>,
): string | undefined {
  const resolved = resolveVariableValue(value, variables);
  return typeof resolved === 'string' ? resolved : undefined;
}

function resolvedNumber(
  value: unknown,
  variables: Readonly<DesignVariables>,
): number | undefined {
  const resolved = resolveVariableValue(value, variables);
  return typeof resolved === 'number' ? resolved : undefined;
}

function resolvedBoolean(
  value: unknown,
  variables: Readonly<DesignVariables>,
): boolean {
  return resolveVariableValue(value, variables) === true;
}

/** Maps v2 color fill layers onto Leafer paints, preserving their order. */
function fillPaint(
  layers: readonly FillLayer[] | undefined,
  variables: Readonly<DesignVariables>,
): Paint | Paint[] | undefined {
  const paints: Paint[] = [];
  for (const layer of layers ?? []) {
    if (layer.type !== 'color') {
      continue;
    }
    const color = resolvedString(layer.color, variables);
    if (color === undefined) {
      continue;
    }
    const opacity = resolvedNumber(layer.opacity, variables) ?? 1;
    paints.push(opacity < 1 ? { type: 'solid', color, opacity } : color);
  }
  if (paints.length === 0) {
    return undefined;
  }
  return paints.length === 1 ? paints[0] : paints;
}

/** First resolved color of an ordered fill layer list. */
function firstColor(
  layers: readonly FillLayer[] | undefined,
  variables: Readonly<DesignVariables>,
): string | undefined {
  for (const layer of layers ?? []) {
    if (layer.type === 'color') {
      const color = resolvedString(layer.color, variables);
      if (color !== undefined) {
        return color;
      }
    }
  }
  return undefined;
}

function elementStroke(
  element: DesignElement,
  variables: Readonly<DesignVariables>,
): {
  stroke: Paint | Paint[] | undefined;
  strokeWidth: number | undefined;
} {
  const stroke = element.stroke;
  if (stroke === undefined) {
    return { stroke: undefined, strokeWidth: undefined };
  }
  return {
    stroke: fillPaint(stroke.fill, variables),
    strokeWidth: resolvedNumber(stroke.width, variables) ?? 1,
  };
}

function elementCornerRadius(
  element: DesignElement,
  variables: Readonly<DesignVariables>,
): number | number[] | undefined {
  const value = element.cornerRadius;
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((radius) => resolvedNumber(radius, variables) ?? 0);
  }
  return resolvedNumber(value, variables);
}

function baseNodeInput(
  element: DesignElement,
  box: LayoutBox,
  variables: Readonly<DesignVariables>,
) {
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    opacity: resolvedNumber(element.opacity, variables) ?? 1,
    rotation: resolvedNumber(element.rotation, variables) ?? 0,
    origin: 'center' as const,
    hitFill: 'all' as const,
    data: { elementId: element.id },
  };
}

function nodeInput(
  element: DesignElement,
  box: LayoutBox,
  variables: Readonly<DesignVariables>,
) {
  const { stroke, strokeWidth } = elementStroke(element, variables);
  return {
    ...baseNodeInput(element, box, variables),
    fill: fillPaint(element.fill, variables),
    stroke,
    strokeWidth,
    cornerRadius: elementCornerRadius(element, variables),
  };
}

function textInput(
  element: Extract<DesignElement, { type: 'text' }>,
  box: LayoutBox,
  variables: Readonly<DesignVariables>,
) {
  const style = element.textStyle;
  const content = resolvedString(style.content, variables) ?? '';
  const growth = style.textGrowth ?? 'auto';
  return {
    text: content,
    fontFamily:
      resolvedString(style.fontFamily, variables) ?? DEFAULT_FONT_FAMILY,
    fontSize: resolvedNumber(style.fontSize, variables) ?? DEFAULT_FONT_SIZE,
    fontWeight: resolvedNumber(style.fontWeight, variables),
    lineHeight: {
      type: 'percent' as const,
      value: resolvedNumber(style.lineHeight, variables) ?? DEFAULT_LINE_HEIGHT,
    },
    textAlign: style.textAlign,
    textWrap: growth === 'auto' ? ('none' as const) : ('break' as const),
    verticalAlign: 'top' as const,
  };
}

function resolveIcon(
  element: Extract<DesignElement, { type: 'icon' }>,
  variables: Readonly<DesignVariables>,
): LeaferSceneIcon {
  return {
    library: resolvedString(element.library, variables) ?? element.library,
    icon: resolvedString(element.icon, variables) ?? element.icon,
    color:
      firstColor(element.fill, variables) ??
      firstColor(element.stroke?.fill, variables) ??
      DEFAULT_FOREGROUND_COLOR,
    strokeWidth:
      resolvedNumber(element.stroke?.width, variables) ??
      DEFAULT_ICON_STROKE_WIDTH,
  };
}

/** Scale that maps the icon library's view box onto the element box. */
function iconScale(box: LayoutBox): { scaleX: number; scaleY: number } {
  return {
    scaleX: box.width / ICON_VIEWBOX_SIZE,
    scaleY: box.height / ICON_VIEWBOX_SIZE,
  };
}

function iconPlaceholderNodes(box: LayoutBox): UI[] {
  const scale = iconScale(box);
  return [
    new Path({
      path: ICON_PLACEHOLDER_FRAME,
      stroke: ICON_PLACEHOLDER_COLOR,
      strokeWidth: 1,
      dashPattern: [4, 4],
      ...scale,
      hittable: false,
    }),
    new Path({
      path: ICON_PLACEHOLDER_MARK,
      stroke: ICON_PLACEHOLDER_COLOR,
      strokeWidth: 2,
      strokeCap: 'round',
      strokeJoin: 'round',
      ...scale,
      hittable: false,
    }),
  ];
}

/** Draws icon paths scaled from the library's 24x24 view box to the element. */
function iconPaintNodes(
  box: LayoutBox,
  paints: NonNullable<IconPaintMap[string]>,
  icon: LeaferSceneIcon,
): UI[] {
  const scale = iconScale(box);
  return paints.map(
    (paint) =>
      new Path({
        path: paint.path,
        fill: paint.filled ? icon.color : undefined,
        stroke: icon.color,
        strokeWidth: icon.strokeWidth,
        strokeCap: 'round',
        strokeJoin: 'round',
        ...scale,
      }),
  );
}

function createIconNode(
  element: Extract<DesignElement, { type: 'icon' }>,
  box: LayoutBox,
  variables: Readonly<DesignVariables>,
  options: LeaferSceneOptions,
): { node: UI; icon: LeaferSceneIcon } {
  const icon = resolveIcon(element, variables);
  const node = new Box(baseNodeInput(element, box, variables));
  const paints = options.icons?.[iconPaintKey(icon.library, icon.icon)];
  const paintNodes =
    paints === undefined || paints === null || paints.length === 0
      ? iconPlaceholderNodes(box)
      : iconPaintNodes(box, paints, icon);
  for (const paintNode of paintNodes) {
    node.add(paintNode);
  }
  return { node, icon };
}

function createElementNode(
  element: DesignElement,
  box: LayoutBox,
  variables: Readonly<DesignVariables>,
  options: LeaferSceneOptions,
): { node: UI; text?: string; icon?: LeaferSceneIcon } {
  switch (element.type) {
    case 'frame':
      return {
        node: new Box({
          ...nodeInput(element, box, variables),
          overflow: resolvedBoolean(element.clip, variables)
            ? 'hide'
            : undefined,
        }),
      };
    case 'rectangle':
      return { node: new Rect(nodeInput(element, box, variables)) };
    case 'ellipse':
      return { node: new Ellipse(nodeInput(element, box, variables)) };
    case 'text': {
      const input = nodeInput(element, box, variables);
      const textFields = textInput(element, box, variables);
      return {
        node: new Text({
          ...input,
          ...textFields,
          fill: input.fill ?? DEFAULT_FOREGROUND_COLOR,
        }),
        text: textFields.text,
      };
    }
    case 'icon':
      return createIconNode(element, box, variables, options);
  }
}

function sceneNode(
  node: LayoutNode<DesignElement>,
  variables: Readonly<DesignVariables>,
  options: LeaferSceneOptions,
): LeaferSceneNode {
  const element = node.element;
  const {
    node: leaferNode,
    text,
    icon,
  } = createElementNode(element, node.box, variables, options);
  const children = node.children.map((child) =>
    sceneNode(child, variables, options),
  );
  if (element.type === 'frame') {
    for (const child of children) {
      leaferNode.add(child.node);
    }
  }
  return {
    id: element.id,
    type: element.type,
    element,
    box: { ...node.box },
    node: leaferNode,
    ...(text === undefined ? {} : { text }),
    ...(icon === undefined ? {} : { icon }),
    children,
  };
}

/**
 * Adapts a validated v2 design document to mountable LeaferJS nodes. Layout
 * boxes come from the shared design-schema layout, so the adapter only handles
 * element appearance and tree structure.
 */
export function createLeaferScene(
  document: DesignDocument,
  options: LeaferSceneOptions = {},
): LeaferScene {
  const layout = layoutDesignDocument(document);
  return {
    width: layout.width,
    height: layout.height,
    roots: layout.roots.map((node) =>
      sceneNode(node, document.variables, options),
    ),
  };
}

interface LeaferTarget {
  data?: { elementId?: unknown };
  parent?: LeaferTarget | null;
}

/**
 * Walks from a hit node to the nearest node carrying a design element id.
 * Icon nodes composed of several paint nodes resolve to their icon element.
 */
export function selectedElementId(
  target: LeaferTarget | undefined,
): string | null {
  let current: LeaferTarget | null = target ?? null;
  while (current !== null) {
    const id = current.data?.elementId;
    if (typeof id === 'string') {
      return id;
    }
    current = current.parent ?? null;
  }
  return null;
}
