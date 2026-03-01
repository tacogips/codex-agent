import { resolve } from "node:path";
import { Buffer } from "node:buffer";
import { parseSessionMeta, streamEvents } from "../rollout/reader";
import type { RolloutLine } from "../types/rollout";
import type {
  SessionSearchRole,
  SessionTranscriptSearchOptions,
  SessionTranscriptSearchResult,
  SessionsSearchOptions,
  SessionsSearchResult,
} from "../types/session";
import { discoverRolloutPaths, findSession } from "./index";
import { openCodexDb } from "./sqlite";

interface SearchBudget {
  maxBytes?: number | undefined;
  maxEvents?: number | undefined;
  deadlineAt?: number | undefined;
}

interface SearchRunResult {
  readonly matched: boolean;
  readonly matchCount: number;
  readonly scannedBytes: number;
  readonly scannedEvents: number;
  readonly truncated: boolean;
  readonly timedOut: boolean;
}

interface SessionCandidate {
  readonly id: string;
  readonly rolloutPath: string;
}

interface ParsedSessionMeta {
  readonly id: string;
  readonly cwd: string | undefined;
  readonly source: string | undefined;
  readonly branch: string | undefined;
}

const DEFAULT_LIMIT = 50;

/**
 * Search transcript text inside a single session.
 */
export async function searchSessionTranscript(
  sessionId: string,
  query: string,
  options?: SessionTranscriptSearchOptions & { codexHome?: string },
): Promise<SessionTranscriptSearchResult> {
  const normalizedQuery = normalizeQuery(query);
  const session = await findSession(sessionId, options?.codexHome);

  const startedAt = Date.now();
  if (session === null) {
    return {
      sessionId,
      matched: false,
      matchCount: 0,
      scannedBytes: 0,
      scannedEvents: 0,
      truncated: false,
      timedOut: false,
      durationMs: Date.now() - startedAt,
    };
  }

  const budget = toBudget(options);
  const result = await searchTranscriptFile(
    session.rolloutPath,
    normalizedQuery,
    options,
    budget,
    false,
  );

  return {
    sessionId,
    matched: result.matched,
    matchCount: result.matchCount,
    scannedBytes: result.scannedBytes,
    scannedEvents: result.scannedEvents,
    truncated: result.truncated,
    timedOut: result.timedOut,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Search transcripts across sessions and return matching session IDs.
 */
export async function searchSessions(
  query: string,
  options?: SessionsSearchOptions & { codexHome?: string },
): Promise<SessionsSearchResult> {
  const normalizedQuery = normalizeQuery(query);
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const offset = options?.offset ?? 0;
  const maxSessions = options?.maxSessions;

  const startedAt = Date.now();
  const budget = toBudget(options);

  const sessionIds: string[] = [];
  let total = 0;
  let scannedSessions = 0;
  let scannedBytes = 0;
  let scannedEvents = 0;
  let timedOut = false;
  let truncated = false;

  for await (const candidate of iterCandidates(options)) {
    if (maxSessions !== undefined && scannedSessions >= maxSessions) {
      truncated = true;
      break;
    }
    if (budget.maxBytes !== undefined && scannedBytes >= budget.maxBytes) {
      truncated = true;
      break;
    }
    if (budget.maxEvents !== undefined && scannedEvents >= budget.maxEvents) {
      truncated = true;
      break;
    }
    if (budget.deadlineAt !== undefined && Date.now() >= budget.deadlineAt) {
      timedOut = true;
      break;
    }

    scannedSessions += 1;
    const sessionBudget = {
      maxBytes:
        budget.maxBytes === undefined
          ? undefined
          : Math.max(0, budget.maxBytes - scannedBytes),
      maxEvents:
        budget.maxEvents === undefined
          ? undefined
          : Math.max(0, budget.maxEvents - scannedEvents),
      deadlineAt: budget.deadlineAt,
    };

    const result = await searchTranscriptFile(
      candidate.rolloutPath,
      normalizedQuery,
      options,
      sessionBudget,
      true,
    );

    scannedBytes += result.scannedBytes;
    scannedEvents += result.scannedEvents;

    if (result.matched) {
      total += 1;
      if (total > offset && sessionIds.length < limit) {
        sessionIds.push(candidate.id);
      }
    }

    if (result.timedOut) {
      timedOut = true;
      break;
    }
    if (result.truncated) {
      truncated = true;
      break;
    }
  }

  return {
    sessionIds,
    total,
    offset,
    limit,
    scannedSessions,
    scannedBytes,
    scannedEvents,
    truncated,
    timedOut,
    durationMs: Date.now() - startedAt,
  };
}

async function* iterCandidates(
  options?: SessionsSearchOptions & { codexHome?: string },
): AsyncGenerator<SessionCandidate, void, undefined> {
  const db = openCodexDb(options?.codexHome);
  if (db !== null) {
    try {
      const clauses: string[] = [];
      const params: string[] = [];

      if (options?.source !== undefined) {
        clauses.push("source = ?");
        params.push(options.source);
      }
      if (options?.cwd !== undefined) {
        clauses.push("cwd = ?");
        params.push(options.cwd);
      }
      if (options?.branch !== undefined) {
        clauses.push("git_branch = ?");
        params.push(options.branch);
      }

      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const sql = `SELECT id, rollout_path FROM threads ${where} ORDER BY updated_at DESC`;
      const rows = db.query(sql).all(...params) as Array<
        Record<string, unknown>
      >;
      for (const row of rows) {
        const id = asString(row["id"]);
        const rolloutPath = asString(row["rollout_path"]);
        if (id !== undefined && rolloutPath !== undefined) {
          yield { id, rolloutPath };
        }
      }
      return;
    } catch {
      // Fall back to filesystem.
    } finally {
      db.close();
    }
  }

  for await (const rolloutPath of discoverRolloutPaths(options?.codexHome)) {
    const meta = await parseSessionMeta(rolloutPath);
    if (meta === null) {
      continue;
    }

    const parsedMeta = parseCandidateSessionMeta(meta);
    if (parsedMeta === null) {
      continue;
    }
    const { id, cwd, source, branch } = parsedMeta;

    if (options?.source !== undefined && source !== options.source) {
      continue;
    }
    if (options?.cwd !== undefined) {
      if (cwd === undefined || resolve(cwd) !== resolve(options.cwd)) {
        continue;
      }
    }
    if (options?.branch !== undefined && branch !== options.branch) {
      continue;
    }

    yield { id, rolloutPath };
  }
}

async function searchTranscriptFile(
  rolloutPath: string,
  query: string,
  options: SessionTranscriptSearchOptions | undefined,
  budget: SearchBudget,
  stopAtFirstMatch: boolean,
): Promise<SearchRunResult> {
  const role = options?.role ?? "both";
  const caseSensitive = options?.caseSensitive ?? false;

  let matched = false;
  let matchCount = 0;
  let scannedBytes = 0;
  let scannedEvents = 0;
  let truncated = false;
  let timedOut = false;

  for await (const line of streamEvents(rolloutPath)) {
    if (budget.maxEvents !== undefined && scannedEvents >= budget.maxEvents) {
      truncated = true;
      break;
    }
    if (budget.maxBytes !== undefined && scannedBytes >= budget.maxBytes) {
      truncated = true;
      break;
    }
    if (budget.deadlineAt !== undefined && Date.now() >= budget.deadlineAt) {
      timedOut = true;
      break;
    }

    scannedEvents += 1;

    const texts = extractSearchableTexts(line, role);
    if (texts.length === 0) {
      continue;
    }

    for (const text of texts) {
      const textBytes = Buffer.byteLength(text, "utf8");
      if (
        budget.maxBytes !== undefined &&
        scannedBytes + textBytes > budget.maxBytes
      ) {
        truncated = true;
        break;
      }
      scannedBytes += textBytes;

      const count = countMatches(text, query, caseSensitive);
      if (count > 0) {
        matched = true;
        matchCount += count;
        if (stopAtFirstMatch) {
          return {
            matched,
            matchCount,
            scannedBytes,
            scannedEvents,
            truncated,
            timedOut,
          };
        }
      }
    }

    if (truncated) {
      break;
    }
  }

  return {
    matched,
    matchCount,
    scannedBytes,
    scannedEvents,
    truncated,
    timedOut,
  };
}

function extractSearchableTexts(
  line: RolloutLine,
  roleFilter: SessionSearchRole,
): readonly string[] {
  if (line.type === "event_msg") {
    const payload = asRecord(line.payload);
    if (payload === null) {
      return [];
    }
    const eventType = asString(payload["type"]);
    if (eventType === "UserMessage") {
      const message = asString(payload["message"]);
      return isRoleEnabled("user", roleFilter) && message !== undefined
        ? [message]
        : [];
    }
    if (eventType === "AgentMessage") {
      const message = asString(payload["message"]);
      return isRoleEnabled("assistant", roleFilter) && message !== undefined
        ? [message]
        : [];
    }
    if (eventType === "AgentReasoning") {
      const text = asString(payload["text"]);
      return isRoleEnabled("assistant", roleFilter) && text !== undefined
        ? [text]
        : [];
    }
    if (eventType === "TurnComplete") {
      const lastAgentMessage = asString(payload["last_agent_message"]);
      return isRoleEnabled("assistant", roleFilter) &&
        lastAgentMessage !== undefined
        ? [lastAgentMessage]
        : [];
    }
    return [];
  }

  if (line.type === "response_item") {
    const payload = asRecord(line.payload);
    if (payload === null) {
      return [];
    }
    const itemType = asString(payload["type"]);

    if (itemType === "message") {
      const role = asString(payload["role"]);
      const text = extractResponseMessageText(payload["content"]);
      if (text === undefined) {
        return [];
      }
      if (role === "user" && isRoleEnabled("user", roleFilter)) {
        return [text];
      }
      if (role === "assistant" && isRoleEnabled("assistant", roleFilter)) {
        return [text];
      }
      return [];
    }

    if (itemType === "reasoning" && isRoleEnabled("assistant", roleFilter)) {
      const summary = payload["summary"];
      if (!Array.isArray(summary)) {
        return [];
      }
      const texts: string[] = [];
      for (const part of summary) {
        const entry = asRecord(part);
        const text = entry === null ? undefined : asString(entry["text"]);
        if (text !== undefined) {
          texts.push(text);
        }
      }
      return texts;
    }
  }

  return [];
}

function extractResponseMessageText(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts: string[] = [];
  for (const raw of content) {
    const item = asRecord(raw);
    if (item === null) {
      continue;
    }
    const type = asString(item["type"]);
    const text = asString(item["text"]);
    if (
      (type === "input_text" || type === "output_text") &&
      text !== undefined
    ) {
      parts.push(text);
    }
  }

  if (parts.length === 0) {
    return undefined;
  }
  return parts.join("\n");
}

function isRoleEnabled(
  candidate: "user" | "assistant",
  role: SessionSearchRole,
): boolean {
  return role === "both" || role === candidate;
}

function countMatches(
  text: string,
  query: string,
  caseSensitive: boolean,
): number {
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();

  let count = 0;
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, cursor);
    if (idx < 0) {
      break;
    }
    count += 1;
    cursor = idx + needle.length;
  }
  return count;
}

function normalizeQuery(query: string): string {
  const normalized = query.trim();
  if (normalized === "") {
    throw new Error("query must not be empty");
  }
  return normalized;
}

function toBudget(options?: SessionTranscriptSearchOptions): SearchBudget {
  const deadlineAt =
    options?.timeoutMs !== undefined
      ? Date.now() + Math.max(0, options.timeoutMs)
      : undefined;

  return {
    maxBytes: normalizePositiveInt(options?.maxBytes),
    maxEvents: normalizePositiveInt(options?.maxEvents),
    deadlineAt,
  };
}

function normalizePositiveInt(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) {
    return undefined;
  }
  return value > 0 ? Math.floor(value) : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseCandidateSessionMeta(meta: unknown): ParsedSessionMeta | null {
  const payload = asRecord(meta);
  const metaRecord = payload === null ? null : asRecord(payload["meta"]);
  if (metaRecord === null || payload === null) {
    return null;
  }

  const id = asString(metaRecord["id"]);
  if (id === undefined || id === "") {
    return null;
  }

  const git = asRecord(payload["git"]);
  const branch = git === null ? undefined : asString(git["branch"]);

  return {
    id,
    cwd: asString(metaRecord["cwd"]),
    source: asString(metaRecord["source"]),
    branch,
  };
}
