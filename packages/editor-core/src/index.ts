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
