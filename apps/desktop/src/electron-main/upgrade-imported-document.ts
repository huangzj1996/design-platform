import {
  resolveVariableValue,
  validateDesignDocument,
  type DesignDocument,
  type DesignElement,
  type Diagnostic,
} from '@design-ai/design-schema';
import type {
  DesignDocument as LegacyDesignDocument,
  DesignElement as LegacyDesignElement,
  Dimension as LegacyDimension,
} from '@design-ai/design-schema/legacy';

type CurrentFrame = Extract<DesignElement, { type: 'frame' }>;
type LegacyFrame = Extract<LegacyDesignElement, { type: 'frame' }>;
type LegacyVariables = LegacyDesignDocument['variables'];

export type UpgradeImportedDocumentResult =
  | { ok: true; document: DesignDocument }
  | { ok: false; errors: Diagnostic[] };

/** A v2 color layer keeps literal colors and variable references. */
function colorLayer(
  color: string | undefined,
): { type: 'color'; color: string } | undefined {
  return color === undefined ? undefined : { type: 'color', color };
}

function fillOf(element: LegacyDesignElement) {
  const layer = colorLayer(element.fill);
  if (layer === undefined) {
    return undefined;
  }
  if (element.fillOpacity !== undefined && element.fillOpacity < 1) {
    return [{ ...layer, opacity: element.fillOpacity }];
  }
  return [layer];
}

function strokeOf(element: LegacyDesignElement) {
  const fill = colorLayer(element.stroke);
  if (fill === undefined) {
    return undefined;
  }
  return {
    fill: [fill],
    ...(element.strokeWidth === undefined
      ? {}
      : { width: element.strokeWidth }),
  };
}

/**
 * v2 has no visibility flag; a hidden v1 element keeps its layout but paints
 * at 0 opacity. The visibility flag may be a boolean variable reference.
 */
function opacityOf(
  element: LegacyDesignElement,
  variables: LegacyVariables,
): number | undefined {
  if (resolveVariableValue(element.visible, variables) === false) {
    return 0;
  }
  return element.opacity;
}

type DimensionValue = NonNullable<CurrentFrame['width']>;

function dimension(
  value: LegacyDimension | string | undefined,
): DimensionValue | undefined {
  if (value === undefined || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return value as DimensionValue;
  }
  return value.mode;
}

function commonFields(
  element: LegacyDesignElement,
  variables: LegacyVariables,
) {
  const opacity = opacityOf(element, variables);
  const fill = fillOf(element);
  const stroke = strokeOf(element);
  return {
    id: element.id,
    ...(opacity === undefined ? {} : { opacity }),
    ...(element.x === undefined ? {} : { x: element.x }),
    ...(element.y === undefined ? {} : { y: element.y }),
    ...(element.rotation === undefined ? {} : { rotation: element.rotation }),
    ...(fill === undefined ? {} : { fill }),
    ...(stroke === undefined ? {} : { stroke }),
    ...(element.cornerRadius === undefined
      ? {}
      : { cornerRadius: element.cornerRadius }),
  };
}

function sizedFields(element: LegacyDesignElement) {
  const width = dimension(element.width);
  const height = dimension(element.height);
  return {
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
  };
}

function upgradeFrame(
  element: LegacyFrame,
  variables: LegacyVariables,
): CurrentFrame {
  const children =
    element.children?.map((child) => upgradeElement(child, variables)) ?? [];
  return {
    ...commonFields(element, variables),
    type: 'frame',
    ...sizedFields(element),
    ...(element.layout === undefined ? {} : { layout: element.layout }),
    ...(element.gap === undefined ? {} : { gap: element.gap }),
    ...(element.padding === undefined ? {} : { padding: element.padding }),
    ...(element.justifyContent === undefined
      ? {}
      : { justifyContent: element.justifyContent }),
    ...(element.alignItems === undefined
      ? {}
      : { alignItems: element.alignItems }),
    ...(element.clipContent === true ? { clip: true } : {}),
    ...(children.length === 0 ? {} : { children }),
  };
}

function textGrowthOf(
  wraps: boolean,
  height: DimensionValue | undefined,
): 'auto' | 'fixed-width' | 'fixed-width-height' {
  if (!wraps) {
    return 'auto';
  }
  return height === undefined ? 'fixed-width' : 'fixed-width-height';
}

function textStyleOf(element: Extract<LegacyDesignElement, { type: 'text' }>) {
  const width = dimension(element.width);
  const height = dimension(element.height);
  const wraps = element.textWrap !== 'none' && width !== undefined;
  const textGrowth = textGrowthOf(wraps, height);
  return {
    content: element.text,
    textGrowth,
    ...(wraps ? { width } : {}),
    ...(textGrowth === 'fixed-width-height' && height !== undefined
      ? { height }
      : {}),
    ...(element.fontFamily === undefined
      ? {}
      : { fontFamily: element.fontFamily }),
    ...(element.fontSize === undefined ? {} : { fontSize: element.fontSize }),
    ...(element.fontWeight === undefined
      ? {}
      : { fontWeight: element.fontWeight }),
    ...(element.lineHeight === undefined
      ? {}
      : { lineHeight: element.lineHeight }),
    ...(element.textAlign === undefined
      ? {}
      : { textAlign: element.textAlign }),
  };
}

function upgradeElement(
  element: LegacyDesignElement,
  variables: LegacyVariables,
): DesignElement {
  switch (element.type) {
    case 'frame':
      return upgradeFrame(element, variables);
    case 'text':
      return {
        ...commonFields(element, variables),
        type: 'text',
        textStyle: textStyleOf(element),
      };
    case 'icon':
      return {
        ...commonFields(element, variables),
        type: 'icon',
        ...sizedFields(element),
        library: element.library,
        icon: element.icon,
      };
    case 'rectangle':
      return {
        ...commonFields(element, variables),
        type: 'rectangle',
        ...sizedFields(element),
      };
    case 'ellipse':
      return {
        ...commonFields(element, variables),
        type: 'ellipse',
        ...sizedFields(element),
      };
  }
}

/**
 * Converts the legacy document produced by the Pencil importer into the
 * current v2 contract. The importer itself stays untouched; the bridge keeps
 * its element ids, nesting, order, variables and paint intent.
 */
export function upgradeImportedDocument(
  document: LegacyDesignDocument,
): UpgradeImportedDocumentResult {
  const upgraded: DesignDocument = {
    version: 2,
    children: document.children.map((child) =>
      upgradeElement(child, document.variables),
    ),
    variables: document.variables as unknown as DesignDocument['variables'],
  };
  const result = validateDesignDocument(upgraded);
  return result.ok
    ? { ok: true, document: result.document }
    : { ok: false, errors: result.errors };
}
