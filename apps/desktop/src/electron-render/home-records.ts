import type { SessionProject } from '../electron-preload/contract';

/** The two browse scopes offered by the home page. */
export type BrowseCategory = 'files' | 'recent';

export interface FileLocation {
  /** Last directory segment, shown before the file name on a record. */
  directory: string | null;
  fileName: string;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** Older open times switch from a relative age to a calendar date. */
const ABSOLUTE_AFTER_DAYS = 30;

/** Splits a native path into the parts the home record shows. */
export function splitFilePath(filePath: string): FileLocation {
  const segments = filePath.split(/[\\/]/).filter((segment) => segment !== '');
  const fileName = segments.at(-1) ?? filePath;
  const directory = segments.length > 1 ? (segments.at(-2) ?? null) : null;
  return { directory, fileName };
}

function compareFileNames(left: SessionProject, right: SessionProject): number {
  const byName = splitFilePath(left.filePath).fileName.localeCompare(
    splitFilePath(right.filePath).fileName,
  );
  return byName !== 0 ? byName : left.filePath.localeCompare(right.filePath);
}

/**
 * Orders records for the selected browse scope. Files are listed by name;
 * recent use lists the most recently opened design first.
 */
export function sortRecords(
  records: readonly SessionProject[],
  category: BrowseCategory,
): SessionProject[] {
  const sorted = [...records];
  if (category === 'files') {
    return sorted.sort(compareFileNames);
  }
  return sorted.sort(
    (left, right) =>
      Date.parse(right.openedAt) - Date.parse(left.openedAt) ||
      compareFileNames(left, right),
  );
}

/** Describes when a design was last opened, relative to `now`. */
export function formatOpenedAt(openedAt: string, now: Date): string {
  const opened = Date.parse(openedAt);
  if (Number.isNaN(opened)) {
    return '';
  }

  const elapsed = Math.max(0, now.getTime() - opened);
  if (elapsed < MINUTE_MS) {
    return '刚刚';
  }
  if (elapsed < HOUR_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)} 分钟前`;
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / HOUR_MS)} 小时前`;
  }
  if (elapsed < ABSOLUTE_AFTER_DAYS * DAY_MS) {
    return `${Math.floor(elapsed / DAY_MS)} 天前`;
  }

  const date = new Date(opened);
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
