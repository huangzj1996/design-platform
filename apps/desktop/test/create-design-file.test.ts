import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateDesignDocument } from '@design-ai/design-schema/legacy';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDesignFile } from '../src/electron-main/create-design-file';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'design-ai-create-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('createDesignFile', () => {
  it('writes a valid blank document with the default name immediately', async () => {
    const result = await createDesignFile(directory);

    expect(result.status).toBe('created');
    if (result.status !== 'created') {
      return;
    }
    expect(result.filePath).toBe(path.join(directory, '未命名.json'));
    expect(result.document).toMatchObject({
      version: 1,
      children: [],
      variables: {},
      filePath: result.filePath,
    });
    expect(validateDesignDocument(result.document).ok).toBe(true);

    const written = JSON.parse(await readFile(result.filePath, 'utf8')) as {
      version: number;
      filePath: string;
      children: unknown[];
      variables: unknown;
    };
    expect(written.version).toBe(1);
    expect(written.filePath).toBe(result.filePath);
    expect(written.children).toEqual([]);
    expect(written.variables).toEqual({});
  });

  it('uses the next free default name and keeps existing files intact', async () => {
    const first = await createDesignFile(directory);
    const second = await createDesignFile(directory);
    const third = await createDesignFile(directory);

    expect(first.status).toBe('created');
    expect(second.status).toBe('created');
    expect(third.status).toBe('created');
    if (
      second.status !== 'created' ||
      third.status !== 'created' ||
      first.status !== 'created'
    ) {
      return;
    }
    expect(path.basename(second.filePath)).toBe('未命名-2.json');
    expect(path.basename(third.filePath)).toBe('未命名-3.json');

    const firstContents = await readFile(first.filePath, 'utf8');
    expect(JSON.parse(firstContents).filePath).toBe(first.filePath);
    await expect(readFile(second.filePath, 'utf8')).resolves.toContain(
      second.filePath,
    );
  });

  it('records an absolute target path when the project directory is relative', async () => {
    const relativeDirectory = path.relative(process.cwd(), directory);

    const result = await createDesignFile(relativeDirectory);

    expect(result.status).toBe('created');
    if (result.status !== 'created') {
      return;
    }
    expect(path.isAbsolute(result.filePath)).toBe(true);
    expect(result.filePath).toBe(path.join(directory, '未命名.json'));
    const written = JSON.parse(await readFile(result.filePath, 'utf8')) as {
      filePath: string;
    };
    expect(written.filePath).toBe(result.filePath);
  });

  it('creates the project directory when it does not exist', async () => {
    const projectDirectory = path.join(directory, 'nested', 'project');

    const result = await createDesignFile(projectDirectory);

    expect(result.status).toBe('created');
    if (result.status === 'created') {
      await expect(readFile(result.filePath, 'utf8')).resolves.toContain(
        '未命名',
      );
    }
  });

  it('skips a default name that is already occupied', async () => {
    const occupied = path.join(directory, '未命名.json');
    await writeFile(occupied, 'occupied', 'utf8');

    const result = await createDesignFile(directory);

    expect(result.status).toBe('created');
    if (result.status === 'created') {
      expect(path.basename(result.filePath)).toBe('未命名-2.json');
      await expect(readFile(occupied, 'utf8')).resolves.toBe('occupied');
    }
  });

  it('reports a create failure with code, path and message', async () => {
    const result = await createDesignFile(directory, {
      writeFile: () => {
        throw new Error('磁盘不可写');
      },
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errors[0]).toMatchObject({
        code: 'file_write_error',
        path: '$',
      });
      expect(result.errors[0]?.message).toContain('磁盘不可写');
    }
  });
});
