import { readFile } from 'node:fs/promises';
import {
  createDiagnostic,
  parseDesignDocument,
} from '@design-ai/design-schema';
import { importPencilDocument } from '@design-ai/editor-core';
import { errorMessage } from '../shared/error-message';
import {
  DesktopDiagnosticCodes,
  type OpenDesignFileResult,
} from '../shared/open-design-file';

const PENCIL_FILE_EXTENSION = /\.pen$/i;

function isPencilFile(filePath: string): boolean {
  return PENCIL_FILE_EXTENSION.test(filePath);
}

/**
 * Reads a design document from disk. `.pen` files go through the Pencil 2.25
 * importer and produce a native draft plus conversion warnings; other files
 * are parsed as native documents. A failed read, import or validation never
 * writes to the file.
 */
export async function readDesignFile(
  filePath: string,
): Promise<OpenDesignFileResult> {
  let contents: string;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    return {
      status: 'failed',
      filePath,
      errors: [
        createDiagnostic(
          DesktopDiagnosticCodes.fileReadError,
          '$',
          `无法读取设计稿文件：${errorMessage(error)}`,
        ),
      ],
    };
  }

  if (isPencilFile(filePath)) {
    const result = importPencilDocument(contents);
    if (!result.ok) {
      return { status: 'failed', filePath, errors: result.errors };
    }
    return {
      status: 'imported',
      sourcePath: filePath,
      document: result.document,
      warnings: result.warnings,
    };
  }

  const result = parseDesignDocument(contents);
  if (!result.ok) {
    return { status: 'failed', filePath, errors: result.errors };
  }

  return { status: 'opened', filePath, document: result.document };
}
