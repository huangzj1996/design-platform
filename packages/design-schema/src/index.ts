import type { DesignLayout as Layout, LayoutNode as Node } from './layout';
import type { DesignElement } from './validation';

export * from './diagnostics';
export { isHexColor, isOneOf, isPlainObject } from './fields';
export {
  findLayoutNode,
  layoutIssueToDiagnostic,
  measureText,
  type ElementSize,
  type LayoutBox,
  type LayoutIssue,
  type TextMeasurement,
  type TextMeasurementStyle,
} from './layout';
export {
  layoutDesignDocumentV2 as layoutDesignDocument,
  layoutDesignDocumentV2,
} from './layout-v2';
export * from './path';
export type {
  DesignVariable,
  DesignVariables,
  ElementType,
  VariableType,
  VariableValue,
} from './types';
export {
  DESIGN_DOCUMENT_VERSION,
  parseDesignDocument,
  validateDesignDocument,
  type DesignDocument,
  type DesignElement,
  type ValidationResult,
} from './validation';
export {
  isVariableName,
  resolveVariableValue,
  unescapeVariableReference,
  variableReferenceName,
} from './variables';
export * from './v2';

export type DesignLayout<Element = DesignElement> = Layout<Element>;
export type LayoutNode<Element = DesignElement> = Node<Element>;
