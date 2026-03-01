import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { streamEvents } from "../rollout/reader";
import { resolveCodexHome } from "../session/index";
import {
  isEventMsg,
  isResponseItem,
  isSessionMeta,
  type RolloutLine,
} from "../types/rollout";

const ROLLOUT_PREFIX = "rollout-";
const ROLLOUT_EXT = ".jsonl";
const DEFAULT_RECENT_DAYS = 14;
const DEFAULT_CACHE_TTL_MS = 5000;

type MutableModelUsageStats = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
};

type MutableDailyActivity = {
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
  tokensByModel: Map<string, number>;
};

export interface ModelUsageStats {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
}

export interface DailyActivity {
  readonly date: string;
  readonly messageCount?: number;
  readonly sessionCount?: number;
  readonly toolCallCount?: number;
  readonly tokensByModel?: Record<string, number>;
}

export interface CodexUsageStats {
  readonly totalSessions: number;
  readonly totalMessages: number;
  readonly firstSessionDate: string | null;
  readonly lastComputedDate: string | null;
  readonly modelUsage: Record<string, ModelUsageStats>;
  readonly recentDailyActivity: DailyActivity[];
}

export interface GetCodexUsageStatsOptions {
  readonly codexSessionsDir?: string;
  readonly recentDays?: number;
}

interface UsageStatsCacheEntry {
  readonly key: string;
  readonly expiresAt: number;
  readonly value: CodexUsageStats | null;
}

let usageStatsCache: UsageStatsCacheEntry | null = null;

export async function getCodexUsageStats(
  options?: GetCodexUsageStatsOptions,
): Promise<CodexUsageStats | null> {
  const sessionsDir =
    options?.codexSessionsDir ?? join(resolveCodexHome(), "sessions");
  const recentDays = normalizeRecentDays(options?.recentDays);
  const now = Date.now();
  const cacheKey = `${sessionsDir}::${String(recentDays)}`;

  if (
    usageStatsCache !== null &&
    usageStatsCache.key === cacheKey &&
    usageStatsCache.expiresAt > now
  ) {
    return usageStatsCache.value;
  }

  const rolloutFiles = await listRolloutFiles(sessionsDir);
  if (rolloutFiles === null) {
    cacheUsageStats(cacheKey, now, null);
    return null;
  }

  const lastComputedDate = dateKeyFromEpochMs(now);
  const firstRecentDayEpochMs =
    dayStartEpochMs(now) - (recentDays - 1) * 86400000;

  let totalSessions = 0;
  let totalMessages = 0;
  let firstSessionDate: string | null = null;

  const modelUsageMap = new Map<string, MutableModelUsageStats>();
  const dailyActivityMap = new Map<string, MutableDailyActivity>();
  const tokenCountStateByKey = new Map<string, TokenCountState>();

  for (const rolloutFile of rolloutFiles) {
    let hadParsableLine = false;
    let sessionDateForFile: string | null = null;

    try {
      for await (const line of streamEvents(rolloutFile)) {
        hadParsableLine = true;

        const lineDate = dateKeyFromTimestamp(line.timestamp);
        if (
          lineDate !== null &&
          (sessionDateForFile === null || lineDate < sessionDateForFile)
        ) {
          sessionDateForFile = lineDate;
        }

        if (isSessionMeta(line)) {
          const sessionMetaTimestamp = extractSessionMetaTimestamp(
            line.payload,
          );
          if (sessionMetaTimestamp !== undefined) {
            const sessionMetaDate = dateKeyFromTimestamp(sessionMetaTimestamp);
            if (
              sessionMetaDate !== null &&
              (sessionDateForFile === null ||
                sessionMetaDate < sessionDateForFile)
            ) {
              sessionDateForFile = sessionMetaDate;
            }
          }
        }

        if (isUserOrAssistantMessage(line)) {
          totalMessages += 1;
          if (lineDate !== null) {
            getOrCreateDailyActivity(dailyActivityMap, lineDate).messageCount +=
              1;
          }
        }

        const toolCalls = extractToolCallCount(line);
        if (toolCalls > 0 && lineDate !== null) {
          getOrCreateDailyActivity(dailyActivityMap, lineDate).toolCallCount +=
            toolCalls;
        }

        const rawUsageEvent = extractUsageEvent(line);
        const usageEvent = normalizeUsageEventForAggregation(
          rawUsageEvent,
          tokenCountStateByKey,
        );
        if (usageEvent === null || usageEvent.totalTokens <= 0) {
          continue;
        }

        const model = usageEvent.model;
        const modelUsage = getOrCreateModelUsage(modelUsageMap, model);
        modelUsage.inputTokens += usageEvent.inputTokens;
        modelUsage.outputTokens += usageEvent.outputTokens;
        modelUsage.cacheReadInputTokens += usageEvent.cacheReadInputTokens;
        modelUsage.cacheCreationInputTokens +=
          usageEvent.cacheCreationInputTokens;

        if (lineDate !== null) {
          const daily = getOrCreateDailyActivity(dailyActivityMap, lineDate);
          const prev = daily.tokensByModel.get(model) ?? 0;
          daily.tokensByModel.set(model, prev + usageEvent.totalTokens);
        }
      }
    } catch {
      continue;
    }

    if (!hadParsableLine) {
      continue;
    }

    totalSessions += 1;
    if (sessionDateForFile !== null) {
      if (firstSessionDate === null || sessionDateForFile < firstSessionDate) {
        firstSessionDate = sessionDateForFile;
      }
      getOrCreateDailyActivity(
        dailyActivityMap,
        sessionDateForFile,
      ).sessionCount += 1;
    }
  }

  const recentDailyActivity: DailyActivity[] = [];
  for (let offset = 0; offset < recentDays; offset += 1) {
    const epochMs = firstRecentDayEpochMs + offset * 86400000;
    const date = dateKeyFromEpochMs(epochMs);
    const activity = dailyActivityMap.get(date);
    if (activity === undefined) {
      recentDailyActivity.push({ date });
      continue;
    }

    const tokensByModel = mapToRecord(activity.tokensByModel);
    recentDailyActivity.push({
      date,
      ...(activity.messageCount > 0
        ? { messageCount: activity.messageCount }
        : {}),
      ...(activity.sessionCount > 0
        ? { sessionCount: activity.sessionCount }
        : {}),
      ...(activity.toolCallCount > 0
        ? { toolCallCount: activity.toolCallCount }
        : {}),
      ...(Object.keys(tokensByModel).length > 0 ? { tokensByModel } : {}),
    });
  }

  const result: CodexUsageStats = {
    totalSessions,
    totalMessages,
    firstSessionDate,
    lastComputedDate,
    modelUsage: mapToRecord(modelUsageMap),
    recentDailyActivity,
  };

  cacheUsageStats(cacheKey, now, result);
  return result;
}

function normalizeRecentDays(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_RECENT_DAYS;
  }
  if (!Number.isFinite(value)) {
    return DEFAULT_RECENT_DAYS;
  }
  const floored = Math.floor(value);
  return floored > 0 ? floored : DEFAULT_RECENT_DAYS;
}

async function listRolloutFiles(
  sessionsDir: string,
): Promise<readonly string[] | null> {
  try {
    const files: string[] = [];
    await collectRolloutFilesRecursive(sessionsDir, files);
    files.sort();
    return files;
  } catch {
    return null;
  }
}

async function collectRolloutFilesRecursive(
  dirPath: string,
  out: string[],
): Promise<void> {
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await collectRolloutFilesRecursive(fullPath, out);
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.startsWith(ROLLOUT_PREFIX) &&
      entry.name.endsWith(ROLLOUT_EXT)
    ) {
      out.push(fullPath);
    }
  }
}

function cacheUsageStats(
  key: string,
  nowEpochMs: number,
  value: CodexUsageStats | null,
): void {
  usageStatsCache = {
    key,
    expiresAt: nowEpochMs + DEFAULT_CACHE_TTL_MS,
    value,
  };
}

function getOrCreateModelUsage(
  modelUsageMap: Map<string, MutableModelUsageStats>,
  model: string,
): MutableModelUsageStats {
  const existing = modelUsageMap.get(model);
  if (existing !== undefined) {
    return existing;
  }
  const created: MutableModelUsageStats = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
  modelUsageMap.set(model, created);
  return created;
}

function getOrCreateDailyActivity(
  activityMap: Map<string, MutableDailyActivity>,
  date: string,
): MutableDailyActivity {
  const existing = activityMap.get(date);
  if (existing !== undefined) {
    return existing;
  }
  const created: MutableDailyActivity = {
    messageCount: 0,
    sessionCount: 0,
    toolCallCount: 0,
    tokensByModel: new Map<string, number>(),
  };
  activityMap.set(date, created);
  return created;
}

function mapToRecord<T>(value: Map<string, T>): Record<string, T> {
  const result: Record<string, T> = {};
  for (const [key, entry] of value.entries()) {
    result[key] = entry;
  }
  return result;
}

function isUserOrAssistantMessage(line: RolloutLine): boolean {
  if (isEventMsg(line)) {
    const payload = toRecord(line.payload);
    const eventType = readString(payload, "type");
    return eventType === "UserMessage" || eventType === "AgentMessage";
  }

  if (isResponseItem(line)) {
    const payload = toRecord(line.payload);
    if (readString(payload, "type") !== "message") {
      return false;
    }
    const role = readString(payload, "role");
    return role === "user" || role === "assistant";
  }

  return false;
}

function extractToolCallCount(line: RolloutLine): number {
  if (isEventMsg(line)) {
    const payload = toRecord(line.payload);
    if (readString(payload, "type") === "ExecCommandBegin") {
      return 1;
    }
  }

  if (isResponseItem(line)) {
    const payload = toRecord(line.payload);
    const itemType = readString(payload, "type");
    if (itemType === "function_call" || itemType === "local_shell_call") {
      return 1;
    }
  }

  return 0;
}

interface UsageEvent {
  readonly source: "turn_complete" | "token_count";
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly totalTokens: number;
  readonly isCumulative: boolean;
  readonly aggregationKey?: string;
}

interface TokenCountState {
  lastInputTokens?: number;
  lastOutputTokens?: number;
  lastCacheReadInputTokens?: number;
  lastCacheCreationInputTokens?: number;
  lastTotalTokens?: number;
}

function extractUsageEvent(line: RolloutLine): UsageEvent | null {
  if (!isEventMsg(line)) {
    return null;
  }

  const payload = toRecord(line.payload);
  if (payload === null) {
    return null;
  }

  const eventType = readString(payload, "type");
  let usage: Record<string, unknown> | null = null;
  let modelFromInfo: string | undefined;
  let source: UsageEvent["source"] | null = null;
  let isCumulative = false;
  let aggregationKey: string | undefined;

  if (eventType === "TurnComplete") {
    source = "turn_complete";
    usage = toRecord(payload["usage"]);
  } else if (eventType === "token_count" || eventType === "TokenCount") {
    const info = toRecord(payload["info"]);
    if (info === null) {
      return null;
    }
    source = "token_count";
    modelFromInfo = readString(info, "model");
    const lastTokenUsage =
      toRecord(info["last_token_usage"]) ??
      toRecord(payload["last_token_usage"]);
    const totalTokenUsage =
      toRecord(info["total_token_usage"]) ??
      toRecord(payload["total_token_usage"]);
    if (lastTokenUsage !== null) {
      usage = lastTokenUsage;
      isCumulative = false;
    } else if (totalTokenUsage !== null) {
      usage = totalTokenUsage;
      isCumulative = true;
    } else {
      usage = toRecord(info["usage"]) ?? toRecord(payload["usage"]) ?? payload;
      isCumulative = false;
    }
    aggregationKey = extractTokenCountAggregationKey(
      payload,
      info,
      modelFromInfo,
    );
  }

  if (source === null || usage === null) {
    return null;
  }

  const inputTokens =
    readNumber(usage, "input_tokens") ?? readNumber(usage, "inputTokens") ?? 0;
  const outputTokens =
    readNumber(usage, "output_tokens") ??
    readNumber(usage, "outputTokens") ??
    0;
  const cacheReadInputTokens =
    readNumber(usage, "cache_read_input_tokens") ??
    readNumber(usage, "cacheReadInputTokens") ??
    readNumber(usage, "cached_input_tokens") ??
    0;
  const cacheCreationInputTokens =
    readNumber(usage, "cache_creation_input_tokens") ??
    readNumber(usage, "cacheCreationInputTokens") ??
    0;

  const computedTotal =
    inputTokens +
    outputTokens +
    cacheReadInputTokens +
    cacheCreationInputTokens;

  const totalTokens =
    readNumber(usage, "total_tokens") ??
    readNumber(usage, "totalTokens") ??
    computedTotal;

  const model =
    modelFromInfo ??
    readString(usage, "model") ??
    readString(usage, "model_id") ??
    readString(payload, "model") ??
    "unknown";

  return {
    source,
    model,
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    totalTokens,
    isCumulative,
    ...(aggregationKey !== undefined ? { aggregationKey } : {}),
  };
}

function normalizeUsageEventForAggregation(
  usageEvent: UsageEvent | null,
  tokenCountStateByKey: Map<string, TokenCountState>,
): UsageEvent | null {
  if (usageEvent === null || usageEvent.source !== "token_count") {
    return usageEvent;
  }

  const key = usageEvent.aggregationKey ?? usageEvent.model;
  const state = getOrCreateTokenCountState(tokenCountStateByKey, key);

  if (!usageEvent.isCumulative) {
    return usageEvent;
  }

  if (
    state.lastTotalTokens !== undefined &&
    usageEvent.totalTokens < state.lastTotalTokens
  ) {
    setTokenCountState(state, usageEvent);
    return {
      ...usageEvent,
      isCumulative: false,
    };
  }

  const deltaInputTokens = positiveDelta(
    usageEvent.inputTokens,
    state.lastInputTokens,
  );
  const deltaOutputTokens = positiveDelta(
    usageEvent.outputTokens,
    state.lastOutputTokens,
  );
  const deltaCacheReadInputTokens = positiveDelta(
    usageEvent.cacheReadInputTokens,
    state.lastCacheReadInputTokens,
  );
  const deltaCacheCreationInputTokens = positiveDelta(
    usageEvent.cacheCreationInputTokens,
    state.lastCacheCreationInputTokens,
  );
  const deltaTotalTokens = positiveDelta(
    usageEvent.totalTokens,
    state.lastTotalTokens,
  );

  setTokenCountStateMax(state, usageEvent);

  if (deltaTotalTokens <= 0) {
    return null;
  }

  return {
    ...usageEvent,
    inputTokens: deltaInputTokens,
    outputTokens: deltaOutputTokens,
    cacheReadInputTokens: deltaCacheReadInputTokens,
    cacheCreationInputTokens: deltaCacheCreationInputTokens,
    totalTokens: deltaTotalTokens,
    isCumulative: false,
  };
}

function getOrCreateTokenCountState(
  stateByKey: Map<string, TokenCountState>,
  key: string,
): TokenCountState {
  const existing = stateByKey.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created: TokenCountState = {};
  stateByKey.set(key, created);
  return created;
}

function setTokenCountState(
  state: TokenCountState,
  usageEvent: UsageEvent,
): void {
  state.lastInputTokens = usageEvent.inputTokens;
  state.lastOutputTokens = usageEvent.outputTokens;
  state.lastCacheReadInputTokens = usageEvent.cacheReadInputTokens;
  state.lastCacheCreationInputTokens = usageEvent.cacheCreationInputTokens;
  state.lastTotalTokens = usageEvent.totalTokens;
}

function setTokenCountStateMax(
  state: TokenCountState,
  usageEvent: UsageEvent,
): void {
  state.lastInputTokens = maxDefined(
    state.lastInputTokens,
    usageEvent.inputTokens,
  );
  state.lastOutputTokens = maxDefined(
    state.lastOutputTokens,
    usageEvent.outputTokens,
  );
  state.lastCacheReadInputTokens = maxDefined(
    state.lastCacheReadInputTokens,
    usageEvent.cacheReadInputTokens,
  );
  state.lastCacheCreationInputTokens = maxDefined(
    state.lastCacheCreationInputTokens,
    usageEvent.cacheCreationInputTokens,
  );
  state.lastTotalTokens = maxDefined(
    state.lastTotalTokens,
    usageEvent.totalTokens,
  );
}

function positiveDelta(current: number, previous: number | undefined): number {
  if (previous === undefined) {
    return current;
  }
  const delta = current - previous;
  return delta > 0 ? delta : 0;
}

function maxDefined(previous: number | undefined, current: number): number {
  if (previous === undefined) {
    return current;
  }
  return current > previous ? current : previous;
}

function extractTokenCountAggregationKey(
  payload: Record<string, unknown>,
  info: Record<string, unknown>,
  modelFromInfo: string | undefined,
): string {
  const parts: string[] = [];
  const infoStreamId = readString(info, "stream_id");
  if (infoStreamId !== undefined) {
    parts.push(`stream:${infoStreamId}`);
  }
  const infoTurnId = readString(info, "turn_id");
  if (infoTurnId !== undefined) {
    parts.push(`info_turn:${infoTurnId}`);
  }
  const payloadTurnId = readString(payload, "turn_id");
  if (payloadTurnId !== undefined) {
    parts.push(`payload_turn:${payloadTurnId}`);
  }
  const responseId = readString(info, "response_id");
  if (responseId !== undefined) {
    parts.push(`response:${responseId}`);
  }
  const messageId = readString(info, "message_id");
  if (messageId !== undefined) {
    parts.push(`message:${messageId}`);
  }
  const model = modelFromInfo ?? readString(payload, "model") ?? "unknown";
  parts.push(`model:${model}`);
  return parts.join("|");
}

function extractSessionMetaTimestamp(
  payloadValue: unknown,
): string | undefined {
  const payload = toRecord(payloadValue);
  if (payload === null) {
    return undefined;
  }

  const payloadTimestamp = readString(payload, "timestamp");
  if (payloadTimestamp !== undefined) {
    return payloadTimestamp;
  }

  const meta = toRecord(payload["meta"]);
  return readString(meta, "timestamp");
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(
  value: Record<string, unknown> | null,
  key: string,
): string | undefined {
  if (value === null) {
    return undefined;
  }
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function readNumber(
  value: Record<string, unknown> | null,
  key: string,
): number | undefined {
  if (value === null) {
    return undefined;
  }
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    return undefined;
  }
  return candidate;
}

function dateKeyFromTimestamp(timestamp: string): string | null {
  const date = new Date(timestamp);
  const epochMs = date.getTime();
  if (Number.isNaN(epochMs)) {
    return null;
  }
  return dateKeyFromEpochMs(epochMs);
}

function dayStartEpochMs(epochMs: number): number {
  const date = new Date(epochMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function dateKeyFromEpochMs(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}
