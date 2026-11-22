import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../src/electron-main/session-store';
import type { AppSession } from '../src/electron-preload/contract';

let directory: string;
let sessionFilePath: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'design-ai-session-'));
  sessionFilePath = path.join(directory, 'userData', 'session.json');
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const earlier = '2026-11-21T09:00:00.000Z';
const later = '2026-11-22T10:30:00.000Z';

describe('SessionStore', () => {
  it('round-trips the active page, project tabs and recent records', async () => {
    const store = new SessionStore({ filePath: sessionFilePath });
    const firstPath = path.join(directory, 'first.json');
    const secondPath = path.join(directory, 'second.json');
    const previousPath = path.join(directory, 'previous.json');
    const session: AppSession = {
      activeTab: firstPath,
      projects: [
        { filePath: firstPath, openedAt: later },
        { filePath: secondPath, openedAt: earlier },
      ],
      recent: [
        { filePath: firstPath, openedAt: later },
        { filePath: previousPath, openedAt: earlier },
      ],
    };

    await store.save(session);

    await expect(store.load()).resolves.toEqual(session);
    const written = JSON.parse(
      await readFile(sessionFilePath, 'utf8'),
    ) as unknown;
    expect(written).toEqual(session);
  });

  it('starts from home when no session file exists', async () => {
    const store = new SessionStore({ filePath: sessionFilePath });

    await expect(store.load()).resolves.toEqual({
      activeTab: 'home',
      projects: [],
      recent: [],
    });
    await expect(readFile(sessionFilePath, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('returns to home when the session file is corrupt', async () => {
    await mkdir(path.dirname(sessionFilePath), { recursive: true });
    await writeFile(sessionFilePath, '{ not json', 'utf8');
    const store = new SessionStore({ filePath: sessionFilePath });

    await expect(store.load()).resolves.toEqual({
      activeTab: 'home',
      projects: [],
      recent: [],
    });
  });

  it('drops invalid records and falls back to home for an unknown active tab', async () => {
    const validPath = path.join(directory, 'valid.json');
    const recentPath = path.join(directory, 'recent.json');
    await mkdir(path.dirname(sessionFilePath), { recursive: true });
    await writeFile(
      sessionFilePath,
      JSON.stringify({
        activeTab: path.join(directory, 'missing.json'),
        projects: [
          { filePath: validPath, openedAt: later },
          { filePath: 42, openedAt: later },
          { filePath: validPath, openedAt: earlier },
          { filePath: path.join(directory, 'bad-time.json'), openedAt: 'soon' },
        ],
        recent: [
          { filePath: recentPath, openedAt: earlier },
          { filePath: '', openedAt: later },
        ],
      }),
      { encoding: 'utf8', flag: 'wx' },
    );
    const store = new SessionStore({ filePath: sessionFilePath });

    await expect(store.load()).resolves.toEqual({
      activeTab: 'home',
      projects: [{ filePath: validPath, openedAt: later }],
      recent: [{ filePath: recentPath, openedAt: earlier }],
    });
  });

  it('keeps the active tab when it belongs to a restored project', async () => {
    const activePath = path.join(directory, 'active.json');
    await mkdir(path.dirname(sessionFilePath), { recursive: true });
    await writeFile(
      sessionFilePath,
      JSON.stringify({
        activeTab: activePath,
        projects: [{ filePath: activePath, openedAt: later }],
        recent: [{ filePath: activePath, openedAt: later }],
      }),
      { encoding: 'utf8', flag: 'wx' },
    );
    const store = new SessionStore({ filePath: sessionFilePath });

    await expect(store.load()).resolves.toEqual({
      activeTab: activePath,
      projects: [{ filePath: activePath, openedAt: later }],
      recent: [{ filePath: activePath, openedAt: later }],
    });
  });
});
