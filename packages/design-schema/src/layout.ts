import {
  createDiagnostic,
  DiagnosticCodes,
  type Diagnostic,
} from './diagnostics';
import type {
  DesignDocument,
  DesignElement,
  Dimension,
  FrameAlignItems,
  FrameElement,
  FrameJustifyContent,
  TextElement,
  TextWrap,
} from './types';
import { resolveDesignDocument } from './variables';

const DEFAULT_FONT_SIZE = 16;
const DEFAULT_LINE_HEIGHT = 1.2;
const DEFAULT_PADDING: [number, number, number, number] = [0, 0, 0, 0];

const NARROW_CHARACTERS = new Set("iljI.,:;'!|()[]");
const WIDE_CHARACTERS = new Set('mwMW@%&');

type Axis = 'width' | 'height';

const isFullWidthCodePoint = (codePoint: number): boolean =>
  (codePoint >= 0x1100 && codePoint <= 0x115f) ||
  (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
  (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
  (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
  (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
  (codePoint >= 0xff00 && codePoint <= 0xff60) ||
  (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
  (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
  (codePoint >= 0x20000 && codePoint <= 0x3fffd);

/**
 * Width of one character as a fraction of the font size. The metric is a
 * deterministic approximation shared by the canvas and by importers; it does
 * not depend on the installed fonts, so layout results can be asserted.
 */
function characterWidth(character: string, fontSize: number): number {
  if (character === '\t') {
    return fontSize * 2;
  }
  if (character === ' ') {
    return fontSize * 0.25;
  }
  const codePoint = character.codePointAt(0) ?? 0;
  if (isFullWidthCodePoint(codePoint)) {
    return fontSize;
  }
  if (NARROW_CHARACTERS.has(character)) {
    return fontSize * 0.25;
  }
  if (WIDE_CHARACTERS.has(character)) {
    return fontSize * 0.75;
  }
  return fontSize * 0.5;
}

function lineWidth(line: string, fontSize: number): number {
  let width = 0;
  for (const character of line) {
    width += characterWidth(character, fontSize);
  }
  return width;
}

function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  fontSize: number,
): string[] {
  if (paragraph.length === 0) {
    return [''];
  }

  const characters = [...paragraph];
  const lines: string[] = [];
  let cursor = 0;

  while (cursor < characters.length) {
    let end = cursor;
    let width = 0;
    let breakAt = -1;

    while (end < characters.length) {
      const character = characters[end] ?? '';
      const nextWidth = width + characterWidth(character, fontSize);
      if (nextWidth > maxWidth && end > cursor) {
        break;
      }
      width = nextWidth;
      end += 1;
      if (character === ' ') {
        breakAt = end;
      }
    }

    const lineEnd = end < characters.length && breakAt > cursor ? breakAt : end;
    lines.push(characters.slice(cursor, lineEnd).join('').trimEnd());
    cursor = lineEnd;
    while (cursor < characters.length && characters[cursor] === ' ') {
      cursor += 1;
    }
  }

  return lines;
}

export interface TextMeasurementStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  textWrap?: TextWrap;
}

export interface TextMeasurement {
  width: number;
  height: number;
  lineCount: number;
  lines: string[];
}

export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutIssue {
  /** Property path of the dimension that lacks a size basis. */
  path: string;
  axis: Axis;
  message: string;
}

export interface LayoutNode<Element = DesignElement> {
  element: Element;
  /** Position and size relative to the parent's border box. */
  box: LayoutBox;
  children: LayoutNode<Element>[];
  /** Resolved lines for v2 text, including any content beyond a fixed height. */
  textLines?: string[];
}

export interface DesignLayout<Element = DesignElement> {
  roots: LayoutNode<Element>[];
  issues: LayoutIssue[];
  /** Bounding size of all root elements, used by the canvas stage. */
  width: number;
  height: number;
}

/**
 * Finds the resolved box of one element in a layout tree, for computed
 * positions and sizes shown outside the canvas.
 */
export function findLayoutNode<Element extends { id: string }>(
  layout: DesignLayout<Element>,
  id: string,
): LayoutNode<Element> | undefined {
  const visit = (
    nodes: LayoutNode<Element>[],
  ): LayoutNode<Element> | undefined => {
    for (const node of nodes) {
      if (node.element.id === id) {
        return node;
      }
      const nested = visit(node.children);
      if (nested !== undefined) {
        return nested;
      }
    }
    return undefined;
  };
  return visit(layout.roots);
}

interface ResolvedTextStyle {
  fontSize: number;
  lineHeight: number;
}

/** Size basis a child can inherit from its parent; document roots have none. */
type ParentLayout =
  | { kind: 'root' }
  | { kind: 'content'; contentWidth?: number; contentHeight?: number };

interface StrictLayoutOptions {
  dimensionField: (element: DesignElement, axis: Axis) => string;
}

interface LayoutContext {
  issues: LayoutIssue[];
  strict?: StrictLayoutOptions & {
    /** Children may only fill axes with a resolved parent size. */
    missingDimensions: Set<string>;
    measurements: SizeMeasurements;
  };
}

interface SizeMeasurements {
  frames: Map<FrameElement, ResolvedSize>;
  textFillWidths: Map<TextElement, number>;
  text: Map<TextElement, TextMeasurement>;
}

const round = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

const roundFinite = (value: number): number =>
  Math.abs(value) > Number.MAX_SAFE_INTEGER / 100 ? value : round(value);

function resolvedTextStyle(style: TextMeasurementStyle): ResolvedTextStyle {
  const fontSize = style.fontSize ?? DEFAULT_FONT_SIZE;
  return {
    fontSize,
    lineHeight: (style.lineHeight ?? DEFAULT_LINE_HEIGHT) * fontSize,
  };
}

/**
 * Measures text with deterministic, font-independent character metrics.
 * `maxWidth` enables word wrapping; omitted wrapping produces intrinsic width.
 */
export function measureText(
  text: string,
  style: TextMeasurementStyle = {},
  maxWidth?: number,
): TextMeasurement {
  return measureTextWithRounding(text, style, maxWidth, round);
}

function measureTextWithRounding(
  text: string,
  style: TextMeasurementStyle,
  maxWidth: number | undefined,
  roundMetric: (value: number) => number,
): TextMeasurement {
  const { fontSize, lineHeight } = resolvedTextStyle(style);
  const wraps = style.textWrap !== 'none' && maxWidth !== undefined;
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (wraps) {
      for (const line of wrapParagraph(paragraph, maxWidth, fontSize)) {
        lines.push(line);
      }
    } else {
      lines.push(paragraph);
    }
  }

  const width = lines.reduce(
    (maximum, line) => Math.max(maximum, lineWidth(line, fontSize)),
    0,
  );

  return {
    width: roundMetric(width),
    height: roundMetric(lines.length * lineHeight),
    lineCount: lines.length,
    lines,
  };
}

function isDimensionObject(
  value: Dimension | undefined,
): value is Exclude<Dimension, number> {
  return typeof value === 'object' && value !== null;
}

function isFillContainer(value: Dimension | undefined): boolean {
  return isDimensionObject(value) && value.mode === 'fill_container';
}

function parentContentSize(
  parent: ParentLayout,
  axis: Axis,
): number | undefined {
  if (parent.kind === 'root') {
    return undefined;
  }
  return axis === 'width' ? parent.contentWidth : parent.contentHeight;
}

function textWidthConstraint(
  element: TextElement,
  parent?: ParentLayout,
): number | undefined {
  if (typeof element.width === 'number') {
    return element.width;
  }
  if (isFillContainer(element.width) && parent !== undefined) {
    return parentContentSize(parent, 'width');
  }
  return undefined;
}

function measureStrictText(
  element: TextElement,
  measurements: SizeMeasurements,
): TextMeasurement {
  const cached = measurements.text.get(element);
  if (cached !== undefined) {
    return cached;
  }

  const constraint = isFillContainer(element.width)
    ? measurements.textFillWidths.get(element)
    : textWidthConstraint(element);
  const measurement = measureTextWithRounding(
    element.text.replace(/\r\n?/g, '\n'),
    element,
    constraint,
    roundFinite,
  );
  measurements.text.set(element, measurement);
  return measurement;
}

function intrinsicContentSize(
  element: DesignElement,
  axis: Axis,
  parent?: ParentLayout,
  measurements?: SizeMeasurements,
): number | undefined {
  switch (element.type) {
    case 'text': {
      if (measurements !== undefined) {
        return measureStrictText(element, measurements)[axis];
      }
      const constraint =
        axis === 'height' ? textWidthConstraint(element, parent) : undefined;
      return measureText(element.text, element, constraint)[axis];
    }
    case 'frame': {
      if (measurements !== undefined) {
        return measurements.frames.get(element)?.[axis];
      }
      if ((element.layout ?? 'horizontal') === 'none') {
        return undefined;
      }
      return measureAutoFrameAxis(element, axis);
    }
    default:
      return undefined;
  }
}

/**
 * Size contributed by a child when its parent measures its own content. Fill
 * dimensions only contribute a fallback because the parent has no basis yet.
 */
function intrinsicDimension(
  element: DesignElement,
  axis: Axis,
  measurements?: SizeMeasurements,
): number | undefined {
  const value = element[axis];
  if (typeof value === 'number') {
    return value;
  }
  if (isDimensionObject(value)) {
    if (value.mode === 'fill_container') {
      return value.fallback;
    }
    return (
      intrinsicContentSize(element, axis, undefined, measurements) ??
      value.fallback
    );
  }
  return intrinsicContentSize(element, axis, undefined, measurements);
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  if (values.length === 0) {
    return 0;
  }
  let maximum: number | undefined;
  for (const value of values) {
    if (value !== undefined) {
      maximum = Math.max(maximum ?? value, value);
    }
  }
  return maximum;
}

function measureAutoFrameAxis(
  frame: FrameElement,
  axis: Axis,
  measurements?: SizeMeasurements,
): number | undefined {
  const layout = frame.layout ?? 'horizontal';
  const [top, right, bottom, left] = frame.padding ?? DEFAULT_PADDING;
  const gap = frame.gap ?? 0;
  const children = frame.children ?? [];
  const gapTotal = totalGap(gap, children.length);
  const paddingTotal = axis === 'width' ? left + right : top + bottom;
  const mainAxis = layout === 'horizontal' ? 'width' : 'height';
  const sizes = children.map((child) =>
    intrinsicDimension(child, axis, measurements),
  );

  if (axis === mainAxis) {
    if (sizes.some((size) => size === undefined)) {
      return undefined;
    }
    return (
      paddingTotal +
      sizes.reduce<number>((sum, size) => sum + (size ?? 0), 0) +
      gapTotal
    );
  }

  const contentSize = maxDefined(sizes);
  return contentSize === undefined ? undefined : paddingTotal + contentSize;
}

/** Allocates widths before measuring heights, which can depend on text wrapping. */
function measureSizes(roots: DesignElement[]): SizeMeasurements {
  const frames: FrameElement[] = [];
  const pending = roots.filter((element) => element.type === 'frame');
  while (pending.length > 0) {
    const frame = pending.pop();
    if (frame === undefined) {
      break;
    }
    frames.push(frame);
    for (const child of frame.children ?? []) {
      if (child.type === 'frame') {
        pending.push(child);
      }
    }
  }

  const measurements: SizeMeasurements = {
    frames: new Map(),
    textFillWidths: new Map(),
    text: new Map(),
  };
  frames.reverse();
  for (const frame of frames) {
    if (frame.layout !== 'none') {
      measurements.frames.set(frame, {
        width: measureAutoFrameAxis(frame, 'width', measurements),
      });
    }
  }

  measureTextFillWidths(roots, undefined, measurements);

  for (const [frame, size] of measurements.frames) {
    size.height = measureAutoFrameAxis(frame, 'height', measurements);
  }
  return measurements;
}

function measureTextFillWidths(
  elements: DesignElement[],
  fillWidth: number | undefined,
  measurements: SizeMeasurements,
): void {
  for (const element of elements) {
    if (
      element.type === 'text' &&
      isFillContainer(element.width) &&
      fillWidth !== undefined
    ) {
      measurements.textFillWidths.set(element, fillWidth);
    }
    if (element.type !== 'frame') {
      continue;
    }

    const width = isFillContainer(element.width)
      ? fillWidth
      : intrinsicDimension(element, 'width', measurements);
    const children = element.children ?? [];
    const [, right, , left] = element.padding ?? DEFAULT_PADDING;
    let childFillWidth: number | undefined;
    if (width !== undefined && Number.isFinite(width)) {
      childFillWidth = Math.max(0, width - left - right);
      if ((element.layout ?? 'horizontal') === 'horizontal') {
        const fills = children.filter((child) => isFillContainer(child.width));
        if (fills.length > 0) {
          const sizes = children.map((child) => {
            const size = intrinsicDimension(child, 'width', measurements);
            return size !== undefined && Number.isFinite(size) ? size : 0;
          });
          childFillWidth = fillShare(
            childFillWidth,
            totalGap(element.gap ?? 0, children.length),
            sizes,
            fills.length,
          );
        }
      }
    }
    measureTextFillWidths(children, childFillWidth, measurements);
  }
}

function missingSizeMessage(axis: Axis, allowFallback: boolean): string {
  const label = axis === 'width' ? '宽度' : '高度';
  const basis = allowFallback
    ? '固定数值、内容尺寸、父容器尺寸或备用值'
    : '固定数值、可计算的内容尺寸或父容器尺寸';
  return `${label}（${axis}）缺少尺寸依据：需要${basis}`;
}

function childPath(parentPath: string, index: number): string {
  return `${parentPath}.children[${index}]`;
}

function resolveSize(
  element: DesignElement,
  axis: Axis,
  parent: ParentLayout,
  path: string,
  context: LayoutContext,
): number {
  const value = element[axis];
  let basis: number | undefined;
  let fallback: number | undefined;

  if (typeof value === 'number') {
    basis = value;
  } else if (isDimensionObject(value)) {
    fallback = value.fallback;
    basis =
      value.mode === 'fill_container'
        ? parentContentSize(parent, axis)
        : intrinsicContentSize(
            element,
            axis,
            parent,
            context.strict?.measurements,
          );
  } else {
    basis = intrinsicContentSize(
      element,
      axis,
      parent,
      context.strict?.measurements,
    );
  }

  if (
    basis !== undefined &&
    (context.strict === undefined || Number.isFinite(basis))
  ) {
    return basis;
  }
  if (fallback !== undefined) {
    return fallback;
  }

  const dimensionPath = `${path}.${axis}`;
  context.strict?.missingDimensions.add(dimensionPath);
  context.issues.push({
    path: `${path}.${context.strict?.dimensionField(element, axis) ?? axis}`,
    axis,
    message: missingSizeMessage(axis, context.strict === undefined),
  });
  return 0;
}

function mainOffsets(
  sizes: number[],
  gap: number,
  freeSpace: number,
  justify: FrameJustifyContent,
): number[] {
  const base: number[] = [];
  let cursor = 0;
  for (const size of sizes) {
    base.push(cursor);
    cursor += size + gap;
  }

  switch (justify) {
    case 'start':
      return base;
    case 'center':
      return base.map((position) => position + freeSpace / 2);
    case 'end':
      return base.map((position) => position + freeSpace);
    case 'space_between': {
      if (sizes.length <= 1) {
        return base;
      }
      const extra = freeSpace / (sizes.length - 1);
      return base.map((position, index) => position + index * extra);
    }
    case 'space_around': {
      if (sizes.length === 0) {
        return [];
      }
      const extra = freeSpace / sizes.length;
      return base.map(
        (position, index) => position + extra / 2 + index * extra,
      );
    }
  }
}

function totalGap(gap: number, count: number): number {
  return gap * Math.max(0, count - 1);
}

function fillShare(
  contentSize: number,
  gapTotal: number,
  sizes: number[],
  count: number,
): number {
  const usedSize = sizes.reduce((sum, size) => sum + size, 0);
  return Math.max(0, (contentSize - gapTotal - usedSize) / count);
}

function crossOffset(
  align: FrameAlignItems,
  containerSize: number,
  childSize: number,
): number {
  switch (align) {
    case 'start':
      return 0;
    case 'center':
      return (containerSize - childSize) / 2;
    case 'end':
      return containerSize - childSize;
  }
}

interface ResolvedSize {
  width?: number;
  height?: number;
}

interface ElementPlacement {
  element: DesignElement;
  path: string;
  parent: ParentLayout;
  x: number;
  y: number;
  size?: ResolvedSize;
}

function layoutTree(
  placements: ElementPlacement[],
  context: LayoutContext,
): LayoutNode[] {
  const roots: LayoutNode[] = [];
  const pending = placements
    .map((placement) => ({ placement, target: roots }))
    .reverse();
  const roundBoxValue = context.strict === undefined ? round : roundFinite;
  let task = pending.pop();
  while (task !== undefined) {
    const { element, path, parent, x, y, size } = task.placement;
    const width =
      size?.width ?? resolveSize(element, 'width', parent, path, context);
    const height =
      size?.height ?? resolveSize(element, 'height', parent, path, context);
    const node: LayoutNode = {
      element,
      box: {
        x: roundBoxValue(x),
        y: roundBoxValue(y),
        width: roundBoxValue(width),
        height: roundBoxValue(height),
      },
      children: [],
    };
    if (element.type === 'text' && context.strict !== undefined) {
      node.textLines = measureStrictText(
        element,
        context.strict.measurements,
      ).lines;
    }
    task.target.push(node);

    if (element.type === 'frame') {
      const children = placeFrameChildren(
        element,
        width,
        height,
        path,
        context,
      );
      for (let index = children.length - 1; index >= 0; index -= 1) {
        pending.push({ placement: children[index], target: node.children });
      }
    }
    task = pending.pop();
  }
  return roots;
}

function placeFrameChildren(
  frame: FrameElement,
  width: number,
  height: number,
  path: string,
  context: LayoutContext,
): ElementPlacement[] {
  const padding = frame.padding ?? DEFAULT_PADDING;
  const [top, right, bottom, left] = padding;
  const contentWidth = Math.max(0, width - left - right);
  const contentHeight = Math.max(0, height - top - bottom);
  const children = frame.children ?? [];
  const layout = frame.layout ?? 'horizontal';
  const parent: ParentLayout = {
    kind: 'content',
    contentWidth: context.strict?.missingDimensions.has(`${path}.width`)
      ? undefined
      : contentWidth,
    contentHeight: context.strict?.missingDimensions.has(`${path}.height`)
      ? undefined
      : contentHeight,
  };

  if (layout === 'none') {
    return children.map((child, index) => ({
      element: child,
      path: childPath(path, index),
      parent,
      x: left + (child.x ?? 0),
      y: top + (child.y ?? 0),
    }));
  }

  const mainAxis = layout === 'horizontal' ? 'width' : 'height';
  const crossAxis = layout === 'horizontal' ? 'height' : 'width';
  const contentMain = layout === 'horizontal' ? contentWidth : contentHeight;
  const contentCross = layout === 'horizontal' ? contentHeight : contentWidth;
  const canFillMainAxis = parentContentSize(parent, mainAxis) !== undefined;
  const gap = frame.gap ?? 0;

  const mainSizes: number[] = new Array<number>(children.length).fill(0);
  const crossSizes: number[] = new Array<number>(children.length).fill(0);
  const mainFillIndexes: number[] = [];

  children.forEach((child, index) => {
    const pathToChild = childPath(path, index);
    if (canFillMainAxis && isFillContainer(child[mainAxis])) {
      mainFillIndexes.push(index);
    } else {
      mainSizes[index] = resolveSize(
        child,
        mainAxis,
        parent,
        pathToChild,
        context,
      );
    }

    crossSizes[index] = resolveSize(
      child,
      crossAxis,
      parent,
      pathToChild,
      context,
    );
  });

  const gapTotal = totalGap(gap, children.length);
  if (mainFillIndexes.length > 0) {
    const share = fillShare(
      contentMain,
      gapTotal,
      mainSizes,
      mainFillIndexes.length,
    );
    for (const index of mainFillIndexes) {
      mainSizes[index] = share;
    }
  }

  const totalMain = mainSizes.reduce((sum, size) => sum + size, 0) + gapTotal;
  const freeSpace = Math.max(0, contentMain - totalMain);
  const offsets = mainOffsets(
    mainSizes,
    gap,
    freeSpace,
    frame.justifyContent ?? 'start',
  );
  const align = frame.alignItems ?? 'start';

  return children.map((child, index) => {
    const main = offsets[index] ?? 0;
    const cross = crossOffset(align, contentCross, crossSizes[index] ?? 0);
    const x = layout === 'horizontal' ? left + main : left + cross;
    const y = layout === 'horizontal' ? top + cross : top + main;
    const size: ResolvedSize =
      layout === 'horizontal'
        ? { width: mainSizes[index], height: crossSizes[index] }
        : { width: crossSizes[index], height: mainSizes[index] };

    return {
      element: child,
      path: childPath(path, index),
      parent,
      x,
      y,
      size,
    };
  });
}

export interface ElementSize {
  width: number;
  height: number;
}

/**
 * Measures one element as if it were placed at the document root. Text uses
 * the shared measurement rules and auto-layout frames fit their content.
 * Returns undefined when either axis has no size basis.
 */
export function measureElementSize(
  element: DesignElement,
): ElementSize | undefined {
  const context: LayoutContext = { issues: [] };
  const parent: ParentLayout = { kind: 'root' };
  const width = resolveSize(element, 'width', parent, '$', context);
  const height = resolveSize(element, 'height', parent, '$', context);
  if (context.issues.length > 0) {
    return undefined;
  }
  return { width: round(width), height: round(height) };
}

/**
 * Computes the shared layout tree for a validated design document. Variable
 * bindings are resolved first so sizes, spacing and measured text use their
 * literal values while the document itself keeps the references. The same
 * rules back document validation and canvas rendering.
 */
export function layoutDesignDocument(document: DesignDocument): DesignLayout {
  return layoutDocument(resolveDesignDocument(document).children);
}

/** Runs the shared engine after variable bindings have been resolved. */
export function layoutDocument(
  elements: DesignElement[],
  strictOptions?: StrictLayoutOptions,
): DesignLayout {
  const context: LayoutContext = { issues: [] };
  if (strictOptions !== undefined) {
    context.strict = {
      ...strictOptions,
      missingDimensions: new Set(),
      measurements: measureSizes(elements),
    };
  }
  const roots = layoutTree(
    elements.map((element, index) => ({
      element,
      path: childPath('$', index),
      parent: { kind: 'root' },
      x: element.x ?? 0,
      y: element.y ?? 0,
    })),
    context,
  );

  let width = 0;
  let height = 0;
  for (const node of roots) {
    width = Math.max(width, node.box.x + node.box.width);
    height = Math.max(height, node.box.y + node.box.height);
  }

  const roundExtent = strictOptions === undefined ? round : roundFinite;
  return {
    roots,
    issues: context.issues,
    width: roundExtent(width),
    height: roundExtent(height),
  };
}

/** Converts a layout issue into a document diagnostic. */
export function layoutIssueToDiagnostic(issue: LayoutIssue): Diagnostic {
  return createDiagnostic(
    DiagnosticCodes.missingSizeBasis,
    issue.path,
    issue.message,
  );
}
