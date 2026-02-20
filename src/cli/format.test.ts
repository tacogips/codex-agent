import { describe, expect, test } from "vitest";
import {
  formatSessionTable,
  formatSessionDetail,
  formatSessionsJson,
  formatRolloutLine,
} from "./format";
import type { CodexSession } from "../types/session";
import type { RolloutLine } from "../types/rollout";

const SAMPLE_SESSION: CodexSession = {
  id: "aaaa0000-1111-2222-3333-444455556666",
  rolloutPath: "/home/user/.codex/sessions/2025/05/07/rollout-test.jsonl",
  createdAt: new Date("2025-05-07T17:24:21Z"),
  updatedAt: new Date("2025-05-07T18:00:00Z"),
  source: "cli",
  modelProvider: "openai",
  cwd: "/home/user/project",
  cliVersion: "0.1.0",
  title: "Fix auth bug",
  firstUserMessage: "Fix auth bug",
  git: { sha: "abc123", branch: "main", origin_url: "https://github.com/test/repo" },
};

describe("formatSessionTable", () => {
  test("formats a list of sessions as a table", () => {
    const output = formatSessionTable([SAMPLE_SESSION]);
    expect(output).toContain("ID");
    expect(output).toContain("SOURCE");
    expect(output).toContain("aaaa0000");
    expect(output).toContain("cli");
    expect(output).toContain("main");
  });

  test("returns message for empty list", () => {
    const output = formatSessionTable([]);
    expect(output).toBe("No sessions found.");
  });
});

describe("formatSessionDetail", () => {
  test("formats a single session with details", () => {
    const output = formatSessionDetail(SAMPLE_SESSION);
    expect(output).toContain("aaaa0000-1111-2222-3333-444455556666");
    expect(output).toContain("cli");
    expect(output).toContain("/home/user/project");
    expect(output).toContain("openai");
    expect(output).toContain("main");
    expect(output).toContain("abc123");
  });

  test("handles session without git info", () => {
    const noGit: CodexSession = { ...SAMPLE_SESSION, git: undefined };
    const output = formatSessionDetail(noGit);
    expect(output).toContain("aaaa0000");
    expect(output).not.toContain("Branch:");
  });
});

describe("formatSessionsJson", () => {
  test("produces valid JSON", () => {
    const json = formatSessionsJson([SAMPLE_SESSION]);
    const parsed: unknown = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
  });
});

describe("formatRolloutLine", () => {
  test("formats a user message event", () => {
    const line: RolloutLine = {
      timestamp: "2025-05-07T17:25:00Z",
      type: "event_msg",
      payload: { type: "UserMessage", message: "Hello world" },
    };
    const output = formatRolloutLine(line);
    expect(output).toContain("user:");
    expect(output).toContain("Hello world");
  });

  test("formats an agent message event", () => {
    const line: RolloutLine = {
      timestamp: "2025-05-07T17:25:30Z",
      type: "event_msg",
      payload: { type: "AgentMessage", message: "I will help" },
    };
    const output = formatRolloutLine(line);
    expect(output).toContain("agent:");
    expect(output).toContain("I will help");
  });

  test("formats a session_meta line", () => {
    const line: RolloutLine = {
      timestamp: "2025-05-07T17:24:21Z",
      type: "session_meta",
      payload: { meta: { id: "test" } } as never,
    };
    const output = formatRolloutLine(line);
    expect(output).toContain("session started");
  });

  test("formats a turn context line", () => {
    const line: RolloutLine = {
      timestamp: "2025-05-07T17:24:22Z",
      type: "turn_context",
      payload: { model: "gpt-4o" },
    };
    const output = formatRolloutLine(line);
    expect(output).toContain("gpt-4o");
  });

  test("formats an exec command begin event", () => {
    const line: RolloutLine = {
      timestamp: "2025-05-07T17:26:00Z",
      type: "event_msg",
      payload: { type: "ExecCommandBegin", command: ["ls", "-la"], call_id: "c1", turn_id: "t1", cwd: "/tmp" },
    };
    const output = formatRolloutLine(line);
    expect(output).toContain("exec:");
    expect(output).toContain("ls -la");
  });

  test("formats an exec command end event", () => {
    const line: RolloutLine = {
      timestamp: "2025-05-07T17:26:05Z",
      type: "event_msg",
      payload: {
        type: "ExecCommandEnd",
        exit_code: 0,
        call_id: "c1",
        turn_id: "t1",
        command: ["ls"],
        cwd: "/tmp",
      },
    };
    const output = formatRolloutLine(line);
    expect(output).toContain("exec done:");
    expect(output).toContain("exit=0");
  });

  test("formats a token count event", () => {
    const line: RolloutLine = {
      timestamp: "2025-05-07T17:27:00Z",
      type: "event_msg",
      payload: { type: "TokenCount", total_tokens: 1500 },
    };
    const output = formatRolloutLine(line);
    expect(output).toContain("tokens:");
    expect(output).toContain("1500");
  });

  test("formats an error event", () => {
    const line: RolloutLine = {
      timestamp: "2025-05-07T17:28:00Z",
      type: "event_msg",
      payload: { type: "Error", message: "Something went wrong" },
    };
    const output = formatRolloutLine(line);
    expect(output).toContain("ERROR:");
    expect(output).toContain("Something went wrong");
  });
});
