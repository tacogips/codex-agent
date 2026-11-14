/**
 * RolloutReader - Parses Codex JSONL rollout files.
 *
 * Each rollout file is a sequence of newline-delimited JSON objects (JSONL).
 * The first line is always a `session_meta` item.
 */

import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type {
  MessageOrigin,
  MessageProvenance,
  RolloutLine,
  SessionMetaLine,
} from "../types/rollout";
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
    const normalized = normalizeRolloutLine(parsed);
    if (normalized === null) {
      return null;
    }
    const provenance = deriveProvenance(normalized);
    return provenance === undefined
      ? normalized
      : {
          ...normalized,
          provenance,
        };
  } catch {
    return null;
  }
}

/**
 * Read an entire rollout JSONL file and return all parsed lines.
 * Lines that fail to parse are silently skipped.
 */
export async function readRollout(
  path: string,
): Promise<readonly RolloutLine[]> {
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
    if (item.type === "event_msg" && isUserMessagePayload(item.payload)) {
      if (item.provenance?.origin === "user_input") {
        return item.payload.message;
      }
      if (
        item.provenance === undefined &&
        detectSourceTag(item.payload.message) === undefined
      ) {
        return item.payload.message;
      }
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

function normalizeRolloutLine(value: unknown): RolloutLine | null {
  if (isValidRolloutLine(value)) {
    return value;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw["type"] !== "string") {
    return null;
  }

  const timestamp =
    typeof raw["timestamp"] === "string"
      ? raw["timestamp"]
      : new Date().toISOString();
  const execEventType = raw["type"];

  if (execEventType === "thread.started") {
    const sessionId =
      typeof raw["thread_id"] === "string" && raw["thread_id"].length > 0
        ? raw["thread_id"]
        : "unknown-session";
    return {
      timestamp,
      type: "session_meta",
      payload: {
        meta: {
          id: sessionId,
          timestamp,
          cwd: "",
          originator: "codex",
          cli_version: "unknown",
          source: "exec",
        },
      },
    };
  }

  if (execEventType === "item.completed") {
    const item = toRecord(raw["item"]);
    if (item === null || typeof item["type"] !== "string") {
      return null;
    }
    if (item["type"] === "agent_message" && typeof item["text"] === "string") {
      return {
        timestamp,
        type: "event_msg",
        payload: {
          type: "AgentMessage",
          message: item["text"],
        },
      };
    }
    return {
      timestamp,
      type: "response_item",
      payload: item,
    };
  }

  const payload = toEventPayload(execEventType, raw);
  if (payload === null) {
    return null;
  }
  return {
    timestamp,
    type: "event_msg",
    payload,
  };
}

function toEventPayload(
  eventType: string,
  raw: Record<string, unknown>,
): Record<string, unknown> | null {
  switch (eventType) {
    case "turn.started":
      return {
        type: "TurnStarted",
        ...(typeof raw["turn_id"] === "string"
          ? { turn_id: raw["turn_id"] }
          : {}),
      };
    case "turn.completed":
      return {
        type: "TurnComplete",
        ...(typeof raw["turn_id"] === "string"
          ? { turn_id: raw["turn_id"] }
          : {}),
        ...(raw["usage"] !== undefined ? { usage: raw["usage"] } : {}),
      };
    case "error":
      return {
        type: "Error",
        ...(typeof raw["message"] === "string"
          ? { message: raw["message"] }
          : {}),
      };
    default:
      return null;
  }
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

function deriveProvenance(line: RolloutLine): MessageProvenance | undefined {
  switch (line.type) {
    case "event_msg":
      return deriveEventMsgProvenance(line.payload);
    case "response_item":
      return deriveResponseItemProvenance(line.payload);
    case "session_meta":
      return {
        origin: "framework_event",
        display_default: false,
        source_tag: "session_meta",
      };
    case "turn_context":
      return {
        origin: "framework_event",
        display_default: false,
        source_tag: "turn_context",
      };
    case "compacted":
      return {
        origin: "framework_event",
        display_default: false,
        source_tag: "compacted",
      };
    default:
      return undefined;
  }
}

function deriveEventMsgProvenance(payload: unknown): MessageProvenance {
  if (typeof payload !== "object" || payload === null) {
    return {
      origin: "framework_event",
      display_default: false,
      source_tag: "event_msg_unknown",
    };
  }
  const event = payload as Record<string, unknown>;
  const eventType =
    typeof event["type"] === "string" ? event["type"] : "unknown";

  if (eventType === "UserMessage" && typeof event["message"] === "string") {
    return classifyUserMessage(event["message"]);
  }
  if (eventType === "AgentMessage") {
    return {
      role: "assistant",
      origin: "tool_generated",
      display_default: true,
      source_tag: "agent_message",
    };
  }

  return {
    origin: "framework_event",
    display_default: false,
    source_tag: toSnakeCase(eventType),
  };
}

function deriveResponseItemProvenance(payload: unknown): MessageProvenance {
  if (typeof payload !== "object" || payload === null) {
    return {
      origin: "tool_generated",
      display_default: false,
      source_tag: "response_item_unknown",
    };
  }
  const item = payload as Record<string, unknown>;
  const itemType = typeof item["type"] === "string" ? item["type"] : "unknown";

  if (itemType === "message") {
    const role = typeof item["role"] === "string" ? item["role"] : undefined;
    const messageText = extractMessageText(item["content"]);
    if (role === "user" && messageText !== undefined) {
      return classifyUserMessage(messageText);
    }
    return {
      ...(role !== undefined ? { role } : {}),
      origin: role === "assistant" ? "tool_generated" : "framework_event",
      display_default: true,
      source_tag: "response_message",
    };
  }

  const generatedItemTypes = new Set([
    "reasoning",
    "local_shell_call",
    "function_call",
    "function_call_output",
  ]);
  const origin: MessageOrigin = generatedItemTypes.has(itemType)
    ? "tool_generated"
    : "framework_event";
  return {
    origin,
    display_default: origin !== "framework_event",
    source_tag: toSnakeCase(itemType),
  };
}

function classifyUserMessage(message: string): MessageProvenance {
  const sourceTag = detectSourceTag(message);
  if (sourceTag === undefined) {
    return {
      role: "user",
      origin: "user_input",
      display_default: true,
    };
  }
  const origin: MessageOrigin =
    sourceTag === "turn_aborted" ? "framework_event" : "system_injected";
  return {
    role: "user",
    origin,
    display_default: false,
    source_tag: sourceTag,
  };
}

function detectSourceTag(message: string): string | undefined {
  const text = message.trimStart();
  if (text.startsWith("# AGENTS.md instructions")) {
    return "agents_instructions";
  }
  if (text.startsWith("<environment_context>")) {
    return "environment_context";
  }
  if (text.startsWith("<turn_aborted>")) {
    return "turn_aborted";
  }
  return undefined;
}

function extractMessageText(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const textParts: string[] = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) {
      continue;
    }
    const record = part as Record<string, unknown>;
    if (
      (record["type"] === "input_text" || record["type"] === "output_text") &&
      typeof record["text"] === "string"
    ) {
      textParts.push(record["text"]);
    }
  }
  if (textParts.length === 0) {
    return undefined;
  }
  return textParts.join("\n");
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toSnakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}
