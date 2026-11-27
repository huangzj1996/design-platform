import {
  resolveVariableValue,
  type DesignDocument,
  type DesignElement,
  type DesignVariables,
} from '@design-ai/design-schema';
import { findElementParent } from './alignment';
import { findElement, updateElement } from './edit';

type FrameElement = Extract<DesignElement, { type: 'frame' }>;

/** Horizontal and vertical declaration coordinates of one element. */
export interface ElementPosition {
  x: number;
  y: number;
}

const round = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

function resolvedInset(
  value: unknown,
  variables: Readonly<DesignVariables>,
): number {
  const resolved = resolveVariableValue(value, variables);
  return typeof resolved === 'number' ? resolved : 0;
}

/** Top and left insets of a frame's padded content box. */
function contentInset(
  frame: FrameElement,
  variables: Readonly<DesignVariables>,
): { top: number; left: number } {
  const padding = frame.padding;
  if (padding === undefined) {
    return { top: 0, left: 0 };
  }
  if (!Array.isArray(padding)) {
    const inset = resolvedInset(padding, variables);
    return { top: inset, left: inset };
  }
  const [top, right] = padding;
  if (padding.length === 2) {
    return {
      top: resolvedInset(top, variables),
      left: resolvedInset(right, variables),
    };
  }
  return {
    top: resolvedInset(top, variables),
    left: resolvedInset(padding[3], variables),
  };
}

/**
 * Converts a canvas position, relative to the parent's border box, into the
 * element's design declaration. Root elements keep canvas coordinates;
 * children of free-layout frames are relative to the parent's content box.
 * Auto-layout children have no draggable declaration, and unknown elements
 * have no position.
 */
export function declarationPosition(
  document: DesignDocument,
  elementId: string,
  canvasPosition: ElementPosition,
): ElementPosition | null {
  if (findElement(document, elementId) === undefined) {
    return null;
  }
  const parent = findElementParent(document, elementId);
  if (parent === null) {
    return { x: round(canvasPosition.x), y: round(canvasPosition.y) };
  }
  if ((parent.layout ?? 'horizontal') !== 'none') {
    return null;
  }
  const inset = contentInset(parent, document.variables);
  return {
    x: round(canvasPosition.x - inset.left),
    y: round(canvasPosition.y - inset.top),
  };
}

function currentCoordinate(
  element: DesignElement,
  axis: 'x' | 'y',
  variables: Readonly<DesignVariables>,
): number {
  const resolved = resolveVariableValue(element[axis], variables);
  return typeof resolved === 'number' ? resolved : 0;
}

/**
 * Computes the declaration patch for a drag between two canvas positions.
 * Unmoved axes stay out of the patch, so their declarations and variable
 * references survive. Moved axes become the resolved declaration plus the
 * drag distance, which avoids rewriting an axis because layout rounding made
 * its canvas position differ from the declared value.
 */
export function dragMoveTarget(
  document: DesignDocument,
  elementId: string,
  from: ElementPosition,
  to: ElementPosition,
): Partial<ElementPosition> | null {
  const element = findElement(document, elementId);
  if (element === undefined) {
    return null;
  }
  const start = declarationPosition(document, elementId, from);
  const landing = declarationPosition(document, elementId, to);
  if (start === null || landing === null) {
    return null;
  }

  const target: Partial<ElementPosition> = {};
  for (const axis of ['x', 'y'] as const) {
    const distance = round(landing[axis] - start[axis]);
    if (distance === 0) {
      continue;
    }
    target[axis] = round(
      currentCoordinate(element, axis, document.variables) + distance,
    );
  }
  return target;
}

/**
 * Moves one element to the given declaration coordinates. Only axes whose
 * resolved position changes are written, so an untouched axis keeps its
 * declaration and variable reference. A changed axis is written as the
 * numeric landing value; variable definitions stay untouched.
 */
export function moveElement(
  document: DesignDocument,
  elementId: string,
  position: Partial<ElementPosition>,
): DesignDocument {
  const element = findElement(document, elementId);
  if (element === undefined) {
    return document;
  }

  const patch: Partial<ElementPosition> = {};
  for (const axis of ['x', 'y'] as const) {
    const target = position[axis];
    if (target === undefined) {
      continue;
    }
    if (currentCoordinate(element, axis, document.variables) !== target) {
      patch[axis] = target;
    }
  }
  if (patch.x === undefined && patch.y === undefined) {
    return document;
  }
  return updateElement(document, elementId, patch);
}
