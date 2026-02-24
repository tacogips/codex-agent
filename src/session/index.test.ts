import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverRolloutPaths,
  buildSession,
  listSessions,
  findSession,
  findLatestSession,
} from "./index";

const TEST_DIR = join(tmpdir(), "codex-agent-test-session-" + Date.now());

function makeSessionMeta(id: string, cwd: string, source: string, branch?: string): string {
  return JSON.stringify({
    timestamp: "2025-05-07T17:24:21.123Z",
    type: "session_meta",
    payload: {
      meta: {
        id,
        timestamp: "2025-05-07T17:24:21.123Z",
        cwd,
        originator: "codex-cli",
        cli_version: "0.1.0",
        source,
        model_provider: "openai",
      },
      git: branch !== undefined
        ? { sha: "abc123", branch, origin_url: "https://github.com/test/repo" }
        : undefined,
    },
  });
}

function makeUserMessage(msg: string): string {
  return JSON.stringify({
    timestamp: "2025-05-07T17:25:00.000Z",
    type: "event_msg",
    payload: { type: "UserMessage", message: msg },
  });
}

const SESSION_1_ID = "aaaa0000-0000-0000-0000-000000000001";
const SESSION_2_ID = "bbbb0000-0000-0000-0000-000000000002";
const SESSION_3_ID = "cccc0000-0000-0000-0000-000000000003";
const MALFORMED_SESSION_ID = "dddd0000-0000-0000-0000-000000000004";

let rollout1Path: string;
let rollout2Path: string;
let rollout3Path: string;
let malformedRolloutPath: string;

beforeAll(async () => {
  // Create a fake Codex sessions directory structure
  const day1 = join(TEST_DIR, "sessions", "2025", "05", "07");
  const day2 = join(TEST_DIR, "sessions", "2025", "05", "08");
  await mkdir(day1, { recursive: true });
  await mkdir(day2, { recursive: true });

  rollout1Path = join(day1, `rollout-2025-05-07T17-24-21-${SESSION_1_ID}.jsonl`);
  rollout2Path = join(day1, `rollout-2025-05-07T18-00-00-${SESSION_2_ID}.jsonl`);
  rollout3Path = join(day2, `rollout-2025-05-08T10-00-00-${SESSION_3_ID}.jsonl`);
  malformedRolloutPath = join(
    day2,
    `rollout-2025-05-08T11-00-00-${MALFORMED_SESSION_ID}.jsonl`,
  );

  await writeFile(
    rollout1Path,
    makeSessionMeta(SESSION_1_ID, "/tmp/project-a", "cli", "main") +
      "\n" +
      makeUserMessage("Fix bug in auth"),
    "utf-8",
  );
  await writeFile(
    rollout2Path,
    makeSessionMeta(SESSION_2_ID, "/tmp/project-b", "vscode", "develop") +
      "\n" +
      makeUserMessage("Add tests"),
    "utf-8",
  );
  await writeFile(
    rollout3Path,
    makeSessionMeta(SESSION_3_ID, "/tmp/project-a", "exec") +
      "\n" +
      makeUserMessage("Run CI"),
    "utf-8",
  );
  await writeFile(
    malformedRolloutPath,
    JSON.stringify({
      timestamp: "2025-05-08T11:00:00.000Z",
      type: "session_meta",
      payload: {
        meta: {
          id: MALFORMED_SESSION_ID,
          cwd: "/tmp/broken",
          source: "cli",
        },
      },
    }) + "\n",
    "utf-8",
  );
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("discoverRolloutPaths", () => {
  test("discovers all rollout files in date-ordered directories", async () => {
    const paths: string[] = [];
    for await (const path of discoverRolloutPaths(TEST_DIR)) {
      paths.push(path);
    }
    expect(paths).toHaveLength(4);
    // Newest first (day 08 before day 07)
    expect(paths[0]).toContain("2025/05/08");
    // Within same day, sorted descending by filename (timestamp + id)
    expect(paths[0]).toContain(MALFORMED_SESSION_ID);
    expect(paths[1]).toContain(SESSION_3_ID);
    expect(paths[2]).toContain(SESSION_2_ID);
    expect(paths[3]).toContain(SESSION_1_ID);
  });

  test("returns empty for non-existent codex home", async () => {
    const paths: string[] = [];
    for await (const path of discoverRolloutPaths("/nonexistent/path")) {
      paths.push(path);
    }
    expect(paths).toHaveLength(0);
  });
});

describe("buildSession", () => {
  test("builds a session from a rollout file", async () => {
    const session = await buildSession(rollout1Path);
    expect(session).not.toBeNull();
    expect(session?.id).toBe(SESSION_1_ID);
    expect(session?.cwd).toBe("/tmp/project-a");
    expect(session?.source).toBe("cli");
    expect(session?.git?.branch).toBe("main");
    expect(session?.firstUserMessage).toBe("Fix bug in auth");
    expect(session?.title).toBe("Fix bug in auth");
  });
});

describe("listSessions", () => {
  test("lists all sessions", async () => {
    const result = await listSessions({ codexHome: TEST_DIR });
    expect(result.total).toBe(3);
    expect(result.sessions).toHaveLength(3);
  });

  test("filters by source", async () => {
    const result = await listSessions({ codexHome: TEST_DIR, source: "cli" });
    expect(result.total).toBe(1);
    expect(result.sessions[0]?.id).toBe(SESSION_1_ID);
  });

  test("filters by cwd", async () => {
    const result = await listSessions({ codexHome: TEST_DIR, cwd: "/tmp/project-a" });
    expect(result.total).toBe(2);
  });

  test("filters by branch", async () => {
    const result = await listSessions({ codexHome: TEST_DIR, branch: "develop" });
    expect(result.total).toBe(1);
    expect(result.sessions[0]?.id).toBe(SESSION_2_ID);
  });

  test("paginates results", async () => {
    const result = await listSessions({ codexHome: TEST_DIR, limit: 2, offset: 0 });
    expect(result.sessions).toHaveLength(2);
    expect(result.total).toBe(3);

    const page2 = await listSessions({ codexHome: TEST_DIR, limit: 2, offset: 2 });
    expect(page2.sessions).toHaveLength(1);
  });
});

describe("findSession", () => {
  test("finds a session by ID", async () => {
    const session = await findSession(SESSION_2_ID, TEST_DIR);
    expect(session).not.toBeNull();
    expect(session?.id).toBe(SESSION_2_ID);
    expect(session?.source).toBe("vscode");
  });

  test("returns null for unknown ID", async () => {
    const session = await findSession("nonexistent-id", TEST_DIR);
    expect(session).toBeNull();
  });

  test("returns null instead of throwing when session meta is malformed", async () => {
    await expect(findSession(MALFORMED_SESSION_ID, TEST_DIR)).resolves.toBeNull();
  });
});

describe("findLatestSession", () => {
  test("finds the most recent session", async () => {
    const session = await findLatestSession(TEST_DIR);
    expect(session).not.toBeNull();
    expect(session?.id).toBe(SESSION_3_ID);
  });

  test("finds the most recent session for a specific cwd", async () => {
    const session = await findLatestSession(TEST_DIR, "/tmp/project-b");
    expect(session).not.toBeNull();
    expect(session?.id).toBe(SESSION_2_ID);
  });

  test("returns null when no sessions match cwd", async () => {
    const session = await findLatestSession(TEST_DIR, "/nonexistent");
    expect(session).toBeNull();
  });
});
