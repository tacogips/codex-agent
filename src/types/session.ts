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
