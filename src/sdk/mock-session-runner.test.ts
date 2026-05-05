import { describe, expect, test } from "vitest";
import {
  MockCodexRunningSession,
  createMockCodexSessionRunner,
  type MockCodexSessionResult,
  type MockCodexSessionStreamChunk,
} from "./mock-session-runner";
import type { RolloutLine } from "../types/rollout";

function assistantLine(message: string): RolloutLine {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    type: "event_msg",
    payload: {
      type: "AgentMessage",
      message,
    },
  };
}

describe("MockCodexSessionRunner", () => {
  test("returns queued start sessions and streams messages", async () => {
    const session = new MockCodexRunningSession({
      sessionId: "mock-codex-start",
      messages: [assistantLine("hello")],
    });
    const runner = createMockCodexSessionRunner({
      startSessions: [session],
    });
    await Promise.resolve();
    await Promise.resolve();

    const running = await runner.startSession({ prompt: "start" });
    const streamed: MockCodexSessionStreamChunk[] = [];
    for await (const message of running.messages()) {
      streamed.push(message);
    }
    const result = await running.waitForCompletion();

    expect(runner.startSessionCalls).toEqual([{ config: { prompt: "start" } }]);
    expect(streamed).toEqual([assistantLine("hello")]);
    expect(result.success).toBe(true);
    expect(result.stats.messageCount).toBe(1);
  });

  test("emits queued messages and completion after session is returned", async () => {
    const line = assistantLine("observable");
    const session = new MockCodexRunningSession({
      sessionId: "mock-codex-observable",
      messages: [line],
    });
    const runner = createMockCodexSessionRunner({
      startSessions: [session],
    });

    const running = await runner.startSession({ prompt: "start" });
    const emittedMessages: MockCodexSessionStreamChunk[] = [];
    const completion = new Promise<MockCodexSessionResult>((resolve) => {
      running.once("complete", (result: unknown) => {
        resolve(result as MockCodexSessionResult);
      });
    });
    running.on("message", (message: unknown) => {
      emittedMessages.push(message);
    });

    await expect(completion).resolves.toMatchObject({
      success: true,
      stats: {
        messageCount: 1,
      },
    });
    expect(emittedMessages).toEqual([line]);
  });

  test("keeps stalled sessions open until completion is triggered", async () => {
    const session = new MockCodexRunningSession({
      sessionId: "mock-codex-stall",
      autoComplete: false,
    });
    const runner = createMockCodexSessionRunner({
      startSessions: [session],
    });

    const running = await runner.startSession({ prompt: "start" });
    const iterator = running.messages()[Symbol.asyncIterator]();
    const pending = iterator.next();
    session.pushMessage(assistantLine("after wait"));

    await expect(pending).resolves.toEqual({
      value: assistantLine("after wait"),
      done: false,
    });
    session.complete({ success: true, exitCode: 0 });
    await expect(iterator.next()).resolves.toEqual({
      value: undefined,
      done: true,
    });
    await expect(running.waitForCompletion()).resolves.toMatchObject({
      success: true,
      exitCode: 0,
    });
  });

  test("records resume calls and returns queued resumed sessions", async () => {
    const resumed = new MockCodexRunningSession({
      sessionId: "mock-codex-resume",
      messages: [assistantLine("resumed")],
    });
    const runner = createMockCodexSessionRunner({
      resumeSessions: [resumed],
    });

    const running = await runner.resumeSession(
      "mock-codex-resume",
      "continue",
      {
        model: "gpt-test",
        streamGranularity: "event",
      },
    );
    const messages: MockCodexSessionStreamChunk[] = [];
    for await (const message of running.messages()) {
      messages.push(message);
    }

    expect(runner.resumeSessionCalls).toEqual([
      {
        sessionId: "mock-codex-resume",
        prompt: "continue",
        options: {
          model: "gpt-test",
          streamGranularity: "event",
        },
      },
    ]);
    expect(messages).toEqual([assistantLine("resumed")]);
  });
});
