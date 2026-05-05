import { EventEmitter } from "node:events";
import type { CodexProcessOptions } from "../process/types";
import type {
  SessionConfig,
  SessionResult,
  SessionStreamChunk,
} from "./session-runner";

export interface MockCodexSessionResultInput {
  readonly success?: boolean;
  readonly exitCode?: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly messageCount?: number;
}

export interface MockCodexRunningSessionOptions {
  readonly sessionId: string;
  readonly messages?: readonly SessionStreamChunk[];
  readonly result?: MockCodexSessionResultInput;
  readonly autoComplete?: boolean;
}

export interface MockCodexStartSessionCall {
  readonly config: SessionConfig;
}

export interface MockCodexResumeSessionCall {
  readonly sessionId: string;
  readonly prompt?: string;
  readonly options?: Omit<CodexProcessOptions, "codexBinary">;
}

export class MockCodexRunningSession extends EventEmitter {
  readonly #sessionId: string;
  readonly #queue: SessionStreamChunk[] = [];
  #closed = false;
  #messageCount = 0;
  #waiter: (() => void) | undefined;
  #completionResolver: ((result: SessionResult) => void) | undefined;
  readonly #completion: Promise<SessionResult>;

  constructor(options: MockCodexRunningSessionOptions) {
    super();
    this.#sessionId = options.sessionId;
    this.#completion = new Promise<SessionResult>((resolve) => {
      this.#completionResolver = resolve;
    });
    for (const message of options.messages ?? []) {
      this.pushMessage(message);
    }
    if (options.autoComplete !== false) {
      queueMicrotask(() => {
        this.complete(options.result);
      });
    }
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  pushMessage(message: SessionStreamChunk): void {
    if (this.#closed) {
      throw new Error(`mock codex session '${this.#sessionId}' is closed`);
    }
    this.#messageCount += 1;
    this.#queue.push(message);
    this.emit("message", message);
    this.#wake();
  }

  complete(result: MockCodexSessionResultInput = {}): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    const completed = buildSessionResult(result, this.#messageCount);
    this.emit("complete", completed);
    this.#completionResolver?.(completed);
    this.#completionResolver = undefined;
    this.#wake();
  }

  async *messages(): AsyncGenerator<SessionStreamChunk, void, undefined> {
    while (!this.#closed || this.#queue.length > 0) {
      while (this.#queue.length > 0) {
        const message = this.#queue.shift();
        if (message !== undefined) {
          yield message;
        }
      }
      if (this.#closed) {
        break;
      }
      await new Promise<void>((resolve) => {
        this.#waiter = resolve;
      });
    }
  }

  async waitForCompletion(): Promise<SessionResult> {
    return await this.#completion;
  }

  async cancel(): Promise<void> {
    this.complete({ success: false, exitCode: 130 });
  }

  #wake(): void {
    const waiter = this.#waiter;
    this.#waiter = undefined;
    waiter?.();
  }
}

export class MockCodexSessionRunner {
  readonly startSessionCalls: MockCodexStartSessionCall[] = [];
  readonly resumeSessionCalls: MockCodexResumeSessionCall[] = [];
  readonly #startSessions: MockCodexRunningSession[] = [];
  readonly #resumeSessions: MockCodexRunningSession[] = [];

  enqueueStartSession(session: MockCodexRunningSession): void {
    this.#startSessions.push(session);
  }

  enqueueResumeSession(session: MockCodexRunningSession): void {
    this.#resumeSessions.push(session);
  }

  async startSession(config: SessionConfig): Promise<MockCodexRunningSession> {
    this.startSessionCalls.push({ config });
    return this.#shiftSession(this.#startSessions, "start");
  }

  async resumeSession(
    sessionId: string,
    prompt?: string,
    options?: Omit<CodexProcessOptions, "codexBinary">,
  ): Promise<MockCodexRunningSession> {
    this.resumeSessionCalls.push({
      sessionId,
      ...(prompt === undefined ? {} : { prompt }),
      ...(options === undefined ? {} : { options }),
    });
    return this.#shiftSession(this.#resumeSessions, "resume");
  }

  #shiftSession(
    sessions: MockCodexRunningSession[],
    kind: "start" | "resume",
  ): MockCodexRunningSession {
    const session = sessions.shift();
    if (session === undefined) {
      throw new Error(`mock codex ${kind} session was not enqueued`);
    }
    return session;
  }
}

export function createMockCodexSessionRunner(
  input: {
    readonly startSessions?: readonly MockCodexRunningSession[];
    readonly resumeSessions?: readonly MockCodexRunningSession[];
  } = {},
): MockCodexSessionRunner {
  const runner = new MockCodexSessionRunner();
  for (const session of input.startSessions ?? []) {
    runner.enqueueStartSession(session);
  }
  for (const session of input.resumeSessions ?? []) {
    runner.enqueueResumeSession(session);
  }
  return runner;
}

function buildSessionResult(
  input: MockCodexSessionResultInput,
  fallbackMessageCount: number,
): SessionResult {
  return {
    success:
      input.success ?? (input.exitCode === undefined || input.exitCode === 0),
    exitCode: input.exitCode ?? (input.success === false ? 1 : 0),
    stats: {
      startedAt: input.startedAt ?? "2026-01-01T00:00:00.000Z",
      completedAt: input.completedAt ?? "2026-01-01T00:00:01.000Z",
      messageCount: input.messageCount ?? fallbackMessageCount,
    },
  };
}
