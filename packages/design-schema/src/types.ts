import type { Diagnostic } from './diagnostics';
import type {
  dimensionModes,
  frameAlignItems,
  frameJustifyContent,
  frameLayouts,
} from './layout-values';

export const DESIGN_DOCUMENT_VERSION = 1 as const;

export type ElementType = 'frame' | 'rectangle' | 'ellipse' | 'text' | 'icon';

export type DimensionMode = (typeof dimensionModes)[number];

export type Dimension =
  | number
  | {
      mode: DimensionMode;
      fallback?: number;
    };

export type FrameLayout = (typeof frameLayouts)[number];

export type FrameJustifyContent = (typeof frameJustifyContent)[number];

export type FrameAlignItems = (typeof frameAlignItems)[number];

export type TextAlign = 'left' | 'center' | 'right' | 'justify';

export type TextWrap = 'wrap' | 'none';

export type VariableType = 'color' | 'string' | 'number' | 'boolean';

export type VariableValue = string | number | boolean;

export interface DesignVariable {
  type: VariableType;
  value: VariableValue;
}

export type DesignVariables = Record<string, DesignVariable>;

/**
 * Style properties shared by every native element.
 */
export interface ElementStyle {
  id: string;
  /** Horizontal offset; used by free-positioning parents and the document root. */
  x?: number;
  /** Vertical offset; used by free-positioning parents and the document root. */
  y?: number;
  visible?: boolean;
  opacity?: number;
  /** Opacity of the fill only; strokes and children keep their own opacity. */
  fillOpacity?: number;
  rotation?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
}

export interface SizedElement extends ElementStyle {
  width?: Dimension;
  height?: Dimension;
}

export interface FrameElement extends SizedElement {
  type: 'frame';
  /** Hides child content that extends beyond the frame's border box. */
  clipContent?: boolean;
  layout?: FrameLayout;
  gap?: number;
  padding?: [number, number, number, number];
  justifyContent?: FrameJustifyContent;
  alignItems?: FrameAlignItems;
  children?: DesignElement[];
}

export interface RectangleElement extends SizedElement {
  type: 'rectangle';
}

export interface EllipseElement extends SizedElement {
  type: 'ellipse';
}

export interface TextElement extends SizedElement {
  type: 'text';
  text: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  textAlign?: TextAlign;
  textWrap?: TextWrap;
}

export interface IconElement extends SizedElement {
  type: 'icon';
  library: string;
  icon: string;
}

export type DesignElement =
  FrameElement | RectangleElement | EllipseElement | TextElement | IconElement;

export interface DesignDocument {
  version: typeof DESIGN_DOCUMENT_VERSION;
  children: DesignElement[];
  filePath?: string;
  variables: DesignVariables;
}

export type ValidationResult<Document = DesignDocument> =
  { ok: true; document: Document } | { ok: false; errors: Diagnostic[] };

export interface NodeInspector {
  /** Native element type handled by this inspector. */
  type: ElementType;
  /** Whether the element may own an ordered `children` list. */
  allowsChildren: boolean;
  /** Fields that must be present on the element. */
  requiredFields?: readonly string[];
  /** Validators for every supported, type-specific and shared field. */
  fields: Readonly<Record<string, FieldValidator>>;
}

export interface FieldValidator {
  (
    value: unknown,
    path: string,
    variables?: Readonly<DesignVariables>,
  ): Diagnostic[];
  /**
   * Variable types that may bind to this field when its whole value is a
   * variable reference. Omitted for fields that cannot bind a variable.
   */
  variableTypes?: readonly VariableType[];
}
