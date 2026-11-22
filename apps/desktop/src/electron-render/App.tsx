import type {
  DesignDocument,
  Diagnostic,
  ElementType,
} from '@design-ai/design-schema';
import { validateDesignDocument } from '@design-ai/design-schema';
import {
  addElement,
  createDefaultElement,
  createElementId,
  deleteElement,
  updateElement,
  type ElementPatch,
} from '@design-ai/editor-core';
import { useEffect, useRef, useState } from 'react';
import type {
  CreateDesignFileResult,
  DesignAiApi,
  OpenDesignFileResult,
  SaveDesignFileInput,
  SaveDesignFileResult,
} from '../electron-preload/contract';
import { Canvas } from './Canvas';
import type { CanvasEngineFactory } from './canvas-engine';
import {
  applyCreateError,
  applyCreateResult,
  applyOpenError,
  applyOpenResult,
  applySaveFailure,
  applySaveResult,
  documentName,
  editDocument,
  initialEditorState,
  markSaving,
  selectElement,
  setPendingAction,
  type EditorState,
  type PendingAction,
} from './editor-state';
import { LayerTree } from './LayerTree';
import { PropertiesPanel } from './PropertiesPanel';
import { useAutosave } from './use-autosave';

export interface AppProps {
  openDesignFile?: () => Promise<OpenDesignFileResult>;
  createDesignFile?: () => Promise<CreateDesignFileResult>;
  saveDesignFile?: (
    input: SaveDesignFileInput,
  ) => Promise<SaveDesignFileResult>;
  subscribeCloseRequest?: (listener: () => void) => () => void;
  confirmClose?: () => void;
  initialState?: EditorState;
  saveDelayMs?: number;
  /** Canvas engine factory, injectable for tests. */
  createCanvasEngine?: CanvasEngineFactory;
}

function requireDesignAi(operation: string): DesignAiApi {
  if (window.designAi === undefined) {
    throw new Error(`设计稿${operation}桥接不可用`);
  }
  return window.designAi;
}

async function openThroughBridge(): Promise<OpenDesignFileResult> {
  return requireDesignAi('打开').openDesignFile();
}

async function createThroughBridge(): Promise<CreateDesignFileResult> {
  return requireDesignAi('新建').createDesignFile();
}

async function saveThroughBridge(
  input: SaveDesignFileInput,
): Promise<SaveDesignFileResult> {
  return requireDesignAi('保存').saveDesignFile(input);
}

function subscribeThroughBridge(listener: () => void): () => void {
  return window.designAi?.onCloseRequest(listener) ?? (() => {});
}

function confirmThroughBridge(): void {
  window.designAi?.confirmClose();
}

function DiagnosticList({ diagnostics }: { diagnostics: Diagnostic[] }) {
  return (
    <ul>
      {diagnostics.map((diagnostic, index) => (
        <li key={`${diagnostic.code}-${diagnostic.path}-${index}`}>
          <code className="diagnostic-code">{diagnostic.code}</code>
          <code className="diagnostic-path">{diagnostic.path}</code>
          <span className="diagnostic-message">{diagnostic.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** Describes the save state shown next to the current document name. */
function saveStatusText(state: EditorState): string {
  if (state.saveStatus === 'saving') {
    return '正在保存…';
  }
  if (state.saveStatus === 'error') {
    return '保存失败';
  }
  if (state.dirty) {
    return '未保存的修改';
  }
  return state.filePath === null ? '未保存' : '已保存';
}

/**
 * Validates an edit before showing it, so property inputs can never persist a
 * document that no longer satisfies the version 1 contract.
 */
function commitEdit(
  state: EditorState,
  document: DesignDocument | null,
  selectionId: string | null = state.selectionId,
): EditorState {
  if (document === null) {
    return state;
  }
  const result = validateDesignDocument(document);
  if (!result.ok) {
    return state;
  }
  return editDocument(state, result.document, selectionId);
}

export function App({
  openDesignFile = openThroughBridge,
  createDesignFile = createThroughBridge,
  saveDesignFile = saveThroughBridge,
  subscribeCloseRequest = subscribeThroughBridge,
  confirmClose = confirmThroughBridge,
  initialState = initialEditorState,
  saveDelayMs,
  createCanvasEngine,
}: AppProps) {
  const [state, setState] = useState<EditorState>(initialState);
  const [opening, setOpening] = useState(false);
  const [creating, setCreating] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const { flush } = useAutosave({
    document: state.document,
    filePath: state.filePath,
    dirty: state.dirty,
    editVersion: state.editVersion,
    saveDesignFile,
    delayMs: saveDelayMs,
    onSaving: () => setState(markSaving),
    onSaved: (result, savedVersion) =>
      setState((current) => applySaveResult(current, result, savedVersion)),
    onFailed: (errors) =>
      setState((current) => applySaveFailure(current, errors)),
  });

  const runCreate = async () => {
    setCreating(true);
    try {
      const result = await createDesignFile();
      setState((current) => applyCreateResult(current, result));
    } catch (error) {
      setState((current) => applyCreateError(current, error));
    } finally {
      setCreating(false);
    }
  };

  const openNow = async () => {
    setOpening(true);
    try {
      const result = await openDesignFile();
      setState((current) => applyOpenResult(current, result));
    } catch (error) {
      setState((current) => applyOpenError(current, error));
    } finally {
      setOpening(false);
    }
  };

  const runPendingAction = async (action: PendingAction) => {
    switch (action) {
      case 'close':
        confirmClose();
        return;
      case 'create':
        await runCreate();
        return;
      case 'open':
        await openNow();
        return;
    }
  };

  /**
   * Flushes pending edits before an action that closes or replaces the current
   * design. A failed save keeps the design open and records the action for the
   * retry entry.
   */
  const saveBeforeAction = async (action: PendingAction): Promise<boolean> => {
    if (stateRef.current.document === null) {
      return true;
    }
    const saved = await flush();
    if (saved !== 'failed') {
      return true;
    }
    setState((current) => setPendingAction(current, action));
    return false;
  };

  const handleOpen = async () => {
    // Reading the target after the flush also avoids reopening a stale copy of
    // the currently open file.
    if (await saveBeforeAction('open')) {
      await openNow();
    }
  };

  const handleCreate = async () => {
    if (await saveBeforeAction('create')) {
      await runCreate();
    }
  };

  const handleCloseRequest = async () => {
    if (await saveBeforeAction('close')) {
      confirmClose();
    }
  };

  const closeHandlerRef = useRef<() => void>(() => {});
  closeHandlerRef.current = () => {
    void handleCloseRequest();
  };

  useEffect(
    () => subscribeCloseRequest(() => closeHandlerRef.current()),
    [subscribeCloseRequest],
  );

  const handleRetry = async () => {
    const saved = await flush();
    if (saved === 'failed') {
      return;
    }
    const action = stateRef.current.pendingAction;
    setState((current) => setPendingAction(current, null));
    if (action !== null) {
      await runPendingAction(action);
    }
  };

  const handleSelect = (id: string | null) => {
    setState((current) => selectElement(current, id));
  };

  const handleUpdate = (patch: ElementPatch) => {
    setState((current) => {
      if (current.document === null || current.selectionId === null) {
        return current;
      }
      const document = updateElement(
        current.document,
        current.selectionId,
        patch,
      );
      return commitEdit(current, document);
    });
  };

  const handleAddRoot = (type: ElementType) => {
    setState((current) => {
      if (current.document === null) {
        return current;
      }
      const id = createElementId(current.document, type);
      return commitEdit(
        current,
        addElement(current.document, null, createDefaultElement(type, id)),
        id,
      );
    });
  };

  const handleAddChild = (type: ElementType) => {
    setState((current) => {
      if (current.document === null || current.selectionId === null) {
        return current;
      }
      const id = createElementId(current.document, type);
      return commitEdit(
        current,
        addElement(
          current.document,
          current.selectionId,
          createDefaultElement(type, id),
        ),
        id,
      );
    });
  };

  const handleDelete = () => {
    setState((current) => {
      if (current.document === null || current.selectionId === null) {
        return current;
      }
      return editDocument(
        current,
        deleteElement(current.document, current.selectionId),
        null,
      );
    });
  };

  const document = state.document;

  return (
    <div className="app">
      <header className="toolbar">
        <div className="document-summary">
          <strong className="app-name">Design AI</strong>
          <span className="document-name">
            {documentName(state.filePath ?? state.sourcePath)}
          </span>
          {document !== null ? (
            <span className="save-status" data-testid="save-status">
              {saveStatusText(state)}
            </span>
          ) : null}
        </div>
        <div className="toolbar-actions">
          {document !== null ? (
            <>
              <button type="button" onClick={() => handleAddRoot('text')}>
                新建标题
              </button>
              <button type="button" onClick={() => handleAddRoot('frame')}>
                新建容器
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={handleCreate}
            disabled={opening || creating}
          >
            {creating ? '正在新建…' : '新建设计稿'}
          </button>
          <button
            type="button"
            onClick={handleOpen}
            disabled={opening || creating}
          >
            {opening ? '正在打开…' : '打开设计稿'}
          </button>
        </div>
      </header>

      {state.diagnostics.length > 0 ? (
        <section className="diagnostics" role="alert" aria-live="polite">
          <h2>{state.diagnosticsTitle}</h2>
          <DiagnosticList diagnostics={state.diagnostics} />
        </section>
      ) : null}

      {state.saveStatus === 'error' ? (
        <section
          className="diagnostics save-error"
          role="alert"
          aria-live="assertive"
          data-testid="save-error"
        >
          <h2>保存失败</h2>
          <DiagnosticList diagnostics={state.saveErrors} />
          <p className="save-error-hint">
            最近一次成功保存的文件保持不变，当前编辑仍在编辑器中。
          </p>
          <button type="button" onClick={handleRetry}>
            重试保存
          </button>
        </section>
      ) : null}

      {state.warnings.length > 0 ? (
        <section
          className="diagnostics import-warnings"
          role="status"
          aria-live="polite"
          data-testid="import-warnings"
        >
          <h2>导入提示</h2>
          <DiagnosticList diagnostics={state.warnings} />
        </section>
      ) : null}

      {document === null ? (
        <main className="home" data-testid="home">
          <h1>尚未打开设计稿</h1>
          <p>
            新建设计稿会立即写入项目目录；也可以打开已有的版本 1 JSON 或 Pencil
            设计稿继续编辑。
          </p>
        </main>
      ) : (
        <main className="workspace">
          <aside className="layers-panel">
            <LayerTree
              document={document}
              selectionId={state.selectionId}
              onSelect={handleSelect}
            />
          </aside>
          <section className="canvas-area">
            <Canvas
              document={document}
              selectionId={state.selectionId}
              onSelect={handleSelect}
              createEngine={createCanvasEngine}
            />
          </section>
          <PropertiesPanel
            document={document}
            selectionId={state.selectionId}
            onUpdate={handleUpdate}
            onAddChild={handleAddChild}
            onDelete={handleDelete}
          />
        </main>
      )}
    </div>
  );
}
