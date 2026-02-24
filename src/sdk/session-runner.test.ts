import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, mkdir, rm, writeFile, chmod, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionRunner } from "./session-runner";
import type { RolloutLine } from "../types/rollout";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("SessionRunner", () => {
  test("startSession returns completion result", async () => {
    const runner = new SessionRunner({ codexBinary: "echo" });
    const session = await runner.startSession({ prompt: "hello" });
    const result = await session.waitForCompletion();

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  test("resumeSession streams existing rollout lines when enabled", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-agent-sdk-home-"));
    createdDirs.push(codexHome);

    const sessionId = "test-session-001";
    const now = new Date();
    const dir = join(
      codexHome,
      "sessions",
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    );
    await mkdir(dir, { recursive: true });

    const rolloutPath = join(dir, `rollout-${sessionId}.jsonl`);
    const lines = [
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
      JSON.stringify({
        timestamp: "2026-01-01T00:00:01Z",
        type: "event_msg",
        payload: { type: "AgentMessage", message: "hello" },
      }),
    ];
    await writeFile(rolloutPath, lines.join("\n") + "\n");

    const runner = new SessionRunner({
      codexBinary: "echo",
      codexHome,
      includeExistingOnResume: true,
    });

    const session = await runner.resumeSession(sessionId);
    const streamed = [];
    for await (const line of session.messages()) {
      streamed.push(line);
    }
    const result = await session.waitForCompletion();

    expect(result.success).toBe(true);
    expect(streamed.length).toBeGreaterThanOrEqual(2);
    expect(session.sessionId).toBe(sessionId);
  });

  test("resumeSession keeps requested session id when rollout meta differs", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-agent-sdk-home-"));
    createdDirs.push(codexHome);

    const requestedSessionId = "requested-session-001";
    const emittedSessionId = "unexpected-new-session-999";
    const now = new Date();
    const dir = join(
      codexHome,
      "sessions",
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    );
    await mkdir(dir, { recursive: true });

    const rolloutPath = join(dir, `rollout-${requestedSessionId}.jsonl`);
    const lines = [
      JSON.stringify({
        timestamp: "2026-01-01T00:00:00Z",
        type: "session_meta",
        payload: {
          meta: {
            id: requestedSessionId,
            timestamp: "2026-01-01T00:00:00Z",
            cwd: "/tmp/project",
            originator: "codex",
            cli_version: "1.0.0",
            source: "cli",
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-01-01T00:00:01Z",
        type: "event_msg",
        payload: { type: "AgentMessage", message: "hello" },
      }),
    ];
    await writeFile(rolloutPath, lines.join("\n") + "\n");
    const fakeCodexPath = join(codexHome, "fake-codex.sh");
    await writeFile(
      fakeCodexPath,
      "#!/usr/bin/env bash\nsleep 0.3\nexit 0\n",
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    const runner = new SessionRunner({
      codexBinary: fakeCodexPath,
      codexHome,
      includeExistingOnResume: true,
    });

    const session = await runner.resumeSession(requestedSessionId);
    const sessionIdEvents: string[] = [];
    session.on("sessionId", (id: string) => {
      sessionIdEvents.push(id);
    });

    await appendFile(
      rolloutPath,
      JSON.stringify({
        timestamp: "2026-01-01T00:00:02Z",
        type: "session_meta",
        payload: {
          meta: {
            id: emittedSessionId,
            timestamp: "2026-01-01T00:00:02Z",
            cwd: "/tmp/project",
            originator: "codex",
            cli_version: "1.0.0",
            source: "cli",
          },
        },
      }) + "\n",
      "utf-8",
    );

    for await (const _line of session.messages()) {
      // Drain stream
    }

    const result = await session.waitForCompletion();

    expect(result.success).toBe(true);
    expect(session.sessionId).toBe(requestedSessionId);
    expect(sessionIdEvents).toEqual([]);
  });

  test("startSession supports char stream granularity with deterministic ordering", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "codex-agent-sdk-char-"));
    createdDirs.push(tempDir);
    const fakeCodexPath = join(tempDir, "fake-char-codex.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "printf '%s\\n' " +
          `'{"timestamp":"2026-01-01T00:00:00Z","type":"session_meta","payload":{"meta":{"id":"char-session-001","timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp/project","originator":"codex","cli_version":"1.0.0","source":"exec"}}}' ` +
          `'{"timestamp":"2026-01-01T00:00:01Z","type":"event_msg","payload":{"type":"TurnStarted","turn_id":"t1"}}' ` +
          `'{"timestamp":"2026-01-01T00:00:02Z","type":"event_msg","payload":{"type":"AgentMessage","message":"OK"}}' ` +
          `'{"timestamp":"2026-01-01T00:00:03Z","type":"event_msg","payload":{"type":"TurnComplete","turn_id":"t1"}}'`,
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    const runner = new SessionRunner({ codexBinary: fakeCodexPath });
    const session = await runner.startSession({
      prompt: "hello",
      streamGranularity: "char",
    });

    const messageEvents: RolloutLine[] = [];
    session.on("message", (line: RolloutLine) => {
      messageEvents.push(line);
    });

    const streamed: unknown[] = [];
    for await (const chunk of session.messages()) {
      streamed.push(chunk);
    }
    const result = await session.waitForCompletion();

    expect(result.success).toBe(true);
    expect(messageEvents).toHaveLength(4);
    expect(messageEvents.map((line) => line.type)).toEqual([
      "session_meta",
      "event_msg",
      "event_msg",
      "event_msg",
    ]);

    const normalized = streamed.map((chunk) => {
      if (isCharChunk(chunk)) {
        return `char:${chunk.char}`;
      }
      const line = chunk as RolloutLine;
      if (
        line.type === "event_msg" &&
        typeof line.payload === "object" &&
        line.payload !== null &&
        "type" in line.payload
      ) {
        return `line:${String(line.payload.type)}`;
      }
      return `line:${line.type}`;
    });
    expect(normalized).toEqual([
      "line:session_meta",
      "line:TurnStarted",
      "char:O",
      "char:K",
      "line:TurnComplete",
    ]);
  });

  test("resumeSession supports char stream granularity with existing rollout lines", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-agent-sdk-home-"));
    createdDirs.push(codexHome);

    const sessionId = "resume-char-session-001";
    const now = new Date();
    const dir = join(
      codexHome,
      "sessions",
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    );
    await mkdir(dir, { recursive: true });

    const rolloutPath = join(dir, `rollout-${sessionId}.jsonl`);
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
        JSON.stringify({
          timestamp: "2026-01-01T00:00:01Z",
          type: "event_msg",
          payload: { type: "AgentMessage", message: "hello" },
        }),
      ].join("\n") + "\n",
    );

    const runner = new SessionRunner({
      codexBinary: "echo",
      codexHome,
      includeExistingOnResume: true,
    });

    const session = await runner.resumeSession(sessionId, undefined, {
      streamGranularity: "char",
    });

    const streamed: unknown[] = [];
    for await (const chunk of session.messages()) {
      streamed.push(chunk);
    }
    const result = await session.waitForCompletion();

    expect(result.success).toBe(true);
    expect(
      streamed.some(
        (chunk) =>
          !isCharChunk(chunk) &&
          (chunk as RolloutLine).type === "session_meta",
      ),
    ).toBe(true);
    const chars = streamed
      .filter(isCharChunk)
      .map((chunk) => chunk.char)
      .join("");
    expect(chars).toBe("hello");
  });
});

function isCharChunk(
  value: unknown,
): value is { kind: "char"; char: string; source: RolloutLine } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>)["kind"] === "char" &&
    typeof (value as Record<string, unknown>)["char"] === "string" &&
    typeof (value as Record<string, unknown>)["source"] === "object"
  );
}
