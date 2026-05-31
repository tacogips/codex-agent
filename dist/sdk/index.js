// @bun
// src/sdk/mock-session-runner.ts
import { EventEmitter } from "events";

class MockCodexRunningSession extends EventEmitter {
  #sessionId;
  #initialMessages;
  #autoComplete;
  #autoCompleteResult;
  #queue = [];
  #closed = false;
  #messageCount = 0;
  #activationScheduled = false;
  #activated = false;
  #initialMessagesFlushed = false;
  #waiter;
  #completionResolver;
  #completion;
  constructor(options) {
    super();
    this.#sessionId = options.sessionId;
    this.#initialMessages = [...options.messages ?? []];
    this.#autoComplete = options.autoComplete !== false;
    this.#autoCompleteResult = options.result;
    this.#completion = new Promise((resolve) => {
      this.#completionResolver = resolve;
    });
    this.on("newListener", (eventName) => {
      if (eventName === "message" || eventName === "complete") {
        this.#scheduleActivation();
      }
    });
  }
  get sessionId() {
    return this.#sessionId;
  }
  getState() {
    return { status: this.#closed ? "completed" : "running" };
  }
  pushMessage(message) {
    this.#flushInitialMessages();
    this.#pushMessage(message);
  }
  complete(result = {}) {
    this.#flushInitialMessages();
    this.#complete(result);
  }
  async* messages() {
    this.#activate();
    while (!this.#closed || this.#queue.length > 0) {
      while (this.#queue.length > 0) {
        const message = this.#queue.shift();
        if (message !== undefined) {
          yield message;
        }
      }
      if (this.#closed) {
        break;
      }
      await new Promise((resolve) => {
        this.#waiter = resolve;
      });
    }
  }
  async waitForCompletion() {
    this.#activate();
    return await this.#completion;
  }
  async cancel() {
    this.complete({ success: false, exitCode: 130 });
  }
  #scheduleActivation() {
    if (this.#activated || this.#activationScheduled) {
      return;
    }
    this.#activationScheduled = true;
    queueMicrotask(() => {
      this.#activationScheduled = false;
      this.#activate();
    });
  }
  #activate() {
    if (this.#activated) {
      return;
    }
    this.#activated = true;
    this.#flushInitialMessages();
    if (this.#autoComplete) {
      this.#complete(this.#autoCompleteResult);
    }
  }
  #flushInitialMessages() {
    if (this.#initialMessagesFlushed) {
      return;
    }
    this.#initialMessagesFlushed = true;
    for (const message of this.#initialMessages) {
      if (this.#closed) {
        return;
      }
      this.#pushMessage(message);
    }
  }
  #pushMessage(message) {
    if (this.#closed) {
      throw new Error(`mock codex session '${this.#sessionId}' is closed`);
    }
    this.#messageCount += 1;
    this.#queue.push(message);
    this.emit("message", message);
    this.#wake();
  }
  #complete(result = {}) {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    const completed = buildSessionResult(result, this.#messageCount);
    this.emit("complete", completed);
    this.#completionResolver?.(completed);
    this.#completionResolver = undefined;
    this.#wake();
  }
  #wake() {
    const waiter = this.#waiter;
    this.#waiter = undefined;
    waiter?.();
  }
}

class MockCodexSessionRunner {
  startSessionCalls = [];
  resumeSessionCalls = [];
  #startSessions = [];
  #resumeSessions = [];
  enqueueStartSession(session) {
    this.#startSessions.push(session);
  }
  enqueueResumeSession(session) {
    this.#resumeSessions.push(session);
  }
  async startSession(config) {
    this.startSessionCalls.push({ config });
    return this.#shiftSession(this.#startSessions, "start");
  }
  async resumeSession(sessionId, prompt, options) {
    this.resumeSessionCalls.push({
      sessionId,
      ...prompt === undefined ? {} : { prompt },
      ...options === undefined ? {} : { options }
    });
    return this.#shiftSession(this.#resumeSessions, "resume");
  }
  #shiftSession(sessions, kind) {
    const session = sessions.shift();
    if (session === undefined) {
      throw new Error(`mock codex ${kind} session was not enqueued`);
    }
    return session;
  }
}
function createMockCodexSessionRunner(input = {}) {
  const runner = new MockCodexSessionRunner;
  for (const session of input.startSessions ?? []) {
    runner.enqueueStartSession(session);
  }
  for (const session of input.resumeSessions ?? []) {
    runner.enqueueResumeSession(session);
  }
  return runner;
}
function buildSessionResult(input, fallbackMessageCount) {
  return {
    success: input.success ?? (input.exitCode === undefined || input.exitCode === 0),
    exitCode: input.exitCode ?? (input.success === false ? 1 : 0),
    stats: {
      startedAt: input.startedAt ?? "2026-01-01T00:00:00.000Z",
      completedAt: input.completedAt ?? "2026-01-01T00:00:01.000Z",
      messageCount: input.messageCount ?? fallbackMessageCount
    }
  };
}

// src/sdk/events.ts
class BasicSdkEventEmitter {
  handlers = new Map;
  on(event, handler) {
    const set = this.handlers.get(event) ?? new Set;
    set.add(handler);
    this.handlers.set(event, set);
  }
  off(event, handler) {
    this.handlers.get(event)?.delete(handler);
  }
  emit(event, payload) {
    const set = this.handlers.get(event);
    if (set === undefined) {
      return;
    }
    for (const handler of set) {
      handler(payload);
    }
  }
}
// src/sdk/tool-registry.ts
function tool(config) {
  if (config.name.trim().length === 0) {
    throw new Error("tool name is required");
  }
  return {
    name: config.name,
    description: config.description,
    async run(input, context) {
      return await config.run(input, context);
    }
  };
}

class ToolRegistry {
  tools = new Map;
  register(registeredTool) {
    this.tools.set(registeredTool.name, registeredTool);
  }
  get(name) {
    const value = this.tools.get(name);
    if (value === undefined) {
      return null;
    }
    return value;
  }
  list() {
    return Array.from(this.tools.keys()).sort();
  }
  async run(name, input, context) {
    const registered = this.get(name);
    if (registered === null) {
      throw new Error(`tool not found: ${name}`);
    }
    return registered.run(input, context);
  }
}
// src/sdk/session-runner.ts
import { EventEmitter as EventEmitter3 } from "events";
import { stat as stat3 } from "fs/promises";

// src/process/manager.ts
import { spawn } from "child_process";
import { createInterface as createInterface2 } from "readline";
import { randomUUID } from "crypto";

// src/rollout/reader.ts
import { readFile } from "fs/promises";
import { createReadStream } from "fs";
import { createInterface } from "readline";

// src/types/rollout.ts
function isSessionMeta(item) {
  return item.type === "session_meta";
}
function isResponseItem(item) {
  return item.type === "response_item";
}
function isEventMsg(item) {
  return item.type === "event_msg";
}
function isCompacted(item) {
  return item.type === "compacted";
}
function isTurnContext(item) {
  return item.type === "turn_context";
}

// src/rollout/reader.ts
function parseRolloutLine(line) {
  const trimmed = line.trim();
  if (trimmed === "") {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    const normalized = normalizeRolloutLine(parsed);
    if (normalized === null) {
      return null;
    }
    const provenance = deriveProvenance(normalized);
    return provenance === undefined ? normalized : {
      ...normalized,
      provenance
    };
  } catch {
    return null;
  }
}
async function readRollout(path) {
  const content = await readFile(path, "utf-8");
  const lines = content.split(`
`);
  const result = [];
  for (const line of lines) {
    const parsed = parseRolloutLine(line);
    if (parsed !== null) {
      result.push(parsed);
    }
  }
  return result;
}
async function parseSessionMeta(path) {
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf-8" }),
    crlfDelay: Infinity
  });
  try {
    for await (const line of rl) {
      const parsed = parseRolloutLine(line);
      if (parsed !== null && isSessionMeta(parsed)) {
        return parsed.payload;
      }
      if (parsed !== null) {
        return null;
      }
    }
  } finally {
    rl.close();
  }
  return null;
}
async function* streamEvents(path) {
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf-8" }),
    crlfDelay: Infinity
  });
  try {
    for await (const line of rl) {
      const parsed = parseRolloutLine(line);
      if (parsed !== null) {
        yield parsed;
      }
    }
  } finally {
    rl.close();
  }
}
async function extractFirstUserMessage(path) {
  for await (const item of streamEvents(path)) {
    if (item.type === "event_msg" && isUserMessagePayload(item.payload)) {
      if (item.provenance?.origin === "user_input") {
        return item.payload.message;
      }
      if (item.provenance === undefined && detectSourceTag(item.payload.message) === undefined) {
        return item.payload.message;
      }
    }
  }
  return;
}
async function getSessionMessages(path, options) {
  const messages = [];
  const excludeToolRelated = options?.excludeToolRelated === true;
  const excludeSystemInjected = options?.excludeSystemInjected === true;
  for await (const line of streamEvents(path)) {
    const message = toSessionMessage(line);
    if (message === null) {
      continue;
    }
    if (excludeToolRelated && (message.category === "assistant_tool_response" || message.category === "tool_user_response")) {
      continue;
    }
    if (excludeSystemInjected && isInjectedOrFrameworkUserMessage(message)) {
      continue;
    }
    messages.push(message);
  }
  return messages;
}
function isValidRolloutLine(value) {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const obj = value;
  return typeof obj["timestamp"] === "string" && typeof obj["type"] === "string" && "payload" in obj;
}
function normalizeRolloutLine(value) {
  if (isValidRolloutLine(value)) {
    return value;
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value;
  if (typeof raw["type"] !== "string") {
    return null;
  }
  const timestamp = typeof raw["timestamp"] === "string" ? raw["timestamp"] : new Date().toISOString();
  const execEventType = raw["type"];
  if (execEventType === "thread.started") {
    const sessionId = typeof raw["thread_id"] === "string" && raw["thread_id"].length > 0 ? raw["thread_id"] : "unknown-session";
    return {
      timestamp,
      type: "session_meta",
      payload: {
        meta: {
          id: sessionId,
          timestamp,
          cwd: "",
          originator: "codex",
          cli_version: "unknown",
          source: "exec"
        }
      }
    };
  }
  if (execEventType === "item.completed") {
    const item = toRecord(raw["item"]);
    if (item === null || typeof item["type"] !== "string") {
      return null;
    }
    if (item["type"] === "agent_message" && typeof item["text"] === "string") {
      return {
        timestamp,
        type: "event_msg",
        payload: {
          type: "AgentMessage",
          message: item["text"]
        }
      };
    }
    return {
      timestamp,
      type: "response_item",
      payload: item
    };
  }
  const payload = toEventPayload(execEventType, raw);
  if (payload === null) {
    return null;
  }
  return {
    timestamp,
    type: "event_msg",
    payload
  };
}
function toEventPayload(eventType, raw) {
  switch (eventType) {
    case "turn.started":
      return {
        type: "TurnStarted",
        ...typeof raw["turn_id"] === "string" ? { turn_id: raw["turn_id"] } : {}
      };
    case "turn.completed":
      return {
        type: "TurnComplete",
        ...typeof raw["turn_id"] === "string" ? { turn_id: raw["turn_id"] } : {},
        ...raw["usage"] !== undefined ? { usage: raw["usage"] } : {}
      };
    case "error":
      return {
        type: "Error",
        ...typeof raw["message"] === "string" ? { message: raw["message"] } : {}
      };
    default:
      return null;
  }
}
function isUserMessagePayload(payload) {
  if (typeof payload !== "object" || payload === null) {
    return false;
  }
  const obj = payload;
  return obj["type"] === "UserMessage" && typeof obj["message"] === "string";
}
function deriveProvenance(line) {
  switch (line.type) {
    case "event_msg":
      return deriveEventMsgProvenance(line.payload);
    case "response_item":
      return deriveResponseItemProvenance(line.payload);
    case "session_meta":
      return {
        origin: "framework_event",
        display_default: false,
        source_tag: "session_meta"
      };
    case "turn_context":
      return {
        origin: "framework_event",
        display_default: false,
        source_tag: "turn_context"
      };
    case "compacted":
      return {
        origin: "framework_event",
        display_default: false,
        source_tag: "compacted"
      };
    default:
      return;
  }
}
function deriveEventMsgProvenance(payload) {
  if (typeof payload !== "object" || payload === null) {
    return {
      origin: "framework_event",
      display_default: false,
      source_tag: "event_msg_unknown"
    };
  }
  const event = payload;
  const eventType = typeof event["type"] === "string" ? event["type"] : "unknown";
  if (eventType === "UserMessage" && typeof event["message"] === "string") {
    return classifyUserMessage(event["message"]);
  }
  if (eventType === "AgentMessage") {
    return {
      role: "assistant",
      origin: "tool_generated",
      display_default: true,
      source_tag: "agent_message"
    };
  }
  return {
    origin: "framework_event",
    display_default: false,
    source_tag: toSnakeCase(eventType)
  };
}
function deriveResponseItemProvenance(payload) {
  if (typeof payload !== "object" || payload === null) {
    return {
      origin: "tool_generated",
      display_default: false,
      source_tag: "response_item_unknown"
    };
  }
  const item = payload;
  const itemType = typeof item["type"] === "string" ? item["type"] : "unknown";
  if (itemType === "message") {
    const role = typeof item["role"] === "string" ? item["role"] : undefined;
    const messageText = extractMessageText(item["content"]);
    if (role === "user" && messageText !== undefined) {
      return classifyUserMessage(messageText);
    }
    return {
      ...role !== undefined ? { role } : {},
      origin: role === "assistant" ? "tool_generated" : "framework_event",
      display_default: true,
      source_tag: "response_message"
    };
  }
  const generatedItemTypes = new Set([
    "reasoning",
    "local_shell_call",
    "function_call",
    "function_call_output"
  ]);
  const origin = generatedItemTypes.has(itemType) ? "tool_generated" : "framework_event";
  return {
    origin,
    display_default: origin !== "framework_event",
    source_tag: toSnakeCase(itemType)
  };
}
function classifyUserMessage(message) {
  const sourceTag = detectSourceTag(message);
  if (sourceTag === undefined) {
    return {
      role: "user",
      origin: "user_input",
      display_default: true
    };
  }
  const origin = sourceTag === "turn_aborted" ? "framework_event" : "system_injected";
  return {
    role: "user",
    origin,
    display_default: false,
    source_tag: sourceTag
  };
}
function detectSourceTag(message) {
  const text = message.trimStart();
  if (text.startsWith("# AGENTS.md instructions")) {
    return "agents_instructions";
  }
  if (text.startsWith("<environment_context>")) {
    return "environment_context";
  }
  if (text.startsWith("<turn_aborted>")) {
    return "turn_aborted";
  }
  return;
}
function extractMessageText(content) {
  if (!Array.isArray(content)) {
    return;
  }
  const textParts = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) {
      continue;
    }
    const record = part;
    if ((record["type"] === "input_text" || record["type"] === "output_text") && typeof record["text"] === "string") {
      textParts.push(record["text"]);
    }
  }
  if (textParts.length === 0) {
    return;
  }
  return textParts.join(`
`);
}
function toRecord(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value;
}
function toSnakeCase(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toLowerCase();
}
function toSessionMessage(line) {
  if (line.type === "event_msg") {
    const payload2 = toRecord(line.payload);
    if (payload2 === null) {
      return null;
    }
    const eventType = readString(payload2["type"]);
    if (eventType === "UserMessage" || eventType === "AgentMessage") {
      const text = readString(payload2["message"]);
      const role = eventType === "UserMessage" ? "user" : "assistant";
      return {
        timestamp: line.timestamp,
        category: "other_message",
        role,
        ...text !== undefined ? { text } : {},
        sourceType: line.type,
        ...line.provenance?.source_tag !== undefined ? { sourceTag: line.provenance.source_tag } : {},
        line
      };
    }
    if (eventType === "ExecCommandBegin") {
      const text = toCommandText(payload2["command"]);
      return {
        timestamp: line.timestamp,
        category: "assistant_tool_response",
        role: "assistant",
        ...text !== undefined ? { text } : {},
        sourceType: line.type,
        sourceTag: "exec_command_begin",
        line
      };
    }
    if (eventType === "ExecCommandEnd") {
      const text = readString(payload2["aggregated_output"]) ?? toCommandText(payload2["command"]);
      return {
        timestamp: line.timestamp,
        category: "tool_user_response",
        role: "user",
        ...text !== undefined ? { text } : {},
        sourceType: line.type,
        sourceTag: "exec_command_end",
        line
      };
    }
    return null;
  }
  if (line.type !== "response_item") {
    return null;
  }
  const payload = toRecord(line.payload);
  if (payload === null) {
    return null;
  }
  const itemType = readString(payload["type"]);
  if (itemType === "function_call") {
    const name = readString(payload["name"]) ?? "unknown-tool";
    return {
      timestamp: line.timestamp,
      category: "assistant_tool_response",
      role: "assistant",
      text: name,
      sourceType: line.type,
      ...line.provenance?.source_tag !== undefined ? { sourceTag: line.provenance.source_tag } : {},
      line
    };
  }
  if (itemType === "function_call_output") {
    const text = summarizeUnknown(payload["output"]);
    return {
      timestamp: line.timestamp,
      category: "tool_user_response",
      role: "user",
      ...text !== undefined ? { text } : {},
      sourceType: line.type,
      ...line.provenance?.source_tag !== undefined ? { sourceTag: line.provenance.source_tag } : {},
      line
    };
  }
  if (itemType === "local_shell_call") {
    const status = readString(payload["status"]);
    const isTerminalStatus = status === "completed" || status === "failed" || status === "error";
    const text = summarizeUnknown(payload["action"]);
    return {
      timestamp: line.timestamp,
      category: isTerminalStatus ? "tool_user_response" : "assistant_tool_response",
      role: isTerminalStatus ? "user" : "assistant",
      ...text !== undefined ? { text } : {},
      sourceType: line.type,
      ...line.provenance?.source_tag !== undefined ? { sourceTag: line.provenance.source_tag } : {},
      line
    };
  }
  if (itemType === "message") {
    const role = readString(payload["role"]);
    const text = extractMessageText(payload["content"]);
    return {
      timestamp: line.timestamp,
      category: "other_message",
      role: role === "assistant" || role === "user" ? role : "unknown",
      ...text !== undefined ? { text } : {},
      sourceType: line.type,
      ...line.provenance?.source_tag !== undefined ? { sourceTag: line.provenance.source_tag } : {},
      line
    };
  }
  return null;
}
function readString(value) {
  return typeof value === "string" ? value : undefined;
}
function toCommandText(value) {
  if (!Array.isArray(value)) {
    return;
  }
  const command = value.filter((item) => typeof item === "string");
  if (command.length === 0) {
    return;
  }
  return command.join(" ");
}
function summarizeUnknown(value) {
  if (value === undefined) {
    return;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
function isInjectedOrFrameworkUserMessage(message) {
  if (message.role !== "user") {
    return false;
  }
  const origin = message.line.provenance?.origin;
  if (origin === "system_injected" || origin === "framework_event") {
    return true;
  }
  return message.sourceTag === "agents_instructions" || message.sourceTag === "environment_context" || message.sourceTag === "turn_aborted";
}

// src/process/manager.ts
var DEFAULT_BINARY = "codex";

class ProcessManager {
  processes = new Map;
  binary;
  constructor(binary) {
    this.binary = binary ?? DEFAULT_BINARY;
  }
  async spawnExec(prompt, options) {
    const stream = this.spawnExecStream(prompt, options);
    const lines = [];
    for await (const line of stream.lines) {
      lines.push(line);
    }
    const exitCode = await stream.completion;
    return { exitCode, lines };
  }
  spawnExecStream(prompt, options) {
    const args = buildExecArgs(prompt, options);
    const binary = options?.codexBinary ?? this.binary;
    const cwd = options?.cwd;
    const child = spawn(binary, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: buildSpawnEnvironment(options)
    });
    drainPipe(child.stderr);
    const id = randomUUID();
    const managed = createManagedProcess(id, child, binary + " " + args.join(" "), prompt);
    this.processes.set(id, managed);
    const completion = waitForExit(child).then((exitCode) => {
      managed.status = "exited";
      managed.exitCode = exitCode;
      return exitCode;
    });
    return {
      process: toCodexProcess(managed),
      lines: streamJsonlOutput(child),
      completion
    };
  }
  spawnResume(sessionId, options, prompt) {
    const stream = this.spawnResumeStream(sessionId, options, prompt);
    drainAsyncIterable(stream.lines);
    return stream.process;
  }
  spawnResumeStream(sessionId, options, prompt) {
    const args = buildResumeArgs(sessionId, options, prompt);
    const binary = options?.codexBinary ?? this.binary;
    const cwd = options?.cwd;
    const child = spawn(binary, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: buildSpawnEnvironment(options)
    });
    drainPipe(child.stderr);
    const id = randomUUID();
    const managed = createManagedProcess(id, child, binary + " " + args.join(" "), `resume ${sessionId}`);
    this.processes.set(id, managed);
    const completion = waitForExit(child).then((exitCode) => {
      managed.status = "exited";
      managed.exitCode = exitCode;
      return exitCode;
    });
    return {
      process: toCodexProcess(managed),
      lines: streamJsonlOutput(child),
      completion
    };
  }
  spawnFork(sessionId, nthMessage, options) {
    const args = ["fork", sessionId];
    if (nthMessage !== undefined) {
      args.push("--nth-message", String(nthMessage));
    }
    args.push(...buildCommonArgs(options));
    return this.spawnTracked(args, options, `fork ${sessionId}`);
  }
  list() {
    return Array.from(this.processes.values()).map(toCodexProcess);
  }
  get(id) {
    const managed = this.processes.get(id);
    if (managed === undefined) {
      return null;
    }
    return toCodexProcess(managed);
  }
  kill(id) {
    const managed = this.processes.get(id);
    if (managed === undefined) {
      return false;
    }
    if (managed.status !== "running") {
      return false;
    }
    managed.child.kill("SIGTERM");
    managed.status = "killed";
    return true;
  }
  writeInput(id, input) {
    const managed = this.processes.get(id);
    if (managed === undefined || managed.status !== "running") {
      return false;
    }
    if (managed.child.stdin === null) {
      return false;
    }
    managed.child.stdin.write(input);
    return true;
  }
  killAll() {
    for (const managed of this.processes.values()) {
      if (managed.status === "running") {
        managed.child.kill("SIGTERM");
        managed.status = "killed";
      }
    }
  }
  prune() {
    let count = 0;
    for (const [id, managed] of this.processes) {
      if (managed.status !== "running") {
        this.processes.delete(id);
        count++;
      }
    }
    return count;
  }
  spawnTracked(args, options, prompt) {
    const binary = options?.codexBinary ?? this.binary;
    const cwd = options?.cwd;
    const child = spawn(binary, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildSpawnEnvironment(options)
    });
    drainPipe(child.stdout);
    drainPipe(child.stderr);
    const id = randomUUID();
    const managed = createManagedProcess(id, child, binary + " " + args.join(" "), prompt);
    this.processes.set(id, managed);
    child.on("exit", (code) => {
      managed.status = "exited";
      managed.exitCode = code ?? 1;
    });
    return toCodexProcess(managed);
  }
}
function buildExecArgs(prompt, options) {
  const args = ["exec", "--json", ...buildCommonArgs(options)];
  if (options?.images !== undefined) {
    for (const imagePath of options.images) {
      args.push("--image", imagePath);
    }
  }
  if (options?.images !== undefined && options.images.length > 0) {
    args.push("--");
  }
  args.push(buildPromptWithSystemPrompt(prompt, options?.systemPrompt));
  return args;
}
function buildResumeArgs(sessionId, options, prompt) {
  const args = ["exec", "resume", "--json", ...buildCommonArgs(options)];
  if (options?.images !== undefined) {
    for (const imagePath of options.images) {
      args.push("--image", imagePath);
    }
  }
  if (options?.images !== undefined && options.images.length > 0) {
    args.push("--");
  }
  args.push(sessionId);
  if (prompt !== undefined && prompt.trim().length > 0) {
    args.push(buildPromptWithSystemPrompt(prompt, options?.systemPrompt));
  }
  return args;
}
function buildPromptWithSystemPrompt(prompt, systemPrompt) {
  if (systemPrompt === undefined || systemPrompt.trim().length === 0) {
    return prompt;
  }
  return `${systemPrompt}

${prompt}`;
}
function buildCommonArgs(options) {
  const args = [];
  if (options?.model !== undefined) {
    args.push("--model", options.model);
  }
  if (options?.fullAuto === true) {
    args.push("--full-auto");
  }
  if (options?.sandbox !== undefined) {
    args.push("--sandbox", options.sandbox);
  }
  if (options?.approvalMode !== undefined) {
    args.push("--ask-for-approval", options.approvalMode);
  }
  if (options?.configOverrides !== undefined) {
    for (const override of options.configOverrides) {
      args.push("-c", override);
    }
  }
  if (options?.additionalArgs !== undefined) {
    args.push(...options.additionalArgs);
  }
  return args;
}
function buildSpawnEnvironment(options) {
  return {
    ...process.env,
    ...options?.environmentVariables
  };
}
function createManagedProcess(id, child, command, prompt) {
  return {
    id,
    child,
    command,
    prompt,
    startedAt: new Date,
    status: "running",
    exitCode: undefined
  };
}
function toCodexProcess(managed) {
  return {
    id: managed.id,
    pid: managed.child.pid ?? -1,
    command: managed.command,
    prompt: managed.prompt,
    startedAt: managed.startedAt,
    status: managed.status,
    exitCode: managed.exitCode
  };
}
async function* streamJsonlOutput(child) {
  if (child.stdout === null) {
    return;
  }
  const rl = createInterface2({ input: child.stdout, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const parsed = parseRolloutLine(line);
      if (parsed !== null) {
        yield parsed;
      }
    }
  } finally {
    rl.close();
  }
}
function waitForExit(child) {
  if (child.exitCode !== null) {
    return Promise.resolve(child.exitCode);
  }
  return new Promise((resolve) => {
    child.once("exit", (code) => {
      resolve(code ?? 1);
    });
    child.once("error", () => {
      resolve(1);
    });
  });
}
function drainPipe(stream) {
  if (stream === null) {
    return;
  }
  stream.resume();
}
function drainAsyncIterable(lines) {
  (async () => {
    for await (const _ of lines) {}
  })();
}

// src/session/index.ts
import { readdir, stat } from "fs/promises";
import { join as join2, resolve } from "path";
import { homedir } from "os";

// src/session/sqlite.ts
import { Database } from "bun:sqlite";
import { join } from "path";
var STATE_DB_FILENAME = "state";
function openCodexDb(codexHome) {
  const home = codexHome ?? resolveCodexHome();
  const dbPath = join(home, STATE_DB_FILENAME);
  try {
    const db = new Database(dbPath, { readonly: true });
    const check = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='threads'").get();
    if (check === null) {
      db.close();
      return null;
    }
    return db;
  } catch {
    return null;
  }
}
function rowToSession(row) {
  const gitSha = row["git_sha"];
  const gitBranch = row["git_branch"];
  const gitOriginUrl = row["git_origin_url"];
  const git = gitSha || gitBranch || gitOriginUrl ? {
    ...gitSha ? { sha: gitSha } : {},
    ...gitBranch ? { branch: gitBranch } : {},
    ...gitOriginUrl ? { origin_url: gitOriginUrl } : {}
  } : undefined;
  const source = row["source"] ?? "unknown";
  return {
    id: row["id"],
    rolloutPath: row["rollout_path"],
    createdAt: new Date(row["created_at"]),
    updatedAt: new Date(row["updated_at"]),
    source,
    modelProvider: row["model_provider"],
    cwd: row["cwd"],
    cliVersion: row["cli_version"],
    title: row["title"] ?? row["first_user_message"] ?? row["id"],
    firstUserMessage: row["first_user_message"],
    archivedAt: row["archived_at"] ? new Date(row["archived_at"]) : undefined,
    git
  };
}
function buildWhereClause(options) {
  const conditions = [];
  const params = [];
  if (options?.source !== undefined) {
    conditions.push("source = ?");
    params.push(options.source);
  }
  if (options?.cwd !== undefined) {
    conditions.push("cwd = ?");
    params.push(options.cwd);
  }
  if (options?.branch !== undefined) {
    conditions.push("git_branch = ?");
    params.push(options.branch);
  }
  const where = conditions.length > 0 ? "WHERE " + conditions.join(" AND ") : "";
  return { where, params };
}
function listSessionsSqlite(db, options) {
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const sortBy = options?.sortBy ?? "createdAt";
  const sortOrder = options?.sortOrder ?? "desc";
  const { where, params } = buildWhereClause(options);
  const orderCol = sortBy === "updatedAt" ? "updated_at" : "created_at";
  const orderDir = sortOrder === "asc" ? "ASC" : "DESC";
  const countSql = `SELECT COUNT(*) as cnt FROM threads ${where}`;
  const countRow = db.query(countSql).get(...params);
  const total = countRow?.cnt ?? 0;
  const selectSql = `SELECT * FROM threads ${where} ORDER BY ${orderCol} ${orderDir} LIMIT ? OFFSET ?`;
  const rows = db.query(selectSql).all(...params, limit, offset);
  const sessions = rows.map(rowToSession);
  return { sessions, total, offset, limit };
}
function findSessionSqlite(db, id) {
  const row = db.query("SELECT * FROM threads WHERE id = ?").get(id);
  if (row === null) {
    return null;
  }
  return rowToSession(row);
}
function findLatestSessionSqlite(db, cwd) {
  let sql = "SELECT * FROM threads";
  const params = [];
  if (cwd !== undefined) {
    sql += " WHERE cwd = ?";
    params.push(cwd);
  }
  sql += " ORDER BY updated_at DESC LIMIT 1";
  const row = db.query(sql).get(...params);
  if (row === null) {
    return null;
  }
  return rowToSession(row);
}

// src/session/index.ts
var DEFAULT_CODEX_HOME = join2(homedir(), ".codex");
var SESSIONS_DIR = "sessions";
var ARCHIVED_DIR = "archived_sessions";
var ROLLOUT_PREFIX = "rollout-";
var ROLLOUT_EXT = ".jsonl";
function resolveCodexHome() {
  return process.env["CODEX_HOME"] ?? DEFAULT_CODEX_HOME;
}
async function* discoverRolloutPaths(codexHome) {
  const home = codexHome ?? resolveCodexHome();
  const sessionsDir = join2(home, SESSIONS_DIR);
  if (!await dirExists(sessionsDir)) {
    return;
  }
  const years = await readSortedDirs(sessionsDir, "desc");
  for (const year of years) {
    const yearPath = join2(sessionsDir, year);
    const months = await readSortedDirs(yearPath, "desc");
    for (const month of months) {
      const monthPath = join2(yearPath, month);
      const days = await readSortedDirs(monthPath, "desc");
      for (const day of days) {
        const dayPath = join2(monthPath, day);
        const files = await readSortedFiles(dayPath, "desc");
        for (const file of files) {
          if (file.startsWith(ROLLOUT_PREFIX) && file.endsWith(ROLLOUT_EXT)) {
            yield join2(dayPath, file);
          }
        }
      }
    }
  }
  const archivedDir = join2(home, ARCHIVED_DIR);
  if (await dirExists(archivedDir)) {
    const files = await readSortedFiles(archivedDir, "desc");
    for (const file of files) {
      if (file.startsWith(ROLLOUT_PREFIX) && file.endsWith(ROLLOUT_EXT)) {
        yield join2(archivedDir, file);
      }
    }
  }
}
async function buildSession(rolloutPath) {
  const meta = await parseSessionMeta(rolloutPath);
  if (meta === null) {
    return null;
  }
  const fileStat = await stat(rolloutPath);
  const firstMessage = await extractFirstUserMessage(rolloutPath);
  const isArchived = rolloutPath.includes(`/${ARCHIVED_DIR}/`);
  return sessionFromMeta(meta, rolloutPath, fileStat.mtime, firstMessage, isArchived);
}
async function listSessions(options) {
  const codexHome = options?.codexHome;
  const db = openCodexDb(codexHome);
  if (db !== null) {
    try {
      return listSessionsSqlite(db, options);
    } catch {} finally {
      db.close();
    }
  }
  return listSessionsFilesystem(options);
}
async function listSessionsFilesystem(options) {
  const codexHome = options?.codexHome;
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;
  const sortBy = options?.sortBy ?? "createdAt";
  const sortOrder = options?.sortOrder ?? "desc";
  const sessions = [];
  for await (const rolloutPath of discoverRolloutPaths(codexHome)) {
    const session = await buildSession(rolloutPath);
    if (session === null) {
      continue;
    }
    if (!matchesFilter(session, options)) {
      continue;
    }
    sessions.push(session);
  }
  sessions.sort((a, b) => {
    const aVal = sortBy === "updatedAt" ? a.updatedAt.getTime() : a.createdAt.getTime();
    const bVal = sortBy === "updatedAt" ? b.updatedAt.getTime() : b.createdAt.getTime();
    return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
  });
  const total = sessions.length;
  const paged = sessions.slice(offset, offset + limit);
  return { sessions: paged, total, offset, limit };
}
async function findSession(id, codexHome) {
  const db = openCodexDb(codexHome);
  if (db !== null) {
    try {
      const session = findSessionSqlite(db, id);
      if (session !== null) {
        return session;
      }
    } catch {} finally {
      db.close();
    }
  }
  for await (const rolloutPath of discoverRolloutPaths(codexHome)) {
    if (!rolloutPath.includes(id)) {
      continue;
    }
    const session = await buildSession(rolloutPath);
    if (session !== null && session.id === id) {
      return session;
    }
  }
  return null;
}
async function findLatestSession(codexHome, cwd) {
  const db = openCodexDb(codexHome);
  if (db !== null) {
    try {
      const session = findLatestSessionSqlite(db, cwd);
      if (session !== null) {
        return session;
      }
    } catch {} finally {
      db.close();
    }
  }
  for await (const rolloutPath of discoverRolloutPaths(codexHome)) {
    const session = await buildSession(rolloutPath);
    if (session === null) {
      continue;
    }
    if (cwd !== undefined && resolve(session.cwd) !== resolve(cwd)) {
      continue;
    }
    return session;
  }
  return null;
}
function sessionFromMeta(meta, rolloutPath, mtime, firstUserMessage, isArchived) {
  const metaRecord = toRecord2(meta.meta);
  if (metaRecord === null) {
    return null;
  }
  const id = readString2(metaRecord, "id");
  const timestamp = readString2(metaRecord, "timestamp");
  const cwd = readString2(metaRecord, "cwd");
  const source = toSessionSource(readString2(metaRecord, "source"));
  if (id === undefined || timestamp === undefined || cwd === undefined || source === undefined) {
    return null;
  }
  const createdAt = new Date(timestamp);
  if (Number.isNaN(createdAt.getTime())) {
    return null;
  }
  return {
    id,
    rolloutPath,
    createdAt,
    updatedAt: mtime,
    source,
    modelProvider: readString2(metaRecord, "model_provider"),
    cwd,
    cliVersion: readString2(metaRecord, "cli_version") ?? "unknown",
    title: firstUserMessage ?? id,
    firstUserMessage,
    archivedAt: isArchived ? mtime : undefined,
    git: meta.git,
    forkedFromId: readString2(metaRecord, "forked_from_id")
  };
}
function toRecord2(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value;
}
function readString2(record, key) {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
function toSessionSource(value) {
  if (value === "cli" || value === "vscode" || value === "exec" || value === "unknown") {
    return value;
  }
  return;
}
function matchesFilter(session, options) {
  if (options === undefined) {
    return true;
  }
  if (options.source !== undefined && session.source !== options.source) {
    return false;
  }
  if (options.cwd !== undefined && resolve(session.cwd) !== resolve(options.cwd)) {
    return false;
  }
  if (options.branch !== undefined && session.git?.branch !== options.branch) {
    return false;
  }
  return true;
}
async function dirExists(path) {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}
async function readSortedDirs(parent, order) {
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    dirs.sort();
    if (order === "desc") {
      dirs.reverse();
    }
    return dirs;
  } catch {
    return [];
  }
}
async function readSortedFiles(parent, order) {
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    files.sort();
    if (order === "desc") {
      files.reverse();
    }
    return files;
  } catch {
    return [];
  }
}

// src/rollout/watcher.ts
import { watch } from "fs";
import { open, stat as stat2 } from "fs/promises";
import { join as join3 } from "path";
import { EventEmitter as EventEmitter2 } from "events";
var ROLLOUT_PREFIX2 = "rollout-";
var ROLLOUT_EXT2 = ".jsonl";
var DEBOUNCE_MS = 100;

class RolloutWatcher extends EventEmitter2 {
  fileWatchers = new Map;
  dirWatchers = new Map;
  closed = false;
  async watchFile(path, options) {
    if (this.closed) {
      return;
    }
    if (this.fileWatchers.has(path)) {
      return;
    }
    const fileSize = await getFileSize(path);
    const requestedOffset = options?.startOffset;
    const startOffset = requestedOffset !== undefined && Number.isFinite(requestedOffset) ? Math.max(0, Math.floor(requestedOffset)) : fileSize;
    const state = {
      path,
      offset: startOffset,
      watcher: null,
      debounceTimer: null,
      inFlightRead: null,
      pendingRead: false
    };
    const watcher = watch(path, () => {
      this.debouncedReadAppended(state);
    });
    watcher.on("error", (err) => {
      this.emit("error", err);
    });
    state.watcher = watcher;
    this.fileWatchers.set(path, state);
    this.enqueueRead(state);
  }
  watchDirectory(dir) {
    if (this.closed) {
      return;
    }
    if (this.dirWatchers.has(dir)) {
      return;
    }
    const watcher = watch(dir, { recursive: true }, (_event, filename) => {
      if (filename === null) {
        return;
      }
      const basename = filename.split("/").pop() ?? filename;
      if (basename.startsWith(ROLLOUT_PREFIX2) && basename.endsWith(ROLLOUT_EXT2)) {
        const fullPath = join3(dir, filename);
        this.emit("newSession", fullPath);
      }
    });
    watcher.on("error", (err) => {
      this.emit("error", err);
    });
    this.dirWatchers.set(dir, watcher);
  }
  stop() {
    this.closed = true;
    for (const state of this.fileWatchers.values()) {
      if (state.debounceTimer !== null) {
        clearTimeout(state.debounceTimer);
      }
      state.watcher?.close();
    }
    this.fileWatchers.clear();
    for (const watcher of this.dirWatchers.values()) {
      watcher.close();
    }
    this.dirWatchers.clear();
    this.removeAllListeners();
  }
  async flush() {
    if (this.closed) {
      return;
    }
    for (const state of this.fileWatchers.values()) {
      await this.enqueueRead(state);
    }
  }
  get isClosed() {
    return this.closed;
  }
  debouncedReadAppended(state) {
    if (state.debounceTimer !== null) {
      clearTimeout(state.debounceTimer);
    }
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      this.enqueueRead(state);
    }, DEBOUNCE_MS);
  }
  async enqueueRead(state) {
    if (state.inFlightRead !== null) {
      state.pendingRead = true;
      await state.inFlightRead;
      return;
    }
    const run = (async () => {
      do {
        state.pendingRead = false;
        await this.readAppendedLines(state);
      } while (state.pendingRead && !this.closed);
    })();
    state.inFlightRead = run;
    try {
      await run;
    } finally {
      state.inFlightRead = null;
    }
  }
  async readAppendedLines(state) {
    if (this.closed) {
      return;
    }
    try {
      const currentSize = await getFileSize(state.path);
      if (currentSize <= state.offset) {
        return;
      }
      const fd = await open(state.path, "r");
      try {
        const bytesToRead = currentSize - state.offset;
        const buffer = new Uint8Array(bytesToRead);
        await fd.read(buffer, 0, bytesToRead, state.offset);
        state.offset = currentSize;
        const text = new TextDecoder().decode(buffer);
        const lines = text.split(`
`);
        for (const line of lines) {
          const parsed = parseRolloutLine(line);
          if (parsed !== null) {
            this.emit("line", state.path, parsed);
          }
        }
      } finally {
        await fd.close();
      }
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }
}
async function getFileSize(path) {
  try {
    const s = await stat2(path);
    return s.size;
  } catch {
    return 0;
  }
}
function sessionsWatchDir(codexHome) {
  return join3(codexHome, "sessions");
}

// src/sdk/session-runner.ts
class RunningSession extends EventEmitter3 {
  _sessionId;
  allowSessionIdUpdate;
  pm;
  processId;
  startedAt;
  streamGranularity;
  state;
  stopHook = null;
  constructor(sessionId, pm, processId, startedAt, streamGranularity, allowSessionIdUpdate = true) {
    super();
    this._sessionId = sessionId;
    this.allowSessionIdUpdate = allowSessionIdUpdate;
    this.pm = pm;
    this.processId = processId;
    this.startedAt = startedAt;
    this.streamGranularity = streamGranularity;
    let resolveCompletion = null;
    const completionPromise = new Promise((resolve2) => {
      resolveCompletion = resolve2;
    });
    this.state = {
      completed: false,
      completionResolver: resolveCompletion,
      completionPromise,
      queued: [],
      waiter: null,
      messageCount: 0
    };
  }
  get sessionId() {
    return this._sessionId;
  }
  setStopHook(stop) {
    this.stopHook = stop;
  }
  pushLine(line) {
    if (this.allowSessionIdUpdate && isSessionMeta(line) && this._sessionId !== line.payload.meta.id) {
      this._sessionId = line.payload.meta.id;
      this.emit("sessionId", this._sessionId);
    }
    this.state.messageCount += 1;
    this.emit("message", line);
    const chunks = this.streamGranularity === "char" ? toCharStreamChunks(line, this._sessionId) : [line];
    for (const chunk of chunks) {
      this.state.queued.push(chunk);
    }
    if (this.state.waiter !== null) {
      const waiter = this.state.waiter;
      this.state.waiter = null;
      waiter();
    }
  }
  finish(exitCode) {
    if (this.state.completed) {
      return;
    }
    this.state.completed = true;
    const completedAt = new Date;
    const result = {
      success: exitCode === 0,
      exitCode,
      stats: {
        startedAt: this.startedAt.toISOString(),
        completedAt: completedAt.toISOString(),
        messageCount: this.state.messageCount
      }
    };
    this.emit("complete", result);
    if (this.state.completionResolver !== null) {
      this.state.completionResolver(result);
      this.state.completionResolver = null;
    }
    if (this.state.waiter !== null) {
      const waiter = this.state.waiter;
      this.state.waiter = null;
      waiter();
    }
  }
  async* messages() {
    while (!this.state.completed || this.state.queued.length > 0) {
      while (this.state.queued.length > 0) {
        const line = this.state.queued.shift();
        if (line !== undefined) {
          yield line;
        }
      }
      if (this.state.completed) {
        break;
      }
      await new Promise((resolve2) => {
        this.state.waiter = resolve2;
      });
    }
  }
  async waitForCompletion() {
    return await this.state.completionPromise;
  }
  async cancel() {
    this.stopHook?.();
    this.pm.kill(this.processId);
  }
  async interrupt() {
    this.pm.writeInput(this.processId, "\x03");
  }
  async pause() {}
  async resume() {}
}

class SessionRunner {
  options;
  pm;
  active = new Set;
  constructor(options) {
    this.options = options ?? {};
    this.pm = new ProcessManager(options?.codexBinary);
  }
  async startSession(config) {
    if (config.resumeSessionId !== undefined) {
      return await this.resumeSession(config.resumeSessionId, config.prompt, {
        cwd: config.cwd,
        model: config.model,
        systemPrompt: config.systemPrompt,
        sandbox: config.sandbox,
        approvalMode: config.approvalMode,
        fullAuto: config.fullAuto,
        additionalArgs: config.additionalArgs,
        configOverrides: config.configOverrides,
        images: config.images,
        streamGranularity: config.streamGranularity,
        environmentVariables: config.environmentVariables
      });
    }
    const startedAt = new Date;
    const options = this.toProcessOptions(config);
    const execStream = this.pm.spawnExecStream(config.prompt, options);
    const session = new RunningSession(`pending-${startedAt.getTime()}`, this.pm, execStream.process.id, startedAt, options.streamGranularity ?? "event");
    this.trackSession(session);
    this.forwardExecStream(execStream, session);
    return session;
  }
  async resumeSession(sessionId, prompt, options) {
    const codexHome = this.resolveCodexHome(options);
    const sessionInfo = await findSession(sessionId, codexHome);
    const includeExisting = this.options.includeExistingOnResume === true;
    const preResumeRolloutOffset = sessionInfo !== null ? await getRolloutSize(sessionInfo.rolloutPath) : undefined;
    const existingRolloutLines = includeExisting && sessionInfo !== null ? await readRollout(sessionInfo.rolloutPath) : undefined;
    const startedAt = new Date;
    const resumeStream = this.pm.spawnResumeStream(sessionId, {
      ...options,
      codexBinary: this.options.codexBinary
    }, prompt);
    const running = new RunningSession(sessionId, this.pm, resumeStream.process.id, startedAt, options?.streamGranularity ?? "event", false);
    this.trackSession(running);
    const seenLineKeys = new Set;
    const pushLineIfNew = (line) => {
      const key = stableLineKey(line);
      if (seenLineKeys.has(key)) {
        return;
      }
      seenLineKeys.add(key);
      running.pushLine(line);
    };
    const watcher = new RolloutWatcher;
    watcher.on("line", (_path, line) => {
      pushLineIfNew(line);
    });
    let attachPromise = null;
    if (sessionInfo !== null) {
      if (includeExisting) {
        for (const line of existingRolloutLines ?? []) {
          pushLineIfNew(line);
        }
      }
      await watcher.watchFile(sessionInfo.rolloutPath, {
        startOffset: preResumeRolloutOffset
      });
    } else {
      attachPromise = this.attachWatchWhenSessionAppears(sessionId, codexHome, watcher, includeExisting);
    }
    running.setStopHook(() => watcher.stop());
    const streamForwardPromise = (async () => {
      for await (const line of resumeStream.lines) {
        pushLineIfNew(line);
      }
    })();
    resumeStream.completion.then(async (exitCode) => {
      await streamForwardPromise;
      if (attachPromise !== null) {
        await attachPromise;
      }
      await watcher.flush();
      watcher.stop();
      running.finish(exitCode);
    });
    return running;
  }
  async attachWatchWhenSessionAppears(sessionId, codexHome, watcher, includeExisting) {
    for (let attempt = 0;attempt < 20; attempt += 1) {
      if (watcher.isClosed) {
        return;
      }
      const discovered = await findSession(sessionId, codexHome);
      if (discovered !== null) {
        if (includeExisting) {
          const existing = await readRollout(discovered.rolloutPath);
          for (const line of existing) {
            watcher.emit("line", discovered.rolloutPath, line);
          }
          await watcher.watchFile(discovered.rolloutPath);
        } else {
          await watcher.watchFile(discovered.rolloutPath, { startOffset: 0 });
        }
        return;
      }
      await sleep(100);
    }
  }
  listActiveSessions() {
    return Array.from(this.active);
  }
  trackSession(session) {
    this.active.add(session);
    session.on("complete", () => {
      this.active.delete(session);
    });
  }
  toProcessOptions(config) {
    return {
      codexBinary: this.options.codexBinary,
      cwd: config.cwd,
      systemPrompt: config.systemPrompt,
      model: config.model,
      sandbox: config.sandbox,
      approvalMode: config.approvalMode,
      fullAuto: config.fullAuto,
      additionalArgs: config.additionalArgs,
      configOverrides: config.configOverrides,
      images: config.images,
      streamGranularity: config.streamGranularity,
      environmentVariables: config.environmentVariables
    };
  }
  resolveCodexHome(options) {
    return options?.environmentVariables?.["CODEX_HOME"] ?? this.options.codexHome;
  }
  forwardExecStream(stream, session) {
    (async () => {
      for await (const line of stream.lines) {
        session.pushLine(line);
      }
    })();
    stream.completion.then((exitCode) => {
      session.finish(exitCode);
    });
  }
}
function toCharStreamChunks(line, sessionId) {
  const textSegments = extractAssistantTextSegments(line);
  if (textSegments.length === 0) {
    return [line];
  }
  const chunks = [];
  for (const segment of textSegments) {
    for (const char of Array.from(segment)) {
      chunks.push({
        kind: "char",
        char,
        sessionId,
        timestamp: line.timestamp,
        sourceType: line.type,
        source: line
      });
    }
  }
  return chunks;
}
function extractAssistantTextSegments(line) {
  if (line.type === "event_msg") {
    const payload2 = toRecord3(line.payload);
    if (payload2?.["type"] === "AgentMessage" && typeof payload2["message"] === "string") {
      return [payload2["message"]];
    }
    return [];
  }
  if (line.type !== "response_item") {
    return [];
  }
  const payload = toRecord3(line.payload);
  if (payload?.["type"] !== "message" || payload["role"] !== "assistant" || !Array.isArray(payload["content"])) {
    return [];
  }
  const segments = [];
  for (const item of payload["content"]) {
    const content = toRecord3(item);
    if (content === null) {
      continue;
    }
    if ((content["type"] === "output_text" || content["type"] === "input_text") && typeof content["text"] === "string" && content["text"].length > 0) {
      segments.push(content["text"]);
    }
  }
  return segments;
}
function toRecord3(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value;
}
function sleep(ms) {
  return new Promise((resolve2) => {
    setTimeout(resolve2, ms);
  });
}
function stableLineKey(line) {
  return JSON.stringify(toCanonicalJsonValue(line));
}
function toCanonicalJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => toCanonicalJsonValue(item));
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  const record = value;
  const canonical = {};
  for (const key of Object.keys(record).sort()) {
    canonical[key] = toCanonicalJsonValue(record[key]);
  }
  return canonical;
}
async function getRolloutSize(path) {
  try {
    const info = await stat3(path);
    return info.size;
  } catch {
    return 0;
  }
}
// src/sdk/agent-runner.ts
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { extname, join as join4 } from "path";
import { randomUUID as randomUUID2 } from "crypto";
async function* runAgent(request, options) {
  const runner = new SessionRunner(options);
  const normalized = await normalizeAttachments(request.attachments);
  const resumed = isResumeRequest(request);
  const normalizedMode = request.streamMode === "normalized";
  let currentSessionId = resumed ? request.sessionId : undefined;
  try {
    const session = await startFromRequest(runner, request, normalized.imagePaths);
    currentSessionId = session.sessionId;
    const iterator = session.messages();
    const normalizerState = createNormalizerState();
    if (resumed) {
      const startedEvent = {
        type: "session.started",
        sessionId: session.sessionId,
        resumed: true
      };
      yield startedEvent;
    } else {
      const firstChunk = await iterator.next();
      if (firstChunk.done) {
        const startedEvent = {
          type: "session.started",
          sessionId: session.sessionId,
          resumed: false
        };
        yield startedEvent;
      } else {
        const startedSessionId = resolveSessionId(session.sessionId, firstChunk.value);
        currentSessionId = startedSessionId;
        const startedEvent = {
          type: "session.started",
          sessionId: startedSessionId,
          resumed: false
        };
        yield startedEvent;
        if (normalizedMode) {
          for (const event of normalizeChunkToEvents(firstChunk.value, startedSessionId, normalizerState, false)) {
            yield event;
          }
        } else {
          yield {
            type: "session.message",
            sessionId: startedSessionId,
            chunk: firstChunk.value
          };
        }
      }
    }
    while (true) {
      const nextChunk = await iterator.next();
      if (nextChunk.done) {
        break;
      }
      const resolvedSessionId2 = resolveSessionId(session.sessionId, nextChunk.value);
      currentSessionId = resolvedSessionId2;
      if (normalizedMode) {
        for (const event of normalizeChunkToEvents(nextChunk.value, resolvedSessionId2, normalizerState, false)) {
          yield event;
        }
      } else {
        yield {
          type: "session.message",
          sessionId: resolvedSessionId2,
          chunk: nextChunk.value
        };
      }
    }
    const result = await session.waitForCompletion();
    const resolvedSessionId = currentSessionId ?? session.sessionId;
    if (normalizedMode) {
      yield {
        type: "session.completed",
        sessionId: resolvedSessionId,
        success: result.success,
        exitCode: result.exitCode
      };
    } else {
      yield {
        type: "session.completed",
        sessionId: resolvedSessionId,
        result
      };
    }
  } catch (error) {
    yield {
      type: "session.error",
      sessionId: currentSessionId,
      error: toError(error)
    };
  } finally {
    await normalized.cleanup();
  }
}
async function* toNormalizedEvents(chunks) {
  const state = createNormalizerState();
  let fallbackSessionId = "unknown-session";
  for await (const chunk of chunks) {
    fallbackSessionId = resolveSessionId(fallbackSessionId, chunk);
    for (const event of normalizeChunkToEvents(chunk, fallbackSessionId, state, true)) {
      yield event;
    }
  }
}
async function startFromRequest(runner, request, imagePaths) {
  if (isResumeRequest(request)) {
    const session = await runner.resumeSession(request.sessionId, request.prompt, {
      cwd: request.cwd,
      model: request.model,
      sandbox: request.sandbox,
      approvalMode: request.approvalMode,
      fullAuto: request.fullAuto,
      additionalArgs: request.additionalArgs,
      configOverrides: request.configOverrides,
      images: imagePaths,
      streamGranularity: request.streamGranularity,
      environmentVariables: request.environmentVariables
    });
    return session;
  }
  const config = {
    prompt: request.prompt,
    cwd: request.cwd,
    model: request.model,
    sandbox: request.sandbox,
    approvalMode: request.approvalMode,
    fullAuto: request.fullAuto,
    additionalArgs: request.additionalArgs,
    configOverrides: request.configOverrides,
    images: imagePaths,
    streamGranularity: request.streamGranularity,
    environmentVariables: request.environmentVariables
  };
  return await runner.startSession(config);
}
async function normalizeAttachments(attachments) {
  if (attachments === undefined || attachments.length === 0) {
    return {
      imagePaths: [],
      cleanup: async () => {
        return;
      }
    };
  }
  const paths = [];
  const tempDirs = [];
  for (const attachment of attachments) {
    if (attachment.type === "path") {
      paths.push(attachment.path);
      continue;
    }
    const tempDir = await mkdtemp(join4(tmpdir(), "codex-agent-attachment-"));
    tempDirs.push(tempDir);
    const parsed = parseBase64Input(attachment.data);
    const mediaType = attachment.mediaType ?? parsed.mediaType;
    const ext = extensionForMediaType(mediaType);
    const fileName = sanitizeFileName(attachment.filename, ext);
    const filePath = join4(tempDir, fileName);
    const body = parsed.body;
    const content = Uint8Array.from(Buffer.from(body, "base64"));
    await writeFile(filePath, content);
    paths.push(filePath);
  }
  return {
    imagePaths: paths,
    cleanup: async () => {
      await Promise.all(tempDirs.map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      }));
    }
  };
}
function parseBase64Input(data) {
  if (!data.startsWith("data:")) {
    return { body: data };
  }
  const marker = ";base64,";
  const markerIndex = data.indexOf(marker);
  if (markerIndex < 0) {
    return { body: data };
  }
  const mediaType = data.slice(5, markerIndex);
  const body = data.slice(markerIndex + marker.length);
  if (mediaType.length === 0) {
    return { body };
  }
  return { body, mediaType };
}
function extensionForMediaType(mediaType) {
  if (mediaType === undefined) {
    return ".img";
  }
  switch (mediaType.toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".img";
  }
}
function sanitizeFileName(filename, defaultExt) {
  if (filename === undefined || filename.trim().length === 0) {
    return `${randomUUID2()}${defaultExt}`;
  }
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (safe.length === 0) {
    return `${randomUUID2()}${defaultExt}`;
  }
  if (extname(safe).length > 0) {
    return safe;
  }
  return `${safe}${defaultExt}`;
}
function resolveSessionId(fallbackSessionId, chunk) {
  if (isCharChunk(chunk)) {
    return chunk.sessionId;
  }
  if (chunk.type === "session_meta" && typeof chunk.payload === "object" && chunk.payload !== null && "meta" in chunk.payload) {
    const payload = chunk.payload;
    const candidate = payload.meta?.id;
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return fallbackSessionId;
}
function isCharChunk(chunk) {
  return chunk.kind === "char";
}
function toError(value) {
  if (value instanceof Error) {
    return value;
  }
  return new Error(typeof value === "string" ? value : "Unknown runAgent error");
}
function isResumeRequest(request) {
  return typeof request.sessionId === "string";
}
function createNormalizerState() {
  return {
    startedSessionIds: new Set,
    assistantSnapshots: new Map,
    toolNamesByCallId: new Map
  };
}
function normalizeChunkToEvents(chunk, fallbackSessionId, state, includeSessionStarted) {
  const sessionId = resolveSessionId(fallbackSessionId, chunk);
  const events = [];
  if (isCharChunk(chunk)) {
    events.push(...toAssistantTextEvents(sessionId, chunk.char, state));
    return events;
  }
  if (chunk.type === "session_meta") {
    if (includeSessionStarted && !state.startedSessionIds.has(sessionId)) {
      state.startedSessionIds.add(sessionId);
      events.push({
        type: "session.started",
        sessionId,
        resumed: false
      });
    }
    return events;
  }
  if (chunk.type === "event_msg") {
    const payload2 = toRecord4(chunk.payload);
    if (payload2 === null) {
      return events;
    }
    const payloadType = readString3(payload2["type"]);
    if (payloadType === "AgentMessage") {
      const message = readString3(payload2["message"]);
      if (message !== undefined) {
        events.push(...toAssistantTextEvents(sessionId, message, state));
      }
      return events;
    }
    if (payloadType === "AgentReasoning") {
      const message = readString3(payload2["text"]);
      events.push({
        type: "activity",
        sessionId,
        ...message !== undefined ? { message } : {}
      });
      return events;
    }
    if (payloadType === "ExecCommandBegin") {
      const callId = readString3(payload2["call_id"]);
      const command = readStringArray(payload2["command"]);
      const input = {
        callId,
        turnId: readString3(payload2["turn_id"]),
        cwd: readString3(payload2["cwd"]),
        command
      };
      events.push({
        type: "tool.call",
        sessionId,
        name: "local_shell",
        input
      });
      return events;
    }
    if (payloadType === "ExecCommandEnd") {
      const callId = readString3(payload2["call_id"]);
      const exitCode = readNumber(payload2["exit_code"]);
      const output = {
        callId,
        turnId: readString3(payload2["turn_id"]),
        cwd: readString3(payload2["cwd"]),
        command: readStringArray(payload2["command"]),
        exitCode,
        aggregatedOutput: payload2["aggregated_output"]
      };
      events.push({
        type: "tool.result",
        sessionId,
        name: "local_shell",
        isError: exitCode !== undefined ? exitCode !== 0 : false,
        output
      });
      return events;
    }
    if (payloadType === "Error") {
      events.push({
        type: "session.error",
        sessionId,
        error: new Error(readString3(payload2["message"]) ?? "Unknown rollout error")
      });
      return events;
    }
    events.push({
      type: "activity",
      sessionId,
      message: payloadType ?? "event_msg"
    });
    return events;
  }
  if (chunk.type !== "response_item") {
    return events;
  }
  const payload = toRecord4(chunk.payload);
  if (payload === null) {
    return events;
  }
  const itemType = readString3(payload["type"]);
  if (itemType === "function_call") {
    const name = readString3(payload["name"]) ?? "unknown-tool";
    const callId = readString3(payload["call_id"]);
    if (callId !== undefined) {
      state.toolNamesByCallId.set(callId, name);
    }
    events.push({
      type: "tool.call",
      sessionId,
      name,
      input: parseMaybeJson(readString3(payload["arguments"]))
    });
    return events;
  }
  if (itemType === "function_call_output") {
    const callId = readString3(payload["call_id"]);
    const output = payload["output"];
    const outputRecord = toRecord4(output);
    const isError = outputRecord?.["is_error"] === true || readString3(outputRecord?.["status"]) === "error";
    events.push({
      type: "tool.result",
      sessionId,
      name: (callId !== undefined ? state.toolNamesByCallId.get(callId) : undefined) ?? "unknown-tool",
      isError,
      output
    });
    return events;
  }
  if (itemType === "local_shell_call") {
    const status = readString3(payload["status"]);
    const action = payload["action"];
    const output = payload["output"];
    const callId = readString3(payload["call_id"]);
    const isTerminalStatus = status === "completed" || status === "failed" || status === "error";
    if (isTerminalStatus) {
      events.push({
        type: "tool.result",
        sessionId,
        name: "local_shell",
        isError: status !== "completed",
        output: {
          callId,
          status,
          action,
          output
        }
      });
      return events;
    }
    events.push({
      type: "tool.call",
      sessionId,
      name: "local_shell",
      input: {
        callId,
        status,
        action
      }
    });
    return events;
  }
  if (itemType === "message" && readString3(payload["role"]) === "assistant" && Array.isArray(payload["content"])) {
    for (const item of payload["content"]) {
      const content = toRecord4(item);
      if (content === null) {
        continue;
      }
      const contentType = readString3(content["type"]);
      if (contentType !== "output_text" && contentType !== "input_text") {
        continue;
      }
      const text = readString3(content["text"]);
      if (text !== undefined && text.length > 0) {
        events.push(...toAssistantTextEvents(sessionId, text, state));
      }
    }
    return events;
  }
  return events;
}
function toAssistantTextEvents(sessionId, text, state) {
  const previous = state.assistantSnapshots.get(sessionId) ?? "";
  const content = `${previous}${text}`;
  state.assistantSnapshots.set(sessionId, content);
  return [
    {
      type: "assistant.delta",
      sessionId,
      text
    },
    {
      type: "assistant.snapshot",
      sessionId,
      content
    }
  ];
}
function toRecord4(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value;
}
function readString3(value) {
  return typeof value === "string" ? value : undefined;
}
function readNumber(value) {
  return typeof value === "number" ? value : undefined;
}
function readStringArray(value) {
  if (!Array.isArray(value)) {
    return;
  }
  const strings = value.filter((item) => typeof item === "string");
  return strings.length > 0 ? strings : undefined;
}
function parseMaybeJson(value) {
  if (value === undefined) {
    return;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
// src/sdk/tool-versions.ts
import { spawn as spawn2 } from "child_process";
var DEFAULT_TIMEOUT_MS = 5000;
async function getCodexCliVersion(options) {
  return await readToolVersion(options?.codexBinary ?? "codex", options?.timeoutMs);
}
async function getToolVersions(options) {
  const codex = await getCodexCliVersion(options);
  if (options?.includeGit !== true) {
    return { codex };
  }
  const git = await readToolVersion(options.gitBinary ?? "git", options.timeoutMs);
  return { codex, git };
}
async function readToolVersion(binary, timeoutMs) {
  const effectiveTimeout = timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  return await new Promise((resolve2) => {
    const child = spawn2(binary, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve2(result);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      const message = err instanceof Error ? err.message : String(err);
      settle({ version: null, error: message });
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        const line = firstLine(stdout);
        if (line !== null) {
          settle({ version: line, error: null });
          return;
        }
        settle({
          version: null,
          error: "version command succeeded but produced no output"
        });
        return;
      }
      const reason = signal !== null ? `signal ${signal}` : `exit code ${String(code ?? "unknown")}`;
      const details = firstLine(stderr);
      const message = details === null ? `version command failed (${reason})` : `version command failed (${reason}): ${details}`;
      settle({ version: null, error: message });
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle({
        version: null,
        error: `version command timed out after ${effectiveTimeout}ms`
      });
    }, effectiveTimeout);
  });
}
function firstLine(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.split(/\r?\n/u)[0] ?? null;
}
// src/sdk/model-availability.ts
import { spawn as spawn3 } from "child_process";
var DEFAULT_TIMEOUT_MS2 = 15000;
var DEFAULT_PROBE_PROMPT = "Reply with exactly OK.";
async function getCodexLoginStatus(options) {
  const result = await runCodexCommand(options?.codexBinary ?? "codex", ["login", "status"], options);
  const status = firstNonEmptyLine(result.stdout) ?? firstNonEmptyLine(result.stderr);
  if (result.error !== null) {
    return {
      ok: false,
      status,
      error: status !== null && looksUnauthenticated(status) ? status : result.error,
      exitCode: result.exitCode
    };
  }
  if (status === null) {
    return {
      ok: false,
      status: null,
      error: "login status command succeeded but produced no output",
      exitCode: result.exitCode
    };
  }
  if (looksUnauthenticated(status)) {
    return {
      ok: false,
      status,
      error: status,
      exitCode: result.exitCode
    };
  }
  return {
    ok: true,
    status,
    error: null,
    exitCode: result.exitCode
  };
}
async function checkCodexModelAvailability(options) {
  const model = options.model.trim();
  if (model.length === 0) {
    throw new Error("model is required");
  }
  const [auth, probe] = await Promise.all([
    getCodexLoginStatus(options),
    runModelProbe({
      ...options,
      model
    })
  ]);
  return {
    ok: auth.ok && probe.ok,
    model,
    auth,
    probe
  };
}
async function runModelProbe(options) {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "--sandbox",
    "read-only"
  ];
  if (options.cwd !== undefined) {
    args.push("--cd", options.cwd);
  }
  args.push("--model", options.model, options.prompt ?? DEFAULT_PROBE_PROMPT);
  const result = await runCodexCommand(options.codexBinary ?? "codex", args, options);
  const output = firstNonEmptyLine(result.stdout);
  return {
    ok: result.error === null,
    model: options.model,
    output,
    error: result.error,
    exitCode: result.exitCode
  };
}
async function runCodexCommand(binary, args, options) {
  const timeoutMs = normalizeTimeout(options?.timeoutMs);
  return await new Promise((resolve2) => {
    const child = spawn3(binary, args, {
      cwd: options?.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env }
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer;
    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolve2(result);
    };
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      settle({
        exitCode: null,
        stdout,
        stderr,
        error: toErrorMessage(error)
      });
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        settle({
          exitCode: 0,
          stdout,
          stderr,
          error: null
        });
        return;
      }
      const reason = signal !== null ? `signal ${signal}` : `exit code ${String(code ?? "unknown")}`;
      const details = firstNonEmptyLine(stderr) ?? firstNonEmptyLine(stdout);
      settle({
        exitCode: code ?? null,
        stdout,
        stderr,
        error: details === null ? `command failed (${reason})` : `command failed (${reason}): ${details}`
      });
    });
    timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle({
        exitCode: null,
        stdout,
        stderr,
        error: `command timed out after ${timeoutMs}ms`
      });
    }, timeoutMs);
  });
}
function normalizeTimeout(value) {
  if (value !== undefined && Number.isFinite(value) && value > 0) {
    return value;
  }
  return DEFAULT_TIMEOUT_MS2;
}
function looksUnauthenticated(status) {
  return /not\s+logged|logged\s*out|unauthenticated|no\s+stored\s+credentials/iu.test(status);
}
function firstNonEmptyLine(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.split(/\r?\n/u)[0] ?? null;
}
function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
// src/sdk/usage-stats.ts
import { readdir as readdir2 } from "fs/promises";
import { join as join5 } from "path";
var ROLLOUT_PREFIX3 = "rollout-";
var ROLLOUT_EXT3 = ".jsonl";
var DEFAULT_RECENT_DAYS = 14;
var DEFAULT_CACHE_TTL_MS = 5000;
var usageStatsCache = null;
async function getCodexUsageStats(options) {
  const sessionsDir = options?.codexSessionsDir ?? join5(resolveCodexHome(), "sessions");
  const recentDays = normalizeRecentDays(options?.recentDays);
  const now = resolveNowMs(options?.now);
  const cacheKey = `${sessionsDir}::${String(recentDays)}`;
  if (usageStatsCache !== null && usageStatsCache.key === cacheKey && usageStatsCache.expiresAt > now) {
    return usageStatsCache.value;
  }
  const rolloutFiles = await listRolloutFiles(sessionsDir);
  if (rolloutFiles === null) {
    cacheUsageStats(cacheKey, now, null);
    return null;
  }
  const lastComputedDate = dateKeyFromEpochMs(now);
  const firstRecentDayEpochMs = dayStartEpochMs(now) - (recentDays - 1) * 86400000;
  let totalSessions = 0;
  let totalMessages = 0;
  let firstSessionDate = null;
  const modelUsageMap = new Map;
  const dailyActivityMap = new Map;
  const tokenCountStateByKey = new Map;
  for (const rolloutFile of rolloutFiles) {
    let hadParsableLine = false;
    let sessionDateForFile = null;
    try {
      for await (const line of streamEvents(rolloutFile)) {
        hadParsableLine = true;
        const lineDate = dateKeyFromTimestamp(line.timestamp);
        if (lineDate !== null && (sessionDateForFile === null || lineDate < sessionDateForFile)) {
          sessionDateForFile = lineDate;
        }
        if (isSessionMeta(line)) {
          const sessionMetaTimestamp = extractSessionMetaTimestamp(line.payload);
          if (sessionMetaTimestamp !== undefined) {
            const sessionMetaDate = dateKeyFromTimestamp(sessionMetaTimestamp);
            if (sessionMetaDate !== null && (sessionDateForFile === null || sessionMetaDate < sessionDateForFile)) {
              sessionDateForFile = sessionMetaDate;
            }
          }
        }
        if (isUserOrAssistantMessage(line)) {
          totalMessages += 1;
          if (lineDate !== null) {
            getOrCreateDailyActivity(dailyActivityMap, lineDate).messageCount += 1;
          }
        }
        const toolCalls = extractToolCallCount(line);
        if (toolCalls > 0 && lineDate !== null) {
          getOrCreateDailyActivity(dailyActivityMap, lineDate).toolCallCount += toolCalls;
        }
        const rawUsageEvent = extractUsageEvent(line);
        const usageEvent = normalizeUsageEventForAggregation(rawUsageEvent, tokenCountStateByKey);
        if (usageEvent === null || usageEvent.totalTokens <= 0) {
          continue;
        }
        const model = usageEvent.model;
        const modelUsage = getOrCreateModelUsage(modelUsageMap, model);
        modelUsage.inputTokens += usageEvent.inputTokens;
        modelUsage.outputTokens += usageEvent.outputTokens;
        modelUsage.cacheReadInputTokens += usageEvent.cacheReadInputTokens;
        modelUsage.cacheCreationInputTokens += usageEvent.cacheCreationInputTokens;
        if (lineDate !== null) {
          const daily = getOrCreateDailyActivity(dailyActivityMap, lineDate);
          const prev = daily.tokensByModel.get(model) ?? 0;
          daily.tokensByModel.set(model, prev + usageEvent.totalTokens);
        }
      }
    } catch {
      continue;
    }
    if (!hadParsableLine) {
      continue;
    }
    totalSessions += 1;
    if (sessionDateForFile !== null) {
      if (firstSessionDate === null || sessionDateForFile < firstSessionDate) {
        firstSessionDate = sessionDateForFile;
      }
      getOrCreateDailyActivity(dailyActivityMap, sessionDateForFile).sessionCount += 1;
    }
  }
  const recentDailyActivity = [];
  for (let offset = 0;offset < recentDays; offset += 1) {
    const epochMs = firstRecentDayEpochMs + offset * 86400000;
    const date = dateKeyFromEpochMs(epochMs);
    const activity = dailyActivityMap.get(date);
    if (activity === undefined) {
      recentDailyActivity.push({ date });
      continue;
    }
    const tokensByModel = mapToRecord(activity.tokensByModel);
    recentDailyActivity.push({
      date,
      ...activity.messageCount > 0 ? { messageCount: activity.messageCount } : {},
      ...activity.sessionCount > 0 ? { sessionCount: activity.sessionCount } : {},
      ...activity.toolCallCount > 0 ? { toolCallCount: activity.toolCallCount } : {},
      ...Object.keys(tokensByModel).length > 0 ? { tokensByModel } : {}
    });
  }
  const result = {
    totalSessions,
    totalMessages,
    firstSessionDate,
    lastComputedDate,
    modelUsage: mapToRecord(modelUsageMap),
    recentDailyActivity
  };
  cacheUsageStats(cacheKey, now, result);
  return result;
}
function normalizeRecentDays(value) {
  if (value === undefined) {
    return DEFAULT_RECENT_DAYS;
  }
  if (!Number.isFinite(value)) {
    return DEFAULT_RECENT_DAYS;
  }
  const floored = Math.floor(value);
  return floored > 0 ? floored : DEFAULT_RECENT_DAYS;
}
function resolveNowMs(value) {
  if (value instanceof Date) {
    const epochMs = value.getTime();
    return Number.isFinite(epochMs) ? epochMs : Date.now();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return Date.now();
}
async function listRolloutFiles(sessionsDir) {
  try {
    const files = [];
    await collectRolloutFilesRecursive(sessionsDir, files);
    files.sort();
    return files;
  } catch {
    return null;
  }
}
async function collectRolloutFilesRecursive(dirPath, out) {
  const entries = await readdir2(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join5(dirPath, entry.name);
    if (entry.isDirectory()) {
      await collectRolloutFilesRecursive(fullPath, out);
      continue;
    }
    if (entry.isFile() && entry.name.startsWith(ROLLOUT_PREFIX3) && entry.name.endsWith(ROLLOUT_EXT3)) {
      out.push(fullPath);
    }
  }
}
function cacheUsageStats(key, nowEpochMs, value) {
  usageStatsCache = {
    key,
    expiresAt: nowEpochMs + DEFAULT_CACHE_TTL_MS,
    value
  };
}
function getOrCreateModelUsage(modelUsageMap, model) {
  const existing = modelUsageMap.get(model);
  if (existing !== undefined) {
    return existing;
  }
  const created = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0
  };
  modelUsageMap.set(model, created);
  return created;
}
function getOrCreateDailyActivity(activityMap, date) {
  const existing = activityMap.get(date);
  if (existing !== undefined) {
    return existing;
  }
  const created = {
    messageCount: 0,
    sessionCount: 0,
    toolCallCount: 0,
    tokensByModel: new Map
  };
  activityMap.set(date, created);
  return created;
}
function mapToRecord(value) {
  const result = {};
  for (const [key, entry] of value.entries()) {
    result[key] = entry;
  }
  return result;
}
function isUserOrAssistantMessage(line) {
  if (isEventMsg(line)) {
    const payload = toRecord5(line.payload);
    const eventType = readString4(payload, "type");
    return eventType === "UserMessage" || eventType === "AgentMessage";
  }
  if (isResponseItem(line)) {
    const payload = toRecord5(line.payload);
    if (readString4(payload, "type") !== "message") {
      return false;
    }
    const role = readString4(payload, "role");
    return role === "user" || role === "assistant";
  }
  return false;
}
function extractToolCallCount(line) {
  if (isEventMsg(line)) {
    const payload = toRecord5(line.payload);
    if (readString4(payload, "type") === "ExecCommandBegin") {
      return 1;
    }
  }
  if (isResponseItem(line)) {
    const payload = toRecord5(line.payload);
    const itemType = readString4(payload, "type");
    if (itemType === "function_call" || itemType === "local_shell_call") {
      return 1;
    }
  }
  return 0;
}
function extractUsageEvent(line) {
  if (!isEventMsg(line)) {
    return null;
  }
  const payload = toRecord5(line.payload);
  if (payload === null) {
    return null;
  }
  const eventType = readString4(payload, "type");
  let usage = null;
  let modelFromInfo;
  let source = null;
  let isCumulative = false;
  let aggregationKey;
  let model;
  if (eventType === "TurnComplete") {
    source = "turn_complete";
    usage = toRecord5(payload["usage"]);
  } else if (eventType === "token_count" || eventType === "TokenCount") {
    const info = toRecord5(payload["info"]);
    if (info === null) {
      return null;
    }
    source = "token_count";
    modelFromInfo = readString4(info, "model");
    const lastTokenUsage = toRecord5(info["last_token_usage"]) ?? toRecord5(payload["last_token_usage"]);
    const totalTokenUsage = toRecord5(info["total_token_usage"]) ?? toRecord5(payload["total_token_usage"]);
    if (lastTokenUsage !== null) {
      usage = lastTokenUsage;
      isCumulative = false;
    } else if (totalTokenUsage !== null) {
      usage = totalTokenUsage;
      isCumulative = true;
    } else {
      usage = toRecord5(info["usage"]) ?? toRecord5(payload["usage"]) ?? payload;
      isCumulative = false;
    }
    model = resolveTokenCountModel(payload, usage, info, modelFromInfo);
    aggregationKey = extractTokenCountAggregationKey(payload, info, model);
  }
  if (source === null || usage === null) {
    return null;
  }
  const inputTokens = readNumber2(usage, "input_tokens") ?? readNumber2(usage, "inputTokens") ?? 0;
  const outputTokens = readNumber2(usage, "output_tokens") ?? readNumber2(usage, "outputTokens") ?? 0;
  const cacheReadInputTokens = readNumber2(usage, "cache_read_input_tokens") ?? readNumber2(usage, "cacheReadInputTokens") ?? readNumber2(usage, "cached_input_tokens") ?? 0;
  const cacheCreationInputTokens = readNumber2(usage, "cache_creation_input_tokens") ?? readNumber2(usage, "cacheCreationInputTokens") ?? 0;
  const computedTotal = inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens;
  const totalTokens = readNumber2(usage, "total_tokens") ?? readNumber2(usage, "totalTokens") ?? computedTotal;
  model = model ?? modelFromInfo ?? readString4(usage, "model") ?? readString4(usage, "model_id") ?? readString4(payload, "model") ?? "unknown";
  return {
    source,
    model,
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    totalTokens,
    isCumulative,
    ...aggregationKey !== undefined ? { aggregationKey } : {}
  };
}
function normalizeUsageEventForAggregation(usageEvent, tokenCountStateByKey) {
  if (usageEvent === null || usageEvent.source !== "token_count") {
    return usageEvent;
  }
  const key = usageEvent.aggregationKey ?? usageEvent.model;
  const state = getOrCreateTokenCountState(tokenCountStateByKey, key);
  if (!usageEvent.isCumulative) {
    return usageEvent;
  }
  if (state.lastTotalTokens !== undefined && usageEvent.totalTokens < state.lastTotalTokens) {
    setTokenCountState(state, usageEvent);
    return {
      ...usageEvent,
      isCumulative: false
    };
  }
  const deltaInputTokens = positiveDelta(usageEvent.inputTokens, state.lastInputTokens);
  const deltaOutputTokens = positiveDelta(usageEvent.outputTokens, state.lastOutputTokens);
  const deltaCacheReadInputTokens = positiveDelta(usageEvent.cacheReadInputTokens, state.lastCacheReadInputTokens);
  const deltaCacheCreationInputTokens = positiveDelta(usageEvent.cacheCreationInputTokens, state.lastCacheCreationInputTokens);
  const deltaTotalTokens = positiveDelta(usageEvent.totalTokens, state.lastTotalTokens);
  setTokenCountStateMax(state, usageEvent);
  if (deltaTotalTokens <= 0) {
    return null;
  }
  return {
    ...usageEvent,
    inputTokens: deltaInputTokens,
    outputTokens: deltaOutputTokens,
    cacheReadInputTokens: deltaCacheReadInputTokens,
    cacheCreationInputTokens: deltaCacheCreationInputTokens,
    totalTokens: deltaTotalTokens,
    isCumulative: false
  };
}
function getOrCreateTokenCountState(stateByKey, key) {
  const existing = stateByKey.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const created = {};
  stateByKey.set(key, created);
  return created;
}
function setTokenCountState(state, usageEvent) {
  state.lastInputTokens = usageEvent.inputTokens;
  state.lastOutputTokens = usageEvent.outputTokens;
  state.lastCacheReadInputTokens = usageEvent.cacheReadInputTokens;
  state.lastCacheCreationInputTokens = usageEvent.cacheCreationInputTokens;
  state.lastTotalTokens = usageEvent.totalTokens;
}
function setTokenCountStateMax(state, usageEvent) {
  state.lastInputTokens = maxDefined(state.lastInputTokens, usageEvent.inputTokens);
  state.lastOutputTokens = maxDefined(state.lastOutputTokens, usageEvent.outputTokens);
  state.lastCacheReadInputTokens = maxDefined(state.lastCacheReadInputTokens, usageEvent.cacheReadInputTokens);
  state.lastCacheCreationInputTokens = maxDefined(state.lastCacheCreationInputTokens, usageEvent.cacheCreationInputTokens);
  state.lastTotalTokens = maxDefined(state.lastTotalTokens, usageEvent.totalTokens);
}
function positiveDelta(current, previous) {
  if (previous === undefined) {
    return current;
  }
  const delta = current - previous;
  return delta > 0 ? delta : 0;
}
function maxDefined(previous, current) {
  if (previous === undefined) {
    return current;
  }
  return current > previous ? current : previous;
}
function extractTokenCountAggregationKey(payload, info, model) {
  const parts = [];
  const infoStreamId = readString4(info, "stream_id");
  if (infoStreamId !== undefined) {
    parts.push(`stream:${infoStreamId}`);
  }
  const infoTurnId = readString4(info, "turn_id");
  if (infoTurnId !== undefined) {
    parts.push(`info_turn:${infoTurnId}`);
  }
  const payloadTurnId = readString4(payload, "turn_id");
  if (payloadTurnId !== undefined) {
    parts.push(`payload_turn:${payloadTurnId}`);
  }
  const responseId = readString4(info, "response_id");
  if (responseId !== undefined) {
    parts.push(`response:${responseId}`);
  }
  const messageId = readString4(info, "message_id");
  if (messageId !== undefined) {
    parts.push(`message:${messageId}`);
  }
  parts.push(`model:${model}`);
  return parts.join("|");
}
function resolveTokenCountModel(payload, usage, info, modelFromInfo) {
  const explicitModel = modelFromInfo ?? readString4(usage, "model") ?? readString4(usage, "model_id") ?? readString4(payload, "model");
  if (explicitModel !== undefined) {
    return explicitModel;
  }
  const payloadRateLimitsModel = extractModelFromRateLimits(toRecord5(payload["rate_limits"]));
  if (payloadRateLimitsModel !== undefined) {
    return payloadRateLimitsModel;
  }
  const infoRateLimitsModel = extractModelFromRateLimits(toRecord5(info["rate_limits"]));
  if (infoRateLimitsModel !== undefined) {
    return infoRateLimitsModel;
  }
  return "unknown";
}
function extractModelFromRateLimits(rateLimits) {
  const limitName = readString4(rateLimits, "limit_name");
  const normalizedLimitName = normalizeRateLimitModel(limitName);
  if (normalizedLimitName !== undefined) {
    return normalizedLimitName;
  }
  const limitId = readString4(rateLimits, "limit_id");
  return normalizeRateLimitModel(limitId);
}
function normalizeRateLimitModel(modelName) {
  if (modelName === undefined) {
    return;
  }
  const normalized = modelName.trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9.-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return normalized.length > 0 ? normalized : undefined;
}
function extractSessionMetaTimestamp(payloadValue) {
  const payload = toRecord5(payloadValue);
  if (payload === null) {
    return;
  }
  const payloadTimestamp = readString4(payload, "timestamp");
  if (payloadTimestamp !== undefined) {
    return payloadTimestamp;
  }
  const meta = toRecord5(payload["meta"]);
  return readString4(meta, "timestamp");
}
function toRecord5(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value;
}
function readString4(value, key) {
  if (value === null) {
    return;
  }
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}
function readNumber2(value, key) {
  if (value === null) {
    return;
  }
  const candidate = value[key];
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    return;
  }
  return candidate;
}
function dateKeyFromTimestamp(timestamp) {
  const date = new Date(timestamp);
  const epochMs = date.getTime();
  if (Number.isNaN(epochMs)) {
    return null;
  }
  return dateKeyFromEpochMs(epochMs);
}
function dayStartEpochMs(epochMs) {
  const date = new Date(epochMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
function dateKeyFromEpochMs(epochMs) {
  return new Date(epochMs).toISOString().slice(0, 10);
}
export {
  tool,
  toNormalizedEvents,
  runAgent,
  getToolVersions,
  getCodexUsageStats,
  getCodexLoginStatus,
  getCodexCliVersion,
  createMockCodexSessionRunner,
  checkCodexModelAvailability,
  ToolRegistry,
  SessionRunner,
  RunningSession,
  MockCodexSessionRunner,
  MockCodexRunningSession,
  BasicSdkEventEmitter
};
