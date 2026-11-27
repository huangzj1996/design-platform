import { Box, Ellipse, Rect, Text, type UI } from '@leafer-ui/draw';
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

type FillLayer = NonNullable<DesignElement['fill']>[number];

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
  children: LeaferSceneNode[];
}

/** The mountable node tree for one laid-out design document. */
export interface LeaferScene {
  /** Bounding size of all root elements. */
  width: number;
  height: number;
  roots: LeaferSceneNode[];
}

const DEFAULT_TEXT_COLOR = '#1f2328';
const DEFAULT_ICON_STROKE_WIDTH = 2;

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
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return undefined;
  }
  return value.map((radius) => resolvedNumber(radius, variables) ?? 0);
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
    fontFamily: resolvedString(style.fontFamily, variables),
    fontSize: resolvedNumber(style.fontSize, variables),
    fontWeight: resolvedNumber(style.fontWeight, variables),
    lineHeight: resolvedNumber(style.lineHeight, variables),
    textAlign: style.textAlign,
    textWrap: growth === 'auto' ? ('none' as const) : ('break' as const),
    width: box.width,
    height: box.height,
  };
}

function nodeInput(
  element: DesignElement,
  box: LayoutBox,
  variables: Readonly<DesignVariables>,
) {
  const { stroke, strokeWidth } = elementStroke(element, variables);
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    fill: fillPaint(element.fill, variables),
    stroke,
    strokeWidth,
    cornerRadius: elementCornerRadius(element, variables),
    opacity: resolvedNumber(element.opacity, variables) ?? 1,
    rotation: resolvedNumber(element.rotation, variables) ?? 0,
    hitFill: 'all' as const,
    data: { elementId: element.id },
  };
}

function createElementNode(
  element: DesignElement,
  box: LayoutBox,
  variables: Readonly<DesignVariables>,
): UI {
  const input = nodeInput(element, box, variables);
  switch (element.type) {
    case 'frame':
      return new Box({
        ...input,
        overflow: resolvedBoolean(element.clip, variables) ? 'hide' : undefined,
      });
    case 'rectangle':
      return new Rect(input);
    case 'ellipse':
      return new Ellipse(input);
    case 'text':
      return new Text({
        ...input,
        ...textInput(element, box, variables),
        fill: input.fill ?? DEFAULT_TEXT_COLOR,
      });
    case 'icon':
      return new Box({
        ...input,
        strokeWidth: input.strokeWidth ?? DEFAULT_ICON_STROKE_WIDTH,
      });
  }
}

function resolvedBoolean(
  value: unknown,
  variables: Readonly<DesignVariables>,
): boolean {
  return resolveVariableValue(value, variables) === true;
}

function sceneNode(
  node: LayoutNode<DesignElement>,
  variables: Readonly<DesignVariables>,
): LeaferSceneNode {
  const element = node.element;
  const leaferNode = createElementNode(element, node.box, variables);
  const children = node.children.map((child) => sceneNode(child, variables));
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
    ...(element.type === 'text'
      ? { text: resolvedString(element.textStyle.content, variables) ?? '' }
      : {}),
    children,
  };
}

/**
 * Adapts a validated v2 design document to mountable LeaferJS nodes. Layout
 * boxes come from the shared design-schema layout, so the adapter only handles
 * element appearance and tree structure.
 */
export function createLeaferScene(document: DesignDocument): LeaferScene {
  const layout = layoutDesignDocument(document);
  return {
    width: layout.width,
    height: layout.height,
    roots: layout.roots.map((node) => sceneNode(node, document.variables)),
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
