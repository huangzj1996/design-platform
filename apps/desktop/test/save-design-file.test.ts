import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  validateDesignDocument,
  type DesignDocument,
} from '@design-ai/design-schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DesignFileSaver,
  type SaveFileDependencies,
} from '../src/main/save-design-file';
import { fingerprintSnapshot } from '../src/main/fingerprint';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'design-ai-save-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function documentWithText(text: string): DesignDocument {
  const result = validateDesignDocument({
    version: 1,
    children: [{ id: 'title', type: 'text', text }],
  });
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.document;
}

describe('DesignFileSaver', () => {
  it('writes the snapshot with its target path and skips an unchanged snapshot', async () => {
    const saver = new DesignFileSaver({ projectDirectory: directory });
    const filePath = path.join(directory, 'design.json');
    const document = documentWithText('第一版');

    const first = await saver.save({ filePath, document });
    expect(first.status).toBe('saved');
    if (first.status !== 'saved') {
      return;
    }
    expect(first.filePath).toBe(filePath);
    expect(first.fingerprint).toBe(
      fingerprintSnapshot({ ...document, filePath }),
    );

    const saved = JSON.parse(await readFile(filePath, 'utf8')) as {
      filePath: string;
    };
    expect(saved.filePath).toBe(filePath);

    const second = await saver.save({ filePath, document });
    expect(second.status).toBe('skipped');
  });

  it('writes a changed snapshot and detects restored content', async () => {
    const saver = new DesignFileSaver({ projectDirectory: directory });
    const filePath = path.join(directory, 'design.json');
    const original = documentWithText('原文案');
    const changed = documentWithText('新文案');

    await expect(
      saver.save({ filePath, document: original }),
    ).resolves.toMatchObject({ status: 'saved' });
    await expect(
      saver.save({ filePath, document: changed }),
    ).resolves.toMatchObject({ status: 'saved' });
    await expect(
      saver.save({ filePath, document: changed }),
    ).resolves.toMatchObject({ status: 'skipped' });
  });

  it('uses the snapshot read from disk as the saved baseline', async () => {
    const saver = new DesignFileSaver({ projectDirectory: directory });
    const filePath = path.join(directory, 'opened.json');
    const document = documentWithText('已打开');
    await writeFile(
      filePath,
      JSON.stringify({ ...document, filePath: '/another/location.json' }),
      'utf8',
    );

    saver.rememberSaved(filePath, document);

    await expect(saver.save({ filePath, document })).resolves.toMatchObject({
      status: 'skipped',
    });
  });

  it('fingerprints the same path-bearing snapshot that it writes and updates the baseline', async () => {
    const saver = new DesignFileSaver({ projectDirectory: directory });
    const filePath = path.join(directory, 'moved', 'design.json');
    await mkdir(path.dirname(filePath), { recursive: true });
    const stalePath = path.join(directory, 'original.json');
    const document = { ...documentWithText('移动后'), filePath: stalePath };
    const changed = {
      ...documentWithText('移动后新内容'),
      filePath: stalePath,
    };

    const first = await saver.save({ filePath, document });
    expect(first.status).toBe('saved');
    if (first.status !== 'saved') {
      return;
    }

    // The write target and the snapshot path agree, and the fingerprint covers
    // exactly the snapshot that landed on disk.
    const written = JSON.parse(await readFile(filePath, 'utf8'));
    expect(written.filePath).toBe(filePath);
    expect(first.fingerprint).toBe(fingerprintSnapshot(written));

    // The successful write becomes the new baseline for the moved target, so
    // the stale in-memory path alone does not cause another write.
    await expect(saver.save({ filePath, document })).resolves.toMatchObject({
      status: 'skipped',
    });
    await expect(
      saver.save({ filePath, document: changed }),
    ).resolves.toMatchObject({ status: 'saved' });
    const updated = JSON.parse(await readFile(filePath, 'utf8')) as {
      filePath: string;
      children: Array<{ text: string }>;
    };
    expect(updated.filePath).toBe(filePath);
    expect(updated.children[0]?.text).toBe('移动后新内容');
  });

  it('assigns a default path to an unsaved draft and reuses it afterwards', async () => {
    const saver = new DesignFileSaver({ projectDirectory: directory });
    const document = documentWithText('草稿');

    const first = await saver.save({ filePath: null, document });
    expect(first.status).toBe('saved');
    if (first.status !== 'saved') {
      return;
    }
    expect(path.isAbsolute(first.filePath)).toBe(true);
    expect(path.basename(first.filePath)).toBe('未命名.json');

    const saved = JSON.parse(await readFile(first.filePath, 'utf8')) as {
      filePath: string;
    };
    expect(saved.filePath).toBe(first.filePath);

    await expect(
      saver.save({ filePath: first.filePath, document }),
    ).resolves.toMatchObject({ status: 'skipped' });
  });

  it('serializes writes and merges queued changes into the latest snapshot', async () => {
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    let releaseFirstWrite: () => void = () => {};
    const firstWriteGate = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    let writeCount = 0;
    let firstWriteStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      firstWriteStarted = resolve;
    });

    const dependencies: SaveFileDependencies = {
      writeFile: async (target, contents, options) => {
        activeWrites += 1;
        maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
        writeCount += 1;
        if (writeCount === 1) {
          firstWriteStarted();
          await firstWriteGate;
        }
        try {
          await writeFile(target, contents, options);
        } finally {
          activeWrites -= 1;
        }
      },
    };
    const saver = new DesignFileSaver({
      projectDirectory: directory,
      dependencies,
    });
    const filePath = path.join(directory, 'serial.json');
    const first = documentWithText('第一次');
    const second = documentWithText('第二次');
    const third = documentWithText('第三次');

    const firstSave = saver.save({ filePath, document: first });
    await started;
    const secondSave = saver.save({ filePath, document: second });
    const thirdSave = saver.save({ filePath, document: third });

    expect(writeCount).toBe(1);
    releaseFirstWrite();
    await expect(firstSave).resolves.toMatchObject({ status: 'saved' });
    await expect(secondSave).resolves.toMatchObject({ status: 'saved' });
    await expect(thirdSave).resolves.toMatchObject({ status: 'saved' });

    expect(maximumActiveWrites).toBe(1);
    expect(writeCount).toBe(2);
    const saved = JSON.parse(await readFile(filePath, 'utf8')) as {
      children: Array<{ text: string }>;
    };
    expect(saved.children[0]?.text).toBe('第三次');
  });

  it('keeps the last complete file and saved baseline when a write fails, then retries', async () => {
    let failWrites = false;
    const dependencies: SaveFileDependencies = {
      writeFile: async (target, contents, options) => {
        if (failWrites) {
          throw new Error('磁盘已满');
        }
        await writeFile(target, contents, options);
      },
    };
    const saver = new DesignFileSaver({
      projectDirectory: directory,
      dependencies,
    });
    const filePath = path.join(directory, 'failure.json');
    const original = documentWithText('稳定版本');
    const changed = documentWithText('待保存版本');

    await saver.save({ filePath, document: original });

    failWrites = true;
    const failed = await saver.save({ filePath, document: changed });
    expect(failed.status).toBe('failed');
    if (failed.status === 'failed') {
      expect(failed.errors[0]).toMatchObject({
        code: 'file_write_error',
        path: '$',
      });
      expect(failed.errors[0]?.message).toContain('磁盘已满');
    }

    const onDisk = JSON.parse(await readFile(filePath, 'utf8')) as {
      children: Array<{ text: string }>;
    };
    expect(onDisk.children[0]?.text).toBe('稳定版本');

    failWrites = false;
    await expect(
      saver.save({ filePath, document: changed }),
    ).resolves.toMatchObject({ status: 'saved' });
    const retried = JSON.parse(await readFile(filePath, 'utf8')) as {
      children: Array<{ text: string }>;
    };
    expect(retried.children[0]?.text).toBe('待保存版本');
  });
});
