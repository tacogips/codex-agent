import { afterEach, describe, expect, test, vi } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { runAgent as runAgentType, AgentEvent } from "./agent-runner";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("dist runtime runAgent", () => {
  test("exports session search API from dist entrypoint", async () => {
    // @ts-expect-error dist artifact is runtime-only in this repository.
    const distModule = await import("../../dist/main.js");
    expect(typeof distModule.searchSessions).toBe("function");
    expect(typeof distModule.searchSessionTranscript).toBe("function");
    expect(typeof distModule.getCodexCliVersion).toBe("function");
    expect(typeof distModule.getToolVersions).toBe("function");
    expect(typeof distModule.getCodexUsageStats).toBe("function");
    expect(typeof distModule.toNormalizedEvents).toBe("function");
  });

  test("emits session.message for exec-stream item.completed agent_message", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-agent-dist-runtime-"));
    createdDirs.push(fixtureDir);

    const fakeCodexPath = join(fixtureDir, "fake-codex-exec-stream.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        "printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"exec-thread-001\"}'",
        "printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"agent_message\",\"text\":\"hello from dist runtime\"}}'",
        "printf '%s\\n' '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":1,\"output_tokens\":2,\"total_tokens\":3}}'",
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    // @ts-expect-error dist artifact is runtime-only in this repository.
    const distModule = await import("../../dist/main.js");
    const runAgent = distModule.runAgent as typeof runAgentType;

    const events: AgentEvent[] = [];
    for await (const event of runAgent(
      {
        prompt: "say hello",
      },
      {
        codexBinary: fakeCodexPath,
      },
    )) {
      events.push(event);
    }

    const messageEvents = events.filter(
      (event): event is Extract<AgentEvent, { type: "session.message" }> =>
        event.type === "session.message",
    );
    const agentMessageEvent = messageEvents.find((event) => {
      const chunk = event.chunk;
      if ("kind" in chunk) {
        return false;
      }
      return (
        chunk.type === "event_msg" &&
        typeof chunk.payload === "object" &&
        chunk.payload !== null &&
        "type" in chunk.payload &&
        "message" in chunk.payload &&
        chunk.payload.type === "AgentMessage" &&
        chunk.payload.message === "hello from dist runtime"
      );
    });

    expect(agentMessageEvent).toBeDefined();
  });

  test("uses exec resume --json path from dist runtime", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-agent-dist-runtime-resume-"));
    createdDirs.push(fixtureDir);

    const codexHome = join(fixtureDir, "codex-home");
    const now = new Date();
    const dayDir = join(
      codexHome,
      "sessions",
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    );
    await mkdir(dayDir, { recursive: true });

    const sessionId = "dist-runtime-resume-001";
    const rolloutPath = join(dayDir, `rollout-${sessionId}.jsonl`);
    await writeFile(
      rolloutPath,
      [
        JSON.stringify({
          timestamp: "2026-01-01T00:00:00Z",
          type: "session_meta",
          payload: {
            meta: {
              id: sessionId,
              timestamp: "2026-01-01T00:00:00Z",
              cwd: "/tmp/project",
              originator: "codex",
              cli_version: "1.0.0",
              source: "cli",
            },
          },
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const argsLogPath = join(fixtureDir, "resume-args.log");
    const fakeCodexPath = join(fixtureDir, "fake-codex-dist-resume.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        `printf '%s\\n' \"$@\" > '${argsLogPath}'`,
        "sleep 0.05",
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    // @ts-expect-error dist artifact is runtime-only in this repository.
    const distModule = await import("../../dist/main.js");
    const runAgent = distModule.runAgent as typeof runAgentType;

    const events: AgentEvent[] = [];
    for await (const event of runAgent(
      {
        sessionId,
        prompt: "continue from dist",
      },
      {
        codexBinary: fakeCodexPath,
        codexHome,
        includeExistingOnResume: true,
      },
    )) {
      events.push(event);
    }

    const args = await readFile(argsLogPath, "utf-8");
    expect(args).toContain("exec");
    expect(args).toContain("resume");
    expect(args).toContain("--json");
    expect(args).toContain(sessionId);

    const hasExistingRolloutLine = events.some(
      (event) =>
        event.type === "session.message" &&
        "type" in event.chunk &&
        event.chunk.type === "session_meta",
    );
    expect(hasExistingRolloutLine).toBe(true);
  });

  test("aggregates usage stats from dist entrypoint for session_meta timestamp variants", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-02T12:00:00.000Z"));

      const fixtureDir = await mkdtemp(join(tmpdir(), "codex-agent-dist-usage-"));
      createdDirs.push(fixtureDir);

      const sessionsDir = join(fixtureDir, "sessions");
      await mkdir(join(sessionsDir, "2026", "02", "01"), { recursive: true });
      await mkdir(join(sessionsDir, "2026", "02", "02"), { recursive: true });

      await writeFile(
        join(sessionsDir, "2026", "02", "01", "rollout-dist-usage-a.jsonl"),
        [
          JSON.stringify({
            timestamp: "invalid-line-timestamp",
            type: "session_meta",
            payload: {
              meta: {
                id: "dist-usage-a",
                timestamp: "2026-02-01T08:00:00.000Z",
                cwd: "/tmp/project",
              },
            },
          }),
          JSON.stringify({
            timestamp: "invalid-line-timestamp",
            type: "event_msg",
            payload: {
              type: "UserMessage",
              message: "hello",
            },
          }),
          JSON.stringify({
            timestamp: "invalid-line-timestamp",
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                model: "gpt-5-codex",
                stream_id: "dist-usage-stream-1",
                last_token_usage: {
                  input_tokens: 2,
                  output_tokens: 3,
                  total_tokens: 5,
                },
              },
            },
          }),
        ].join("\n") + "\n",
        "utf-8",
      );

      await writeFile(
        join(sessionsDir, "2026", "02", "02", "rollout-dist-usage-b.jsonl"),
        [
          JSON.stringify({
            timestamp: "invalid-line-timestamp",
            type: "session_meta",
            payload: {
              id: "dist-usage-b",
              timestamp: "2026-02-02T09:00:00.000Z",
              cwd: "/tmp/project",
            },
          }),
          JSON.stringify({
            timestamp: "invalid-line-timestamp",
            type: "event_msg",
            payload: {
              type: "UserMessage",
              message: "continue",
            },
          }),
          JSON.stringify({
            timestamp: "invalid-line-timestamp",
            type: "event_msg",
            payload: {
              type: "token_count",
              info: {
                model: "gpt-5-codex",
                stream_id: "dist-usage-stream-1",
                total_token_usage: {
                  input_tokens: 5,
                  output_tokens: 7,
                  total_tokens: 12,
                },
              },
            },
          }),
        ].join("\n") + "\n",
        "utf-8",
      );

      // @ts-expect-error dist artifact is runtime-only in this repository.
      const distModule = await import("../../dist/main.js");
      const getCodexUsageStats = distModule.getCodexUsageStats as (options?: {
        codexSessionsDir?: string;
        recentDays?: number;
      }) => Promise<{
        totalSessions: number;
        totalMessages: number;
        firstSessionDate: string | null;
        modelUsage: Record<
          string,
          {
            inputTokens: number;
            outputTokens: number;
            cacheReadInputTokens: number;
            cacheCreationInputTokens: number;
          }
        >;
      } | null>;

      const stats = await getCodexUsageStats({
        codexSessionsDir: sessionsDir,
        recentDays: 2,
      });

      expect(stats).not.toBeNull();
      expect(stats?.totalSessions).toBe(2);
      expect(stats?.totalMessages).toBe(2);
      expect(stats?.firstSessionDate).toBe("2026-02-01");
      expect(stats?.modelUsage).toEqual({
        "gpt-5-codex": {
          inputTokens: 7,
          outputTokens: 10,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
