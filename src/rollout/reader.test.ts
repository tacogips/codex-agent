import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseRolloutLine,
  readRollout,
  parseSessionMeta,
  streamEvents,
  extractFirstUserMessage,
} from "./reader";

const TEST_DIR = join(tmpdir(), "codex-agent-test-rollout-" + Date.now());

const SESSION_META_LINE = JSON.stringify({
  timestamp: "2025-05-07T17:24:21.123Z",
  type: "session_meta",
  payload: {
    meta: {
      id: "5973b6c0-94b8-487b-a530-2aeb6098ae0e",
      timestamp: "2025-05-07T17:24:21.123Z",
      cwd: "/tmp/test-project",
      originator: "codex-cli",
      cli_version: "0.1.0",
      source: "cli",
      model_provider: "openai",
    },
    git: {
      sha: "abc123",
      branch: "main",
      origin_url: "https://github.com/test/repo",
    },
  },
});

const USER_MSG_LINE = JSON.stringify({
  timestamp: "2025-05-07T17:24:25.000Z",
  type: "event_msg",
  payload: {
    type: "UserMessage",
    message: "Fix the auth bug",
  },
});

const INJECTED_AGENTS_LINE = JSON.stringify({
  timestamp: "2025-05-07T17:24:24.500Z",
  type: "event_msg",
  payload: {
    type: "UserMessage",
    message: "# AGENTS.md instructions for /tmp/test-project",
  },
});

const AGENT_MSG_LINE = JSON.stringify({
  timestamp: "2025-05-07T17:24:30.000Z",
  type: "event_msg",
  payload: {
    type: "AgentMessage",
    message: "I will fix the authentication issue.",
  },
});

const TURN_STARTED_LINE = JSON.stringify({
  timestamp: "2025-05-07T17:24:24.000Z",
  type: "event_msg",
  payload: {
    type: "TurnStarted",
    turn_id: "turn-001",
  },
});

const RESPONSE_ITEM_LINE = JSON.stringify({
  timestamp: "2025-05-07T17:24:31.000Z",
  type: "response_item",
  payload: {
    type: "message",
    id: "msg-001",
    role: "assistant",
    content: [{ type: "output_text", text: "Done." }],
  },
});

const SAMPLE_ROLLOUT = [
  SESSION_META_LINE,
  TURN_STARTED_LINE,
  INJECTED_AGENTS_LINE,
  USER_MSG_LINE,
  AGENT_MSG_LINE,
  RESPONSE_ITEM_LINE,
].join("\n");

let rolloutFilePath: string;

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
  rolloutFilePath = join(TEST_DIR, "rollout-test.jsonl");
  await writeFile(rolloutFilePath, SAMPLE_ROLLOUT, "utf-8");
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("parseRolloutLine", () => {
  test("parses a valid session_meta line", () => {
    const result = parseRolloutLine(SESSION_META_LINE);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("session_meta");
    expect(result?.timestamp).toBe("2025-05-07T17:24:21.123Z");
  });

  test("parses a valid event_msg line", () => {
    const result = parseRolloutLine(USER_MSG_LINE);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("event_msg");
  });

  test("parses a valid response_item line", () => {
    const result = parseRolloutLine(RESPONSE_ITEM_LINE);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("response_item");
  });

  test("returns null for empty string", () => {
    expect(parseRolloutLine("")).toBeNull();
  });

  test("returns null for whitespace-only string", () => {
    expect(parseRolloutLine("   \t  ")).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    expect(parseRolloutLine("{broken json")).toBeNull();
  });

  test("returns null for valid JSON without required fields", () => {
    expect(parseRolloutLine('{"foo": "bar"}')).toBeNull();
  });

  test("returns null for JSON missing payload", () => {
    expect(
      parseRolloutLine(
        '{"timestamp": "2025-01-01T00:00:00Z", "type": "session_meta"}',
      ),
    ).toBeNull();
  });
});

describe("readRollout", () => {
  test("reads all lines from a rollout file", async () => {
    const lines = await readRollout(rolloutFilePath);
    expect(lines).toHaveLength(6);
    expect(lines[0]?.type).toBe("session_meta");
    expect(lines[1]?.type).toBe("event_msg");
    expect(lines[2]?.type).toBe("event_msg");
    expect(lines[3]?.type).toBe("event_msg");
    expect(lines[4]?.type).toBe("event_msg");
    expect(lines[5]?.type).toBe("response_item");
  });

  test("skips empty lines", async () => {
    const pathWithBlanks = join(TEST_DIR, "rollout-blanks.jsonl");
    await writeFile(
      pathWithBlanks,
      SESSION_META_LINE + "\n\n" + USER_MSG_LINE + "\n\n",
      "utf-8",
    );
    const lines = await readRollout(pathWithBlanks);
    expect(lines).toHaveLength(2);
  });
});

describe("parseSessionMeta", () => {
  test("extracts session metadata from the first line", async () => {
    const meta = await parseSessionMeta(rolloutFilePath);
    expect(meta).not.toBeNull();
    expect(meta?.meta.id).toBe("5973b6c0-94b8-487b-a530-2aeb6098ae0e");
    expect(meta?.meta.cwd).toBe("/tmp/test-project");
    expect(meta?.meta.source).toBe("cli");
    expect(meta?.git?.branch).toBe("main");
    expect(meta?.git?.sha).toBe("abc123");
  });

  test("returns null for file without session_meta", async () => {
    const noMetaPath = join(TEST_DIR, "rollout-nometa.jsonl");
    await writeFile(noMetaPath, USER_MSG_LINE, "utf-8");
    const meta = await parseSessionMeta(noMetaPath);
    expect(meta).toBeNull();
  });
});

describe("streamEvents", () => {
  test("yields all events from a rollout file", async () => {
    const events: unknown[] = [];
    for await (const event of streamEvents(rolloutFilePath)) {
      events.push(event);
    }
    expect(events).toHaveLength(6);
  });
});

describe("extractFirstUserMessage", () => {
  test("extracts the first user message", async () => {
    const msg = await extractFirstUserMessage(rolloutFilePath);
    expect(msg).toBe("Fix the auth bug");
  });

  test("assigns provenance for injected and normal user messages", () => {
    const injected = parseRolloutLine(INJECTED_AGENTS_LINE);
    const user = parseRolloutLine(USER_MSG_LINE);

    expect(injected?.provenance).toEqual({
      role: "user",
      origin: "system_injected",
      display_default: false,
      source_tag: "agents_instructions",
    });
    expect(user?.provenance).toEqual({
      role: "user",
      origin: "user_input",
      display_default: true,
    });
  });

  test("returns undefined when no user message exists", async () => {
    const noMsgPath = join(TEST_DIR, "rollout-nouser.jsonl");
    await writeFile(
      noMsgPath,
      SESSION_META_LINE + "\n" + AGENT_MSG_LINE,
      "utf-8",
    );
    const msg = await extractFirstUserMessage(noMsgPath);
    expect(msg).toBeUndefined();
  });
});
