import { describe, expect, test, beforeAll, afterAll, afterEach } from "vitest";
import { writeFile, appendFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RolloutWatcher, sessionsWatchDir } from "./watcher";
import type { RolloutLine } from "../types/rollout";

const TEST_DIR = join(tmpdir(), "codex-agent-test-watcher-" + Date.now());

function makeJsonlLine(type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    type,
    payload,
  });
}

const SESSION_META = makeJsonlLine("session_meta", {
  meta: {
    id: "test-watcher-session",
    timestamp: new Date().toISOString(),
    cwd: "/tmp",
    originator: "codex-cli",
    cli_version: "0.1.0",
    source: "cli",
  },
});

let rolloutPath: string;
let watcher: RolloutWatcher | null = null;

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
  rolloutPath = join(TEST_DIR, "rollout-test-watcher.jsonl");
  await writeFile(rolloutPath, SESSION_META + "\n", "utf-8");
});

afterEach(() => {
  watcher?.stop();
  watcher = null;
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("RolloutWatcher", () => {
  test("emits line events when file is appended to", async () => {
    watcher = new RolloutWatcher();
    const received: RolloutLine[] = [];

    watcher.on("line", (_path, line) => {
      received.push(line);
    });

    await watcher.watchFile(rolloutPath);

    // Append a new line after a short delay
    await sleep(50);
    const userMsg = makeJsonlLine("event_msg", {
      type: "UserMessage",
      message: "Hello from watcher test",
    });
    await appendFile(rolloutPath, userMsg + "\n", "utf-8");

    // Wait for debounce + processing
    await sleep(300);

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0]?.type).toBe("event_msg");
  });

  test("does not emit for content before watch started", async () => {
    const path2 = join(TEST_DIR, "rollout-pre-existing.jsonl");
    await writeFile(
      path2,
      SESSION_META + "\n" + makeJsonlLine("event_msg", { type: "UserMessage", message: "old" }) + "\n",
      "utf-8",
    );

    watcher = new RolloutWatcher();
    const received: RolloutLine[] = [];

    watcher.on("line", (_path, line) => {
      received.push(line);
    });

    await watcher.watchFile(path2);
    await sleep(200);

    // No events for pre-existing content
    expect(received).toHaveLength(0);
  });

  test("stops cleanly", async () => {
    watcher = new RolloutWatcher();
    await watcher.watchFile(rolloutPath);
    expect(watcher.isClosed).toBe(false);

    watcher.stop();
    expect(watcher.isClosed).toBe(true);

    // Appending after stop should not emit
    const received: RolloutLine[] = [];
    watcher.on("line", (_path, line) => {
      received.push(line);
    });

    await appendFile(
      rolloutPath,
      makeJsonlLine("event_msg", { type: "AgentMessage", message: "after stop" }) + "\n",
      "utf-8",
    );
    await sleep(200);
    expect(received).toHaveLength(0);
  });

  test("does not duplicate watch on same file", async () => {
    watcher = new RolloutWatcher();
    await watcher.watchFile(rolloutPath);
    await watcher.watchFile(rolloutPath); // should not throw or duplicate

    const received: RolloutLine[] = [];
    watcher.on("line", (_path, line) => {
      received.push(line);
    });

    await sleep(50);
    await appendFile(
      rolloutPath,
      makeJsonlLine("event_msg", { type: "UserMessage", message: "dedup test" }) + "\n",
      "utf-8",
    );
    await sleep(300);

    // Should only get one event, not two
    expect(received.length).toBe(1);
  });

  test("sessionsWatchDir returns correct path", () => {
    expect(sessionsWatchDir("/home/user/.codex")).toBe("/home/user/.codex/sessions");
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
