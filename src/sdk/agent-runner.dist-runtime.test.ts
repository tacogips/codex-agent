import { afterEach, describe, expect, test } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
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
});
