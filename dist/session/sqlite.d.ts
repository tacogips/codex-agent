/**
 * SQLite-backed session index for fast querying.
 *
 * Reads Codex's own SQLite state DB (`~/.codex/state`) in read-only mode.
 * Uses bun:sqlite (built-in, zero deps).
 */
import { Database } from "bun:sqlite";
import type { CodexSession, SessionListOptions, SessionListResult } from "../types/session";
/**
 * Open Codex's SQLite DB in read-only mode.
 * Returns null if the file does not exist or cannot be opened.
 */
export declare function openCodexDb(codexHome?: string): Database | null;
/**
 * Query sessions from the SQLite DB with filtering, pagination, and sorting.
 */
export declare function listSessionsSqlite(db: Database, options?: SessionListOptions): SessionListResult;
/**
 * Fast lookup of a single session by UUID primary key.
 */
export declare function findSessionSqlite(db: Database, id: string): CodexSession | null;
/**
 * Find the most recent session, optionally filtered by working directory.
 */
export declare function findLatestSessionSqlite(db: Database, cwd?: string): CodexSession | null;
//# sourceMappingURL=sqlite.d.ts.map