/**
 * RolloutReader - Parses Codex JSONL rollout files.
 *
 * Each rollout file is a sequence of newline-delimited JSON objects (JSONL).
 * The first line is always a `session_meta` item.
 */

import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { RolloutLine, SessionMetaLine } from "../types/rollout";
import { isSessionMeta } from "../types/rollout";

/**
 * Parse a single JSONL line into a RolloutLine.
 * Returns null if the line is empty or cannot be parsed.
 */
export function parseRolloutLine(line: string): RolloutLine | null {
  const trimmed = line.trim();
  if (trimmed === "") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!isValidRolloutLine(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Read an entire rollout JSONL file and return all parsed lines.
 * Lines that fail to parse are silently skipped.
 */
export async function readRollout(path: string): Promise<readonly RolloutLine[]> {
  const content = await readFile(path, "utf-8");
  const lines = content.split("\n");
  const result: RolloutLine[] = [];
  for (const line of lines) {
    const parsed = parseRolloutLine(line);
    if (parsed !== null) {
      result.push(parsed);
    }
  }
  return result;
}

/**
 * Read only the session metadata (first line) from a rollout file.
 * This is much faster than reading the entire file for listing sessions.
 */
export async function parseSessionMeta(
  path: string,
): Promise<SessionMetaLine | null> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      const parsed = parseRolloutLine(line);
      if (parsed !== null && isSessionMeta(parsed)) {
        return parsed.payload;
      }
      // First non-empty line should be session_meta; if not, bail
      if (parsed !== null) {
        return null;
      }
    }
  } finally {
    rl.close();
  }
  return null;
}

/**
 * Stream rollout events line by line as an async generator.
 * Useful for processing large files without loading everything into memory.
 */
export async function* streamEvents(
  path: string,
): AsyncGenerator<RolloutLine, void, undefined> {
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      const parsed = parseRolloutLine(line);
      if (parsed !== null) {
        yield parsed;
      }
    }
  } finally {
    rl.close();
  }
}

/**
 * Extract the first user message from a rollout file.
 * Scans event_msg items looking for a UserMessage event.
 */
export async function extractFirstUserMessage(
  path: string,
): Promise<string | undefined> {
  for await (const item of streamEvents(path)) {
    if (
      item.type === "event_msg" &&
      isUserMessagePayload(item.payload)
    ) {
      return item.payload.message;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isValidRolloutLine(value: unknown): value is RolloutLine {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj["timestamp"] === "string" &&
    typeof obj["type"] === "string" &&
    "payload" in obj
  );
}

function isUserMessagePayload(
  payload: unknown,
): payload is { type: "UserMessage"; message: string } {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const obj = payload as Record<string, unknown>;
  return obj["type"] === "UserMessage" && typeof obj["message"] === "string";
}
