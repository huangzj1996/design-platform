import { rename, unlink, writeFile } from 'node:fs/promises';
import {
  createDiagnostic,
  type DesignDocument,
  type Diagnostic,
} from '@design-ai/design-schema/legacy';
import { errorMessage } from './error-message';
import {
  DesktopDiagnosticCodes,
  type SaveDesignFileInput,
  type SaveDesignFileResult,
} from '../electron-preload/contract';
import { createDesignFile, type WriteTextOptions } from './create-design-file';
import { canonicalizeJson, fingerprintSnapshot } from './fingerprint';

export interface SaveFileDependencies {
  writeFile?: (
    filePath: string,
    contents: string,
    options: WriteTextOptions,
  ) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
  unlink?: (filePath: string) => Promise<void>;
  /** Allocates a fresh target for an imported draft with no path yet. */
  allocatePath?: () => Promise<string>;
}

export interface DesignFileSaverOptions {
  /** Directory where unsaved drafts receive a default file name. */
  projectDirectory: string;
  dependencies?: SaveFileDependencies;
}

interface PendingSave {
  filePath: string | null;
  document: DesignDocument;
  resolvers: Array<(result: SaveDesignFileResult) => void>;
}

interface PathQueue {
  writing: boolean;
  pending: PendingSave | null;
  /** Assigned target reused by further saves of the same draft. */
  draftPath: string | null;
}

const DRAFT_KEY = '\u0000draft';

function failedResult(
  filePath: string | null,
  error: unknown,
): SaveDesignFileResult {
  const errors: Diagnostic[] = [
    createDiagnostic(
      DesktopDiagnosticCodes.fileWriteError,
      '$',
      `无法写入设计稿文件：${errorMessage(error)}`,
    ),
  ];
  return { status: 'failed', filePath, errors };
}

function withTargetPath(
  document: DesignDocument,
  filePath: string,
): DesignDocument {
  return { ...document, filePath };
}

/**
 * Owns saved-snapshot fingerprints and per-path write queues. A snapshot is
 * only written when its canonical fingerprint differs from the most recent
 * successful write or the snapshot read from disk. Writes to the same path are
 * serialized; changes queued during a write collapse into the latest snapshot.
 */
export class DesignFileSaver {
  private readonly projectDirectory: string;
  private readonly write: NonNullable<SaveFileDependencies['writeFile']>;
  private readonly move: NonNullable<SaveFileDependencies['rename']>;
  private readonly remove: NonNullable<SaveFileDependencies['unlink']>;
  private readonly allocate: () => Promise<string>;
  private readonly savedFingerprints = new Map<string, string>();
  private readonly queues = new Map<string, PathQueue>();
  private tempCounter = 0;

  constructor(options: DesignFileSaverOptions) {
    this.projectDirectory = options.projectDirectory;
    this.write = options.dependencies?.writeFile ?? writeFile;
    this.move = options.dependencies?.rename ?? rename;
    this.remove = options.dependencies?.unlink ?? unlink;
    this.allocate =
      options.dependencies?.allocatePath ??
      (async () => {
        const created = await createDesignFile(this.projectDirectory);
        if (created.status !== 'created') {
          throw new Error(created.errors[0]?.message ?? '无法分配保存路径');
        }
        return created.filePath;
      });
  }

  /**
   * Establishes the saved fingerprint for a document read from disk. The
   * target path is part of the snapshot, matching what a later save writes.
   */
  rememberSaved(filePath: string, document: DesignDocument): void {
    this.savedFingerprints.set(
      filePath,
      fingerprintSnapshot(withTargetPath(document, filePath)),
    );
  }

  /**
   * Requests a save. Saves for the same design file are serialized and merged,
   * so concurrent requests never write in parallel.
   */
  save(input: SaveDesignFileInput): Promise<SaveDesignFileResult> {
    const key = input.filePath ?? DRAFT_KEY;
    const queue = this.queueFor(key);
    const pending = queue.pending ?? {
      filePath: input.filePath,
      document: input.document,
      resolvers: [],
    };
    // A newer request supersedes the queued snapshot; every caller is resolved
    // by the write that persists the latest content.
    pending.filePath = input.filePath ?? pending.filePath;
    pending.document = input.document;
    queue.pending = pending;

    const result = new Promise<SaveDesignFileResult>((resolve) => {
      pending.resolvers.push(resolve);
    });
    void this.drain(key);
    return result;
  }

  private queueFor(key: string): PathQueue {
    let queue = this.queues.get(key);
    if (queue === undefined) {
      queue = { writing: false, pending: null, draftPath: null };
      this.queues.set(key, queue);
    }
    return queue;
  }

  private takePending(queue: PathQueue): PendingSave | null {
    const pending = queue.pending;
    queue.pending = null;
    return pending;
  }

  private async drain(key: string): Promise<void> {
    const queue = this.queueFor(key);
    if (queue.writing) {
      return;
    }
    queue.writing = true;

    try {
      let pending = this.takePending(queue);
      while (pending !== null) {
        const result = await this.persist(pending, queue);
        for (const resolve of pending.resolvers) {
          resolve(result);
        }

        if (result.status === 'failed') {
          // A failed write keeps the last complete file and its fingerprint.
          // Newer queued changes wait for the explicit retry entry instead of
          // retrying silently.
          const waiting = this.takePending(queue);
          if (waiting !== null) {
            for (const resolve of waiting.resolvers) {
              resolve(result);
            }
          }
          break;
        }

        pending = this.takePending(queue);
      }
    } finally {
      queue.writing = false;
    }
  }

  private async persist(
    pending: PendingSave,
    queue: PathQueue,
  ): Promise<SaveDesignFileResult> {
    let filePath = pending.filePath;
    if (filePath === null) {
      if (queue.draftPath === null) {
        try {
          queue.draftPath = await this.allocate();
        } catch (error) {
          return failedResult(null, error);
        }
      }
      filePath = queue.draftPath;
    }

    const snapshot = withTargetPath(pending.document, filePath);
    const fingerprint = fingerprintSnapshot(snapshot);
    if (this.savedFingerprints.get(filePath) === fingerprint) {
      return { status: 'skipped', filePath, fingerprint };
    }

    const contents = canonicalizeJson(snapshot);
    const tempPath = `${filePath}.${process.pid}.${this.tempCounter}.tmp`;
    this.tempCounter += 1;

    try {
      await this.write(tempPath, contents, { encoding: 'utf8' });
      await this.move(tempPath, filePath);
    } catch (error) {
      try {
        await this.remove(tempPath);
      } catch {
        // The temporary file may not exist; the original target is untouched.
      }
      return failedResult(filePath, error);
    }

    this.savedFingerprints.set(filePath, fingerprint);
    return { status: 'saved', filePath, fingerprint };
  }
}
