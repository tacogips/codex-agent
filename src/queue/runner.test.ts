import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { addPrompt, createQueue, findQueue, toggleQueueCommandMode } from ".";
import { runQueue } from "./runner";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("runQueue", () => {
  it("preserves command mode when persisting execution status", async () => {
    const configDir = await makeTempDir("codex-agent-queue-runner-config-");
    const projectDir = await makeTempDir("codex-agent-queue-runner-project-");
    const fakeCodexPath = join(projectDir, "fake-codex.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        'printf \'%s\\n\' \'{"timestamp":"2026-03-16T00:00:00.000Z","type":"event_msg","payload":{"type":"TurnComplete","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\'',
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    const queue = await createQueue("demo-queue", projectDir, configDir);
    const prompt = await addPrompt(queue.id, "hello", undefined, configDir);
    const toggled = await toggleQueueCommandMode(
      queue.id,
      prompt.id,
      "manual",
      configDir,
    );
    expect(toggled).toBe(true);

    const runnableQueue = await findQueue(queue.id, configDir);
    expect(runnableQueue).not.toBeNull();

    const events = [];
    for await (const event of runQueue(
      runnableQueue!,
      { codexBinary: fakeCodexPath, configDir },
      { stopped: false },
    )) {
      events.push(event.type);
    }

    expect(events).toContain("prompt_completed");
    const persisted = await findQueue(queue.id, configDir);
    expect(persisted?.prompts[0]?.status).toBe("completed");
    expect(persisted?.prompts[0]?.mode).toBe("manual");
  });
});
