import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { getCodexUsageStats } from "./usage-stats";

const createdDirs: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    createdDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("getCodexUsageStats", () => {
  it("returns null when sessions directory does not exist", async () => {
    const missingDir = join(tmpdir(), `codex-agent-missing-${Date.now().toString()}`);

    const stats = await getCodexUsageStats({
      codexSessionsDir: missingDir,
    });

    expect(stats).toBeNull();
  });

  it("aggregates usage, messages, and daily activity from rollout JSONL files", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-20T12:00:00.000Z"));

    const sessionsDir = await createSessionsDir();
    await writeRollout(
      sessionsDir,
      "2026/02/18/rollout-aaa.jsonl",
      [
        line("2026-02-18T10:00:00.000Z", "session_meta", {
          meta: {
            id: "sess-1",
            timestamp: "2026-02-18T10:00:00.000Z",
            cwd: "/tmp/work",
            originator: "codex",
            cli_version: "1.0.0",
            source: "cli",
          },
        }),
        line("2026-02-18T10:00:03.000Z", "event_msg", {
          type: "UserMessage",
          message: "hello",
        }),
        line("2026-02-18T10:00:05.000Z", "event_msg", {
          type: "AgentMessage",
          message: "world",
        }),
        line("2026-02-18T10:00:06.000Z", "response_item", {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "done" }],
        }),
        line("2026-02-18T10:00:07.000Z", "response_item", {
          type: "function_call",
          name: "toolA",
          arguments: "{}",
          call_id: "call-1",
        }),
        line("2026-02-18T10:00:08.000Z", "event_msg", {
          type: "TurnComplete",
          usage: {
            model: "gpt-5-mini",
            input_tokens: 10,
            output_tokens: 20,
            cache_read_input_tokens: 3,
            cache_creation_input_tokens: 4,
            total_tokens: 37,
          },
        }),
      ],
    );

    await writeRollout(
      sessionsDir,
      "2026/02/19/rollout-bbb.jsonl",
      [
        line("2026-02-19T09:00:00.000Z", "session_meta", {
          meta: {
            id: "sess-2",
            timestamp: "2026-02-19T09:00:00.000Z",
            cwd: "/tmp/work",
            originator: "codex",
            cli_version: "1.0.0",
            source: "cli",
          },
        }),
        "{broken-json-line",
        line("2026-02-19T09:00:01.000Z", "event_msg", {
          type: "UserMessage",
          message: "next",
        }),
        line("2026-02-19T09:00:02.000Z", "event_msg", {
          type: "TurnComplete",
          usage: {
            model: "gpt-5",
            input_tokens: 5,
            output_tokens: 6,
            total_tokens: 11,
          },
        }),
        line("2026-02-19T09:00:03.000Z", "event_msg", {
          type: "TurnComplete",
          usage: {
            model: "gpt-5-mini",
            inputTokens: 2,
            outputTokens: 1,
            totalTokens: 3,
          },
        }),
      ],
    );

    await writeRollout(
      sessionsDir,
      "2026/02/20/rollout-ccc.jsonl",
      [
        line("2026-02-20T01:00:00.000Z", "session_meta", {
          meta: {
            id: "sess-3",
            timestamp: "2026-02-20T01:00:00.000Z",
            cwd: "/tmp/work",
            originator: "codex",
            cli_version: "1.0.0",
            source: "cli",
          },
        }),
        line("2026-02-20T01:00:01.000Z", "event_msg", {
          type: "TurnComplete",
          usage: {
            input_tokens: 1,
            output_tokens: 1,
          },
        }),
      ],
    );

    const stats = await getCodexUsageStats({
      codexSessionsDir: sessionsDir,
      recentDays: 3,
    });

    expect(stats).not.toBeNull();
    expect(stats?.totalSessions).toBe(3);
    expect(stats?.totalMessages).toBe(4);
    expect(stats?.firstSessionDate).toBe("2026-02-18");
    expect(stats?.lastComputedDate).toBe("2026-02-20");

    expect(stats?.modelUsage).toEqual({
      "gpt-5-mini": {
        inputTokens: 12,
        outputTokens: 21,
        cacheReadInputTokens: 3,
        cacheCreationInputTokens: 4,
      },
      "gpt-5": {
        inputTokens: 5,
        outputTokens: 6,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
      unknown: {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    });

    expect(stats?.recentDailyActivity).toEqual([
      {
        date: "2026-02-18",
        messageCount: 3,
        sessionCount: 1,
        toolCallCount: 1,
        tokensByModel: {
          "gpt-5-mini": 37,
        },
      },
      {
        date: "2026-02-19",
        messageCount: 1,
        sessionCount: 1,
        tokensByModel: {
          "gpt-5": 11,
          "gpt-5-mini": 3,
        },
      },
      {
        date: "2026-02-20",
        sessionCount: 1,
        tokensByModel: {
          unknown: 2,
        },
      },
    ]);
  });

  it("returns stable cached results within TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-20T12:00:00.000Z"));

    const sessionsDir = await createSessionsDir();
    const rolloutPath = await writeRollout(sessionsDir, "2026/02/20/rollout-cache.jsonl", [
      line("2026-02-20T10:00:00.000Z", "session_meta", {
        meta: {
          id: "sess-cache",
          timestamp: "2026-02-20T10:00:00.000Z",
          cwd: "/tmp/work",
          originator: "codex",
          cli_version: "1.0.0",
          source: "cli",
        },
      }),
      line("2026-02-20T10:00:02.000Z", "event_msg", {
        type: "TurnComplete",
        usage: {
          model: "gpt-5",
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
        },
      }),
    ]);

    const first = await getCodexUsageStats({ codexSessionsDir: sessionsDir, recentDays: 1 });
    expect(first?.modelUsage["gpt-5"]?.inputTokens).toBe(1);

    await writeFile(
      rolloutPath,
      [
        line("2026-02-20T10:00:00.000Z", "session_meta", {
          meta: {
            id: "sess-cache",
            timestamp: "2026-02-20T10:00:00.000Z",
            cwd: "/tmp/work",
            originator: "codex",
            cli_version: "1.0.0",
            source: "cli",
          },
        }),
        line("2026-02-20T10:00:02.000Z", "event_msg", {
          type: "TurnComplete",
          usage: {
            model: "gpt-5",
            input_tokens: 99,
            output_tokens: 1,
            total_tokens: 100,
          },
        }),
      ].join("\n"),
      "utf-8",
    );

    const cached = await getCodexUsageStats({ codexSessionsDir: sessionsDir, recentDays: 1 });
    expect(cached?.modelUsage["gpt-5"]?.inputTokens).toBe(1);

    vi.advanceTimersByTime(5001);

    const refreshed = await getCodexUsageStats({ codexSessionsDir: sessionsDir, recentDays: 1 });
    expect(refreshed?.modelUsage["gpt-5"]?.inputTokens).toBe(99);
  });
});

async function createSessionsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "codex-agent-usage-stats-"));
  createdDirs.push(dir);
  return dir;
}

async function writeRollout(
  sessionsDir: string,
  relativePath: string,
  lines: readonly string[],
): Promise<string> {
  const fullPath = join(sessionsDir, relativePath);
  const dirPath = dirname(fullPath);
  await mkdir(dirPath, { recursive: true });
  await writeFile(fullPath, lines.join("\n"), "utf-8");
  return fullPath;
}

function line(timestamp: string, type: string, payload: unknown): string {
  return JSON.stringify({ timestamp, type, payload });
}
