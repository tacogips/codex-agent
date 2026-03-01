import { EventEmitter } from "node:events";
import { ProcessManager } from "../process/manager";
import type {
  ApprovalMode,
  CodexProcessOptions,
  ExecStreamResult,
  SandboxMode,
  StreamGranularity,
} from "../process/types";
import { findSession } from "../session/index";
import type { RolloutLine } from "../types/rollout";
import { isSessionMeta } from "../types/rollout";
import { readRollout } from "../rollout/reader";
import { RolloutWatcher } from "../rollout/watcher";

export interface SessionRunnerOptions {
  readonly codexBinary?: string | undefined;
  readonly codexHome?: string | undefined;
  readonly includeExistingOnResume?: boolean | undefined;
}

export interface SessionConfig {
  readonly prompt: string;
  readonly resumeSessionId?: string | undefined;
  readonly cwd?: string | undefined;
  readonly sandbox?: SandboxMode | undefined;
  readonly approvalMode?: ApprovalMode | undefined;
  readonly fullAuto?: boolean | undefined;
  readonly model?: string | undefined;
  readonly additionalArgs?: readonly string[] | undefined;
  readonly images?: readonly string[] | undefined;
  readonly streamGranularity?: StreamGranularity | undefined;
}

export interface SessionResult {
  readonly success: boolean;
  readonly exitCode: number;
  readonly stats: {
    readonly startedAt: string;
    readonly completedAt: string;
    readonly messageCount: number;
  };
}

export interface SessionCharStreamChunk {
  readonly kind: "char";
  readonly char: string;
  readonly sessionId: string;
  readonly timestamp: string;
  readonly sourceType: RolloutLine["type"];
  readonly source: RolloutLine;
}

export type SessionStreamChunk = RolloutLine | SessionCharStreamChunk;

interface RunningSessionState {
  completed: boolean;
  completionResolver: ((result: SessionResult) => void) | null;
  completionPromise: Promise<SessionResult>;
  queued: SessionStreamChunk[];
  waiter: (() => void) | null;
  messageCount: number;
}

export class RunningSession extends EventEmitter {
  private _sessionId: string;
  private readonly allowSessionIdUpdate: boolean;
  private readonly pm: ProcessManager;
  private readonly processId: string;
  private readonly startedAt: Date;
  private readonly streamGranularity: StreamGranularity;
  private readonly state: RunningSessionState;
  private stopHook: (() => void) | null = null;

  constructor(
    sessionId: string,
    pm: ProcessManager,
    processId: string,
    startedAt: Date,
    streamGranularity: StreamGranularity,
    allowSessionIdUpdate = true,
  ) {
    super();
    this._sessionId = sessionId;
    this.allowSessionIdUpdate = allowSessionIdUpdate;
    this.pm = pm;
    this.processId = processId;
    this.startedAt = startedAt;
    this.streamGranularity = streamGranularity;
    let resolveCompletion: ((result: SessionResult) => void) | null = null;
    const completionPromise = new Promise<SessionResult>((resolve) => {
      resolveCompletion = resolve;
    });
    this.state = {
      completed: false,
      completionResolver: resolveCompletion,
      completionPromise,
      queued: [],
      waiter: null,
      messageCount: 0,
    };
  }

  get sessionId(): string {
    return this._sessionId;
  }

  setStopHook(stop: () => void): void {
    this.stopHook = stop;
  }

  pushLine(line: RolloutLine): void {
    if (
      this.allowSessionIdUpdate &&
      isSessionMeta(line) &&
      this._sessionId !== line.payload.meta.id
    ) {
      this._sessionId = line.payload.meta.id;
      this.emit("sessionId", this._sessionId);
    }
    this.state.messageCount += 1;
    this.emit("message", line);
    const chunks =
      this.streamGranularity === "char"
        ? toCharStreamChunks(line, this._sessionId)
        : [line];
    for (const chunk of chunks) {
      this.state.queued.push(chunk);
    }
    if (this.state.waiter !== null) {
      const waiter = this.state.waiter;
      this.state.waiter = null;
      waiter();
    }
  }

  finish(exitCode: number): void {
    if (this.state.completed) {
      return;
    }
    this.state.completed = true;
    const completedAt = new Date();
    const result: SessionResult = {
      success: exitCode === 0,
      exitCode,
      stats: {
        startedAt: this.startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        messageCount: this.state.messageCount,
      },
    };
    this.emit("complete", result);
    if (this.state.completionResolver !== null) {
      this.state.completionResolver(result);
      this.state.completionResolver = null;
    }
    if (this.state.waiter !== null) {
      const waiter = this.state.waiter;
      this.state.waiter = null;
      waiter();
    }
  }

  async *messages(): AsyncGenerator<SessionStreamChunk, void, undefined> {
    while (!this.state.completed || this.state.queued.length > 0) {
      while (this.state.queued.length > 0) {
        const line = this.state.queued.shift();
        if (line !== undefined) {
          yield line;
        }
      }
      if (this.state.completed) {
        break;
      }
      await new Promise<void>((resolve) => {
        this.state.waiter = resolve;
      });
    }
  }

  async waitForCompletion(): Promise<SessionResult> {
    return await this.state.completionPromise;
  }

  async cancel(): Promise<void> {
    this.stopHook?.();
    this.pm.kill(this.processId);
  }

  async interrupt(): Promise<void> {
    this.pm.writeInput(this.processId, "\u0003");
  }

  async pause(): Promise<void> {
    // Placeholder: interactive subprocess pause control is not yet implemented.
  }

  async resume(): Promise<void> {
    // Placeholder: interactive subprocess pause control is not yet implemented.
  }
}

export class SessionRunner {
  private readonly options: SessionRunnerOptions;
  private readonly pm: ProcessManager;
  private readonly active = new Set<RunningSession>();

  constructor(options?: SessionRunnerOptions) {
    this.options = options ?? {};
    this.pm = new ProcessManager(options?.codexBinary);
  }

  async startSession(config: SessionConfig): Promise<RunningSession> {
    if (config.resumeSessionId !== undefined) {
      return await this.resumeSession(config.resumeSessionId, config.prompt, {
        cwd: config.cwd,
        model: config.model,
        sandbox: config.sandbox,
        approvalMode: config.approvalMode,
        fullAuto: config.fullAuto,
        additionalArgs: config.additionalArgs,
        images: config.images,
        streamGranularity: config.streamGranularity,
      });
    }

    const startedAt = new Date();
    const options = this.toProcessOptions(config);
    const execStream = this.pm.spawnExecStream(config.prompt, options);
    const session = new RunningSession(
      `pending-${startedAt.getTime()}`,
      this.pm,
      execStream.process.id,
      startedAt,
      options.streamGranularity ?? "event",
    );

    this.trackSession(session);
    this.forwardExecStream(execStream, session);
    return session;
  }

  async resumeSession(
    sessionId: string,
    prompt?: string,
    options?: Omit<CodexProcessOptions, "codexBinary">,
  ): Promise<RunningSession> {
    const sessionInfo = await findSession(sessionId, this.options.codexHome);

    const startedAt = new Date();
    const proc = this.pm.spawnResume(sessionId, {
      ...options,
      codexBinary: this.options.codexBinary,
    }, prompt);
    const running = new RunningSession(
      sessionId,
      this.pm,
      proc.id,
      startedAt,
      options?.streamGranularity ?? "event",
      false,
    );
    this.trackSession(running);

    const watcher = new RolloutWatcher();
    watcher.on("line", (_path, line) => {
      running.pushLine(line);
    });

    const includeExisting = this.options.includeExistingOnResume === true;
    if (sessionInfo !== null) {
      if (includeExisting) {
        const existing = await readRollout(sessionInfo.rolloutPath);
        for (const line of existing) {
          running.pushLine(line);
        }
      }
      await watcher.watchFile(sessionInfo.rolloutPath);
    } else {
      void this.attachWatchWhenSessionAppears(sessionId, watcher, includeExisting);
    }
    running.setStopHook(() => watcher.stop());

    void waitForExit(this.pm, proc.id).then((exitCode) => {
      watcher.stop();
      running.finish(exitCode);
    });

    return running;
  }

  private async attachWatchWhenSessionAppears(
    sessionId: string,
    watcher: RolloutWatcher,
    includeExisting: boolean,
  ): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (watcher.isClosed) {
        return;
      }
      const discovered = await findSession(sessionId, this.options.codexHome);
      if (discovered !== null) {
        if (includeExisting) {
          const existing = await readRollout(discovered.rolloutPath);
          for (const line of existing) {
            // Existing lines are replayed only when configured.
            // Resume flow may initially start before index catches up.
            // In that case, we backfill once the rollout path appears.
            watcher.emit("line", discovered.rolloutPath, line);
          }
        }
        await watcher.watchFile(discovered.rolloutPath);
        return;
      }
      await sleep(100);
    }
  }

  listActiveSessions(): readonly RunningSession[] {
    return Array.from(this.active);
  }

  private trackSession(session: RunningSession): void {
    this.active.add(session);
    session.on("complete", () => {
      this.active.delete(session);
    });
  }

  private toProcessOptions(config: SessionConfig): CodexProcessOptions {
    return {
      codexBinary: this.options.codexBinary,
      cwd: config.cwd,
      model: config.model,
      sandbox: config.sandbox,
      approvalMode: config.approvalMode,
      fullAuto: config.fullAuto,
      additionalArgs: config.additionalArgs,
      images: config.images,
      streamGranularity: config.streamGranularity,
    };
  }

  private forwardExecStream(
    stream: ExecStreamResult,
    session: RunningSession,
  ): void {
    void (async () => {
      for await (const line of stream.lines) {
        session.pushLine(line);
      }
    })();
    void stream.completion.then((exitCode) => {
      session.finish(exitCode);
    });
  }
}

function toCharStreamChunks(
  line: RolloutLine,
  sessionId: string,
): readonly SessionStreamChunk[] {
  const textSegments = extractAssistantTextSegments(line);
  if (textSegments.length === 0) {
    return [line];
  }

  const chunks: SessionCharStreamChunk[] = [];
  for (const segment of textSegments) {
    for (const char of Array.from(segment)) {
      chunks.push({
        kind: "char",
        char,
        sessionId,
        timestamp: line.timestamp,
        sourceType: line.type,
        source: line,
      });
    }
  }
  return chunks;
}

function extractAssistantTextSegments(line: RolloutLine): readonly string[] {
  if (line.type === "event_msg") {
    const payload = toRecord(line.payload);
    if (
      payload?.["type"] === "AgentMessage" &&
      typeof payload["message"] === "string"
    ) {
      return [payload["message"]];
    }
    return [];
  }

  if (line.type !== "response_item") {
    return [];
  }
  const payload = toRecord(line.payload);
  if (
    payload?.["type"] !== "message" ||
    payload["role"] !== "assistant" ||
    !Array.isArray(payload["content"])
  ) {
    return [];
  }
  const segments: string[] = [];
  for (const item of payload["content"]) {
    const content = toRecord(item);
    if (content === null) {
      continue;
    }
    if (
      (content["type"] === "output_text" || content["type"] === "input_text") &&
      typeof content["text"] === "string" &&
      content["text"].length > 0
    ) {
      segments.push(content["text"]);
    }
  }
  return segments;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function waitForExit(pm: ProcessManager, processId: string): Promise<number> {
  while (true) {
    const process = pm.get(processId);
    if (process === null) {
      return 1;
    }
    if (process.status !== "running") {
      return process.exitCode ?? 1;
    }
    await sleep(50);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
