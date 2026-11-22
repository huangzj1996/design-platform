import type { DesignDocument, Diagnostic } from '@design-ai/design-schema';

export const OPEN_DESIGN_FILE_CHANNEL = 'design-ai:open-design-file';
export const CREATE_DESIGN_FILE_CHANNEL = 'design-ai:create-design-file';
export const SAVE_DESIGN_FILE_CHANNEL = 'design-ai:save-design-file';
export const CLOSE_REQUEST_CHANNEL = 'design-ai:close-request';
export const CONFIRM_CLOSE_CHANNEL = 'design-ai:confirm-close';

export const DesktopDiagnosticCodes = {
  fileReadError: 'file_read_error',
  fileWriteError: 'file_write_error',
  openFailed: 'open_failed',
} as const;

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

export interface DesignAiApi {
  openDesignFile(): Promise<OpenDesignFileResult>;
  createDesignFile(): Promise<CreateDesignFileResult>;
  saveDesignFile(input: SaveDesignFileInput): Promise<SaveDesignFileResult>;
  /** Registers a listener for the main process's window-close request. */
  onCloseRequest(listener: () => void): () => void;
  /** Tells the main process that pending saves finished and the close may proceed. */
  confirmClose(): void;
}
