import { describe, expect, it } from 'vitest';
import type { SessionProject } from '../src/electron-preload/contract';
import {
  formatOpenedAt,
  sortRecords,
  splitFilePath,
} from '../src/electron-render/home-records';

const record = (filePath: string, openedAt: string): SessionProject => ({
  filePath,
  openedAt,
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
});
