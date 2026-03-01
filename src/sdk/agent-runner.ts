import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { SessionRunner } from "./session-runner";
import type {
  SessionCharStreamChunk,
  SessionResult,
  SessionRunnerOptions,
  SessionStreamChunk,
} from "./session-runner";
import type { SessionConfig } from "./session-runner";
import type { ApprovalMode, SandboxMode, StreamGranularity } from "../process/types";

export interface AgentRunnerOptions extends SessionRunnerOptions {}

export type AgentStreamMode = "raw" | "normalized";

interface AgentRequestBase {
  readonly cwd?: string | undefined;
  readonly sandbox?: SandboxMode | undefined;
  readonly approvalMode?: ApprovalMode | undefined;
  readonly fullAuto?: boolean | undefined;
  readonly model?: string | undefined;
  readonly additionalArgs?: readonly string[] | undefined;
  readonly streamGranularity?: StreamGranularity | undefined;
  readonly streamMode?: AgentStreamMode | undefined;
  readonly attachments?: readonly AgentAttachment[] | undefined;
}

export interface NewAgentRequest extends AgentRequestBase {
  readonly prompt: string;
  readonly sessionId?: undefined;
}

export interface ResumeAgentRequest extends AgentRequestBase {
  readonly sessionId: string;
  readonly prompt?: string | undefined;
}

export type AgentRequest = NewAgentRequest | ResumeAgentRequest;

export type AgentAttachment =
  | {
      readonly type: "path";
      readonly path: string;
    }
  | {
      readonly type: "base64";
      readonly data: string;
      readonly mediaType?: string | undefined;
      readonly filename?: string | undefined;
    };

export interface AgentSessionStartedEvent {
  readonly type: "session.started";
  readonly sessionId: string;
  readonly resumed: boolean;
}

export interface AgentSessionMessageEvent {
  readonly type: "session.message";
  readonly sessionId: string;
  readonly chunk: SessionStreamChunk;
}

export interface AgentSessionCompletedEvent {
  readonly type: "session.completed";
  readonly sessionId: string;
  readonly result: SessionResult;
}

export interface AgentSessionErrorEvent {
  readonly type: "session.error";
  readonly sessionId?: string | undefined;
  readonly error: Error;
}

export type AgentEvent =
  | AgentSessionStartedEvent
  | AgentSessionMessageEvent
  | AgentSessionCompletedEvent
  | AgentSessionErrorEvent;

export interface AgentAssistantDeltaEvent {
  readonly type: "assistant.delta";
  readonly sessionId: string;
  readonly text: string;
}

export interface AgentAssistantSnapshotEvent {
  readonly type: "assistant.snapshot";
  readonly sessionId: string;
  readonly content: string;
}

export interface AgentToolCallEvent {
  readonly type: "tool.call";
  readonly sessionId: string;
  readonly name: string;
  readonly input?: unknown;
}

export interface AgentToolResultEvent {
  readonly type: "tool.result";
  readonly sessionId: string;
  readonly name: string;
  readonly isError: boolean;
  readonly output?: unknown;
}

export interface AgentActivityEvent {
  readonly type: "activity";
  readonly sessionId: string;
  readonly message?: string;
}

export interface AgentNormalizedSessionCompletedEvent {
  readonly type: "session.completed";
  readonly sessionId: string;
  readonly success: boolean;
  readonly exitCode: number;
  readonly error?: string;
}

export type AgentNormalizedEvent =
  | AgentSessionStartedEvent
  | AgentAssistantDeltaEvent
  | AgentAssistantSnapshotEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentActivityEvent
  | AgentNormalizedSessionCompletedEvent
  | AgentSessionErrorEvent;

export type AgentNormalizedChunkEvent = Exclude<
  AgentNormalizedEvent,
  AgentNormalizedSessionCompletedEvent
>;

export function runAgent(
  request: AgentRequest & { readonly streamMode: "normalized" },
  options?: AgentRunnerOptions,
): AsyncGenerator<AgentNormalizedEvent, void, undefined>;
export function runAgent(
  request: AgentRequest,
  options?: AgentRunnerOptions,
): AsyncGenerator<AgentEvent, void, undefined>;
export async function* runAgent(
  request: AgentRequest,
  options?: AgentRunnerOptions,
): AsyncGenerator<AgentEvent | AgentNormalizedEvent, void, undefined> {
  const runner = new SessionRunner(options);
  const normalized = await normalizeAttachments(request.attachments);
  const resumed = isResumeRequest(request);
  const normalizedMode = request.streamMode === "normalized";
  let currentSessionId: string | undefined =
    resumed ? request.sessionId : undefined;

  try {
    const session = await startFromRequest(runner, request, normalized.imagePaths);
    currentSessionId = session.sessionId;

    const iterator = session.messages();
    const normalizerState = createNormalizerState();

    if (resumed) {
      const startedEvent: AgentSessionStartedEvent = {
        type: "session.started",
        sessionId: session.sessionId,
        resumed: true,
      };
      yield startedEvent;
    } else {
      const firstChunk = await iterator.next();
      if (firstChunk.done) {
        const startedEvent: AgentSessionStartedEvent = {
          type: "session.started",
          sessionId: session.sessionId,
          resumed: false,
        };
        yield startedEvent;
      } else {
        const startedSessionId = resolveSessionId(session.sessionId, firstChunk.value);
        currentSessionId = startedSessionId;
        const startedEvent: AgentSessionStartedEvent = {
          type: "session.started",
          sessionId: startedSessionId,
          resumed: false,
        };
        yield startedEvent;

        if (normalizedMode) {
          for (const event of normalizeChunkToEvents(
            firstChunk.value,
            startedSessionId,
            normalizerState,
            false,
          )) {
            yield event;
          }
        } else {
          yield {
            type: "session.message",
            sessionId: startedSessionId,
            chunk: firstChunk.value,
          };
        }
      }
    }

    while (true) {
      const nextChunk = await iterator.next();
      if (nextChunk.done) {
        break;
      }
      const resolvedSessionId = resolveSessionId(session.sessionId, nextChunk.value);
      currentSessionId = resolvedSessionId;

      if (normalizedMode) {
        for (const event of normalizeChunkToEvents(
          nextChunk.value,
          resolvedSessionId,
          normalizerState,
          false,
        )) {
          yield event;
        }
      } else {
        yield {
          type: "session.message",
          sessionId: resolvedSessionId,
          chunk: nextChunk.value,
        };
      }
    }

    const result = await session.waitForCompletion();
    const resolvedSessionId = currentSessionId ?? session.sessionId;
    if (normalizedMode) {
      yield {
        type: "session.completed",
        sessionId: resolvedSessionId,
        success: result.success,
        exitCode: result.exitCode,
      };
    } else {
      yield {
        type: "session.completed",
        sessionId: resolvedSessionId,
        result,
      };
    }
  } catch (error: unknown) {
    yield {
      type: "session.error",
      sessionId: currentSessionId,
      error: toError(error),
    };
  } finally {
    await normalized.cleanup();
  }
}

export async function* toNormalizedEvents(
  chunks: AsyncIterable<SessionStreamChunk>,
): AsyncGenerator<AgentNormalizedChunkEvent, void, undefined> {
  const state = createNormalizerState();
  let fallbackSessionId = "unknown-session";
  for await (const chunk of chunks) {
    fallbackSessionId = resolveSessionId(fallbackSessionId, chunk);
    for (const event of normalizeChunkToEvents(chunk, fallbackSessionId, state, true)) {
      yield event;
    }
  }
}

async function startFromRequest(
  runner: SessionRunner,
  request: AgentRequest,
  imagePaths: readonly string[],
): Promise<{
  readonly sessionId: string;
  readonly messages: () => AsyncGenerator<SessionStreamChunk, void, undefined>;
  readonly waitForCompletion: () => Promise<SessionResult>;
}> {
  if (isResumeRequest(request)) {
    const session = await runner.resumeSession(request.sessionId, request.prompt, {
      cwd: request.cwd,
      model: request.model,
      sandbox: request.sandbox,
      approvalMode: request.approvalMode,
      fullAuto: request.fullAuto,
      additionalArgs: request.additionalArgs,
      images: imagePaths,
      streamGranularity: request.streamGranularity,
    });
    return session;
  }

  const config: SessionConfig = {
    prompt: request.prompt,
    cwd: request.cwd,
    model: request.model,
    sandbox: request.sandbox,
    approvalMode: request.approvalMode,
    fullAuto: request.fullAuto,
    additionalArgs: request.additionalArgs,
    images: imagePaths,
    streamGranularity: request.streamGranularity,
  };
  return await runner.startSession(config);
}

interface NormalizedAttachments {
  readonly imagePaths: readonly string[];
  cleanup(): Promise<void>;
}

async function normalizeAttachments(
  attachments: readonly AgentAttachment[] | undefined,
): Promise<NormalizedAttachments> {
  if (attachments === undefined || attachments.length === 0) {
    return {
      imagePaths: [],
      cleanup: async () => {
        return;
      },
    };
  }

  const paths: string[] = [];
  const tempDirs: string[] = [];

  for (const attachment of attachments) {
    if (attachment.type === "path") {
      paths.push(attachment.path);
      continue;
    }

    const tempDir = await mkdtemp(join(tmpdir(), "codex-agent-attachment-"));
    tempDirs.push(tempDir);

    const parsed = parseBase64Input(attachment.data);
    const mediaType = attachment.mediaType ?? parsed.mediaType;
    const ext = extensionForMediaType(mediaType);
    const fileName = sanitizeFileName(attachment.filename, ext);
    const filePath = join(tempDir, fileName);

    const body = parsed.body;
    const content = Uint8Array.from(Buffer.from(body, "base64"));
    await writeFile(filePath, content);
    paths.push(filePath);
  }

  return {
    imagePaths: paths,
    cleanup: async () => {
      await Promise.all(
        tempDirs.map(async (dir) => {
          await rm(dir, { recursive: true, force: true });
        }),
      );
    },
  };
}

function parseBase64Input(data: string): { readonly body: string; readonly mediaType?: string } {
  if (!data.startsWith("data:")) {
    return { body: data };
  }

  const marker = ";base64,";
  const markerIndex = data.indexOf(marker);
  if (markerIndex < 0) {
    return { body: data };
  }

  const mediaType = data.slice(5, markerIndex);
  const body = data.slice(markerIndex + marker.length);
  if (mediaType.length === 0) {
    return { body };
  }
  return { body, mediaType };
}

function extensionForMediaType(mediaType: string | undefined): string {
  if (mediaType === undefined) {
    return ".img";
  }

  switch (mediaType.toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".img";
  }
}

function sanitizeFileName(filename: string | undefined, defaultExt: string): string {
  if (filename === undefined || filename.trim().length === 0) {
    return `${randomUUID()}${defaultExt}`;
  }

  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (safe.length === 0) {
    return `${randomUUID()}${defaultExt}`;
  }
  if (extname(safe).length > 0) {
    return safe;
  }
  return `${safe}${defaultExt}`;
}

function resolveSessionId(
  fallbackSessionId: string,
  chunk: SessionStreamChunk,
): string {
  if (isCharChunk(chunk)) {
    return chunk.sessionId;
  }
  if (
    chunk.type === "session_meta" &&
    typeof chunk.payload === "object" &&
    chunk.payload !== null &&
    "meta" in chunk.payload
  ) {
    const payload = chunk.payload as { readonly meta?: { readonly id?: string } };
    const candidate = payload.meta?.id;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return fallbackSessionId;
}

function isCharChunk(chunk: SessionStreamChunk): chunk is SessionCharStreamChunk {
  return (chunk as SessionCharStreamChunk).kind === "char";
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  return new Error(typeof value === "string" ? value : "Unknown runAgent error");
}

function isResumeRequest(request: AgentRequest): request is ResumeAgentRequest {
  return typeof request.sessionId === "string";
}

interface NormalizerState {
  readonly startedSessionIds: Set<string>;
  readonly assistantSnapshots: Map<string, string>;
  readonly toolNamesByCallId: Map<string, string>;
}

function createNormalizerState(): NormalizerState {
  return {
    startedSessionIds: new Set<string>(),
    assistantSnapshots: new Map<string, string>(),
    toolNamesByCallId: new Map<string, string>(),
  };
}

function normalizeChunkToEvents(
  chunk: SessionStreamChunk,
  fallbackSessionId: string,
  state: NormalizerState,
  includeSessionStarted: boolean,
): readonly AgentNormalizedChunkEvent[] {
  const sessionId = resolveSessionId(fallbackSessionId, chunk);
  const events: AgentNormalizedChunkEvent[] = [];

  if (isCharChunk(chunk)) {
    events.push(...toAssistantTextEvents(sessionId, chunk.char, state));
    return events;
  }

  if (chunk.type === "session_meta") {
    if (includeSessionStarted && !state.startedSessionIds.has(sessionId)) {
      state.startedSessionIds.add(sessionId);
      events.push({
        type: "session.started",
        sessionId,
        resumed: false,
      });
    }
    return events;
  }

  if (chunk.type === "event_msg") {
    const payload = toRecord(chunk.payload);
    if (payload === null) {
      return events;
    }

    const payloadType = readString(payload["type"]);
    if (payloadType === "AgentMessage") {
      const message = readString(payload["message"]);
      if (message !== undefined) {
        events.push(...toAssistantTextEvents(sessionId, message, state));
      }
      return events;
    }

    if (payloadType === "AgentReasoning") {
      const message = readString(payload["text"]);
      events.push({
        type: "activity",
        sessionId,
        ...(message !== undefined ? { message } : {}),
      });
      return events;
    }

    if (payloadType === "ExecCommandBegin") {
      const callId = readString(payload["call_id"]);
      const command = readStringArray(payload["command"]);
      const input = {
        callId,
        turnId: readString(payload["turn_id"]),
        cwd: readString(payload["cwd"]),
        command,
      };
      events.push({
        type: "tool.call",
        sessionId,
        name: "local_shell",
        input,
      });
      return events;
    }

    if (payloadType === "ExecCommandEnd") {
      const callId = readString(payload["call_id"]);
      const exitCode = readNumber(payload["exit_code"]);
      const output = {
        callId,
        turnId: readString(payload["turn_id"]),
        cwd: readString(payload["cwd"]),
        command: readStringArray(payload["command"]),
        exitCode,
        aggregatedOutput: payload["aggregated_output"],
      };
      events.push({
        type: "tool.result",
        sessionId,
        name: "local_shell",
        isError: exitCode !== undefined ? exitCode !== 0 : false,
        output,
      });
      return events;
    }

    if (payloadType === "Error") {
      events.push({
        type: "session.error",
        sessionId,
        error: new Error(readString(payload["message"]) ?? "Unknown rollout error"),
      });
      return events;
    }

    events.push({
      type: "activity",
      sessionId,
      message: payloadType ?? "event_msg",
    });
    return events;
  }

  if (chunk.type !== "response_item") {
    return events;
  }

  const payload = toRecord(chunk.payload);
  if (payload === null) {
    return events;
  }

  const itemType = readString(payload["type"]);
  if (itemType === "function_call") {
    const name = readString(payload["name"]) ?? "unknown-tool";
    const callId = readString(payload["call_id"]);
    if (callId !== undefined) {
      state.toolNamesByCallId.set(callId, name);
    }
    events.push({
      type: "tool.call",
      sessionId,
      name,
      input: parseMaybeJson(readString(payload["arguments"])),
    });
    return events;
  }

  if (itemType === "function_call_output") {
    const callId = readString(payload["call_id"]);
    const output = payload["output"];
    const outputRecord = toRecord(output);
    const isError =
      outputRecord?.["is_error"] === true ||
      readString(outputRecord?.["status"]) === "error";
    events.push({
      type: "tool.result",
      sessionId,
      name:
        (callId !== undefined ? state.toolNamesByCallId.get(callId) : undefined) ??
        "unknown-tool",
      isError,
      output,
    });
    return events;
  }

  if (itemType === "local_shell_call") {
    const status = readString(payload["status"]);
    const action = payload["action"];
    const output = payload["output"];
    const callId = readString(payload["call_id"]);
    const isTerminalStatus =
      status === "completed" || status === "failed" || status === "error";

    if (isTerminalStatus) {
      events.push({
        type: "tool.result",
        sessionId,
        name: "local_shell",
        isError: status !== "completed",
        output: {
          callId,
          status,
          action,
          output,
        },
      });
      return events;
    }

    events.push({
      type: "tool.call",
      sessionId,
      name: "local_shell",
      input: {
        callId,
        status,
        action,
      },
    });
    return events;
  }

  if (
    itemType === "message" &&
    readString(payload["role"]) === "assistant" &&
    Array.isArray(payload["content"])
  ) {
    for (const item of payload["content"]) {
      const content = toRecord(item);
      if (content === null) {
        continue;
      }
      const contentType = readString(content["type"]);
      if (contentType !== "output_text" && contentType !== "input_text") {
        continue;
      }
      const text = readString(content["text"]);
      if (text !== undefined && text.length > 0) {
        events.push(...toAssistantTextEvents(sessionId, text, state));
      }
    }
    return events;
  }

  return events;
}

function toAssistantTextEvents(
  sessionId: string,
  text: string,
  state: NormalizerState,
): readonly AgentNormalizedChunkEvent[] {
  const previous = state.assistantSnapshots.get(sessionId) ?? "";
  const content = `${previous}${text}`;
  state.assistantSnapshots.set(sessionId, content);
  return [
    {
      type: "assistant.delta",
      sessionId,
      text,
    },
    {
      type: "assistant.snapshot",
      sessionId,
      content,
    },
  ];
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function readStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter((item): item is string => typeof item === "string");
  return strings.length > 0 ? strings : undefined;
}

function parseMaybeJson(value: string | undefined): unknown {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
