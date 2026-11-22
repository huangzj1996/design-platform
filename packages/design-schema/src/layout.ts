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

export interface LayoutNode {
  element: DesignElement;
  /** Position and size relative to the parent's border box. */
  box: LayoutBox;
  children: LayoutNode[];
}

export interface DesignLayout {
  roots: LayoutNode[];
  issues: LayoutIssue[];
  /** Bounding size of all root elements, used by the canvas stage. */
  width: number;
  height: number;
}

interface ResolvedTextStyle {
  fontSize: number;
  lineHeight: number;
}

/** Size basis a child can inherit from its parent; document roots have none. */
type ParentLayout =
  | { kind: 'root' }
  | { kind: 'content'; contentWidth: number; contentHeight: number };

const round = (value: number): number =>
  Math.round((value + Number.EPSILON) * 100) / 100;

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
  const { fontSize, lineHeight } = resolvedTextStyle(style);
  const wraps = style.textWrap !== 'none' && maxWidth !== undefined;
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    if (wraps) {
      lines.push(...wrapParagraph(paragraph, maxWidth, fontSize));
    } else {
      lines.push(paragraph);
    }
  }

  const width = lines.reduce(
    (maximum, line) => Math.max(maximum, lineWidth(line, fontSize)),
    0,
  );

  return {
    width: round(width),
    height: round(lines.length * lineHeight),
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

function intrinsicContentSize(
  element: DesignElement,
  axis: Axis,
  parent?: ParentLayout,
): number | undefined {
  switch (element.type) {
    case 'text': {
      if (axis === 'width') {
        return measureText(element.text, element).width;
      }
      const constraint = textWidthConstraint(element, parent);
      return measureText(element.text, element, constraint).height;
    }
    case 'frame': {
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
): number | undefined {
  const value = element[axis];
  if (typeof value === 'number') {
    return value;
  }
  if (isDimensionObject(value)) {
    if (value.mode === 'fill_container') {
      return value.fallback;
    }
    return intrinsicContentSize(element, axis) ?? value.fallback;
  }
  return intrinsicContentSize(element, axis);
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  if (values.length === 0) {
    return 0;
  }
  const defined = values.filter(
    (value): value is number => value !== undefined,
  );
  return defined.length === 0 ? undefined : Math.max(...defined);
}

function measureAutoFrameAxis(
  frame: FrameElement,
  axis: Axis,
): number | undefined {
  const layout = frame.layout ?? 'horizontal';
  const [top, right, bottom, left] = frame.padding ?? DEFAULT_PADDING;
  const gap = frame.gap ?? 0;
  const children = frame.children ?? [];
  const gapTotal = gap * Math.max(0, children.length - 1);
  const paddingTotal = axis === 'width' ? left + right : top + bottom;
  const mainAxis = layout === 'horizontal' ? 'width' : 'height';
  const sizes = children.map((child) => intrinsicDimension(child, axis));

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

function missingSizeMessage(axis: Axis): string {
  const label = axis === 'width' ? '宽度' : '高度';
  return `${label}（${axis}）缺少尺寸依据：需要固定数值、内容尺寸、父容器尺寸或备用值`;
}

function childPath(parentPath: string, index: number): string {
  return `${parentPath}.children[${index}]`;
}

function resolveSize(
  element: DesignElement,
  axis: Axis,
  parent: ParentLayout,
  path: string,
  issues: LayoutIssue[],
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
        : intrinsicContentSize(element, axis, parent);
  } else {
    basis = intrinsicContentSize(element, axis, parent);
  }

  if (basis !== undefined) {
    return basis;
  }
  if (fallback !== undefined) {
    return fallback;
  }

  issues.push({
    path: `${path}.${axis}`,
    axis,
    message: missingSizeMessage(axis),
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

function layoutElement(
  element: DesignElement,
  path: string,
  parent: ParentLayout,
  x: number,
  y: number,
  issues: LayoutIssue[],
  resolved: ResolvedSize = {},
): LayoutNode {
  const width =
    resolved.width ?? resolveSize(element, 'width', parent, path, issues);
  const height =
    resolved.height ?? resolveSize(element, 'height', parent, path, issues);
  const children =
    element.type === 'frame'
      ? layoutFrameChildren(element, width, height, path, issues)
      : [];

  return {
    element,
    box: {
      x: round(x),
      y: round(y),
      width: round(width),
      height: round(height),
    },
    children,
  };
}

function layoutFrameChildren(
  frame: FrameElement,
  width: number,
  height: number,
  path: string,
  issues: LayoutIssue[],
): LayoutNode[] {
  const padding = frame.padding ?? DEFAULT_PADDING;
  const [top, right, bottom, left] = padding;
  const contentWidth = Math.max(0, width - left - right);
  const contentHeight = Math.max(0, height - top - bottom);
  const children = frame.children ?? [];
  const layout = frame.layout ?? 'horizontal';
  const parent: ParentLayout = { kind: 'content', contentWidth, contentHeight };

  if (layout === 'none') {
    return children.map((child, index) =>
      layoutElement(
        child,
        childPath(path, index),
        parent,
        left + (child.x ?? 0),
        top + (child.y ?? 0),
        issues,
      ),
    );
  }

  const mainAxis = layout === 'horizontal' ? 'width' : 'height';
  const crossAxis = layout === 'horizontal' ? 'height' : 'width';
  const contentMain = layout === 'horizontal' ? contentWidth : contentHeight;
  const contentCross = layout === 'horizontal' ? contentHeight : contentWidth;
  const gap = frame.gap ?? 0;

  const mainSizes: number[] = new Array<number>(children.length).fill(0);
  const crossSizes: number[] = new Array<number>(children.length).fill(0);
  const mainFillIndexes: number[] = [];

  children.forEach((child, index) => {
    const pathToChild = childPath(path, index);
    if (isFillContainer(child[mainAxis])) {
      mainFillIndexes.push(index);
    } else {
      mainSizes[index] = resolveSize(
        child,
        mainAxis,
        parent,
        pathToChild,
        issues,
      );
    }

    crossSizes[index] = isFillContainer(child[crossAxis])
      ? contentCross
      : resolveSize(child, crossAxis, parent, pathToChild, issues);
  });

  const gapTotal = gap * Math.max(0, children.length - 1);
  const usedMain = mainSizes.reduce((sum, size) => sum + size, 0);
  const availableMain = contentMain - gapTotal - usedMain;
  const share =
    mainFillIndexes.length === 0
      ? 0
      : Math.max(0, availableMain / mainFillIndexes.length);
  for (const index of mainFillIndexes) {
    mainSizes[index] = share;
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
    const resolved: ResolvedSize =
      layout === 'horizontal'
        ? { width: mainSizes[index], height: crossSizes[index] }
        : { width: crossSizes[index], height: mainSizes[index] };

    return layoutElement(
      child,
      childPath(path, index),
      parent,
      x,
      y,
      issues,
      resolved,
    );
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
  const issues: LayoutIssue[] = [];
  const parent: ParentLayout = { kind: 'root' };
  const width = resolveSize(element, 'width', parent, '$', issues);
  const height = resolveSize(element, 'height', parent, '$', issues);
  if (issues.length > 0) {
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
  const resolvedDocument = resolveDesignDocument(document);
  const issues: LayoutIssue[] = [];
  const roots = resolvedDocument.children.map((element, index) =>
    layoutElement(
      element,
      `$.children[${index}]`,
      { kind: 'root' },
      element.x ?? 0,
      element.y ?? 0,
      issues,
    ),
  );

  let width = 0;
  let height = 0;
  for (const node of roots) {
    width = Math.max(width, node.box.x + node.box.width);
    height = Math.max(height, node.box.y + node.box.height);
  }

  return { roots, issues, width: round(width), height: round(height) };
}

/** Converts a layout issue into a document diagnostic. */
export function layoutIssueToDiagnostic(issue: LayoutIssue): Diagnostic {
  return createDiagnostic(
    DiagnosticCodes.missingSizeBasis,
    issue.path,
    issue.message,
  );
}
