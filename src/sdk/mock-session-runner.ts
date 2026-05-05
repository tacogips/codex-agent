import { EventEmitter } from "node:events";

export interface MockCodexSessionConfig {
  readonly prompt: string;
  readonly resumeSessionId?: string;
  readonly cwd?: string;
  readonly sandbox?: string;
  readonly approvalMode?: string;
  readonly fullAuto?: boolean;
  readonly model?: string;
  readonly additionalArgs?: readonly string[];
  readonly images?: readonly string[];
  readonly streamGranularity?: "event" | "char";
  readonly environmentVariables?: Readonly<Record<string, string | undefined>>;
}

export interface MockCodexResumeOptions {
  readonly cwd?: string;
  readonly sandbox?: string;
  readonly approvalMode?: string;
  readonly fullAuto?: boolean;
  readonly model?: string;
  readonly additionalArgs?: readonly string[];
  readonly images?: readonly string[];
  readonly streamGranularity?: "event" | "char";
  readonly environmentVariables?: Readonly<Record<string, string | undefined>>;
}

export interface MockCodexSessionResult {
  readonly success: boolean;
  readonly exitCode: number;
  readonly stats: {
    readonly startedAt: string;
    readonly completedAt: string;
    readonly messageCount: number;
  };
}

export type MockCodexSessionStreamChunk = unknown;

export interface MockCodexSessionResultInput {
  readonly success?: boolean;
  readonly exitCode?: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly messageCount?: number;
}

export interface MockCodexRunningSessionOptions {
  readonly sessionId: string;
  readonly messages?: readonly MockCodexSessionStreamChunk[];
  readonly result?: MockCodexSessionResultInput;
  readonly autoComplete?: boolean;
}

export interface MockCodexStartSessionCall {
  readonly config: MockCodexSessionConfig;
}

export interface MockCodexResumeSessionCall {
  readonly sessionId: string;
  readonly prompt?: string;
  readonly options?: MockCodexResumeOptions;
}

export class MockCodexRunningSession extends EventEmitter {
  readonly #sessionId: string;
  readonly #initialMessages: MockCodexSessionStreamChunk[];
  readonly #autoComplete: boolean;
  readonly #autoCompleteResult: MockCodexSessionResultInput | undefined;
  readonly #queue: MockCodexSessionStreamChunk[] = [];
  #closed = false;
  #messageCount = 0;
  #activationScheduled = false;
  #activated = false;
  #initialMessagesFlushed = false;
  #waiter: (() => void) | undefined;
  #completionResolver: ((result: MockCodexSessionResult) => void) | undefined;
  readonly #completion: Promise<MockCodexSessionResult>;

  constructor(options: MockCodexRunningSessionOptions) {
    super();
    this.#sessionId = options.sessionId;
    this.#initialMessages = [...(options.messages ?? [])];
    this.#autoComplete = options.autoComplete !== false;
    this.#autoCompleteResult = options.result;
    this.#completion = new Promise<MockCodexSessionResult>((resolve) => {
      this.#completionResolver = resolve;
    });
    this.on("newListener", (eventName) => {
      if (eventName === "message" || eventName === "complete") {
        this.#scheduleActivation();
      }
    });
  }

  get sessionId(): string {
    return this.#sessionId;
  }

  pushMessage(message: MockCodexSessionStreamChunk): void {
    this.#flushInitialMessages();
    this.#pushMessage(message);
  }

  complete(result: MockCodexSessionResultInput = {}): void {
    this.#flushInitialMessages();
    this.#complete(result);
  }

  async *messages(): AsyncGenerator<
    MockCodexSessionStreamChunk,
    void,
    undefined
  > {
    this.#activate();
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

  async waitForCompletion(): Promise<MockCodexSessionResult> {
    this.#activate();
    return await this.#completion;
  }

  async cancel(): Promise<void> {
    this.complete({ success: false, exitCode: 130 });
  }

  #scheduleActivation(): void {
    if (this.#activated || this.#activationScheduled) {
      return;
    }
    this.#activationScheduled = true;
    queueMicrotask(() => {
      this.#activationScheduled = false;
      this.#activate();
    });
  }

  #activate(): void {
    if (this.#activated) {
      return;
    }
    this.#activated = true;
    this.#flushInitialMessages();
    if (this.#autoComplete) {
      this.#complete(this.#autoCompleteResult);
    }
  }

  #flushInitialMessages(): void {
    if (this.#initialMessagesFlushed) {
      return;
    }
    this.#initialMessagesFlushed = true;
    for (const message of this.#initialMessages) {
      if (this.#closed) {
        return;
      }
      this.#pushMessage(message);
    }
  }

  #pushMessage(message: MockCodexSessionStreamChunk): void {
    if (this.#closed) {
      throw new Error(`mock codex session '${this.#sessionId}' is closed`);
    }
    this.#messageCount += 1;
    this.#queue.push(message);
    this.emit("message", message);
    this.#wake();
  }

  #complete(result: MockCodexSessionResultInput = {}): void {
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

  async startSession(
    config: MockCodexSessionConfig,
  ): Promise<MockCodexRunningSession> {
    this.startSessionCalls.push({ config });
    return this.#shiftSession(this.#startSessions, "start");
  }

  async resumeSession(
    sessionId: string,
    prompt?: string,
    options?: MockCodexResumeOptions,
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
): MockCodexSessionResult {
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
