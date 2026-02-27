/**
 * Session-level types derived from Codex rollout metadata.
 */

import type { GitInfo, SessionSource } from "./rollout";

/**
 * Represents a Codex session derived from rollout file metadata.
 */
export interface CodexSession {
  readonly id: string;
  readonly rolloutPath: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly source: SessionSource;
  readonly modelProvider?: string | undefined;
  readonly cwd: string;
  readonly cliVersion: string;
  readonly title: string;
  readonly firstUserMessage?: string | undefined;
  readonly archivedAt?: Date | undefined;
  readonly git?: GitInfo | undefined;
  readonly forkedFromId?: string | undefined;
}

/**
 * Options for listing/filtering sessions.
 */
export interface SessionListOptions {
  readonly source?: SessionSource | undefined;
  readonly cwd?: string | undefined;
  readonly branch?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly sortBy?: "createdAt" | "updatedAt" | undefined;
  readonly sortOrder?: "asc" | "desc" | undefined;
}

/**
 * Paginated session list result.
 */
export interface SessionListResult {
  readonly sessions: readonly CodexSession[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
}

/**
 * Role filter for transcript search.
 */
export type SessionSearchRole = "user" | "assistant" | "both";

/**
 * Shared options for transcript search.
 */
export interface SessionTranscriptSearchOptions {
  readonly caseSensitive?: boolean | undefined;
  readonly role?: SessionSearchRole | undefined;
  readonly maxBytes?: number | undefined;
  readonly maxEvents?: number | undefined;
  readonly timeoutMs?: number | undefined;
}

/**
 * Per-session transcript search result.
 */
export interface SessionTranscriptSearchResult {
  readonly sessionId: string;
  readonly matched: boolean;
  readonly matchCount: number;
  readonly scannedBytes: number;
  readonly scannedEvents: number;
  readonly truncated: boolean;
  readonly timedOut: boolean;
  readonly durationMs: number;
}

/**
 * Options for cross-session transcript search.
 */
export interface SessionsSearchOptions
  extends SessionListOptions,
    SessionTranscriptSearchOptions {
  readonly maxSessions?: number | undefined;
}

/**
 * Cross-session transcript search result.
 */
export interface SessionsSearchResult {
  readonly sessionIds: readonly string[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly scannedSessions: number;
  readonly scannedBytes: number;
  readonly scannedEvents: number;
  readonly truncated: boolean;
  readonly timedOut: boolean;
  readonly durationMs: number;
}
