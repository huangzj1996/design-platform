export {
  alignElement,
  findElementParent,
  frameAlignmentCell,
  frameAlignmentProps,
  type ElementAlignment,
  type FrameAlignmentCell,
} from './document/alignment';
export {
  addElement,
  createBlankDocument,
  createDefaultElement,
  createElementId,
  deleteElement,
  findElement,
  updateElement,
  type ElementPatch,
} from './document/edit';
export {
  declarationPosition,
  dragMoveTarget,
  moveElement,
  type ElementPosition,
} from './document/move';
export {
  PencilDiagnosticCodes,
  type PencilDiagnosticCode,
} from './pencil/diagnostics';
export {
  importPencilDocument,
  type PencilImportFailure,
  type PencilImportResult,
  type PencilImportSuccess,
} from './pencil/import-document';
export { stripJsonComments } from './pencil/json-comments';
export {
  createEditorSession,
  EDIT_HISTORY_LIMIT,
  type EditorCommand,
  type EditorCommandResult,
  type EditorSelectors,
  type EditorSession,
  type EditorSnapshot,
} from './session/editor-session';
