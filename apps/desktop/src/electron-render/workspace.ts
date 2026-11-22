import type { Diagnostic } from '@design-ai/design-schema';
import type {
  CreateDesignFileResult,
  OpenDesignFileResult,
  SaveDesignFileResult,
} from '../electron-preload/contract';
import {
  applyCreateError,
  applyCreateResult,
  applyOpenError,
  applyOpenResult,
  applySaveResult,
  documentName,
  initialEditorState,
  setPendingAction,
  type EditorState,
  type PendingAction,
} from './editor-state';

export const HOME_TAB_ID = 'home';
export const NEW_CHAT_TAB_LABEL = '新建聊天';

const OPEN_FAILURE_TITLE = '无法打开设计稿';
const CREATE_FAILURE_TITLE = '无法新建设计稿';

/** One open design document and its tab in the top bar. */
export interface ProjectTab {
  id: string;
  /** Created designs start as 新建聊天 until reopened under their file name. */
  label: string;
  state: EditorState;
}

export interface WorkspaceState {
  /** `home` or the id of the active project tab. */
  activeTabId: string;
  projects: ProjectTab[];
  nextProjectNumber: number;
  /** Failures shown on the home page, where no project state exists. */
  homeDiagnostics: Diagnostic[];
  homeDiagnosticsTitle: string;
}

export const initialWorkspaceState: WorkspaceState = {
  activeTabId: HOME_TAB_ID,
  projects: [],
  nextProjectNumber: 1,
  homeDiagnostics: [],
  homeDiagnosticsTitle: OPEN_FAILURE_TITLE,
};

export function activeProjectOf(workspace: WorkspaceState): ProjectTab | null {
  return (
    workspace.projects.find(
      (project) => project.id === workspace.activeTabId,
    ) ?? null
  );
}

/** File that identifies the project, whether native or imported. */
export function projectPath(project: ProjectTab): string | null {
  return project.state.filePath ?? project.state.sourcePath;
}

export function projectFileName(project: ProjectTab): string | null {
  const filePath = projectPath(project);
  return filePath === null ? null : documentName(filePath);
}

function replaceProject(
  workspace: WorkspaceState,
  projectId: string,
  update: (project: ProjectTab) => ProjectTab,
): WorkspaceState {
  return {
    ...workspace,
    projects: workspace.projects.map((project) =>
      project.id === projectId ? update(project) : project,
    ),
  };
}

export function updateProjectState(
  workspace: WorkspaceState,
  projectId: string,
  update: (state: EditorState) => EditorState,
): WorkspaceState {
  return replaceProject(workspace, projectId, (project) => ({
    ...project,
    state: update(project.state),
  }));
}

export function setPendingActionForActive(
  workspace: WorkspaceState,
  action: PendingAction | null,
): WorkspaceState {
  return updateProjectState(workspace, workspace.activeTabId, (state) =>
    setPendingAction(state, action),
  );
}

/** Shows diagnostics on the home page or on the active design. */
function withDiagnostics(
  workspace: WorkspaceState,
  diagnostics: Diagnostic[],
  title: string,
): WorkspaceState {
  if (workspace.activeTabId === HOME_TAB_ID) {
    return {
      ...workspace,
      homeDiagnostics: diagnostics,
      homeDiagnosticsTitle: title,
    };
  }
  return updateProjectState(workspace, workspace.activeTabId, (state) => ({
    ...state,
    diagnostics,
    diagnosticsTitle: title,
  }));
}

export function applyOpenErrorToWorkspace(
  workspace: WorkspaceState,
  error: unknown,
): WorkspaceState {
  const failed = applyOpenError(initialEditorState, error);
  return withDiagnostics(
    workspace,
    failed.diagnostics,
    failed.diagnosticsTitle,
  );
}

export function applyCreateErrorToWorkspace(
  workspace: WorkspaceState,
  error: unknown,
): WorkspaceState {
  const failed = applyCreateError(initialEditorState, error);
  return withDiagnostics(
    workspace,
    failed.diagnostics,
    failed.diagnosticsTitle,
  );
}

/**
 * Applies an open result. A file already open in a tab reloads that tab and
 * selects it, updating a created design's 新建聊天 label to its file name.
 */
export function applyOpenToWorkspace(
  workspace: WorkspaceState,
  result: OpenDesignFileResult,
): WorkspaceState {
  if (result.status === 'cancelled') {
    return workspace;
  }
  if (result.status === 'failed') {
    return withDiagnostics(workspace, result.errors, OPEN_FAILURE_TITLE);
  }

  const filePath =
    result.status === 'opened' ? result.filePath : result.sourcePath;
  const existing = workspace.projects.find(
    (project) =>
      project.state.filePath === filePath ||
      project.state.sourcePath === filePath,
  );

  if (existing !== undefined) {
    return {
      ...workspace,
      activeTabId: existing.id,
      homeDiagnostics: [],
      projects: workspace.projects.map((project) =>
        project.id === existing.id
          ? {
              ...project,
              label: documentName(filePath),
              state: applyOpenResult(project.state, result),
            }
          : project,
      ),
    };
  }

  const id = `project-${workspace.nextProjectNumber}`;
  return {
    ...workspace,
    activeTabId: id,
    nextProjectNumber: workspace.nextProjectNumber + 1,
    homeDiagnostics: [],
    projects: [
      ...workspace.projects,
      {
        id,
        label: documentName(filePath),
        state: applyOpenResult(initialEditorState, result),
      },
    ],
  };
}

/** Applies a create result; a new design always gets its own 新建聊天 tab. */
export function applyCreateToWorkspace(
  workspace: WorkspaceState,
  result: CreateDesignFileResult,
): WorkspaceState {
  if (result.status === 'failed') {
    return withDiagnostics(workspace, result.errors, CREATE_FAILURE_TITLE);
  }

  const id = `project-${workspace.nextProjectNumber}`;
  return {
    ...workspace,
    activeTabId: id,
    nextProjectNumber: workspace.nextProjectNumber + 1,
    homeDiagnostics: [],
    projects: [
      ...workspace.projects,
      {
        id,
        label: NEW_CHAT_TAB_LABEL,
        state: applyCreateResult(initialEditorState, result),
      },
    ],
  };
}

/**
 * Applies a successful save to its project. The first save of an imported
 * draft moves the tab from the Pencil source name to the assigned file name.
 */
export function applySaveToProject(
  workspace: WorkspaceState,
  projectId: string,
  result: Extract<SaveDesignFileResult, { status: 'saved' | 'skipped' }>,
  savedVersion: number,
): WorkspaceState {
  return replaceProject(workspace, projectId, (project) => ({
    ...project,
    label:
      project.state.filePath === null
        ? documentName(result.filePath)
        : project.label,
    state: applySaveResult(project.state, result, savedVersion),
  }));
}

/** Selects a tab; from home, a created design adopts its actual file name. */
export function activateProjectTab(
  workspace: WorkspaceState,
  projectId: string,
  options: { preferFileName?: boolean } = {},
): WorkspaceState {
  const project = workspace.projects.find(
    (candidate) => candidate.id === projectId,
  );
  if (project === undefined) {
    return workspace;
  }
  const fileName = options.preferFileName ? projectFileName(project) : null;
  return {
    ...workspace,
    activeTabId: project.id,
    homeDiagnostics: [],
    projects: workspace.projects.map((candidate) =>
      candidate.id === project.id
        ? { ...candidate, label: fileName ?? candidate.label }
        : candidate,
    ),
  };
}

export function showHome(workspace: WorkspaceState): WorkspaceState {
  return { ...workspace, activeTabId: HOME_TAB_ID, homeDiagnostics: [] };
}
