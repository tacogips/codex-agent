import { afterEach, describe, expect, test } from "vitest";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAgent, toNormalizedEvents, type AgentEvent } from "./agent-runner";
import type { SessionStreamChunk } from "./session-runner";

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

  test("emits started event with resolved session id for new session", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-agent-run-agent-started-id-"));
    createdDirs.push(fixtureDir);

    const fakeCodexPath = join(fixtureDir, "fake-codex-started-id.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        "printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"resolved-session-001\"}'",
        "printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"agent_message\",\"text\":\"hello\"}}'",
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

    const started = events.find((event) => event.type === "session.started");
    expect(started).toBeDefined();
    expect(started?.sessionId).toBe("resolved-session-001");
  });

  test("forwards additional args for new sessions", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-agent-run-agent-new-additional-args-"));
    createdDirs.push(fixtureDir);

    const argsLogPath = join(fixtureDir, "new-additional-args.log");
    const fakeCodexPath = join(fixtureDir, "fake-codex-new-additional-args.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        `printf '%s\\n' \"$@\" > '${argsLogPath}'`,
        "printf '%s\\n' '{\"timestamp\":\"2026-01-01T00:00:00Z\",\"type\":\"session_meta\",\"payload\":{\"meta\":{\"id\":\"new-session-additional-args-001\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"cwd\":\"/tmp/project\",\"originator\":\"codex\",\"cli_version\":\"1.0.0\",\"source\":\"exec\"}}}'",
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    for await (const _event of runAgent(
      {
        prompt: "say hello",
        additionalArgs: ["--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"],
      },
      {
        codexBinary: fakeCodexPath,
      },
    )) {
      // Drain stream.
    }

    const args = await readFile(argsLogPath, "utf-8");
    expect(args).toContain("--skip-git-repo-check");
    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
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
    expect(args).toContain("exec");
    expect(args).toContain("resume");
    expect(args).toContain("--json");
    expect(args).toContain(sessionId);
    expect(args).toContain("continue");

    const hasExistingRolloutLine = events.some(
      (event) =>
        event.type === "session.message" &&
        "type" in event.chunk &&
        event.chunk.type === "session_meta",
    );
    expect(hasExistingRolloutLine).toBe(true);
  });

  test("forwards additional args for resume sessions", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-agent-run-agent-resume-additional-args-"));
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

    const sessionId = "resume-additional-args-001";
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

    const argsLogPath = join(fixtureDir, "resume-additional-args.log");
    const fakeCodexPath = join(fixtureDir, "fake-codex-resume-additional-args.sh");
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

    for await (const _event of runAgent(
      {
        sessionId,
        additionalArgs: ["--skip-git-repo-check", "--dangerously-bypass-approvals-and-sandbox"],
      },
      {
        codexBinary: fakeCodexPath,
        codexHome,
        includeExistingOnResume: true,
      },
    )) {
      // Drain stream.
    }

    const args = await readFile(argsLogPath, "utf-8");
    expect(args).toContain("exec");
    expect(args).toContain("resume");
    expect(args).toContain("--json");
    expect(args).toContain(sessionId);
    expect(args).toContain("--skip-git-repo-check");
    expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  test("resume request does not fail when session index is temporarily missing", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-agent-run-agent-resume-missing-index-"));
    createdDirs.push(fixtureDir);

    const fakeCodexPath = join(fixtureDir, "fake-codex-resume-missing-index.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        "if [ \"$1\" = \"exec\" ] && [ \"$2\" = \"--json\" ]; then",
        "  printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"missing-index-session-001\"}'",
        "  printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"agent_message\",\"text\":\"hello\"}}'",
        "  exit 0",
        "fi",
        "if [ \"$1\" = \"exec\" ] && [ \"$2\" = \"resume\" ] && [ \"$3\" = \"--json\" ] && [ \"$4\" = \"missing-index-session-001\" ] && [ \"$5\" = \"say hello again\" ]; then",
        "  sleep 0.05",
        "  exit 0",
        "fi",
        "exit 1",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    let sessionId: string | undefined;
    for await (const event of runAgent(
      {
        prompt: "say hello",
      },
      {
        codexBinary: fakeCodexPath,
      },
    )) {
      if (event.type === "session.message" || event.type === "session.completed") {
        sessionId = event.sessionId;
      }
    }

    expect(sessionId).toBe("missing-index-session-001");

    const resumeEvents: AgentEvent[] = [];
    for await (const event of runAgent(
      {
        sessionId: sessionId!,
        prompt: "say hello again",
      },
      {
        codexBinary: fakeCodexPath,
      },
    )) {
      resumeEvents.push(event);
    }

    const errorEvent = resumeEvents.find((event) => event.type === "session.error");
    expect(errorEvent).toBeUndefined();
    const completedEvent = resumeEvents.find((event) => event.type === "session.completed");
    expect(completedEvent).toBeDefined();
    if (completedEvent !== undefined) {
      expect(completedEvent.result.success).toBe(true);
    }
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

  test("streamMode normalized maps event stream to provider-agnostic events", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-agent-run-agent-normalized-event-"));
    createdDirs.push(fixtureDir);

    const fakeCodexPath = join(fixtureDir, "fake-codex-normalized-event.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        "printf '%s\\n' '{\"timestamp\":\"2026-01-01T00:00:00Z\",\"type\":\"session_meta\",\"payload\":{\"meta\":{\"id\":\"normalized-event-001\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"cwd\":\"/tmp/project\",\"originator\":\"codex\",\"cli_version\":\"1.0.0\",\"source\":\"exec\"}}}'",
        "printf '%s\\n' '{\"timestamp\":\"2026-01-01T00:00:01Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"ExecCommandBegin\",\"call_id\":\"call_1\",\"turn_id\":\"turn_1\",\"command\":[\"echo\",\"ok\"],\"cwd\":\"/tmp/project\"}}'",
        "printf '%s\\n' '{\"timestamp\":\"2026-01-01T00:00:02Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"ExecCommandEnd\",\"call_id\":\"call_1\",\"turn_id\":\"turn_1\",\"command\":[\"echo\",\"ok\"],\"cwd\":\"/tmp/project\",\"exit_code\":0,\"aggregated_output\":\"ok\"}}'",
        "printf '%s\\n' '{\"timestamp\":\"2026-01-01T00:00:03Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"AgentMessage\",\"message\":\"hello\"}}'",
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    const events: Array<Record<string, unknown>> = [];
    for await (const event of runAgent(
      {
        prompt: "say hello",
        streamMode: "normalized",
      },
      {
        codexBinary: fakeCodexPath,
      },
    )) {
      events.push(event as unknown as Record<string, unknown>);
    }

    expect(events.some((event) => event["type"] === "session.started")).toBe(true);
    expect(events.some((event) => event["type"] === "tool.call")).toBe(true);
    expect(events.some((event) => event["type"] === "tool.result")).toBe(true);
    expect(events.some((event) => event["type"] === "assistant.delta")).toBe(true);
    expect(events.some((event) => event["type"] === "assistant.snapshot")).toBe(true);

    const completed = events.find((event) => event["type"] === "session.completed");
    expect(completed).toBeDefined();
    expect(completed?.["success"]).toBe(true);
    expect(completed?.["exitCode"]).toBe(0);
  });

  test("streamMode normalized emits assistant text events on resumed sessions", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-agent-run-agent-normalized-resume-"));
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

    const sessionId = "normalized-resume-001";
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
        JSON.stringify({
          timestamp: "2026-01-01T00:00:01Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "hello again" }],
          },
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const argsLogPath = join(fixtureDir, "normalized-resume-args.log");
    const fakeCodexPath = join(fixtureDir, "fake-codex-normalized-resume.sh");
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

    const events: Array<Record<string, unknown>> = [];
    for await (const event of runAgent(
      {
        sessionId,
        prompt: "continue",
        streamMode: "normalized",
      },
      {
        codexBinary: fakeCodexPath,
        codexHome,
        includeExistingOnResume: true,
      },
    )) {
      events.push(event as unknown as Record<string, unknown>);
    }

    const args = await readFile(argsLogPath, "utf-8");
    expect(args).toContain("exec");
    expect(args).toContain("resume");
    expect(args).toContain("--json");
    expect(args).toContain(sessionId);
    expect(args).toContain("continue");

    expect(
      events.some(
        (event) => event["type"] === "assistant.delta" && event["text"] === "hello again",
      ),
    ).toBe(true);
    expect(
      events.some(
        (event) =>
          event["type"] === "assistant.snapshot" && event["content"] === "hello again",
      ),
    ).toBe(true);
  });

  test("streamMode normalized with char granularity emits deltas for resumed lines written before watch attach", async () => {
    const fixtureDir = await mkdtemp(
      join(tmpdir(), "codex-agent-run-agent-normalized-resume-char-race-"),
    );
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

    const sessionId = "normalized-resume-char-race-001";
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
        JSON.stringify({
          timestamp: "2026-01-01T00:00:01Z",
          type: "event_msg",
          payload: { type: "AgentMessage", message: "old turn" },
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const fakeCodexPath = join(fixtureDir, "fake-codex-normalized-resume-char-race.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        `printf '%s\\n' '{\"timestamp\":\"2026-01-01T00:00:02Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"AgentMessage\",\"message\":\"NEW\"}}' >> '${rolloutPath}'`,
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    const events: Array<Record<string, unknown>> = [];
    for await (const event of runAgent(
      {
        sessionId,
        prompt: "continue",
        streamGranularity: "char",
        streamMode: "normalized",
      },
      {
        codexBinary: fakeCodexPath,
        codexHome,
      },
    )) {
      events.push(event as unknown as Record<string, unknown>);
    }

    const deltas = events
      .filter((event) => event["type"] === "assistant.delta")
      .map((event) => String(event["text"] ?? ""))
      .join("");
    expect(deltas).toBe("NEW");
  });

  test("streamMode normalized with char granularity still emits deltas when session is discovered after process exit", async () => {
    const fixtureDir = await mkdtemp(
      join(tmpdir(), "codex-agent-run-agent-normalized-resume-char-discovery-"),
    );
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
    const sessionId = "normalized-resume-char-discovery-001";
    const rolloutPath = join(dayDir, `rollout-${sessionId}.jsonl`);

    const fakeCodexPath = join(
      fixtureDir,
      "fake-codex-normalized-resume-char-discovery.sh",
    );
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        "sleep 0.05",
        `mkdir -p '${dayDir}'`,
        `cat > '${rolloutPath}' <<'EOF'`,
        '{"timestamp":"2026-01-01T00:00:00Z","type":"session_meta","payload":{"meta":{"id":"normalized-resume-char-discovery-001","timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp/project","originator":"codex","cli_version":"1.0.0","source":"cli"}}}',
        '{"timestamp":"2026-01-01T00:00:01Z","type":"event_msg","payload":{"type":"AgentMessage","message":"LATE"}}',
        "EOF",
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    const events: Array<Record<string, unknown>> = [];
    for await (const event of runAgent(
      {
        sessionId,
        prompt: "continue",
        streamGranularity: "char",
        streamMode: "normalized",
      },
      {
        codexBinary: fakeCodexPath,
        codexHome,
      },
    )) {
      events.push(event as unknown as Record<string, unknown>);
    }

    const deltas = events
      .filter((event) => event["type"] === "assistant.delta")
      .map((event) => String(event["text"] ?? ""))
      .join("");
    expect(deltas).toBe("LATE");
  });

  test("streamMode normalized maps char stream to assistant.delta events", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-agent-run-agent-normalized-char-"));
    createdDirs.push(fixtureDir);

    const fakeCodexPath = join(fixtureDir, "fake-codex-normalized-char.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        "printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"normalized-char-001\"}'",
        "printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"agent_message\",\"text\":\"OK\"}}'",
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    const events: Array<Record<string, unknown>> = [];
    for await (const event of runAgent(
      {
        prompt: "say ok",
        streamGranularity: "char",
        streamMode: "normalized",
      },
      {
        codexBinary: fakeCodexPath,
      },
    )) {
      events.push(event as unknown as Record<string, unknown>);
    }

    const deltas = events
      .filter((event) => event["type"] === "assistant.delta")
      .map((event) => event["text"]);
    expect(deltas).toEqual(["O", "K"]);
  });

  test("streamMode normalized emits session.error for rollout error events", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "codex-agent-run-agent-normalized-error-"));
    createdDirs.push(fixtureDir);

    const fakeCodexPath = join(fixtureDir, "fake-codex-normalized-error.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        "printf '%s\\n' '{\"timestamp\":\"2026-01-01T00:00:00Z\",\"type\":\"session_meta\",\"payload\":{\"meta\":{\"id\":\"normalized-error-001\",\"timestamp\":\"2026-01-01T00:00:00Z\",\"cwd\":\"/tmp/project\",\"originator\":\"codex\",\"cli_version\":\"1.0.0\",\"source\":\"exec\"}}}'",
        "printf '%s\\n' '{\"timestamp\":\"2026-01-01T00:00:01Z\",\"type\":\"event_msg\",\"payload\":{\"type\":\"Error\",\"message\":\"boom\"}}'",
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    const events: Array<Record<string, unknown>> = [];
    for await (const event of runAgent(
      {
        prompt: "trigger error",
        streamMode: "normalized",
      },
      {
        codexBinary: fakeCodexPath,
      },
    )) {
      events.push(event as unknown as Record<string, unknown>);
    }

    const sessionError = events.find((event) => event["type"] === "session.error");
    expect(sessionError).toBeDefined();
  });

  test("toNormalizedEvents adapts raw message chunks", async () => {
    const chunks: SessionStreamChunk[] = [
      {
        timestamp: "2026-01-01T00:00:00Z",
        type: "session_meta",
        payload: {
          meta: {
            id: "adapter-001",
            timestamp: "2026-01-01T00:00:00Z",
            cwd: "/tmp/project",
            originator: "codex",
            cli_version: "1.0.0",
            source: "exec",
          },
        },
      },
      {
        timestamp: "2026-01-01T00:00:01Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "search",
          arguments: "{\"query\":\"hello\"}",
          call_id: "call_1",
        },
      },
      {
        timestamp: "2026-01-01T00:00:02Z",
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "call_1",
          output: {
            items: [1, 2, 3],
          },
        },
      },
      {
        timestamp: "2026-01-01T00:00:03Z",
        type: "event_msg",
        payload: {
          type: "AgentMessage",
          message: "done",
        },
      },
    ];

    async function* source(): AsyncGenerator<SessionStreamChunk, void, undefined> {
      for (const chunk of chunks) {
        yield chunk;
      }
    }

    const normalized: Array<Record<string, unknown>> = [];
    for await (const event of toNormalizedEvents(source())) {
      normalized.push(event as unknown as Record<string, unknown>);
    }

    expect(normalized.some((event) => event["type"] === "session.started")).toBe(true);
    expect(normalized.some((event) => event["type"] === "tool.call")).toBe(true);
    expect(normalized.some((event) => event["type"] === "tool.result")).toBe(true);
    expect(normalized.some((event) => event["type"] === "assistant.delta")).toBe(true);
  });
});
