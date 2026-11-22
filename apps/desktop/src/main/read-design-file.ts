import { readFile } from 'node:fs/promises';
import { parseDesignDocument } from '@design-ai/design-schema';
import type { OpenDesignFileResult } from '../shared/open-design-file';

/**
 * Reads a native design document from disk and validates it. A failed read or
 * a failed validation never writes to the file.
 */
export async function readDesignFile(
  filePath: string,
): Promise<OpenDesignFileResult> {
  let contents: string;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'failed',
      filePath,
      errors: [
        {
          code: 'file_read_error',
          path: '$',
          message: `无法读取设计稿文件：${message}`,
        },
      ],
    };
  }

  const result = parseDesignDocument(contents);
  if (!result.ok) {
    return { status: 'failed', filePath, errors: result.errors };
  }

  return { status: 'opened', filePath, document: result.document };
}
