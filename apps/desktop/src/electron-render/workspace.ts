import type { Diagnostic } from '@design-ai/design-schema';
import type {
  AppSession,
  CreateDesignFileResult,
  OpenDesignFileResult,
  SaveDesignFileResult,
  SessionProject,
} from '../electron-preload/contract';
import {
  applyCreateError,
  applyCreateResult,
  applyOpenError,
  applyOpenResult,
  applySaveResult,
  CREATE_FAILURE_TITLE,
  documentName,
  initialEditorState,
  OPEN_FAILURE_TITLE,
  setPendingAction,
  type EditorState,
  type PendingAction,
} from './editor-state';

/** Id of the home tab; the persisted session stores the same marker. */
export const HOME_TAB_ID = 'home';
const NEW_CHAT_TAB_LABEL = '新建聊天';
/** Matches the session store's cap so both keep the same list size. */
const MAX_RECENT_PROJECTS = 20;

/** One open design document and its tab in the top bar. */
export interface ProjectTab {
  id: string;
  /** Created designs start as 新建聊天 until reopened under their file name. */
  label: string;
  /** ISO time this project was last opened or selected. */
  openedAt: string;
  state: EditorState;
}

export interface WorkspaceState {
  /** `home` or the id of the active project tab. */
  activeTabId: string;
  projects: ProjectTab[];
  nextProjectNumber: number;
  /** Designs opened by the user, most recent first, for the home page. */
  recent: SessionProject[];
  /** Failures shown on the home page, where no project state exists. */
  homeDiagnostics: Diagnostic[];
  homeDiagnosticsTitle: string;
}

export const initialWorkspaceState: WorkspaceState = {
  activeTabId: HOME_TAB_ID,
  projects: [],
  nextProjectNumber: 1,
  recent: [],
  homeDiagnostics: [],
  homeDiagnosticsTitle: OPEN_FAILURE_TITLE,
};

export const emptySession: AppSession = {
  activeTab: HOME_TAB_ID,
  projects: [],
  recent: [],
};

export function hasSessionContent(session: AppSession): boolean {
  return session.projects.length > 0 || session.recent.length > 0;
}

function openedNow(): string {
  return new Date().toISOString();
}

/** Moves a design to the front of the recent list with its new open time. */
export function recordRecent(
  recent: SessionProject[],
  filePath: string,
  openedAt: string,
): SessionProject[] {
  return [
    { filePath, openedAt },
    ...recent.filter((record) => record.filePath !== filePath),
  ].slice(0, MAX_RECENT_PROJECTS);
}

/** Rebuilds the project tabs and recent list persisted by the previous run. */
export function restoreWorkspace(session: AppSession): WorkspaceState {
  const projects = session.projects.map(
    (record, index): ProjectTab => ({
      id: `project-${index + 1}`,
      label: documentName(record.filePath),
      openedAt: record.openedAt,
      // The document stays unloaded until the user selects the tab.
      state: { ...initialEditorState, filePath: record.filePath },
    }),
  );
  const active = projects.find(
    (project) => project.state.filePath === session.activeTab,
  );

  return {
    activeTabId: active?.id ?? HOME_TAB_ID,
    projects,
    nextProjectNumber: projects.length + 1,
    recent: mergeRecent(session),
    homeDiagnostics: [],
    homeDiagnosticsTitle: OPEN_FAILURE_TITLE,
  };
}

function mergeRecent(session: AppSession): SessionProject[] {
  const records = [...session.recent];
  for (const project of session.projects) {
    if (!records.some((record) => record.filePath === project.filePath)) {
      records.push(project);
    }
  }
  return records
    .sort(
      (left, right) => Date.parse(right.openedAt) - Date.parse(left.openedAt),
    )
    .slice(0, MAX_RECENT_PROJECTS);
}

/** The session snapshot written on close and after workspace changes. */
export function workspaceToSession(workspace: WorkspaceState): AppSession {
  const active = activeProjectOf(workspace);
  return {
    activeTab:
      active === null ? HOME_TAB_ID : (projectPath(active) ?? HOME_TAB_ID),
    projects: workspace.projects.flatMap((project) => {
      const filePath = projectPath(project);
      return filePath === null
        ? []
        : [{ filePath, openedAt: project.openedAt }];
    }),
    recent: workspace.recent,
  };
}

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

/** Appends a project tab, selects it and clears any home diagnostics. */
function addProject(
  workspace: WorkspaceState,
  label: string,
  state: EditorState,
  openedAt = openedNow(),
): WorkspaceState {
  const id = `project-${workspace.nextProjectNumber}`;
  const filePath = state.filePath ?? state.sourcePath;
  return {
    ...workspace,
    activeTabId: id,
    nextProjectNumber: workspace.nextProjectNumber + 1,
    recent:
      filePath === null
        ? workspace.recent
        : recordRecent(workspace.recent, filePath, openedAt),
    homeDiagnostics: [],
    projects: [...workspace.projects, { id, label, openedAt, state }],
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

/** Loads a document into an existing tab and makes it the active one. */
function applyOpenToTab(
  workspace: WorkspaceState,
  projectId: string,
  result: Extract<OpenDesignFileResult, { status: 'opened' | 'imported' }>,
  filePath: string,
): WorkspaceState {
  const openedAt = openedNow();
  return {
    ...replaceProject(workspace, projectId, (project) => ({
      ...project,
      label: documentName(filePath),
      openedAt,
      state: applyOpenResult(project.state, result),
    })),
    activeTabId: projectId,
    recent: recordRecent(workspace.recent, filePath, openedAt),
    homeDiagnostics: [],
  };
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
    return applyOpenToTab(workspace, existing.id, result, filePath);
  }

  return addProject(
    workspace,
    documentName(filePath),
    applyOpenResult(initialEditorState, result),
  );
}

/** Applies a create result; a new design always gets its own 新建聊天 tab. */
export function applyCreateToWorkspace(
  workspace: WorkspaceState,
  result: CreateDesignFileResult,
): WorkspaceState {
  if (result.status === 'failed') {
    return withDiagnostics(workspace, result.errors, CREATE_FAILURE_TITLE);
  }

  return addProject(
    workspace,
    NEW_CHAT_TAB_LABEL,
    applyCreateResult(initialEditorState, result),
  );
}

/**
 * Applies a successful save to the active project. The first save of an
 * imported draft moves the tab from the Pencil source name to the assigned
 * file name.
 */
export function applySaveToActiveProject(
  workspace: WorkspaceState,
  result: Extract<SaveDesignFileResult, { status: 'saved' | 'skipped' }>,
  savedVersion: number,
): WorkspaceState {
  const project = activeProjectOf(workspace);
  if (project === null) {
    return workspace;
  }
  return replaceProject(workspace, project.id, (active) => ({
    ...active,
    label:
      active.state.filePath === null
        ? documentName(result.filePath)
        : active.label,
    state: applySaveResult(active.state, result, savedVersion),
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
  const filePath = projectPath(project);
  const openedAt = openedNow();
  return {
    ...replaceProject(workspace, project.id, (candidate) => ({
      ...candidate,
      label: fileName ?? candidate.label,
      openedAt,
    })),
    activeTabId: project.id,
    recent:
      filePath === null
        ? workspace.recent
        : recordRecent(workspace.recent, filePath, openedAt),
    homeDiagnostics: [],
  };
}

export function showHome(workspace: WorkspaceState): WorkspaceState {
  return { ...workspace, activeTabId: HOME_TAB_ID, homeDiagnostics: [] };
}

/** Shows restore failures on the home page, where the user can retry a file. */
export function showHomeWithDiagnostics(
  workspace: WorkspaceState,
  diagnostics: Diagnostic[],
  title: string,
): WorkspaceState {
  return {
    ...workspace,
    activeTabId: HOME_TAB_ID,
    homeDiagnostics: diagnostics,
    homeDiagnosticsTitle: title,
  };
}

export function showHomeOpenError(
  workspace: WorkspaceState,
  error: unknown,
): WorkspaceState {
  const failed = applyOpenError(initialEditorState, error);
  return showHomeWithDiagnostics(
    workspace,
    failed.diagnostics,
    failed.diagnosticsTitle,
  );
}

/**
 * Loads a restored project into its own tab. A missing or invalid target
 * returns to home so the reason is visible there.
 */
export function applyOpenToProject(
  workspace: WorkspaceState,
  projectId: string,
  result: OpenDesignFileResult,
): WorkspaceState {
  if (result.status === 'cancelled') {
    return workspace;
  }
  if (result.status === 'failed') {
    return showHomeWithDiagnostics(
      workspace,
      result.errors,
      OPEN_FAILURE_TITLE,
    );
  }
  const project = workspace.projects.find(
    (candidate) => candidate.id === projectId,
  );
  if (project === undefined) {
    return workspace;
  }

  const filePath =
    result.status === 'opened' ? result.filePath : result.sourcePath;
  return applyOpenToTab(workspace, projectId, result, filePath);
}
