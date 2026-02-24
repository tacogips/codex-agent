// @bun
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
import { readFile } from "fs/promises";
import { createReadStream } from "fs";
import { createInterface } from "readline";
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
// src/rollout/watcher.ts
import { watch } from "fs";
import { open, stat } from "fs/promises";
import { join } from "path";
import { EventEmitter } from "events";
var ROLLOUT_PREFIX = "rollout-";
var ROLLOUT_EXT = ".jsonl";
var DEBOUNCE_MS = 100;

class RolloutWatcher extends EventEmitter {
  fileWatchers = new Map;
  dirWatchers = new Map;
  closed = false;
  async watchFile(path) {
    if (this.closed) {
      return;
    }
    if (this.fileWatchers.has(path)) {
      return;
    }
    const fileSize = await getFileSize(path);
    const state = {
      path,
      offset: fileSize,
      watcher: null,
      debounceTimer: null
    };
    const watcher = watch(path, () => {
      this.debouncedReadAppended(state);
    });
    watcher.on("error", (err) => {
      this.emit("error", err);
    });
    state.watcher = watcher;
    this.fileWatchers.set(path, state);
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
      if (basename.startsWith(ROLLOUT_PREFIX) && basename.endsWith(ROLLOUT_EXT)) {
        const fullPath = join(dir, filename);
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
  get isClosed() {
    return this.closed;
  }
  debouncedReadAppended(state) {
    if (state.debounceTimer !== null) {
      clearTimeout(state.debounceTimer);
    }
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      this.readAppendedLines(state);
    }, DEBOUNCE_MS);
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
    const s = await stat(path);
    return s.size;
  } catch {
    return 0;
  }
}
function sessionsWatchDir(codexHome) {
  return join(codexHome, "sessions");
}
// src/session/index.ts
import { readdir, stat as stat2 } from "fs/promises";
import { join as join3, resolve } from "path";
import { homedir } from "os";

// src/session/sqlite.ts
import { Database } from "bun:sqlite";
import { join as join2 } from "path";
var STATE_DB_FILENAME = "state";
function openCodexDb(codexHome) {
  const home = codexHome ?? resolveCodexHome();
  const dbPath = join2(home, STATE_DB_FILENAME);
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
var DEFAULT_CODEX_HOME = join3(homedir(), ".codex");
var SESSIONS_DIR = "sessions";
var ARCHIVED_DIR = "archived_sessions";
var ROLLOUT_PREFIX2 = "rollout-";
var ROLLOUT_EXT2 = ".jsonl";
function resolveCodexHome() {
  return process.env["CODEX_HOME"] ?? DEFAULT_CODEX_HOME;
}
async function* discoverRolloutPaths(codexHome) {
  const home = codexHome ?? resolveCodexHome();
  const sessionsDir = join3(home, SESSIONS_DIR);
  if (!await dirExists(sessionsDir)) {
    return;
  }
  const years = await readSortedDirs(sessionsDir, "desc");
  for (const year of years) {
    const yearPath = join3(sessionsDir, year);
    const months = await readSortedDirs(yearPath, "desc");
    for (const month of months) {
      const monthPath = join3(yearPath, month);
      const days = await readSortedDirs(monthPath, "desc");
      for (const day of days) {
        const dayPath = join3(monthPath, day);
        const files = await readSortedFiles(dayPath, "desc");
        for (const file of files) {
          if (file.startsWith(ROLLOUT_PREFIX2) && file.endsWith(ROLLOUT_EXT2)) {
            yield join3(dayPath, file);
          }
        }
      }
    }
  }
  const archivedDir = join3(home, ARCHIVED_DIR);
  if (await dirExists(archivedDir)) {
    const files = await readSortedFiles(archivedDir, "desc");
    for (const file of files) {
      if (file.startsWith(ROLLOUT_PREFIX2) && file.endsWith(ROLLOUT_EXT2)) {
        yield join3(archivedDir, file);
      }
    }
  }
}
async function buildSession(rolloutPath) {
  const meta = await parseSessionMeta(rolloutPath);
  if (meta === null) {
    return null;
  }
  const fileStat = await stat2(rolloutPath);
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
  const id = readString(metaRecord, "id");
  const timestamp = readString(metaRecord, "timestamp");
  const cwd = readString(metaRecord, "cwd");
  const source = toSessionSource(readString(metaRecord, "source"));
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
    modelProvider: readString(metaRecord, "model_provider"),
    cwd,
    cliVersion: readString(metaRecord, "cli_version") ?? "unknown",
    title: firstUserMessage ?? id,
    firstUserMessage,
    archivedAt: isArchived ? mtime : undefined,
    git: meta.git,
    forkedFromId: readString(metaRecord, "forked_from_id")
  };
}
function toRecord2(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value;
}
function readString(record, key) {
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
    const s = await stat2(path);
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
// src/process/manager.ts
import { spawn } from "child_process";
import { createInterface as createInterface2 } from "readline";
import { randomUUID } from "crypto";
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
      env: { ...process.env }
    });
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
  spawnResume(sessionId, options) {
    const args = ["resume", sessionId, ...buildCommonArgs(options)];
    return this.spawnTracked(args, options, `resume ${sessionId}`);
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
      env: { ...process.env }
    });
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
  const args = ["exec", "--json", prompt];
  if (options?.images !== undefined) {
    for (const imagePath of options.images) {
      args.push("--image", imagePath);
    }
  }
  args.push(...buildCommonArgs(options));
  return args;
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
  return args;
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
  return new Promise((resolve2) => {
    child.on("exit", (code) => {
      resolve2(code ?? 1);
    });
    child.on("error", () => {
      resolve2(1);
    });
  });
}
// src/group/repository.ts
import { readFile as readFile2, writeFile, mkdir, rename } from "fs/promises";
import { join as join4 } from "path";
import { homedir as homedir2 } from "os";
import { randomUUID as randomUUID2 } from "crypto";
var DEFAULT_CONFIG_DIR = join4(homedir2(), ".config", "codex-agent");
var GROUPS_FILE = "groups.json";
function resolveConfigDir(configDir) {
  return configDir ?? DEFAULT_CONFIG_DIR;
}
function groupFilePath(configDir) {
  return join4(resolveConfigDir(configDir), GROUPS_FILE);
}
function toGroup(data) {
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    paused: data.paused,
    sessionIds: [...data.sessionIds],
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt)
  };
}
function toData(group) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    paused: group.paused,
    sessionIds: [...group.sessionIds],
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString()
  };
}
async function loadGroups(configDir) {
  const path = groupFilePath(configDir);
  try {
    const raw = await readFile2(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { groups: [] };
  }
}
async function saveGroups(config, configDir) {
  const dir = resolveConfigDir(configDir);
  await mkdir(dir, { recursive: true });
  const path = groupFilePath(configDir);
  const tmpPath = path + ".tmp." + randomUUID2().slice(0, 8);
  const json = JSON.stringify(config, null, 2) + `
`;
  await writeFile(tmpPath, json, "utf-8");
  await rename(tmpPath, path);
}
async function addGroup(name, description, configDir) {
  const config = await loadGroups(configDir);
  const now = new Date;
  const group = {
    id: randomUUID2(),
    name,
    description,
    paused: false,
    sessionIds: [],
    createdAt: now,
    updatedAt: now
  };
  const newConfig = {
    groups: [...config.groups, toData(group)]
  };
  await saveGroups(newConfig, configDir);
  return group;
}
async function removeGroup(id, configDir) {
  const config = await loadGroups(configDir);
  const filtered = config.groups.filter((g) => g.id !== id);
  if (filtered.length === config.groups.length) {
    return false;
  }
  await saveGroups({ groups: filtered }, configDir);
  return true;
}
async function findGroup(idOrName, configDir) {
  const config = await loadGroups(configDir);
  const data = config.groups.find((g) => g.id === idOrName || g.name === idOrName);
  return data ? toGroup(data) : null;
}
async function listGroups(configDir) {
  const config = await loadGroups(configDir);
  return config.groups.map(toGroup);
}
async function addSessionToGroup(groupId, sessionId, configDir) {
  const config = await loadGroups(configDir);
  const newGroups = config.groups.map((g) => {
    if (g.id !== groupId)
      return g;
    if (g.sessionIds.includes(sessionId))
      return g;
    return {
      ...g,
      sessionIds: [...g.sessionIds, sessionId],
      updatedAt: new Date().toISOString()
    };
  });
  await saveGroups({ groups: newGroups }, configDir);
}
async function removeSessionFromGroup(groupId, sessionId, configDir) {
  const config = await loadGroups(configDir);
  const newGroups = config.groups.map((g) => {
    if (g.id !== groupId)
      return g;
    return {
      ...g,
      sessionIds: g.sessionIds.filter((s) => s !== sessionId),
      updatedAt: new Date().toISOString()
    };
  });
  await saveGroups({ groups: newGroups }, configDir);
}
async function pauseGroup(groupId, configDir) {
  const config = await loadGroups(configDir);
  let found = false;
  const groups = config.groups.map((group) => {
    if (group.id !== groupId) {
      return group;
    }
    found = true;
    return {
      ...group,
      paused: true,
      updatedAt: new Date().toISOString()
    };
  });
  if (!found) {
    return false;
  }
  await saveGroups({ groups }, configDir);
  return true;
}
async function resumeGroup(groupId, configDir) {
  const config = await loadGroups(configDir);
  let found = false;
  const groups = config.groups.map((group) => {
    if (group.id !== groupId) {
      return group;
    }
    found = true;
    return {
      ...group,
      paused: false,
      updatedAt: new Date().toISOString()
    };
  });
  if (!found) {
    return false;
  }
  await saveGroups({ groups }, configDir);
  return true;
}
// src/group/manager.ts
var DEFAULT_MAX_CONCURRENT = 3;
async function* runGroup(group, prompt, options) {
  if (group.paused === true) {
    throw new Error(`group is paused: ${group.id}`);
  }
  const maxConcurrent = options?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const pm = new ProcessManager(options?.codexBinary);
  const pending = [...group.sessionIds];
  const running = [];
  const completed = [];
  const failed = [];
  function makeEvent(type, sessionId, extra) {
    return {
      type,
      groupId: group.id,
      sessionId,
      exitCode: extra?.exitCode,
      error: extra?.error,
      running: [...running],
      completed: [...completed],
      failed: [...failed],
      pending: [...pending]
    };
  }
  const inFlight = new Map;
  while (pending.length > 0 || inFlight.size > 0) {
    while (pending.length > 0 && inFlight.size < maxConcurrent) {
      const sessionId = pending.shift();
      running.push(sessionId);
      const promise = (async () => {
        try {
          const result2 = await pm.spawnExec(prompt, {
            ...options,
            cwd: options?.cwd
          });
          return { sessionId, exitCode: result2.exitCode };
        } catch (err) {
          return { sessionId, exitCode: 1 };
        }
      })();
      inFlight.set(sessionId, promise);
      yield makeEvent("session_started", sessionId);
    }
    if (inFlight.size === 0)
      break;
    const settled = await Promise.race(Array.from(inFlight.entries()).map(async ([sid2, p]) => {
      const result2 = await p;
      return { sid: sid2, result: result2 };
    }));
    const { sid, result } = settled;
    inFlight.delete(sid);
    const runIdx = running.indexOf(sid);
    if (runIdx !== -1)
      running.splice(runIdx, 1);
    if (result.exitCode === 0) {
      completed.push(sid);
      yield makeEvent("session_completed", sid, { exitCode: 0 });
    } else {
      failed.push(sid);
      yield makeEvent("session_failed", sid, { exitCode: result.exitCode });
    }
  }
  yield makeEvent("group_completed");
}
// src/queue/repository.ts
import { readFile as readFile3, writeFile as writeFile2, mkdir as mkdir2, rename as rename2 } from "fs/promises";
import { join as join5 } from "path";
import { homedir as homedir3 } from "os";
import { randomUUID as randomUUID3 } from "crypto";
var DEFAULT_CONFIG_DIR2 = join5(homedir3(), ".config", "codex-agent");
var QUEUES_FILE = "queues.json";
function resolveConfigDir2(configDir) {
  return configDir ?? DEFAULT_CONFIG_DIR2;
}
function queueFilePath(configDir) {
  return join5(resolveConfigDir2(configDir), QUEUES_FILE);
}
function toPrompt(data) {
  return {
    id: data.id,
    prompt: data.prompt,
    images: data.images,
    status: data.status,
    mode: data.mode,
    result: data.result,
    addedAt: new Date(data.addedAt),
    startedAt: data.startedAt ? new Date(data.startedAt) : undefined,
    completedAt: data.completedAt ? new Date(data.completedAt) : undefined
  };
}
function toPromptData(prompt) {
  return {
    id: prompt.id,
    prompt: prompt.prompt,
    images: prompt.images,
    status: prompt.status,
    mode: prompt.mode,
    result: prompt.result,
    addedAt: prompt.addedAt.toISOString(),
    startedAt: prompt.startedAt?.toISOString(),
    completedAt: prompt.completedAt?.toISOString()
  };
}
function toQueue(data) {
  return {
    id: data.id,
    name: data.name,
    projectPath: data.projectPath,
    paused: data.paused ?? false,
    prompts: data.prompts.map(toPrompt),
    createdAt: new Date(data.createdAt)
  };
}
function toQueueData(queue) {
  return {
    id: queue.id,
    name: queue.name,
    projectPath: queue.projectPath,
    paused: queue.paused ?? false,
    prompts: queue.prompts.map(toPromptData),
    createdAt: queue.createdAt.toISOString()
  };
}
async function loadQueues(configDir) {
  const path = queueFilePath(configDir);
  try {
    const raw = await readFile3(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { queues: [] };
  }
}
async function saveQueues(config, configDir) {
  const dir = resolveConfigDir2(configDir);
  await mkdir2(dir, { recursive: true });
  const path = queueFilePath(configDir);
  const tmpPath = path + ".tmp." + randomUUID3().slice(0, 8);
  const json = JSON.stringify(config, null, 2) + `
`;
  await writeFile2(tmpPath, json, "utf-8");
  await rename2(tmpPath, path);
}
async function createQueue(name, projectPath, configDir) {
  const config = await loadQueues(configDir);
  const queue = {
    id: randomUUID3(),
    name,
    projectPath,
    paused: false,
    prompts: [],
    createdAt: new Date
  };
  const newConfig = {
    queues: [...config.queues, toQueueData(queue)]
  };
  await saveQueues(newConfig, configDir);
  return queue;
}
async function addPrompt(queueId, prompt, images, configDir) {
  const config = await loadQueues(configDir);
  const newPrompt = {
    id: randomUUID3(),
    prompt,
    images,
    status: "pending",
    mode: "auto",
    addedAt: new Date().toISOString()
  };
  const newQueues = config.queues.map((q) => {
    if (q.id !== queueId)
      return q;
    return { ...q, prompts: [...q.prompts, newPrompt] };
  });
  await saveQueues({ queues: newQueues }, configDir);
  return toPrompt(newPrompt);
}
async function removeQueue(id, configDir) {
  const config = await loadQueues(configDir);
  const filtered = config.queues.filter((q) => q.id !== id);
  if (filtered.length === config.queues.length) {
    return false;
  }
  await saveQueues({ queues: filtered }, configDir);
  return true;
}
async function findQueue(idOrName, configDir) {
  const config = await loadQueues(configDir);
  const data = config.queues.find((q) => q.id === idOrName || q.name === idOrName);
  return data ? toQueue(data) : null;
}
async function listQueues(configDir) {
  const config = await loadQueues(configDir);
  return config.queues.map(toQueue);
}
async function updateQueuePrompts(queueId, prompts, configDir) {
  const config = await loadQueues(configDir);
  const newQueues = config.queues.map((q) => {
    if (q.id !== queueId)
      return q;
    return { ...q, prompts: prompts.map(toPromptData) };
  });
  await saveQueues({ queues: newQueues }, configDir);
}
async function pauseQueue(queueId, configDir) {
  const config = await loadQueues(configDir);
  let found = false;
  const queues = config.queues.map((queue) => {
    if (queue.id !== queueId) {
      return queue;
    }
    found = true;
    return { ...queue, paused: true };
  });
  if (!found) {
    return false;
  }
  await saveQueues({ queues }, configDir);
  return true;
}
async function resumeQueue(queueId, configDir) {
  const config = await loadQueues(configDir);
  let found = false;
  const queues = config.queues.map((queue) => {
    if (queue.id !== queueId) {
      return queue;
    }
    found = true;
    return { ...queue, paused: false };
  });
  if (!found) {
    return false;
  }
  await saveQueues({ queues }, configDir);
  return true;
}
async function updateQueueCommand(queueId, commandId, patch, configDir) {
  const config = await loadQueues(configDir);
  let found = false;
  const queues = config.queues.map((queue) => {
    if (queue.id !== queueId) {
      return queue;
    }
    const prompts = queue.prompts.map((prompt) => {
      if (prompt.id !== commandId) {
        return prompt;
      }
      found = true;
      return {
        ...prompt,
        prompt: patch.prompt ?? prompt.prompt,
        status: patch.status ?? prompt.status
      };
    });
    return { ...queue, prompts };
  });
  if (!found) {
    return false;
  }
  await saveQueues({ queues }, configDir);
  return true;
}
async function removeQueueCommand(queueId, commandId, configDir) {
  const config = await loadQueues(configDir);
  let found = false;
  const queues = config.queues.map((queue) => {
    if (queue.id !== queueId) {
      return queue;
    }
    const before = queue.prompts.length;
    const prompts = queue.prompts.filter((prompt) => prompt.id !== commandId);
    if (prompts.length !== before) {
      found = true;
    }
    return { ...queue, prompts };
  });
  if (!found) {
    return false;
  }
  await saveQueues({ queues }, configDir);
  return true;
}
async function moveQueueCommand(queueId, from, to, configDir) {
  const config = await loadQueues(configDir);
  let found = false;
  const queues = config.queues.map((queue) => {
    if (queue.id !== queueId) {
      return queue;
    }
    if (from < 0 || to < 0 || from >= queue.prompts.length || to >= queue.prompts.length) {
      return queue;
    }
    const prompts = [...queue.prompts];
    const [item] = prompts.splice(from, 1);
    if (item === undefined) {
      return queue;
    }
    prompts.splice(to, 0, item);
    found = true;
    return { ...queue, prompts };
  });
  if (!found) {
    return false;
  }
  await saveQueues({ queues }, configDir);
  return true;
}
async function toggleQueueCommandMode(queueId, commandId, mode, configDir) {
  const config = await loadQueues(configDir);
  let found = false;
  const queues = config.queues.map((queue) => {
    if (queue.id !== queueId) {
      return queue;
    }
    const prompts = queue.prompts.map((prompt) => {
      if (prompt.id !== commandId) {
        return prompt;
      }
      found = true;
      return { ...prompt, mode };
    });
    return { ...queue, prompts };
  });
  if (!found) {
    return false;
  }
  await saveQueues({ queues }, configDir);
  return true;
}
// src/queue/runner.ts
function toQueuePrompt(m) {
  return {
    id: m.id,
    prompt: m.prompt,
    images: m.images,
    status: m.status,
    result: m.result,
    addedAt: m.addedAt,
    startedAt: m.startedAt,
    completedAt: m.completedAt
  };
}
async function* runQueue(queue, options, stopSignal) {
  if (queue.paused === true) {
    yield {
      type: "queue_stopped",
      queueId: queue.id,
      completed: [],
      pending: queue.prompts.filter((p) => p.status === "pending").map((p) => p.id),
      failed: []
    };
    return;
  }
  const pm = new ProcessManager(options?.codexBinary);
  const prompts = queue.prompts.map((p) => ({
    id: p.id,
    prompt: p.prompt,
    images: p.images,
    status: p.status,
    result: p.result,
    addedAt: p.addedAt,
    startedAt: p.startedAt,
    completedAt: p.completedAt
  }));
  const configDir = options?.configDir;
  const completedIds = [];
  const failedIds = [];
  const pendingIds = prompts.filter((p) => p.status === "pending").map((p) => p.id);
  function makeEvent(type, promptId, exitCode) {
    const currentPrompt = prompts.find((p) => p.status === "running");
    return {
      type,
      queueId: queue.id,
      promptId,
      exitCode,
      current: currentPrompt?.id,
      completed: [...completedIds],
      pending: [...pendingIds],
      failed: [...failedIds]
    };
  }
  for (const mp of prompts) {
    if (mp.status !== "pending")
      continue;
    if (stopSignal?.stopped) {
      yield makeEvent("queue_stopped");
      return;
    }
    mp.status = "running";
    mp.startedAt = new Date;
    const pidx = pendingIds.indexOf(mp.id);
    if (pidx !== -1)
      pendingIds.splice(pidx, 1);
    yield makeEvent("prompt_started", mp.id);
    try {
      const result = await pm.spawnExec(mp.prompt, {
        ...options,
        cwd: queue.projectPath,
        images: mergeImages(mp.images, options?.images)
      });
      mp.completedAt = new Date;
      if (result.exitCode === 0) {
        mp.status = "completed";
        mp.result = { exitCode: 0 };
        completedIds.push(mp.id);
        yield makeEvent("prompt_completed", mp.id, 0);
      } else {
        mp.status = "failed";
        mp.result = { exitCode: result.exitCode };
        failedIds.push(mp.id);
        yield makeEvent("prompt_failed", mp.id, result.exitCode);
      }
    } catch {
      mp.status = "failed";
      mp.result = { exitCode: 1 };
      mp.completedAt = new Date;
      failedIds.push(mp.id);
      yield makeEvent("prompt_failed", mp.id, 1);
    }
    await updateQueuePrompts(queue.id, prompts.map(toQueuePrompt), configDir);
  }
  yield makeEvent("queue_completed");
}
function mergeImages(promptImages, runImages) {
  if (promptImages === undefined && runImages === undefined) {
    return;
  }
  const merged = new Set;
  for (const image of promptImages ?? []) {
    merged.add(image);
  }
  for (const image of runImages ?? []) {
    merged.add(image);
  }
  return [...merged];
}
// src/bookmark/types.ts
var BOOKMARK_TYPES = ["session", "message", "range"];
function isBookmarkType(value) {
  return value === "session" || value === "message" || value === "range";
}
function normalizeTags(tags) {
  if (tags === undefined) {
    return [];
  }
  const deduped = new Set;
  for (const raw of tags) {
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      deduped.add(trimmed);
    }
  }
  return Array.from(deduped);
}
function validateCreateBookmarkInput(input) {
  const errors = [];
  if (input.sessionId.trim().length === 0) {
    errors.push("sessionId is required");
  }
  if (input.name.trim().length === 0) {
    errors.push("name is required");
  }
  switch (input.type) {
    case "session":
      if (input.messageId !== undefined) {
        errors.push("messageId is not allowed for session bookmarks");
      }
      if (input.fromMessageId !== undefined || input.toMessageId !== undefined) {
        errors.push("range fields are not allowed for session bookmarks");
      }
      break;
    case "message":
      if (input.messageId === undefined || input.messageId.trim().length === 0) {
        errors.push("messageId is required for message bookmarks");
      }
      if (input.fromMessageId !== undefined || input.toMessageId !== undefined) {
        errors.push("range fields are not allowed for message bookmarks");
      }
      break;
    case "range":
      if (input.fromMessageId === undefined || input.fromMessageId.trim().length === 0) {
        errors.push("fromMessageId is required for range bookmarks");
      }
      if (input.toMessageId === undefined || input.toMessageId.trim().length === 0) {
        errors.push("toMessageId is required for range bookmarks");
      }
      if (input.messageId !== undefined) {
        errors.push("messageId is not allowed for range bookmarks");
      }
      break;
  }
  return errors;
}
// src/bookmark/repository.ts
import { readFile as readFile4, writeFile as writeFile3, mkdir as mkdir3, rename as rename3 } from "fs/promises";
import { join as join6 } from "path";
import { homedir as homedir4 } from "os";
import { randomUUID as randomUUID4 } from "crypto";
var DEFAULT_CONFIG_DIR3 = join6(homedir4(), ".config", "codex-agent");
var BOOKMARKS_FILE = "bookmarks.json";
function resolveConfigDir3(configDir) {
  return configDir ?? DEFAULT_CONFIG_DIR3;
}
function bookmarkFilePath(configDir) {
  return join6(resolveConfigDir3(configDir), BOOKMARKS_FILE);
}
function toBookmark(data) {
  return {
    id: data.id,
    type: data.type,
    sessionId: data.sessionId,
    messageId: data.messageId,
    fromMessageId: data.fromMessageId,
    toMessageId: data.toMessageId,
    name: data.name,
    description: data.description,
    tags: [...data.tags],
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt)
  };
}
function toData2(bookmark) {
  return {
    id: bookmark.id,
    type: bookmark.type,
    sessionId: bookmark.sessionId,
    messageId: bookmark.messageId,
    fromMessageId: bookmark.fromMessageId,
    toMessageId: bookmark.toMessageId,
    name: bookmark.name,
    description: bookmark.description,
    tags: [...bookmark.tags],
    createdAt: bookmark.createdAt.toISOString(),
    updatedAt: bookmark.updatedAt.toISOString()
  };
}
async function loadBookmarks(configDir) {
  const path = bookmarkFilePath(configDir);
  try {
    const raw = await readFile4(path, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed.bookmarks.map(toBookmark);
  } catch {
    return [];
  }
}
async function saveBookmarks(bookmarks, configDir) {
  const dir = resolveConfigDir3(configDir);
  await mkdir3(dir, { recursive: true });
  const path = bookmarkFilePath(configDir);
  const tmpPath = path + ".tmp." + randomUUID4().slice(0, 8);
  const config = {
    bookmarks: bookmarks.map(toData2)
  };
  const json = JSON.stringify(config, null, 2) + `
`;
  await writeFile3(tmpPath, json, "utf-8");
  await rename3(tmpPath, path);
}
// src/bookmark/manager.ts
import { randomUUID as randomUUID5 } from "crypto";
function applyFilter(bookmarks, filter) {
  if (filter === undefined) {
    return bookmarks;
  }
  return bookmarks.filter((bookmark) => {
    if (filter.sessionId !== undefined && bookmark.sessionId !== filter.sessionId) {
      return false;
    }
    if (filter.type !== undefined && bookmark.type !== filter.type) {
      return false;
    }
    if (filter.tag !== undefined && !bookmark.tags.includes(filter.tag)) {
      return false;
    }
    return true;
  });
}
function scoreBookmark(bookmark, normalizedQuery) {
  if (normalizedQuery.length === 0) {
    return 0;
  }
  let score = 0;
  const q = normalizedQuery;
  const name = bookmark.name.toLowerCase();
  const description = bookmark.description?.toLowerCase() ?? "";
  if (name.includes(q))
    score += 5;
  if (description.includes(q))
    score += 3;
  if (bookmark.sessionId.toLowerCase().includes(q))
    score += 2;
  if (bookmark.messageId?.toLowerCase().includes(q) === true || bookmark.fromMessageId?.toLowerCase().includes(q) === true || bookmark.toMessageId?.toLowerCase().includes(q) === true) {
    score += 2;
  }
  const tagMatches = bookmark.tags.reduce((acc, tag) => {
    if (tag.toLowerCase().includes(q))
      return acc + 1;
    return acc;
  }, 0);
  score += tagMatches;
  return score;
}
async function addBookmark(input, configDir) {
  const errors = validateCreateBookmarkInput(input);
  if (errors.length > 0) {
    throw new Error(`Invalid bookmark input: ${errors.join("; ")}`);
  }
  const now = new Date;
  const bookmark = {
    id: randomUUID5(),
    type: input.type,
    sessionId: input.sessionId.trim(),
    messageId: input.messageId?.trim(),
    fromMessageId: input.fromMessageId?.trim(),
    toMessageId: input.toMessageId?.trim(),
    name: input.name.trim(),
    description: input.description?.trim(),
    tags: normalizeTags(input.tags),
    createdAt: now,
    updatedAt: now
  };
  const existing = await loadBookmarks(configDir);
  await saveBookmarks([...existing, bookmark], configDir);
  return bookmark;
}
async function listBookmarks(filter, configDir) {
  const all = await loadBookmarks(configDir);
  const filtered = applyFilter(all, filter);
  return [...filtered].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
}
async function getBookmark(id, configDir) {
  const all = await loadBookmarks(configDir);
  const found = all.find((bookmark) => bookmark.id === id);
  return found ?? null;
}
async function deleteBookmark(id, configDir) {
  const all = await loadBookmarks(configDir);
  const filtered = all.filter((bookmark) => bookmark.id !== id);
  if (filtered.length === all.length) {
    return false;
  }
  await saveBookmarks(filtered, configDir);
  return true;
}
async function searchBookmarks(query, options, configDir) {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return [];
  }
  const all = await loadBookmarks(configDir);
  const scored = all.map((bookmark) => ({
    bookmark,
    score: scoreBookmark(bookmark, normalizedQuery)
  })).filter((result) => result.score > 0).sort((a, b) => {
    if (a.score !== b.score)
      return b.score - a.score;
    return b.bookmark.updatedAt.getTime() - a.bookmark.updatedAt.getTime();
  });
  const limit = options?.limit;
  if (limit === undefined || limit <= 0) {
    return scored;
  }
  return scored.slice(0, limit);
}
// src/auth/types.ts
var PERMISSIONS = [
  "session:create",
  "session:read",
  "session:cancel",
  "group:*",
  "queue:*",
  "bookmark:*"
];
function isPermission(value) {
  return value === "session:create" || value === "session:read" || value === "session:cancel" || value === "group:*" || value === "queue:*" || value === "bookmark:*";
}
function normalizePermissions(values) {
  const unique = new Set;
  for (const value of values) {
    const trimmed = value.trim();
    if (isPermission(trimmed)) {
      unique.add(trimmed);
    }
  }
  return Array.from(unique);
}
function hasPermission(granted, required) {
  if (granted.includes(required)) {
    return true;
  }
  if (required.startsWith("group:") && granted.includes("group:*")) {
    return true;
  }
  if (required.startsWith("queue:") && granted.includes("queue:*")) {
    return true;
  }
  if (required.startsWith("bookmark:") && granted.includes("bookmark:*")) {
    return true;
  }
  return false;
}
// src/auth/token-manager.ts
import { createHash, randomBytes, randomUUID as randomUUID6, timingSafeEqual } from "crypto";
import { homedir as homedir5 } from "os";
import { join as join7 } from "path";
import { mkdir as mkdir4, readFile as readFile5, rename as rename4, writeFile as writeFile4 } from "fs/promises";
var DEFAULT_CONFIG_DIR4 = join7(homedir5(), ".config", "codex-agent");
var TOKENS_FILE = "tokens.json";
function resolveConfigDir4(configDir) {
  return configDir ?? DEFAULT_CONFIG_DIR4;
}
function tokenFilePath(configDir) {
  return join7(resolveConfigDir4(configDir), TOKENS_FILE);
}
function hashSecret(secret) {
  return createHash("sha256").update(secret).digest("hex");
}
function parseStoredToken(rawToken) {
  const parts = rawToken.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [id, secret] = parts;
  if (id === undefined || secret === undefined || id.length === 0 || secret.length === 0) {
    return null;
  }
  return { id, secret };
}
function toMetadata(record) {
  return {
    id: record.id,
    name: record.name,
    permissions: [...record.permissions],
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt
  };
}
function isExpired(expiresAt) {
  if (expiresAt === undefined) {
    return false;
  }
  const time = new Date(expiresAt).getTime();
  if (!Number.isFinite(time)) {
    return false;
  }
  return time <= Date.now();
}
async function loadTokenConfig(configDir) {
  const path = tokenFilePath(configDir);
  try {
    const raw = await readFile5(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { tokens: [] };
  }
}
async function saveTokenConfig(config, configDir) {
  const dir = resolveConfigDir4(configDir);
  await mkdir4(dir, { recursive: true });
  const path = tokenFilePath(configDir);
  const tmpPath = path + ".tmp." + randomUUID6().slice(0, 8);
  const json = JSON.stringify(config, null, 2) + `
`;
  await writeFile4(tmpPath, json, "utf-8");
  await rename4(tmpPath, path);
}
async function createToken(input, configDir) {
  if (input.name.trim().length === 0) {
    throw new Error("name is required");
  }
  if (input.permissions.length === 0) {
    throw new Error("at least one permission is required");
  }
  const id = randomUUID6();
  const secret = randomBytes(24).toString("hex");
  const token = `${id}.${secret}`;
  const now = new Date().toISOString();
  const record = {
    id,
    name: input.name.trim(),
    permissions: [...input.permissions],
    createdAt: now,
    expiresAt: input.expiresAt,
    tokenHash: hashSecret(secret)
  };
  const config = await loadTokenConfig(configDir);
  await saveTokenConfig({ tokens: [...config.tokens, record] }, configDir);
  return token;
}
async function listTokens(configDir) {
  const config = await loadTokenConfig(configDir);
  return config.tokens.map(toMetadata).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function revokeToken(id, configDir) {
  const config = await loadTokenConfig(configDir);
  let found = false;
  const now = new Date().toISOString();
  const updated = config.tokens.map((token) => {
    if (token.id !== id) {
      return token;
    }
    found = true;
    if (token.revokedAt !== undefined) {
      return token;
    }
    return {
      ...token,
      revokedAt: now
    };
  });
  if (!found) {
    return false;
  }
  await saveTokenConfig({ tokens: updated }, configDir);
  return true;
}
async function rotateToken(id, configDir) {
  const config = await loadTokenConfig(configDir);
  const idx = config.tokens.findIndex((token) => token.id === id);
  if (idx === -1) {
    throw new Error(`token not found: ${id}`);
  }
  const secret = randomBytes(24).toString("hex");
  const replacement = {
    ...config.tokens[idx],
    tokenHash: hashSecret(secret),
    revokedAt: undefined
  };
  const tokens = [...config.tokens];
  tokens[idx] = replacement;
  await saveTokenConfig({ tokens }, configDir);
  return `${id}.${secret}`;
}
async function verifyToken(rawToken, configDir) {
  const parsed = parseStoredToken(rawToken);
  if (parsed === null) {
    return { ok: false };
  }
  const config = await loadTokenConfig(configDir);
  const record = config.tokens.find((token) => token.id === parsed.id);
  if (record === undefined) {
    return { ok: false };
  }
  if (record.revokedAt !== undefined || isExpired(record.expiresAt)) {
    return { ok: false };
  }
  const encoder = new TextEncoder;
  const actual = encoder.encode(hashSecret(parsed.secret));
  const expected = encoder.encode(record.tokenHash);
  if (actual.length !== expected.length) {
    return { ok: false };
  }
  if (!timingSafeEqual(actual, expected)) {
    return { ok: false };
  }
  return { ok: true, metadata: toMetadata(record) };
}
function parsePermissionList(input) {
  return input.split(",").map((value) => value.trim()).filter((value) => value === "session:create" || value === "session:read" || value === "session:cancel" || value === "group:*" || value === "queue:*" || value === "bookmark:*");
}
// src/file-changes/extractor.ts
var OP_HINTS = [
  { prefix: "rm ", op: "deleted" },
  { prefix: "mv ", op: "modified" },
  { prefix: "cp ", op: "modified" },
  { prefix: "touch ", op: "created" },
  { prefix: "cat >", op: "created" },
  { prefix: "echo >", op: "created" },
  { prefix: "tee ", op: "modified" },
  { prefix: "sed -i", op: "modified" },
  { prefix: "apply_patch", op: "modified" },
  { prefix: "git add ", op: "modified" },
  { prefix: "git rm ", op: "deleted" },
  { prefix: "git mv ", op: "modified" }
];
var FILE_RE = /(^|\/)[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+$/;
function inferOperation(command) {
  const normalized = command.trim().toLowerCase();
  for (const hint of OP_HINTS) {
    if (normalized.startsWith(hint.prefix)) {
      return hint.op;
    }
  }
  return "modified";
}
function extractFileTokens(command) {
  const tokens = command.split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 0);
  return tokens.filter((token) => {
    if (token.startsWith("-"))
      return false;
    if (token.includes("*"))
      return false;
    if (token.startsWith("'") || token.startsWith('"'))
      return false;
    return FILE_RE.test(token);
  });
}
function extractCommandsFromLine(line) {
  if (isEventMsg(line)) {
    if (line.payload.type === "ExecCommandBegin" || line.payload.type === "ExecCommandEnd") {
      const command = line.payload.command;
      if (Array.isArray(command) && command.every((item) => typeof item === "string")) {
        return [command.join(" ")];
      }
      return [];
    }
    return [];
  }
  if (isResponseItem(line) && line.payload.type === "local_shell_call") {
    const action = line.payload.action;
    const command = action["command"];
    if (Array.isArray(command) && command.every((item) => typeof item === "string")) {
      return [command.join(" ")];
    }
  }
  return [];
}
function extractChangedFiles(lines) {
  const map = new Map;
  for (const line of lines) {
    const commands = extractCommandsFromLine(line);
    for (const command of commands) {
      const operation = inferOperation(command);
      const files = extractFileTokens(command);
      for (const file of files) {
        const prev = map.get(file);
        if (prev === undefined) {
          map.set(file, {
            path: file,
            operation,
            changeCount: 1,
            lastModified: line.timestamp
          });
        } else {
          map.set(file, {
            ...prev,
            operation: prev.operation === "created" && operation === "deleted" ? "deleted" : operation,
            changeCount: prev.changeCount + 1,
            lastModified: line.timestamp
          });
        }
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => a.path.localeCompare(b.path));
}
// src/file-changes/service.ts
import { homedir as homedir6 } from "os";
import { join as join8 } from "path";
import { mkdir as mkdir5, readFile as readFile6, rename as rename5, writeFile as writeFile5 } from "fs/promises";
import { randomUUID as randomUUID7 } from "crypto";
var DEFAULT_CONFIG_DIR5 = join8(homedir6(), ".config", "codex-agent");
var FILE_INDEX_FILE = "file-changes-index.json";
function resolveConfigDir5(configDir) {
  return configDir ?? DEFAULT_CONFIG_DIR5;
}
function fileIndexPath(configDir) {
  return join8(resolveConfigDir5(configDir), FILE_INDEX_FILE);
}
async function loadIndex(configDir) {
  const path = fileIndexPath(configDir);
  try {
    const raw = await readFile6(path, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {
      sessions: [],
      updatedAt: new Date(0).toISOString()
    };
  }
}
async function saveIndex(index, configDir) {
  const dir = resolveConfigDir5(configDir);
  await mkdir5(dir, { recursive: true });
  const path = fileIndexPath(configDir);
  const tmpPath = path + ".tmp." + randomUUID7().slice(0, 8);
  const json = JSON.stringify(index, null, 2) + `
`;
  await writeFile5(tmpPath, json, "utf-8");
  await rename5(tmpPath, path);
}
function toSummary(sessionId, files) {
  return {
    sessionId,
    files,
    totalFiles: files.length
  };
}
async function getChangedFiles(sessionId, options) {
  const session = await findSession(sessionId, options?.codexHome);
  if (session === null) {
    throw new Error(`session not found: ${sessionId}`);
  }
  const lines = await readRollout(session.rolloutPath);
  const files = extractChangedFiles(lines);
  return toSummary(sessionId, files);
}
async function findSessionsByFile(path, options) {
  const target = path.trim();
  if (target.length === 0) {
    throw new Error("path is required");
  }
  const index = await loadIndex(options?.configDir);
  const sessions = [];
  for (const entry of index.sessions) {
    for (const changed of entry.files) {
      if (changed.path === target) {
        sessions.push({
          sessionId: entry.sessionId,
          operation: changed.operation,
          lastModified: changed.lastModified
        });
      }
    }
  }
  sessions.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  return { path: target, sessions };
}
async function rebuildFileIndex(configDir, codexHome) {
  const sessions = await listSessions({
    limit: Number.MAX_SAFE_INTEGER,
    ...codexHome !== undefined ? { codexHome } : {}
  });
  const entries = [];
  let indexedFiles = 0;
  for (const session of sessions.sessions) {
    const lines = await readRollout(session.rolloutPath);
    const files = extractChangedFiles(lines);
    indexedFiles += files.length;
    entries.push({
      sessionId: session.id,
      files,
      indexedAt: new Date().toISOString()
    });
  }
  const updatedAt = new Date().toISOString();
  await saveIndex({
    sessions: entries,
    updatedAt
  }, configDir);
  return {
    indexedSessions: entries.length,
    indexedFiles,
    updatedAt
  };
}
// src/activity/manager.ts
function deriveStatus(line, current) {
  if (isEventMsg(line)) {
    const event = line.payload;
    switch (event.type) {
      case "TurnStarted":
      case "ExecCommandBegin":
        return "running";
      case "TurnComplete":
      case "ExecCommandEnd":
        return "idle";
      case "TurnAborted":
      case "Error":
        return "failed";
      default:
        return current;
    }
  }
  if (isResponseItem(line) && line.payload.type === "local_shell_call") {
    const rawStatus = line.payload.status;
    if (typeof rawStatus !== "string") {
      return current;
    }
    const status = rawStatus.toLowerCase();
    if (status.includes("approval") || status.includes("consent")) {
      return "waiting_approval";
    }
    if (status === "in_progress" || status === "running") {
      return "running";
    }
  }
  return current;
}
function deriveActivityEntry(sessionId, lines) {
  let status = "idle";
  let updatedAt = new Date(0).toISOString();
  for (const line of lines) {
    const next = deriveStatus(line, status);
    if (next !== status) {
      status = next;
      updatedAt = line.timestamp;
    }
  }
  return {
    sessionId,
    status,
    updatedAt
  };
}
async function getSessionActivity(sessionId, codexHome) {
  const session = await findSession(sessionId, codexHome);
  if (session === null) {
    return null;
  }
  const lines = await readRollout(session.rolloutPath);
  return deriveActivityEntry(session.id, lines);
}
// src/markdown/parser.ts
var HEADING_RE = /^(#{1,6})\s+(.+)$/;
var TASK_RE = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/;
function parseMarkdown(content) {
  const lines = content.split(/\r?\n/);
  const sections = [];
  let currentHeading = "";
  let currentContent = [];
  const flush = () => {
    if (currentContent.length === 0 && currentHeading.length === 0) {
      return;
    }
    sections.push({
      heading: currentHeading,
      content: currentContent.join(`
`).trim()
    });
  };
  for (const line of lines) {
    const match = HEADING_RE.exec(line);
    if (match !== null) {
      flush();
      currentHeading = match[2]?.trim() ?? "";
      currentContent = [];
      continue;
    }
    currentContent.push(line);
  }
  flush();
  if (sections.length === 0) {
    return { sections: [{ heading: "", content: content.trim() }] };
  }
  return { sections };
}
function extractMarkdownTasks(content) {
  const parsed = parseMarkdown(content);
  const tasks = [];
  for (const section of parsed.sections) {
    const lines = section.content.split(/\r?\n/);
    for (const line of lines) {
      const match = TASK_RE.exec(line);
      if (match === null) {
        continue;
      }
      tasks.push({
        sectionHeading: section.heading,
        checked: match[1]?.toLowerCase() === "x",
        text: match[2]?.trim() ?? ""
      });
    }
  }
  return tasks;
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
import { EventEmitter as EventEmitter2 } from "events";
class RunningSession extends EventEmitter2 {
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
        sandbox: config.sandbox,
        approvalMode: config.approvalMode,
        fullAuto: config.fullAuto,
        images: config.images,
        streamGranularity: config.streamGranularity
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
    const sessionInfo = await findSession(sessionId, this.options.codexHome);
    if (sessionInfo === null) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const startedAt = new Date;
    const proc = this.pm.spawnResume(sessionId, {
      ...options,
      codexBinary: this.options.codexBinary
    });
    const running = new RunningSession(sessionId, this.pm, proc.id, startedAt, options?.streamGranularity ?? "event", false);
    this.trackSession(running);
    const watcher = new RolloutWatcher;
    watcher.on("line", (_path, line) => {
      running.pushLine(line);
    });
    const includeExisting = this.options.includeExistingOnResume === true;
    if (includeExisting) {
      const existing = await readRollout(sessionInfo.rolloutPath);
      for (const line of existing) {
        running.pushLine(line);
      }
    }
    await watcher.watchFile(sessionInfo.rolloutPath);
    running.setStopHook(() => watcher.stop());
    if (prompt !== undefined && prompt.trim().length > 0) {
      this.pm.writeInput(proc.id, prompt + `
`);
    }
    waitForExit2(this.pm, proc.id).then((exitCode) => {
      watcher.stop();
      running.finish(exitCode);
    });
    return running;
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
      model: config.model,
      sandbox: config.sandbox,
      approvalMode: config.approvalMode,
      fullAuto: config.fullAuto,
      images: config.images,
      streamGranularity: config.streamGranularity
    };
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
async function waitForExit2(pm, processId) {
  while (true) {
    const process2 = pm.get(processId);
    if (process2 === null) {
      return 1;
    }
    if (process2.status !== "running") {
      return process2.exitCode ?? 1;
    }
    await sleep(50);
  }
}
function sleep(ms) {
  return new Promise((resolve2) => {
    setTimeout(resolve2, ms);
  });
}
// src/sdk/agent-runner.ts
import { mkdtemp, rm, writeFile as writeFile6 } from "fs/promises";
import { tmpdir } from "os";
import { extname, join as join9 } from "path";
import { randomUUID as randomUUID8 } from "crypto";
async function* runAgent(request, options) {
  const runner = new SessionRunner(options);
  const normalized = await normalizeAttachments(request.attachments);
  let currentSessionId = isResumeRequest(request) ? request.sessionId : undefined;
  try {
    const session = await startFromRequest(runner, request, normalized.imagePaths);
    currentSessionId = session.sessionId;
    yield {
      type: "session.started",
      sessionId: session.sessionId,
      resumed: isResumeRequest(request)
    };
    for await (const chunk of session.messages()) {
      const resolvedSessionId = resolveSessionId(session.sessionId, chunk);
      currentSessionId = resolvedSessionId;
      yield {
        type: "session.message",
        sessionId: resolvedSessionId,
        chunk
      };
    }
    const result = await session.waitForCompletion();
    yield {
      type: "session.completed",
      sessionId: session.sessionId,
      result
    };
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
async function startFromRequest(runner, request, imagePaths) {
  if (isResumeRequest(request)) {
    const session = await runner.resumeSession(request.sessionId, request.prompt, {
      cwd: request.cwd,
      model: request.model,
      sandbox: request.sandbox,
      approvalMode: request.approvalMode,
      fullAuto: request.fullAuto,
      images: imagePaths,
      streamGranularity: request.streamGranularity
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
    images: imagePaths,
    streamGranularity: request.streamGranularity
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
    const tempDir = await mkdtemp(join9(tmpdir(), "codex-agent-attachment-"));
    tempDirs.push(tempDir);
    const parsed = parseBase64Input(attachment.data);
    const mediaType = attachment.mediaType ?? parsed.mediaType;
    const ext = extensionForMediaType(mediaType);
    const fileName = sanitizeFileName(attachment.filename, ext);
    const filePath = join9(tempDir, fileName);
    const body = parsed.body;
    const content = Uint8Array.from(Buffer.from(body, "base64"));
    await writeFile6(filePath, content);
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
    return `${randomUUID8()}${defaultExt}`;
  }
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  if (safe.length === 0) {
    return `${randomUUID8()}${defaultExt}`;
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
// src/server/router.ts
class Router {
  routes = [];
  add(method, pattern, handler) {
    const segments = pattern.split("/").filter((s) => s !== "");
    this.routes.push({ method: method.toUpperCase(), segments, handler });
  }
  match(method, path) {
    const pathSegments = path.split("/").filter((s) => s !== "");
    const upper = method.toUpperCase();
    for (const route of this.routes) {
      if (route.method !== upper)
        continue;
      if (route.segments.length !== pathSegments.length)
        continue;
      const params = {};
      let matched = true;
      for (let i = 0;i < route.segments.length; i++) {
        const seg = route.segments[i];
        const val = pathSegments[i];
        if (seg.startsWith(":")) {
          params[seg.slice(1)] = val;
        } else if (seg !== val) {
          matched = false;
          break;
        }
      }
      if (matched) {
        return { handler: route.handler, params };
      }
    }
    return null;
  }
}

// src/server/auth.ts
var FULL_PERMISSIONS = [
  "session:create",
  "session:read",
  "session:cancel",
  "group:*",
  "queue:*",
  "bookmark:*"
];
function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" }
  });
}
function forbiddenResponse(permission) {
  return new Response(JSON.stringify({ error: `Forbidden: missing permission ${permission}` }), {
    status: 403,
    headers: { "Content-Type": "application/json" }
  });
}
function parseBearerToken(req) {
  const header = req.headers.get("Authorization");
  if (header === null || !header.startsWith("Bearer ")) {
    return null;
  }
  const value = header.slice("Bearer ".length).trim();
  return value.length === 0 ? null : value;
}
async function authenticateRequest(req, config) {
  const bearer = parseBearerToken(req);
  if (config.token !== undefined) {
    if (bearer === null || bearer !== config.token) {
      return { context: null, error: unauthorizedResponse() };
    }
    return {
      context: { source: "static", permissions: FULL_PERMISSIONS },
      error: null
    };
  }
  if (bearer === null) {
    return { context: null, error: null };
  }
  const result = await verifyToken(bearer, config.configDir);
  if (!result.ok || result.metadata === undefined) {
    return { context: null, error: unauthorizedResponse() };
  }
  return {
    context: {
      source: "managed",
      tokenId: result.metadata.id,
      permissions: result.metadata.permissions
    },
    error: null
  };
}
function ensurePermission(context, required) {
  if (required === undefined) {
    return null;
  }
  if (context === null) {
    return null;
  }
  if (!hasPermission(context.permissions, required)) {
    return forbiddenResponse(required);
  }
  return null;
}

// src/server/websocket.ts
function isClientMessage(data) {
  if (typeof data !== "object" || data === null)
    return false;
  const msg = data;
  if (msg["type"] === "subscribe_session") {
    return typeof msg["sessionId"] === "string";
  }
  if (msg["type"] === "unsubscribe_session") {
    return typeof msg["sessionId"] === "string";
  }
  if (msg["type"] === "subscribe_new_sessions") {
    return true;
  }
  return false;
}

class WebSocketManager {
  watcher = new RolloutWatcher;
  clients = new Set;
  sessionPaths = new Map;
  directoryWatchStarted = false;
  codexHome;
  constructor(codexHome) {
    this.codexHome = codexHome ?? resolveCodexHome();
    this.watcher.on("line", (path, line) => {
      this.broadcastSessionEvent(path, line);
    });
    this.watcher.on("newSession", (path) => {
      this.broadcastNewSession(path);
    });
  }
  handleOpen(ws) {
    this.clients.add(ws);
  }
  handleMessage(ws, raw) {
    let parsed;
    try {
      parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }
    if (!isClientMessage(parsed)) {
      ws.send(JSON.stringify({ type: "error", message: "Unknown message type" }));
      return;
    }
    switch (parsed.type) {
      case "subscribe_session":
        this.subscribeSession(ws, parsed.sessionId);
        break;
      case "unsubscribe_session":
        ws.data.subscribedSessions.delete(parsed.sessionId);
        ws.send(JSON.stringify({
          type: "subscribed",
          channel: `unsubscribed:${parsed.sessionId}`
        }));
        break;
      case "subscribe_new_sessions":
        this.subscribeNewSessions(ws);
        break;
    }
  }
  handleClose(ws) {
    this.clients.delete(ws);
  }
  stop() {
    this.watcher.stop();
  }
  publishSessionEvent(sessionId, event) {
    const msg = JSON.stringify({
      type: "session_event",
      sessionId,
      event
    });
    for (const ws of this.clients) {
      if (ws.data.subscribedSessions.has(sessionId)) {
        ws.send(msg);
      }
    }
  }
  publishNewSession(path) {
    const msg = JSON.stringify({ type: "new_session", path });
    for (const ws of this.clients) {
      if (ws.data.subscribedNewSessions) {
        ws.send(msg);
      }
    }
  }
  createWsData() {
    return { subscribedSessions: new Set, subscribedNewSessions: false };
  }
  async subscribeSession(ws, sessionId) {
    ws.data.subscribedSessions.add(sessionId);
    if (!this.sessionPaths.has(sessionId)) {
      const session = await findSession(sessionId, this.codexHome);
      if (session === null) {
        ws.send(JSON.stringify({
          type: "error",
          message: `Session not found: ${sessionId}`
        }));
        return;
      }
      this.sessionPaths.set(sessionId, session.rolloutPath);
      await this.watcher.watchFile(session.rolloutPath);
    }
    ws.send(JSON.stringify({ type: "subscribed", channel: `session:${sessionId}` }));
  }
  subscribeNewSessions(ws) {
    ws.data.subscribedNewSessions = true;
    if (!this.directoryWatchStarted) {
      const dir = sessionsWatchDir(this.codexHome);
      this.watcher.watchDirectory(dir);
      this.directoryWatchStarted = true;
    }
    ws.send(JSON.stringify({ type: "subscribed", channel: "new_sessions" }));
  }
  broadcastSessionEvent(path, line) {
    let sessionId;
    for (const [id, p] of this.sessionPaths) {
      if (p === path) {
        sessionId = id;
        break;
      }
    }
    if (sessionId === undefined)
      return;
    this.publishSessionEvent(sessionId, line);
  }
  broadcastNewSession(path) {
    this.publishNewSession(path);
  }
}

// src/server/app-server-client.ts
var DEFAULT_TIMEOUT_MS = 1e4;
function randomId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function getMessageData(evt) {
  if (typeof evt !== "object" || evt === null)
    return;
  const rec = evt;
  return rec["data"];
}
function parseMessage(raw) {
  if (typeof raw !== "string")
    return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return null;
  }
}

class DefaultAppServerClient {
  config;
  wsFactory;
  ws = null;
  listeners = new Set;
  pending = new Map;
  constructor(config, wsFactory) {
    this.config = config;
    this.wsFactory = wsFactory;
  }
  async connect() {
    if (this.ws !== null)
      return;
    this.ws = this.wsFactory(this.config.url);
    await new Promise((resolve2, reject) => {
      const ws = this.ws;
      if (ws === null) {
        reject(new Error("App-server WebSocket unavailable"));
        return;
      }
      let settled = false;
      ws.addEventListener("open", () => {
        if (!settled) {
          settled = true;
          resolve2();
        }
      });
      ws.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          reject(new Error("Failed to connect to app-server"));
        }
      });
      ws.addEventListener("close", () => {
        if (!settled) {
          settled = true;
          reject(new Error("App-server connection closed during connect"));
        }
        this.rejectAllPending(new Error("App-server connection closed"));
      });
      ws.addEventListener("message", (evt) => {
        const data = getMessageData(evt);
        const msg = parseMessage(data);
        if (msg === null)
          return;
        this.handleMessage(msg);
      });
    });
  }
  async close() {
    if (this.ws === null)
      return;
    this.ws.close();
    this.ws = null;
    this.rejectAllPending(new Error("App-server client closed"));
  }
  async request(method, params) {
    if (this.ws === null) {
      throw new Error("App-server is not connected");
    }
    const id = randomId();
    const timeoutMs = this.config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    const payload = {
      id,
      method,
      ...params !== undefined ? { params } : {}
    };
    const responsePromise = new Promise((resolve2, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`App-server request timeout (${method})`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve2, reject, timer });
    });
    this.ws.send(JSON.stringify(payload));
    const raw = await responsePromise;
    return raw;
  }
  subscribe(onEvent) {
    this.listeners.add(onEvent);
    return () => {
      this.listeners.delete(onEvent);
    };
  }
  handleMessage(msg) {
    if (msg.id !== undefined) {
      const pending = this.pending.get(msg.id);
      if (pending !== undefined) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        if (msg.error !== undefined) {
          pending.reject(msg.error instanceof Error ? msg.error : new Error(String(msg.error)));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }
    if (msg.method !== undefined) {
      const evt = {
        type: msg.method,
        sessionId: getSessionId(msg.params),
        payload: msg.params
      };
      for (const listener of this.listeners) {
        listener(evt);
      }
    }
  }
  rejectAllPending(err) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(id);
    }
  }
}
function getSessionId(payload) {
  if (typeof payload !== "object" || payload === null)
    return;
  const rec = payload;
  return typeof rec["sessionId"] === "string" ? rec["sessionId"] : undefined;
}
function createAppServerClient(config, wsFactory = (url) => new WebSocket(url)) {
  return new DefaultAppServerClient(config, wsFactory);
}

// src/server/handlers/health.ts
var startedAt = new Date;
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
var handleHealth = () => {
  return json({ status: "ok" });
};
var handleStatus = async (_req, _params, config) => {
  const sessionOpts = { limit: 0 };
  if (config.codexHome !== undefined)
    sessionOpts.codexHome = config.codexHome;
  const [sessions, groups, queues] = await Promise.all([
    listSessions(sessionOpts),
    listGroups(config.configDir),
    listQueues(config.configDir)
  ]);
  return json({
    status: "ok",
    startedAt: startedAt.toISOString(),
    uptime: Math.floor((Date.now() - startedAt.getTime()) / 1000),
    sessions: sessions.total,
    groups: groups.length,
    queues: queues.length
  });
};

// src/server/sse.ts
function sseResponse(generator) {
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await generator.next();
        if (done) {
          controller.close();
          return;
        }
        const data = `data: ${JSON.stringify(value)}

`;
        controller.enqueue(new TextEncoder().encode(data));
      } catch {
        controller.close();
      }
    },
    cancel() {
      generator.return(undefined);
    }
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
}

// src/server/handlers/sessions.ts
function json2(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
function isSessionSource(s) {
  return s === "cli" || s === "vscode" || s === "exec" || s === "unknown";
}
var handleListSessions = async (req, _params, config) => {
  const url = new URL(req.url);
  const sourceParam = url.searchParams.get("source");
  const source = sourceParam !== null && isSessionSource(sourceParam) ? sourceParam : undefined;
  const cwd = url.searchParams.get("cwd") ?? undefined;
  const branch = url.searchParams.get("branch") ?? undefined;
  const limitStr = url.searchParams.get("limit");
  const limit = limitStr !== null ? parseInt(limitStr, 10) || 50 : 50;
  const offsetStr = url.searchParams.get("offset");
  const offset = offsetStr !== null ? parseInt(offsetStr, 10) || 0 : 0;
  const result = await listSessions({
    limit,
    offset,
    ...source !== undefined ? { source } : {},
    ...cwd !== undefined ? { cwd } : {},
    ...branch !== undefined ? { branch } : {},
    ...config.codexHome !== undefined ? { codexHome: config.codexHome } : {}
  });
  return json2(result);
};
var handleGetSession = async (_req, params, config) => {
  const id = params["id"];
  if (id === undefined) {
    return json2({ error: "Missing session id" }, 400);
  }
  const session = await findSession(id, config.codexHome);
  if (session === null) {
    return json2({ error: "Session not found" }, 404);
  }
  return json2(session);
};
var handleSessionEvents = async (req, params, config) => {
  const id = params["id"];
  if (id === undefined) {
    return json2({ error: "Missing session id" }, 400);
  }
  const session = await findSession(id, config.codexHome);
  if (session === null) {
    return json2({ error: "Session not found" }, 404);
  }
  const url = new URL(req.url);
  const follow = url.searchParams.get("follow") === "true";
  if (!follow) {
    const lines = await readRollout(session.rolloutPath);
    return sseResponse(arrayToGenerator(lines));
  }
  return sseResponse(watchSession(session.rolloutPath));
};
async function* arrayToGenerator(items) {
  for (const item of items) {
    yield item;
  }
}
async function* watchSession(rolloutPath) {
  const existing = await readRollout(rolloutPath);
  for (const line of existing) {
    yield line;
  }
  const watcher = new RolloutWatcher;
  const queue = [];
  let resolve2 = null;
  watcher.on("line", (_path, line) => {
    queue.push(line);
    if (resolve2 !== null) {
      resolve2();
      resolve2 = null;
    }
  });
  await watcher.watchFile(rolloutPath);
  try {
    while (!watcher.isClosed) {
      if (queue.length > 0) {
        yield queue.shift();
      } else {
        await new Promise((r) => {
          resolve2 = r;
        });
      }
    }
  } finally {
    watcher.stop();
  }
}

// src/server/handlers/groups.ts
function json3(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
async function readJsonBody(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
var handleListGroups = async (_req, _params, config) => {
  const groups = await listGroups(config.configDir);
  return json3(groups);
};
var handleCreateGroup = async (req, _params, config) => {
  const body = await readJsonBody(req);
  if (body === null || typeof body.name !== "string" || body.name === "") {
    return json3({ error: "Missing required field: name" }, 400);
  }
  const group = await addGroup(body.name, body.description, config.configDir);
  return json3(group, 201);
};
var handleGetGroup = async (_req, params, config) => {
  const id = params["id"];
  if (id === undefined) {
    return json3({ error: "Missing group id" }, 400);
  }
  const group = await findGroup(id, config.configDir);
  if (group === null) {
    return json3({ error: "Group not found" }, 404);
  }
  return json3(group);
};
var handleAddSessionToGroup = async (req, params, config) => {
  const groupId = params["id"];
  if (groupId === undefined) {
    return json3({ error: "Missing group id" }, 400);
  }
  const group = await findGroup(groupId, config.configDir);
  if (group === null) {
    return json3({ error: "Group not found" }, 404);
  }
  const body = await readJsonBody(req);
  if (body === null || typeof body.sessionId !== "string" || body.sessionId === "") {
    return json3({ error: "Missing required field: sessionId" }, 400);
  }
  await addSessionToGroup(group.id, body.sessionId, config.configDir);
  return json3({ ok: true });
};
var handleRemoveSessionFromGroup = async (_req, params, config) => {
  const groupId = params["id"];
  const sessionId = params["sid"];
  if (groupId === undefined || sessionId === undefined) {
    return json3({ error: "Missing group or session id" }, 400);
  }
  const group = await findGroup(groupId, config.configDir);
  if (group === null) {
    return json3({ error: "Group not found" }, 404);
  }
  await removeSessionFromGroup(group.id, sessionId, config.configDir);
  return json3({ ok: true });
};
var handleRunGroup = async (req, params, config) => {
  const groupId = params["id"];
  if (groupId === undefined) {
    return json3({ error: "Missing group id" }, 400);
  }
  const group = await findGroup(groupId, config.configDir);
  if (group === null) {
    return json3({ error: "Group not found" }, 404);
  }
  const body = await readJsonBody(req);
  if (body === null || typeof body.prompt !== "string" || body.prompt === "") {
    return json3({ error: "Missing required field: prompt" }, 400);
  }
  if (body.images !== undefined && (!Array.isArray(body.images) || body.images.some((v) => typeof v !== "string" || v.length === 0))) {
    return json3({ error: "Invalid field: images must be a string array" }, 400);
  }
  const generator = runGroup(group, body.prompt, {
    maxConcurrent: body.maxConcurrent,
    model: body.model,
    fullAuto: body.fullAuto,
    images: body.images
  });
  return sseResponse(generator);
};
var handlePauseGroup = async (_req, params, config) => {
  const groupId = params["id"];
  if (groupId === undefined) {
    return json3({ error: "Missing group id" }, 400);
  }
  const ok = await pauseGroup(groupId, config.configDir);
  if (!ok) {
    return json3({ error: "Group not found" }, 404);
  }
  return json3({ ok: true });
};
var handleResumeGroup = async (_req, params, config) => {
  const groupId = params["id"];
  if (groupId === undefined) {
    return json3({ error: "Missing group id" }, 400);
  }
  const ok = await resumeGroup(groupId, config.configDir);
  if (!ok) {
    return json3({ error: "Group not found" }, 404);
  }
  return json3({ ok: true });
};
var handleDeleteGroup = async (_req, params, config) => {
  const groupId = params["id"];
  if (groupId === undefined) {
    return json3({ error: "Missing group id" }, 400);
  }
  const ok = await removeGroup(groupId, config.configDir);
  if (!ok) {
    return json3({ error: "Group not found" }, 404);
  }
  return json3({ ok: true });
};

// src/server/handlers/queues.ts
function json4(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
async function readJsonBody2(req) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}
var activeQueues = new Map;
var handleListQueues = async (_req, _params, config) => {
  const queues = await listQueues(config.configDir);
  return json4(queues);
};
var handleCreateQueue = async (req, _params, config) => {
  const body = await readJsonBody2(req);
  if (body === null || typeof body.name !== "string" || body.name === "" || typeof body.projectPath !== "string" || body.projectPath === "") {
    return json4({ error: "Missing required fields: name, projectPath" }, 400);
  }
  const queue = await createQueue(body.name, body.projectPath, config.configDir);
  return json4(queue, 201);
};
var handleGetQueue = async (_req, params, config) => {
  const id = params["id"];
  if (id === undefined) {
    return json4({ error: "Missing queue id" }, 400);
  }
  const queue = await findQueue(id, config.configDir);
  if (queue === null) {
    return json4({ error: "Queue not found" }, 404);
  }
  return json4(queue);
};
var handleAddPrompt = async (req, params, config) => {
  const queueId = params["id"];
  if (queueId === undefined) {
    return json4({ error: "Missing queue id" }, 400);
  }
  const queue = await findQueue(queueId, config.configDir);
  if (queue === null) {
    return json4({ error: "Queue not found" }, 404);
  }
  const body = await readJsonBody2(req);
  if (body === null || typeof body.prompt !== "string" || body.prompt === "") {
    return json4({ error: "Missing required field: prompt" }, 400);
  }
  if (body.images !== undefined && (!Array.isArray(body.images) || body.images.some((v) => typeof v !== "string" || v.length === 0))) {
    return json4({ error: "Invalid field: images must be a string array" }, 400);
  }
  const prompt = await addPrompt(queue.id, body.prompt, body.images, config.configDir);
  return json4(prompt, 201);
};
var handleRunQueue = async (req, params, config) => {
  const queueId = params["id"];
  if (queueId === undefined) {
    return json4({ error: "Missing queue id" }, 400);
  }
  const queue = await findQueue(queueId, config.configDir);
  if (queue === null) {
    return json4({ error: "Queue not found" }, 404);
  }
  const body = await readJsonBody2(req);
  if (body?.images !== undefined && (!Array.isArray(body.images) || body.images.some((v) => typeof v !== "string" || v.length === 0))) {
    return json4({ error: "Invalid field: images must be a string array" }, 400);
  }
  const stopSignal = { stopped: false };
  activeQueues.set(queue.id, stopSignal);
  const runOpts = {};
  if (body?.model !== undefined)
    runOpts["model"] = body.model;
  if (body?.fullAuto !== undefined)
    runOpts["fullAuto"] = body.fullAuto;
  if (body?.images !== undefined)
    runOpts["images"] = body.images;
  if (config.configDir !== undefined)
    runOpts["configDir"] = config.configDir;
  const generator = runQueue(queue, runOpts, stopSignal);
  const wrapped = cleanupOnDone(generator, () => {
    activeQueues.delete(queue.id);
  });
  return sseResponse(wrapped);
};
var handleStopQueue = async (_req, params, _config) => {
  const queueId = params["id"];
  if (queueId === undefined) {
    return json4({ error: "Missing queue id" }, 400);
  }
  const signal = activeQueues.get(queueId);
  if (signal === undefined) {
    return json4({ error: "Queue is not running" }, 404);
  }
  signal.stopped = true;
  return json4({ status: "stopping" });
};
var handleDeleteQueue = async (_req, params, config) => {
  const queueId = params["id"];
  if (queueId === undefined) {
    return json4({ error: "Missing queue id" }, 400);
  }
  const ok = await removeQueue(queueId, config.configDir);
  if (!ok) {
    return json4({ error: "Queue not found" }, 404);
  }
  return json4({ ok: true });
};
var handlePauseQueue = async (_req, params, config) => {
  const queueId = params["id"];
  if (queueId === undefined) {
    return json4({ error: "Missing queue id" }, 400);
  }
  const ok = await pauseQueue(queueId, config.configDir);
  if (!ok) {
    return json4({ error: "Queue not found" }, 404);
  }
  return json4({ ok: true });
};
var handleResumeQueue = async (_req, params, config) => {
  const queueId = params["id"];
  if (queueId === undefined) {
    return json4({ error: "Missing queue id" }, 400);
  }
  const ok = await resumeQueue(queueId, config.configDir);
  if (!ok) {
    return json4({ error: "Queue not found" }, 404);
  }
  return json4({ ok: true });
};
var handleUpdateQueueCommand = async (req, params, config) => {
  const queueId = params["id"];
  const commandId = params["cid"];
  if (queueId === undefined || commandId === undefined) {
    return json4({ error: "Missing queue or command id" }, 400);
  }
  const body = await readJsonBody2(req);
  if (body === null) {
    return json4({ error: "Invalid request body" }, 400);
  }
  const ok = await updateQueueCommand(queueId, commandId, body, config.configDir);
  if (!ok) {
    return json4({ error: "Queue command not found" }, 404);
  }
  return json4({ ok: true });
};
var handleRemoveQueueCommand = async (_req, params, config) => {
  const queueId = params["id"];
  const commandId = params["cid"];
  if (queueId === undefined || commandId === undefined) {
    return json4({ error: "Missing queue or command id" }, 400);
  }
  const ok = await removeQueueCommand(queueId, commandId, config.configDir);
  if (!ok) {
    return json4({ error: "Queue command not found" }, 404);
  }
  return json4({ ok: true });
};
var handleMoveQueueCommand = async (req, params, config) => {
  const queueId = params["id"];
  if (queueId === undefined) {
    return json4({ error: "Missing queue id" }, 400);
  }
  const body = await readJsonBody2(req);
  if (body === null || typeof body.from !== "number" || typeof body.to !== "number") {
    return json4({ error: "Missing required fields: from, to" }, 400);
  }
  const ok = await moveQueueCommand(queueId, body.from, body.to, config.configDir);
  if (!ok) {
    return json4({ error: "Queue or command position not found" }, 404);
  }
  return json4({ ok: true });
};
var handleToggleQueueCommandMode = async (req, params, config) => {
  const queueId = params["id"];
  const commandId = params["cid"];
  if (queueId === undefined || commandId === undefined) {
    return json4({ error: "Missing queue or command id" }, 400);
  }
  const body = await readJsonBody2(req);
  if (body === null || body.mode !== "auto" && body.mode !== "manual") {
    return json4({ error: "Missing required field: mode(auto|manual)" }, 400);
  }
  const ok = await toggleQueueCommandMode(queueId, commandId, body.mode, config.configDir);
  if (!ok) {
    return json4({ error: "Queue command not found" }, 404);
  }
  return json4({ ok: true });
};
async function* cleanupOnDone(gen, cleanup) {
  try {
    for await (const value of gen) {
      yield value;
    }
  } finally {
    cleanup();
  }
}

// src/server/handlers/files.ts
function json5(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
var handleGetChangedFiles = async (_req, params, config) => {
  const id = params["id"];
  if (id === undefined) {
    return json5({ error: "Missing session id" }, 400);
  }
  try {
    const result = await getChangedFiles(id, {
      codexHome: config.codexHome,
      configDir: config.configDir
    });
    return json5(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("session not found")) {
      return json5({ error: "Session not found" }, 404);
    }
    return json5({ error: message }, 500);
  }
};
var handleFindSessionsByFile = async (req, _params, config) => {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (path === null || path.trim().length === 0) {
    return json5({ error: "Missing required query parameter: path" }, 400);
  }
  const result = await findSessionsByFile(path, { configDir: config.configDir });
  return json5(result);
};
var handleRebuildFileIndex = async (_req, _params, config) => {
  const stats = await rebuildFileIndex(config.configDir, config.codexHome);
  return json5(stats);
};

// src/server/server.ts
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
function requiredPermission(method, path) {
  if (path === "/health" || path === "/status" || path === "/ws") {
    return;
  }
  if (path === "/api/sessions" && method === "GET") {
    return "session:read";
  }
  if (path.startsWith("/api/sessions/") && method === "GET") {
    return "session:read";
  }
  if (path.startsWith("/api/groups")) {
    return "group:*";
  }
  if (path.startsWith("/api/queues")) {
    return "queue:*";
  }
  if (path.startsWith("/api/files")) {
    return "session:read";
  }
  if (path.startsWith("/api/bookmarks")) {
    return "bookmark:*";
  }
  return;
}
function startServer(config) {
  const router = new Router;
  const wsManager = new WebSocketManager(config.codexHome);
  const appServerClient = config.transport === "app-server" && config.appServerUrl !== undefined ? createAppServerClient({ url: config.appServerUrl }) : null;
  if (appServerClient !== null) {
    appServerClient.connect().then(() => {
      appServerClient.subscribe((event) => {
        if (event.type === "new_session") {
          const payload = typeof event.payload === "object" && event.payload !== null ? event.payload : {};
          const path = typeof payload["path"] === "string" ? payload["path"] : "";
          if (path !== "") {
            wsManager.publishNewSession(path);
          }
          return;
        }
        if (event.type === "session_event" && event.sessionId !== undefined) {
          wsManager.publishSessionEvent(event.sessionId, event.payload);
        }
      });
    }, (err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to connect app-server client: ${message}`);
    });
  }
  router.add("GET", "/health", handleHealth);
  router.add("GET", "/status", handleStatus);
  router.add("GET", "/api/sessions", handleListSessions);
  router.add("GET", "/api/sessions/:id", handleGetSession);
  router.add("GET", "/api/sessions/:id/events", handleSessionEvents);
  router.add("GET", "/api/groups", handleListGroups);
  router.add("POST", "/api/groups", handleCreateGroup);
  router.add("GET", "/api/groups/:id", handleGetGroup);
  router.add("POST", "/api/groups/:id/sessions", handleAddSessionToGroup);
  router.add("DELETE", "/api/groups/:id/sessions/:sid", handleRemoveSessionFromGroup);
  router.add("POST", "/api/groups/:id/run", handleRunGroup);
  router.add("POST", "/api/groups/:id/pause", handlePauseGroup);
  router.add("POST", "/api/groups/:id/resume", handleResumeGroup);
  router.add("DELETE", "/api/groups/:id", handleDeleteGroup);
  router.add("GET", "/api/queues", handleListQueues);
  router.add("POST", "/api/queues", handleCreateQueue);
  router.add("GET", "/api/queues/:id", handleGetQueue);
  router.add("POST", "/api/queues/:id/prompts", handleAddPrompt);
  router.add("POST", "/api/queues/:id/run", handleRunQueue);
  router.add("POST", "/api/queues/:id/stop", handleStopQueue);
  router.add("POST", "/api/queues/:id/pause", handlePauseQueue);
  router.add("POST", "/api/queues/:id/resume", handleResumeQueue);
  router.add("DELETE", "/api/queues/:id", handleDeleteQueue);
  router.add("PATCH", "/api/queues/:id/commands/:cid", handleUpdateQueueCommand);
  router.add("DELETE", "/api/queues/:id/commands/:cid", handleRemoveQueueCommand);
  router.add("POST", "/api/queues/:id/commands/move", handleMoveQueueCommand);
  router.add("POST", "/api/queues/:id/commands/:cid/mode", handleToggleQueueCommandMode);
  router.add("GET", "/api/files/find", handleFindSessionsByFile);
  router.add("GET", "/api/files/:id", handleGetChangedFiles);
  router.add("POST", "/api/files/rebuild", handleRebuildFileIndex);
  const startedAt2 = new Date;
  const server = Bun.serve({
    port: config.port,
    hostname: config.hostname,
    async fetch(req, server2) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      if (url.pathname === "/ws") {
        const upgraded = server2.upgrade(req, {
          data: wsManager.createWsData()
        });
        if (upgraded)
          return;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      const authResult = await authenticateRequest(req, config);
      if (authResult.error !== null)
        return authResult.error;
      const permErr = ensurePermission(authResult.context, requiredPermission(req.method, url.pathname));
      if (permErr !== null)
        return permErr;
      const match = router.match(req.method, url.pathname);
      if (match === null) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders()
          }
        });
      }
      try {
        const response = await match.handler(req, match.params, config);
        for (const [key, val] of Object.entries(corsHeaders())) {
          response.headers.set(key, val);
        }
        return response;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal server error";
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders()
          }
        });
      }
    },
    websocket: {
      open(ws) {
        wsManager.handleOpen(ws);
      },
      message(ws, message) {
        wsManager.handleMessage(ws, message);
      },
      close(ws) {
        wsManager.handleClose(ws);
      }
    }
  });
  return {
    port: server.port,
    hostname: server.hostname,
    startedAt: startedAt2,
    stop() {
      wsManager.stop();
      appServerClient?.close();
      server.stop();
    }
  };
}
// src/server/types.ts
var DEFAULT_PORT = 3100;
var DEFAULT_HOST = "127.0.0.1";
var DEFAULT_TRANSPORT = "local-cli";
function resolveServerConfig(overrides) {
  const env = typeof process !== "undefined" ? process.env : {};
  const port = overrides?.port ?? (env["CODEX_AGENT_PORT"] !== undefined ? parseInt(env["CODEX_AGENT_PORT"], 10) : DEFAULT_PORT);
  const hostname = overrides?.hostname ?? env["CODEX_AGENT_HOST"] ?? DEFAULT_HOST;
  const token = overrides?.token ?? env["CODEX_AGENT_TOKEN"];
  const transport = (() => {
    const raw = overrides?.transport ?? env["CODEX_AGENT_TRANSPORT"];
    if (raw === "app-server" || raw === "local-cli") {
      return raw;
    }
    return DEFAULT_TRANSPORT;
  })();
  const appServerUrl = overrides?.appServerUrl ?? env["CODEX_AGENT_APP_SERVER_URL"];
  if (transport === "app-server" && (appServerUrl === undefined || appServerUrl === "")) {
    throw new Error("app-server transport requires appServerUrl");
  }
  return {
    port: Number.isFinite(port) ? port : DEFAULT_PORT,
    hostname,
    token: token !== undefined && token !== "" ? token : undefined,
    codexHome: overrides?.codexHome,
    configDir: overrides?.configDir,
    transport,
    appServerUrl: appServerUrl !== undefined && appServerUrl !== "" ? appServerUrl : undefined
  };
}
// src/daemon/manager.ts
import { spawn as spawn2 } from "child_process";
import { readFile as readFile7, writeFile as writeFile7, rename as rename6, unlink, mkdir as mkdir6 } from "fs/promises";
import { join as join10 } from "path";
import { homedir as homedir7 } from "os";
var DEFAULT_CONFIG_DIR6 = join10(homedir7(), ".config", "codex-agent");
var PID_FILENAME = "daemon.pid";
var POLL_INTERVAL_MS = 200;
var POLL_TIMEOUT_MS = 1e4;
function pidFilePath(configDir) {
  return join10(configDir ?? DEFAULT_CONFIG_DIR6, PID_FILENAME);
}
async function readPidFile(configDir) {
  try {
    const raw = await readFile7(pidFilePath(configDir), "utf-8");
    const data = JSON.parse(raw);
    if (typeof data.pid !== "number" || typeof data.port !== "number" || typeof data.startedAt !== "string") {
      return null;
    }
    return {
      pid: data.pid,
      port: data.port,
      startedAt: data.startedAt,
      mode: data.mode ?? "http"
    };
  } catch {
    return null;
  }
}
async function writePidFile(info, configDir) {
  const dir = configDir ?? DEFAULT_CONFIG_DIR6;
  const finalPath = pidFilePath(configDir);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  await mkdir6(dir, { recursive: true });
  await writeFile7(tmpPath, JSON.stringify(info, null, 2));
  await rename6(tmpPath, finalPath);
}
async function removePidFile(configDir) {
  try {
    await unlink(pidFilePath(configDir));
  } catch {}
}
function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function pollHealth(port, timeoutMs = POLL_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`);
      if (resp.ok)
        return true;
    } catch {}
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}
async function startDaemon(config = {}) {
  const port = config.port ?? 3100;
  const host = config.host;
  const mode = config.mode ?? "http";
  const configDir = config.configDir;
  if (mode === "app-server" && (config.appServerUrl === undefined || config.appServerUrl === "")) {
    throw new Error("Daemon app-server mode requires appServerUrl");
  }
  const existing = await getDaemonStatus(configDir);
  if (existing.status === "running" && existing.info !== undefined) {
    throw new Error(`Daemon already running (pid: ${existing.info.pid}, port: ${existing.info.port}, mode: ${existing.info.mode})`);
  }
  if (existing.status === "stale") {
    await removePidFile(configDir);
  }
  const binPath = join10(import.meta.dir, "..", "bin.ts");
  const daemonArgs = ["run", binPath, "server", "start", "--port", String(port)];
  if (host !== undefined && host !== "") {
    daemonArgs.push("--host", host);
  }
  if (config.token !== undefined && config.token !== "") {
    daemonArgs.push("--token", config.token);
  }
  if (mode === "app-server") {
    daemonArgs.push("--transport", "app-server");
    if (config.appServerUrl !== undefined && config.appServerUrl !== "") {
      daemonArgs.push("--app-server-url", config.appServerUrl);
    }
  }
  const child = spawn2("bun", daemonArgs, { detached: true, stdio: "ignore" });
  child.unref();
  if (child.pid === undefined) {
    throw new Error("Failed to spawn daemon process");
  }
  const info = {
    pid: child.pid,
    port,
    startedAt: new Date().toISOString(),
    mode
  };
  await writePidFile(info, configDir);
  const ready = await pollHealth(port);
  if (!ready) {
    await removePidFile(configDir);
    throw new Error(`Daemon started but health check failed after ${POLL_TIMEOUT_MS}ms`);
  }
  return info;
}
async function stopDaemon(configDir) {
  const info = await readPidFile(configDir);
  if (info === null) {
    return false;
  }
  if (isProcessAlive(info.pid)) {
    try {
      process.kill(info.pid, "SIGTERM");
    } catch {}
  }
  await removePidFile(configDir);
  return true;
}
async function getDaemonStatus(configDir) {
  const info = await readPidFile(configDir);
  if (info === null) {
    return { status: "stopped" };
  }
  if (!isProcessAlive(info.pid)) {
    return { status: "stale", info };
  }
  return { status: "running", info };
}
// src/cli/format.ts
function formatSessionTable(sessions) {
  if (sessions.length === 0) {
    return "No sessions found.";
  }
  const rows = sessions.map((s) => ({
    id: s.id.slice(0, 8),
    source: s.source,
    cwd: truncate(s.cwd, 40),
    title: truncate(s.title, 50),
    created: formatDate(s.createdAt),
    branch: s.git?.branch ?? "-"
  }));
  const headers = {
    id: "ID",
    source: "SOURCE",
    cwd: "CWD",
    title: "TITLE",
    created: "CREATED",
    branch: "BRANCH"
  };
  const cols = Object.keys(headers);
  const widths = {};
  for (const col of cols) {
    const headerLen = headers[col].length;
    const maxRow = Math.max(...rows.map((r) => r[col].length));
    widths[col] = Math.max(headerLen, maxRow);
  }
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  return [headerLine, separator, ...dataLines].join(`
`);
}
function formatSessionDetail(session) {
  const lines = [
    `Session: ${session.id}`,
    `  Source:    ${session.source}`,
    `  CWD:      ${session.cwd}`,
    `  CLI:      ${session.cliVersion}`,
    `  Model:    ${session.modelProvider ?? "unknown"}`,
    `  Created:  ${session.createdAt.toISOString()}`,
    `  Updated:  ${session.updatedAt.toISOString()}`,
    `  Title:    ${session.title}`,
    `  Path:     ${session.rolloutPath}`
  ];
  if (session.git !== undefined) {
    lines.push(`  Branch:   ${session.git.branch ?? "-"}`);
    lines.push(`  SHA:      ${session.git.sha ?? "-"}`);
    lines.push(`  Origin:   ${session.git.origin_url ?? "-"}`);
  }
  if (session.forkedFromId !== undefined) {
    lines.push(`  Forked:   ${session.forkedFromId}`);
  }
  if (session.archivedAt !== undefined) {
    lines.push(`  Archived: ${session.archivedAt.toISOString()}`);
  }
  return lines.join(`
`);
}
function formatRolloutLine(line) {
  const ts = line.timestamp;
  const payload = line.payload;
  const eventType = payload["type"] ?? "";
  const suffix = formatProvenanceSuffix(line.provenance);
  switch (line.type) {
    case "event_msg":
      return `${formatEventMsg(ts, eventType, payload)}${suffix}`;
    case "response_item":
      return `[${ts}] response: ${eventType}${suffix}`;
    case "session_meta":
      return `[${ts}] session started${suffix}`;
    case "turn_context":
      return `[${ts}] turn context: model=${String(payload["model"] ?? "?")}${suffix}`;
    case "compacted":
      return `[${ts}] context compacted${suffix}`;
    default:
      return `[${ts}] ${line.type}${suffix}`;
  }
}
function formatSessionsJson(sessions) {
  return JSON.stringify(sessions, null, 2);
}
function formatEventMsg(ts, eventType, payload) {
  switch (eventType) {
    case "UserMessage":
      return `[${ts}] user: ${truncate(String(payload["message"] ?? ""), 80)}`;
    case "AgentMessage":
      return `[${ts}] agent: ${truncate(String(payload["message"] ?? ""), 80)}`;
    case "TurnStarted":
      return `[${ts}] turn started: ${String(payload["turn_id"] ?? "")}`;
    case "TurnComplete":
      return `[${ts}] turn complete: ${String(payload["turn_id"] ?? "")}`;
    case "ExecCommandBegin": {
      const cmd = payload["command"];
      return `[${ts}] exec: ${Array.isArray(cmd) ? cmd.join(" ") : String(cmd ?? "")}`;
    }
    case "ExecCommandEnd": {
      const code = payload["exit_code"];
      return `[${ts}] exec done: exit=${String(code ?? "?")}`;
    }
    case "TokenCount": {
      const total = payload["total_tokens"];
      return `[${ts}] tokens: ${String(total ?? "?")}`;
    }
    case "Error":
      return `[${ts}] ERROR: ${String(payload["message"] ?? "")}`;
    default:
      return `[${ts}] event: ${eventType}`;
  }
}
function formatProvenanceSuffix(provenance) {
  if (provenance === undefined) {
    return "";
  }
  const fields = [`origin=${provenance.origin}`];
  if (provenance.role !== undefined) {
    fields.push(`role=${provenance.role}`);
  }
  if (provenance.source_tag !== undefined) {
    fields.push(`tag=${provenance.source_tag}`);
  }
  if (!provenance.display_default) {
    fields.push("display_default=false");
  }
  return ` {${fields.join(", ")}}`;
}
function formatDate(d) {
  return d.toISOString().slice(0, 19).replace("T", " ");
}
function truncate(s, max) {
  if (s.length <= max) {
    return s;
  }
  return s.slice(0, max - 3) + "...";
}

// src/cli/index.ts
var USAGE = `codex-agent - Codex session manager

Usage:
  codex-agent session list [options]
  codex-agent session show <id> [--tasks]
  codex-agent session watch <id>
  codex-agent session resume <id> [options]
  codex-agent session fork <id> [--nth-message N] [options]

  codex-agent group create <name> [--description D]
  codex-agent group list [--format json|table]
  codex-agent group show <group>
  codex-agent group add <group> <session>
  codex-agent group remove <group> <session>
  codex-agent group pause <group>
  codex-agent group resume <group>
  codex-agent group delete <group>
  codex-agent group run <name> --prompt <P> [--max-concurrent N] [--image FILE]...

  codex-agent bookmark add --type <session|message|range> --session <id> --name <name> [options]
  codex-agent bookmark list [--format json|table] [--session <id>] [--type <type>] [--tag <tag>]
  codex-agent bookmark get <id>
  codex-agent bookmark delete <id>
  codex-agent bookmark search <query> [--limit <n>] [--format json|table]

  codex-agent token create --name <name> [--permissions <csv>] [--expires-at <iso8601>]
  codex-agent token list [--format json|table]
  codex-agent token revoke <id>
  codex-agent token rotate <id>

  codex-agent files list <session-id> [--format json|table]
  codex-agent files find <path> [--format json|table]
  codex-agent files rebuild

  codex-agent queue create <name> --project <path>
  codex-agent queue add <name> --prompt <prompt> [--image FILE]...
  codex-agent queue show <name>
  codex-agent queue list [--format json|table]
  codex-agent queue pause <name>
  codex-agent queue resume <name>
  codex-agent queue delete <name>
  codex-agent queue update <name> <command-id> [--prompt <text>] [--status <status>]
  codex-agent queue remove <name> <command-id>
  codex-agent queue move <name> --from <n> --to <n>
  codex-agent queue mode <name> <command-id> --mode <auto|manual>
  codex-agent queue run <name> [--image FILE]...

  codex-agent server start [--port N] [--host H] [--token T] [--transport local-cli|app-server] [--app-server-url ws://...]

  codex-agent daemon start [--port N] [--host H] [--token T] [--mode http|app-server] [--app-server-url ws://...]
  codex-agent daemon stop
  codex-agent daemon status

Session list options:
  --source <cli|vscode|exec>  Filter by session source
  --cwd <path>                Filter by working directory
  --branch <name>             Filter by git branch
  --limit <n>                 Max results (default: 50)
  --format <table|json>       Output format (default: table)

Common process options:
  --model <model>             Model to use
  --sandbox <full|network-only|none>  Sandbox mode
  --full-auto                 Enable full-auto mode
  --image <path>              Attach image(s) to prompt (repeatable)

Server options:
  --port <n>                  Port number (default: 3100, env: CODEX_AGENT_PORT)
  --host <host>               Hostname (default: 127.0.0.1, env: CODEX_AGENT_HOST)
  --token <token>             Auth token (env: CODEX_AGENT_TOKEN)
  --transport <mode>          local-cli | app-server (env: CODEX_AGENT_TRANSPORT)
  --app-server-url <url>      WebSocket URL for app-server transport
`;
async function run(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    return;
  }
  const subcommand = args[0];
  const action = args[1];
  const rest = args.slice(2);
  switch (subcommand) {
    case "session":
      await handleSession(action, rest);
      break;
    case "group":
      await handleGroup(action, rest);
      break;
    case "queue":
      await handleQueue(action, rest);
      break;
    case "bookmark":
      await handleBookmark(action, rest);
      break;
    case "token":
      await handleToken(action, rest);
      break;
    case "files":
      await handleFiles(action, rest);
      break;
    case "server":
      await handleServer(action, rest);
      break;
    case "daemon":
      await handleDaemon(action, rest);
      break;
    default:
      console.error(`Unknown command: ${subcommand}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
async function handleSession(action, args) {
  switch (action) {
    case "list":
      await handleSessionList(args);
      break;
    case "show":
      await handleSessionShow(args);
      break;
    case "watch":
      await handleSessionWatch(args);
      break;
    case "resume":
      await handleSessionResume(args);
      break;
    case "fork":
      await handleSessionFork(args);
      break;
    default:
      console.error(`Unknown session action: ${action ?? "(none)"}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
async function handleSessionList(args) {
  const opts = parseListArgs(args);
  const result = await listSessions({
    source: opts.source,
    cwd: opts.cwd,
    branch: opts.branch,
    limit: opts.limit
  });
  if (opts.format === "json") {
    console.log(formatSessionsJson(result.sessions));
  } else {
    console.log(formatSessionTable(result.sessions));
    if (result.total > result.sessions.length) {
      console.log(`
Showing ${result.sessions.length} of ${result.total} sessions`);
    }
  }
}
async function handleSessionShow(args) {
  const id = args[0];
  if (id === undefined) {
    console.error("Usage: codex-agent session show <id>");
    process.exitCode = 1;
    return;
  }
  const session = await findSession(id);
  if (session === null) {
    console.error(`Session not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  console.log(formatSessionDetail(session));
  const lines = await readRollout(session.rolloutPath);
  if (lines.length > 1) {
    console.log(`
Events (${lines.length} total):`);
    const recent = lines.slice(-20);
    for (const line of recent) {
      console.log("  " + formatRolloutLine(line));
    }
    if (lines.length > 20) {
      console.log(`  ... (${lines.length - 20} earlier events omitted)`);
    }
  }
  if (args.includes("--tasks")) {
    renderMarkdownTasks(lines);
  }
}
async function handleSessionWatch(args) {
  const id = args[0];
  if (id === undefined) {
    console.error("Usage: codex-agent session watch <id>");
    process.exitCode = 1;
    return;
  }
  const session = await findSession(id);
  if (session === null) {
    console.error(`Session not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  console.log(formatSessionDetail(session));
  console.log(`
Watching for updates... (Ctrl+C to stop)
`);
  const watcher = new RolloutWatcher;
  watcher.on("line", (_path, line) => {
    console.log(formatRolloutLine(line));
  });
  watcher.on("error", (err) => {
    console.error(`Watch error: ${err.message}`);
  });
  await watcher.watchFile(session.rolloutPath);
  await new Promise((resolve2) => {
    const handler = () => {
      watcher.stop();
      resolve2();
    };
    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
  });
}
async function handleSessionResume(args) {
  const id = args[0];
  if (id === undefined) {
    console.error("Usage: codex-agent session resume <id>");
    process.exitCode = 1;
    return;
  }
  const opts = parseProcessOptions(args.slice(1));
  const pm = new ProcessManager;
  const proc = pm.spawnResume(id, opts);
  console.log(`Resuming session ${id} (pid: ${proc.pid})`);
}
async function handleSessionFork(args) {
  const id = args[0];
  if (id === undefined) {
    console.error("Usage: codex-agent session fork <id> [--nth-message N]");
    process.exitCode = 1;
    return;
  }
  const nthMessage = getArgValue(args, "--nth-message");
  const nth = nthMessage !== undefined ? parseInt(nthMessage, 10) : undefined;
  const opts = parseProcessOptions(args.slice(1));
  const pm = new ProcessManager;
  const proc = pm.spawnFork(id, nth, opts);
  console.log(`Forking session ${id} (pid: ${proc.pid})`);
}
async function handleGroup(action, args) {
  switch (action) {
    case "create":
      await handleGroupCreate(args);
      break;
    case "list":
      await handleGroupList(args);
      break;
    case "show":
      await handleGroupShow(args);
      break;
    case "add":
      await handleGroupAdd(args);
      break;
    case "remove":
      await handleGroupRemove(args);
      break;
    case "pause":
      await handleGroupPause(args);
      break;
    case "resume":
      await handleGroupResume(args);
      break;
    case "delete":
      await handleGroupDelete(args);
      break;
    case "run":
      await handleGroupRun(args);
      break;
    default:
      console.error(`Unknown group action: ${action ?? "(none)"}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
async function handleGroupCreate(args) {
  const name = args[0];
  if (name === undefined) {
    console.error("Usage: codex-agent group create <name> [--description D]");
    process.exitCode = 1;
    return;
  }
  const description = getArgValue(args, "--description");
  const group = await addGroup(name, description);
  console.log(`Group created: ${group.name} (${group.id})`);
}
async function handleGroupList(args) {
  const format = getArgValue(args, "--format") ?? "table";
  const groups = await listGroups();
  if (groups.length === 0) {
    console.log("No groups found.");
    return;
  }
  if (format === "json") {
    console.log(JSON.stringify(groups, null, 2));
    return;
  }
  const rows = groups.map((g) => ({
    id: g.id.slice(0, 8),
    name: g.name,
    sessions: String(g.sessionIds.length),
    created: g.createdAt.toISOString().slice(0, 19).replace("T", " ")
  }));
  const headers = { id: "ID", name: "NAME", sessions: "SESSIONS", created: "CREATED" };
  const cols = Object.keys(headers);
  const widths = Object.fromEntries(cols.map((col) => [col, Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)]));
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join(`
`));
}
async function handleGroupShow(args) {
  const groupName = args[0];
  if (groupName === undefined) {
    console.error("Usage: codex-agent group show <group>");
    process.exitCode = 1;
    return;
  }
  const group = await findGroup(groupName);
  if (group === null) {
    console.error(`Group not found: ${groupName}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(group, null, 2));
}
async function handleGroupAdd(args) {
  const groupName = args[0];
  const sessionId = args[1];
  if (groupName === undefined || sessionId === undefined) {
    console.error("Usage: codex-agent group add <group> <session>");
    process.exitCode = 1;
    return;
  }
  const group = await findGroup(groupName);
  if (group === null) {
    console.error(`Group not found: ${groupName}`);
    process.exitCode = 1;
    return;
  }
  await addSessionToGroup(group.id, sessionId);
  console.log(`Added session ${sessionId} to group ${group.name}`);
}
async function handleGroupRemove(args) {
  const groupName = args[0];
  const sessionId = args[1];
  if (groupName === undefined || sessionId === undefined) {
    console.error("Usage: codex-agent group remove <group> <session>");
    process.exitCode = 1;
    return;
  }
  const group = await findGroup(groupName);
  if (group === null) {
    console.error(`Group not found: ${groupName}`);
    process.exitCode = 1;
    return;
  }
  await removeSessionFromGroup(group.id, sessionId);
  console.log(`Removed session ${sessionId} from group ${group.name}`);
}
async function handleGroupPause(args) {
  const groupName = args[0];
  if (groupName === undefined) {
    console.error("Usage: codex-agent group pause <group>");
    process.exitCode = 1;
    return;
  }
  const group = await findGroup(groupName);
  if (group === null) {
    console.error(`Group not found: ${groupName}`);
    process.exitCode = 1;
    return;
  }
  await pauseGroup(group.id);
  console.log(`Paused group ${group.name}`);
}
async function handleGroupResume(args) {
  const groupName = args[0];
  if (groupName === undefined) {
    console.error("Usage: codex-agent group resume <group>");
    process.exitCode = 1;
    return;
  }
  const group = await findGroup(groupName);
  if (group === null) {
    console.error(`Group not found: ${groupName}`);
    process.exitCode = 1;
    return;
  }
  await resumeGroup(group.id);
  console.log(`Resumed group ${group.name}`);
}
async function handleGroupDelete(args) {
  const groupName = args[0];
  if (groupName === undefined) {
    console.error("Usage: codex-agent group delete <group>");
    process.exitCode = 1;
    return;
  }
  const group = await findGroup(groupName);
  if (group === null) {
    console.error(`Group not found: ${groupName}`);
    process.exitCode = 1;
    return;
  }
  await removeGroup(group.id);
  console.log(`Deleted group ${group.name}`);
}
async function handleGroupRun(args) {
  const name = args[0];
  if (name === undefined) {
    console.error("Usage: codex-agent group run <name> --prompt <P> [--max-concurrent N]");
    process.exitCode = 1;
    return;
  }
  const prompt = getArgValue(args, "--prompt");
  if (prompt === undefined) {
    console.error("--prompt is required for group run");
    process.exitCode = 1;
    return;
  }
  const group = await findGroup(name);
  if (group === null) {
    console.error(`Group not found: ${name}`);
    process.exitCode = 1;
    return;
  }
  const maxConcurrentStr = getArgValue(args, "--max-concurrent");
  const maxConcurrent = maxConcurrentStr !== undefined ? parseInt(maxConcurrentStr, 10) : undefined;
  const opts = parseProcessOptions(args.slice(1));
  console.log(`Running prompt across ${group.sessionIds.length} sessions in group "${group.name}"...`);
  for await (const event of runGroup(group, prompt, { ...opts, maxConcurrent })) {
    switch (event.type) {
      case "session_started":
        console.log(`  [started] ${event.sessionId}`);
        break;
      case "session_completed":
        console.log(`  [done]    ${event.sessionId} (exit: ${event.exitCode})`);
        break;
      case "session_failed":
        console.log(`  [failed]  ${event.sessionId} (exit: ${event.exitCode})`);
        break;
      case "group_completed":
        console.log(`
Group run complete: ${event.completed.length} completed, ${event.failed.length} failed`);
        break;
    }
  }
}
async function handleBookmark(action, args) {
  switch (action) {
    case "add":
      await handleBookmarkAdd(args);
      break;
    case "list":
      await handleBookmarkList(args);
      break;
    case "get":
      await handleBookmarkGet(args);
      break;
    case "delete":
      await handleBookmarkDelete(args);
      break;
    case "search":
      await handleBookmarkSearch(args);
      break;
    default:
      console.error(`Unknown bookmark action: ${action ?? "(none)"}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
async function handleBookmarkAdd(args) {
  const typeValue = getArgValue(args, "--type");
  const sessionId = getArgValue(args, "--session");
  const name = getArgValue(args, "--name");
  const description = getArgValue(args, "--description");
  const tags = getArgValues(args, "--tag");
  const messageId = getArgValue(args, "--message");
  const fromMessageId = getArgValue(args, "--from");
  const toMessageId = getArgValue(args, "--to");
  if (typeValue === undefined || sessionId === undefined || name === undefined) {
    console.error("Usage: codex-agent bookmark add --type <session|message|range> --session <id> --name <name> [--description <text>] [--tag <tag>] [--message <id>] [--from <id>] [--to <id>]");
    process.exitCode = 1;
    return;
  }
  if (!isBookmarkType(typeValue)) {
    console.error(`Invalid bookmark type: ${typeValue}`);
    process.exitCode = 1;
    return;
  }
  try {
    const bookmark = await addBookmark({
      type: typeValue,
      sessionId,
      name,
      description,
      tags,
      messageId,
      fromMessageId,
      toMessageId
    });
    console.log(`Bookmark created: ${bookmark.name} (${bookmark.id})`);
  } catch (err) {
    console.error(`Failed to add bookmark: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
async function handleBookmarkList(args) {
  const format = getArgValue(args, "--format") ?? "table";
  const typeArg = getArgValue(args, "--type");
  const sessionId = getArgValue(args, "--session");
  const tag = getArgValue(args, "--tag");
  let type;
  if (typeArg !== undefined) {
    if (!isBookmarkType(typeArg)) {
      console.error(`Invalid bookmark type: ${typeArg}`);
      process.exitCode = 1;
      return;
    }
    type = typeArg;
  }
  const bookmarks = await listBookmarks({ sessionId, type, tag });
  if (bookmarks.length === 0) {
    console.log("No bookmarks found.");
    return;
  }
  if (format === "json") {
    console.log(JSON.stringify(bookmarks, null, 2));
    return;
  }
  const rows = bookmarks.map((bookmark) => ({
    id: bookmark.id.slice(0, 8),
    type: bookmark.type,
    session: bookmark.sessionId.slice(0, 12),
    name: bookmark.name.length > 28 ? bookmark.name.slice(0, 25) + "..." : bookmark.name,
    tags: bookmark.tags.join(",")
  }));
  const headers = { id: "ID", type: "TYPE", session: "SESSION", name: "NAME", tags: "TAGS" };
  const cols = Object.keys(headers);
  const widths = Object.fromEntries(cols.map((col) => [col, Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)]));
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join(`
`));
}
async function handleBookmarkGet(args) {
  const id = args[0];
  if (id === undefined) {
    console.error("Usage: codex-agent bookmark get <id>");
    process.exitCode = 1;
    return;
  }
  const bookmark = await getBookmark(id);
  if (bookmark === null) {
    console.error(`Bookmark not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(bookmark, null, 2));
}
async function handleBookmarkDelete(args) {
  const id = args[0];
  if (id === undefined) {
    console.error("Usage: codex-agent bookmark delete <id>");
    process.exitCode = 1;
    return;
  }
  const deleted = await deleteBookmark(id);
  if (!deleted) {
    console.error(`Bookmark not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Bookmark deleted: ${id}`);
}
async function handleBookmarkSearch(args) {
  const query = args[0];
  if (query === undefined) {
    console.error("Usage: codex-agent bookmark search <query> [--limit <n>] [--format json|table]");
    process.exitCode = 1;
    return;
  }
  const format = getArgValue(args, "--format") ?? "table";
  const limitArg = getArgValue(args, "--limit");
  const limit = limitArg !== undefined ? parseInt(limitArg, 10) : undefined;
  const results = await searchBookmarks(query, { limit });
  if (results.length === 0) {
    console.log("No matching bookmarks found.");
    return;
  }
  if (format === "json") {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  const rows = results.map((result) => ({
    score: String(result.score),
    id: result.bookmark.id.slice(0, 8),
    type: result.bookmark.type,
    name: result.bookmark.name.length > 28 ? result.bookmark.name.slice(0, 25) + "..." : result.bookmark.name
  }));
  const headers = { score: "SCORE", id: "ID", type: "TYPE", name: "NAME" };
  const cols = Object.keys(headers);
  const widths = Object.fromEntries(cols.map((col) => [col, Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)]));
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join(`
`));
}
async function handleFiles(action, args) {
  switch (action) {
    case "list":
      await handleFilesList(args);
      break;
    case "find":
      await handleFilesFind(args);
      break;
    case "rebuild":
      await handleFilesRebuild();
      break;
    default:
      console.error(`Unknown files action: ${action ?? "(none)"}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
async function handleFilesList(args) {
  const sessionId = args[0];
  if (sessionId === undefined) {
    console.error("Usage: codex-agent files list <session-id> [--format json|table]");
    process.exitCode = 1;
    return;
  }
  const format = getArgValue(args, "--format") ?? "table";
  try {
    const summary = await getChangedFiles(sessionId);
    if (format === "json") {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }
    if (summary.files.length === 0) {
      console.log("No file changes found.");
      return;
    }
    const rows = summary.files.map((file) => ({
      path: file.path,
      op: file.operation,
      count: String(file.changeCount),
      last: file.lastModified
    }));
    const headers = { path: "PATH", op: "OP", count: "COUNT", last: "LAST_MODIFIED" };
    const cols = Object.keys(headers);
    const widths = Object.fromEntries(cols.map((col) => [col, Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)]));
    const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
    const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
    const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
    console.log([headerLine, separator, ...dataLines].join(`
`));
  } catch (err) {
    console.error(`Failed to list file changes: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
async function handleFilesFind(args) {
  const path = args[0];
  if (path === undefined) {
    console.error("Usage: codex-agent files find <path> [--format json|table]");
    process.exitCode = 1;
    return;
  }
  const format = getArgValue(args, "--format") ?? "table";
  const history = await findSessionsByFile(path);
  if (format === "json") {
    console.log(JSON.stringify(history, null, 2));
    return;
  }
  if (history.sessions.length === 0) {
    console.log(`No sessions found for path: ${path}`);
    return;
  }
  const rows = history.sessions.map((entry) => ({
    session: entry.sessionId.slice(0, 8),
    operation: entry.operation,
    last: entry.lastModified
  }));
  const headers = { session: "SESSION", operation: "OP", last: "LAST_MODIFIED" };
  const cols = Object.keys(headers);
  const widths = Object.fromEntries(cols.map((col) => [col, Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)]));
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join(`
`));
}
async function handleFilesRebuild() {
  const stats = await rebuildFileIndex();
  console.log(`Indexed ${stats.indexedFiles} files across ${stats.indexedSessions} sessions (updated: ${stats.updatedAt})`);
}
async function handleToken(action, args) {
  switch (action) {
    case "create":
      await handleTokenCreate(args);
      break;
    case "list":
      await handleTokenList(args);
      break;
    case "revoke":
      await handleTokenRevoke(args);
      break;
    case "rotate":
      await handleTokenRotate(args);
      break;
    default:
      console.error(`Unknown token action: ${action ?? "(none)"}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
async function handleTokenCreate(args) {
  const name = getArgValue(args, "--name");
  if (name === undefined || name.trim().length === 0) {
    console.error("Usage: codex-agent token create --name <name> [--permissions <csv>] [--expires-at <iso8601>]");
    process.exitCode = 1;
    return;
  }
  const permissionsCsv = getArgValue(args, "--permissions");
  const expiresAt = getArgValue(args, "--expires-at");
  const permissions = permissionsCsv !== undefined ? parsePermissionList(permissionsCsv) : ["session:read"];
  if (permissions.length === 0) {
    console.error(`No valid permissions provided. Allowed: ${PERMISSIONS.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  try {
    const token = await createToken({
      name,
      permissions,
      expiresAt
    });
    console.log("Token created:");
    console.log(token);
  } catch (err) {
    console.error(`Failed to create token: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
async function handleTokenList(args) {
  const format = getArgValue(args, "--format") ?? "table";
  const tokens = await listTokens();
  if (tokens.length === 0) {
    console.log("No tokens found.");
    return;
  }
  if (format === "json") {
    console.log(JSON.stringify(tokens, null, 2));
    return;
  }
  const rows = tokens.map((token) => ({
    id: token.id.slice(0, 8),
    name: token.name,
    permissions: token.permissions.join(","),
    expires: token.expiresAt ?? "-",
    revoked: token.revokedAt ?? "-"
  }));
  const headers = {
    id: "ID",
    name: "NAME",
    permissions: "PERMISSIONS",
    expires: "EXPIRES_AT",
    revoked: "REVOKED_AT"
  };
  const cols = Object.keys(headers);
  const widths = Object.fromEntries(cols.map((col) => [col, Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)]));
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join(`
`));
}
async function handleTokenRevoke(args) {
  const id = args[0];
  if (id === undefined) {
    console.error("Usage: codex-agent token revoke <id>");
    process.exitCode = 1;
    return;
  }
  const ok = await revokeToken(id);
  if (!ok) {
    console.error(`Token not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Token revoked: ${id}`);
}
async function handleTokenRotate(args) {
  const id = args[0];
  if (id === undefined) {
    console.error("Usage: codex-agent token rotate <id>");
    process.exitCode = 1;
    return;
  }
  try {
    const token = await rotateToken(id);
    console.log("Token rotated:");
    console.log(token);
  } catch (err) {
    console.error(`Failed to rotate token: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
async function handleQueue(action, args) {
  switch (action) {
    case "create":
      await handleQueueCreate(args);
      break;
    case "add":
      await handleQueueAdd(args);
      break;
    case "show":
      await handleQueueShow(args);
      break;
    case "list":
      await handleQueueList(args);
      break;
    case "pause":
      await handleQueuePause(args);
      break;
    case "resume":
      await handleQueueResume(args);
      break;
    case "delete":
      await handleQueueDelete(args);
      break;
    case "update":
      await handleQueueUpdate(args);
      break;
    case "remove":
      await handleQueueRemoveCommand(args);
      break;
    case "move":
      await handleQueueMove(args);
      break;
    case "mode":
      await handleQueueMode(args);
      break;
    case "run":
      await handleQueueRun(args);
      break;
    default:
      console.error(`Unknown queue action: ${action ?? "(none)"}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
async function handleQueueCreate(args) {
  const name = args[0];
  if (name === undefined) {
    console.error("Usage: codex-agent queue create <name> --project <path>");
    process.exitCode = 1;
    return;
  }
  const projectPath = getArgValue(args, "--project");
  if (projectPath === undefined) {
    console.error("--project is required for queue create");
    process.exitCode = 1;
    return;
  }
  const queue = await createQueue(name, projectPath);
  console.log(`Queue created: ${queue.name} (${queue.id})`);
}
async function handleQueueAdd(args) {
  const name = args[0];
  if (name === undefined) {
    console.error("Usage: codex-agent queue add <name> --prompt <prompt> [--image <path>]...");
    process.exitCode = 1;
    return;
  }
  const prompt = getArgValue(args, "--prompt");
  if (prompt === undefined) {
    console.error("--prompt is required for queue add");
    process.exitCode = 1;
    return;
  }
  const images = getArgValues(args, "--image");
  const queue = await findQueue(name);
  if (queue === null) {
    console.error(`Queue not found: ${name}`);
    process.exitCode = 1;
    return;
  }
  const queuePrompt = await addPrompt(queue.id, prompt, images.length > 0 ? images : undefined);
  console.log(`Prompt added to queue ${queue.name}: ${queuePrompt.id.slice(0, 8)}`);
}
async function handleQueueShow(args) {
  const name = args[0];
  if (name === undefined) {
    console.error("Usage: codex-agent queue show <name>");
    process.exitCode = 1;
    return;
  }
  const queue = await findQueue(name);
  if (queue === null) {
    console.error(`Queue not found: ${name}`);
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify(queue, null, 2));
}
async function handleQueueList(args) {
  const format = getArgValue(args, "--format") ?? "table";
  const queues = await listQueues();
  if (queues.length === 0) {
    console.log("No queues found.");
    return;
  }
  if (format === "json") {
    console.log(JSON.stringify(queues, null, 2));
    return;
  }
  const rows = queues.map((q) => ({
    id: q.id.slice(0, 8),
    name: q.name,
    project: q.projectPath.length > 40 ? "..." + q.projectPath.slice(-37) : q.projectPath,
    prompts: String(q.prompts.length),
    pending: String(q.prompts.filter((p) => p.status === "pending").length),
    created: q.createdAt.toISOString().slice(0, 19).replace("T", " ")
  }));
  const headers = { id: "ID", name: "NAME", project: "PROJECT", prompts: "PROMPTS", pending: "PENDING", created: "CREATED" };
  const cols = Object.keys(headers);
  const widths = Object.fromEntries(cols.map((col) => [col, Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)]));
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join(`
`));
}
async function handleQueuePause(args) {
  const name = args[0];
  if (name === undefined) {
    console.error("Usage: codex-agent queue pause <name>");
    process.exitCode = 1;
    return;
  }
  const queue = await findQueue(name);
  if (queue === null) {
    console.error(`Queue not found: ${name}`);
    process.exitCode = 1;
    return;
  }
  await pauseQueue(queue.id);
  console.log(`Paused queue ${queue.name}`);
}
async function handleQueueResume(args) {
  const name = args[0];
  if (name === undefined) {
    console.error("Usage: codex-agent queue resume <name>");
    process.exitCode = 1;
    return;
  }
  const queue = await findQueue(name);
  if (queue === null) {
    console.error(`Queue not found: ${name}`);
    process.exitCode = 1;
    return;
  }
  await resumeQueue(queue.id);
  console.log(`Resumed queue ${queue.name}`);
}
async function handleQueueDelete(args) {
  const name = args[0];
  if (name === undefined) {
    console.error("Usage: codex-agent queue delete <name>");
    process.exitCode = 1;
    return;
  }
  const queue = await findQueue(name);
  if (queue === null) {
    console.error(`Queue not found: ${name}`);
    process.exitCode = 1;
    return;
  }
  await removeQueue(queue.id);
  console.log(`Deleted queue ${queue.name}`);
}
async function handleQueueUpdate(args) {
  const name = args[0];
  const commandId = args[1];
  if (name === undefined || commandId === undefined) {
    console.error("Usage: codex-agent queue update <name> <command-id> [--prompt <text>] [--status <status>]");
    process.exitCode = 1;
    return;
  }
  const queue = await findQueue(name);
  if (queue === null) {
    console.error(`Queue not found: ${name}`);
    process.exitCode = 1;
    return;
  }
  const prompt = getArgValue(args, "--prompt");
  const statusRaw = getArgValue(args, "--status");
  const status = statusRaw === "pending" || statusRaw === "running" || statusRaw === "completed" || statusRaw === "failed" ? statusRaw : undefined;
  const ok = await updateQueueCommand(queue.id, commandId, { prompt, status });
  if (!ok) {
    console.error(`Queue command not found: ${commandId}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Updated command ${commandId} in queue ${queue.name}`);
}
async function handleQueueRemoveCommand(args) {
  const name = args[0];
  const commandId = args[1];
  if (name === undefined || commandId === undefined) {
    console.error("Usage: codex-agent queue remove <name> <command-id>");
    process.exitCode = 1;
    return;
  }
  const queue = await findQueue(name);
  if (queue === null) {
    console.error(`Queue not found: ${name}`);
    process.exitCode = 1;
    return;
  }
  const ok = await removeQueueCommand(queue.id, commandId);
  if (!ok) {
    console.error(`Queue command not found: ${commandId}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Removed command ${commandId} from queue ${queue.name}`);
}
async function handleQueueMove(args) {
  const name = args[0];
  if (name === undefined) {
    console.error("Usage: codex-agent queue move <name> --from <n> --to <n>");
    process.exitCode = 1;
    return;
  }
  const queue = await findQueue(name);
  if (queue === null) {
    console.error(`Queue not found: ${name}`);
    process.exitCode = 1;
    return;
  }
  const fromStr = getArgValue(args, "--from");
  const toStr = getArgValue(args, "--to");
  const from = fromStr !== undefined ? parseInt(fromStr, 10) : NaN;
  const to = toStr !== undefined ? parseInt(toStr, 10) : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    console.error("Usage: codex-agent queue move <name> --from <n> --to <n>");
    process.exitCode = 1;
    return;
  }
  const ok = await moveQueueCommand(queue.id, from, to);
  if (!ok) {
    console.error("Failed to move queue command. Check indices.");
    process.exitCode = 1;
    return;
  }
  console.log(`Moved command in queue ${queue.name}: ${from} -> ${to}`);
}
async function handleQueueMode(args) {
  const name = args[0];
  const commandId = args[1];
  const modeRaw = getArgValue(args, "--mode");
  if (name === undefined || commandId === undefined || modeRaw !== "auto" && modeRaw !== "manual") {
    console.error("Usage: codex-agent queue mode <name> <command-id> --mode <auto|manual>");
    process.exitCode = 1;
    return;
  }
  const queue = await findQueue(name);
  if (queue === null) {
    console.error(`Queue not found: ${name}`);
    process.exitCode = 1;
    return;
  }
  const ok = await toggleQueueCommandMode(queue.id, commandId, modeRaw);
  if (!ok) {
    console.error(`Queue command not found: ${commandId}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Set mode ${modeRaw} for command ${commandId} in queue ${queue.name}`);
}
async function handleQueueRun(args) {
  const name = args[0];
  if (name === undefined) {
    console.error("Usage: codex-agent queue run <name>");
    process.exitCode = 1;
    return;
  }
  const queue = await findQueue(name);
  if (queue === null) {
    console.error(`Queue not found: ${name}`);
    process.exitCode = 1;
    return;
  }
  const pendingCount = queue.prompts.filter((p) => p.status === "pending").length;
  console.log(`Running queue "${queue.name}" (${pendingCount} pending prompts)...`);
  const opts = parseProcessOptions(args.slice(1));
  const stopSignal = { stopped: false };
  const handler = () => {
    console.log(`
Stopping after current prompt...`);
    stopSignal.stopped = true;
  };
  process.on("SIGINT", handler);
  for await (const event of runQueue(queue, opts, stopSignal)) {
    switch (event.type) {
      case "prompt_started":
        console.log(`  [started]   ${event.promptId?.slice(0, 8)}`);
        break;
      case "prompt_completed":
        console.log(`  [completed] ${event.promptId?.slice(0, 8)} (exit: ${event.exitCode})`);
        break;
      case "prompt_failed":
        console.log(`  [failed]    ${event.promptId?.slice(0, 8)} (exit: ${event.exitCode})`);
        break;
      case "queue_completed":
        console.log(`
Queue complete: ${event.completed.length} completed, ${event.failed.length} failed`);
        break;
      case "queue_stopped":
        console.log(`
Queue stopped: ${event.completed.length} completed, ${event.pending.length} remaining`);
        break;
    }
  }
  process.removeListener("SIGINT", handler);
}
async function handleServer(action, args) {
  if (action !== "start") {
    console.error(`Unknown server action: ${action ?? "(none)"}`);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }
  let config;
  try {
    config = resolveServerConfig(parseServerStartArgs(args));
  } catch (err) {
    console.error(`Invalid server options: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }
  const handle = startServer(config);
  console.log(`Server listening on http://${handle.hostname}:${handle.port}`);
  await new Promise((resolve2) => {
    const shutdown = () => {
      console.log(`
Shutting down server...`);
      handle.stop();
      resolve2();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
async function handleDaemon(action, args) {
  switch (action) {
    case "start": {
      const daemonConfig = parseDaemonStartArgs(args);
      try {
        const info = await startDaemon(daemonConfig);
        console.log(`Daemon started (pid: ${info.pid}, port: ${info.port}, mode: ${info.mode})`);
      } catch (err) {
        console.error(`Failed to start daemon: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
      break;
    }
    case "stop": {
      const stopped = await stopDaemon();
      if (stopped) {
        console.log("Daemon stopped.");
      } else {
        console.log("No daemon is running.");
      }
      break;
    }
    case "status": {
      const result = await getDaemonStatus();
      switch (result.status) {
        case "running":
          console.log(`Daemon is running (pid: ${result.info.pid}, port: ${result.info.port}, started: ${result.info.startedAt})`);
          break;
        case "stopped":
          console.log("Daemon is not running.");
          break;
        case "stale":
          console.log(`Daemon PID file is stale (pid: ${result.info.pid} no longer running).`);
          break;
      }
      break;
    }
    default:
      console.error(`Unknown daemon action: ${action ?? "(none)"}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
function parseServerStartArgs(args) {
  const portStr = getArgValue(args, "--port");
  const host = getArgValue(args, "--host");
  const token = getArgValue(args, "--token");
  const transport = getArgValue(args, "--transport");
  const appServerUrl = getArgValue(args, "--app-server-url");
  const parsed = {};
  if (portStr !== undefined)
    parsed.port = parseInt(portStr, 10) || 3100;
  if (host !== undefined)
    parsed.hostname = host;
  if (token !== undefined)
    parsed.token = token;
  if (transport === "local-cli" || transport === "app-server") {
    parsed.transport = transport;
  }
  if (appServerUrl !== undefined)
    parsed.appServerUrl = appServerUrl;
  return parsed;
}
function parseDaemonStartArgs(args) {
  const portStr = getArgValue(args, "--port");
  const host = getArgValue(args, "--host");
  const token = getArgValue(args, "--token");
  const modeRaw = getArgValue(args, "--mode");
  const appServerUrl = getArgValue(args, "--app-server-url");
  return {
    ...portStr !== undefined ? { port: parseInt(portStr, 10) || 3100 } : {},
    ...host !== undefined ? { host } : {},
    ...token !== undefined ? { token } : {},
    ...modeRaw === "http" || modeRaw === "app-server" ? { mode: modeRaw } : {},
    ...appServerUrl !== undefined ? { appServerUrl } : {}
  };
}
function parseListArgs(args) {
  const result = { limit: 50, format: "table" };
  for (let i = 0;i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--source":
        if (next !== undefined && isSessionSource2(next)) {
          result.source = next;
          i++;
        }
        break;
      case "--cwd":
        if (next !== undefined) {
          result.cwd = next;
          i++;
        }
        break;
      case "--branch":
        if (next !== undefined) {
          result.branch = next;
          i++;
        }
        break;
      case "--limit":
        if (next !== undefined) {
          result.limit = parseInt(next, 10) || 50;
          i++;
        }
        break;
      case "--format":
        if (next === "json" || next === "table") {
          result.format = next;
          i++;
        }
        break;
    }
  }
  return result;
}
function isSessionSource2(s) {
  return s === "cli" || s === "vscode" || s === "exec" || s === "unknown";
}
function getArgValue(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length)
    return;
  return args[idx + 1];
}
function getArgValues(args, flag) {
  const values = [];
  for (let i = 0;i < args.length; i++) {
    if (args[i] === flag) {
      const value = args[i + 1];
      if (value !== undefined) {
        values.push(value);
      }
    }
  }
  return values;
}
function parseProcessOptions(args) {
  const opts = {};
  const model = getArgValue(args, "--model");
  if (model !== undefined)
    opts.model = model;
  const sandbox = getArgValue(args, "--sandbox");
  if (sandbox === "full" || sandbox === "network-only" || sandbox === "none") {
    opts.sandbox = sandbox;
  }
  if (args.includes("--full-auto")) {
    opts.fullAuto = true;
  }
  const images = getArgValues(args, "--image");
  if (images.length > 0) {
    opts.images = images;
  }
  return opts;
}
function renderMarkdownTasks(lines) {
  const tasks = [];
  for (const line of lines) {
    if (line.type === "event_msg") {
      const payload = line.payload;
      const eventType = payload["type"];
      const message = payload["message"];
      if ((eventType === "UserMessage" || eventType === "AgentMessage") && typeof message === "string") {
        tasks.push(...extractMarkdownTasks(message));
      }
      continue;
    }
    if (line.type === "response_item") {
      const payload = line.payload;
      if (payload["type"] !== "message") {
        continue;
      }
      const content = payload["content"];
      if (!Array.isArray(content)) {
        continue;
      }
      for (const item of content) {
        if (typeof item !== "object" || item === null) {
          continue;
        }
        const itemObj = item;
        if ((itemObj["type"] === "input_text" || itemObj["type"] === "output_text") && typeof itemObj["text"] === "string") {
          tasks.push(...extractMarkdownTasks(itemObj["text"]));
        }
      }
    }
  }
  if (tasks.length === 0) {
    console.log(`
Markdown tasks: none`);
    return;
  }
  console.log(`
Markdown tasks:`);
  for (const task of tasks) {
    const checkbox = task.checked ? "[x]" : "[ ]";
    const sectionPrefix = task.sectionHeading.length > 0 ? `${task.sectionHeading}: ` : "";
    console.log(`  ${checkbox} ${sectionPrefix}${task.text}`);
  }
}
export {
  verifyToken,
  validateCreateBookmarkInput,
  updateQueuePrompts,
  updateQueueCommand,
  tool,
  toggleQueueCommandMode,
  streamEvents,
  stopDaemon,
  startServer,
  startDaemon,
  sessionsWatchDir,
  searchBookmarks,
  saveTokenConfig,
  saveQueues,
  saveGroups,
  saveBookmarks,
  runQueue,
  runGroup,
  run as runCli,
  runAgent,
  rotateToken,
  revokeToken,
  resumeQueue,
  resumeGroup,
  resolveServerConfig,
  resolveCodexHome,
  removeSessionFromGroup,
  removeQueueCommand,
  removeQueue,
  removeGroup,
  rebuildFileIndex,
  readRollout,
  pauseQueue,
  pauseGroup,
  parseSessionMeta,
  parseRolloutLine,
  parsePermissionList,
  parseMarkdown,
  openCodexDb,
  normalizePermissions,
  moveQueueCommand,
  loadTokenConfig,
  loadQueues,
  loadGroups,
  loadBookmarks,
  listTokens,
  listSessionsSqlite,
  listSessions,
  listQueues,
  listGroups,
  listBookmarks,
  isTurnContext,
  isSessionMeta,
  isResponseItem,
  isPermission,
  isEventMsg,
  isCompacted,
  isBookmarkType,
  hasPermission,
  getSessionActivity,
  getDaemonStatus,
  getChangedFiles,
  getBookmark,
  findSessionsByFile,
  findSessionSqlite,
  findSession,
  findQueue,
  findLatestSessionSqlite,
  findLatestSession,
  findGroup,
  extractMarkdownTasks,
  extractFirstUserMessage,
  extractChangedFiles,
  discoverRolloutPaths,
  deriveActivityEntry,
  deleteBookmark,
  createToken,
  createQueue,
  createAppServerClient,
  buildSession,
  addSessionToGroup,
  addPrompt,
  addGroup,
  addBookmark,
  ToolRegistry,
  SessionRunner,
  RunningSession,
  RolloutWatcher,
  ProcessManager,
  PERMISSIONS,
  BasicSdkEventEmitter,
  BOOKMARK_TYPES
};
