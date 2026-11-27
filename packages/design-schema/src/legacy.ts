// Workspace entry point for the editor's v1 document model.
export * from './diagnostics';
export * from './fields';
export * from './layout';
export {
  parseDesignDocument,
  validateDesignDocument,
} from './legacy-validation';
export * from './node-inspectors';
export * from './path';
export * from './types';
export {
  isVariableName,
  resolveDesignDocument,
  resolveVariableValue,
  unescapeVariableReference,
  variableReferenceName,
} from './variables';
