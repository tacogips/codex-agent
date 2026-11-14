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

interface AgentRequestBase {
  readonly cwd?: string | undefined;
  readonly sandbox?: SandboxMode | undefined;
  readonly approvalMode?: ApprovalMode | undefined;
  readonly fullAuto?: boolean | undefined;
  readonly model?: string | undefined;
  readonly additionalArgs?: readonly string[] | undefined;
  readonly streamGranularity?: StreamGranularity | undefined;
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

export async function* runAgent(
  request: AgentRequest,
  options?: AgentRunnerOptions,
): AsyncGenerator<AgentEvent, void, undefined> {
  const runner = new SessionRunner(options);
  const normalized = await normalizeAttachments(request.attachments);
  const resumed = isResumeRequest(request);
  let currentSessionId: string | undefined =
    resumed ? request.sessionId : undefined;

  try {
    const session = await startFromRequest(runner, request, normalized.imagePaths);
    currentSessionId = session.sessionId;

    const iterator = session.messages();
    if (resumed) {
      yield {
        type: "session.started",
        sessionId: session.sessionId,
        resumed: true,
      };
    } else {
      const firstChunk = await iterator.next();
      if (firstChunk.done) {
        yield {
          type: "session.started",
          sessionId: session.sessionId,
          resumed: false,
        };
      } else {
        const startedSessionId = resolveSessionId(session.sessionId, firstChunk.value);
        currentSessionId = startedSessionId;
        yield {
          type: "session.started",
          sessionId: startedSessionId,
          resumed: false,
        };
        yield {
          type: "session.message",
          sessionId: startedSessionId,
          chunk: firstChunk.value,
        };
      }
    }

    while (true) {
      const nextChunk = await iterator.next();
      if (nextChunk.done) {
        break;
      }
      const resolvedSessionId = resolveSessionId(session.sessionId, nextChunk.value);
      currentSessionId = resolvedSessionId;
      yield {
        type: "session.message",
        sessionId: resolvedSessionId,
        chunk: nextChunk.value,
      };
    }

    const result = await session.waitForCompletion();
    yield {
      type: "session.completed",
      sessionId: currentSessionId ?? session.sessionId,
      result,
    };
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
