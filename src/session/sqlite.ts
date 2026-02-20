/**
 * SQLite-backed session index for fast querying.
 *
 * Reads Codex's own SQLite state DB (`~/.codex/state`) in read-only mode.
 * Uses bun:sqlite (built-in, zero deps).
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";
import { resolveCodexHome } from "./index";
import type { CodexSession, SessionListOptions, SessionListResult } from "../types/session";
import type { SessionSource, GitInfo } from "../types/rollout";

const STATE_DB_FILENAME = "state";

/**
 * Open Codex's SQLite DB in read-only mode.
 * Returns null if the file does not exist or cannot be opened.
 */
export function openCodexDb(codexHome?: string): Database | null {
  const home = codexHome ?? resolveCodexHome();
  const dbPath = join(home, STATE_DB_FILENAME);

  try {
    const db = new Database(dbPath, { readonly: true });
    // Verify the threads table exists
    const check = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='threads'").get();
    if (check === null) {
      db.close();
      return null;
    }
    return db;
  } catch {
    return null;
  }
}

/**
 * Map a row from the threads table to a CodexSession.
 */
function rowToSession(row: Record<string, unknown>): CodexSession {
  const gitSha = row["git_sha"] as string | null;
  const gitBranch = row["git_branch"] as string | null;
  const gitOriginUrl = row["git_origin_url"] as string | null;

  const git: GitInfo | undefined =
    gitSha || gitBranch || gitOriginUrl
      ? {
          ...(gitSha ? { sha: gitSha } : {}),
          ...(gitBranch ? { branch: gitBranch } : {}),
          ...(gitOriginUrl ? { origin_url: gitOriginUrl } : {}),
        }
      : undefined;

  const source = (row["source"] as SessionSource) ?? "unknown";

  return {
    id: row["id"] as string,
    rolloutPath: row["rollout_path"] as string,
    createdAt: new Date(row["created_at"] as string),
    updatedAt: new Date(row["updated_at"] as string),
    source,
    modelProvider: row["model_provider"] as string | undefined,
    cwd: row["cwd"] as string,
    cliVersion: row["cli_version"] as string,
    title: (row["title"] as string) ?? (row["first_user_message"] as string) ?? (row["id"] as string),
    firstUserMessage: row["first_user_message"] as string | undefined,
    archivedAt: row["archived_at"] ? new Date(row["archived_at"] as string) : undefined,
    git,
  };
}

/**
 * Build SQL WHERE clauses from filter options.
 */
type SqlParam = string | number | null;

function buildWhereClause(options?: SessionListOptions): { where: string; params: SqlParam[] } {
  const conditions: string[] = [];
  const params: SqlParam[] = [];

  if (options?.source !== undefined) {
    conditions.push("source = ?");
    params.push(options.source);
  }
  if (options?.cwd !== undefined) {
    conditions.push("cwd = ?");
    params.push(options.cwd);
  }
  if (options?.branch !== undefined) {
    conditions.push("git_branch = ?");
    params.push(options.branch);
  }

  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  return { where, params };
}

/**
 * Query sessions from the SQLite DB with filtering, pagination, and sorting.
 */
export function listSessionsSqlite(
  db: Database,
  options?: SessionListOptions,
): SessionListResult {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const sortBy = options?.sortBy ?? "createdAt";
  const sortOrder = options?.sortOrder ?? "desc";

  const { where, params } = buildWhereClause(options);
  const orderCol = sortBy === "updatedAt" ? "updated_at" : "created_at";
  const orderDir = sortOrder === "asc" ? "ASC" : "DESC";

  // Count total matching rows
  const countSql = `SELECT COUNT(*) as cnt FROM threads ${where}`;
  const countRow = db.query(countSql).get(...params) as { cnt: number } | null;
  const total = countRow?.cnt ?? 0;

  // Fetch page
  const selectSql = `SELECT * FROM threads ${where} ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`;
  const rows = db.query(selectSql).all(...params, limit, offset) as Record<string, unknown>[];
  const sessions = rows.map(rowToSession);

  return { sessions, total, offset, limit };
}

/**
 * Fast lookup of a single session by UUID primary key.
 */
export function findSessionSqlite(
  db: Database,
  id: string,
): CodexSession | null {
  const row = db.query("SELECT * FROM threads WHERE id = ?").get(id) as Record<string, unknown> | null;
  if (row === null) {
    return null;
  }
  return rowToSession(row);
}

/**
 * Find the most recent session, optionally filtered by working directory.
 */
export function findLatestSessionSqlite(
  db: Database,
  cwd?: string,
): CodexSession | null {
  let sql = "SELECT * FROM threads";
  const params: SqlParam[] = [];
  if (cwd !== undefined) {
    sql += " WHERE cwd = ?";
    params.push(cwd);
  }
  sql += " ORDER BY updated_at DESC LIMIT 1";

  const row = db.query(sql).get(...params) as Record<string, unknown> | null;
  if (row === null) {
    return null;
  }
  return rowToSession(row);
}
