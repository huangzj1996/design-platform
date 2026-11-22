import {
  createDiagnostic,
  type DesignDocument,
  type Diagnostic,
} from '@design-ai/design-schema';
import { useCallback, useEffect, useRef } from 'react';
import { errorMessage } from '../shared/error-message';
import type {
  SaveDesignFileInput,
  SaveDesignFileResult,
} from '../shared/open-design-file';

export const DEFAULT_SAVE_DELAY_MS = 2000;

export type FlushResult = 'idle' | 'saved' | 'skipped' | 'failed';

export interface AutosaveOptions {
  document: DesignDocument | null;
  filePath: string | null;
  dirty: boolean;
  /** Changes whenever a persistent edit is applied. */
  editVersion: number;
  saveDesignFile: (input: SaveDesignFileInput) => Promise<SaveDesignFileResult>;
  onSaving: () => void;
  onSaved: (
    result: Extract<SaveDesignFileResult, { status: 'saved' | 'skipped' }>,
    savedVersion: number,
  ) => void;
  onFailed: (errors: Diagnostic[]) => void;
  delayMs?: number;
}

interface Autosave {
  /** Saves the latest snapshot now, waiting for any write in flight. */
  flush: () => Promise<FlushResult>;
}

/**
 * Debounces persistent document edits and serializes saves. A selection
 * change does not start a save; restoring the saved content still reaches the
 * main process, where the fingerprint comparison skips the write.
 */
export function useAutosave(options: AutosaveOptions): Autosave {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chainRef = useRef<Promise<FlushResult>>(Promise.resolve('idle'));

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const saveLatest = useCallback(async (): Promise<FlushResult> => {
    clearTimer();
    let lastResult: FlushResult = 'idle';

    for (;;) {
      const current = optionsRef.current;
      if (current.document === null || !current.dirty) {
        return lastResult;
      }

      const savedVersion = current.editVersion;
      current.onSaving();
      let result: SaveDesignFileResult;
      try {
        result = await current.saveDesignFile({
          filePath: current.filePath,
          document: current.document,
        });
      } catch (error) {
        optionsRef.current.onFailed([
          createDiagnostic(
            'save_failed',
            '$',
            `保存设计稿失败：${errorMessage(error)}`,
          ),
        ]);
        return 'failed';
      }

      if (result.status === 'failed') {
        optionsRef.current.onFailed(result.errors);
        return 'failed';
      }

      optionsRef.current.onSaved(result, savedVersion);
      lastResult = result.status;

      // Let React commit the save result so an edit that arrived during the
      // write is visible as a newer version. Close and switch only complete
      // after the latest content is saved.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      const latest = optionsRef.current;
      if (
        latest.document === null ||
        !latest.dirty ||
        latest.editVersion <= savedVersion
      ) {
        return lastResult;
      }
    }
  }, [clearTimer]);

  const flush = useCallback((): Promise<FlushResult> => {
    clearTimer();
    const next = chainRef.current.then(saveLatest);
    chainRef.current = next.catch((): FlushResult => 'failed');
    return next;
  }, [clearTimer, saveLatest]);

  useEffect(() => {
    if (!options.dirty || options.document === null) {
      clearTimer();
      return;
    }

    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void flush();
    }, options.delayMs ?? DEFAULT_SAVE_DELAY_MS);

    return clearTimer;
  }, [
    clearTimer,
    flush,
    options.delayMs,
    options.dirty,
    // Track only "has a document" so a save result updating the document does
    // not restart the debounce timer.
    options.document === null,
    options.editVersion,
  ]);

  return { flush };
}
