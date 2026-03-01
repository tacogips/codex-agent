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
    const missingDir = join(
      tmpdir(),
      `codex-agent-missing-${Date.now().toString()}`,
    );

    const stats = await getCodexUsageStats({
      codexSessionsDir: missingDir,
    });

    expect(stats).toBeNull();
  });

  it("aggregates usage, messages, and daily activity from rollout JSONL files", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-20T12:00:00.000Z"));

    const sessionsDir = await createSessionsDir();
    await writeRollout(sessionsDir, "2026/02/18/rollout-aaa.jsonl", [
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
    ]);

    await writeRollout(sessionsDir, "2026/02/19/rollout-bbb.jsonl", [
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
    ]);

    await writeRollout(sessionsDir, "2026/02/20/rollout-ccc.jsonl", [
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
    ]);

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
    const rolloutPath = await writeRollout(
      sessionsDir,
      "2026/02/20/rollout-cache.jsonl",
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
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
          },
        }),
      ],
    );

    const first = await getCodexUsageStats({
      codexSessionsDir: sessionsDir,
      recentDays: 1,
    });
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

    const cached = await getCodexUsageStats({
      codexSessionsDir: sessionsDir,
      recentDays: 1,
    });
    expect(cached?.modelUsage["gpt-5"]?.inputTokens).toBe(1);

    vi.advanceTimersByTime(5001);

    const refreshed = await getCodexUsageStats({
      codexSessionsDir: sessionsDir,
      recentDays: 1,
    });
    expect(refreshed?.modelUsage["gpt-5"]?.inputTokens).toBe(99);
  });

  it("aggregates usage from event_msg token_count payloads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-11T12:00:00.000Z"));

    const sessionsDir = await createSessionsDir();
    await writeRollout(sessionsDir, "2026/02/10/rollout-token-count.jsonl", [
      line("2026-02-10T09:00:00.000Z", "session_meta", {
        meta: {
          id: "sess-token-count",
          timestamp: "2026-02-10T09:00:00.000Z",
          cwd: "/tmp/work",
          originator: "codex",
          cli_version: "1.0.0",
          source: "cli",
        },
      }),
      line("2026-02-10T09:00:05.000Z", "event_msg", {
        type: "token_count",
        info: {
          model: "gpt-5-codex",
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 20,
            output_tokens: 30,
            total_tokens: 150,
          },
        },
      }),
    ]);

    const stats = await getCodexUsageStats({
      codexSessionsDir: sessionsDir,
      recentDays: 2,
    });

    expect(stats).not.toBeNull();
    expect(stats?.totalSessions).toBe(1);
    expect(stats?.modelUsage).toEqual({
      "gpt-5-codex": {
        inputTokens: 100,
        outputTokens: 30,
        cacheReadInputTokens: 20,
        cacheCreationInputTokens: 0,
      },
    });
    expect(stats?.recentDailyActivity).toEqual([
      {
        date: "2026-02-10",
        sessionCount: 1,
        tokensByModel: {
          "gpt-5-codex": 150,
        },
      },
      { date: "2026-02-11" },
    ]);
  });

  it("aggregates mixed TurnComplete and token_count usage and ignores partial token_count payloads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-12T12:00:00.000Z"));

    const sessionsDir = await createSessionsDir();
    await writeRollout(sessionsDir, "2026/02/12/rollout-mixed-usage.jsonl", [
      line("2026-02-12T09:00:00.000Z", "session_meta", {
        meta: {
          id: "sess-mixed",
          timestamp: "2026-02-12T09:00:00.000Z",
          cwd: "/tmp/work",
          originator: "codex",
          cli_version: "1.0.0",
          source: "cli",
        },
      }),
      line("2026-02-12T09:00:01.000Z", "event_msg", {
        type: "TurnComplete",
        usage: {
          model: "gpt-5",
          input_tokens: 1,
          output_tokens: 2,
          total_tokens: 3,
        },
      }),
      line("2026-02-12T09:00:02.000Z", "event_msg", {
        type: "token_count",
        info: {
          model: "gpt-5",
          total_token_usage: {
            input_tokens: 4,
            cached_input_tokens: 1,
            output_tokens: 5,
            total_tokens: 10,
          },
        },
      }),
      line("2026-02-12T09:00:03.000Z", "event_msg", {
        type: "token_count",
        info: {},
      }),
    ]);

    const stats = await getCodexUsageStats({
      codexSessionsDir: sessionsDir,
      recentDays: 1,
    });

    expect(stats).not.toBeNull();
    expect(stats?.totalSessions).toBe(1);
    expect(stats?.modelUsage).toEqual({
      "gpt-5": {
        inputTokens: 5,
        outputTokens: 7,
        cacheReadInputTokens: 1,
        cacheCreationInputTokens: 0,
      },
    });
    expect(stats?.recentDailyActivity).toEqual([
      {
        date: "2026-02-12",
        sessionCount: 1,
        tokensByModel: {
          "gpt-5": 13,
        },
      },
    ]);
  });

  it("uses stable token_count aggregation with cumulative deltas, last_token_usage, and null info", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-13T12:00:00.000Z"));

    const sessionsDir = await createSessionsDir();
    await writeRollout(
      sessionsDir,
      "2026/02/13/rollout-token-count-dedup.jsonl",
      [
        line("2026-02-13T09:00:00.000Z", "session_meta", {
          meta: {
            id: "sess-token-dedup",
            timestamp: "2026-02-13T09:00:00.000Z",
            cwd: "/tmp/work",
            originator: "codex",
            cli_version: "1.0.0",
            source: "cli",
          },
        }),
        line("2026-02-13T09:00:01.000Z", "event_msg", {
          type: "token_count",
          info: {
            model: "gpt-5-codex",
            total_token_usage: {
              input_tokens: 50,
              cached_input_tokens: 10,
              output_tokens: 40,
              total_tokens: 100,
            },
          },
        }),
        line("2026-02-13T09:00:02.000Z", "event_msg", {
          type: "token_count",
          info: {
            model: "gpt-5-codex",
            total_token_usage: {
              input_tokens: 50,
              cached_input_tokens: 10,
              output_tokens: 40,
              total_tokens: 100,
            },
          },
        }),
        line("2026-02-13T09:00:03.000Z", "event_msg", {
          type: "token_count",
          info: {
            model: "gpt-5-codex",
            total_token_usage: {
              input_tokens: 70,
              cached_input_tokens: 10,
              output_tokens: 70,
              total_tokens: 140,
            },
          },
        }),
        line("2026-02-13T09:00:04.000Z", "event_msg", {
          type: "token_count",
          info: {
            model: "gpt-5-codex",
            last_token_usage: {
              input_tokens: 3,
              cached_input_tokens: 1,
              output_tokens: 2,
              total_tokens: 6,
            },
          },
        }),
        line("2026-02-13T09:00:05.000Z", "event_msg", {
          type: "token_count",
          info: null,
        }),
      ],
    );

    const stats = await getCodexUsageStats({
      codexSessionsDir: sessionsDir,
      recentDays: 1,
    });

    expect(stats).not.toBeNull();
    expect(stats?.totalSessions).toBe(1);
    expect(stats?.modelUsage).toEqual({
      "gpt-5-codex": {
        inputTokens: 73,
        outputTokens: 72,
        cacheReadInputTokens: 11,
        cacheCreationInputTokens: 0,
      },
    });
    expect(stats?.recentDailyActivity).toEqual([
      {
        date: "2026-02-13",
        sessionCount: 1,
        tokensByModel: {
          "gpt-5-codex": 146,
        },
      },
    ]);
  });

  it("counts repeated identical last_token_usage events additively", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T12:00:00.000Z"));

    const sessionsDir = await createSessionsDir();
    await writeRollout(
      sessionsDir,
      "2026/02/14/rollout-token-count-last-usage-repeat.jsonl",
      [
        line("2026-02-14T09:00:00.000Z", "session_meta", {
          meta: {
            id: "sess-last-repeat",
            timestamp: "2026-02-14T09:00:00.000Z",
            cwd: "/tmp/work",
            originator: "codex",
            cli_version: "1.0.0",
            source: "cli",
          },
        }),
        line("2026-02-14T09:00:01.000Z", "event_msg", {
          type: "token_count",
          info: {
            model: "gpt-5-codex",
            last_token_usage: {
              input_tokens: 1,
              output_tokens: 1,
              total_tokens: 2,
            },
          },
        }),
        line("2026-02-14T09:00:02.000Z", "event_msg", {
          type: "token_count",
          info: {
            model: "gpt-5-codex",
            last_token_usage: {
              input_tokens: 1,
              output_tokens: 1,
              total_tokens: 2,
            },
          },
        }),
      ],
    );

    const stats = await getCodexUsageStats({
      codexSessionsDir: sessionsDir,
      recentDays: 1,
    });

    expect(stats).not.toBeNull();
    expect(stats?.totalSessions).toBe(1);
    expect(stats?.modelUsage).toEqual({
      "gpt-5-codex": {
        inputTokens: 2,
        outputTokens: 2,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    });
    expect(stats?.recentDailyActivity).toEqual([
      {
        date: "2026-02-14",
        sessionCount: 1,
        tokensByModel: {
          "gpt-5-codex": 4,
        },
      },
    ]);
  });

  it("treats lower cumulative total_token_usage as a new sequence for same model key", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T12:00:00.000Z"));

    const sessionsDir = await createSessionsDir();
    await writeRollout(
      sessionsDir,
      "2026/02/15/rollout-token-count-collision-reset.jsonl",
      [
        line("2026-02-15T09:00:00.000Z", "session_meta", {
          meta: {
            id: "sess-collision-reset",
            timestamp: "2026-02-15T09:00:00.000Z",
            cwd: "/tmp/work",
            originator: "codex",
            cli_version: "1.0.0",
            source: "cli",
          },
        }),
        line("2026-02-15T09:00:01.000Z", "event_msg", {
          type: "token_count",
          info: {
            model: "gpt-5-codex",
            total_token_usage: {
              input_tokens: 60,
              output_tokens: 40,
              total_tokens: 100,
            },
          },
        }),
        line("2026-02-15T09:00:02.000Z", "event_msg", {
          type: "token_count",
          info: {
            model: "gpt-5-codex",
            total_token_usage: {
              input_tokens: 30,
              output_tokens: 20,
              total_tokens: 50,
            },
          },
        }),
      ],
    );

    const stats = await getCodexUsageStats({
      codexSessionsDir: sessionsDir,
      recentDays: 1,
    });

    expect(stats).not.toBeNull();
    expect(stats?.totalSessions).toBe(1);
    expect(stats?.modelUsage).toEqual({
      "gpt-5-codex": {
        inputTokens: 90,
        outputTokens: 60,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    });
    expect(stats?.recentDailyActivity).toEqual([
      {
        date: "2026-02-15",
        sessionCount: 1,
        tokensByModel: {
          "gpt-5-codex": 150,
        },
      },
    ]);
  });

  it("tracks cumulative token_count deltas across rollout files", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-16T12:00:00.000Z"));

    const sessionsDir = await createSessionsDir();
    await writeRollout(
      sessionsDir,
      "2026/02/16/rollout-token-count-part1.jsonl",
      [
        line("2026-02-16T09:00:00.000Z", "session_meta", {
          meta: {
            id: "sess-part-1",
            timestamp: "2026-02-16T09:00:00.000Z",
            cwd: "/tmp/work",
            originator: "codex",
            cli_version: "1.0.0",
            source: "cli",
          },
        }),
        line("2026-02-16T09:00:01.000Z", "event_msg", {
          type: "token_count",
          info: {
            model: "gpt-5-codex",
            total_token_usage: {
              input_tokens: 60,
              output_tokens: 40,
              total_tokens: 100,
            },
          },
        }),
      ],
    );
    await writeRollout(
      sessionsDir,
      "2026/02/16/rollout-token-count-part2.jsonl",
      [
        line("2026-02-16T10:00:00.000Z", "session_meta", {
          meta: {
            id: "sess-part-2",
            timestamp: "2026-02-16T10:00:00.000Z",
            cwd: "/tmp/work",
            originator: "codex",
            cli_version: "1.0.0",
            source: "cli",
          },
        }),
        line("2026-02-16T10:00:01.000Z", "event_msg", {
          type: "token_count",
          info: {
            model: "gpt-5-codex",
            total_token_usage: {
              input_tokens: 72,
              output_tokens: 48,
              total_tokens: 120,
            },
          },
        }),
      ],
    );

    const stats = await getCodexUsageStats({
      codexSessionsDir: sessionsDir,
      recentDays: 1,
    });

    expect(stats).not.toBeNull();
    expect(stats?.totalSessions).toBe(2);
    expect(stats?.modelUsage).toEqual({
      "gpt-5-codex": {
        inputTokens: 72,
        outputTokens: 48,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    });
    expect(stats?.recentDailyActivity).toEqual([
      {
        date: "2026-02-16",
        sessionCount: 2,
        tokensByModel: {
          "gpt-5-codex": 120,
        },
      },
    ]);
  });

  it("supports both nested and legacy session_meta timestamp payload shapes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-02T12:00:00.000Z"));

    const sessionsDir = await createSessionsDir();

    await writeRollout(
      sessionsDir,
      "2026/02/01/rollout-nested-session-meta.jsonl",
      [
        line("invalid-line-timestamp", "session_meta", {
          meta: {
            id: "sess-nested",
            timestamp: "2026-02-01T09:00:00.000Z",
            cwd: "/tmp/work",
          },
        }),
      ],
    );

    await writeRollout(
      sessionsDir,
      "2026/02/02/rollout-legacy-session-meta.jsonl",
      [
        line("invalid-line-timestamp", "session_meta", {
          id: "sess-legacy",
          timestamp: "2026-02-02T08:00:00.000Z",
          cwd: "/tmp/work",
        }),
      ],
    );

    const stats = await getCodexUsageStats({
      codexSessionsDir: sessionsDir,
      recentDays: 2,
    });

    expect(stats).not.toBeNull();
    expect(stats?.totalSessions).toBe(2);
    expect(stats?.totalMessages).toBe(0);
    expect(stats?.firstSessionDate).toBe("2026-02-01");
    expect(stats?.recentDailyActivity).toEqual([
      { date: "2026-02-01", sessionCount: 1 },
      { date: "2026-02-02", sessionCount: 1 },
    ]);
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
