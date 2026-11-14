/**
 * SessionIndex - Hybrid session discovery for Codex rollout files.
 *
 * Strategy: Try SQLite first (fast path), fallback to filesystem scan.
 * SQLite reads Codex's own state DB; filesystem scans
 * ~/.codex/sessions/YYYY/MM/DD/ for rollout JSONL files.
 */
import type { CodexSession, SessionListOptions, SessionListResult } from "../types/session";
/**
 * Resolve the Codex home directory.
 * Uses CODEX_HOME env var if set, otherwise ~/.codex.
 */
export declare function resolveCodexHome(): string;
/**
 * Discover all rollout file paths under the sessions directory.
 * Yields absolute paths in reverse chronological order (newest first).
 */
export declare function discoverRolloutPaths(codexHome?: string): AsyncGenerator<string, void, undefined>;
/**
 * Build a CodexSession from a rollout file path by reading its metadata.
 */
export declare function buildSession(rolloutPath: string): Promise<CodexSession | null>;
/**
 * List sessions with optional filtering and pagination.
 * Tries SQLite first; falls back to filesystem scan if DB is unavailable.
 */
export declare function listSessions(options?: SessionListOptions & {
    codexHome?: string;
}): Promise<SessionListResult>;
/**
 * Find a session by its UUID.
 * Tries SQLite first; falls back to filesystem scan.
 */
export declare function findSession(id: string, codexHome?: string): Promise<CodexSession | null>;
/**
 * Find the most recent session, optionally filtered by working directory.
 * Tries SQLite first; falls back to filesystem scan.
 */
export declare function findLatestSession(codexHome?: string, cwd?: string): Promise<CodexSession | null>;
//# sourceMappingURL=index.d.ts.map