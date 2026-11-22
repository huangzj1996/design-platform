import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  HOME_SESSION_TAB,
  type AppSession,
  type SessionProject,
} from '../electron-preload/contract';

/** Upper bound for the recent-use list kept in the session. */
export const MAX_RECENT_PROJECTS = 20;

export const emptySession = (): AppSession => ({
  activeTab: HOME_SESSION_TAB,
  projects: [],
  recent: [],
});

type ReadTextFile = (filePath: string, encoding: 'utf8') => Promise<string>;
type WriteTextFile = (
  filePath: string,
  contents: string,
  encoding: 'utf8',
) => Promise<void>;

export interface SessionFileDependencies {
  readFile?: ReadTextFile;
  writeFile?: WriteTextFile;
  rename?: (from: string, to: string) => Promise<void>;
  unlink?: (filePath: string) => Promise<void>;
  mkdir?: (directory: string, options: { recursive: true }) => Promise<unknown>;
}

export interface SessionStoreOptions {
  /** Session file inside the Electron application data directory. */
  filePath: string;
  dependencies?: SessionFileDependencies;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function parseProject(value: unknown): SessionProject | null {
  if (!isRecord(value)) {
    return null;
  }
  const { filePath, openedAt } = value;
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return null;
  }
  if (typeof openedAt !== 'string' || !isTimestamp(openedAt)) {
    return null;
  }
  return { filePath, openedAt };
}

function parseProjects(value: unknown, limit: number): SessionProject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const projects: SessionProject[] = [];
  for (const entry of value) {
    const project = parseProject(entry);
    if (project === null || seen.has(project.filePath)) {
      continue;
    }
    seen.add(project.filePath);
    projects.push(project);
    if (projects.length === limit) {
      break;
    }
  }
  return projects;
}

/**
 * Accepts only the session shape the renderer can restore. Invalid records are
 * dropped and an active tab that no longer belongs to a project returns home.
 */
export function parseSession(value: unknown): AppSession {
  if (!isRecord(value)) {
    return emptySession();
  }
  const projects = parseProjects(value.projects, Number.POSITIVE_INFINITY);
  const recent = parseProjects(value.recent, MAX_RECENT_PROJECTS);
  const activeTab =
    typeof value.activeTab === 'string' &&
    (value.activeTab === HOME_SESSION_TAB ||
      projects.some((project) => project.filePath === value.activeTab))
      ? value.activeTab
      : HOME_SESSION_TAB;

  return { activeTab, projects, recent };
}

/**
 * Persists the working position in the application data directory. Writes are
 * serialized and replaced atomically so a crash cannot leave a partial file.
 */
export class SessionStore {
  private readonly filePath: string;
  private readonly read: ReadTextFile;
  private readonly write: WriteTextFile;
  private readonly move: (from: string, to: string) => Promise<void>;
  private readonly remove: (filePath: string) => Promise<void>;
  private readonly makeDirectory: (
    directory: string,
    options: { recursive: true },
  ) => Promise<unknown>;
  private queue: Promise<void> = Promise.resolve();
  private tempCounter = 0;

  constructor(options: SessionStoreOptions) {
    this.filePath = options.filePath;
    this.read = options.dependencies?.readFile ?? readFile;
    this.write = options.dependencies?.writeFile ?? writeFile;
    this.move = options.dependencies?.rename ?? rename;
    this.remove = options.dependencies?.unlink ?? unlink;
    this.makeDirectory = options.dependencies?.mkdir ?? mkdir;
  }

  /** A missing or unreadable session starts the app on the home page. */
  async load(): Promise<AppSession> {
    let contents: string;
    try {
      contents = await this.read(this.filePath, 'utf8');
    } catch {
      return emptySession();
    }

    try {
      return parseSession(JSON.parse(contents));
    } catch {
      return emptySession();
    }
  }

  /** Last write wins; the returned promise rejects if the write failed. */
  save(session: unknown): Promise<void> {
    const contents = `${JSON.stringify(parseSession(session), null, 2)}\n`;
    const next = this.queue.then(() => this.persist(contents));
    this.queue = next.catch(() => {
      // Keep the queue usable after a failed write.
    });
    return next;
  }

  private async persist(contents: string): Promise<void> {
    await this.makeDirectory(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${this.tempCounter}.tmp`;
    this.tempCounter += 1;

    try {
      await this.write(tempPath, contents, 'utf8');
      await this.move(tempPath, this.filePath);
    } catch (error) {
      try {
        await this.remove(tempPath);
      } catch {
        // The temporary file may not exist; the previous session is intact.
      }
      throw error;
    }
  }
}
