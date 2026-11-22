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
import { CircleUser, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  CreateDesignFileResult,
  DesignAiApi,
  OpenDesignFileResult,
  SaveDesignFileInput,
  SaveDesignFileResult,
} from '../electron-preload/contract';
import type { CanvasEngineFactory } from './canvas-engine';
import { Editor } from './Editor';
import {
  applySaveFailure,
  documentName,
  editDocument,
  initialEditorState,
  markSaving,
  selectElement,
  type EditorState,
  type PendingAction,
} from './editor-state';
import { Home } from './Home';
import { TabBar } from './TabBar';
import { useAutosave } from './use-autosave';
import {
  HOME_TAB_ID,
  activateProjectTab,
  activeProjectOf,
  applyCreateErrorToWorkspace,
  applyCreateToWorkspace,
  applyOpenErrorToWorkspace,
  applyOpenToWorkspace,
  applySaveToActiveProject,
  initialWorkspaceState,
  setPendingActionForActive,
  showHome,
  updateProjectState,
  type WorkspaceState,
} from './workspace';

export interface AppProps {
  openDesignFile?: () => Promise<OpenDesignFileResult>;
  createDesignFile?: () => Promise<CreateDesignFileResult>;
  saveDesignFile?: (
    input: SaveDesignFileInput,
  ) => Promise<SaveDesignFileResult>;
  subscribeCloseRequest?: (listener: () => void) => () => void;
  confirmClose?: () => void;
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
  saveDelayMs,
  createCanvasEngine,
}: AppProps) {
  const [workspace, setWorkspace] = useState<WorkspaceState>(
    initialWorkspaceState,
  );
  const [opening, setOpening] = useState(false);
  const [creating, setCreating] = useState(false);

  const activeProject = activeProjectOf(workspace);
  const editorState = activeProject?.state ?? initialEditorState;
  const editorStateRef = useRef(editorState);
  editorStateRef.current = editorState;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;

  const updateActiveEditor = (
    update: (current: EditorState) => EditorState,
  ) => {
    setWorkspace((current) =>
      updateProjectState(current, current.activeTabId, update),
    );
  };

  const { flush } = useAutosave({
    document: editorState.document,
    filePath: editorState.filePath,
    dirty: editorState.dirty,
    editVersion: editorState.editVersion,
    saveDesignFile,
    delayMs: saveDelayMs,
    onSaving: () => updateActiveEditor(markSaving),
    onSaved: (result, savedVersion) =>
      setWorkspace((current) =>
        applySaveToActiveProject(current, result, savedVersion),
      ),
    onFailed: (errors) =>
      updateActiveEditor((current) => applySaveFailure(current, errors)),
  });

  const runCreate = async () => {
    setCreating(true);
    try {
      const result = await createDesignFile();
      setWorkspace((current) => applyCreateToWorkspace(current, result));
    } catch (error) {
      setWorkspace((current) => applyCreateErrorToWorkspace(current, error));
    } finally {
      setCreating(false);
    }
  };

  const openNow = async () => {
    setOpening(true);
    try {
      const result = await openDesignFile();
      setWorkspace((current) => applyOpenToWorkspace(current, result));
    } catch (error) {
      setWorkspace((current) => applyOpenErrorToWorkspace(current, error));
    } finally {
      setOpening(false);
    }
  };

  const runPendingAction = async (action: PendingAction) => {
    switch (action.type) {
      case 'close':
        confirmClose();
        return;
      case 'create':
        await runCreate();
        return;
      case 'open':
        await openNow();
        return;
      case 'home':
        setWorkspace(showHome);
        return;
      case 'project':
        setWorkspace((current) =>
          activateProjectTab(current, action.projectId),
        );
        return;
    }
  };

  /**
   * Flushes pending edits before an action that closes, replaces or leaves the
   * current design. A failed save keeps the design open and records the action
   * for the retry entry.
   */
  const saveBeforeAction = async (action: PendingAction): Promise<boolean> => {
    if (editorStateRef.current.document === null) {
      return true;
    }
    const saved = await flush();
    if (saved !== 'failed') {
      return true;
    }
    setWorkspace((current) => setPendingActionForActive(current, action));
    return false;
  };

  const handleOpen = async () => {
    // Reading the target after the flush also avoids reopening a stale copy of
    // the currently open file.
    if (await saveBeforeAction({ type: 'open' })) {
      await openNow();
    }
  };

  const handleCreate = async () => {
    if (await saveBeforeAction({ type: 'create' })) {
      await runCreate();
    }
  };

  const handleSelectHome = async () => {
    if (workspaceRef.current.activeTabId === HOME_TAB_ID) {
      return;
    }
    if (await saveBeforeAction({ type: 'home' })) {
      setWorkspace(showHome);
    }
  };

  const handleSelectProject = async (projectId: string) => {
    const current = workspaceRef.current;
    if (current.activeTabId === projectId) {
      return;
    }
    if (await saveBeforeAction({ type: 'project', projectId })) {
      // Coming from home counts as reopening, so a created design adopts its
      // actual file name in the tab.
      setWorkspace((latest) =>
        activateProjectTab(latest, projectId, {
          preferFileName: latest.activeTabId === HOME_TAB_ID,
        }),
      );
    }
  };

  const handleCloseRequest = async () => {
    if (await saveBeforeAction({ type: 'close' })) {
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
    const action = editorStateRef.current.pendingAction;
    setWorkspace((current) => setPendingActionForActive(current, null));
    if (action !== null) {
      await runPendingAction(action);
    }
  };

  const handleSelect = (id: string | null) => {
    updateActiveEditor((current) => selectElement(current, id));
  };

  const handleUpdate = (patch: ElementPatch) => {
    updateActiveEditor((current) => {
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
    updateActiveEditor((current) => {
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
    updateActiveEditor((current) => {
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
    updateActiveEditor((current) => {
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

  const document = editorState.document;
  const showingHome = workspace.activeTabId === HOME_TAB_ID;
  const diagnostics = showingHome
    ? workspace.homeDiagnostics
    : editorState.diagnostics;
  const diagnosticsTitle = showingHome
    ? workspace.homeDiagnosticsTitle
    : editorState.diagnosticsTitle;

  const tabBar = (
    <TabBar
      activeTabId={workspace.activeTabId}
      projects={workspace.projects}
      busy={opening || creating}
      onSelectHome={handleSelectHome}
      onSelectProject={handleSelectProject}
      onCreate={handleCreate}
    />
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#F6F6F6] text-[#1A1A1A]">
      {diagnostics.length > 0 ? (
        <section className="diagnostics" role="alert" aria-live="polite">
          <h2>{diagnosticsTitle}</h2>
          <DiagnosticList diagnostics={diagnostics} />
        </section>
      ) : null}

      {showingHome ? (
        <>
          <header
            data-testid="window-chrome"
            className="relative flex h-12 shrink-0 items-center justify-center bg-[#F6F6F6]"
          >
            {tabBar}
            <div
              aria-hidden="true"
              className="absolute right-5 hidden items-center gap-5 text-[#222222] md:flex"
            >
              <CircleUser size={16} strokeWidth={2} />
              <Play size={16} strokeWidth={2} />
            </div>
          </header>
          <Home
            projects={workspace.projects}
            opening={opening}
            creating={creating}
            onOpen={handleOpen}
            onCreate={handleCreate}
            onSelectProject={handleSelectProject}
          />
        </>
      ) : (
        <>
          {editorState.saveStatus === 'error' ? (
            <section
              className="diagnostics save-error"
              role="alert"
              aria-live="assertive"
              data-testid="save-error"
            >
              <h2>保存失败</h2>
              <DiagnosticList diagnostics={editorState.saveErrors} />
              <p className="save-error-hint">
                最近一次成功保存的文件保持不变，当前编辑仍在编辑器中。
              </p>
              <button type="button" onClick={handleRetry}>
                重试保存
              </button>
            </section>
          ) : null}

          {editorState.warnings.length > 0 ? (
            <section
              className="diagnostics import-warnings"
              role="status"
              aria-live="polite"
              data-testid="import-warnings"
            >
              <h2>导入提示</h2>
              <DiagnosticList diagnostics={editorState.warnings} />
            </section>
          ) : null}

          <Editor
            document={document}
            selectionId={editorState.selectionId}
            tabBar={tabBar}
            documentName={documentName(
              editorState.filePath ?? editorState.sourcePath,
            )}
            saveStatus={document === null ? null : saveStatusText(editorState)}
            busy={opening || creating}
            onOpen={handleOpen}
            onCreate={handleCreate}
            onSelect={handleSelect}
            onAddRoot={handleAddRoot}
            onUpdate={handleUpdate}
            onAddChild={handleAddChild}
            onDelete={handleDelete}
            createCanvasEngine={createCanvasEngine}
          />
        </>
      )}
    </div>
  );
}
