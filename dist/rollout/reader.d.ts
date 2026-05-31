/**
 * RolloutReader - Parses Codex JSONL rollout files.
 *
 * Each rollout file is a sequence of newline-delimited JSON objects (JSONL).
 * The first line is always a `session_meta` item.
 */
import type { RolloutLine, SessionMetaLine } from "../types/rollout";
/**
 * Parse a single JSONL line into a RolloutLine.
 * Returns null if the line is empty or cannot be parsed.
 */
export declare function parseRolloutLine(line: string): RolloutLine | null;
/**
 * Read an entire rollout JSONL file and return all parsed lines.
 * Lines that fail to parse are silently skipped.
 */
export declare function readRollout(path: string): Promise<readonly RolloutLine[]>;
/**
 * Read only the session metadata (first line) from a rollout file.
 * This is much faster than reading the entire file for listing sessions.
 */
export declare function parseSessionMeta(path: string): Promise<SessionMetaLine | null>;
/**
 * Stream rollout events line by line as an async generator.
 * Useful for processing large files without loading everything into memory.
 */
export declare function streamEvents(path: string): AsyncGenerator<RolloutLine, void, undefined>;
/**
 * Extract the first user message from a rollout file.
 * Scans event_msg items looking for a UserMessage event.
 */
export declare function extractFirstUserMessage(path: string): Promise<string | undefined>;
export type SessionMessageCategory = "assistant_tool_response" | "tool_user_response" | "other_message";
export interface SessionMessage {
    readonly timestamp: string;
    readonly category: SessionMessageCategory;
    readonly role: "assistant" | "user" | "unknown";
    readonly text?: string;
    readonly sourceType: RolloutLine["type"];
    readonly sourceTag?: string;
    readonly line: RolloutLine;
}
export interface GetSessionMessagesOptions {
    readonly excludeToolRelated?: boolean;
    readonly excludeSystemInjected?: boolean;
}
/**
 * Extract session messages with category labels.
 * Useful for separating tool-call exchanges from normal conversation messages.
 */
export declare function getSessionMessages(path: string, options?: GetSessionMessagesOptions): Promise<readonly SessionMessage[]>;
//# sourceMappingURL=reader.d.ts.map