import type { DesignDocument, Diagnostic } from '@design-ai/design-schema';

export const OPEN_DESIGN_FILE_CHANNEL = 'design-ai:open-design-file';
export const OPEN_DESIGN_FILE_PATH_CHANNEL = 'design-ai:open-design-file-path';
export const CREATE_DESIGN_FILE_CHANNEL = 'design-ai:create-design-file';
export const SAVE_DESIGN_FILE_CHANNEL = 'design-ai:save-design-file';
export const LOAD_SESSION_CHANNEL = 'design-ai:load-session';
export const SAVE_SESSION_CHANNEL = 'design-ai:save-session';
export const CLOSE_REQUEST_CHANNEL = 'design-ai:close-request';
export const CONFIRM_CLOSE_CHANNEL = 'design-ai:confirm-close';

/** Tab id of the home page in a persisted app session. */
export const HOME_SESSION_TAB = 'home';

export const DesktopDiagnosticCodes = {
  fileReadError: 'file_read_error',
  fileWriteError: 'file_write_error',
  openFailed: 'open_failed',
} as const;

export type DesktopDiagnosticCode =
  (typeof DesktopDiagnosticCodes)[keyof typeof DesktopDiagnosticCodes];

export type OpenDesignFileResult =
  | { status: 'opened'; filePath: string; document: DesignDocument }
  | {
      status: 'imported';
      sourcePath: string;
      document: DesignDocument;
      warnings: Diagnostic[];
    }
  | { status: 'cancelled' }
  | { status: 'failed'; filePath: string; errors: Diagnostic[] };

export type CreateDesignFileResult =
  | { status: 'created'; filePath: string; document: DesignDocument }
  | { status: 'failed'; errors: Diagnostic[] };

export interface SaveDesignFileInput {
  /** `null` for an imported draft that has not been written yet. */
  filePath: string | null;
  document: DesignDocument;
}

export type SaveDesignFileResult =
  | { status: 'saved'; filePath: string; fingerprint: string }
  | { status: 'skipped'; filePath: string; fingerprint: string }
  | { status: 'failed'; filePath: string | null; errors: Diagnostic[] };

/** One design the app can reopen, with the time it was last opened. */
export interface SessionProject {
  /** Native design file or the Pencil source of an imported draft. */
  filePath: string;
  /** ISO 8601 timestamp of the last time the project was opened. */
  openedAt: string;
}

/** The working position restored on the next launch. */
export interface AppSession {
  /** `home` or the file path of the active project. */
  activeTab: string;
  /** Open project tabs in tab-bar order. */
  projects: SessionProject[];
  /** Recently opened designs, most recent first. */
  recent: SessionProject[];
}

export interface DesignAiApi {
  openDesignFile(): Promise<OpenDesignFileResult>;
  /** Reads a known design file, used when restoring a previous session. */
  openDesignFileAt(filePath: string): Promise<OpenDesignFileResult>;
  createDesignFile(): Promise<CreateDesignFileResult>;
  saveDesignFile(input: SaveDesignFileInput): Promise<SaveDesignFileResult>;
  /** Reads the persisted working position. */
  loadSession(): Promise<AppSession>;
  /** Replaces the persisted working position. */
  saveSession(session: AppSession): Promise<void>;
  /** Registers a listener for the main process's window-close request. */
  onCloseRequest(listener: () => void): () => void;
  /** Tells the main process that pending saves finished and the close may proceed. */
  confirmClose(): void;
}
