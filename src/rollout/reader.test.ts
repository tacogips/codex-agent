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
  getSessionMessages,
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

const INJECTED_ENV_CONTEXT_LINE = JSON.stringify({
  timestamp: "2025-05-07T17:24:24.700Z",
  type: "event_msg",
  payload: {
    type: "UserMessage",
    message: "<environment_context>\n  <cwd>/tmp/test-project</cwd>\n</environment_context>",
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

const TOOL_CALL_LINE = JSON.stringify({
  timestamp: "2025-05-07T17:24:32.000Z",
  type: "response_item",
  payload: {
    type: "function_call",
    id: "fc-001",
    name: "web.search",
    arguments: '{"q":"hello"}',
    call_id: "call-001",
  },
});

const TOOL_RESULT_LINE = JSON.stringify({
  timestamp: "2025-05-07T17:24:33.000Z",
  type: "response_item",
  payload: {
    type: "function_call_output",
    call_id: "call-001",
    output: {
      status: "ok",
      text: "result payload",
    },
  },
});

const EXEC_COMMAND_BEGIN_LINE = JSON.stringify({
  timestamp: "2025-05-07T17:24:34.000Z",
  type: "event_msg",
  payload: {
    type: "ExecCommandBegin",
    call_id: "exec-call-001",
    turn_id: "turn-001",
    command: ["echo", "hello"],
    cwd: "/tmp/test-project",
  },
});

const EXEC_COMMAND_END_LINE = JSON.stringify({
  timestamp: "2025-05-07T17:24:35.000Z",
  type: "event_msg",
  payload: {
    type: "ExecCommandEnd",
    call_id: "exec-call-001",
    turn_id: "turn-001",
    command: ["echo", "hello"],
    cwd: "/tmp/test-project",
    exit_code: 0,
    aggregated_output: "hello\n",
  },
});

const EXEC_COMMAND_END_NO_OUTPUT_LINE = JSON.stringify({
  timestamp: "2025-05-07T17:24:35.100Z",
  type: "event_msg",
  payload: {
    type: "ExecCommandEnd",
    call_id: "exec-call-002",
    turn_id: "turn-001",
    command: ["printf", "hello"],
    cwd: "/tmp/test-project",
    exit_code: 0,
    aggregated_output: 123,
  },
});

const LOCAL_SHELL_CALL_RUNNING_LINE = JSON.stringify({
  timestamp: "2025-05-07T17:24:36.000Z",
  type: "response_item",
  payload: {
    type: "local_shell_call",
    id: "shell-1",
    call_id: "shell-call-1",
    status: "running",
    action: {
      type: "exec",
      command: ["pwd"],
    },
  },
});

const LOCAL_SHELL_CALL_COMPLETED_LINE = JSON.stringify({
  timestamp: "2025-05-07T17:24:37.000Z",
  type: "response_item",
  payload: {
    type: "local_shell_call",
    id: "shell-1",
    call_id: "shell-call-1",
    status: "completed",
    action: {
      type: "exec",
      command: ["pwd"],
    },
  },
});

const LOCAL_SHELL_CALL_UNKNOWN_STATUS_LINE = JSON.stringify({
  timestamp: "2025-05-07T17:24:37.100Z",
  type: "response_item",
  payload: {
    type: "local_shell_call",
    id: "shell-2",
    call_id: "shell-call-2",
    status: "queued",
    action: {
      type: "exec",
      command: ["ls"],
    },
  },
});

const EXEC_THREAD_STARTED_LINE = JSON.stringify({
  type: "thread.started",
  thread_id: "exec-thread-001",
});

const EXEC_AGENT_ITEM_COMPLETED_LINE = JSON.stringify({
  type: "item.completed",
  item: {
    id: "item_1",
    type: "agent_message",
    text: "hello from exec stream",
  },
});

const SAMPLE_ROLLOUT = [
  SESSION_META_LINE,
  TURN_STARTED_LINE,
  INJECTED_AGENTS_LINE,
  USER_MSG_LINE,
  AGENT_MSG_LINE,
  TOOL_CALL_LINE,
  TOOL_RESULT_LINE,
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

  test("normalizes exec thread.started into session_meta", () => {
    const result = parseRolloutLine(EXEC_THREAD_STARTED_LINE);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("session_meta");
    if (result !== null && result.type === "session_meta") {
      const payload = result.payload as {
        readonly meta: { readonly id: string; readonly source: string };
      };
      expect(payload.meta.id).toBe("exec-thread-001");
      expect(payload.meta.source).toBe("exec");
    }
  });

  test("normalizes exec item.completed agent_message into event_msg", () => {
    const result = parseRolloutLine(EXEC_AGENT_ITEM_COMPLETED_LINE);
    expect(result).not.toBeNull();
    expect(result?.type).toBe("event_msg");
    if (result?.type === "event_msg") {
      expect(result.payload).toEqual({
        type: "AgentMessage",
        message: "hello from exec stream",
      });
    }
  });
});

describe("readRollout", () => {
  test("reads all lines from a rollout file", async () => {
    const lines = await readRollout(rolloutFilePath);
    expect(lines).toHaveLength(8);
    expect(lines[0]?.type).toBe("session_meta");
    expect(lines[1]?.type).toBe("event_msg");
    expect(lines[2]?.type).toBe("event_msg");
    expect(lines[3]?.type).toBe("event_msg");
    expect(lines[4]?.type).toBe("event_msg");
    expect(lines[5]?.type).toBe("response_item");
    expect(lines[6]?.type).toBe("response_item");
    expect(lines[7]?.type).toBe("response_item");
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
    expect(events).toHaveLength(8);
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

describe("getSessionMessages", () => {
  test("classifies each message with exact category, role, order, and counts", async () => {
    const messages = await getSessionMessages(rolloutFilePath);
    expect(messages).toHaveLength(6);

    expect(
      messages.map((message) => ({
        category: message.category,
        role: message.role,
        text: message.text,
        sourceType: message.sourceType,
      })),
    ).toEqual([
      {
        category: "other_message",
        role: "user",
        text: "# AGENTS.md instructions for /tmp/test-project",
        sourceType: "event_msg",
      },
      {
        category: "other_message",
        role: "user",
        text: "Fix the auth bug",
        sourceType: "event_msg",
      },
      {
        category: "other_message",
        role: "assistant",
        text: "I will fix the authentication issue.",
        sourceType: "event_msg",
      },
      {
        category: "assistant_tool_response",
        role: "assistant",
        text: "web.search",
        sourceType: "response_item",
      },
      {
        category: "tool_user_response",
        role: "user",
        text: '{"status":"ok","text":"result payload"}',
        sourceType: "response_item",
      },
      {
        category: "other_message",
        role: "assistant",
        text: "Done.",
        sourceType: "response_item",
      },
    ]);

    expect(
      messages.filter((line) => line.category === "assistant_tool_response"),
    ).toHaveLength(1);
    expect(
      messages.filter((line) => line.category === "tool_user_response"),
    ).toHaveLength(1);
    expect(
      messages.filter((line) => line.category === "other_message"),
    ).toHaveLength(4);
  });

  test("can exclude tool-related messages", async () => {
    const messages = await getSessionMessages(rolloutFilePath, {
      excludeToolRelated: true,
    });
    expect(messages.every((line) => line.category === "other_message")).toBe(
      true,
    );
    expect(messages.some((line) => line.text === "Fix the auth bug")).toBe(
      true,
    );
  });

  test("can exclude injected/framework user messages for conversation-only output", async () => {
    const path = join(TEST_DIR, "rollout-conversation-only.jsonl");
    await writeFile(
      path,
      [
        SESSION_META_LINE,
        INJECTED_AGENTS_LINE,
        INJECTED_ENV_CONTEXT_LINE,
        USER_MSG_LINE,
        AGENT_MSG_LINE,
        RESPONSE_ITEM_LINE,
      ].join("\n"),
      "utf-8",
    );

    const messages = await getSessionMessages(path, {
      excludeSystemInjected: true,
    });
    expect(messages.map((m) => m.text)).toEqual([
      "Fix the auth bug",
      "I will fix the authentication issue.",
      "Done.",
    ]);
    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "assistant",
    ]);
  });

  test("excludes ExecCommand and local_shell_call tool-related messages", async () => {
    const path = join(TEST_DIR, "rollout-tools-exclude.jsonl");
    await writeFile(
      path,
      [
        SESSION_META_LINE,
        USER_MSG_LINE,
        EXEC_COMMAND_BEGIN_LINE,
        EXEC_COMMAND_END_LINE,
        LOCAL_SHELL_CALL_RUNNING_LINE,
        LOCAL_SHELL_CALL_COMPLETED_LINE,
        RESPONSE_ITEM_LINE,
      ].join("\n"),
      "utf-8",
    );

    const allMessages = await getSessionMessages(path);
    expect(allMessages.map((m) => m.category)).toEqual([
      "other_message",
      "assistant_tool_response",
      "tool_user_response",
      "assistant_tool_response",
      "tool_user_response",
      "other_message",
    ]);

    const filtered = await getSessionMessages(path, {
      excludeToolRelated: true,
    });
    expect(filtered.map((m) => m.category)).toEqual([
      "other_message",
      "other_message",
    ]);
    expect(filtered.map((m) => m.text)).toEqual(["Fix the auth bug", "Done."]);
  });

  test("combines excludeToolRelated and excludeSystemInjected for conversation-only transcript", async () => {
    const path = join(TEST_DIR, "rollout-combined-filtering.jsonl");
    await writeFile(
      path,
      [
        SESSION_META_LINE,
        INJECTED_AGENTS_LINE,
        INJECTED_ENV_CONTEXT_LINE,
        USER_MSG_LINE,
        EXEC_COMMAND_BEGIN_LINE,
        EXEC_COMMAND_END_LINE,
        RESPONSE_ITEM_LINE,
      ].join("\n"),
      "utf-8",
    );

    const filtered = await getSessionMessages(path, {
      excludeToolRelated: true,
      excludeSystemInjected: true,
    });
    expect(filtered.map((m) => m.category)).toEqual([
      "other_message",
      "other_message",
    ]);
    expect(filtered.map((m) => m.text)).toEqual(["Fix the auth bug", "Done."]);
  });

  test("uses aggregated_output for ExecCommandEnd tool reply text", async () => {
    const path = join(TEST_DIR, "rollout-exec-output.jsonl");
    await writeFile(
      path,
      [SESSION_META_LINE, EXEC_COMMAND_END_LINE].join("\n"),
      "utf-8",
    );

    const messages = await getSessionMessages(path);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.category).toBe("tool_user_response");
    expect(messages[0]?.text).toBe("hello\n");
  });

  test("falls back to command text when ExecCommandEnd aggregated_output is invalid", async () => {
    const path = join(TEST_DIR, "rollout-exec-output-fallback.jsonl");
    await writeFile(
      path,
      [SESSION_META_LINE, EXEC_COMMAND_END_NO_OUTPUT_LINE].join("\n"),
      "utf-8",
    );

    const messages = await getSessionMessages(path);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.category).toBe("tool_user_response");
    expect(messages[0]?.text).toBe("printf hello");
  });

  test("treats unknown local_shell_call status as assistant-side tool message", async () => {
    const path = join(TEST_DIR, "rollout-local-shell-unknown-status.jsonl");
    await writeFile(
      path,
      [SESSION_META_LINE, LOCAL_SHELL_CALL_UNKNOWN_STATUS_LINE].join("\n"),
      "utf-8",
    );

    const messages = await getSessionMessages(path);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.category).toBe("assistant_tool_response");
    expect(messages[0]?.role).toBe("assistant");
  });

  test("drops unknown response_item type from session message extraction", async () => {
    const unknownResponseItem = JSON.stringify({
      timestamp: "2025-05-07T17:24:38.000Z",
      type: "response_item",
      payload: {
        type: "unexpected_item_type",
        value: "ignored",
      },
    });
    const path = join(TEST_DIR, "rollout-unknown-response-item.jsonl");
    await writeFile(path, [SESSION_META_LINE, unknownResponseItem].join("\n"), "utf-8");

    const messages = await getSessionMessages(path);
    expect(messages).toHaveLength(0);
  });

  test("drops unknown event_msg type from session message extraction", async () => {
    const unknownEventMsg = JSON.stringify({
      timestamp: "2025-05-07T17:24:39.000Z",
      type: "event_msg",
      payload: {
        type: "UnexpectedEventType",
        message: "ignored",
      },
    });
    const path = join(TEST_DIR, "rollout-unknown-event-msg.jsonl");
    await writeFile(path, [SESSION_META_LINE, unknownEventMsg].join("\n"), "utf-8");

    const messages = await getSessionMessages(path);
    expect(messages).toHaveLength(0);
  });
});
