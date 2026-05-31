// @bun
// src/sdk/mock-session-runner.ts
import { EventEmitter } from "events";

class MockCodexRunningSession extends EventEmitter {
  #sessionId;
  #initialMessages;
  #autoComplete;
  #autoCompleteResult;
  #queue = [];
  #closed = false;
  #messageCount = 0;
  #activationScheduled = false;
  #activated = false;
  #initialMessagesFlushed = false;
  #waiter;
  #completionResolver;
  #completion;
  constructor(options) {
    super();
    this.#sessionId = options.sessionId;
    this.#initialMessages = [...options.messages ?? []];
    this.#autoComplete = options.autoComplete !== false;
    this.#autoCompleteResult = options.result;
    this.#completion = new Promise((resolve) => {
      this.#completionResolver = resolve;
    });
    this.on("newListener", (eventName) => {
      if (eventName === "message" || eventName === "complete") {
        this.#scheduleActivation();
      }
    });
  }
  get sessionId() {
    return this.#sessionId;
  }
  getState() {
    return { status: this.#closed ? "completed" : "running" };
  }
  pushMessage(message) {
    this.#flushInitialMessages();
    this.#pushMessage(message);
  }
  complete(result = {}) {
    this.#flushInitialMessages();
    this.#complete(result);
  }
  async* messages() {
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
      await new Promise((resolve) => {
        this.#waiter = resolve;
      });
    }
  }
  async waitForCompletion() {
    this.#activate();
    return await this.#completion;
  }
  async cancel() {
    this.complete({ success: false, exitCode: 130 });
  }
  #scheduleActivation() {
    if (this.#activated || this.#activationScheduled) {
      return;
    }
    this.#activationScheduled = true;
    queueMicrotask(() => {
      this.#activationScheduled = false;
      this.#activate();
    });
  }
  #activate() {
    if (this.#activated) {
      return;
    }
    this.#activated = true;
    this.#flushInitialMessages();
    if (this.#autoComplete) {
      this.#complete(this.#autoCompleteResult);
    }
  }
  #flushInitialMessages() {
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
  #pushMessage(message) {
    if (this.#closed) {
      throw new Error(`mock codex session '${this.#sessionId}' is closed`);
    }
    this.#messageCount += 1;
    this.#queue.push(message);
    this.emit("message", message);
    this.#wake();
  }
  #complete(result = {}) {
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
  #wake() {
    const waiter = this.#waiter;
    this.#waiter = undefined;
    waiter?.();
  }
}

class MockCodexSessionRunner {
  startSessionCalls = [];
  resumeSessionCalls = [];
  #startSessions = [];
  #resumeSessions = [];
  enqueueStartSession(session) {
    this.#startSessions.push(session);
  }
  enqueueResumeSession(session) {
    this.#resumeSessions.push(session);
  }
  async startSession(config) {
    this.startSessionCalls.push({ config });
    return this.#shiftSession(this.#startSessions, "start");
  }
  async resumeSession(sessionId, prompt, options) {
    this.resumeSessionCalls.push({
      sessionId,
      ...prompt === undefined ? {} : { prompt },
      ...options === undefined ? {} : { options }
    });
    return this.#shiftSession(this.#resumeSessions, "resume");
  }
  #shiftSession(sessions, kind) {
    const session = sessions.shift();
    if (session === undefined) {
      throw new Error(`mock codex ${kind} session was not enqueued`);
    }
    return session;
  }
}
function createMockCodexSessionRunner(input = {}) {
  const runner = new MockCodexSessionRunner;
  for (const session of input.startSessions ?? []) {
    runner.enqueueStartSession(session);
  }
  for (const session of input.resumeSessions ?? []) {
    runner.enqueueResumeSession(session);
  }
  return runner;
}
function buildSessionResult(input, fallbackMessageCount) {
  return {
    success: input.success ?? (input.exitCode === undefined || input.exitCode === 0),
    exitCode: input.exitCode ?? (input.success === false ? 1 : 0),
    stats: {
      startedAt: input.startedAt ?? "2026-01-01T00:00:00.000Z",
      completedAt: input.completedAt ?? "2026-01-01T00:00:01.000Z",
      messageCount: input.messageCount ?? fallbackMessageCount
    }
  };
}
export {
  createMockCodexSessionRunner,
  MockCodexSessionRunner,
  MockCodexRunningSession
};
