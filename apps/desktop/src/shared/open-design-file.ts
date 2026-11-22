import type { DesignDocument, Diagnostic } from '@design-ai/design-schema';

export const OPEN_DESIGN_FILE_CHANNEL = 'design-ai:open-design-file';

export type OpenDesignFileResult =
  | { status: 'opened'; filePath: string; document: DesignDocument }
  | { status: 'cancelled' }
  | { status: 'failed'; filePath: string; errors: Diagnostic[] };

export interface DesignAiApi {
  openDesignFile(): Promise<OpenDesignFileResult>;
}
