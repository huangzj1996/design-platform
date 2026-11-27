import {
  findLayoutNode,
  layoutDesignDocument,
  resolveVariableValue,
  type DesignDocument,
  type DesignElement,
} from '@design-ai/design-schema';
import { updateElement, type ElementPatch } from './edit';

type FrameElement = Extract<DesignElement, { type: 'frame' }>;
type FrameAlignItems = NonNullable<FrameElement['alignItems']>;
type FrameJustifyContent = NonNullable<FrameElement['justifyContent']>;

/** Alignment of a free-positioned child against its parent container. */
export type ElementAlignment =
  'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

/** One cell of the nine-cell container alignment matrix. */
export interface FrameAlignmentCell {
  column: 0 | 1 | 2;
  row: 0 | 1 | 2;
}

type AutoLayoutDirection = 'horizontal' | 'vertical';

type AlignmentAxis = 'start' | 'center' | 'end';

const AXIS_VALUES: readonly AlignmentAxis[] = ['start', 'center', 'end'];

const round = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

function resolvedPadding(
  padding: FrameElement['padding'],
  variables: DesignDocument['variables'],
): [number, number, number, number] {
  if (padding === undefined) {
    return [0, 0, 0, 0];
  }
  const side = (value: unknown): number => {
    const resolved = resolveVariableValue(value, variables);
    return typeof resolved === 'number' ? resolved : 0;
  };
  if (!Array.isArray(padding)) {
    const inset = side(padding);
    return [inset, inset, inset, inset];
  }
  const [top, right] = padding;
  const resolvedTop = side(top);
  const resolvedRight = side(right);
  return padding.length === 2
    ? [resolvedTop, resolvedRight, resolvedTop, resolvedRight]
    : [resolvedTop, resolvedRight, side(padding[2]), side(padding[3])];
}

function axisIndex(
  value: FrameAlignItems | FrameJustifyContent | undefined,
): 0 | 1 | 2 | undefined {
  switch (value) {
    case 'start':
      return 0;
    case 'center':
      return 1;
    case 'end':
      return 2;
    default:
      return undefined;
  }
}

/**
 * Translates a matrix cell into the frame's flex properties. The main axis
 * follows the layout direction, so a vertical frame maps rows to
 * `justifyContent` and a horizontal frame maps columns to it.
 */
export function frameAlignmentProps(
  layout: AutoLayoutDirection,
  cell: FrameAlignmentCell,
): {
  justifyContent: FrameJustifyContent;
  alignItems: FrameAlignItems;
} {
  const horizontal = AXIS_VALUES[cell.column] ?? 'start';
  const vertical = AXIS_VALUES[cell.row] ?? 'start';
  return layout === 'horizontal'
    ? { justifyContent: horizontal, alignItems: vertical }
    : { justifyContent: vertical, alignItems: horizontal };
}

/**
 * Derives the active matrix cell. Space distribution has no single cell on
 * the main axis, so those values leave the whole cell unselected.
 */
export function frameAlignmentCell(
  layout: AutoLayoutDirection,
  alignment: {
    justifyContent?: FrameJustifyContent;
    alignItems?: FrameAlignItems;
  },
): FrameAlignmentCell | undefined {
  const justify = axisIndex(alignment.justifyContent ?? 'start');
  const cross = axisIndex(alignment.alignItems ?? 'start');
  if (justify === undefined || cross === undefined) {
    return undefined;
  }
  return layout === 'horizontal'
    ? { column: justify, row: cross }
    : { column: cross, row: justify };
}

/** Returns the frame that directly contains an element, or null at the root. */
export function findElementParent(
  document: DesignDocument,
  id: string,
): FrameElement | null {
  const visit = (elements: readonly DesignElement[]): FrameElement | null => {
    for (const element of elements) {
      if (element.type !== 'frame') {
        continue;
      }
      const children = element.children ?? [];
      if (children.some((child) => child.id === id)) {
        return element;
      }
      const nested = visit(children);
      if (nested !== null) {
        return nested;
      }
    }
    return null;
  };
  return visit(document.children);
}

/**
 * Moves a free-positioned child to one edge or the center of its parent's
 * padded content box. Auto-layout children keep their resolved position, and
 * root elements have no parent to align against.
 */
export function alignElement(
  document: DesignDocument,
  id: string,
  alignment: ElementAlignment,
): DesignDocument {
  const parent = findElementParent(document, id);
  if (parent === null || (parent.layout ?? 'horizontal') !== 'none') {
    return document;
  }

  const layout = layoutDesignDocument(document);
  const parentNode = findLayoutNode(layout, parent.id);
  const childNode = findLayoutNode(layout, id);
  if (parentNode === undefined || childNode === undefined) {
    return document;
  }

  const [top, right, bottom, left] = resolvedPadding(
    parent.padding,
    document.variables,
  );
  const contentWidth = Math.max(0, parentNode.box.width - left - right);
  const contentHeight = Math.max(0, parentNode.box.height - top - bottom);
  const { width, height } = childNode.box;
  const patch: ElementPatch = {};

  switch (alignment) {
    case 'left':
      patch.x = 0;
      break;
    case 'center':
      patch.x = round((contentWidth - width) / 2);
      break;
    case 'right':
      patch.x = round(contentWidth - width);
      break;
    case 'top':
      patch.y = 0;
      break;
    case 'middle':
      patch.y = round((contentHeight - height) / 2);
      break;
    case 'bottom':
      patch.y = round(contentHeight - height);
      break;
  }

  return updateElement(document, id, patch);
}
