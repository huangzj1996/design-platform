import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDiagnostic } from '@design-ai/design-schema';
import { createBlankDocument } from '@design-ai/editor-core';
import { errorMessage } from './error-message';
import {
  DesktopDiagnosticCodes,
  type CreateDesignFileResult,
} from '../electron-preload/contract';

const DEFAULT_FILE_BASE = '未命名';
const MAX_FILE_ATTEMPTS = 10_000;

export interface WriteTextOptions {
  encoding: 'utf8';
  /** `wx` fails instead of replacing an existing file. */
  flag?: 'wx';
}

export interface CreateFileDependencies {
  writeFile?: (
    filePath: string,
    contents: string,
    options: WriteTextOptions,
  ) => Promise<void>;
}

/**
 * Returns the `未命名`, `未命名-2`, `未命名-3` name for the given attempt,
 * where the first attempt is 1.
 */
export function defaultDesignFileName(attempt: number): string {
  return attempt <= 1
    ? `${DEFAULT_FILE_BASE}.json`
    : `${DEFAULT_FILE_BASE}-${attempt}.json`;
}

function failure(message: string): CreateDesignFileResult {
  return {
    status: 'failed',
    errors: [
      createDiagnostic(
        DesktopDiagnosticCodes.fileWriteError,
        '$',
        `无法新建设计稿文件：${message}`,
      ),
    ],
  };
}

function isFileExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'EEXIST'
  );
}

/**
 * Writes a fresh blank current-version document to the project directory. The
 * first free default name is used and an existing file is never overwritten.
 */
export async function createDesignFile(
  projectDirectory: string,
  dependencies: CreateFileDependencies = {},
): Promise<CreateDesignFileResult> {
  const write = dependencies.writeFile ?? writeFile;
  // The document snapshot stores its own file path, so resolve a relative
  // project directory to keep that path absolute.
  const targetDirectory = path.resolve(projectDirectory);

  try {
    await mkdir(targetDirectory, { recursive: true });
  } catch (error) {
    return failure(errorMessage(error));
  }

  for (let attempt = 1; attempt <= MAX_FILE_ATTEMPTS; attempt += 1) {
    const filePath = path.join(targetDirectory, defaultDesignFileName(attempt));
    const document = { ...createBlankDocument(), filePath };

    try {
      await write(filePath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
      });
      return { status: 'created', filePath, document };
    } catch (error) {
      if (isFileExists(error)) {
        continue;
      }
      return failure(errorMessage(error));
    }
  }

  return failure('项目目录中的默认文件名已全部被占用');
}
