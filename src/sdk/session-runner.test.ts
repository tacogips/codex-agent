import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionRunner } from "./session-runner";

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
});
