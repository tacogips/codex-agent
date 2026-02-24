import { EventEmitter } from "node:events";
import { ProcessManager } from "../process/manager";
import type {
  ApprovalMode,
  CodexProcessOptions,
  ExecStreamResult,
  SandboxMode,
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
  readonly images?: readonly string[] | undefined;
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

interface RunningSessionState {
  completed: boolean;
  completionResolver: ((result: SessionResult) => void) | null;
  completionPromise: Promise<SessionResult>;
  queued: RolloutLine[];
  waiter: (() => void) | null;
  messageCount: number;
}

export class RunningSession extends EventEmitter {
  private _sessionId: string;
  private readonly allowSessionIdUpdate: boolean;
  private readonly pm: ProcessManager;
  private readonly processId: string;
  private readonly startedAt: Date;
  private readonly state: RunningSessionState;
  private stopHook: (() => void) | null = null;

  constructor(
    sessionId: string,
    pm: ProcessManager,
    processId: string,
    startedAt: Date,
    allowSessionIdUpdate = true,
  ) {
    super();
    this._sessionId = sessionId;
    this.allowSessionIdUpdate = allowSessionIdUpdate;
    this.pm = pm;
    this.processId = processId;
    this.startedAt = startedAt;
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
    this.state.queued.push(line);
    this.emit("message", line);
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

  async *messages(): AsyncGenerator<RolloutLine, void, undefined> {
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
        images: config.images,
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
    if (sessionInfo === null) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const startedAt = new Date();
    const proc = this.pm.spawnResume(sessionId, {
      ...options,
      codexBinary: this.options.codexBinary,
    });
    const running = new RunningSession(
      sessionId,
      this.pm,
      proc.id,
      startedAt,
      false,
    );
    this.trackSession(running);

    const watcher = new RolloutWatcher();
    watcher.on("line", (_path, line) => {
      running.pushLine(line);
    });

    const includeExisting = this.options.includeExistingOnResume === true;
    if (includeExisting) {
      const existing = await readRollout(sessionInfo.rolloutPath);
      for (const line of existing) {
        running.pushLine(line);
      }
    }

    await watcher.watchFile(sessionInfo.rolloutPath);
    running.setStopHook(() => watcher.stop());

    if (prompt !== undefined && prompt.trim().length > 0) {
      this.pm.writeInput(proc.id, prompt + "\n");
    }

    void waitForExit(this.pm, proc.id).then((exitCode) => {
      watcher.stop();
      running.finish(exitCode);
    });

    return running;
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
      images: config.images,
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
