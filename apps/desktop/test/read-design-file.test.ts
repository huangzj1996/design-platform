import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDesignFile } from '../src/main/read-design-file';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'design-ai-open-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function writeText(name: string, contents: string): Promise<string> {
  const filePath = path.join(directory, name);
  await writeFile(filePath, contents, 'utf8');
  return filePath;
}

async function writeJson(name: string, value: unknown): Promise<string> {
  return writeText(name, JSON.stringify(value));
}

const frameWithText = {
  version: 1,
  children: [
    {
      id: 'frame-main',
      type: 'frame',
      layout: 'vertical',
      width: 640,
      height: 480,
      children: [
        { id: 'title', type: 'text', text: '设计标题' },
        { id: 'caption', type: 'text', text: '说明文字' },
      ],
    },
  ],
};

describe('readDesignFile', () => {
  it('opens a blank design document from a real temporary file', async () => {
    const filePath = await writeJson('blank.json', {
      version: 1,
      children: [],
    });

    const result = await readDesignFile(filePath);

    expect(result).toEqual({
      status: 'opened',
      filePath,
      document: { version: 1, children: [], variables: [] },
    });
    await expect(readFile(filePath, 'utf8')).resolves.toContain('"version":1');
  });

  it('opens a frame containing text and preserves ids, nesting and order', async () => {
    const filePath = await writeJson('frame.json', frameWithText);

    const result = await readDesignFile(filePath);

    expect(result.status).toBe('opened');
    if (result.status !== 'opened') {
      return;
    }

    const frame = result.document.children[0];
    expect(frame).toMatchObject({ id: 'frame-main', type: 'frame' });
    if (frame?.type !== 'frame') {
      throw new Error('Expected a frame');
    }
    expect(frame.children?.map((child) => child.id)).toEqual([
      'title',
      'caption',
    ]);
    expect(frame.children?.map((child) => child.type)).toEqual([
      'text',
      'text',
    ]);
  });

  it('reports unparsable JSON without touching the file', async () => {
    const contents = '{ broken';
    const filePath = await writeText('broken.json', contents);

    const result = await readDesignFile(filePath);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.filePath).toBe(filePath);
      expect(result.errors[0]).toMatchObject({
        code: 'invalid_json',
        path: '$',
      });
    }
    await expect(readFile(filePath, 'utf8')).resolves.toBe(contents);
  });

  it('surfaces version, structure, node and id diagnostics', async () => {
    const cases: Array<[string, unknown, string]> = [
      ['missing-version.json', { children: [] }, 'missing_version'],
      ['version-two.json', { version: 2, children: [] }, 'unsupported_version'],
      [
        'unknown-node.json',
        { version: 1, children: [{ id: 'a', type: 'chart' }] },
        'unknown_node_type',
      ],
      [
        'unknown-field.json',
        {
          version: 1,
          children: [{ id: 'a', type: 'text', text: 'Hi', shadow: {} }],
        },
        'unknown_field',
      ],
      [
        'duplicate-id.json',
        {
          version: 1,
          children: [
            { id: 'same', type: 'text', text: 'One' },
            { id: 'same', type: 'text', text: 'Two' },
          ],
        },
        'duplicate_id',
      ],
      [
        'bad-structure.json',
        { version: 1, children: 'nope' },
        'invalid_structure',
      ],
      [
        'leaf-children.json',
        {
          version: 1,
          children: [
            {
              id: 'a',
              type: 'text',
              text: 'Hi',
              children: [{ id: 'b', type: 'text', text: 'Nested' }],
            },
          ],
        },
        'invalid_children',
      ],
    ];

    for (const [name, value, code] of cases) {
      const filePath = await writeJson(name, value);
      const result = await readDesignFile(filePath);

      expect(result.status, name).toBe('failed');
      if (result.status === 'failed') {
        expect(
          result.errors.map((error) => error.code),
          name,
        ).toContain(code);
        for (const error of result.errors) {
          expect(error.path.length, name).toBeGreaterThan(0);
          expect(error.message.length, name).toBeGreaterThan(0);
        }
      }
    }
  });

  it('reports a readable diagnostic when the file cannot be read', async () => {
    const filePath = path.join(directory, 'missing.json');

    const result = await readDesignFile(filePath);

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.errors[0]).toMatchObject({
        code: 'file_read_error',
        path: '$',
      });
      expect(result.errors[0]?.message.length).toBeGreaterThan(0);
    }
  });
});
