import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { searchSessionTranscript, searchSessions } from "./search";

const TEST_DIR = join(tmpdir(), `codex-agent-test-search-${Date.now()}`);

async function writeRollout(
  codexHome: string,
  datePath: readonly [string, string, string],
  sessionId: string,
  cwd: string,
  lines: readonly string[],
): Promise<string> {
  const [y, m, d] = datePath;
  const dir = join(codexHome, "sessions", y, m, d);
  await mkdir(dir, { recursive: true });
  const path = join(dir, `rollout-${sessionId}.jsonl`);

  const meta = JSON.stringify({
    timestamp: "2026-02-27T10:00:00.000Z",
    type: "session_meta",
    payload: {
      meta: {
        id: sessionId,
        timestamp: "2026-02-27T10:00:00.000Z",
        cwd,
        originator: "codex",
        cli_version: "1.0.0",
        source: "cli",
      },
      git: {
        branch: "main",
      },
    },
  });

  await writeFile(path, [meta, ...lines].join("\n") + "\n", "utf-8");
  return path;
}

function userMessage(text: string): string {
  return JSON.stringify({
    timestamp: "2026-02-27T10:00:01.000Z",
    type: "event_msg",
    payload: {
      type: "UserMessage",
      message: text,
    },
  });
}

function agentMessage(text: string): string {
  return JSON.stringify({
    timestamp: "2026-02-27T10:00:02.000Z",
    type: "event_msg",
    payload: {
      type: "AgentMessage",
      message: text,
    },
  });
}

function assistantResponseText(text: string): string {
  return JSON.stringify({
    timestamp: "2026-02-27T10:00:03.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text }],
    },
  });
}

describe("session search", () => {
  const codexHome = TEST_DIR;

  beforeAll(async () => {
    await mkdir(codexHome, { recursive: true });

    await writeRollout(
      codexHome,
      ["2026", "02", "27"],
      "session-a",
      "/workspace/a",
      [
        userMessage("Need help with performance tuning"),
        agentMessage("Try batching to improve throughput"),
        assistantResponseText("もう一度 試してください"),
      ],
    );

    const longLines: string[] = [userMessage("start")];
    for (let i = 0; i < 2000; i += 1) {
      longLines.push(agentMessage(`filler-line-${i}`));
    }
    longLines.push(agentMessage("needle-at-tail"));

    await writeRollout(
      codexHome,
      ["2026", "02", "26"],
      "session-long",
      "/workspace/a",
      longLines,
    );

    await writeRollout(
      codexHome,
      ["2026", "02", "25"],
      "session-b",
      "/workspace/b",
      [userMessage("Different project"), agentMessage("No keyword here")],
    );
  });

  afterAll(async () => {
    await rm(codexHome, { recursive: true, force: true });
  });

  test("finds Japanese text in transcript", async () => {
    const result = await searchSessionTranscript("session-a", "もう一度", {
      codexHome,
    });

    expect(result.matched).toBe(true);
    expect(result.matchCount).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });

  test("supports case-sensitive and role filtering", async () => {
    const insensitive = await searchSessionTranscript(
      "session-a",
      "performance",
      {
        codexHome,
        role: "user",
      },
    );
    const sensitiveMiss = await searchSessionTranscript(
      "session-a",
      "PERFORMANCE",
      {
        codexHome,
        role: "user",
        caseSensitive: true,
      },
    );
    const assistantMiss = await searchSessionTranscript(
      "session-a",
      "performance",
      {
        codexHome,
        role: "assistant",
      },
    );

    expect(insensitive.matched).toBe(true);
    expect(sensitiveMiss.matched).toBe(false);
    expect(assistantMiss.matched).toBe(false);
  });

  test("scans deep transcripts and finds matches near tail", async () => {
    const result = await searchSessionTranscript(
      "session-long",
      "needle-at-tail",
      {
        codexHome,
      },
    );

    expect(result.matched).toBe(true);
    expect(result.scannedEvents).toBeGreaterThan(1500);
  });

  test("honors event budget and truncates deterministically", async () => {
    const result = await searchSessionTranscript(
      "session-long",
      "needle-at-tail",
      {
        codexHome,
        maxEvents: 200,
      },
    );

    expect(result.matched).toBe(false);
    expect(result.truncated).toBe(true);
    expect(result.scannedEvents).toBe(200);
  });

  test("searches across sessions with filters and pagination", async () => {
    const result = await searchSessions("keyword", {
      codexHome,
      offset: 0,
      limit: 10,
    });

    expect(result.sessionIds).toEqual(["session-b"]);
    expect(result.total).toBe(1);

    const filtered = await searchSessions("performance", {
      codexHome,
      cwd: "/workspace/a",
      role: "user",
      limit: 1,
      offset: 0,
    });

    expect(filtered.sessionIds).toEqual(["session-a"]);
    expect(filtered.total).toBe(1);
  });

  test("fails for empty query", async () => {
    await expect(searchSessions("   ", { codexHome })).rejects.toThrow(
      "query must not be empty",
    );
  });
});
