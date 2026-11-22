import type { Diagnostic } from './diagnostics';

export const DESIGN_DOCUMENT_VERSION = 1 as const;

export type ElementType = 'frame' | 'rectangle' | 'ellipse' | 'text' | 'icon';

export type DimensionMode = 'fit_content' | 'fill_container';

export type Dimension =
  | number
  | {
      mode: DimensionMode;
      fallback?: number;
    };

export type FrameLayout = 'none' | 'horizontal' | 'vertical';

export type FrameJustifyContent =
  'start' | 'center' | 'end' | 'space_between' | 'space_around';

export type FrameAlignItems = 'start' | 'center' | 'end';

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

export type ValidationResult =
  { ok: true; document: DesignDocument } | { ok: false; errors: Diagnostic[] };

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
  (value: unknown, path: string): Diagnostic[];
  /**
   * Variable types that may bind to this field when its whole value is a
   * variable reference. Omitted for fields that cannot bind a variable.
   */
  variableTypes?: readonly VariableType[];
}
