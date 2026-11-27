import {
  measureText,
  resolveVariableValue,
  type DesignDocument,
  type LayoutBox,
} from '@design-ai/design-schema';
import {
  createLeaferScene,
  iconPaintKey,
  type IconPaintMap,
  type LeaferScene,
  type LeaferSceneNode,
} from '@design-ai/editor-core/leafer';
import { loadLucideIconPaths } from './lucide-icon';

/** Mountable LeaferJS node tree shared by the canvas engine and its tests. */
export type CanvasSceneNode = LeaferSceneNode;
export type CanvasScene = LeaferScene;

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

/** Builds the mountable node tree consumed by the canvas engine. */
export function buildCanvasScene(
  document: DesignDocument,
  icons?: IconPaintMap,
): CanvasScene {
  return createLeaferScene(document, { icons });
}

/**
 * Keys of every icon the document references. Library and icon names are
 * resolved through the document variables so the paint loader sees the
 * effective declaration.
 */
export function collectCanvasIconKeys(document: DesignDocument): string[] {
  const keys = new Set<string>();
  const pending = [...document.children];
  let element = pending.pop();
  while (element !== undefined) {
    if (element.type === 'icon') {
      const library = resolveVariableValue(element.library, document.variables);
      const icon = resolveVariableValue(element.icon, document.variables);
      if (typeof library === 'string' && typeof icon === 'string') {
        keys.add(iconPaintKey(library, icon));
      }
    }
    if (element.type === 'frame' && element.children !== undefined) {
      pending.push(...element.children);
    }
    element = pending.pop();
  }
  return [...keys].sort();
}

/** Loads the resolved paints for every icon key a document references. */
export async function loadCanvasIconPaints(
  keys: readonly string[],
): Promise<IconPaintMap> {
  const entries = await Promise.all(
    keys.map(async (key) => {
      const separator = key.indexOf('/');
      const library = key.slice(0, separator);
      const icon = key.slice(separator + 1);
      return [key, await loadLucideIconPaths(library, icon)] as const;
    }),
  );
  return Object.fromEntries(entries);
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
    rotation: located.node.node.rotation ?? 0,
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
