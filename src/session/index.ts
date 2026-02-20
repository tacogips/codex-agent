/**
 * SessionIndex - Hybrid session discovery for Codex rollout files.
 *
 * Strategy: Try SQLite first (fast path), fallback to filesystem scan.
 * SQLite reads Codex's own state DB; filesystem scans
 * ~/.codex/sessions/YYYY/MM/DD/ for rollout JSONL files.
 */

import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { parseSessionMeta, extractFirstUserMessage } from "../rollout/reader";
import type { CodexSession, SessionListOptions, SessionListResult } from "../types/session";
import type { SessionMetaLine } from "../types/rollout";
import {
  openCodexDb,
  listSessionsSqlite,
  findSessionSqlite,
  findLatestSessionSqlite,
} from "./sqlite";

const DEFAULT_CODEX_HOME = join(homedir(), ".codex");
const SESSIONS_DIR = "sessions";
const ARCHIVED_DIR = "archived_sessions";
const ROLLOUT_PREFIX = "rollout-";
const ROLLOUT_EXT = ".jsonl";

/**
 * Resolve the Codex home directory.
 * Uses CODEX_HOME env var if set, otherwise ~/.codex.
 */
export function resolveCodexHome(): string {
  return process.env["CODEX_HOME"] ?? DEFAULT_CODEX_HOME;
}

/**
 * Discover all rollout file paths under the sessions directory.
 * Yields absolute paths in reverse chronological order (newest first).
 */
export async function* discoverRolloutPaths(
  codexHome?: string,
): AsyncGenerator<string, void, undefined> {
  const home = codexHome ?? resolveCodexHome();
  const sessionsDir = join(home, SESSIONS_DIR);

  if (!(await dirExists(sessionsDir))) {
    return;
  }

  // Year directories (descending)
  const years = await readSortedDirs(sessionsDir, "desc");
  for (const year of years) {
    const yearPath = join(sessionsDir, year);
    // Month directories (descending)
    const months = await readSortedDirs(yearPath, "desc");
    for (const month of months) {
      const monthPath = join(yearPath, month);
      // Day directories (descending)
      const days = await readSortedDirs(monthPath, "desc");
      for (const day of days) {
        const dayPath = join(monthPath, day);
        // Rollout files (descending by name, which includes timestamp)
        const files = await readSortedFiles(dayPath, "desc");
        for (const file of files) {
          if (file.startsWith(ROLLOUT_PREFIX) && file.endsWith(ROLLOUT_EXT)) {
            yield join(dayPath, file);
          }
        }
      }
    }
  }

  // Also scan archived sessions (flat directory)
  const archivedDir = join(home, ARCHIVED_DIR);
  if (await dirExists(archivedDir)) {
    const files = await readSortedFiles(archivedDir, "desc");
    for (const file of files) {
      if (file.startsWith(ROLLOUT_PREFIX) && file.endsWith(ROLLOUT_EXT)) {
        yield join(archivedDir, file);
      }
    }
  }
}

/**
 * Build a CodexSession from a rollout file path by reading its metadata.
 */
export async function buildSession(
  rolloutPath: string,
): Promise<CodexSession | null> {
  const meta = await parseSessionMeta(rolloutPath);
  if (meta === null) {
    return null;
  }

  const fileStat = await stat(rolloutPath);
  const firstMessage = await extractFirstUserMessage(rolloutPath);
  const isArchived = rolloutPath.includes(`/${ARCHIVED_DIR}/`);

  return sessionFromMeta(meta, rolloutPath, fileStat.mtime, firstMessage, isArchived);
}

/**
 * List sessions with optional filtering and pagination.
 * Tries SQLite first; falls back to filesystem scan if DB is unavailable.
 */
export async function listSessions(
  options?: SessionListOptions & { codexHome?: string },
): Promise<SessionListResult> {
  const codexHome = options?.codexHome;

  // Fast path: SQLite
  const db = openCodexDb(codexHome);
  if (db !== null) {
    try {
      return listSessionsSqlite(db, options);
    } catch {
      // Fall through to filesystem scan
    } finally {
      db.close();
    }
  }

  // Slow path: filesystem scan
  return listSessionsFilesystem(options);
}

/**
 * Filesystem-based session listing (fallback).
 */
async function listSessionsFilesystem(
  options?: SessionListOptions & { codexHome?: string },
): Promise<SessionListResult> {
  const codexHome = options?.codexHome;
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const sortBy = options?.sortBy ?? "createdAt";
  const sortOrder = options?.sortOrder ?? "desc";

  const sessions: CodexSession[] = [];

  for await (const rolloutPath of discoverRolloutPaths(codexHome)) {
    const session = await buildSession(rolloutPath);
    if (session === null) {
      continue;
    }
    if (!matchesFilter(session, options)) {
      continue;
    }
    sessions.push(session);
  }

  // Sort
  sessions.sort((a, b) => {
    const aVal = sortBy === "updatedAt" ? a.updatedAt.getTime() : a.createdAt.getTime();
    const bVal = sortBy === "updatedAt" ? b.updatedAt.getTime() : b.createdAt.getTime();
    return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
  });

  const total = sessions.length;
  const paged = sessions.slice(offset, offset + limit);

  return { sessions: paged, total, offset, limit };
}

/**
 * Find a session by its UUID.
 * Tries SQLite first; falls back to filesystem scan.
 */
export async function findSession(
  id: string,
  codexHome?: string,
): Promise<CodexSession | null> {
  // Fast path: SQLite
  const db = openCodexDb(codexHome);
  if (db !== null) {
    try {
      const session = findSessionSqlite(db, id);
      if (session !== null) {
        return session;
      }
    } catch {
      // Fall through to filesystem scan
    } finally {
      db.close();
    }
  }

  // Slow path: filesystem scan
  for await (const rolloutPath of discoverRolloutPaths(codexHome)) {
    // Quick check: the UUID is embedded in the filename
    if (!rolloutPath.includes(id)) {
      continue;
    }
    const session = await buildSession(rolloutPath);
    if (session !== null && session.id === id) {
      return session;
    }
  }
  return null;
}

/**
 * Find the most recent session, optionally filtered by working directory.
 * Tries SQLite first; falls back to filesystem scan.
 */
export async function findLatestSession(
  codexHome?: string,
  cwd?: string,
): Promise<CodexSession | null> {
  // Fast path: SQLite
  const db = openCodexDb(codexHome);
  if (db !== null) {
    try {
      const session = findLatestSessionSqlite(db, cwd);
      if (session !== null) {
        return session;
      }
    } catch {
      // Fall through to filesystem scan
    } finally {
      db.close();
    }
  }

  // Slow path: filesystem scan
  for await (const rolloutPath of discoverRolloutPaths(codexHome)) {
    const session = await buildSession(rolloutPath);
    if (session === null) {
      continue;
    }
    if (cwd !== undefined && resolve(session.cwd) !== resolve(cwd)) {
      continue;
    }
    return session; // Already sorted newest-first by directory structure
  }
  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sessionFromMeta(
  meta: SessionMetaLine,
  rolloutPath: string,
  mtime: Date,
  firstUserMessage: string | undefined,
  isArchived: boolean,
): CodexSession {
  const createdAt = new Date(meta.meta.timestamp);
  return {
    id: meta.meta.id,
    rolloutPath,
    createdAt,
    updatedAt: mtime,
    source: meta.meta.source,
    modelProvider: meta.meta.model_provider,
    cwd: meta.meta.cwd,
    cliVersion: meta.meta.cli_version,
    title: firstUserMessage ?? meta.meta.id,
    firstUserMessage,
    archivedAt: isArchived ? mtime : undefined,
    git: meta.git,
    forkedFromId: meta.meta.forked_from_id,
  };
}

function matchesFilter(
  session: CodexSession,
  options?: SessionListOptions,
): boolean {
  if (options === undefined) {
    return true;
  }
  if (options.source !== undefined && session.source !== options.source) {
    return false;
  }
  if (options.cwd !== undefined && resolve(session.cwd) !== resolve(options.cwd)) {
    return false;
  }
  if (
    options.branch !== undefined &&
    session.git?.branch !== options.branch
  ) {
    return false;
  }
  return true;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function readSortedDirs(
  parent: string,
  order: "asc" | "desc",
): Promise<readonly string[]> {
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    dirs.sort();
    if (order === "desc") {
      dirs.reverse();
    }
    return dirs;
  } catch {
    return [];
  }
}

async function readSortedFiles(
  parent: string,
  order: "asc" | "desc",
): Promise<readonly string[]> {
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => e.name);
    files.sort();
    if (order === "desc") {
      files.reverse();
    }
    return files;
  } catch {
    return [];
  }
}
