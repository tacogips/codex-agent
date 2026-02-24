import { afterEach, describe, expect, test } from "vitest";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAgent, type AgentEvent } from "./agent-runner";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("runAgent", () => {
  test("starts a new session through a stable request object", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-agent-run-agent-new-"));
    createdDirs.push(fixtureDir);

    const argsLogPath = join(fixtureDir, "args.log");
    const fakeCodexPath = join(fixtureDir, "fake-codex.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        `printf '%s\\n' \"$@\" > '${argsLogPath}'`,
        "printf '%s\\n' '{\"timestamp\":\"2026-01-01T00:00:00Z\",\"type\":\"session_meta\",\"payload\":{\"meta\":{\"id\":\"new-session-001\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"cwd\":\"/tmp/project\",\"originator\":\"codex\",\"cli_version\":\"1.0.0\",\"source\":\"exec\"}}}'",
        "printf '%s\\n' '{\"timestamp\":\"2026-01-01T00:00:01Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"AgentMessage\",\"message\":\"hello\"}}'",
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    const events: AgentEvent[] = [];
    for await (const event of runAgent(
      {
        prompt: "Analyze project state",
      },
      {
        codexBinary: fakeCodexPath,
      },
    )) {
      events.push(event);
    }

    const args = await readFile(argsLogPath, "utf-8");
    expect(args).toContain("exec");
    expect(args).toContain("--json");
    expect(args).not.toContain("resume");

    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toContain("session.started");
    expect(eventTypes).toContain("session.message");
    expect(eventTypes).toContain("session.completed");
  });

  test("uses the same API for resume flow while keeping command details internal", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-agent-run-agent-resume-"));
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

    const sessionId = "resume-stable-api-001";
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
    const fakeCodexPath = join(fixtureDir, "fake-codex-resume.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        `printf '%s\\n' \"$@\" > '${argsLogPath}'`,
        "sleep 0.1",
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    const events: AgentEvent[] = [];
    for await (const event of runAgent(
      {
        sessionId,
        prompt: "continue",
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
    expect(args).toContain("resume");
    expect(args).toContain(sessionId);

    const hasExistingRolloutLine = events.some(
      (event) =>
        event.type === "session.message" &&
        "type" in event.chunk &&
        event.chunk.type === "session_meta",
    );
    expect(hasExistingRolloutLine).toBe(true);
  });

  test("normalizes base64 attachments internally and passes only image file paths", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-agent-run-agent-attachment-"));
    createdDirs.push(fixtureDir);

    const argsLogPath = join(fixtureDir, "attachment-args.log");
    const imageDumpPath = join(fixtureDir, "image.bin");
    const fakeCodexPath = join(fixtureDir, "fake-codex-attachment.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        `args_log='${argsLogPath}'`,
        `image_dump='${imageDumpPath}'`,
        "while [ $# -gt 0 ]; do",
        "  if [ \"$1\" = \"--image\" ]; then",
        "    printf 'IMAGE:%s\\n' \"$2\" >> \"$args_log\"",
        "    cp \"$2\" \"$image_dump\"",
        "    shift 2",
        "  else",
        "    printf 'ARG:%s\\n' \"$1\" >> \"$args_log\"",
        "    shift",
        "  fi",
        "done",
        "printf '%s\\n' '{\"timestamp\":\"2026-01-01T00:00:00Z\",\"type\":\"session_meta\",\"payload\":{\"meta\":{\"id\":\"attachment-session-001\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"cwd\":\"/tmp/project\",\"originator\":\"codex\",\"cli_version\":\"1.0.0\",\"source\":\"exec\"}}}'",
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    const base64Payload = Buffer.from("hello-image-data", "utf-8").toString("base64");
    const events: AgentEvent[] = [];
    for await (const event of runAgent(
      {
        prompt: "inspect",
        attachments: [
          {
            type: "base64",
            data: base64Payload,
            mediaType: "image/png",
            filename: "inline-image",
          },
        ],
      },
      {
        codexBinary: fakeCodexPath,
      },
    )) {
      events.push(event);
    }

    const args = await readFile(argsLogPath, "utf-8");
    const imageArgLine = args
      .split("\n")
      .find((line) => line.startsWith("IMAGE:"));

    expect(imageArgLine).toBeDefined();
    expect(imageArgLine).not.toContain(base64Payload);
    expect(imageArgLine).toContain("inline-image.png");

    const captured = await readFile(imageDumpPath);
    expect(captured.toString("utf-8")).toBe("hello-image-data");

    const completedEvent = events.find((event) => event.type === "session.completed");
    expect(completedEvent).toBeDefined();
  });

  test("emits session.message for exec-stream item.completed agent_message", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-agent-run-agent-exec-stream-"));
    createdDirs.push(fixtureDir);

    const fakeCodexPath = join(fixtureDir, "fake-codex-exec-stream.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        "printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"exec-thread-001\"}'",
        "printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"agent_message\",\"text\":\"hello from exec\"}}'",
        "printf '%s\\n' '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":1,\"output_tokens\":2,\"total_tokens\":3}}'",
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

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
        chunk.payload.message === "hello from exec"
      );
    });
    expect(agentMessageEvent).toBeDefined();
  });
});
