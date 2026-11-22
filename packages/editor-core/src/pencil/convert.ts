import {
  createDiagnostic,
  isHexColor,
  isPlainObject,
  type DesignElement,
  type Diagnostic,
  type Dimension,
  type DimensionMode,
  type ElementStyle,
  type EllipseElement,
  type FrameAlignItems,
  type FrameElement,
  type FrameJustifyContent,
  type FrameLayout,
  type IconElement,
  type RectangleElement,
  type SizedElement,
  type TextAlign,
  type TextElement,
} from '@design-ai/design-schema';
import { PencilDiagnosticCodes } from './diagnostics';

const FRAME_LAYOUTS: readonly FrameLayout[] = [
  'none',
  'horizontal',
  'vertical',
];
const JUSTIFY_CONTENT: readonly FrameJustifyContent[] = [
  'start',
  'center',
  'end',
  'space_between',
  'space_around',
];
const ALIGN_ITEMS: readonly FrameAlignItems[] = ['start', 'center', 'end'];
const TEXT_ALIGNS: readonly TextAlign[] = [
  'left',
  'center',
  'right',
  'justify',
];
const TEXT_GROWTHS = ['auto', 'fixed-width', 'fixed-width-height'] as const;
const DEFAULT_ICON_LIBRARY = 'lucide';

const COMMON_FIELDS = [
  'id',
  'type',
  'x',
  'y',
  'enabled',
  'opacity',
  'rotation',
  'fill',
  'stroke',
  'strokeWidth',
  'cornerRadius',
] as const;
const SIZED_FIELDS = ['width', 'height'] as const;
const FRAME_FIELDS = [
  ...COMMON_FIELDS,
  ...SIZED_FIELDS,
  'layout',
  'gap',
  'padding',
  'justifyContent',
  'alignItems',
  'children',
  'clip',
] as const;
const SHAPE_FIELDS = [...COMMON_FIELDS, ...SIZED_FIELDS] as const;
const TEXT_FIELDS = [
  ...COMMON_FIELDS,
  ...SIZED_FIELDS,
  'content',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'textAlign',
  'textGrowth',
] as const;
const ICON_FIELDS = [
  ...COMMON_FIELDS,
  ...SIZED_FIELDS,
  'library',
  'icon',
  'weight',
] as const;

const SIZING_PATTERN =
  /^(fit_content|fill_container)(?:\(\s*([0-9]+(?:\.[0-9]+)?)\s*\))?$/;
const INTEGER_OR_DECIMAL = /^[0-9]+(?:\.[0-9]+)?$/;
const FONT_WEIGHT_NAMES: Record<string, number> = {
  thin: 100,
  hairline: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  normal: 400,
  regular: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  heavy: 800,
  black: 900,
};

interface NumberRule {
  nonNegative?: boolean;
  positive?: boolean;
  max?: number;
}

interface SolidColorResult {
  converted: boolean;
  color?: string;
}

/**
 * Mutable state shared by one Pencil document conversion. ID bookkeeping keeps
 * generated IDs deterministic and avoids colliding with valid source IDs.
 */
export interface ConversionContext {
  warnings: Diagnostic[];
  reservedIds: Set<string>;
  assignedIds: Set<string>;
  idOccurrences: Map<string, number>;
  keptSourceIds: Set<string>;
  idCounters: Map<string, number>;
  /** Source Pencil path of every converted element, for later diagnostics. */
  sourcePaths: WeakMap<DesignElement, string>;
}

export function createConversionContext(): ConversionContext {
  return {
    warnings: [],
    reservedIds: new Set(),
    assignedIds: new Set(),
    idOccurrences: new Map(),
    keptSourceIds: new Set(),
    idCounters: new Map(),
    sourcePaths: new WeakMap(),
  };
}

function fieldPath(path: string, field: string): string {
  return `${path}.${field}`;
}

function childPath(parentPath: string, index: number): string {
  return `${parentPath}.children[${index}]`;
}

function warnUnsupportedProperty(
  ctx: ConversionContext,
  path: string,
  field: string,
  message: string,
): void {
  ctx.warnings.push(
    createDiagnostic(
      PencilDiagnosticCodes.unsupportedProperty,
      fieldPath(path, field),
      message,
    ),
  );
}

function warnUnsupportedField(
  ctx: ConversionContext,
  path: string,
  field: string,
): void {
  warnUnsupportedProperty(
    ctx,
    path,
    field,
    `Pencil 属性 "${field}" 暂不支持，已跳过`,
  );
}

function warnInvalidField(
  ctx: ConversionContext,
  path: string,
  field: string,
): void {
  warnUnsupportedProperty(
    ctx,
    path,
    field,
    `Pencil 属性 "${field}" 的值不受支持，已跳过`,
  );
}

function warnSkippedNode(
  ctx: ConversionContext,
  path: string,
  message: string,
): void {
  ctx.warnings.push(
    createDiagnostic(PencilDiagnosticCodes.skippedNode, path, message),
  );
}

function warnUnknownFields(
  node: Record<string, unknown>,
  allowedFields: readonly string[],
  path: string,
  ctx: ConversionContext,
): void {
  const allowed = new Set(allowedFields);
  for (const key of Object.keys(node)) {
    if (!allowed.has(key)) {
      warnUnsupportedField(ctx, path, key);
    }
  }
}

function normalizeNumber(value: unknown, rule: NumberRule): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  if (rule.nonNegative === true && value < 0) {
    return undefined;
  }
  if (rule.positive === true && value <= 0) {
    return undefined;
  }
  if (rule.max !== undefined && value > rule.max) {
    return undefined;
  }
  return value;
}

function readNumberField(
  node: Record<string, unknown>,
  field: string,
  path: string,
  ctx: ConversionContext,
  rule: NumberRule = {},
): number | undefined {
  const value = node[field];
  if (value === undefined) {
    return undefined;
  }
  const parsed = normalizeNumber(value, rule);
  if (parsed === undefined) {
    warnInvalidField(ctx, path, field);
  }
  return parsed;
}

function readStringField(
  node: Record<string, unknown>,
  field: string,
  path: string,
  ctx: ConversionContext,
  options: { nonEmpty?: boolean } = {},
): string | undefined {
  const value = node[field];
  if (value === undefined) {
    return undefined;
  }
  const usable =
    typeof value === 'string' &&
    !value.startsWith('$') &&
    (options.nonEmpty !== true || value.length > 0);
  if (!usable) {
    warnInvalidField(ctx, path, field);
    return undefined;
  }
  return value;
}

function readEnumField<T extends string>(
  node: Record<string, unknown>,
  field: string,
  path: string,
  ctx: ConversionContext,
  allowed: readonly T[],
): T | undefined {
  const value = node[field];
  if (value === undefined) {
    return undefined;
  }
  if (
    typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
  ) {
    return value as T;
  }
  warnInvalidField(ctx, path, field);
  return undefined;
}

function dimensionValue(value: unknown): Dimension | undefined {
  if (typeof value === 'number') {
    return normalizeNumber(value, { nonNegative: true });
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = SIZING_PATTERN.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const dimension: Exclude<Dimension, number> = {
    mode: match[1] as DimensionMode,
  };
  if (match[2] !== undefined) {
    dimension.fallback = Number(match[2]);
  }
  return dimension;
}

function assignDimension(
  node: Record<string, unknown>,
  field: 'width' | 'height',
  path: string,
  ctx: ConversionContext,
  element: SizedElement,
): Dimension | undefined {
  const value = node[field];
  if (value === undefined) {
    return undefined;
  }
  const dimension = dimensionValue(value);
  if (dimension === undefined) {
    warnInvalidField(ctx, path, field);
    return undefined;
  }
  element[field] = dimension;
  return dimension;
}

function solidColorValue(value: unknown): SolidColorResult {
  if (typeof value === 'string') {
    return isHexColor(value)
      ? { converted: true, color: value }
      : { converted: false };
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return { converted: true };
    }
    if (value.length === 1) {
      return solidColorValue(value[0]);
    }
    return { converted: false };
  }

  if (isPlainObject(value)) {
    if (value.enabled === false) {
      return { converted: true };
    }
    if (value.type === 'color') {
      return solidColorValue(value.color);
    }
    return { converted: false };
  }

  return { converted: false };
}

function applyColorField(
  node: Record<string, unknown>,
  field: 'fill' | 'stroke',
  path: string,
  ctx: ConversionContext,
  element: ElementStyle,
): void {
  const value = node[field];
  if (value === undefined) {
    return;
  }
  const result = solidColorValue(value);
  if (!result.converted) {
    warnInvalidField(ctx, path, field);
    return;
  }
  if (result.color !== undefined) {
    element[field] = result.color;
  }
}

function cornerRadiusValue(value: unknown): number | undefined {
  const scalar = normalizeNumber(value, { nonNegative: true });
  if (scalar !== undefined) {
    return scalar;
  }

  if (!Array.isArray(value) || value.length !== 4) {
    return undefined;
  }
  const radii = value.map((entry) =>
    normalizeNumber(entry, { nonNegative: true }),
  );
  if (radii.some((radius) => radius === undefined)) {
    return undefined;
  }
  const [first] = radii as number[];
  return radii.every((radius) => radius === first) ? first : undefined;
}

function paddingValue(
  value: unknown,
): [number, number, number, number] | undefined {
  const single = normalizeNumber(value, { nonNegative: true });
  if (single !== undefined) {
    return [single, single, single, single];
  }

  if (!Array.isArray(value)) {
    return undefined;
  }
  const entries = value.map((entry) =>
    normalizeNumber(entry, { nonNegative: true }),
  );
  if (entries.some((entry) => entry === undefined)) {
    return undefined;
  }
  const [top, right, bottom, left] = entries as number[];

  if (value.length === 2) {
    return [top, right, top, right];
  }
  if (value.length === 4) {
    return [top, right, bottom, left];
  }
  return undefined;
}

function applyCommonFields(
  node: Record<string, unknown>,
  path: string,
  ctx: ConversionContext,
  element: ElementStyle,
): void {
  const x = readNumberField(node, 'x', path, ctx);
  if (x !== undefined) {
    element.x = x;
  }

  const y = readNumberField(node, 'y', path, ctx);
  if (y !== undefined) {
    element.y = y;
  }

  if (node.enabled !== undefined) {
    if (typeof node.enabled === 'boolean') {
      if (!node.enabled) {
        element.visible = false;
      }
    } else {
      warnInvalidField(ctx, path, 'enabled');
    }
  }

  const opacity = readNumberField(node, 'opacity', path, ctx, {
    nonNegative: true,
    max: 1,
  });
  if (opacity !== undefined) {
    element.opacity = opacity;
  }

  const rotation = readNumberField(node, 'rotation', path, ctx);
  if (rotation !== undefined) {
    element.rotation = rotation;
  }

  applyColorField(node, 'fill', path, ctx, element);
  applyColorField(node, 'stroke', path, ctx, element);

  const strokeWidth = readNumberField(node, 'strokeWidth', path, ctx, {
    nonNegative: true,
  });
  if (strokeWidth !== undefined) {
    element.strokeWidth = strokeWidth;
  }

  if (node.cornerRadius !== undefined) {
    const cornerRadius = cornerRadiusValue(node.cornerRadius);
    if (cornerRadius === undefined) {
      warnInvalidField(ctx, path, 'cornerRadius');
    } else {
      element.cornerRadius = cornerRadius;
    }
  }
}

function resolveId(
  node: Record<string, unknown>,
  type: string,
  path: string,
  ctx: ConversionContext,
): string {
  const rawId = node.id;
  if (typeof rawId === 'string' && rawId.trim().length > 0) {
    const occurrences = ctx.idOccurrences.get(rawId) ?? 0;
    const firstUse = !ctx.keptSourceIds.has(rawId);
    if (occurrences <= 1 || firstUse) {
      ctx.keptSourceIds.add(rawId);
      ctx.assignedIds.add(rawId);
      return rawId;
    }

    const generated = generateId(type, ctx);
    ctx.warnings.push(
      createDiagnostic(
        PencilDiagnosticCodes.duplicateId,
        fieldPath(path, 'id'),
        `Pencil 节点 ID "${rawId}" 重复，已分配新 ID "${generated}"`,
      ),
    );
    return generated;
  }

  const generated = generateId(type, ctx);
  ctx.warnings.push(
    createDiagnostic(
      PencilDiagnosticCodes.missingId,
      fieldPath(path, 'id'),
      `Pencil 节点缺少有效 ID，已分配新 ID "${generated}"`,
    ),
  );
  return generated;
}

function generateId(type: string, ctx: ConversionContext): string {
  let counter = ctx.idCounters.get(type) ?? 0;
  let candidate: string;
  do {
    counter += 1;
    candidate = `${type}-${counter}`;
  } while (ctx.reservedIds.has(candidate) || ctx.assignedIds.has(candidate));
  ctx.idCounters.set(type, counter);
  ctx.assignedIds.add(candidate);
  return candidate;
}

/**
 * Records every source ID before conversion so generated IDs never collide
 * with IDs that already appear later in the document.
 */
export function collectIdUsage(node: unknown, ctx: ConversionContext): void {
  if (!isPlainObject(node)) {
    return;
  }
  const id = node.id;
  if (typeof id === 'string' && id.trim().length > 0) {
    ctx.reservedIds.add(id);
    ctx.idOccurrences.set(id, (ctx.idOccurrences.get(id) ?? 0) + 1);
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectIdUsage(child, ctx);
    }
  }
}

function convertFrame(
  node: Record<string, unknown>,
  path: string,
  ctx: ConversionContext,
): FrameElement {
  warnUnknownFields(node, FRAME_FIELDS, path, ctx);

  const frame: FrameElement = {
    id: resolveId(node, 'frame', path, ctx),
    type: 'frame',
  };
  ctx.sourcePaths.set(frame, path);
  applyCommonFields(node, path, ctx, frame);
  assignDimension(node, 'width', path, ctx, frame);
  assignDimension(node, 'height', path, ctx, frame);

  const layout = readEnumField(node, 'layout', path, ctx, FRAME_LAYOUTS);
  if (layout !== undefined) {
    frame.layout = layout;
  }

  const gap = readNumberField(node, 'gap', path, ctx, { nonNegative: true });
  if (gap !== undefined) {
    frame.gap = gap;
  }

  if (node.padding !== undefined) {
    const padding = paddingValue(node.padding);
    if (padding === undefined) {
      warnInvalidField(ctx, path, 'padding');
    } else {
      frame.padding = padding;
    }
  }

  const justifyContent = readEnumField(
    node,
    'justifyContent',
    path,
    ctx,
    JUSTIFY_CONTENT,
  );
  if (justifyContent !== undefined) {
    frame.justifyContent = justifyContent;
  }

  const alignItems = readEnumField(node, 'alignItems', path, ctx, ALIGN_ITEMS);
  if (alignItems !== undefined) {
    frame.alignItems = alignItems;
  }

  if (node.clip !== undefined && node.clip !== false) {
    warnInvalidField(ctx, path, 'clip');
  }

  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) {
      warnInvalidField(ctx, path, 'children');
    } else {
      const children = node.children
        .map((child, index) => convertNode(child, childPath(path, index), ctx))
        .filter((child): child is DesignElement => child !== null);
      if (children.length > 0) {
        frame.children = children;
      }
    }
  }

  return frame;
}

function convertRectangle(
  node: Record<string, unknown>,
  path: string,
  ctx: ConversionContext,
): RectangleElement {
  warnUnknownFields(node, SHAPE_FIELDS, path, ctx);

  const rectangle: RectangleElement = {
    id: resolveId(node, 'rectangle', path, ctx),
    type: 'rectangle',
  };
  ctx.sourcePaths.set(rectangle, path);
  applyCommonFields(node, path, ctx, rectangle);
  assignDimension(node, 'width', path, ctx, rectangle);
  assignDimension(node, 'height', path, ctx, rectangle);
  return rectangle;
}

function convertEllipse(
  node: Record<string, unknown>,
  path: string,
  ctx: ConversionContext,
): EllipseElement {
  warnUnknownFields(node, SHAPE_FIELDS, path, ctx);

  const ellipse: EllipseElement = {
    id: resolveId(node, 'ellipse', path, ctx),
    type: 'ellipse',
  };
  ctx.sourcePaths.set(ellipse, path);
  applyCommonFields(node, path, ctx, ellipse);
  assignDimension(node, 'width', path, ctx, ellipse);
  assignDimension(node, 'height', path, ctx, ellipse);
  return ellipse;
}

function fontWeightValue(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return normalizeNumber(value, { positive: true });
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (INTEGER_OR_DECIMAL.test(trimmed)) {
      return normalizeNumber(Number(trimmed), { positive: true });
    }
    const key = trimmed.toLowerCase().replace(/[\s-]+/g, '');
    return FONT_WEIGHT_NAMES[key];
  }
  return undefined;
}

function convertText(
  node: Record<string, unknown>,
  path: string,
  ctx: ConversionContext,
): TextElement | null {
  warnUnknownFields(node, TEXT_FIELDS, path, ctx);

  const content = node.content;
  if (typeof content !== 'string' || content.startsWith('$')) {
    warnSkippedNode(
      ctx,
      path,
      content === undefined
        ? '文本节点缺少 content，已跳过'
        : '文本节点的 content 不是可转换的文本，已跳过',
    );
    return null;
  }

  const text: TextElement = {
    id: resolveId(node, 'text', path, ctx),
    type: 'text',
    text: content,
  };
  ctx.sourcePaths.set(text, path);
  applyCommonFields(node, path, ctx, text);

  const fontFamily = readStringField(node, 'fontFamily', path, ctx, {
    nonEmpty: true,
  });
  if (fontFamily !== undefined) {
    text.fontFamily = fontFamily;
  }

  const fontSize = readNumberField(node, 'fontSize', path, ctx, {
    positive: true,
  });
  if (fontSize !== undefined) {
    text.fontSize = fontSize;
  }

  if (node.fontWeight !== undefined) {
    const fontWeight = fontWeightValue(node.fontWeight);
    if (fontWeight === undefined) {
      warnInvalidField(ctx, path, 'fontWeight');
    } else {
      text.fontWeight = fontWeight;
    }
  }

  const lineHeight = readNumberField(node, 'lineHeight', path, ctx, {
    positive: true,
  });
  if (lineHeight !== undefined) {
    text.lineHeight = lineHeight;
  }

  const textAlign = readEnumField(node, 'textAlign', path, ctx, TEXT_ALIGNS);
  if (textAlign !== undefined) {
    text.textAlign = textAlign;
  }

  const growth =
    readEnumField(node, 'textGrowth', path, ctx, TEXT_GROWTHS) ?? 'auto';
  if (growth === 'auto') {
    text.textWrap = 'none';
  } else {
    text.textWrap = 'wrap';
    assignDimension(node, 'width', path, ctx, text);
    if (growth === 'fixed-width-height') {
      assignDimension(node, 'height', path, ctx, text);
    }
  }

  return text;
}

function convertIcon(
  node: Record<string, unknown>,
  path: string,
  ctx: ConversionContext,
): IconElement | null {
  warnUnknownFields(node, ICON_FIELDS, path, ctx);

  const iconName = node.icon;
  if (
    typeof iconName !== 'string' ||
    iconName.length === 0 ||
    iconName.startsWith('$')
  ) {
    warnSkippedNode(ctx, path, '图标节点缺少有效的 icon，已跳过');
    return null;
  }

  let library = DEFAULT_ICON_LIBRARY;
  if (node.library !== undefined) {
    if (
      typeof node.library === 'string' &&
      node.library.length > 0 &&
      !node.library.startsWith('$')
    ) {
      library = node.library;
    } else {
      warnInvalidField(ctx, path, 'library');
    }
  }

  if (node.weight !== undefined) {
    warnUnsupportedField(ctx, path, 'weight');
  }

  const icon: IconElement = {
    id: resolveId(node, 'icon', path, ctx),
    type: 'icon',
    library,
    icon: iconName,
  };
  ctx.sourcePaths.set(icon, path);
  applyCommonFields(node, path, ctx, icon);
  assignDimension(node, 'width', path, ctx, icon);
  assignDimension(node, 'height', path, ctx, icon);
  return icon;
}

/**
 * Converts one Pencil object into a native element. Unsupported node types are
 * skipped together with their subtree and reported. Unsupported properties are
 * dropped while the remaining node is kept.
 */
export function convertNode(
  node: unknown,
  path: string,
  ctx: ConversionContext,
): DesignElement | null {
  if (!isPlainObject(node)) {
    warnSkippedNode(ctx, path, 'Pencil 节点不是对象，已跳过');
    return null;
  }

  const type = node.type;
  if (typeof type !== 'string' || type.length === 0) {
    warnSkippedNode(ctx, path, 'Pencil 节点缺少 type，已跳过');
    return null;
  }

  switch (type) {
    case 'frame':
      return convertFrame(node, path, ctx);
    case 'rectangle':
      return convertRectangle(node, path, ctx);
    case 'ellipse':
      return convertEllipse(node, path, ctx);
    case 'text':
      return convertText(node, path, ctx);
    case 'icon':
      return convertIcon(node, path, ctx);
    default:
      ctx.warnings.push(
        createDiagnostic(
          PencilDiagnosticCodes.unsupportedNode,
          path,
          `不支持的 Pencil 节点类型 "${type}"，已跳过该节点及其子树`,
        ),
      );
      return null;
  }
}
