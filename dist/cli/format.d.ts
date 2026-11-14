/**
 * CLI output formatting utilities.
 */
import type { CodexSession } from "../types/session";
import type { RolloutLine } from "../types/rollout";
/**
 * Format a session list as a table for terminal output.
 */
export declare function formatSessionTable(sessions: readonly CodexSession[]): string;
/**
 * Format a single session as detailed text.
 */
export declare function formatSessionDetail(session: CodexSession): string;
/**
 * Format a rollout line for watch output.
 */
export declare function formatRolloutLine(line: RolloutLine): string;
/**
 * Format sessions as JSON.
 */
export declare function formatSessionsJson(sessions: readonly CodexSession[]): string;
//# sourceMappingURL=format.d.ts.map