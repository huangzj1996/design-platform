import { describe, expect, it } from 'vitest';
import type { SessionProject } from '../src/electron-preload/contract';
import { initialEditorState } from '../src/electron-render/editor-state';
import {
  formatOpenedAt,
  sortRecords,
  splitFilePath,
} from '../src/electron-render/home-records';
import {
  homeRecords,
  initialWorkspaceState,
  type ProjectTab,
  type WorkspaceState,
} from '../src/electron-render/workspace';

const record = (filePath: string, openedAt: string): SessionProject => ({
  filePath,
  openedAt,
});

const openProject = (
  id: string,
  filePath: string,
  openedAt: string,
): ProjectTab => ({
  id,
  label: filePath,
  openedAt,
  state: { ...initialEditorState, filePath },
});

describe('home records', () => {
  it('splits native paths into the folder and file name shown on a record', () => {
    expect(splitFilePath('D:\\projects\\design-ai.pen')).toEqual({
      directory: 'projects',
      fileName: 'design-ai.pen',
    });
    expect(splitFilePath('/home/designer/board.json')).toEqual({
      directory: 'designer',
      fileName: 'board.json',
    });
    expect(splitFilePath('board.json')).toEqual({
      directory: null,
      fileName: 'board.json',
    });
  });

  it('describes the last open time relative to now', () => {
    const now = new Date('2026-11-23T12:00:00.000Z');

    expect(formatOpenedAt('2026-11-23T11:59:30.000Z', now)).toBe('刚刚');
    expect(formatOpenedAt('2026-11-23T11:55:00.000Z', now)).toBe('5 分钟前');
    expect(formatOpenedAt('2026-11-23T11:00:00.000Z', now)).toBe('1 小时前');
    expect(formatOpenedAt('2026-11-21T12:00:00.000Z', now)).toBe('2 天前');
    expect(formatOpenedAt('2026-10-01T12:00:00.000Z', now)).toBe('2026-10-01');
  });

  it('sorts files by name and recent records by open time', () => {
    const earlier = record('/design/alpha.json', '2026-11-21T09:00:00.000Z');
    const later = record('/design/zeta.json', '2026-11-22T10:30:00.000Z');
    const records = [earlier, later];

    expect(sortRecords(records, 'files')).toEqual([earlier, later]);
    expect(sortRecords(records, 'recent')).toEqual([later, earlier]);
    expect(records[0]).toBe(earlier);
  });

  it('adds open tabs the recent list no longer holds, without duplicates', () => {
    const openedAt = '2026-11-22T10:00:00.000Z';
    const workspace: WorkspaceState = {
      ...initialWorkspaceState,
      recent: [record('/design/recent.json', openedAt)],
      projects: [
        openProject('project-1', '/design/recent.json', openedAt),
        openProject('project-2', '/design/open-only.json', openedAt),
      ],
    };

    expect(homeRecords(workspace)).toEqual([
      { filePath: '/design/recent.json', openedAt },
      { filePath: '/design/open-only.json', openedAt },
    ]);
  });
});
