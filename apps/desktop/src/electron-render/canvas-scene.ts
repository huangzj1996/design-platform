import {
  layoutDesignDocument,
  measureText,
  type DesignDocument,
  type ElementType,
  type FrameLayout,
  type LayoutBox,
  type LayoutNode,
  type TextAlign,
  type TextWrap,
} from '@design-ai/design-schema';

/** Values shared by every element drawn on the LeaferJS canvas. */
export interface CanvasSceneNode {
  id: string;
  type: ElementType;
  /** Position and size relative to the parent's border box. */
  box: LayoutBox;
  fill?: string;
  fillOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  opacity: number;
  /** Degrees clockwise, matching the design document. */
  rotation: number;
  visible: boolean;
  /** Free-positioned or auto-layout direction of a frame. */
  layout?: FrameLayout;
  /** A frame hides child content that extends beyond its box. */
  clipContent?: boolean;
  children: CanvasSceneNode[];
  text?: CanvasText;
  icon?: CanvasIcon;
}

export interface CanvasText {
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight?: number;
  /** Multiplier of the font size. */
  lineHeight: number;
  textAlign?: TextAlign;
  textWrap?: TextWrap;
}

export interface CanvasIcon {
  library: string;
  icon: string;
  /** Stroke and fill color of the icon, following the element's paint. */
  color: string;
  strokeWidth: number;
}

export interface CanvasScene {
  /** Bounding size of all root elements, used by the canvas stage. */
  width: number;
  height: number;
  roots: CanvasSceneNode[];
}

/** Smallest scene dimension, so an empty view still has a valid canvas. */
export const MIN_CANVAS_SIZE = 1;

/** Extra canvas space that keeps outlines and size tags off the stage edge. */
export const CANVAS_STAGE_PADDING = 48;

/** Size of the canvas stage, including room for the selection overlay. */
export function canvasStageSize(scene: CanvasScene): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(MIN_CANVAS_SIZE, scene.width) + CANVAS_STAGE_PADDING * 2,
    height: Math.max(MIN_CANVAS_SIZE, scene.height) + CANVAS_STAGE_PADDING * 2,
  };
}

/** Selected-state styling taken from the Pencil editor reference board. */
export const SELECTION_OUTLINE = {
  color: '#4592FF',
  strokeWidth: 3,
} as const;

const SELECTION_SIZE_TAG_HEIGHT = 24;
const SELECTION_SIZE_TAG_GAP = 7;
const SELECTION_SIZE_TAG_PADDING_X = 11;
const SELECTION_SIZE_TAG_FONT_SIZE = 13;
const SELECTION_SIZE_TAG_FONT_WEIGHT = 600;
const DEFAULT_ICON_STROKE_WIDTH = 2;
const DEFAULT_TEXT_COLOR = '#1f2328';
const DEFAULT_FONT_FAMILY = 'sans-serif';
/** Defaults shared with the design-schema text layout. */
const DEFAULT_FONT_SIZE = 16;
const DEFAULT_LINE_HEIGHT = 1.2;

export interface CanvasSizeTag {
  box: LayoutBox;
  text: string;
  fill: string;
  color: string;
  fontSize: number;
  fontWeight: number;
  cornerRadius: number;
}

export interface CanvasSelection {
  id: string;
  /** Absolute position and size within the design scene. */
  box: LayoutBox;
  /** Rotation of the selected element, so the outline follows it. */
  rotation: number;
  outline: { color: string; strokeWidth: number };
  sizeTag: CanvasSizeTag;
}

function sceneNode(node: LayoutNode): CanvasSceneNode {
  const element = node.element;
  const common = {
    id: element.id,
    type: element.type,
    box: { ...node.box },
    fill: element.fill,
    fillOpacity: element.fillOpacity,
    stroke: element.stroke,
    strokeWidth: element.strokeWidth,
    cornerRadius: element.cornerRadius,
    opacity: element.opacity ?? 1,
    rotation: element.rotation ?? 0,
    visible: element.visible !== false,
    children: [] as CanvasSceneNode[],
  };

  switch (element.type) {
    case 'frame':
      return {
        ...common,
        layout: element.layout ?? 'horizontal',
        clipContent: element.clipContent === true,
        children: node.children.map(sceneNode),
      };
    case 'rectangle':
    case 'ellipse':
      return common;
    case 'text':
      return {
        ...common,
        fill: element.fill ?? DEFAULT_TEXT_COLOR,
        text: {
          content: element.text,
          fontFamily: element.fontFamily ?? DEFAULT_FONT_FAMILY,
          fontSize: element.fontSize ?? DEFAULT_FONT_SIZE,
          fontWeight: element.fontWeight,
          lineHeight: element.lineHeight ?? DEFAULT_LINE_HEIGHT,
          textAlign: element.textAlign,
          textWrap: element.textWrap,
        },
      };
    case 'icon':
      return {
        ...common,
        // Icons paint their paths with `icon.color` instead of a surface fill.
        fill: undefined,
        stroke: undefined,
        icon: {
          library: element.library,
          icon: element.icon,
          color: element.fill ?? element.stroke ?? DEFAULT_TEXT_COLOR,
          strokeWidth: element.strokeWidth ?? DEFAULT_ICON_STROKE_WIDTH,
        },
      };
  }
}

/** Builds the shared, variable-resolved scene consumed by the canvas engine. */
export function buildCanvasScene(document: DesignDocument): CanvasScene {
  const layout = layoutDesignDocument(document);
  return {
    width: layout.width,
    height: layout.height,
    roots: layout.roots.map(sceneNode),
  };
}

interface LocatedNode {
  node: CanvasSceneNode;
  box: LayoutBox;
}

function locateNode(
  nodes: CanvasSceneNode[],
  id: string,
  offsetX: number,
  offsetY: number,
): LocatedNode | null {
  for (const node of nodes) {
    if (!node.visible) {
      continue;
    }
    const x = offsetX + node.box.x;
    const y = offsetY + node.box.y;
    if (node.id === id) {
      return {
        node,
        box: { x, y, width: node.box.width, height: node.box.height },
      };
    }
    const nested = locateNode(node.children, id, x, y);
    if (nested !== null) {
      return nested;
    }
  }
  return null;
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatDimension(value: number): string {
  return String(round(value));
}

/**
 * Describes the selection outline and dimension tag for one element. Boxes are
 * absolute stage coordinates because the overlay is not nested in the tree.
 */
export function findCanvasSelection(
  scene: CanvasScene,
  selectionId: string | null,
): CanvasSelection | null {
  if (selectionId === null) {
    return null;
  }
  const located = locateNode(scene.roots, selectionId, 0, 0);
  if (located === null) {
    return null;
  }

  const text = `${formatDimension(located.box.width)} × ${formatDimension(
    located.box.height,
  )}`;
  const textWidth = measureText(text, {
    fontSize: SELECTION_SIZE_TAG_FONT_SIZE,
    fontWeight: SELECTION_SIZE_TAG_FONT_WEIGHT,
  }).width;
  const tagWidth = Math.ceil(textWidth + SELECTION_SIZE_TAG_PADDING_X * 2);

  return {
    id: selectionId,
    box: located.box,
    rotation: located.node.rotation,
    outline: { ...SELECTION_OUTLINE },
    sizeTag: {
      box: {
        x: round(located.box.x + located.box.width / 2 - tagWidth / 2),
        y: round(located.box.y + located.box.height + SELECTION_SIZE_TAG_GAP),
        width: tagWidth,
        height: SELECTION_SIZE_TAG_HEIGHT,
      },
      text,
      fill: SELECTION_OUTLINE.color,
      color: '#FFFFFF',
      fontSize: SELECTION_SIZE_TAG_FONT_SIZE,
      fontWeight: SELECTION_SIZE_TAG_FONT_WEIGHT,
      cornerRadius: 7,
    },
  };
}
