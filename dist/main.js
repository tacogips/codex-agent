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
// src/session/index.ts
import { readdir, stat } from "fs/promises";
import { join as join2, resolve } from "path";
import { homedir } from "os";

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
// src/session/search.ts
import { resolve as resolve2 } from "path";
import { Buffer as Buffer2 } from "buffer";
var DEFAULT_LIMIT = 50;
async function searchSessionTranscript(sessionId, query, options) {
  const normalizedQuery = normalizeQuery(query);
  const session = await findSession(sessionId, options?.codexHome);
  const startedAt = Date.now();
  if (session === null) {
    return {
      sessionId,
      matched: false,
      matchCount: 0,
      scannedBytes: 0,
      scannedEvents: 0,
      truncated: false,
      timedOut: false,
      durationMs: Date.now() - startedAt
    };
  }
  const budget = toBudget(options);
  const result = await searchTranscriptFile(session.rolloutPath, normalizedQuery, options, budget, false);
  return {
    sessionId,
    matched: result.matched,
    matchCount: result.matchCount,
    scannedBytes: result.scannedBytes,
    scannedEvents: result.scannedEvents,
    truncated: result.truncated,
    timedOut: result.timedOut,
    durationMs: Date.now() - startedAt
  };
}
async function searchSessions(query, options) {
  const normalizedQuery = normalizeQuery(query);
  const limit = options?.limit ?? DEFAULT_LIMIT;
  const offset = options?.offset ?? 0;
  const maxSessions = options?.maxSessions;
  const startedAt = Date.now();
  const budget = toBudget(options);
  const sessionIds = [];
  let total = 0;
  let scannedSessions = 0;
  let scannedBytes = 0;
  let scannedEvents = 0;
  let timedOut = false;
  let truncated = false;
  for await (const candidate of iterCandidates(options)) {
    if (maxSessions !== undefined && scannedSessions >= maxSessions) {
      truncated = true;
      break;
    }
    if (budget.maxBytes !== undefined && scannedBytes >= budget.maxBytes) {
      truncated = true;
      break;
    }
    if (budget.maxEvents !== undefined && scannedEvents >= budget.maxEvents) {
      truncated = true;
      break;
    }
    if (budget.deadlineAt !== undefined && Date.now() >= budget.deadlineAt) {
      timedOut = true;
      break;
    }
    scannedSessions += 1;
    const sessionBudget = {
      maxBytes: budget.maxBytes === undefined ? undefined : Math.max(0, budget.maxBytes - scannedBytes),
      maxEvents: budget.maxEvents === undefined ? undefined : Math.max(0, budget.maxEvents - scannedEvents),
      deadlineAt: budget.deadlineAt
    };
    const result = await searchTranscriptFile(candidate.rolloutPath, normalizedQuery, options, sessionBudget, true);
    scannedBytes += result.scannedBytes;
    scannedEvents += result.scannedEvents;
    if (result.matched) {
      total += 1;
      if (total > offset && sessionIds.length < limit) {
        sessionIds.push(candidate.id);
      }
    }
    if (result.timedOut) {
      timedOut = true;
      break;
    }
    if (result.truncated) {
      truncated = true;
      break;
    }
  }
  return {
    sessionIds,
    total,
    offset,
    limit,
    scannedSessions,
    scannedBytes,
    scannedEvents,
    truncated,
    timedOut,
    durationMs: Date.now() - startedAt
  };
}
async function* iterCandidates(options) {
  const db = openCodexDb(options?.codexHome);
  if (db !== null) {
    try {
      const clauses = [];
      const params = [];
      if (options?.source !== undefined) {
        clauses.push("source = ?");
        params.push(options.source);
      }
      if (options?.cwd !== undefined) {
        clauses.push("cwd = ?");
        params.push(options.cwd);
      }
      if (options?.branch !== undefined) {
        clauses.push("git_branch = ?");
        params.push(options.branch);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      const sql = `SELECT id, rollout_path FROM threads ${where} ORDER BY updated_at DESC`;
      const rows = db.query(sql).all(...params);
      for (const row of rows) {
        const id = asString(row["id"]);
        const rolloutPath = asString(row["rollout_path"]);
        if (id !== undefined && rolloutPath !== undefined) {
          yield { id, rolloutPath };
        }
      }
      return;
    } catch {} finally {
      db.close();
    }
  }
  for await (const rolloutPath of discoverRolloutPaths(options?.codexHome)) {
    const meta = await parseSessionMeta(rolloutPath);
    if (meta === null) {
      continue;
    }
    const parsedMeta = parseCandidateSessionMeta(meta);
    if (parsedMeta === null) {
      continue;
    }
    const { id, cwd, source, branch } = parsedMeta;
    if (options?.source !== undefined && source !== options.source) {
      continue;
    }
    if (options?.cwd !== undefined) {
      if (cwd === undefined || resolve2(cwd) !== resolve2(options.cwd)) {
        continue;
      }
    }
    if (options?.branch !== undefined && branch !== options.branch) {
      continue;
    }
    yield { id, rolloutPath };
  }
}
async function searchTranscriptFile(rolloutPath, query, options, budget, stopAtFirstMatch) {
  const role = options?.role ?? "both";
  const caseSensitive = options?.caseSensitive ?? false;
  let matched = false;
  let matchCount = 0;
  let scannedBytes = 0;
  let scannedEvents = 0;
  let truncated = false;
  let timedOut = false;
  for await (const line of streamEvents(rolloutPath)) {
    if (budget.maxEvents !== undefined && scannedEvents >= budget.maxEvents) {
      truncated = true;
      break;
    }
    if (budget.maxBytes !== undefined && scannedBytes >= budget.maxBytes) {
      truncated = true;
      break;
    }
    if (budget.deadlineAt !== undefined && Date.now() >= budget.deadlineAt) {
      timedOut = true;
      break;
    }
    scannedEvents += 1;
    const texts = extractSearchableTexts(line, role);
    if (texts.length === 0) {
      continue;
    }
    for (const text of texts) {
      const textBytes = Buffer2.byteLength(text, "utf8");
      if (budget.maxBytes !== undefined && scannedBytes + textBytes > budget.maxBytes) {
        truncated = true;
        break;
      }
      scannedBytes += textBytes;
      const count = countMatches(text, query, caseSensitive);
      if (count > 0) {
        matched = true;
        matchCount += count;
        if (stopAtFirstMatch) {
          return {
            matched,
            matchCount,
            scannedBytes,
            scannedEvents,
            truncated,
            timedOut
          };
        }
      }
    }
    if (truncated) {
      break;
    }
  }
  return {
    matched,
    matchCount,
    scannedBytes,
    scannedEvents,
    truncated,
    timedOut
  };
}
function extractSearchableTexts(line, roleFilter) {
  if (line.type === "event_msg") {
    const payload = asRecord(line.payload);
    if (payload === null) {
      return [];
    }
    const eventType = asString(payload["type"]);
    if (eventType === "UserMessage") {
      const message = asString(payload["message"]);
      return isRoleEnabled("user", roleFilter) && message !== undefined ? [message] : [];
    }
    if (eventType === "AgentMessage") {
      const message = asString(payload["message"]);
      return isRoleEnabled("assistant", roleFilter) && message !== undefined ? [message] : [];
    }
    if (eventType === "AgentReasoning") {
      const text = asString(payload["text"]);
      return isRoleEnabled("assistant", roleFilter) && text !== undefined ? [text] : [];
    }
    if (eventType === "TurnComplete") {
      const lastAgentMessage = asString(payload["last_agent_message"]);
      return isRoleEnabled("assistant", roleFilter) && lastAgentMessage !== undefined ? [lastAgentMessage] : [];
    }
    return [];
  }
  if (line.type === "response_item") {
    const payload = asRecord(line.payload);
    if (payload === null) {
      return [];
    }
    const itemType = asString(payload["type"]);
    if (itemType === "message") {
      const role = asString(payload["role"]);
      const text = extractResponseMessageText(payload["content"]);
      if (text === undefined) {
        return [];
      }
      if (role === "user" && isRoleEnabled("user", roleFilter)) {
        return [text];
      }
      if (role === "assistant" && isRoleEnabled("assistant", roleFilter)) {
        return [text];
      }
      return [];
    }
    if (itemType === "reasoning" && isRoleEnabled("assistant", roleFilter)) {
      const summary = payload["summary"];
      if (!Array.isArray(summary)) {
        return [];
      }
      const texts = [];
      for (const part of summary) {
        const entry = asRecord(part);
        const text = entry === null ? undefined : asString(entry["text"]);
        if (text !== undefined) {
          texts.push(text);
        }
      }
      return texts;
    }
  }
  return [];
}
function extractResponseMessageText(content) {
  if (!Array.isArray(content)) {
    return;
  }
  const parts = [];
  for (const raw of content) {
    const item = asRecord(raw);
    if (item === null) {
      continue;
    }
    const type = asString(item["type"]);
    const text = asString(item["text"]);
    if ((type === "input_text" || type === "output_text") && text !== undefined) {
      parts.push(text);
    }
  }
  if (parts.length === 0) {
    return;
  }
  return parts.join(`
`);
}
function isRoleEnabled(candidate, role) {
  return role === "both" || role === candidate;
}
function countMatches(text, query, caseSensitive) {
  const haystack = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  let count = 0;
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const idx = haystack.indexOf(needle, cursor);
    if (idx < 0) {
      break;
    }
    count += 1;
    cursor = idx + needle.length;
  }
  return count;
}
function normalizeQuery(query) {
  const normalized = query.trim();
  if (normalized === "") {
    throw new Error("query must not be empty");
  }
  return normalized;
}
function toBudget(options) {
  const deadlineAt = options?.timeoutMs !== undefined ? Date.now() + Math.max(0, options.timeoutMs) : undefined;
  return {
    maxBytes: normalizePositiveInt(options?.maxBytes),
    maxEvents: normalizePositiveInt(options?.maxEvents),
    deadlineAt
  };
}
function normalizePositiveInt(value) {
  if (value === undefined || !Number.isFinite(value)) {
    return;
  }
  return value > 0 ? Math.floor(value) : 0;
}
function asRecord(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value;
}
function asString(value) {
  return typeof value === "string" ? value : undefined;
}
function parseCandidateSessionMeta(meta) {
  const payload = asRecord(meta);
  const metaRecord = payload === null ? null : asRecord(payload["meta"]);
  if (metaRecord === null || payload === null) {
    return null;
  }
  const id = asString(metaRecord["id"]);
  if (id === undefined || id === "") {
    return null;
  }
  const git = asRecord(payload["git"]);
  const branch = git === null ? undefined : asString(git["branch"]);
  return {
    id,
    cwd: asString(metaRecord["cwd"]),
    source: asString(metaRecord["source"]),
    branch
  };
}
// src/rollout/watcher.ts
import { watch } from "fs";
import { open, stat as stat2 } from "fs/promises";
import { join as join3 } from "path";
import { EventEmitter } from "events";
var ROLLOUT_PREFIX2 = "rollout-";
var ROLLOUT_EXT2 = ".jsonl";
var DEBOUNCE_MS = 100;

class RolloutWatcher extends EventEmitter {
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
// src/group/repository.ts
import { readFile as readFile2, writeFile, mkdir, rename } from "fs/promises";
import { join as join4 } from "path";
import { homedir as homedir2 } from "os";
import { randomUUID } from "crypto";
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
  const tmpPath = path + ".tmp." + randomUUID().slice(0, 8);
  const json = JSON.stringify(config, null, 2) + `
`;
  await writeFile(tmpPath, json, "utf-8");
  await rename(tmpPath, path);
}
async function addGroup(name, description, configDir) {
  const config = await loadGroups(configDir);
  const now = new Date;
  const group = {
    id: randomUUID(),
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
// src/process/manager.ts
import { spawn } from "child_process";
import { createInterface as createInterface2 } from "readline";
import { randomUUID as randomUUID2 } from "crypto";
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
    const id = randomUUID2();
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
    const id = randomUUID2();
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
    const id = randomUUID2();
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
  return new Promise((resolve3) => {
    child.once("exit", (code) => {
      resolve3(code ?? 1);
    });
    child.once("error", () => {
      resolve3(1);
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
      if (sessionId === undefined)
        break;
      running.push(sessionId);
      const promise = (async () => {
        try {
          const result2 = await pm.spawnExec(prompt, {
            ...options,
            cwd: options?.cwd
          });
          return { sessionId, exitCode: result2.exitCode };
        } catch (_err) {
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
// src/queue/types.ts
var QUEUE_PROMPT_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed"
];
var QUEUE_COMMAND_MODES = ["auto", "manual"];
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
    mode: m.mode,
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
    mode: p.mode,
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
var ALL_PERMISSIONS = PERMISSIONS;
var DEFAULT_TOKEN_PERMISSIONS = [
  "session:read"
];
var PERMISSION_SET = new Set(PERMISSIONS);
function isPermission(value) {
  return PERMISSION_SET.has(value);
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
function parsePermissionList(input) {
  return normalizePermissions(input.split(","));
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
import {
  createHash,
  randomBytes,
  randomUUID as randomUUID6,
  timingSafeEqual
} from "crypto";
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
  const original = config.tokens[idx];
  if (original === undefined) {
    throw new Error(`unexpected: token at index ${idx} is undefined`);
  }
  const secret = randomBytes(24).toString("hex");
  const replacement = {
    ...original,
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
// src/file-changes/extractor.ts
var PATH_TOKEN_RE = /^(?:\/|\.{1,2}\/)?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
var BASH_LIKE = new Set(["bash", "sh", "zsh"]);
var NON_PATH_TOKENS = new Set([
  "apply_patch",
  "bash",
  "cat",
  "cp",
  "echo",
  "git",
  "mv",
  "perl",
  "printf",
  "rm",
  "sed",
  "sh",
  "tee",
  "touch",
  "zsh"
]);
var REDIRECTION_TOKENS = new Set([">", ">>", "1>", "1>>"]);
function toRecord3(value) {
  return typeof value === "object" && value !== null ? value : null;
}
function readString3(value) {
  return typeof value === "string" ? value : undefined;
}
function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function readStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}
function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
function normalizeCommand(command) {
  if (typeof command === "string") {
    return command;
  }
  if (command.length >= 3 && BASH_LIKE.has(command[0] ?? "") && (command[1] === "-lc" || command[1] === "-c")) {
    return command[2] ?? command.join(" ");
  }
  return command.join(" ");
}
function operationForCommand(command) {
  const normalized = command.trim().toLowerCase();
  if (normalized.includes("apply_patch")) {
    return "modified";
  }
  if (normalized.startsWith("touch ") || normalized.startsWith("cat >") || normalized.startsWith("echo >") || normalized.startsWith("printf >")) {
    return "created";
  }
  if (normalized.startsWith("rm ") || normalized.startsWith("git rm ")) {
    return "deleted";
  }
  if (normalized.startsWith("mv ") || normalized.startsWith("cp ") || normalized.startsWith("tee ") || normalized.startsWith("git mv ") || /\bsed\s+-i(?:\s|$)/.test(normalized) || /\bperl\b[\s\S]*\s-pi(?:\s|$)/.test(normalized) || /\b(?:cat|echo|printf)\b[\s\S]*>>?\s+\S+/.test(command)) {
    return "modified";
  }
  return null;
}
function extractFileTokens(command) {
  const tokens = command.split(/\s+/).map((token) => token.trim()).filter((token) => token.length > 0);
  return tokens.filter((token) => {
    if (!PATH_TOKEN_RE.test(token))
      return false;
    if (token.startsWith("-"))
      return false;
    if (token === "PATCH")
      return false;
    if (token === "EOF")
      return false;
    if (NON_PATH_TOKENS.has(token))
      return false;
    return true;
  });
}
function commandTokens(command) {
  return command.split(/\s+/).map((token) => token.trim()).filter((token) => token.length > 0);
}
function tokenizePaths(tokens) {
  return extractFileTokens(tokens.join(" "));
}
function buildCommandChange(path, timestamp, source, command, operation) {
  return {
    path,
    timestamp,
    operation,
    source,
    command
  };
}
function extractRedirectTarget(tokens) {
  for (let i = 0;i < tokens.length; i++) {
    const token = tokens[i];
    if (token === undefined) {
      continue;
    }
    if (REDIRECTION_TOKENS.has(token)) {
      const target = tokens[i + 1];
      const [path] = target === undefined ? [] : tokenizePaths([target]);
      return path === undefined ? undefined : {
        path,
        isAppend: token.includes(">>")
      };
    }
    const redirectMatch = token.match(/^(?:1)?(>>?)(.+)$/);
    if (redirectMatch?.[2] !== undefined) {
      const [path] = tokenizePaths([redirectMatch[2]]);
      return path === undefined ? undefined : {
        path,
        isAppend: redirectMatch[1] === ">>"
      };
    }
  }
  return;
}
function extractCommandLikeChanges(command, timestamp, source) {
  const tokens = commandTokens(command);
  const primary = tokens[0];
  if (primary === undefined) {
    return [];
  }
  if (primary === "cat" || primary === "echo" || primary === "printf") {
    const target = extractRedirectTarget(tokens);
    return target === undefined ? [] : [
      buildCommandChange(target.path, timestamp, source, command, target.isAppend ? "modified" : "created")
    ];
  }
  if (primary === "touch") {
    return tokenizePaths(tokens.slice(1)).map((path) => buildCommandChange(path, timestamp, source, command, "created"));
  }
  if (primary === "rm") {
    return tokenizePaths(tokens.slice(1)).map((path) => buildCommandChange(path, timestamp, source, command, "deleted"));
  }
  if (primary === "mv") {
    const paths = tokenizePaths(tokens.slice(1));
    if (paths.length < 2) {
      return [];
    }
    const sourcePath = paths[paths.length - 2];
    const targetPath = paths[paths.length - 1];
    if (sourcePath === undefined || targetPath === undefined) {
      return [];
    }
    return [
      buildCommandChange(sourcePath, timestamp, source, command, "deleted"),
      buildCommandChange(targetPath, timestamp, source, command, "modified")
    ];
  }
  if (primary === "cp") {
    const paths = tokenizePaths(tokens.slice(1));
    const targetPath = paths[paths.length - 1];
    return targetPath === undefined ? [] : [
      buildCommandChange(targetPath, timestamp, source, command, "modified")
    ];
  }
  if (primary === "tee") {
    return tokenizePaths(tokens.slice(1)).map((path) => buildCommandChange(path, timestamp, source, command, "modified"));
  }
  if (primary === "git") {
    const subcommand = tokens[1];
    if (subcommand === "rm") {
      return tokenizePaths(tokens.slice(2)).map((path) => buildCommandChange(path, timestamp, source, command, "deleted"));
    }
    if (subcommand === "mv") {
      const paths = tokenizePaths(tokens.slice(2));
      if (paths.length < 2) {
        return [];
      }
      const sourcePath = paths[paths.length - 2];
      const targetPath = paths[paths.length - 1];
      if (sourcePath === undefined || targetPath === undefined) {
        return [];
      }
      return [
        buildCommandChange(sourcePath, timestamp, source, command, "deleted"),
        buildCommandChange(targetPath, timestamp, source, command, "modified")
      ];
    }
  }
  if (/\bsed\s+-i(?:\s|$)/.test(command.toLowerCase()) || /\bperl\b[\s\S]*\s-pi(?:\s|$)/.test(command.toLowerCase())) {
    return tokenizePaths(tokens.slice(1)).map((path) => buildCommandChange(path, timestamp, source, command, "modified"));
  }
  return tokenizePaths(tokens).map((path) => buildCommandChange(path, timestamp, source, command, operationForCommand(command) ?? "modified"));
}
function extractPatchBlocks(command) {
  const matches = command.match(/\*\*\* Begin Patch[\s\S]*?\*\*\* End Patch/gm);
  return matches ?? [];
}
function parsePatchSections(patchText) {
  const lines = patchText.replaceAll(`\r
`, `
`).split(`
`);
  const sections = [];
  let currentOperation = null;
  let currentPath = null;
  let currentPreviousPath;
  let currentLines = [];
  function flush() {
    if (currentOperation === null || currentPath === null || currentLines.length === 0) {
      return;
    }
    sections.push({
      path: currentPath,
      operation: currentOperation,
      patch: currentLines.join(`
`).trimEnd(),
      ...currentPreviousPath !== undefined ? { previousPath: currentPreviousPath } : {}
    });
  }
  for (const line of lines) {
    if (line.startsWith("*** Update File: ")) {
      flush();
      currentOperation = "modified";
      currentPath = line.slice("*** Update File: ".length).trim();
      currentPreviousPath = undefined;
      currentLines = [line];
      continue;
    }
    if (line.startsWith("*** Add File: ")) {
      flush();
      currentOperation = "created";
      currentPath = line.slice("*** Add File: ".length).trim();
      currentPreviousPath = undefined;
      currentLines = [line];
      continue;
    }
    if (line.startsWith("*** Delete File: ")) {
      flush();
      currentOperation = "deleted";
      currentPath = line.slice("*** Delete File: ".length).trim();
      currentPreviousPath = undefined;
      currentLines = [line];
      continue;
    }
    if (currentPath === null) {
      continue;
    }
    if (line.startsWith("*** Move to: ")) {
      currentPreviousPath = currentPath;
      currentPath = line.slice("*** Move to: ".length).trim();
    }
    currentLines.push(line);
  }
  flush();
  return sections.filter((section) => section.path.length > 0);
}
function changesFromPatchBlocks(patchBlocks, timestamp, command) {
  const changes = [];
  for (const block of patchBlocks) {
    for (const section of parsePatchSections(block)) {
      changes.push({
        path: section.path,
        timestamp,
        operation: section.operation,
        source: "apply_patch",
        ...command !== undefined ? { command } : {},
        patch: section.patch,
        ...section.previousPath !== undefined ? { previousPath: section.previousPath } : {}
      });
    }
  }
  return changes;
}
function extractChangesFromCommand(command, timestamp, source) {
  const patchBlocks = extractPatchBlocks(command);
  if (patchBlocks.length > 0) {
    return changesFromPatchBlocks(patchBlocks, timestamp, command);
  }
  const operation = operationForCommand(command);
  if (operation === null) {
    return [];
  }
  return extractCommandLikeChanges(command, timestamp, source);
}
function extractToolCallChanges(line) {
  if (!isResponseItem(line)) {
    return null;
  }
  const payload = toRecord3(line.payload);
  if (payload === null) {
    return null;
  }
  const itemType = readString3(payload["type"]);
  if (itemType === "function_call") {
    const callId = readString3(payload["call_id"]);
    const name = readString3(payload["name"]);
    const rawArgs = parseMaybeJson(readString3(payload["arguments"]));
    const args = toRecord3(rawArgs);
    if (name === "shell") {
      const command = args === null ? undefined : readStringArray(args["command"]);
      if (command === undefined) {
        return null;
      }
      return {
        ...callId !== undefined ? { callId } : {},
        changes: extractChangesFromCommand(normalizeCommand(command), line.timestamp, "shell")
      };
    }
    if (name === "exec_command") {
      const command = args === null ? undefined : readString3(args["cmd"]);
      if (command === undefined) {
        return null;
      }
      return {
        ...callId !== undefined ? { callId } : {},
        changes: extractChangesFromCommand(command, line.timestamp, "exec_command")
      };
    }
    if (name === "apply_patch") {
      const patchText = args !== null ? readString3(args["patch"]) ?? readString3(args["input"]) : readString3(payload["arguments"]);
      if (patchText === undefined) {
        return null;
      }
      return {
        ...callId !== undefined ? { callId } : {},
        changes: changesFromPatchBlocks([patchText], line.timestamp)
      };
    }
    return null;
  }
  if (itemType === "local_shell_call") {
    const action = toRecord3(payload["action"]);
    const command = action === null ? undefined : readStringArray(action["command"]);
    if (command === undefined) {
      return null;
    }
    const callId = readString3(payload["call_id"]);
    return {
      ...callId !== undefined ? { callId } : {},
      changes: extractChangesFromCommand(normalizeCommand(command), line.timestamp, "local_shell")
    };
  }
  if (itemType === "custom_tool_call") {
    const name = readString3(payload["name"]);
    const status = readString3(payload["status"]);
    if (name !== "apply_patch" || status !== undefined && status !== "completed") {
      return null;
    }
    const input = readString3(payload["input"]);
    if (input === undefined) {
      return null;
    }
    return {
      changes: changesFromPatchBlocks([input], line.timestamp)
    };
  }
  return null;
}
function extractExecBeginChanges(line) {
  if (!isEventMsg(line)) {
    return null;
  }
  if (line.payload.type !== "ExecCommandBegin") {
    return null;
  }
  const payload = toRecord3(line.payload);
  const command = payload === null ? undefined : readStringArray(payload["command"]);
  const callId = payload === null ? undefined : readString3(payload["call_id"]);
  if (command === undefined) {
    return null;
  }
  return {
    changes: extractChangesFromCommand(normalizeCommand(command), line.timestamp, "local_shell"),
    ...callId !== undefined ? { callId } : {}
  };
}
function isSuccessfulToolResult(line) {
  if (isEventMsg(line) && line.payload.type === "ExecCommandEnd") {
    const payload2 = toRecord3(line.payload);
    const callId = payload2 === null ? undefined : readString3(payload2["call_id"]);
    const exitCode = payload2 === null ? undefined : readNumber(payload2["exit_code"]);
    if (callId === undefined) {
      return null;
    }
    return {
      callId,
      success: exitCode === 0
    };
  }
  if (!isResponseItem(line)) {
    return null;
  }
  const payload = toRecord3(line.payload);
  if (payload === null) {
    return null;
  }
  const itemType = readString3(payload["type"]);
  if (itemType === "function_call_output") {
    const callId = readString3(payload["call_id"]);
    if (callId === undefined) {
      return null;
    }
    const output = parseMaybeJson(payload["output"]);
    const outputRecord = toRecord3(output);
    const metadata = outputRecord === null ? null : toRecord3(outputRecord["metadata"]);
    const exitCode = (metadata === null ? undefined : readNumber(metadata["exit_code"])) ?? (outputRecord === null ? undefined : readNumber(outputRecord["exit_code"]));
    const status = outputRecord === null ? undefined : readString3(outputRecord["status"]);
    const isError = outputRecord === null ? false : outputRecord["is_error"] === true;
    return {
      callId,
      success: !isError && (status === undefined || status !== "error" && status !== "failed") && (exitCode === undefined || exitCode === 0)
    };
  }
  if (itemType === "local_shell_call") {
    const callId = readString3(payload["call_id"]);
    const status = readString3(payload["status"]);
    if (callId === undefined || status === undefined) {
      return null;
    }
    if (status === "completed") {
      return { callId, success: true };
    }
    if (status === "failed" || status === "error") {
      return { callId, success: false };
    }
  }
  return null;
}
function extractFileChangeDetails(lines) {
  const changes = [];
  const pending = new Map;
  for (const line of lines) {
    const immediate = extractToolCallChanges(line);
    if (immediate !== null) {
      const callId = immediate.callId;
      if (callId === undefined) {
        changes.push(...immediate.changes);
      } else if (immediate.changes.length > 0) {
        pending.set(callId, immediate);
      }
    }
    const execBegin = extractExecBeginChanges(line);
    if (execBegin !== null && execBegin.callId !== undefined && execBegin.changes.length > 0) {
      pending.set(execBegin.callId, execBegin);
    }
    const result = isSuccessfulToolResult(line);
    if (result === null) {
      continue;
    }
    const matched = pending.get(result.callId);
    if (matched === undefined) {
      continue;
    }
    pending.delete(result.callId);
    if (result.success) {
      changes.push(...matched.changes);
    }
  }
  return changes.sort((a, b) => {
    const timeCompare = a.timestamp.localeCompare(b.timestamp);
    if (timeCompare !== 0) {
      return timeCompare;
    }
    return a.path.localeCompare(b.path);
  });
}
function extractChangedFiles(lines) {
  const map = new Map;
  for (const change of extractFileChangeDetails(lines)) {
    if (change.previousPath !== undefined && change.previousPath !== change.path) {
      const previousPath = map.get(change.previousPath);
      map.set(change.previousPath, {
        path: change.previousPath,
        operation: "deleted",
        changeCount: (previousPath?.changeCount ?? 0) + 1,
        lastModified: change.timestamp
      });
    }
    const previous = map.get(change.path);
    if (previous === undefined) {
      map.set(change.path, {
        path: change.path,
        operation: change.operation,
        changeCount: 1,
        lastModified: change.timestamp
      });
      continue;
    }
    map.set(change.path, {
      path: previous.path,
      operation: change.operation,
      changeCount: previous.changeCount + 1,
      lastModified: change.timestamp
    });
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
function toPatchHistory(sessionId, changes) {
  const grouped = new Map;
  function addChange(path, change) {
    const existing = grouped.get(path);
    const entry = path === change.path ? change : {
      ...change,
      path,
      operation: "deleted"
    };
    if (existing === undefined) {
      grouped.set(path, [entry]);
      return;
    }
    existing.push(entry);
  }
  for (const change of changes) {
    addChange(change.path, change);
    if (change.previousPath !== undefined && change.previousPath !== change.path) {
      addChange(change.previousPath, change);
    }
  }
  const files = Array.from(grouped.entries()).map(([path, entries]) => {
    entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const last = entries[entries.length - 1];
    if (last === undefined) {
      throw new Error(`missing file change entries for path: ${path}`);
    }
    return {
      path,
      operation: last.operation,
      changeCount: entries.length,
      lastModified: last.timestamp,
      changes: entries
    };
  }).sort((a, b) => a.path.localeCompare(b.path));
  return {
    sessionId,
    files,
    totalFiles: files.length,
    totalChanges: files.reduce((count, file) => count + file.changeCount, 0)
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
async function getSessionFilePatchHistory(sessionId, options) {
  const session = await findSession(sessionId, options?.codexHome);
  if (session === null) {
    throw new Error(`session not found: ${sessionId}`);
  }
  const lines = await readRollout(session.rolloutPath);
  const changes = extractFileChangeDetails(lines);
  return toPatchHistory(sessionId, changes);
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
// node_modules/graphql/jsutils/devAssert.mjs
function devAssert(condition, message) {
  const booleanCondition = Boolean(condition);
  if (!booleanCondition) {
    throw new Error(message);
  }
}

// node_modules/graphql/jsutils/isPromise.mjs
function isPromise(value) {
  return typeof (value === null || value === undefined ? undefined : value.then) === "function";
}

// node_modules/graphql/jsutils/isObjectLike.mjs
function isObjectLike(value) {
  return typeof value == "object" && value !== null;
}

// node_modules/graphql/jsutils/invariant.mjs
function invariant(condition, message) {
  const booleanCondition = Boolean(condition);
  if (!booleanCondition) {
    throw new Error(message != null ? message : "Unexpected invariant triggered.");
  }
}

// node_modules/graphql/language/location.mjs
var LineRegExp = /\r\n|[\n\r]/g;
function getLocation(source, position) {
  let lastLineStart = 0;
  let line = 1;
  for (const match of source.body.matchAll(LineRegExp)) {
    typeof match.index === "number" || invariant(false);
    if (match.index >= position) {
      break;
    }
    lastLineStart = match.index + match[0].length;
    line += 1;
  }
  return {
    line,
    column: position + 1 - lastLineStart
  };
}

// node_modules/graphql/language/printLocation.mjs
function printLocation(location) {
  return printSourceLocation(location.source, getLocation(location.source, location.start));
}
function printSourceLocation(source, sourceLocation) {
  const firstLineColumnOffset = source.locationOffset.column - 1;
  const body = "".padStart(firstLineColumnOffset) + source.body;
  const lineIndex = sourceLocation.line - 1;
  const lineOffset = source.locationOffset.line - 1;
  const lineNum = sourceLocation.line + lineOffset;
  const columnOffset = sourceLocation.line === 1 ? firstLineColumnOffset : 0;
  const columnNum = sourceLocation.column + columnOffset;
  const locationStr = `${source.name}:${lineNum}:${columnNum}
`;
  const lines = body.split(/\r\n|[\n\r]/g);
  const locationLine = lines[lineIndex];
  if (locationLine.length > 120) {
    const subLineIndex = Math.floor(columnNum / 80);
    const subLineColumnNum = columnNum % 80;
    const subLines = [];
    for (let i = 0;i < locationLine.length; i += 80) {
      subLines.push(locationLine.slice(i, i + 80));
    }
    return locationStr + printPrefixedLines([
      [`${lineNum} |`, subLines[0]],
      ...subLines.slice(1, subLineIndex + 1).map((subLine) => ["|", subLine]),
      ["|", "^".padStart(subLineColumnNum)],
      ["|", subLines[subLineIndex + 1]]
    ]);
  }
  return locationStr + printPrefixedLines([
    [`${lineNum - 1} |`, lines[lineIndex - 1]],
    [`${lineNum} |`, locationLine],
    ["|", "^".padStart(columnNum)],
    [`${lineNum + 1} |`, lines[lineIndex + 1]]
  ]);
}
function printPrefixedLines(lines) {
  const existingLines = lines.filter(([_, line]) => line !== undefined);
  const padLen = Math.max(...existingLines.map(([prefix]) => prefix.length));
  return existingLines.map(([prefix, line]) => prefix.padStart(padLen) + (line ? " " + line : "")).join(`
`);
}

// node_modules/graphql/error/GraphQLError.mjs
function toNormalizedOptions(args) {
  const firstArg = args[0];
  if (firstArg == null || "kind" in firstArg || "length" in firstArg) {
    return {
      nodes: firstArg,
      source: args[1],
      positions: args[2],
      path: args[3],
      originalError: args[4],
      extensions: args[5]
    };
  }
  return firstArg;
}

class GraphQLError extends Error {
  constructor(message, ...rawArgs) {
    var _this$nodes, _nodeLocations$, _ref;
    const { nodes, source, positions, path, originalError, extensions } = toNormalizedOptions(rawArgs);
    super(message);
    this.name = "GraphQLError";
    this.path = path !== null && path !== undefined ? path : undefined;
    this.originalError = originalError !== null && originalError !== undefined ? originalError : undefined;
    this.nodes = undefinedIfEmpty(Array.isArray(nodes) ? nodes : nodes ? [nodes] : undefined);
    const nodeLocations = undefinedIfEmpty((_this$nodes = this.nodes) === null || _this$nodes === undefined ? undefined : _this$nodes.map((node) => node.loc).filter((loc) => loc != null));
    this.source = source !== null && source !== undefined ? source : nodeLocations === null || nodeLocations === undefined ? undefined : (_nodeLocations$ = nodeLocations[0]) === null || _nodeLocations$ === undefined ? undefined : _nodeLocations$.source;
    this.positions = positions !== null && positions !== undefined ? positions : nodeLocations === null || nodeLocations === undefined ? undefined : nodeLocations.map((loc) => loc.start);
    this.locations = positions && source ? positions.map((pos) => getLocation(source, pos)) : nodeLocations === null || nodeLocations === undefined ? undefined : nodeLocations.map((loc) => getLocation(loc.source, loc.start));
    const originalExtensions = isObjectLike(originalError === null || originalError === undefined ? undefined : originalError.extensions) ? originalError === null || originalError === undefined ? undefined : originalError.extensions : undefined;
    this.extensions = (_ref = extensions !== null && extensions !== undefined ? extensions : originalExtensions) !== null && _ref !== undefined ? _ref : Object.create(null);
    Object.defineProperties(this, {
      message: {
        writable: true,
        enumerable: true
      },
      name: {
        enumerable: false
      },
      nodes: {
        enumerable: false
      },
      source: {
        enumerable: false
      },
      positions: {
        enumerable: false
      },
      originalError: {
        enumerable: false
      }
    });
    if (originalError !== null && originalError !== undefined && originalError.stack) {
      Object.defineProperty(this, "stack", {
        value: originalError.stack,
        writable: true,
        configurable: true
      });
    } else if (Error.captureStackTrace) {
      Error.captureStackTrace(this, GraphQLError);
    } else {
      Object.defineProperty(this, "stack", {
        value: Error().stack,
        writable: true,
        configurable: true
      });
    }
  }
  get [Symbol.toStringTag]() {
    return "GraphQLError";
  }
  toString() {
    let output = this.message;
    if (this.nodes) {
      for (const node of this.nodes) {
        if (node.loc) {
          output += `

` + printLocation(node.loc);
        }
      }
    } else if (this.source && this.locations) {
      for (const location of this.locations) {
        output += `

` + printSourceLocation(this.source, location);
      }
    }
    return output;
  }
  toJSON() {
    const formattedError = {
      message: this.message
    };
    if (this.locations != null) {
      formattedError.locations = this.locations;
    }
    if (this.path != null) {
      formattedError.path = this.path;
    }
    if (this.extensions != null && Object.keys(this.extensions).length > 0) {
      formattedError.extensions = this.extensions;
    }
    return formattedError;
  }
}
function undefinedIfEmpty(array) {
  return array === undefined || array.length === 0 ? undefined : array;
}

// node_modules/graphql/error/syntaxError.mjs
function syntaxError(source, position, description) {
  return new GraphQLError(`Syntax Error: ${description}`, {
    source,
    positions: [position]
  });
}

// node_modules/graphql/language/ast.mjs
class Location {
  constructor(startToken, endToken, source) {
    this.start = startToken.start;
    this.end = endToken.end;
    this.startToken = startToken;
    this.endToken = endToken;
    this.source = source;
  }
  get [Symbol.toStringTag]() {
    return "Location";
  }
  toJSON() {
    return {
      start: this.start,
      end: this.end
    };
  }
}

class Token {
  constructor(kind, start, end, line, column, value) {
    this.kind = kind;
    this.start = start;
    this.end = end;
    this.line = line;
    this.column = column;
    this.value = value;
    this.prev = null;
    this.next = null;
  }
  get [Symbol.toStringTag]() {
    return "Token";
  }
  toJSON() {
    return {
      kind: this.kind,
      value: this.value,
      line: this.line,
      column: this.column
    };
  }
}
var QueryDocumentKeys = {
  Name: [],
  Document: ["definitions"],
  OperationDefinition: [
    "description",
    "name",
    "variableDefinitions",
    "directives",
    "selectionSet"
  ],
  VariableDefinition: [
    "description",
    "variable",
    "type",
    "defaultValue",
    "directives"
  ],
  Variable: ["name"],
  SelectionSet: ["selections"],
  Field: ["alias", "name", "arguments", "directives", "selectionSet"],
  Argument: ["name", "value"],
  FragmentSpread: ["name", "directives"],
  InlineFragment: ["typeCondition", "directives", "selectionSet"],
  FragmentDefinition: [
    "description",
    "name",
    "variableDefinitions",
    "typeCondition",
    "directives",
    "selectionSet"
  ],
  IntValue: [],
  FloatValue: [],
  StringValue: [],
  BooleanValue: [],
  NullValue: [],
  EnumValue: [],
  ListValue: ["values"],
  ObjectValue: ["fields"],
  ObjectField: ["name", "value"],
  Directive: ["name", "arguments"],
  NamedType: ["name"],
  ListType: ["type"],
  NonNullType: ["type"],
  SchemaDefinition: ["description", "directives", "operationTypes"],
  OperationTypeDefinition: ["type"],
  ScalarTypeDefinition: ["description", "name", "directives"],
  ObjectTypeDefinition: [
    "description",
    "name",
    "interfaces",
    "directives",
    "fields"
  ],
  FieldDefinition: ["description", "name", "arguments", "type", "directives"],
  InputValueDefinition: [
    "description",
    "name",
    "type",
    "defaultValue",
    "directives"
  ],
  InterfaceTypeDefinition: [
    "description",
    "name",
    "interfaces",
    "directives",
    "fields"
  ],
  UnionTypeDefinition: ["description", "name", "directives", "types"],
  EnumTypeDefinition: ["description", "name", "directives", "values"],
  EnumValueDefinition: ["description", "name", "directives"],
  InputObjectTypeDefinition: ["description", "name", "directives", "fields"],
  DirectiveDefinition: ["description", "name", "arguments", "locations"],
  SchemaExtension: ["directives", "operationTypes"],
  ScalarTypeExtension: ["name", "directives"],
  ObjectTypeExtension: ["name", "interfaces", "directives", "fields"],
  InterfaceTypeExtension: ["name", "interfaces", "directives", "fields"],
  UnionTypeExtension: ["name", "directives", "types"],
  EnumTypeExtension: ["name", "directives", "values"],
  InputObjectTypeExtension: ["name", "directives", "fields"],
  TypeCoordinate: ["name"],
  MemberCoordinate: ["name", "memberName"],
  ArgumentCoordinate: ["name", "fieldName", "argumentName"],
  DirectiveCoordinate: ["name"],
  DirectiveArgumentCoordinate: ["name", "argumentName"]
};
var kindValues = new Set(Object.keys(QueryDocumentKeys));
function isNode(maybeNode) {
  const maybeKind = maybeNode === null || maybeNode === undefined ? undefined : maybeNode.kind;
  return typeof maybeKind === "string" && kindValues.has(maybeKind);
}
var OperationTypeNode;
(function(OperationTypeNode2) {
  OperationTypeNode2["QUERY"] = "query";
  OperationTypeNode2["MUTATION"] = "mutation";
  OperationTypeNode2["SUBSCRIPTION"] = "subscription";
})(OperationTypeNode || (OperationTypeNode = {}));

// node_modules/graphql/language/directiveLocation.mjs
var DirectiveLocation;
(function(DirectiveLocation2) {
  DirectiveLocation2["QUERY"] = "QUERY";
  DirectiveLocation2["MUTATION"] = "MUTATION";
  DirectiveLocation2["SUBSCRIPTION"] = "SUBSCRIPTION";
  DirectiveLocation2["FIELD"] = "FIELD";
  DirectiveLocation2["FRAGMENT_DEFINITION"] = "FRAGMENT_DEFINITION";
  DirectiveLocation2["FRAGMENT_SPREAD"] = "FRAGMENT_SPREAD";
  DirectiveLocation2["INLINE_FRAGMENT"] = "INLINE_FRAGMENT";
  DirectiveLocation2["VARIABLE_DEFINITION"] = "VARIABLE_DEFINITION";
  DirectiveLocation2["SCHEMA"] = "SCHEMA";
  DirectiveLocation2["SCALAR"] = "SCALAR";
  DirectiveLocation2["OBJECT"] = "OBJECT";
  DirectiveLocation2["FIELD_DEFINITION"] = "FIELD_DEFINITION";
  DirectiveLocation2["ARGUMENT_DEFINITION"] = "ARGUMENT_DEFINITION";
  DirectiveLocation2["INTERFACE"] = "INTERFACE";
  DirectiveLocation2["UNION"] = "UNION";
  DirectiveLocation2["ENUM"] = "ENUM";
  DirectiveLocation2["ENUM_VALUE"] = "ENUM_VALUE";
  DirectiveLocation2["INPUT_OBJECT"] = "INPUT_OBJECT";
  DirectiveLocation2["INPUT_FIELD_DEFINITION"] = "INPUT_FIELD_DEFINITION";
})(DirectiveLocation || (DirectiveLocation = {}));

// node_modules/graphql/language/kinds.mjs
var Kind;
(function(Kind2) {
  Kind2["NAME"] = "Name";
  Kind2["DOCUMENT"] = "Document";
  Kind2["OPERATION_DEFINITION"] = "OperationDefinition";
  Kind2["VARIABLE_DEFINITION"] = "VariableDefinition";
  Kind2["SELECTION_SET"] = "SelectionSet";
  Kind2["FIELD"] = "Field";
  Kind2["ARGUMENT"] = "Argument";
  Kind2["FRAGMENT_SPREAD"] = "FragmentSpread";
  Kind2["INLINE_FRAGMENT"] = "InlineFragment";
  Kind2["FRAGMENT_DEFINITION"] = "FragmentDefinition";
  Kind2["VARIABLE"] = "Variable";
  Kind2["INT"] = "IntValue";
  Kind2["FLOAT"] = "FloatValue";
  Kind2["STRING"] = "StringValue";
  Kind2["BOOLEAN"] = "BooleanValue";
  Kind2["NULL"] = "NullValue";
  Kind2["ENUM"] = "EnumValue";
  Kind2["LIST"] = "ListValue";
  Kind2["OBJECT"] = "ObjectValue";
  Kind2["OBJECT_FIELD"] = "ObjectField";
  Kind2["DIRECTIVE"] = "Directive";
  Kind2["NAMED_TYPE"] = "NamedType";
  Kind2["LIST_TYPE"] = "ListType";
  Kind2["NON_NULL_TYPE"] = "NonNullType";
  Kind2["SCHEMA_DEFINITION"] = "SchemaDefinition";
  Kind2["OPERATION_TYPE_DEFINITION"] = "OperationTypeDefinition";
  Kind2["SCALAR_TYPE_DEFINITION"] = "ScalarTypeDefinition";
  Kind2["OBJECT_TYPE_DEFINITION"] = "ObjectTypeDefinition";
  Kind2["FIELD_DEFINITION"] = "FieldDefinition";
  Kind2["INPUT_VALUE_DEFINITION"] = "InputValueDefinition";
  Kind2["INTERFACE_TYPE_DEFINITION"] = "InterfaceTypeDefinition";
  Kind2["UNION_TYPE_DEFINITION"] = "UnionTypeDefinition";
  Kind2["ENUM_TYPE_DEFINITION"] = "EnumTypeDefinition";
  Kind2["ENUM_VALUE_DEFINITION"] = "EnumValueDefinition";
  Kind2["INPUT_OBJECT_TYPE_DEFINITION"] = "InputObjectTypeDefinition";
  Kind2["DIRECTIVE_DEFINITION"] = "DirectiveDefinition";
  Kind2["SCHEMA_EXTENSION"] = "SchemaExtension";
  Kind2["SCALAR_TYPE_EXTENSION"] = "ScalarTypeExtension";
  Kind2["OBJECT_TYPE_EXTENSION"] = "ObjectTypeExtension";
  Kind2["INTERFACE_TYPE_EXTENSION"] = "InterfaceTypeExtension";
  Kind2["UNION_TYPE_EXTENSION"] = "UnionTypeExtension";
  Kind2["ENUM_TYPE_EXTENSION"] = "EnumTypeExtension";
  Kind2["INPUT_OBJECT_TYPE_EXTENSION"] = "InputObjectTypeExtension";
  Kind2["TYPE_COORDINATE"] = "TypeCoordinate";
  Kind2["MEMBER_COORDINATE"] = "MemberCoordinate";
  Kind2["ARGUMENT_COORDINATE"] = "ArgumentCoordinate";
  Kind2["DIRECTIVE_COORDINATE"] = "DirectiveCoordinate";
  Kind2["DIRECTIVE_ARGUMENT_COORDINATE"] = "DirectiveArgumentCoordinate";
})(Kind || (Kind = {}));

// node_modules/graphql/language/characterClasses.mjs
function isWhiteSpace(code) {
  return code === 9 || code === 32;
}
function isDigit(code) {
  return code >= 48 && code <= 57;
}
function isLetter(code) {
  return code >= 97 && code <= 122 || code >= 65 && code <= 90;
}
function isNameStart(code) {
  return isLetter(code) || code === 95;
}
function isNameContinue(code) {
  return isLetter(code) || isDigit(code) || code === 95;
}

// node_modules/graphql/language/blockString.mjs
function dedentBlockStringLines(lines) {
  var _firstNonEmptyLine2;
  let commonIndent = Number.MAX_SAFE_INTEGER;
  let firstNonEmptyLine = null;
  let lastNonEmptyLine = -1;
  for (let i = 0;i < lines.length; ++i) {
    var _firstNonEmptyLine;
    const line = lines[i];
    const indent = leadingWhitespace(line);
    if (indent === line.length) {
      continue;
    }
    firstNonEmptyLine = (_firstNonEmptyLine = firstNonEmptyLine) !== null && _firstNonEmptyLine !== undefined ? _firstNonEmptyLine : i;
    lastNonEmptyLine = i;
    if (i !== 0 && indent < commonIndent) {
      commonIndent = indent;
    }
  }
  return lines.map((line, i) => i === 0 ? line : line.slice(commonIndent)).slice((_firstNonEmptyLine2 = firstNonEmptyLine) !== null && _firstNonEmptyLine2 !== undefined ? _firstNonEmptyLine2 : 0, lastNonEmptyLine + 1);
}
function leadingWhitespace(str) {
  let i = 0;
  while (i < str.length && isWhiteSpace(str.charCodeAt(i))) {
    ++i;
  }
  return i;
}
function printBlockString(value, options) {
  const escapedValue = value.replace(/"""/g, '\\"""');
  const lines = escapedValue.split(/\r\n|[\n\r]/g);
  const isSingleLine = lines.length === 1;
  const forceLeadingNewLine = lines.length > 1 && lines.slice(1).every((line) => line.length === 0 || isWhiteSpace(line.charCodeAt(0)));
  const hasTrailingTripleQuotes = escapedValue.endsWith('\\"""');
  const hasTrailingQuote = value.endsWith('"') && !hasTrailingTripleQuotes;
  const hasTrailingSlash = value.endsWith("\\");
  const forceTrailingNewline = hasTrailingQuote || hasTrailingSlash;
  const printAsMultipleLines = !(options !== null && options !== undefined && options.minimize) && (!isSingleLine || value.length > 70 || forceTrailingNewline || forceLeadingNewLine || hasTrailingTripleQuotes);
  let result = "";
  const skipLeadingNewLine = isSingleLine && isWhiteSpace(value.charCodeAt(0));
  if (printAsMultipleLines && !skipLeadingNewLine || forceLeadingNewLine) {
    result += `
`;
  }
  result += escapedValue;
  if (printAsMultipleLines || forceTrailingNewline) {
    result += `
`;
  }
  return '"""' + result + '"""';
}

// node_modules/graphql/language/tokenKind.mjs
var TokenKind;
(function(TokenKind2) {
  TokenKind2["SOF"] = "<SOF>";
  TokenKind2["EOF"] = "<EOF>";
  TokenKind2["BANG"] = "!";
  TokenKind2["DOLLAR"] = "$";
  TokenKind2["AMP"] = "&";
  TokenKind2["PAREN_L"] = "(";
  TokenKind2["PAREN_R"] = ")";
  TokenKind2["DOT"] = ".";
  TokenKind2["SPREAD"] = "...";
  TokenKind2["COLON"] = ":";
  TokenKind2["EQUALS"] = "=";
  TokenKind2["AT"] = "@";
  TokenKind2["BRACKET_L"] = "[";
  TokenKind2["BRACKET_R"] = "]";
  TokenKind2["BRACE_L"] = "{";
  TokenKind2["PIPE"] = "|";
  TokenKind2["BRACE_R"] = "}";
  TokenKind2["NAME"] = "Name";
  TokenKind2["INT"] = "Int";
  TokenKind2["FLOAT"] = "Float";
  TokenKind2["STRING"] = "String";
  TokenKind2["BLOCK_STRING"] = "BlockString";
  TokenKind2["COMMENT"] = "Comment";
})(TokenKind || (TokenKind = {}));

// node_modules/graphql/language/lexer.mjs
class Lexer {
  constructor(source) {
    const startOfFileToken = new Token(TokenKind.SOF, 0, 0, 0, 0);
    this.source = source;
    this.lastToken = startOfFileToken;
    this.token = startOfFileToken;
    this.line = 1;
    this.lineStart = 0;
  }
  get [Symbol.toStringTag]() {
    return "Lexer";
  }
  advance() {
    this.lastToken = this.token;
    const token = this.token = this.lookahead();
    return token;
  }
  lookahead() {
    let token = this.token;
    if (token.kind !== TokenKind.EOF) {
      do {
        if (token.next) {
          token = token.next;
        } else {
          const nextToken = readNextToken(this, token.end);
          token.next = nextToken;
          nextToken.prev = token;
          token = nextToken;
        }
      } while (token.kind === TokenKind.COMMENT);
    }
    return token;
  }
}
function isPunctuatorTokenKind(kind) {
  return kind === TokenKind.BANG || kind === TokenKind.DOLLAR || kind === TokenKind.AMP || kind === TokenKind.PAREN_L || kind === TokenKind.PAREN_R || kind === TokenKind.DOT || kind === TokenKind.SPREAD || kind === TokenKind.COLON || kind === TokenKind.EQUALS || kind === TokenKind.AT || kind === TokenKind.BRACKET_L || kind === TokenKind.BRACKET_R || kind === TokenKind.BRACE_L || kind === TokenKind.PIPE || kind === TokenKind.BRACE_R;
}
function isUnicodeScalarValue(code) {
  return code >= 0 && code <= 55295 || code >= 57344 && code <= 1114111;
}
function isSupplementaryCodePoint(body, location) {
  return isLeadingSurrogate(body.charCodeAt(location)) && isTrailingSurrogate(body.charCodeAt(location + 1));
}
function isLeadingSurrogate(code) {
  return code >= 55296 && code <= 56319;
}
function isTrailingSurrogate(code) {
  return code >= 56320 && code <= 57343;
}
function printCodePointAt(lexer, location) {
  const code = lexer.source.body.codePointAt(location);
  if (code === undefined) {
    return TokenKind.EOF;
  } else if (code >= 32 && code <= 126) {
    const char = String.fromCodePoint(code);
    return char === '"' ? `'"'` : `"${char}"`;
  }
  return "U+" + code.toString(16).toUpperCase().padStart(4, "0");
}
function createToken2(lexer, kind, start, end, value) {
  const line = lexer.line;
  const col = 1 + start - lexer.lineStart;
  return new Token(kind, start, end, line, col, value);
}
function readNextToken(lexer, start) {
  const body = lexer.source.body;
  const bodyLength = body.length;
  let position = start;
  while (position < bodyLength) {
    const code = body.charCodeAt(position);
    switch (code) {
      case 65279:
      case 9:
      case 32:
      case 44:
        ++position;
        continue;
      case 10:
        ++position;
        ++lexer.line;
        lexer.lineStart = position;
        continue;
      case 13:
        if (body.charCodeAt(position + 1) === 10) {
          position += 2;
        } else {
          ++position;
        }
        ++lexer.line;
        lexer.lineStart = position;
        continue;
      case 35:
        return readComment(lexer, position);
      case 33:
        return createToken2(lexer, TokenKind.BANG, position, position + 1);
      case 36:
        return createToken2(lexer, TokenKind.DOLLAR, position, position + 1);
      case 38:
        return createToken2(lexer, TokenKind.AMP, position, position + 1);
      case 40:
        return createToken2(lexer, TokenKind.PAREN_L, position, position + 1);
      case 41:
        return createToken2(lexer, TokenKind.PAREN_R, position, position + 1);
      case 46:
        if (body.charCodeAt(position + 1) === 46 && body.charCodeAt(position + 2) === 46) {
          return createToken2(lexer, TokenKind.SPREAD, position, position + 3);
        }
        break;
      case 58:
        return createToken2(lexer, TokenKind.COLON, position, position + 1);
      case 61:
        return createToken2(lexer, TokenKind.EQUALS, position, position + 1);
      case 64:
        return createToken2(lexer, TokenKind.AT, position, position + 1);
      case 91:
        return createToken2(lexer, TokenKind.BRACKET_L, position, position + 1);
      case 93:
        return createToken2(lexer, TokenKind.BRACKET_R, position, position + 1);
      case 123:
        return createToken2(lexer, TokenKind.BRACE_L, position, position + 1);
      case 124:
        return createToken2(lexer, TokenKind.PIPE, position, position + 1);
      case 125:
        return createToken2(lexer, TokenKind.BRACE_R, position, position + 1);
      case 34:
        if (body.charCodeAt(position + 1) === 34 && body.charCodeAt(position + 2) === 34) {
          return readBlockString(lexer, position);
        }
        return readString4(lexer, position);
    }
    if (isDigit(code) || code === 45) {
      return readNumber2(lexer, position, code);
    }
    if (isNameStart(code)) {
      return readName(lexer, position);
    }
    throw syntaxError(lexer.source, position, code === 39 ? `Unexpected single quote character ('), did you mean to use a double quote (")?` : isUnicodeScalarValue(code) || isSupplementaryCodePoint(body, position) ? `Unexpected character: ${printCodePointAt(lexer, position)}.` : `Invalid character: ${printCodePointAt(lexer, position)}.`);
  }
  return createToken2(lexer, TokenKind.EOF, bodyLength, bodyLength);
}
function readComment(lexer, start) {
  const body = lexer.source.body;
  const bodyLength = body.length;
  let position = start + 1;
  while (position < bodyLength) {
    const code = body.charCodeAt(position);
    if (code === 10 || code === 13) {
      break;
    }
    if (isUnicodeScalarValue(code)) {
      ++position;
    } else if (isSupplementaryCodePoint(body, position)) {
      position += 2;
    } else {
      break;
    }
  }
  return createToken2(lexer, TokenKind.COMMENT, start, position, body.slice(start + 1, position));
}
function readNumber2(lexer, start, firstCode) {
  const body = lexer.source.body;
  let position = start;
  let code = firstCode;
  let isFloat = false;
  if (code === 45) {
    code = body.charCodeAt(++position);
  }
  if (code === 48) {
    code = body.charCodeAt(++position);
    if (isDigit(code)) {
      throw syntaxError(lexer.source, position, `Invalid number, unexpected digit after 0: ${printCodePointAt(lexer, position)}.`);
    }
  } else {
    position = readDigits(lexer, position, code);
    code = body.charCodeAt(position);
  }
  if (code === 46) {
    isFloat = true;
    code = body.charCodeAt(++position);
    position = readDigits(lexer, position, code);
    code = body.charCodeAt(position);
  }
  if (code === 69 || code === 101) {
    isFloat = true;
    code = body.charCodeAt(++position);
    if (code === 43 || code === 45) {
      code = body.charCodeAt(++position);
    }
    position = readDigits(lexer, position, code);
    code = body.charCodeAt(position);
  }
  if (code === 46 || isNameStart(code)) {
    throw syntaxError(lexer.source, position, `Invalid number, expected digit but got: ${printCodePointAt(lexer, position)}.`);
  }
  return createToken2(lexer, isFloat ? TokenKind.FLOAT : TokenKind.INT, start, position, body.slice(start, position));
}
function readDigits(lexer, start, firstCode) {
  if (!isDigit(firstCode)) {
    throw syntaxError(lexer.source, start, `Invalid number, expected digit but got: ${printCodePointAt(lexer, start)}.`);
  }
  const body = lexer.source.body;
  let position = start + 1;
  while (isDigit(body.charCodeAt(position))) {
    ++position;
  }
  return position;
}
function readString4(lexer, start) {
  const body = lexer.source.body;
  const bodyLength = body.length;
  let position = start + 1;
  let chunkStart = position;
  let value = "";
  while (position < bodyLength) {
    const code = body.charCodeAt(position);
    if (code === 34) {
      value += body.slice(chunkStart, position);
      return createToken2(lexer, TokenKind.STRING, start, position + 1, value);
    }
    if (code === 92) {
      value += body.slice(chunkStart, position);
      const escape = body.charCodeAt(position + 1) === 117 ? body.charCodeAt(position + 2) === 123 ? readEscapedUnicodeVariableWidth(lexer, position) : readEscapedUnicodeFixedWidth(lexer, position) : readEscapedCharacter(lexer, position);
      value += escape.value;
      position += escape.size;
      chunkStart = position;
      continue;
    }
    if (code === 10 || code === 13) {
      break;
    }
    if (isUnicodeScalarValue(code)) {
      ++position;
    } else if (isSupplementaryCodePoint(body, position)) {
      position += 2;
    } else {
      throw syntaxError(lexer.source, position, `Invalid character within String: ${printCodePointAt(lexer, position)}.`);
    }
  }
  throw syntaxError(lexer.source, position, "Unterminated string.");
}
function readEscapedUnicodeVariableWidth(lexer, position) {
  const body = lexer.source.body;
  let point = 0;
  let size = 3;
  while (size < 12) {
    const code = body.charCodeAt(position + size++);
    if (code === 125) {
      if (size < 5 || !isUnicodeScalarValue(point)) {
        break;
      }
      return {
        value: String.fromCodePoint(point),
        size
      };
    }
    point = point << 4 | readHexDigit(code);
    if (point < 0) {
      break;
    }
  }
  throw syntaxError(lexer.source, position, `Invalid Unicode escape sequence: "${body.slice(position, position + size)}".`);
}
function readEscapedUnicodeFixedWidth(lexer, position) {
  const body = lexer.source.body;
  const code = read16BitHexCode(body, position + 2);
  if (isUnicodeScalarValue(code)) {
    return {
      value: String.fromCodePoint(code),
      size: 6
    };
  }
  if (isLeadingSurrogate(code)) {
    if (body.charCodeAt(position + 6) === 92 && body.charCodeAt(position + 7) === 117) {
      const trailingCode = read16BitHexCode(body, position + 8);
      if (isTrailingSurrogate(trailingCode)) {
        return {
          value: String.fromCodePoint(code, trailingCode),
          size: 12
        };
      }
    }
  }
  throw syntaxError(lexer.source, position, `Invalid Unicode escape sequence: "${body.slice(position, position + 6)}".`);
}
function read16BitHexCode(body, position) {
  return readHexDigit(body.charCodeAt(position)) << 12 | readHexDigit(body.charCodeAt(position + 1)) << 8 | readHexDigit(body.charCodeAt(position + 2)) << 4 | readHexDigit(body.charCodeAt(position + 3));
}
function readHexDigit(code) {
  return code >= 48 && code <= 57 ? code - 48 : code >= 65 && code <= 70 ? code - 55 : code >= 97 && code <= 102 ? code - 87 : -1;
}
function readEscapedCharacter(lexer, position) {
  const body = lexer.source.body;
  const code = body.charCodeAt(position + 1);
  switch (code) {
    case 34:
      return {
        value: '"',
        size: 2
      };
    case 92:
      return {
        value: "\\",
        size: 2
      };
    case 47:
      return {
        value: "/",
        size: 2
      };
    case 98:
      return {
        value: "\b",
        size: 2
      };
    case 102:
      return {
        value: "\f",
        size: 2
      };
    case 110:
      return {
        value: `
`,
        size: 2
      };
    case 114:
      return {
        value: "\r",
        size: 2
      };
    case 116:
      return {
        value: "\t",
        size: 2
      };
  }
  throw syntaxError(lexer.source, position, `Invalid character escape sequence: "${body.slice(position, position + 2)}".`);
}
function readBlockString(lexer, start) {
  const body = lexer.source.body;
  const bodyLength = body.length;
  let lineStart = lexer.lineStart;
  let position = start + 3;
  let chunkStart = position;
  let currentLine = "";
  const blockLines = [];
  while (position < bodyLength) {
    const code = body.charCodeAt(position);
    if (code === 34 && body.charCodeAt(position + 1) === 34 && body.charCodeAt(position + 2) === 34) {
      currentLine += body.slice(chunkStart, position);
      blockLines.push(currentLine);
      const token = createToken2(lexer, TokenKind.BLOCK_STRING, start, position + 3, dedentBlockStringLines(blockLines).join(`
`));
      lexer.line += blockLines.length - 1;
      lexer.lineStart = lineStart;
      return token;
    }
    if (code === 92 && body.charCodeAt(position + 1) === 34 && body.charCodeAt(position + 2) === 34 && body.charCodeAt(position + 3) === 34) {
      currentLine += body.slice(chunkStart, position);
      chunkStart = position + 1;
      position += 4;
      continue;
    }
    if (code === 10 || code === 13) {
      currentLine += body.slice(chunkStart, position);
      blockLines.push(currentLine);
      if (code === 13 && body.charCodeAt(position + 1) === 10) {
        position += 2;
      } else {
        ++position;
      }
      currentLine = "";
      chunkStart = position;
      lineStart = position;
      continue;
    }
    if (isUnicodeScalarValue(code)) {
      ++position;
    } else if (isSupplementaryCodePoint(body, position)) {
      position += 2;
    } else {
      throw syntaxError(lexer.source, position, `Invalid character within String: ${printCodePointAt(lexer, position)}.`);
    }
  }
  throw syntaxError(lexer.source, position, "Unterminated string.");
}
function readName(lexer, start) {
  const body = lexer.source.body;
  const bodyLength = body.length;
  let position = start + 1;
  while (position < bodyLength) {
    const code = body.charCodeAt(position);
    if (isNameContinue(code)) {
      ++position;
    } else {
      break;
    }
  }
  return createToken2(lexer, TokenKind.NAME, start, position, body.slice(start, position));
}

// node_modules/graphql/jsutils/inspect.mjs
var MAX_ARRAY_LENGTH = 10;
var MAX_RECURSIVE_DEPTH = 2;
function inspect(value) {
  return formatValue(value, []);
}
function formatValue(value, seenValues) {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "function":
      return value.name ? `[function ${value.name}]` : "[function]";
    case "object":
      return formatObjectValue(value, seenValues);
    default:
      return String(value);
  }
}
function formatObjectValue(value, previouslySeenValues) {
  if (value === null) {
    return "null";
  }
  if (previouslySeenValues.includes(value)) {
    return "[Circular]";
  }
  const seenValues = [...previouslySeenValues, value];
  if (isJSONable(value)) {
    const jsonValue = value.toJSON();
    if (jsonValue !== value) {
      return typeof jsonValue === "string" ? jsonValue : formatValue(jsonValue, seenValues);
    }
  } else if (Array.isArray(value)) {
    return formatArray(value, seenValues);
  }
  return formatObject(value, seenValues);
}
function isJSONable(value) {
  return typeof value.toJSON === "function";
}
function formatObject(object, seenValues) {
  const entries = Object.entries(object);
  if (entries.length === 0) {
    return "{}";
  }
  if (seenValues.length > MAX_RECURSIVE_DEPTH) {
    return "[" + getObjectTag(object) + "]";
  }
  const properties = entries.map(([key, value]) => key + ": " + formatValue(value, seenValues));
  return "{ " + properties.join(", ") + " }";
}
function formatArray(array, seenValues) {
  if (array.length === 0) {
    return "[]";
  }
  if (seenValues.length > MAX_RECURSIVE_DEPTH) {
    return "[Array]";
  }
  const len = Math.min(MAX_ARRAY_LENGTH, array.length);
  const remaining = array.length - len;
  const items = [];
  for (let i = 0;i < len; ++i) {
    items.push(formatValue(array[i], seenValues));
  }
  if (remaining === 1) {
    items.push("... 1 more item");
  } else if (remaining > 1) {
    items.push(`... ${remaining} more items`);
  }
  return "[" + items.join(", ") + "]";
}
function getObjectTag(object) {
  const tag = Object.prototype.toString.call(object).replace(/^\[object /, "").replace(/]$/, "");
  if (tag === "Object" && typeof object.constructor === "function") {
    const name = object.constructor.name;
    if (typeof name === "string" && name !== "") {
      return name;
    }
  }
  return tag;
}

// node_modules/graphql/jsutils/instanceOf.mjs
var isProduction = globalThis.process && false;
var instanceOf = isProduction ? function instanceOf2(value, constructor) {
  return value instanceof constructor;
} : function instanceOf3(value, constructor) {
  if (value instanceof constructor) {
    return true;
  }
  if (typeof value === "object" && value !== null) {
    var _value$constructor;
    const className = constructor.prototype[Symbol.toStringTag];
    const valueClassName = Symbol.toStringTag in value ? value[Symbol.toStringTag] : (_value$constructor = value.constructor) === null || _value$constructor === undefined ? undefined : _value$constructor.name;
    if (className === valueClassName) {
      const stringifiedValue = inspect(value);
      throw new Error(`Cannot use ${className} "${stringifiedValue}" from another module or realm.

Ensure that there is only one instance of "graphql" in the node_modules
directory. If different versions of "graphql" are the dependencies of other
relied on modules, use "resolutions" to ensure only one version is installed.

https://yarnpkg.com/en/docs/selective-version-resolutions

Duplicate "graphql" modules cannot be used at the same time since different
versions may have different capabilities and behavior. The data from one
version used in the function from another could produce confusing and
spurious results.`);
    }
  }
  return false;
};

// node_modules/graphql/language/source.mjs
class Source {
  constructor(body, name = "GraphQL request", locationOffset = {
    line: 1,
    column: 1
  }) {
    typeof body === "string" || devAssert(false, `Body must be a string. Received: ${inspect(body)}.`);
    this.body = body;
    this.name = name;
    this.locationOffset = locationOffset;
    this.locationOffset.line > 0 || devAssert(false, "line in locationOffset is 1-indexed and must be positive.");
    this.locationOffset.column > 0 || devAssert(false, "column in locationOffset is 1-indexed and must be positive.");
  }
  get [Symbol.toStringTag]() {
    return "Source";
  }
}
function isSource(source) {
  return instanceOf(source, Source);
}

// node_modules/graphql/language/parser.mjs
function parse(source, options) {
  const parser = new Parser(source, options);
  const document = parser.parseDocument();
  Object.defineProperty(document, "tokenCount", {
    enumerable: false,
    value: parser.tokenCount
  });
  return document;
}
class Parser {
  constructor(source, options = {}) {
    const { lexer, ..._options } = options;
    if (lexer) {
      this._lexer = lexer;
    } else {
      const sourceObj = isSource(source) ? source : new Source(source);
      this._lexer = new Lexer(sourceObj);
    }
    this._options = _options;
    this._tokenCounter = 0;
  }
  get tokenCount() {
    return this._tokenCounter;
  }
  parseName() {
    const token = this.expectToken(TokenKind.NAME);
    return this.node(token, {
      kind: Kind.NAME,
      value: token.value
    });
  }
  parseDocument() {
    return this.node(this._lexer.token, {
      kind: Kind.DOCUMENT,
      definitions: this.many(TokenKind.SOF, this.parseDefinition, TokenKind.EOF)
    });
  }
  parseDefinition() {
    if (this.peek(TokenKind.BRACE_L)) {
      return this.parseOperationDefinition();
    }
    const hasDescription = this.peekDescription();
    const keywordToken = hasDescription ? this._lexer.lookahead() : this._lexer.token;
    if (hasDescription && keywordToken.kind === TokenKind.BRACE_L) {
      throw syntaxError(this._lexer.source, this._lexer.token.start, "Unexpected description, descriptions are not supported on shorthand queries.");
    }
    if (keywordToken.kind === TokenKind.NAME) {
      switch (keywordToken.value) {
        case "schema":
          return this.parseSchemaDefinition();
        case "scalar":
          return this.parseScalarTypeDefinition();
        case "type":
          return this.parseObjectTypeDefinition();
        case "interface":
          return this.parseInterfaceTypeDefinition();
        case "union":
          return this.parseUnionTypeDefinition();
        case "enum":
          return this.parseEnumTypeDefinition();
        case "input":
          return this.parseInputObjectTypeDefinition();
        case "directive":
          return this.parseDirectiveDefinition();
      }
      switch (keywordToken.value) {
        case "query":
        case "mutation":
        case "subscription":
          return this.parseOperationDefinition();
        case "fragment":
          return this.parseFragmentDefinition();
      }
      if (hasDescription) {
        throw syntaxError(this._lexer.source, this._lexer.token.start, "Unexpected description, only GraphQL definitions support descriptions.");
      }
      switch (keywordToken.value) {
        case "extend":
          return this.parseTypeSystemExtension();
      }
    }
    throw this.unexpected(keywordToken);
  }
  parseOperationDefinition() {
    const start = this._lexer.token;
    if (this.peek(TokenKind.BRACE_L)) {
      return this.node(start, {
        kind: Kind.OPERATION_DEFINITION,
        operation: OperationTypeNode.QUERY,
        description: undefined,
        name: undefined,
        variableDefinitions: [],
        directives: [],
        selectionSet: this.parseSelectionSet()
      });
    }
    const description = this.parseDescription();
    const operation = this.parseOperationType();
    let name;
    if (this.peek(TokenKind.NAME)) {
      name = this.parseName();
    }
    return this.node(start, {
      kind: Kind.OPERATION_DEFINITION,
      operation,
      description,
      name,
      variableDefinitions: this.parseVariableDefinitions(),
      directives: this.parseDirectives(false),
      selectionSet: this.parseSelectionSet()
    });
  }
  parseOperationType() {
    const operationToken = this.expectToken(TokenKind.NAME);
    switch (operationToken.value) {
      case "query":
        return OperationTypeNode.QUERY;
      case "mutation":
        return OperationTypeNode.MUTATION;
      case "subscription":
        return OperationTypeNode.SUBSCRIPTION;
    }
    throw this.unexpected(operationToken);
  }
  parseVariableDefinitions() {
    return this.optionalMany(TokenKind.PAREN_L, this.parseVariableDefinition, TokenKind.PAREN_R);
  }
  parseVariableDefinition() {
    return this.node(this._lexer.token, {
      kind: Kind.VARIABLE_DEFINITION,
      description: this.parseDescription(),
      variable: this.parseVariable(),
      type: (this.expectToken(TokenKind.COLON), this.parseTypeReference()),
      defaultValue: this.expectOptionalToken(TokenKind.EQUALS) ? this.parseConstValueLiteral() : undefined,
      directives: this.parseConstDirectives()
    });
  }
  parseVariable() {
    const start = this._lexer.token;
    this.expectToken(TokenKind.DOLLAR);
    return this.node(start, {
      kind: Kind.VARIABLE,
      name: this.parseName()
    });
  }
  parseSelectionSet() {
    return this.node(this._lexer.token, {
      kind: Kind.SELECTION_SET,
      selections: this.many(TokenKind.BRACE_L, this.parseSelection, TokenKind.BRACE_R)
    });
  }
  parseSelection() {
    return this.peek(TokenKind.SPREAD) ? this.parseFragment() : this.parseField();
  }
  parseField() {
    const start = this._lexer.token;
    const nameOrAlias = this.parseName();
    let alias;
    let name;
    if (this.expectOptionalToken(TokenKind.COLON)) {
      alias = nameOrAlias;
      name = this.parseName();
    } else {
      name = nameOrAlias;
    }
    return this.node(start, {
      kind: Kind.FIELD,
      alias,
      name,
      arguments: this.parseArguments(false),
      directives: this.parseDirectives(false),
      selectionSet: this.peek(TokenKind.BRACE_L) ? this.parseSelectionSet() : undefined
    });
  }
  parseArguments(isConst) {
    const item = isConst ? this.parseConstArgument : this.parseArgument;
    return this.optionalMany(TokenKind.PAREN_L, item, TokenKind.PAREN_R);
  }
  parseArgument(isConst = false) {
    const start = this._lexer.token;
    const name = this.parseName();
    this.expectToken(TokenKind.COLON);
    return this.node(start, {
      kind: Kind.ARGUMENT,
      name,
      value: this.parseValueLiteral(isConst)
    });
  }
  parseConstArgument() {
    return this.parseArgument(true);
  }
  parseFragment() {
    const start = this._lexer.token;
    this.expectToken(TokenKind.SPREAD);
    const hasTypeCondition = this.expectOptionalKeyword("on");
    if (!hasTypeCondition && this.peek(TokenKind.NAME)) {
      return this.node(start, {
        kind: Kind.FRAGMENT_SPREAD,
        name: this.parseFragmentName(),
        directives: this.parseDirectives(false)
      });
    }
    return this.node(start, {
      kind: Kind.INLINE_FRAGMENT,
      typeCondition: hasTypeCondition ? this.parseNamedType() : undefined,
      directives: this.parseDirectives(false),
      selectionSet: this.parseSelectionSet()
    });
  }
  parseFragmentDefinition() {
    const start = this._lexer.token;
    const description = this.parseDescription();
    this.expectKeyword("fragment");
    if (this._options.allowLegacyFragmentVariables === true) {
      return this.node(start, {
        kind: Kind.FRAGMENT_DEFINITION,
        description,
        name: this.parseFragmentName(),
        variableDefinitions: this.parseVariableDefinitions(),
        typeCondition: (this.expectKeyword("on"), this.parseNamedType()),
        directives: this.parseDirectives(false),
        selectionSet: this.parseSelectionSet()
      });
    }
    return this.node(start, {
      kind: Kind.FRAGMENT_DEFINITION,
      description,
      name: this.parseFragmentName(),
      typeCondition: (this.expectKeyword("on"), this.parseNamedType()),
      directives: this.parseDirectives(false),
      selectionSet: this.parseSelectionSet()
    });
  }
  parseFragmentName() {
    if (this._lexer.token.value === "on") {
      throw this.unexpected();
    }
    return this.parseName();
  }
  parseValueLiteral(isConst) {
    const token = this._lexer.token;
    switch (token.kind) {
      case TokenKind.BRACKET_L:
        return this.parseList(isConst);
      case TokenKind.BRACE_L:
        return this.parseObject(isConst);
      case TokenKind.INT:
        this.advanceLexer();
        return this.node(token, {
          kind: Kind.INT,
          value: token.value
        });
      case TokenKind.FLOAT:
        this.advanceLexer();
        return this.node(token, {
          kind: Kind.FLOAT,
          value: token.value
        });
      case TokenKind.STRING:
      case TokenKind.BLOCK_STRING:
        return this.parseStringLiteral();
      case TokenKind.NAME:
        this.advanceLexer();
        switch (token.value) {
          case "true":
            return this.node(token, {
              kind: Kind.BOOLEAN,
              value: true
            });
          case "false":
            return this.node(token, {
              kind: Kind.BOOLEAN,
              value: false
            });
          case "null":
            return this.node(token, {
              kind: Kind.NULL
            });
          default:
            return this.node(token, {
              kind: Kind.ENUM,
              value: token.value
            });
        }
      case TokenKind.DOLLAR:
        if (isConst) {
          this.expectToken(TokenKind.DOLLAR);
          if (this._lexer.token.kind === TokenKind.NAME) {
            const varName = this._lexer.token.value;
            throw syntaxError(this._lexer.source, token.start, `Unexpected variable "$${varName}" in constant value.`);
          } else {
            throw this.unexpected(token);
          }
        }
        return this.parseVariable();
      default:
        throw this.unexpected();
    }
  }
  parseConstValueLiteral() {
    return this.parseValueLiteral(true);
  }
  parseStringLiteral() {
    const token = this._lexer.token;
    this.advanceLexer();
    return this.node(token, {
      kind: Kind.STRING,
      value: token.value,
      block: token.kind === TokenKind.BLOCK_STRING
    });
  }
  parseList(isConst) {
    const item = () => this.parseValueLiteral(isConst);
    return this.node(this._lexer.token, {
      kind: Kind.LIST,
      values: this.any(TokenKind.BRACKET_L, item, TokenKind.BRACKET_R)
    });
  }
  parseObject(isConst) {
    const item = () => this.parseObjectField(isConst);
    return this.node(this._lexer.token, {
      kind: Kind.OBJECT,
      fields: this.any(TokenKind.BRACE_L, item, TokenKind.BRACE_R)
    });
  }
  parseObjectField(isConst) {
    const start = this._lexer.token;
    const name = this.parseName();
    this.expectToken(TokenKind.COLON);
    return this.node(start, {
      kind: Kind.OBJECT_FIELD,
      name,
      value: this.parseValueLiteral(isConst)
    });
  }
  parseDirectives(isConst) {
    const directives = [];
    while (this.peek(TokenKind.AT)) {
      directives.push(this.parseDirective(isConst));
    }
    return directives;
  }
  parseConstDirectives() {
    return this.parseDirectives(true);
  }
  parseDirective(isConst) {
    const start = this._lexer.token;
    this.expectToken(TokenKind.AT);
    return this.node(start, {
      kind: Kind.DIRECTIVE,
      name: this.parseName(),
      arguments: this.parseArguments(isConst)
    });
  }
  parseTypeReference() {
    const start = this._lexer.token;
    let type;
    if (this.expectOptionalToken(TokenKind.BRACKET_L)) {
      const innerType = this.parseTypeReference();
      this.expectToken(TokenKind.BRACKET_R);
      type = this.node(start, {
        kind: Kind.LIST_TYPE,
        type: innerType
      });
    } else {
      type = this.parseNamedType();
    }
    if (this.expectOptionalToken(TokenKind.BANG)) {
      return this.node(start, {
        kind: Kind.NON_NULL_TYPE,
        type
      });
    }
    return type;
  }
  parseNamedType() {
    return this.node(this._lexer.token, {
      kind: Kind.NAMED_TYPE,
      name: this.parseName()
    });
  }
  peekDescription() {
    return this.peek(TokenKind.STRING) || this.peek(TokenKind.BLOCK_STRING);
  }
  parseDescription() {
    if (this.peekDescription()) {
      return this.parseStringLiteral();
    }
  }
  parseSchemaDefinition() {
    const start = this._lexer.token;
    const description = this.parseDescription();
    this.expectKeyword("schema");
    const directives = this.parseConstDirectives();
    const operationTypes = this.many(TokenKind.BRACE_L, this.parseOperationTypeDefinition, TokenKind.BRACE_R);
    return this.node(start, {
      kind: Kind.SCHEMA_DEFINITION,
      description,
      directives,
      operationTypes
    });
  }
  parseOperationTypeDefinition() {
    const start = this._lexer.token;
    const operation = this.parseOperationType();
    this.expectToken(TokenKind.COLON);
    const type = this.parseNamedType();
    return this.node(start, {
      kind: Kind.OPERATION_TYPE_DEFINITION,
      operation,
      type
    });
  }
  parseScalarTypeDefinition() {
    const start = this._lexer.token;
    const description = this.parseDescription();
    this.expectKeyword("scalar");
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    return this.node(start, {
      kind: Kind.SCALAR_TYPE_DEFINITION,
      description,
      name,
      directives
    });
  }
  parseObjectTypeDefinition() {
    const start = this._lexer.token;
    const description = this.parseDescription();
    this.expectKeyword("type");
    const name = this.parseName();
    const interfaces = this.parseImplementsInterfaces();
    const directives = this.parseConstDirectives();
    const fields = this.parseFieldsDefinition();
    return this.node(start, {
      kind: Kind.OBJECT_TYPE_DEFINITION,
      description,
      name,
      interfaces,
      directives,
      fields
    });
  }
  parseImplementsInterfaces() {
    return this.expectOptionalKeyword("implements") ? this.delimitedMany(TokenKind.AMP, this.parseNamedType) : [];
  }
  parseFieldsDefinition() {
    return this.optionalMany(TokenKind.BRACE_L, this.parseFieldDefinition, TokenKind.BRACE_R);
  }
  parseFieldDefinition() {
    const start = this._lexer.token;
    const description = this.parseDescription();
    const name = this.parseName();
    const args = this.parseArgumentDefs();
    this.expectToken(TokenKind.COLON);
    const type = this.parseTypeReference();
    const directives = this.parseConstDirectives();
    return this.node(start, {
      kind: Kind.FIELD_DEFINITION,
      description,
      name,
      arguments: args,
      type,
      directives
    });
  }
  parseArgumentDefs() {
    return this.optionalMany(TokenKind.PAREN_L, this.parseInputValueDef, TokenKind.PAREN_R);
  }
  parseInputValueDef() {
    const start = this._lexer.token;
    const description = this.parseDescription();
    const name = this.parseName();
    this.expectToken(TokenKind.COLON);
    const type = this.parseTypeReference();
    let defaultValue;
    if (this.expectOptionalToken(TokenKind.EQUALS)) {
      defaultValue = this.parseConstValueLiteral();
    }
    const directives = this.parseConstDirectives();
    return this.node(start, {
      kind: Kind.INPUT_VALUE_DEFINITION,
      description,
      name,
      type,
      defaultValue,
      directives
    });
  }
  parseInterfaceTypeDefinition() {
    const start = this._lexer.token;
    const description = this.parseDescription();
    this.expectKeyword("interface");
    const name = this.parseName();
    const interfaces = this.parseImplementsInterfaces();
    const directives = this.parseConstDirectives();
    const fields = this.parseFieldsDefinition();
    return this.node(start, {
      kind: Kind.INTERFACE_TYPE_DEFINITION,
      description,
      name,
      interfaces,
      directives,
      fields
    });
  }
  parseUnionTypeDefinition() {
    const start = this._lexer.token;
    const description = this.parseDescription();
    this.expectKeyword("union");
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    const types = this.parseUnionMemberTypes();
    return this.node(start, {
      kind: Kind.UNION_TYPE_DEFINITION,
      description,
      name,
      directives,
      types
    });
  }
  parseUnionMemberTypes() {
    return this.expectOptionalToken(TokenKind.EQUALS) ? this.delimitedMany(TokenKind.PIPE, this.parseNamedType) : [];
  }
  parseEnumTypeDefinition() {
    const start = this._lexer.token;
    const description = this.parseDescription();
    this.expectKeyword("enum");
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    const values = this.parseEnumValuesDefinition();
    return this.node(start, {
      kind: Kind.ENUM_TYPE_DEFINITION,
      description,
      name,
      directives,
      values
    });
  }
  parseEnumValuesDefinition() {
    return this.optionalMany(TokenKind.BRACE_L, this.parseEnumValueDefinition, TokenKind.BRACE_R);
  }
  parseEnumValueDefinition() {
    const start = this._lexer.token;
    const description = this.parseDescription();
    const name = this.parseEnumValueName();
    const directives = this.parseConstDirectives();
    return this.node(start, {
      kind: Kind.ENUM_VALUE_DEFINITION,
      description,
      name,
      directives
    });
  }
  parseEnumValueName() {
    if (this._lexer.token.value === "true" || this._lexer.token.value === "false" || this._lexer.token.value === "null") {
      throw syntaxError(this._lexer.source, this._lexer.token.start, `${getTokenDesc(this._lexer.token)} is reserved and cannot be used for an enum value.`);
    }
    return this.parseName();
  }
  parseInputObjectTypeDefinition() {
    const start = this._lexer.token;
    const description = this.parseDescription();
    this.expectKeyword("input");
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    const fields = this.parseInputFieldsDefinition();
    return this.node(start, {
      kind: Kind.INPUT_OBJECT_TYPE_DEFINITION,
      description,
      name,
      directives,
      fields
    });
  }
  parseInputFieldsDefinition() {
    return this.optionalMany(TokenKind.BRACE_L, this.parseInputValueDef, TokenKind.BRACE_R);
  }
  parseTypeSystemExtension() {
    const keywordToken = this._lexer.lookahead();
    if (keywordToken.kind === TokenKind.NAME) {
      switch (keywordToken.value) {
        case "schema":
          return this.parseSchemaExtension();
        case "scalar":
          return this.parseScalarTypeExtension();
        case "type":
          return this.parseObjectTypeExtension();
        case "interface":
          return this.parseInterfaceTypeExtension();
        case "union":
          return this.parseUnionTypeExtension();
        case "enum":
          return this.parseEnumTypeExtension();
        case "input":
          return this.parseInputObjectTypeExtension();
      }
    }
    throw this.unexpected(keywordToken);
  }
  parseSchemaExtension() {
    const start = this._lexer.token;
    this.expectKeyword("extend");
    this.expectKeyword("schema");
    const directives = this.parseConstDirectives();
    const operationTypes = this.optionalMany(TokenKind.BRACE_L, this.parseOperationTypeDefinition, TokenKind.BRACE_R);
    if (directives.length === 0 && operationTypes.length === 0) {
      throw this.unexpected();
    }
    return this.node(start, {
      kind: Kind.SCHEMA_EXTENSION,
      directives,
      operationTypes
    });
  }
  parseScalarTypeExtension() {
    const start = this._lexer.token;
    this.expectKeyword("extend");
    this.expectKeyword("scalar");
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    if (directives.length === 0) {
      throw this.unexpected();
    }
    return this.node(start, {
      kind: Kind.SCALAR_TYPE_EXTENSION,
      name,
      directives
    });
  }
  parseObjectTypeExtension() {
    const start = this._lexer.token;
    this.expectKeyword("extend");
    this.expectKeyword("type");
    const name = this.parseName();
    const interfaces = this.parseImplementsInterfaces();
    const directives = this.parseConstDirectives();
    const fields = this.parseFieldsDefinition();
    if (interfaces.length === 0 && directives.length === 0 && fields.length === 0) {
      throw this.unexpected();
    }
    return this.node(start, {
      kind: Kind.OBJECT_TYPE_EXTENSION,
      name,
      interfaces,
      directives,
      fields
    });
  }
  parseInterfaceTypeExtension() {
    const start = this._lexer.token;
    this.expectKeyword("extend");
    this.expectKeyword("interface");
    const name = this.parseName();
    const interfaces = this.parseImplementsInterfaces();
    const directives = this.parseConstDirectives();
    const fields = this.parseFieldsDefinition();
    if (interfaces.length === 0 && directives.length === 0 && fields.length === 0) {
      throw this.unexpected();
    }
    return this.node(start, {
      kind: Kind.INTERFACE_TYPE_EXTENSION,
      name,
      interfaces,
      directives,
      fields
    });
  }
  parseUnionTypeExtension() {
    const start = this._lexer.token;
    this.expectKeyword("extend");
    this.expectKeyword("union");
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    const types = this.parseUnionMemberTypes();
    if (directives.length === 0 && types.length === 0) {
      throw this.unexpected();
    }
    return this.node(start, {
      kind: Kind.UNION_TYPE_EXTENSION,
      name,
      directives,
      types
    });
  }
  parseEnumTypeExtension() {
    const start = this._lexer.token;
    this.expectKeyword("extend");
    this.expectKeyword("enum");
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    const values = this.parseEnumValuesDefinition();
    if (directives.length === 0 && values.length === 0) {
      throw this.unexpected();
    }
    return this.node(start, {
      kind: Kind.ENUM_TYPE_EXTENSION,
      name,
      directives,
      values
    });
  }
  parseInputObjectTypeExtension() {
    const start = this._lexer.token;
    this.expectKeyword("extend");
    this.expectKeyword("input");
    const name = this.parseName();
    const directives = this.parseConstDirectives();
    const fields = this.parseInputFieldsDefinition();
    if (directives.length === 0 && fields.length === 0) {
      throw this.unexpected();
    }
    return this.node(start, {
      kind: Kind.INPUT_OBJECT_TYPE_EXTENSION,
      name,
      directives,
      fields
    });
  }
  parseDirectiveDefinition() {
    const start = this._lexer.token;
    const description = this.parseDescription();
    this.expectKeyword("directive");
    this.expectToken(TokenKind.AT);
    const name = this.parseName();
    const args = this.parseArgumentDefs();
    const repeatable = this.expectOptionalKeyword("repeatable");
    this.expectKeyword("on");
    const locations = this.parseDirectiveLocations();
    return this.node(start, {
      kind: Kind.DIRECTIVE_DEFINITION,
      description,
      name,
      arguments: args,
      repeatable,
      locations
    });
  }
  parseDirectiveLocations() {
    return this.delimitedMany(TokenKind.PIPE, this.parseDirectiveLocation);
  }
  parseDirectiveLocation() {
    const start = this._lexer.token;
    const name = this.parseName();
    if (Object.prototype.hasOwnProperty.call(DirectiveLocation, name.value)) {
      return name;
    }
    throw this.unexpected(start);
  }
  parseSchemaCoordinate() {
    const start = this._lexer.token;
    const ofDirective = this.expectOptionalToken(TokenKind.AT);
    const name = this.parseName();
    let memberName;
    if (!ofDirective && this.expectOptionalToken(TokenKind.DOT)) {
      memberName = this.parseName();
    }
    let argumentName;
    if ((ofDirective || memberName) && this.expectOptionalToken(TokenKind.PAREN_L)) {
      argumentName = this.parseName();
      this.expectToken(TokenKind.COLON);
      this.expectToken(TokenKind.PAREN_R);
    }
    if (ofDirective) {
      if (argumentName) {
        return this.node(start, {
          kind: Kind.DIRECTIVE_ARGUMENT_COORDINATE,
          name,
          argumentName
        });
      }
      return this.node(start, {
        kind: Kind.DIRECTIVE_COORDINATE,
        name
      });
    } else if (memberName) {
      if (argumentName) {
        return this.node(start, {
          kind: Kind.ARGUMENT_COORDINATE,
          name,
          fieldName: memberName,
          argumentName
        });
      }
      return this.node(start, {
        kind: Kind.MEMBER_COORDINATE,
        name,
        memberName
      });
    }
    return this.node(start, {
      kind: Kind.TYPE_COORDINATE,
      name
    });
  }
  node(startToken, node) {
    if (this._options.noLocation !== true) {
      node.loc = new Location(startToken, this._lexer.lastToken, this._lexer.source);
    }
    return node;
  }
  peek(kind) {
    return this._lexer.token.kind === kind;
  }
  expectToken(kind) {
    const token = this._lexer.token;
    if (token.kind === kind) {
      this.advanceLexer();
      return token;
    }
    throw syntaxError(this._lexer.source, token.start, `Expected ${getTokenKindDesc(kind)}, found ${getTokenDesc(token)}.`);
  }
  expectOptionalToken(kind) {
    const token = this._lexer.token;
    if (token.kind === kind) {
      this.advanceLexer();
      return true;
    }
    return false;
  }
  expectKeyword(value) {
    const token = this._lexer.token;
    if (token.kind === TokenKind.NAME && token.value === value) {
      this.advanceLexer();
    } else {
      throw syntaxError(this._lexer.source, token.start, `Expected "${value}", found ${getTokenDesc(token)}.`);
    }
  }
  expectOptionalKeyword(value) {
    const token = this._lexer.token;
    if (token.kind === TokenKind.NAME && token.value === value) {
      this.advanceLexer();
      return true;
    }
    return false;
  }
  unexpected(atToken) {
    const token = atToken !== null && atToken !== undefined ? atToken : this._lexer.token;
    return syntaxError(this._lexer.source, token.start, `Unexpected ${getTokenDesc(token)}.`);
  }
  any(openKind, parseFn, closeKind) {
    this.expectToken(openKind);
    const nodes = [];
    while (!this.expectOptionalToken(closeKind)) {
      nodes.push(parseFn.call(this));
    }
    return nodes;
  }
  optionalMany(openKind, parseFn, closeKind) {
    if (this.expectOptionalToken(openKind)) {
      const nodes = [];
      do {
        nodes.push(parseFn.call(this));
      } while (!this.expectOptionalToken(closeKind));
      return nodes;
    }
    return [];
  }
  many(openKind, parseFn, closeKind) {
    this.expectToken(openKind);
    const nodes = [];
    do {
      nodes.push(parseFn.call(this));
    } while (!this.expectOptionalToken(closeKind));
    return nodes;
  }
  delimitedMany(delimiterKind, parseFn) {
    this.expectOptionalToken(delimiterKind);
    const nodes = [];
    do {
      nodes.push(parseFn.call(this));
    } while (this.expectOptionalToken(delimiterKind));
    return nodes;
  }
  advanceLexer() {
    const { maxTokens } = this._options;
    const token = this._lexer.advance();
    if (token.kind !== TokenKind.EOF) {
      ++this._tokenCounter;
      if (maxTokens !== undefined && this._tokenCounter > maxTokens) {
        throw syntaxError(this._lexer.source, token.start, `Document contains more that ${maxTokens} tokens. Parsing aborted.`);
      }
    }
  }
}
function getTokenDesc(token) {
  const value = token.value;
  return getTokenKindDesc(token.kind) + (value != null ? ` "${value}"` : "");
}
function getTokenKindDesc(kind) {
  return isPunctuatorTokenKind(kind) ? `"${kind}"` : kind;
}

// node_modules/graphql/jsutils/didYouMean.mjs
var MAX_SUGGESTIONS = 5;
function didYouMean(firstArg, secondArg) {
  const [subMessage, suggestionsArg] = secondArg ? [firstArg, secondArg] : [undefined, firstArg];
  let message = " Did you mean ";
  if (subMessage) {
    message += subMessage + " ";
  }
  const suggestions = suggestionsArg.map((x) => `"${x}"`);
  switch (suggestions.length) {
    case 0:
      return "";
    case 1:
      return message + suggestions[0] + "?";
    case 2:
      return message + suggestions[0] + " or " + suggestions[1] + "?";
  }
  const selected = suggestions.slice(0, MAX_SUGGESTIONS);
  const lastItem = selected.pop();
  return message + selected.join(", ") + ", or " + lastItem + "?";
}

// node_modules/graphql/jsutils/identityFunc.mjs
function identityFunc(x) {
  return x;
}

// node_modules/graphql/jsutils/keyMap.mjs
function keyMap(list, keyFn) {
  const result = Object.create(null);
  for (const item of list) {
    result[keyFn(item)] = item;
  }
  return result;
}

// node_modules/graphql/jsutils/keyValMap.mjs
function keyValMap(list, keyFn, valFn) {
  const result = Object.create(null);
  for (const item of list) {
    result[keyFn(item)] = valFn(item);
  }
  return result;
}

// node_modules/graphql/jsutils/mapValue.mjs
function mapValue(map, fn) {
  const result = Object.create(null);
  for (const key of Object.keys(map)) {
    result[key] = fn(map[key], key);
  }
  return result;
}

// node_modules/graphql/jsutils/naturalCompare.mjs
function naturalCompare(aStr, bStr) {
  let aIndex = 0;
  let bIndex = 0;
  while (aIndex < aStr.length && bIndex < bStr.length) {
    let aChar = aStr.charCodeAt(aIndex);
    let bChar = bStr.charCodeAt(bIndex);
    if (isDigit2(aChar) && isDigit2(bChar)) {
      let aNum = 0;
      do {
        ++aIndex;
        aNum = aNum * 10 + aChar - DIGIT_0;
        aChar = aStr.charCodeAt(aIndex);
      } while (isDigit2(aChar) && aNum > 0);
      let bNum = 0;
      do {
        ++bIndex;
        bNum = bNum * 10 + bChar - DIGIT_0;
        bChar = bStr.charCodeAt(bIndex);
      } while (isDigit2(bChar) && bNum > 0);
      if (aNum < bNum) {
        return -1;
      }
      if (aNum > bNum) {
        return 1;
      }
    } else {
      if (aChar < bChar) {
        return -1;
      }
      if (aChar > bChar) {
        return 1;
      }
      ++aIndex;
      ++bIndex;
    }
  }
  return aStr.length - bStr.length;
}
var DIGIT_0 = 48;
var DIGIT_9 = 57;
function isDigit2(code) {
  return !isNaN(code) && DIGIT_0 <= code && code <= DIGIT_9;
}

// node_modules/graphql/jsutils/suggestionList.mjs
function suggestionList(input, options) {
  const optionsByDistance = Object.create(null);
  const lexicalDistance = new LexicalDistance(input);
  const threshold = Math.floor(input.length * 0.4) + 1;
  for (const option of options) {
    const distance = lexicalDistance.measure(option, threshold);
    if (distance !== undefined) {
      optionsByDistance[option] = distance;
    }
  }
  return Object.keys(optionsByDistance).sort((a, b) => {
    const distanceDiff = optionsByDistance[a] - optionsByDistance[b];
    return distanceDiff !== 0 ? distanceDiff : naturalCompare(a, b);
  });
}

class LexicalDistance {
  constructor(input) {
    this._input = input;
    this._inputLowerCase = input.toLowerCase();
    this._inputArray = stringToArray(this._inputLowerCase);
    this._rows = [
      new Array(input.length + 1).fill(0),
      new Array(input.length + 1).fill(0),
      new Array(input.length + 1).fill(0)
    ];
  }
  measure(option, threshold) {
    if (this._input === option) {
      return 0;
    }
    const optionLowerCase = option.toLowerCase();
    if (this._inputLowerCase === optionLowerCase) {
      return 1;
    }
    let a = stringToArray(optionLowerCase);
    let b = this._inputArray;
    if (a.length < b.length) {
      const tmp = a;
      a = b;
      b = tmp;
    }
    const aLength = a.length;
    const bLength = b.length;
    if (aLength - bLength > threshold) {
      return;
    }
    const rows = this._rows;
    for (let j = 0;j <= bLength; j++) {
      rows[0][j] = j;
    }
    for (let i = 1;i <= aLength; i++) {
      const upRow = rows[(i - 1) % 3];
      const currentRow = rows[i % 3];
      let smallestCell = currentRow[0] = i;
      for (let j = 1;j <= bLength; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        let currentCell = Math.min(upRow[j] + 1, currentRow[j - 1] + 1, upRow[j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
          const doubleDiagonalCell = rows[(i - 2) % 3][j - 2];
          currentCell = Math.min(currentCell, doubleDiagonalCell + 1);
        }
        if (currentCell < smallestCell) {
          smallestCell = currentCell;
        }
        currentRow[j] = currentCell;
      }
      if (smallestCell > threshold) {
        return;
      }
    }
    const distance = rows[aLength % 3][bLength];
    return distance <= threshold ? distance : undefined;
  }
}
function stringToArray(str) {
  const strLength = str.length;
  const array = new Array(strLength);
  for (let i = 0;i < strLength; ++i) {
    array[i] = str.charCodeAt(i);
  }
  return array;
}

// node_modules/graphql/jsutils/toObjMap.mjs
function toObjMap(obj) {
  if (obj == null) {
    return Object.create(null);
  }
  if (Object.getPrototypeOf(obj) === null) {
    return obj;
  }
  const map = Object.create(null);
  for (const [key, value] of Object.entries(obj)) {
    map[key] = value;
  }
  return map;
}

// node_modules/graphql/language/printString.mjs
function printString(str) {
  return `"${str.replace(escapedRegExp, escapedReplacer)}"`;
}
var escapedRegExp = /[\x00-\x1f\x22\x5c\x7f-\x9f]/g;
function escapedReplacer(str) {
  return escapeSequences[str.charCodeAt(0)];
}
var escapeSequences = [
  "\\u0000",
  "\\u0001",
  "\\u0002",
  "\\u0003",
  "\\u0004",
  "\\u0005",
  "\\u0006",
  "\\u0007",
  "\\b",
  "\\t",
  "\\n",
  "\\u000B",
  "\\f",
  "\\r",
  "\\u000E",
  "\\u000F",
  "\\u0010",
  "\\u0011",
  "\\u0012",
  "\\u0013",
  "\\u0014",
  "\\u0015",
  "\\u0016",
  "\\u0017",
  "\\u0018",
  "\\u0019",
  "\\u001A",
  "\\u001B",
  "\\u001C",
  "\\u001D",
  "\\u001E",
  "\\u001F",
  "",
  "",
  "\\\"",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "\\\\",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "\\u007F",
  "\\u0080",
  "\\u0081",
  "\\u0082",
  "\\u0083",
  "\\u0084",
  "\\u0085",
  "\\u0086",
  "\\u0087",
  "\\u0088",
  "\\u0089",
  "\\u008A",
  "\\u008B",
  "\\u008C",
  "\\u008D",
  "\\u008E",
  "\\u008F",
  "\\u0090",
  "\\u0091",
  "\\u0092",
  "\\u0093",
  "\\u0094",
  "\\u0095",
  "\\u0096",
  "\\u0097",
  "\\u0098",
  "\\u0099",
  "\\u009A",
  "\\u009B",
  "\\u009C",
  "\\u009D",
  "\\u009E",
  "\\u009F"
];

// node_modules/graphql/language/visitor.mjs
var BREAK = Object.freeze({});
function visit(root, visitor, visitorKeys = QueryDocumentKeys) {
  const enterLeaveMap = new Map;
  for (const kind of Object.values(Kind)) {
    enterLeaveMap.set(kind, getEnterLeaveForKind(visitor, kind));
  }
  let stack = undefined;
  let inArray = Array.isArray(root);
  let keys = [root];
  let index = -1;
  let edits = [];
  let node = root;
  let key = undefined;
  let parent = undefined;
  const path = [];
  const ancestors = [];
  do {
    index++;
    const isLeaving = index === keys.length;
    const isEdited = isLeaving && edits.length !== 0;
    if (isLeaving) {
      key = ancestors.length === 0 ? undefined : path[path.length - 1];
      node = parent;
      parent = ancestors.pop();
      if (isEdited) {
        if (inArray) {
          node = node.slice();
          let editOffset = 0;
          for (const [editKey, editValue] of edits) {
            const arrayKey = editKey - editOffset;
            if (editValue === null) {
              node.splice(arrayKey, 1);
              editOffset++;
            } else {
              node[arrayKey] = editValue;
            }
          }
        } else {
          node = { ...node };
          for (const [editKey, editValue] of edits) {
            node[editKey] = editValue;
          }
        }
      }
      index = stack.index;
      keys = stack.keys;
      edits = stack.edits;
      inArray = stack.inArray;
      stack = stack.prev;
    } else if (parent) {
      key = inArray ? index : keys[index];
      node = parent[key];
      if (node === null || node === undefined) {
        continue;
      }
      path.push(key);
    }
    let result;
    if (!Array.isArray(node)) {
      var _enterLeaveMap$get, _enterLeaveMap$get2;
      isNode(node) || devAssert(false, `Invalid AST Node: ${inspect(node)}.`);
      const visitFn = isLeaving ? (_enterLeaveMap$get = enterLeaveMap.get(node.kind)) === null || _enterLeaveMap$get === undefined ? undefined : _enterLeaveMap$get.leave : (_enterLeaveMap$get2 = enterLeaveMap.get(node.kind)) === null || _enterLeaveMap$get2 === undefined ? undefined : _enterLeaveMap$get2.enter;
      result = visitFn === null || visitFn === undefined ? undefined : visitFn.call(visitor, node, key, parent, path, ancestors);
      if (result === BREAK) {
        break;
      }
      if (result === false) {
        if (!isLeaving) {
          path.pop();
          continue;
        }
      } else if (result !== undefined) {
        edits.push([key, result]);
        if (!isLeaving) {
          if (isNode(result)) {
            node = result;
          } else {
            path.pop();
            continue;
          }
        }
      }
    }
    if (result === undefined && isEdited) {
      edits.push([key, node]);
    }
    if (isLeaving) {
      path.pop();
    } else {
      var _node$kind;
      stack = {
        inArray,
        index,
        keys,
        edits,
        prev: stack
      };
      inArray = Array.isArray(node);
      keys = inArray ? node : (_node$kind = visitorKeys[node.kind]) !== null && _node$kind !== undefined ? _node$kind : [];
      index = -1;
      edits = [];
      if (parent) {
        ancestors.push(parent);
      }
      parent = node;
    }
  } while (stack !== undefined);
  if (edits.length !== 0) {
    return edits[edits.length - 1][1];
  }
  return root;
}
function visitInParallel(visitors) {
  const skipping = new Array(visitors.length).fill(null);
  const mergedVisitor = Object.create(null);
  for (const kind of Object.values(Kind)) {
    let hasVisitor = false;
    const enterList = new Array(visitors.length).fill(undefined);
    const leaveList = new Array(visitors.length).fill(undefined);
    for (let i = 0;i < visitors.length; ++i) {
      const { enter, leave } = getEnterLeaveForKind(visitors[i], kind);
      hasVisitor || (hasVisitor = enter != null || leave != null);
      enterList[i] = enter;
      leaveList[i] = leave;
    }
    if (!hasVisitor) {
      continue;
    }
    const mergedEnterLeave = {
      enter(...args) {
        const node = args[0];
        for (let i = 0;i < visitors.length; i++) {
          if (skipping[i] === null) {
            var _enterList$i;
            const result = (_enterList$i = enterList[i]) === null || _enterList$i === undefined ? undefined : _enterList$i.apply(visitors[i], args);
            if (result === false) {
              skipping[i] = node;
            } else if (result === BREAK) {
              skipping[i] = BREAK;
            } else if (result !== undefined) {
              return result;
            }
          }
        }
      },
      leave(...args) {
        const node = args[0];
        for (let i = 0;i < visitors.length; i++) {
          if (skipping[i] === null) {
            var _leaveList$i;
            const result = (_leaveList$i = leaveList[i]) === null || _leaveList$i === undefined ? undefined : _leaveList$i.apply(visitors[i], args);
            if (result === BREAK) {
              skipping[i] = BREAK;
            } else if (result !== undefined && result !== false) {
              return result;
            }
          } else if (skipping[i] === node) {
            skipping[i] = null;
          }
        }
      }
    };
    mergedVisitor[kind] = mergedEnterLeave;
  }
  return mergedVisitor;
}
function getEnterLeaveForKind(visitor, kind) {
  const kindVisitor = visitor[kind];
  if (typeof kindVisitor === "object") {
    return kindVisitor;
  } else if (typeof kindVisitor === "function") {
    return {
      enter: kindVisitor,
      leave: undefined
    };
  }
  return {
    enter: visitor.enter,
    leave: visitor.leave
  };
}

// node_modules/graphql/language/printer.mjs
function print(ast) {
  return visit(ast, printDocASTReducer);
}
var MAX_LINE_LENGTH = 80;
var printDocASTReducer = {
  Name: {
    leave: (node) => node.value
  },
  Variable: {
    leave: (node) => "$" + node.name
  },
  Document: {
    leave: (node) => join9(node.definitions, `

`)
  },
  OperationDefinition: {
    leave(node) {
      const varDefs = hasMultilineItems(node.variableDefinitions) ? wrap(`(
`, join9(node.variableDefinitions, `
`), `
)`) : wrap("(", join9(node.variableDefinitions, ", "), ")");
      const prefix = wrap("", node.description, `
`) + join9([
        node.operation,
        join9([node.name, varDefs]),
        join9(node.directives, " ")
      ], " ");
      return (prefix === "query" ? "" : prefix + " ") + node.selectionSet;
    }
  },
  VariableDefinition: {
    leave: ({ variable, type, defaultValue, directives, description }) => wrap("", description, `
`) + variable + ": " + type + wrap(" = ", defaultValue) + wrap(" ", join9(directives, " "))
  },
  SelectionSet: {
    leave: ({ selections }) => block(selections)
  },
  Field: {
    leave({ alias, name, arguments: args, directives, selectionSet }) {
      const prefix = wrap("", alias, ": ") + name;
      let argsLine = prefix + wrap("(", join9(args, ", "), ")");
      if (argsLine.length > MAX_LINE_LENGTH) {
        argsLine = prefix + wrap(`(
`, indent(join9(args, `
`)), `
)`);
      }
      return join9([argsLine, join9(directives, " "), selectionSet], " ");
    }
  },
  Argument: {
    leave: ({ name, value }) => name + ": " + value
  },
  FragmentSpread: {
    leave: ({ name, directives }) => "..." + name + wrap(" ", join9(directives, " "))
  },
  InlineFragment: {
    leave: ({ typeCondition, directives, selectionSet }) => join9([
      "...",
      wrap("on ", typeCondition),
      join9(directives, " "),
      selectionSet
    ], " ")
  },
  FragmentDefinition: {
    leave: ({
      name,
      typeCondition,
      variableDefinitions,
      directives,
      selectionSet,
      description
    }) => wrap("", description, `
`) + `fragment ${name}${wrap("(", join9(variableDefinitions, ", "), ")")} ` + `on ${typeCondition} ${wrap("", join9(directives, " "), " ")}` + selectionSet
  },
  IntValue: {
    leave: ({ value }) => value
  },
  FloatValue: {
    leave: ({ value }) => value
  },
  StringValue: {
    leave: ({ value, block: isBlockString }) => isBlockString ? printBlockString(value) : printString(value)
  },
  BooleanValue: {
    leave: ({ value }) => value ? "true" : "false"
  },
  NullValue: {
    leave: () => "null"
  },
  EnumValue: {
    leave: ({ value }) => value
  },
  ListValue: {
    leave: ({ values }) => "[" + join9(values, ", ") + "]"
  },
  ObjectValue: {
    leave: ({ fields }) => "{" + join9(fields, ", ") + "}"
  },
  ObjectField: {
    leave: ({ name, value }) => name + ": " + value
  },
  Directive: {
    leave: ({ name, arguments: args }) => "@" + name + wrap("(", join9(args, ", "), ")")
  },
  NamedType: {
    leave: ({ name }) => name
  },
  ListType: {
    leave: ({ type }) => "[" + type + "]"
  },
  NonNullType: {
    leave: ({ type }) => type + "!"
  },
  SchemaDefinition: {
    leave: ({ description, directives, operationTypes }) => wrap("", description, `
`) + join9(["schema", join9(directives, " "), block(operationTypes)], " ")
  },
  OperationTypeDefinition: {
    leave: ({ operation, type }) => operation + ": " + type
  },
  ScalarTypeDefinition: {
    leave: ({ description, name, directives }) => wrap("", description, `
`) + join9(["scalar", name, join9(directives, " ")], " ")
  },
  ObjectTypeDefinition: {
    leave: ({ description, name, interfaces, directives, fields }) => wrap("", description, `
`) + join9([
      "type",
      name,
      wrap("implements ", join9(interfaces, " & ")),
      join9(directives, " "),
      block(fields)
    ], " ")
  },
  FieldDefinition: {
    leave: ({ description, name, arguments: args, type, directives }) => wrap("", description, `
`) + name + (hasMultilineItems(args) ? wrap(`(
`, indent(join9(args, `
`)), `
)`) : wrap("(", join9(args, ", "), ")")) + ": " + type + wrap(" ", join9(directives, " "))
  },
  InputValueDefinition: {
    leave: ({ description, name, type, defaultValue, directives }) => wrap("", description, `
`) + join9([name + ": " + type, wrap("= ", defaultValue), join9(directives, " ")], " ")
  },
  InterfaceTypeDefinition: {
    leave: ({ description, name, interfaces, directives, fields }) => wrap("", description, `
`) + join9([
      "interface",
      name,
      wrap("implements ", join9(interfaces, " & ")),
      join9(directives, " "),
      block(fields)
    ], " ")
  },
  UnionTypeDefinition: {
    leave: ({ description, name, directives, types }) => wrap("", description, `
`) + join9(["union", name, join9(directives, " "), wrap("= ", join9(types, " | "))], " ")
  },
  EnumTypeDefinition: {
    leave: ({ description, name, directives, values }) => wrap("", description, `
`) + join9(["enum", name, join9(directives, " "), block(values)], " ")
  },
  EnumValueDefinition: {
    leave: ({ description, name, directives }) => wrap("", description, `
`) + join9([name, join9(directives, " ")], " ")
  },
  InputObjectTypeDefinition: {
    leave: ({ description, name, directives, fields }) => wrap("", description, `
`) + join9(["input", name, join9(directives, " "), block(fields)], " ")
  },
  DirectiveDefinition: {
    leave: ({ description, name, arguments: args, repeatable, locations }) => wrap("", description, `
`) + "directive @" + name + (hasMultilineItems(args) ? wrap(`(
`, indent(join9(args, `
`)), `
)`) : wrap("(", join9(args, ", "), ")")) + (repeatable ? " repeatable" : "") + " on " + join9(locations, " | ")
  },
  SchemaExtension: {
    leave: ({ directives, operationTypes }) => join9(["extend schema", join9(directives, " "), block(operationTypes)], " ")
  },
  ScalarTypeExtension: {
    leave: ({ name, directives }) => join9(["extend scalar", name, join9(directives, " ")], " ")
  },
  ObjectTypeExtension: {
    leave: ({ name, interfaces, directives, fields }) => join9([
      "extend type",
      name,
      wrap("implements ", join9(interfaces, " & ")),
      join9(directives, " "),
      block(fields)
    ], " ")
  },
  InterfaceTypeExtension: {
    leave: ({ name, interfaces, directives, fields }) => join9([
      "extend interface",
      name,
      wrap("implements ", join9(interfaces, " & ")),
      join9(directives, " "),
      block(fields)
    ], " ")
  },
  UnionTypeExtension: {
    leave: ({ name, directives, types }) => join9([
      "extend union",
      name,
      join9(directives, " "),
      wrap("= ", join9(types, " | "))
    ], " ")
  },
  EnumTypeExtension: {
    leave: ({ name, directives, values }) => join9(["extend enum", name, join9(directives, " "), block(values)], " ")
  },
  InputObjectTypeExtension: {
    leave: ({ name, directives, fields }) => join9(["extend input", name, join9(directives, " "), block(fields)], " ")
  },
  TypeCoordinate: {
    leave: ({ name }) => name
  },
  MemberCoordinate: {
    leave: ({ name, memberName }) => join9([name, wrap(".", memberName)])
  },
  ArgumentCoordinate: {
    leave: ({ name, fieldName, argumentName }) => join9([name, wrap(".", fieldName), wrap("(", argumentName, ":)")])
  },
  DirectiveCoordinate: {
    leave: ({ name }) => join9(["@", name])
  },
  DirectiveArgumentCoordinate: {
    leave: ({ name, argumentName }) => join9(["@", name, wrap("(", argumentName, ":)")])
  }
};
function join9(maybeArray, separator = "") {
  var _maybeArray$filter$jo;
  return (_maybeArray$filter$jo = maybeArray === null || maybeArray === undefined ? undefined : maybeArray.filter((x) => x).join(separator)) !== null && _maybeArray$filter$jo !== undefined ? _maybeArray$filter$jo : "";
}
function block(array) {
  return wrap(`{
`, indent(join9(array, `
`)), `
}`);
}
function wrap(start, maybeString, end = "") {
  return maybeString != null && maybeString !== "" ? start + maybeString + end : "";
}
function indent(str) {
  return wrap("  ", str.replace(/\n/g, `
  `));
}
function hasMultilineItems(maybeArray) {
  var _maybeArray$some;
  return (_maybeArray$some = maybeArray === null || maybeArray === undefined ? undefined : maybeArray.some((str) => str.includes(`
`))) !== null && _maybeArray$some !== undefined ? _maybeArray$some : false;
}

// node_modules/graphql/utilities/valueFromASTUntyped.mjs
function valueFromASTUntyped(valueNode, variables) {
  switch (valueNode.kind) {
    case Kind.NULL:
      return null;
    case Kind.INT:
      return parseInt(valueNode.value, 10);
    case Kind.FLOAT:
      return parseFloat(valueNode.value);
    case Kind.STRING:
    case Kind.ENUM:
    case Kind.BOOLEAN:
      return valueNode.value;
    case Kind.LIST:
      return valueNode.values.map((node) => valueFromASTUntyped(node, variables));
    case Kind.OBJECT:
      return keyValMap(valueNode.fields, (field) => field.name.value, (field) => valueFromASTUntyped(field.value, variables));
    case Kind.VARIABLE:
      return variables === null || variables === undefined ? undefined : variables[valueNode.name.value];
  }
}

// node_modules/graphql/type/assertName.mjs
function assertName(name) {
  name != null || devAssert(false, "Must provide name.");
  typeof name === "string" || devAssert(false, "Expected name to be a string.");
  if (name.length === 0) {
    throw new GraphQLError("Expected name to be a non-empty string.");
  }
  for (let i = 1;i < name.length; ++i) {
    if (!isNameContinue(name.charCodeAt(i))) {
      throw new GraphQLError(`Names must only contain [_a-zA-Z0-9] but "${name}" does not.`);
    }
  }
  if (!isNameStart(name.charCodeAt(0))) {
    throw new GraphQLError(`Names must start with [_a-zA-Z] but "${name}" does not.`);
  }
  return name;
}
function assertEnumValueName(name) {
  if (name === "true" || name === "false" || name === "null") {
    throw new GraphQLError(`Enum values cannot be named: ${name}`);
  }
  return assertName(name);
}

// node_modules/graphql/type/definition.mjs
function isType(type) {
  return isScalarType(type) || isObjectType(type) || isInterfaceType(type) || isUnionType(type) || isEnumType(type) || isInputObjectType(type) || isListType(type) || isNonNullType(type);
}
function isScalarType(type) {
  return instanceOf(type, GraphQLScalarType);
}
function isObjectType(type) {
  return instanceOf(type, GraphQLObjectType);
}
function isInterfaceType(type) {
  return instanceOf(type, GraphQLInterfaceType);
}
function isUnionType(type) {
  return instanceOf(type, GraphQLUnionType);
}
function isEnumType(type) {
  return instanceOf(type, GraphQLEnumType);
}
function isInputObjectType(type) {
  return instanceOf(type, GraphQLInputObjectType);
}
function isListType(type) {
  return instanceOf(type, GraphQLList);
}
function isNonNullType(type) {
  return instanceOf(type, GraphQLNonNull);
}
function isInputType(type) {
  return isScalarType(type) || isEnumType(type) || isInputObjectType(type) || isWrappingType(type) && isInputType(type.ofType);
}
function isOutputType(type) {
  return isScalarType(type) || isObjectType(type) || isInterfaceType(type) || isUnionType(type) || isEnumType(type) || isWrappingType(type) && isOutputType(type.ofType);
}
function isLeafType(type) {
  return isScalarType(type) || isEnumType(type);
}
function isCompositeType(type) {
  return isObjectType(type) || isInterfaceType(type) || isUnionType(type);
}
function isAbstractType(type) {
  return isInterfaceType(type) || isUnionType(type);
}
class GraphQLList {
  constructor(ofType) {
    isType(ofType) || devAssert(false, `Expected ${inspect(ofType)} to be a GraphQL type.`);
    this.ofType = ofType;
  }
  get [Symbol.toStringTag]() {
    return "GraphQLList";
  }
  toString() {
    return "[" + String(this.ofType) + "]";
  }
  toJSON() {
    return this.toString();
  }
}

class GraphQLNonNull {
  constructor(ofType) {
    isNullableType(ofType) || devAssert(false, `Expected ${inspect(ofType)} to be a GraphQL nullable type.`);
    this.ofType = ofType;
  }
  get [Symbol.toStringTag]() {
    return "GraphQLNonNull";
  }
  toString() {
    return String(this.ofType) + "!";
  }
  toJSON() {
    return this.toString();
  }
}
function isWrappingType(type) {
  return isListType(type) || isNonNullType(type);
}
function isNullableType(type) {
  return isType(type) && !isNonNullType(type);
}
function getNullableType(type) {
  if (type) {
    return isNonNullType(type) ? type.ofType : type;
  }
}
function isNamedType(type) {
  return isScalarType(type) || isObjectType(type) || isInterfaceType(type) || isUnionType(type) || isEnumType(type) || isInputObjectType(type);
}
function getNamedType(type) {
  if (type) {
    let unwrappedType = type;
    while (isWrappingType(unwrappedType)) {
      unwrappedType = unwrappedType.ofType;
    }
    return unwrappedType;
  }
}
function resolveReadonlyArrayThunk(thunk) {
  return typeof thunk === "function" ? thunk() : thunk;
}
function resolveObjMapThunk(thunk) {
  return typeof thunk === "function" ? thunk() : thunk;
}

class GraphQLScalarType {
  constructor(config) {
    var _config$parseValue, _config$serialize, _config$parseLiteral, _config$extensionASTN;
    const parseValue = (_config$parseValue = config.parseValue) !== null && _config$parseValue !== undefined ? _config$parseValue : identityFunc;
    this.name = assertName(config.name);
    this.description = config.description;
    this.specifiedByURL = config.specifiedByURL;
    this.serialize = (_config$serialize = config.serialize) !== null && _config$serialize !== undefined ? _config$serialize : identityFunc;
    this.parseValue = parseValue;
    this.parseLiteral = (_config$parseLiteral = config.parseLiteral) !== null && _config$parseLiteral !== undefined ? _config$parseLiteral : (node, variables) => parseValue(valueFromASTUntyped(node, variables));
    this.extensions = toObjMap(config.extensions);
    this.astNode = config.astNode;
    this.extensionASTNodes = (_config$extensionASTN = config.extensionASTNodes) !== null && _config$extensionASTN !== undefined ? _config$extensionASTN : [];
    config.specifiedByURL == null || typeof config.specifiedByURL === "string" || devAssert(false, `${this.name} must provide "specifiedByURL" as a string, ` + `but got: ${inspect(config.specifiedByURL)}.`);
    config.serialize == null || typeof config.serialize === "function" || devAssert(false, `${this.name} must provide "serialize" function. If this custom Scalar is also used as an input type, ensure "parseValue" and "parseLiteral" functions are also provided.`);
    if (config.parseLiteral) {
      typeof config.parseValue === "function" && typeof config.parseLiteral === "function" || devAssert(false, `${this.name} must provide both "parseValue" and "parseLiteral" functions.`);
    }
  }
  get [Symbol.toStringTag]() {
    return "GraphQLScalarType";
  }
  toConfig() {
    return {
      name: this.name,
      description: this.description,
      specifiedByURL: this.specifiedByURL,
      serialize: this.serialize,
      parseValue: this.parseValue,
      parseLiteral: this.parseLiteral,
      extensions: this.extensions,
      astNode: this.astNode,
      extensionASTNodes: this.extensionASTNodes
    };
  }
  toString() {
    return this.name;
  }
  toJSON() {
    return this.toString();
  }
}

class GraphQLObjectType {
  constructor(config) {
    var _config$extensionASTN2;
    this.name = assertName(config.name);
    this.description = config.description;
    this.isTypeOf = config.isTypeOf;
    this.extensions = toObjMap(config.extensions);
    this.astNode = config.astNode;
    this.extensionASTNodes = (_config$extensionASTN2 = config.extensionASTNodes) !== null && _config$extensionASTN2 !== undefined ? _config$extensionASTN2 : [];
    this._fields = () => defineFieldMap(config);
    this._interfaces = () => defineInterfaces(config);
    config.isTypeOf == null || typeof config.isTypeOf === "function" || devAssert(false, `${this.name} must provide "isTypeOf" as a function, ` + `but got: ${inspect(config.isTypeOf)}.`);
  }
  get [Symbol.toStringTag]() {
    return "GraphQLObjectType";
  }
  getFields() {
    if (typeof this._fields === "function") {
      this._fields = this._fields();
    }
    return this._fields;
  }
  getInterfaces() {
    if (typeof this._interfaces === "function") {
      this._interfaces = this._interfaces();
    }
    return this._interfaces;
  }
  toConfig() {
    return {
      name: this.name,
      description: this.description,
      interfaces: this.getInterfaces(),
      fields: fieldsToFieldsConfig(this.getFields()),
      isTypeOf: this.isTypeOf,
      extensions: this.extensions,
      astNode: this.astNode,
      extensionASTNodes: this.extensionASTNodes
    };
  }
  toString() {
    return this.name;
  }
  toJSON() {
    return this.toString();
  }
}
function defineInterfaces(config) {
  var _config$interfaces;
  const interfaces = resolveReadonlyArrayThunk((_config$interfaces = config.interfaces) !== null && _config$interfaces !== undefined ? _config$interfaces : []);
  Array.isArray(interfaces) || devAssert(false, `${config.name} interfaces must be an Array or a function which returns an Array.`);
  return interfaces;
}
function defineFieldMap(config) {
  const fieldMap = resolveObjMapThunk(config.fields);
  isPlainObj(fieldMap) || devAssert(false, `${config.name} fields must be an object with field names as keys or a function which returns such an object.`);
  return mapValue(fieldMap, (fieldConfig, fieldName) => {
    var _fieldConfig$args;
    isPlainObj(fieldConfig) || devAssert(false, `${config.name}.${fieldName} field config must be an object.`);
    fieldConfig.resolve == null || typeof fieldConfig.resolve === "function" || devAssert(false, `${config.name}.${fieldName} field resolver must be a function if ` + `provided, but got: ${inspect(fieldConfig.resolve)}.`);
    const argsConfig = (_fieldConfig$args = fieldConfig.args) !== null && _fieldConfig$args !== undefined ? _fieldConfig$args : {};
    isPlainObj(argsConfig) || devAssert(false, `${config.name}.${fieldName} args must be an object with argument names as keys.`);
    return {
      name: assertName(fieldName),
      description: fieldConfig.description,
      type: fieldConfig.type,
      args: defineArguments(argsConfig),
      resolve: fieldConfig.resolve,
      subscribe: fieldConfig.subscribe,
      deprecationReason: fieldConfig.deprecationReason,
      extensions: toObjMap(fieldConfig.extensions),
      astNode: fieldConfig.astNode
    };
  });
}
function defineArguments(config) {
  return Object.entries(config).map(([argName, argConfig]) => ({
    name: assertName(argName),
    description: argConfig.description,
    type: argConfig.type,
    defaultValue: argConfig.defaultValue,
    deprecationReason: argConfig.deprecationReason,
    extensions: toObjMap(argConfig.extensions),
    astNode: argConfig.astNode
  }));
}
function isPlainObj(obj) {
  return isObjectLike(obj) && !Array.isArray(obj);
}
function fieldsToFieldsConfig(fields) {
  return mapValue(fields, (field) => ({
    description: field.description,
    type: field.type,
    args: argsToArgsConfig(field.args),
    resolve: field.resolve,
    subscribe: field.subscribe,
    deprecationReason: field.deprecationReason,
    extensions: field.extensions,
    astNode: field.astNode
  }));
}
function argsToArgsConfig(args) {
  return keyValMap(args, (arg) => arg.name, (arg) => ({
    description: arg.description,
    type: arg.type,
    defaultValue: arg.defaultValue,
    deprecationReason: arg.deprecationReason,
    extensions: arg.extensions,
    astNode: arg.astNode
  }));
}
function isRequiredArgument(arg) {
  return isNonNullType(arg.type) && arg.defaultValue === undefined;
}

class GraphQLInterfaceType {
  constructor(config) {
    var _config$extensionASTN3;
    this.name = assertName(config.name);
    this.description = config.description;
    this.resolveType = config.resolveType;
    this.extensions = toObjMap(config.extensions);
    this.astNode = config.astNode;
    this.extensionASTNodes = (_config$extensionASTN3 = config.extensionASTNodes) !== null && _config$extensionASTN3 !== undefined ? _config$extensionASTN3 : [];
    this._fields = defineFieldMap.bind(undefined, config);
    this._interfaces = defineInterfaces.bind(undefined, config);
    config.resolveType == null || typeof config.resolveType === "function" || devAssert(false, `${this.name} must provide "resolveType" as a function, ` + `but got: ${inspect(config.resolveType)}.`);
  }
  get [Symbol.toStringTag]() {
    return "GraphQLInterfaceType";
  }
  getFields() {
    if (typeof this._fields === "function") {
      this._fields = this._fields();
    }
    return this._fields;
  }
  getInterfaces() {
    if (typeof this._interfaces === "function") {
      this._interfaces = this._interfaces();
    }
    return this._interfaces;
  }
  toConfig() {
    return {
      name: this.name,
      description: this.description,
      interfaces: this.getInterfaces(),
      fields: fieldsToFieldsConfig(this.getFields()),
      resolveType: this.resolveType,
      extensions: this.extensions,
      astNode: this.astNode,
      extensionASTNodes: this.extensionASTNodes
    };
  }
  toString() {
    return this.name;
  }
  toJSON() {
    return this.toString();
  }
}

class GraphQLUnionType {
  constructor(config) {
    var _config$extensionASTN4;
    this.name = assertName(config.name);
    this.description = config.description;
    this.resolveType = config.resolveType;
    this.extensions = toObjMap(config.extensions);
    this.astNode = config.astNode;
    this.extensionASTNodes = (_config$extensionASTN4 = config.extensionASTNodes) !== null && _config$extensionASTN4 !== undefined ? _config$extensionASTN4 : [];
    this._types = defineTypes.bind(undefined, config);
    config.resolveType == null || typeof config.resolveType === "function" || devAssert(false, `${this.name} must provide "resolveType" as a function, ` + `but got: ${inspect(config.resolveType)}.`);
  }
  get [Symbol.toStringTag]() {
    return "GraphQLUnionType";
  }
  getTypes() {
    if (typeof this._types === "function") {
      this._types = this._types();
    }
    return this._types;
  }
  toConfig() {
    return {
      name: this.name,
      description: this.description,
      types: this.getTypes(),
      resolveType: this.resolveType,
      extensions: this.extensions,
      astNode: this.astNode,
      extensionASTNodes: this.extensionASTNodes
    };
  }
  toString() {
    return this.name;
  }
  toJSON() {
    return this.toString();
  }
}
function defineTypes(config) {
  const types = resolveReadonlyArrayThunk(config.types);
  Array.isArray(types) || devAssert(false, `Must provide Array of types or a function which returns such an array for Union ${config.name}.`);
  return types;
}

class GraphQLEnumType {
  constructor(config) {
    var _config$extensionASTN5;
    this.name = assertName(config.name);
    this.description = config.description;
    this.extensions = toObjMap(config.extensions);
    this.astNode = config.astNode;
    this.extensionASTNodes = (_config$extensionASTN5 = config.extensionASTNodes) !== null && _config$extensionASTN5 !== undefined ? _config$extensionASTN5 : [];
    this._values = typeof config.values === "function" ? config.values : defineEnumValues(this.name, config.values);
    this._valueLookup = null;
    this._nameLookup = null;
  }
  get [Symbol.toStringTag]() {
    return "GraphQLEnumType";
  }
  getValues() {
    if (typeof this._values === "function") {
      this._values = defineEnumValues(this.name, this._values());
    }
    return this._values;
  }
  getValue(name) {
    if (this._nameLookup === null) {
      this._nameLookup = keyMap(this.getValues(), (value) => value.name);
    }
    return this._nameLookup[name];
  }
  serialize(outputValue) {
    if (this._valueLookup === null) {
      this._valueLookup = new Map(this.getValues().map((enumValue2) => [enumValue2.value, enumValue2]));
    }
    const enumValue = this._valueLookup.get(outputValue);
    if (enumValue === undefined) {
      throw new GraphQLError(`Enum "${this.name}" cannot represent value: ${inspect(outputValue)}`);
    }
    return enumValue.name;
  }
  parseValue(inputValue) {
    if (typeof inputValue !== "string") {
      const valueStr = inspect(inputValue);
      throw new GraphQLError(`Enum "${this.name}" cannot represent non-string value: ${valueStr}.` + didYouMeanEnumValue(this, valueStr));
    }
    const enumValue = this.getValue(inputValue);
    if (enumValue == null) {
      throw new GraphQLError(`Value "${inputValue}" does not exist in "${this.name}" enum.` + didYouMeanEnumValue(this, inputValue));
    }
    return enumValue.value;
  }
  parseLiteral(valueNode, _variables) {
    if (valueNode.kind !== Kind.ENUM) {
      const valueStr = print(valueNode);
      throw new GraphQLError(`Enum "${this.name}" cannot represent non-enum value: ${valueStr}.` + didYouMeanEnumValue(this, valueStr), {
        nodes: valueNode
      });
    }
    const enumValue = this.getValue(valueNode.value);
    if (enumValue == null) {
      const valueStr = print(valueNode);
      throw new GraphQLError(`Value "${valueStr}" does not exist in "${this.name}" enum.` + didYouMeanEnumValue(this, valueStr), {
        nodes: valueNode
      });
    }
    return enumValue.value;
  }
  toConfig() {
    const values = keyValMap(this.getValues(), (value) => value.name, (value) => ({
      description: value.description,
      value: value.value,
      deprecationReason: value.deprecationReason,
      extensions: value.extensions,
      astNode: value.astNode
    }));
    return {
      name: this.name,
      description: this.description,
      values,
      extensions: this.extensions,
      astNode: this.astNode,
      extensionASTNodes: this.extensionASTNodes
    };
  }
  toString() {
    return this.name;
  }
  toJSON() {
    return this.toString();
  }
}
function didYouMeanEnumValue(enumType, unknownValueStr) {
  const allNames = enumType.getValues().map((value) => value.name);
  const suggestedValues = suggestionList(unknownValueStr, allNames);
  return didYouMean("the enum value", suggestedValues);
}
function defineEnumValues(typeName, valueMap) {
  isPlainObj(valueMap) || devAssert(false, `${typeName} values must be an object with value names as keys.`);
  return Object.entries(valueMap).map(([valueName, valueConfig]) => {
    isPlainObj(valueConfig) || devAssert(false, `${typeName}.${valueName} must refer to an object with a "value" key ` + `representing an internal value but got: ${inspect(valueConfig)}.`);
    return {
      name: assertEnumValueName(valueName),
      description: valueConfig.description,
      value: valueConfig.value !== undefined ? valueConfig.value : valueName,
      deprecationReason: valueConfig.deprecationReason,
      extensions: toObjMap(valueConfig.extensions),
      astNode: valueConfig.astNode
    };
  });
}

class GraphQLInputObjectType {
  constructor(config) {
    var _config$extensionASTN6, _config$isOneOf;
    this.name = assertName(config.name);
    this.description = config.description;
    this.extensions = toObjMap(config.extensions);
    this.astNode = config.astNode;
    this.extensionASTNodes = (_config$extensionASTN6 = config.extensionASTNodes) !== null && _config$extensionASTN6 !== undefined ? _config$extensionASTN6 : [];
    this.isOneOf = (_config$isOneOf = config.isOneOf) !== null && _config$isOneOf !== undefined ? _config$isOneOf : false;
    this._fields = defineInputFieldMap.bind(undefined, config);
  }
  get [Symbol.toStringTag]() {
    return "GraphQLInputObjectType";
  }
  getFields() {
    if (typeof this._fields === "function") {
      this._fields = this._fields();
    }
    return this._fields;
  }
  toConfig() {
    const fields = mapValue(this.getFields(), (field) => ({
      description: field.description,
      type: field.type,
      defaultValue: field.defaultValue,
      deprecationReason: field.deprecationReason,
      extensions: field.extensions,
      astNode: field.astNode
    }));
    return {
      name: this.name,
      description: this.description,
      fields,
      extensions: this.extensions,
      astNode: this.astNode,
      extensionASTNodes: this.extensionASTNodes,
      isOneOf: this.isOneOf
    };
  }
  toString() {
    return this.name;
  }
  toJSON() {
    return this.toString();
  }
}
function defineInputFieldMap(config) {
  const fieldMap = resolveObjMapThunk(config.fields);
  isPlainObj(fieldMap) || devAssert(false, `${config.name} fields must be an object with field names as keys or a function which returns such an object.`);
  return mapValue(fieldMap, (fieldConfig, fieldName) => {
    !("resolve" in fieldConfig) || devAssert(false, `${config.name}.${fieldName} field has a resolve property, but Input Types cannot define resolvers.`);
    return {
      name: assertName(fieldName),
      description: fieldConfig.description,
      type: fieldConfig.type,
      defaultValue: fieldConfig.defaultValue,
      deprecationReason: fieldConfig.deprecationReason,
      extensions: toObjMap(fieldConfig.extensions),
      astNode: fieldConfig.astNode
    };
  });
}
function isRequiredInputField(field) {
  return isNonNullType(field.type) && field.defaultValue === undefined;
}

// node_modules/graphql/utilities/typeComparators.mjs
function isEqualType(typeA, typeB) {
  if (typeA === typeB) {
    return true;
  }
  if (isNonNullType(typeA) && isNonNullType(typeB)) {
    return isEqualType(typeA.ofType, typeB.ofType);
  }
  if (isListType(typeA) && isListType(typeB)) {
    return isEqualType(typeA.ofType, typeB.ofType);
  }
  return false;
}
function isTypeSubTypeOf(schema, maybeSubType, superType) {
  if (maybeSubType === superType) {
    return true;
  }
  if (isNonNullType(superType)) {
    if (isNonNullType(maybeSubType)) {
      return isTypeSubTypeOf(schema, maybeSubType.ofType, superType.ofType);
    }
    return false;
  }
  if (isNonNullType(maybeSubType)) {
    return isTypeSubTypeOf(schema, maybeSubType.ofType, superType);
  }
  if (isListType(superType)) {
    if (isListType(maybeSubType)) {
      return isTypeSubTypeOf(schema, maybeSubType.ofType, superType.ofType);
    }
    return false;
  }
  if (isListType(maybeSubType)) {
    return false;
  }
  return isAbstractType(superType) && (isInterfaceType(maybeSubType) || isObjectType(maybeSubType)) && schema.isSubType(superType, maybeSubType);
}
function doTypesOverlap(schema, typeA, typeB) {
  if (typeA === typeB) {
    return true;
  }
  if (isAbstractType(typeA)) {
    if (isAbstractType(typeB)) {
      return schema.getPossibleTypes(typeA).some((type) => schema.isSubType(typeB, type));
    }
    return schema.isSubType(typeA, typeB);
  }
  if (isAbstractType(typeB)) {
    return schema.isSubType(typeB, typeA);
  }
  return false;
}

// node_modules/graphql/type/scalars.mjs
var GRAPHQL_MAX_INT = 2147483647;
var GRAPHQL_MIN_INT = -2147483648;
var GraphQLInt = new GraphQLScalarType({
  name: "Int",
  description: "The `Int` scalar type represents non-fractional signed whole numeric values. Int can represent values between -(2^31) and 2^31 - 1.",
  serialize(outputValue) {
    const coercedValue = serializeObject(outputValue);
    if (typeof coercedValue === "boolean") {
      return coercedValue ? 1 : 0;
    }
    let num = coercedValue;
    if (typeof coercedValue === "string" && coercedValue !== "") {
      num = Number(coercedValue);
    }
    if (typeof num !== "number" || !Number.isInteger(num)) {
      throw new GraphQLError(`Int cannot represent non-integer value: ${inspect(coercedValue)}`);
    }
    if (num > GRAPHQL_MAX_INT || num < GRAPHQL_MIN_INT) {
      throw new GraphQLError("Int cannot represent non 32-bit signed integer value: " + inspect(coercedValue));
    }
    return num;
  },
  parseValue(inputValue) {
    if (typeof inputValue !== "number" || !Number.isInteger(inputValue)) {
      throw new GraphQLError(`Int cannot represent non-integer value: ${inspect(inputValue)}`);
    }
    if (inputValue > GRAPHQL_MAX_INT || inputValue < GRAPHQL_MIN_INT) {
      throw new GraphQLError(`Int cannot represent non 32-bit signed integer value: ${inputValue}`);
    }
    return inputValue;
  },
  parseLiteral(valueNode) {
    if (valueNode.kind !== Kind.INT) {
      throw new GraphQLError(`Int cannot represent non-integer value: ${print(valueNode)}`, {
        nodes: valueNode
      });
    }
    const num = parseInt(valueNode.value, 10);
    if (num > GRAPHQL_MAX_INT || num < GRAPHQL_MIN_INT) {
      throw new GraphQLError(`Int cannot represent non 32-bit signed integer value: ${valueNode.value}`, {
        nodes: valueNode
      });
    }
    return num;
  }
});
var GraphQLFloat = new GraphQLScalarType({
  name: "Float",
  description: "The `Float` scalar type represents signed double-precision fractional values as specified by [IEEE 754](https://en.wikipedia.org/wiki/IEEE_floating_point).",
  serialize(outputValue) {
    const coercedValue = serializeObject(outputValue);
    if (typeof coercedValue === "boolean") {
      return coercedValue ? 1 : 0;
    }
    let num = coercedValue;
    if (typeof coercedValue === "string" && coercedValue !== "") {
      num = Number(coercedValue);
    }
    if (typeof num !== "number" || !Number.isFinite(num)) {
      throw new GraphQLError(`Float cannot represent non numeric value: ${inspect(coercedValue)}`);
    }
    return num;
  },
  parseValue(inputValue) {
    if (typeof inputValue !== "number" || !Number.isFinite(inputValue)) {
      throw new GraphQLError(`Float cannot represent non numeric value: ${inspect(inputValue)}`);
    }
    return inputValue;
  },
  parseLiteral(valueNode) {
    if (valueNode.kind !== Kind.FLOAT && valueNode.kind !== Kind.INT) {
      throw new GraphQLError(`Float cannot represent non numeric value: ${print(valueNode)}`, valueNode);
    }
    return parseFloat(valueNode.value);
  }
});
var GraphQLString = new GraphQLScalarType({
  name: "String",
  description: "The `String` scalar type represents textual data, represented as UTF-8 character sequences. The String type is most often used by GraphQL to represent free-form human-readable text.",
  serialize(outputValue) {
    const coercedValue = serializeObject(outputValue);
    if (typeof coercedValue === "string") {
      return coercedValue;
    }
    if (typeof coercedValue === "boolean") {
      return coercedValue ? "true" : "false";
    }
    if (typeof coercedValue === "number" && Number.isFinite(coercedValue)) {
      return coercedValue.toString();
    }
    throw new GraphQLError(`String cannot represent value: ${inspect(outputValue)}`);
  },
  parseValue(inputValue) {
    if (typeof inputValue !== "string") {
      throw new GraphQLError(`String cannot represent a non string value: ${inspect(inputValue)}`);
    }
    return inputValue;
  },
  parseLiteral(valueNode) {
    if (valueNode.kind !== Kind.STRING) {
      throw new GraphQLError(`String cannot represent a non string value: ${print(valueNode)}`, {
        nodes: valueNode
      });
    }
    return valueNode.value;
  }
});
var GraphQLBoolean = new GraphQLScalarType({
  name: "Boolean",
  description: "The `Boolean` scalar type represents `true` or `false`.",
  serialize(outputValue) {
    const coercedValue = serializeObject(outputValue);
    if (typeof coercedValue === "boolean") {
      return coercedValue;
    }
    if (Number.isFinite(coercedValue)) {
      return coercedValue !== 0;
    }
    throw new GraphQLError(`Boolean cannot represent a non boolean value: ${inspect(coercedValue)}`);
  },
  parseValue(inputValue) {
    if (typeof inputValue !== "boolean") {
      throw new GraphQLError(`Boolean cannot represent a non boolean value: ${inspect(inputValue)}`);
    }
    return inputValue;
  },
  parseLiteral(valueNode) {
    if (valueNode.kind !== Kind.BOOLEAN) {
      throw new GraphQLError(`Boolean cannot represent a non boolean value: ${print(valueNode)}`, {
        nodes: valueNode
      });
    }
    return valueNode.value;
  }
});
var GraphQLID = new GraphQLScalarType({
  name: "ID",
  description: 'The `ID` scalar type represents a unique identifier, often used to refetch an object or as key for a cache. The ID type appears in a JSON response as a String; however, it is not intended to be human-readable. When expected as an input type, any string (such as `"4"`) or integer (such as `4`) input value will be accepted as an ID.',
  serialize(outputValue) {
    const coercedValue = serializeObject(outputValue);
    if (typeof coercedValue === "string") {
      return coercedValue;
    }
    if (Number.isInteger(coercedValue)) {
      return String(coercedValue);
    }
    throw new GraphQLError(`ID cannot represent value: ${inspect(outputValue)}`);
  },
  parseValue(inputValue) {
    if (typeof inputValue === "string") {
      return inputValue;
    }
    if (typeof inputValue === "number" && Number.isInteger(inputValue)) {
      return inputValue.toString();
    }
    throw new GraphQLError(`ID cannot represent value: ${inspect(inputValue)}`);
  },
  parseLiteral(valueNode) {
    if (valueNode.kind !== Kind.STRING && valueNode.kind !== Kind.INT) {
      throw new GraphQLError("ID cannot represent a non-string and non-integer value: " + print(valueNode), {
        nodes: valueNode
      });
    }
    return valueNode.value;
  }
});
var specifiedScalarTypes = Object.freeze([
  GraphQLString,
  GraphQLInt,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLID
]);
function serializeObject(outputValue) {
  if (isObjectLike(outputValue)) {
    if (typeof outputValue.valueOf === "function") {
      const valueOfResult = outputValue.valueOf();
      if (!isObjectLike(valueOfResult)) {
        return valueOfResult;
      }
    }
    if (typeof outputValue.toJSON === "function") {
      return outputValue.toJSON();
    }
  }
  return outputValue;
}

// node_modules/graphql/type/directives.mjs
function isDirective(directive) {
  return instanceOf(directive, GraphQLDirective);
}
class GraphQLDirective {
  constructor(config) {
    var _config$isRepeatable, _config$args;
    this.name = assertName(config.name);
    this.description = config.description;
    this.locations = config.locations;
    this.isRepeatable = (_config$isRepeatable = config.isRepeatable) !== null && _config$isRepeatable !== undefined ? _config$isRepeatable : false;
    this.extensions = toObjMap(config.extensions);
    this.astNode = config.astNode;
    Array.isArray(config.locations) || devAssert(false, `@${config.name} locations must be an Array.`);
    const args = (_config$args = config.args) !== null && _config$args !== undefined ? _config$args : {};
    isObjectLike(args) && !Array.isArray(args) || devAssert(false, `@${config.name} args must be an object with argument names as keys.`);
    this.args = defineArguments(args);
  }
  get [Symbol.toStringTag]() {
    return "GraphQLDirective";
  }
  toConfig() {
    return {
      name: this.name,
      description: this.description,
      locations: this.locations,
      args: argsToArgsConfig(this.args),
      isRepeatable: this.isRepeatable,
      extensions: this.extensions,
      astNode: this.astNode
    };
  }
  toString() {
    return "@" + this.name;
  }
  toJSON() {
    return this.toString();
  }
}
var GraphQLIncludeDirective = new GraphQLDirective({
  name: "include",
  description: "Directs the executor to include this field or fragment only when the `if` argument is true.",
  locations: [
    DirectiveLocation.FIELD,
    DirectiveLocation.FRAGMENT_SPREAD,
    DirectiveLocation.INLINE_FRAGMENT
  ],
  args: {
    if: {
      type: new GraphQLNonNull(GraphQLBoolean),
      description: "Included when true."
    }
  }
});
var GraphQLSkipDirective = new GraphQLDirective({
  name: "skip",
  description: "Directs the executor to skip this field or fragment when the `if` argument is true.",
  locations: [
    DirectiveLocation.FIELD,
    DirectiveLocation.FRAGMENT_SPREAD,
    DirectiveLocation.INLINE_FRAGMENT
  ],
  args: {
    if: {
      type: new GraphQLNonNull(GraphQLBoolean),
      description: "Skipped when true."
    }
  }
});
var DEFAULT_DEPRECATION_REASON = "No longer supported";
var GraphQLDeprecatedDirective = new GraphQLDirective({
  name: "deprecated",
  description: "Marks an element of a GraphQL schema as no longer supported.",
  locations: [
    DirectiveLocation.FIELD_DEFINITION,
    DirectiveLocation.ARGUMENT_DEFINITION,
    DirectiveLocation.INPUT_FIELD_DEFINITION,
    DirectiveLocation.ENUM_VALUE
  ],
  args: {
    reason: {
      type: GraphQLString,
      description: "Explains why this element was deprecated, usually also including a suggestion for how to access supported similar data. Formatted using the Markdown syntax, as specified by [CommonMark](https://commonmark.org/).",
      defaultValue: DEFAULT_DEPRECATION_REASON
    }
  }
});
var GraphQLSpecifiedByDirective = new GraphQLDirective({
  name: "specifiedBy",
  description: "Exposes a URL that specifies the behavior of this scalar.",
  locations: [DirectiveLocation.SCALAR],
  args: {
    url: {
      type: new GraphQLNonNull(GraphQLString),
      description: "The URL that specifies the behavior of this scalar."
    }
  }
});
var GraphQLOneOfDirective = new GraphQLDirective({
  name: "oneOf",
  description: "Indicates exactly one field must be supplied and this field must not be `null`.",
  locations: [DirectiveLocation.INPUT_OBJECT],
  args: {}
});
var specifiedDirectives = Object.freeze([
  GraphQLIncludeDirective,
  GraphQLSkipDirective,
  GraphQLDeprecatedDirective,
  GraphQLSpecifiedByDirective,
  GraphQLOneOfDirective
]);

// node_modules/graphql/jsutils/isIterableObject.mjs
function isIterableObject(maybeIterable) {
  return typeof maybeIterable === "object" && typeof (maybeIterable === null || maybeIterable === undefined ? undefined : maybeIterable[Symbol.iterator]) === "function";
}

// node_modules/graphql/utilities/astFromValue.mjs
function astFromValue(value, type) {
  if (isNonNullType(type)) {
    const astValue = astFromValue(value, type.ofType);
    if ((astValue === null || astValue === undefined ? undefined : astValue.kind) === Kind.NULL) {
      return null;
    }
    return astValue;
  }
  if (value === null) {
    return {
      kind: Kind.NULL
    };
  }
  if (value === undefined) {
    return null;
  }
  if (isListType(type)) {
    const itemType = type.ofType;
    if (isIterableObject(value)) {
      const valuesNodes = [];
      for (const item of value) {
        const itemNode = astFromValue(item, itemType);
        if (itemNode != null) {
          valuesNodes.push(itemNode);
        }
      }
      return {
        kind: Kind.LIST,
        values: valuesNodes
      };
    }
    return astFromValue(value, itemType);
  }
  if (isInputObjectType(type)) {
    if (!isObjectLike(value)) {
      return null;
    }
    const fieldNodes = [];
    for (const field of Object.values(type.getFields())) {
      const fieldValue = astFromValue(value[field.name], field.type);
      if (fieldValue) {
        fieldNodes.push({
          kind: Kind.OBJECT_FIELD,
          name: {
            kind: Kind.NAME,
            value: field.name
          },
          value: fieldValue
        });
      }
    }
    return {
      kind: Kind.OBJECT,
      fields: fieldNodes
    };
  }
  if (isLeafType(type)) {
    const serialized = type.serialize(value);
    if (serialized == null) {
      return null;
    }
    if (typeof serialized === "boolean") {
      return {
        kind: Kind.BOOLEAN,
        value: serialized
      };
    }
    if (typeof serialized === "number" && Number.isFinite(serialized)) {
      const stringNum = String(serialized);
      return integerStringRegExp.test(stringNum) ? {
        kind: Kind.INT,
        value: stringNum
      } : {
        kind: Kind.FLOAT,
        value: stringNum
      };
    }
    if (typeof serialized === "string") {
      if (isEnumType(type)) {
        return {
          kind: Kind.ENUM,
          value: serialized
        };
      }
      if (type === GraphQLID && integerStringRegExp.test(serialized)) {
        return {
          kind: Kind.INT,
          value: serialized
        };
      }
      return {
        kind: Kind.STRING,
        value: serialized
      };
    }
    throw new TypeError(`Cannot convert value to AST: ${inspect(serialized)}.`);
  }
  invariant(false, "Unexpected input type: " + inspect(type));
}
var integerStringRegExp = /^-?(?:0|[1-9][0-9]*)$/;

// node_modules/graphql/type/introspection.mjs
var __Schema = new GraphQLObjectType({
  name: "__Schema",
  description: "A GraphQL Schema defines the capabilities of a GraphQL server. It exposes all available types and directives on the server, as well as the entry points for query, mutation, and subscription operations.",
  fields: () => ({
    description: {
      type: GraphQLString,
      resolve: (schema) => schema.description
    },
    types: {
      description: "A list of all types supported by this server.",
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(__Type))),
      resolve(schema) {
        return Object.values(schema.getTypeMap());
      }
    },
    queryType: {
      description: "The type that query operations will be rooted at.",
      type: new GraphQLNonNull(__Type),
      resolve: (schema) => schema.getQueryType()
    },
    mutationType: {
      description: "If this server supports mutation, the type that mutation operations will be rooted at.",
      type: __Type,
      resolve: (schema) => schema.getMutationType()
    },
    subscriptionType: {
      description: "If this server support subscription, the type that subscription operations will be rooted at.",
      type: __Type,
      resolve: (schema) => schema.getSubscriptionType()
    },
    directives: {
      description: "A list of all directives supported by this server.",
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(__Directive))),
      resolve: (schema) => schema.getDirectives()
    }
  })
});
var __Directive = new GraphQLObjectType({
  name: "__Directive",
  description: `A Directive provides a way to describe alternate runtime execution and type validation behavior in a GraphQL document.

In some cases, you need to provide options to alter GraphQL's execution behavior in ways field arguments will not suffice, such as conditionally including or skipping a field. Directives provide this by describing additional information to the executor.`,
  fields: () => ({
    name: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: (directive) => directive.name
    },
    description: {
      type: GraphQLString,
      resolve: (directive) => directive.description
    },
    isRepeatable: {
      type: new GraphQLNonNull(GraphQLBoolean),
      resolve: (directive) => directive.isRepeatable
    },
    locations: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(__DirectiveLocation))),
      resolve: (directive) => directive.locations
    },
    args: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(__InputValue))),
      args: {
        includeDeprecated: {
          type: GraphQLBoolean,
          defaultValue: false
        }
      },
      resolve(field, { includeDeprecated }) {
        return includeDeprecated ? field.args : field.args.filter((arg) => arg.deprecationReason == null);
      }
    }
  })
});
var __DirectiveLocation = new GraphQLEnumType({
  name: "__DirectiveLocation",
  description: "A Directive can be adjacent to many parts of the GraphQL language, a __DirectiveLocation describes one such possible adjacencies.",
  values: {
    QUERY: {
      value: DirectiveLocation.QUERY,
      description: "Location adjacent to a query operation."
    },
    MUTATION: {
      value: DirectiveLocation.MUTATION,
      description: "Location adjacent to a mutation operation."
    },
    SUBSCRIPTION: {
      value: DirectiveLocation.SUBSCRIPTION,
      description: "Location adjacent to a subscription operation."
    },
    FIELD: {
      value: DirectiveLocation.FIELD,
      description: "Location adjacent to a field."
    },
    FRAGMENT_DEFINITION: {
      value: DirectiveLocation.FRAGMENT_DEFINITION,
      description: "Location adjacent to a fragment definition."
    },
    FRAGMENT_SPREAD: {
      value: DirectiveLocation.FRAGMENT_SPREAD,
      description: "Location adjacent to a fragment spread."
    },
    INLINE_FRAGMENT: {
      value: DirectiveLocation.INLINE_FRAGMENT,
      description: "Location adjacent to an inline fragment."
    },
    VARIABLE_DEFINITION: {
      value: DirectiveLocation.VARIABLE_DEFINITION,
      description: "Location adjacent to a variable definition."
    },
    SCHEMA: {
      value: DirectiveLocation.SCHEMA,
      description: "Location adjacent to a schema definition."
    },
    SCALAR: {
      value: DirectiveLocation.SCALAR,
      description: "Location adjacent to a scalar definition."
    },
    OBJECT: {
      value: DirectiveLocation.OBJECT,
      description: "Location adjacent to an object type definition."
    },
    FIELD_DEFINITION: {
      value: DirectiveLocation.FIELD_DEFINITION,
      description: "Location adjacent to a field definition."
    },
    ARGUMENT_DEFINITION: {
      value: DirectiveLocation.ARGUMENT_DEFINITION,
      description: "Location adjacent to an argument definition."
    },
    INTERFACE: {
      value: DirectiveLocation.INTERFACE,
      description: "Location adjacent to an interface definition."
    },
    UNION: {
      value: DirectiveLocation.UNION,
      description: "Location adjacent to a union definition."
    },
    ENUM: {
      value: DirectiveLocation.ENUM,
      description: "Location adjacent to an enum definition."
    },
    ENUM_VALUE: {
      value: DirectiveLocation.ENUM_VALUE,
      description: "Location adjacent to an enum value definition."
    },
    INPUT_OBJECT: {
      value: DirectiveLocation.INPUT_OBJECT,
      description: "Location adjacent to an input object type definition."
    },
    INPUT_FIELD_DEFINITION: {
      value: DirectiveLocation.INPUT_FIELD_DEFINITION,
      description: "Location adjacent to an input object field definition."
    }
  }
});
var __Type = new GraphQLObjectType({
  name: "__Type",
  description: "The fundamental unit of any GraphQL Schema is the type. There are many kinds of types in GraphQL as represented by the `__TypeKind` enum.\n\nDepending on the kind of a type, certain fields describe information about that type. Scalar types provide no information beyond a name, description and optional `specifiedByURL`, while Enum types provide their values. Object and Interface types provide the fields they describe. Abstract types, Union and Interface, provide the Object types possible at runtime. List and NonNull types compose other types.",
  fields: () => ({
    kind: {
      type: new GraphQLNonNull(__TypeKind),
      resolve(type) {
        if (isScalarType(type)) {
          return TypeKind.SCALAR;
        }
        if (isObjectType(type)) {
          return TypeKind.OBJECT;
        }
        if (isInterfaceType(type)) {
          return TypeKind.INTERFACE;
        }
        if (isUnionType(type)) {
          return TypeKind.UNION;
        }
        if (isEnumType(type)) {
          return TypeKind.ENUM;
        }
        if (isInputObjectType(type)) {
          return TypeKind.INPUT_OBJECT;
        }
        if (isListType(type)) {
          return TypeKind.LIST;
        }
        if (isNonNullType(type)) {
          return TypeKind.NON_NULL;
        }
        invariant(false, `Unexpected type: "${inspect(type)}".`);
      }
    },
    name: {
      type: GraphQLString,
      resolve: (type) => ("name" in type) ? type.name : undefined
    },
    description: {
      type: GraphQLString,
      resolve: (type) => ("description" in type) ? type.description : undefined
    },
    specifiedByURL: {
      type: GraphQLString,
      resolve: (obj) => ("specifiedByURL" in obj) ? obj.specifiedByURL : undefined
    },
    fields: {
      type: new GraphQLList(new GraphQLNonNull(__Field)),
      args: {
        includeDeprecated: {
          type: GraphQLBoolean,
          defaultValue: false
        }
      },
      resolve(type, { includeDeprecated }) {
        if (isObjectType(type) || isInterfaceType(type)) {
          const fields = Object.values(type.getFields());
          return includeDeprecated ? fields : fields.filter((field) => field.deprecationReason == null);
        }
      }
    },
    interfaces: {
      type: new GraphQLList(new GraphQLNonNull(__Type)),
      resolve(type) {
        if (isObjectType(type) || isInterfaceType(type)) {
          return type.getInterfaces();
        }
      }
    },
    possibleTypes: {
      type: new GraphQLList(new GraphQLNonNull(__Type)),
      resolve(type, _args, _context, { schema }) {
        if (isAbstractType(type)) {
          return schema.getPossibleTypes(type);
        }
      }
    },
    enumValues: {
      type: new GraphQLList(new GraphQLNonNull(__EnumValue)),
      args: {
        includeDeprecated: {
          type: GraphQLBoolean,
          defaultValue: false
        }
      },
      resolve(type, { includeDeprecated }) {
        if (isEnumType(type)) {
          const values = type.getValues();
          return includeDeprecated ? values : values.filter((field) => field.deprecationReason == null);
        }
      }
    },
    inputFields: {
      type: new GraphQLList(new GraphQLNonNull(__InputValue)),
      args: {
        includeDeprecated: {
          type: GraphQLBoolean,
          defaultValue: false
        }
      },
      resolve(type, { includeDeprecated }) {
        if (isInputObjectType(type)) {
          const values = Object.values(type.getFields());
          return includeDeprecated ? values : values.filter((field) => field.deprecationReason == null);
        }
      }
    },
    ofType: {
      type: __Type,
      resolve: (type) => ("ofType" in type) ? type.ofType : undefined
    },
    isOneOf: {
      type: GraphQLBoolean,
      resolve: (type) => {
        if (isInputObjectType(type)) {
          return type.isOneOf;
        }
      }
    }
  })
});
var __Field = new GraphQLObjectType({
  name: "__Field",
  description: "Object and Interface types are described by a list of Fields, each of which has a name, potentially a list of arguments, and a return type.",
  fields: () => ({
    name: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: (field) => field.name
    },
    description: {
      type: GraphQLString,
      resolve: (field) => field.description
    },
    args: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(__InputValue))),
      args: {
        includeDeprecated: {
          type: GraphQLBoolean,
          defaultValue: false
        }
      },
      resolve(field, { includeDeprecated }) {
        return includeDeprecated ? field.args : field.args.filter((arg) => arg.deprecationReason == null);
      }
    },
    type: {
      type: new GraphQLNonNull(__Type),
      resolve: (field) => field.type
    },
    isDeprecated: {
      type: new GraphQLNonNull(GraphQLBoolean),
      resolve: (field) => field.deprecationReason != null
    },
    deprecationReason: {
      type: GraphQLString,
      resolve: (field) => field.deprecationReason
    }
  })
});
var __InputValue = new GraphQLObjectType({
  name: "__InputValue",
  description: "Arguments provided to Fields or Directives and the input fields of an InputObject are represented as Input Values which describe their type and optionally a default value.",
  fields: () => ({
    name: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: (inputValue) => inputValue.name
    },
    description: {
      type: GraphQLString,
      resolve: (inputValue) => inputValue.description
    },
    type: {
      type: new GraphQLNonNull(__Type),
      resolve: (inputValue) => inputValue.type
    },
    defaultValue: {
      type: GraphQLString,
      description: "A GraphQL-formatted string representing the default value for this input value.",
      resolve(inputValue) {
        const { type, defaultValue } = inputValue;
        const valueAST = astFromValue(defaultValue, type);
        return valueAST ? print(valueAST) : null;
      }
    },
    isDeprecated: {
      type: new GraphQLNonNull(GraphQLBoolean),
      resolve: (field) => field.deprecationReason != null
    },
    deprecationReason: {
      type: GraphQLString,
      resolve: (obj) => obj.deprecationReason
    }
  })
});
var __EnumValue = new GraphQLObjectType({
  name: "__EnumValue",
  description: "One possible value for a given Enum. Enum values are unique values, not a placeholder for a string or numeric value. However an Enum value is returned in a JSON response as a string.",
  fields: () => ({
    name: {
      type: new GraphQLNonNull(GraphQLString),
      resolve: (enumValue) => enumValue.name
    },
    description: {
      type: GraphQLString,
      resolve: (enumValue) => enumValue.description
    },
    isDeprecated: {
      type: new GraphQLNonNull(GraphQLBoolean),
      resolve: (enumValue) => enumValue.deprecationReason != null
    },
    deprecationReason: {
      type: GraphQLString,
      resolve: (enumValue) => enumValue.deprecationReason
    }
  })
});
var TypeKind;
(function(TypeKind2) {
  TypeKind2["SCALAR"] = "SCALAR";
  TypeKind2["OBJECT"] = "OBJECT";
  TypeKind2["INTERFACE"] = "INTERFACE";
  TypeKind2["UNION"] = "UNION";
  TypeKind2["ENUM"] = "ENUM";
  TypeKind2["INPUT_OBJECT"] = "INPUT_OBJECT";
  TypeKind2["LIST"] = "LIST";
  TypeKind2["NON_NULL"] = "NON_NULL";
})(TypeKind || (TypeKind = {}));
var __TypeKind = new GraphQLEnumType({
  name: "__TypeKind",
  description: "An enum describing what kind of type a given `__Type` is.",
  values: {
    SCALAR: {
      value: TypeKind.SCALAR,
      description: "Indicates this type is a scalar."
    },
    OBJECT: {
      value: TypeKind.OBJECT,
      description: "Indicates this type is an object. `fields` and `interfaces` are valid fields."
    },
    INTERFACE: {
      value: TypeKind.INTERFACE,
      description: "Indicates this type is an interface. `fields`, `interfaces`, and `possibleTypes` are valid fields."
    },
    UNION: {
      value: TypeKind.UNION,
      description: "Indicates this type is a union. `possibleTypes` is a valid field."
    },
    ENUM: {
      value: TypeKind.ENUM,
      description: "Indicates this type is an enum. `enumValues` is a valid field."
    },
    INPUT_OBJECT: {
      value: TypeKind.INPUT_OBJECT,
      description: "Indicates this type is an input object. `inputFields` is a valid field."
    },
    LIST: {
      value: TypeKind.LIST,
      description: "Indicates this type is a list. `ofType` is a valid field."
    },
    NON_NULL: {
      value: TypeKind.NON_NULL,
      description: "Indicates this type is a non-null. `ofType` is a valid field."
    }
  }
});
var SchemaMetaFieldDef = {
  name: "__schema",
  type: new GraphQLNonNull(__Schema),
  description: "Access the current type schema of this server.",
  args: [],
  resolve: (_source, _args, _context, { schema }) => schema,
  deprecationReason: undefined,
  extensions: Object.create(null),
  astNode: undefined
};
var TypeMetaFieldDef = {
  name: "__type",
  type: __Type,
  description: "Request the type information of a single type.",
  args: [
    {
      name: "name",
      description: undefined,
      type: new GraphQLNonNull(GraphQLString),
      defaultValue: undefined,
      deprecationReason: undefined,
      extensions: Object.create(null),
      astNode: undefined
    }
  ],
  resolve: (_source, { name }, _context, { schema }) => schema.getType(name),
  deprecationReason: undefined,
  extensions: Object.create(null),
  astNode: undefined
};
var TypeNameMetaFieldDef = {
  name: "__typename",
  type: new GraphQLNonNull(GraphQLString),
  description: "The name of the current Object type at runtime.",
  args: [],
  resolve: (_source, _args, _context, { parentType }) => parentType.name,
  deprecationReason: undefined,
  extensions: Object.create(null),
  astNode: undefined
};
var introspectionTypes = Object.freeze([
  __Schema,
  __Directive,
  __DirectiveLocation,
  __Type,
  __Field,
  __InputValue,
  __EnumValue,
  __TypeKind
]);
function isIntrospectionType(type) {
  return introspectionTypes.some(({ name }) => type.name === name);
}

// node_modules/graphql/type/schema.mjs
function isSchema(schema) {
  return instanceOf(schema, GraphQLSchema);
}
function assertSchema(schema) {
  if (!isSchema(schema)) {
    throw new Error(`Expected ${inspect(schema)} to be a GraphQL schema.`);
  }
  return schema;
}

class GraphQLSchema {
  constructor(config) {
    var _config$extensionASTN, _config$directives;
    this.__validationErrors = config.assumeValid === true ? [] : undefined;
    isObjectLike(config) || devAssert(false, "Must provide configuration object.");
    !config.types || Array.isArray(config.types) || devAssert(false, `"types" must be Array if provided but got: ${inspect(config.types)}.`);
    !config.directives || Array.isArray(config.directives) || devAssert(false, '"directives" must be Array if provided but got: ' + `${inspect(config.directives)}.`);
    this.description = config.description;
    this.extensions = toObjMap(config.extensions);
    this.astNode = config.astNode;
    this.extensionASTNodes = (_config$extensionASTN = config.extensionASTNodes) !== null && _config$extensionASTN !== undefined ? _config$extensionASTN : [];
    this._queryType = config.query;
    this._mutationType = config.mutation;
    this._subscriptionType = config.subscription;
    this._directives = (_config$directives = config.directives) !== null && _config$directives !== undefined ? _config$directives : specifiedDirectives;
    const allReferencedTypes = new Set(config.types);
    if (config.types != null) {
      for (const type of config.types) {
        allReferencedTypes.delete(type);
        collectReferencedTypes(type, allReferencedTypes);
      }
    }
    if (this._queryType != null) {
      collectReferencedTypes(this._queryType, allReferencedTypes);
    }
    if (this._mutationType != null) {
      collectReferencedTypes(this._mutationType, allReferencedTypes);
    }
    if (this._subscriptionType != null) {
      collectReferencedTypes(this._subscriptionType, allReferencedTypes);
    }
    for (const directive of this._directives) {
      if (isDirective(directive)) {
        for (const arg of directive.args) {
          collectReferencedTypes(arg.type, allReferencedTypes);
        }
      }
    }
    collectReferencedTypes(__Schema, allReferencedTypes);
    this._typeMap = Object.create(null);
    this._subTypeMap = Object.create(null);
    this._implementationsMap = Object.create(null);
    for (const namedType of allReferencedTypes) {
      if (namedType == null) {
        continue;
      }
      const typeName = namedType.name;
      typeName || devAssert(false, "One of the provided types for building the Schema is missing a name.");
      if (this._typeMap[typeName] !== undefined) {
        throw new Error(`Schema must contain uniquely named types but contains multiple types named "${typeName}".`);
      }
      this._typeMap[typeName] = namedType;
      if (isInterfaceType(namedType)) {
        for (const iface of namedType.getInterfaces()) {
          if (isInterfaceType(iface)) {
            let implementations = this._implementationsMap[iface.name];
            if (implementations === undefined) {
              implementations = this._implementationsMap[iface.name] = {
                objects: [],
                interfaces: []
              };
            }
            implementations.interfaces.push(namedType);
          }
        }
      } else if (isObjectType(namedType)) {
        for (const iface of namedType.getInterfaces()) {
          if (isInterfaceType(iface)) {
            let implementations = this._implementationsMap[iface.name];
            if (implementations === undefined) {
              implementations = this._implementationsMap[iface.name] = {
                objects: [],
                interfaces: []
              };
            }
            implementations.objects.push(namedType);
          }
        }
      }
    }
  }
  get [Symbol.toStringTag]() {
    return "GraphQLSchema";
  }
  getQueryType() {
    return this._queryType;
  }
  getMutationType() {
    return this._mutationType;
  }
  getSubscriptionType() {
    return this._subscriptionType;
  }
  getRootType(operation) {
    switch (operation) {
      case OperationTypeNode.QUERY:
        return this.getQueryType();
      case OperationTypeNode.MUTATION:
        return this.getMutationType();
      case OperationTypeNode.SUBSCRIPTION:
        return this.getSubscriptionType();
    }
  }
  getTypeMap() {
    return this._typeMap;
  }
  getType(name) {
    return this.getTypeMap()[name];
  }
  getPossibleTypes(abstractType) {
    return isUnionType(abstractType) ? abstractType.getTypes() : this.getImplementations(abstractType).objects;
  }
  getImplementations(interfaceType) {
    const implementations = this._implementationsMap[interfaceType.name];
    return implementations !== null && implementations !== undefined ? implementations : {
      objects: [],
      interfaces: []
    };
  }
  isSubType(abstractType, maybeSubType) {
    let map = this._subTypeMap[abstractType.name];
    if (map === undefined) {
      map = Object.create(null);
      if (isUnionType(abstractType)) {
        for (const type of abstractType.getTypes()) {
          map[type.name] = true;
        }
      } else {
        const implementations = this.getImplementations(abstractType);
        for (const type of implementations.objects) {
          map[type.name] = true;
        }
        for (const type of implementations.interfaces) {
          map[type.name] = true;
        }
      }
      this._subTypeMap[abstractType.name] = map;
    }
    return map[maybeSubType.name] !== undefined;
  }
  getDirectives() {
    return this._directives;
  }
  getDirective(name) {
    return this.getDirectives().find((directive) => directive.name === name);
  }
  toConfig() {
    return {
      description: this.description,
      query: this.getQueryType(),
      mutation: this.getMutationType(),
      subscription: this.getSubscriptionType(),
      types: Object.values(this.getTypeMap()),
      directives: this.getDirectives(),
      extensions: this.extensions,
      astNode: this.astNode,
      extensionASTNodes: this.extensionASTNodes,
      assumeValid: this.__validationErrors !== undefined
    };
  }
}
function collectReferencedTypes(type, typeSet) {
  const namedType = getNamedType(type);
  if (!typeSet.has(namedType)) {
    typeSet.add(namedType);
    if (isUnionType(namedType)) {
      for (const memberType of namedType.getTypes()) {
        collectReferencedTypes(memberType, typeSet);
      }
    } else if (isObjectType(namedType) || isInterfaceType(namedType)) {
      for (const interfaceType of namedType.getInterfaces()) {
        collectReferencedTypes(interfaceType, typeSet);
      }
      for (const field of Object.values(namedType.getFields())) {
        collectReferencedTypes(field.type, typeSet);
        for (const arg of field.args) {
          collectReferencedTypes(arg.type, typeSet);
        }
      }
    } else if (isInputObjectType(namedType)) {
      for (const field of Object.values(namedType.getFields())) {
        collectReferencedTypes(field.type, typeSet);
      }
    }
  }
  return typeSet;
}

// node_modules/graphql/type/validate.mjs
function validateSchema(schema) {
  assertSchema(schema);
  if (schema.__validationErrors) {
    return schema.__validationErrors;
  }
  const context = new SchemaValidationContext(schema);
  validateRootTypes(context);
  validateDirectives(context);
  validateTypes(context);
  const errors = context.getErrors();
  schema.__validationErrors = errors;
  return errors;
}
function assertValidSchema(schema) {
  const errors = validateSchema(schema);
  if (errors.length !== 0) {
    throw new Error(errors.map((error) => error.message).join(`

`));
  }
}

class SchemaValidationContext {
  constructor(schema) {
    this._errors = [];
    this.schema = schema;
  }
  reportError(message, nodes) {
    const _nodes = Array.isArray(nodes) ? nodes.filter(Boolean) : nodes;
    this._errors.push(new GraphQLError(message, {
      nodes: _nodes
    }));
  }
  getErrors() {
    return this._errors;
  }
}
function validateRootTypes(context) {
  const schema = context.schema;
  const queryType = schema.getQueryType();
  if (!queryType) {
    context.reportError("Query root type must be provided.", schema.astNode);
  } else if (!isObjectType(queryType)) {
    var _getOperationTypeNode;
    context.reportError(`Query root type must be Object type, it cannot be ${inspect(queryType)}.`, (_getOperationTypeNode = getOperationTypeNode(schema, OperationTypeNode.QUERY)) !== null && _getOperationTypeNode !== undefined ? _getOperationTypeNode : queryType.astNode);
  }
  const mutationType = schema.getMutationType();
  if (mutationType && !isObjectType(mutationType)) {
    var _getOperationTypeNode2;
    context.reportError("Mutation root type must be Object type if provided, it cannot be " + `${inspect(mutationType)}.`, (_getOperationTypeNode2 = getOperationTypeNode(schema, OperationTypeNode.MUTATION)) !== null && _getOperationTypeNode2 !== undefined ? _getOperationTypeNode2 : mutationType.astNode);
  }
  const subscriptionType = schema.getSubscriptionType();
  if (subscriptionType && !isObjectType(subscriptionType)) {
    var _getOperationTypeNode3;
    context.reportError("Subscription root type must be Object type if provided, it cannot be " + `${inspect(subscriptionType)}.`, (_getOperationTypeNode3 = getOperationTypeNode(schema, OperationTypeNode.SUBSCRIPTION)) !== null && _getOperationTypeNode3 !== undefined ? _getOperationTypeNode3 : subscriptionType.astNode);
  }
}
function getOperationTypeNode(schema, operation) {
  var _flatMap$find;
  return (_flatMap$find = [schema.astNode, ...schema.extensionASTNodes].flatMap((schemaNode) => {
    var _schemaNode$operation;
    return (_schemaNode$operation = schemaNode === null || schemaNode === undefined ? undefined : schemaNode.operationTypes) !== null && _schemaNode$operation !== undefined ? _schemaNode$operation : [];
  }).find((operationNode) => operationNode.operation === operation)) === null || _flatMap$find === undefined ? undefined : _flatMap$find.type;
}
function validateDirectives(context) {
  for (const directive of context.schema.getDirectives()) {
    if (!isDirective(directive)) {
      context.reportError(`Expected directive but got: ${inspect(directive)}.`, directive === null || directive === undefined ? undefined : directive.astNode);
      continue;
    }
    validateName(context, directive);
    if (directive.locations.length === 0) {
      context.reportError(`Directive @${directive.name} must include 1 or more locations.`, directive.astNode);
    }
    for (const arg of directive.args) {
      validateName(context, arg);
      if (!isInputType(arg.type)) {
        context.reportError(`The type of @${directive.name}(${arg.name}:) must be Input Type ` + `but got: ${inspect(arg.type)}.`, arg.astNode);
      }
      if (isRequiredArgument(arg) && arg.deprecationReason != null) {
        var _arg$astNode;
        context.reportError(`Required argument @${directive.name}(${arg.name}:) cannot be deprecated.`, [
          getDeprecatedDirectiveNode(arg.astNode),
          (_arg$astNode = arg.astNode) === null || _arg$astNode === undefined ? undefined : _arg$astNode.type
        ]);
      }
    }
  }
}
function validateName(context, node) {
  if (node.name.startsWith("__")) {
    context.reportError(`Name "${node.name}" must not begin with "__", which is reserved by GraphQL introspection.`, node.astNode);
  }
}
function validateTypes(context) {
  const validateInputObjectCircularRefs = createInputObjectCircularRefsValidator(context);
  const typeMap = context.schema.getTypeMap();
  for (const type of Object.values(typeMap)) {
    if (!isNamedType(type)) {
      context.reportError(`Expected GraphQL named type but got: ${inspect(type)}.`, type.astNode);
      continue;
    }
    if (!isIntrospectionType(type)) {
      validateName(context, type);
    }
    if (isObjectType(type)) {
      validateFields(context, type);
      validateInterfaces(context, type);
    } else if (isInterfaceType(type)) {
      validateFields(context, type);
      validateInterfaces(context, type);
    } else if (isUnionType(type)) {
      validateUnionMembers(context, type);
    } else if (isEnumType(type)) {
      validateEnumValues(context, type);
    } else if (isInputObjectType(type)) {
      validateInputFields(context, type);
      validateInputObjectCircularRefs(type);
    }
  }
}
function validateFields(context, type) {
  const fields = Object.values(type.getFields());
  if (fields.length === 0) {
    context.reportError(`Type ${type.name} must define one or more fields.`, [
      type.astNode,
      ...type.extensionASTNodes
    ]);
  }
  for (const field of fields) {
    validateName(context, field);
    if (!isOutputType(field.type)) {
      var _field$astNode;
      context.reportError(`The type of ${type.name}.${field.name} must be Output Type ` + `but got: ${inspect(field.type)}.`, (_field$astNode = field.astNode) === null || _field$astNode === undefined ? undefined : _field$astNode.type);
    }
    for (const arg of field.args) {
      const argName = arg.name;
      validateName(context, arg);
      if (!isInputType(arg.type)) {
        var _arg$astNode2;
        context.reportError(`The type of ${type.name}.${field.name}(${argName}:) must be Input ` + `Type but got: ${inspect(arg.type)}.`, (_arg$astNode2 = arg.astNode) === null || _arg$astNode2 === undefined ? undefined : _arg$astNode2.type);
      }
      if (isRequiredArgument(arg) && arg.deprecationReason != null) {
        var _arg$astNode3;
        context.reportError(`Required argument ${type.name}.${field.name}(${argName}:) cannot be deprecated.`, [
          getDeprecatedDirectiveNode(arg.astNode),
          (_arg$astNode3 = arg.astNode) === null || _arg$astNode3 === undefined ? undefined : _arg$astNode3.type
        ]);
      }
    }
  }
}
function validateInterfaces(context, type) {
  const ifaceTypeNames = Object.create(null);
  for (const iface of type.getInterfaces()) {
    if (!isInterfaceType(iface)) {
      context.reportError(`Type ${inspect(type)} must only implement Interface types, ` + `it cannot implement ${inspect(iface)}.`, getAllImplementsInterfaceNodes(type, iface));
      continue;
    }
    if (type === iface) {
      context.reportError(`Type ${type.name} cannot implement itself because it would create a circular reference.`, getAllImplementsInterfaceNodes(type, iface));
      continue;
    }
    if (ifaceTypeNames[iface.name]) {
      context.reportError(`Type ${type.name} can only implement ${iface.name} once.`, getAllImplementsInterfaceNodes(type, iface));
      continue;
    }
    ifaceTypeNames[iface.name] = true;
    validateTypeImplementsAncestors(context, type, iface);
    validateTypeImplementsInterface(context, type, iface);
  }
}
function validateTypeImplementsInterface(context, type, iface) {
  const typeFieldMap = type.getFields();
  for (const ifaceField of Object.values(iface.getFields())) {
    const fieldName = ifaceField.name;
    const typeField = typeFieldMap[fieldName];
    if (!typeField) {
      context.reportError(`Interface field ${iface.name}.${fieldName} expected but ${type.name} does not provide it.`, [ifaceField.astNode, type.astNode, ...type.extensionASTNodes]);
      continue;
    }
    if (!isTypeSubTypeOf(context.schema, typeField.type, ifaceField.type)) {
      var _ifaceField$astNode, _typeField$astNode;
      context.reportError(`Interface field ${iface.name}.${fieldName} expects type ` + `${inspect(ifaceField.type)} but ${type.name}.${fieldName} ` + `is type ${inspect(typeField.type)}.`, [
        (_ifaceField$astNode = ifaceField.astNode) === null || _ifaceField$astNode === undefined ? undefined : _ifaceField$astNode.type,
        (_typeField$astNode = typeField.astNode) === null || _typeField$astNode === undefined ? undefined : _typeField$astNode.type
      ]);
    }
    for (const ifaceArg of ifaceField.args) {
      const argName = ifaceArg.name;
      const typeArg = typeField.args.find((arg) => arg.name === argName);
      if (!typeArg) {
        context.reportError(`Interface field argument ${iface.name}.${fieldName}(${argName}:) expected but ${type.name}.${fieldName} does not provide it.`, [ifaceArg.astNode, typeField.astNode]);
        continue;
      }
      if (!isEqualType(ifaceArg.type, typeArg.type)) {
        var _ifaceArg$astNode, _typeArg$astNode;
        context.reportError(`Interface field argument ${iface.name}.${fieldName}(${argName}:) ` + `expects type ${inspect(ifaceArg.type)} but ` + `${type.name}.${fieldName}(${argName}:) is type ` + `${inspect(typeArg.type)}.`, [
          (_ifaceArg$astNode = ifaceArg.astNode) === null || _ifaceArg$astNode === undefined ? undefined : _ifaceArg$astNode.type,
          (_typeArg$astNode = typeArg.astNode) === null || _typeArg$astNode === undefined ? undefined : _typeArg$astNode.type
        ]);
      }
    }
    for (const typeArg of typeField.args) {
      const argName = typeArg.name;
      const ifaceArg = ifaceField.args.find((arg) => arg.name === argName);
      if (!ifaceArg && isRequiredArgument(typeArg)) {
        context.reportError(`Object field ${type.name}.${fieldName} includes required argument ${argName} that is missing from the Interface field ${iface.name}.${fieldName}.`, [typeArg.astNode, ifaceField.astNode]);
      }
    }
  }
}
function validateTypeImplementsAncestors(context, type, iface) {
  const ifaceInterfaces = type.getInterfaces();
  for (const transitive of iface.getInterfaces()) {
    if (!ifaceInterfaces.includes(transitive)) {
      context.reportError(transitive === type ? `Type ${type.name} cannot implement ${iface.name} because it would create a circular reference.` : `Type ${type.name} must implement ${transitive.name} because it is implemented by ${iface.name}.`, [
        ...getAllImplementsInterfaceNodes(iface, transitive),
        ...getAllImplementsInterfaceNodes(type, iface)
      ]);
    }
  }
}
function validateUnionMembers(context, union) {
  const memberTypes = union.getTypes();
  if (memberTypes.length === 0) {
    context.reportError(`Union type ${union.name} must define one or more member types.`, [union.astNode, ...union.extensionASTNodes]);
  }
  const includedTypeNames = Object.create(null);
  for (const memberType of memberTypes) {
    if (includedTypeNames[memberType.name]) {
      context.reportError(`Union type ${union.name} can only include type ${memberType.name} once.`, getUnionMemberTypeNodes(union, memberType.name));
      continue;
    }
    includedTypeNames[memberType.name] = true;
    if (!isObjectType(memberType)) {
      context.reportError(`Union type ${union.name} can only include Object types, ` + `it cannot include ${inspect(memberType)}.`, getUnionMemberTypeNodes(union, String(memberType)));
    }
  }
}
function validateEnumValues(context, enumType) {
  const enumValues = enumType.getValues();
  if (enumValues.length === 0) {
    context.reportError(`Enum type ${enumType.name} must define one or more values.`, [enumType.astNode, ...enumType.extensionASTNodes]);
  }
  for (const enumValue of enumValues) {
    validateName(context, enumValue);
  }
}
function validateInputFields(context, inputObj) {
  const fields = Object.values(inputObj.getFields());
  if (fields.length === 0) {
    context.reportError(`Input Object type ${inputObj.name} must define one or more fields.`, [inputObj.astNode, ...inputObj.extensionASTNodes]);
  }
  for (const field of fields) {
    validateName(context, field);
    if (!isInputType(field.type)) {
      var _field$astNode2;
      context.reportError(`The type of ${inputObj.name}.${field.name} must be Input Type ` + `but got: ${inspect(field.type)}.`, (_field$astNode2 = field.astNode) === null || _field$astNode2 === undefined ? undefined : _field$astNode2.type);
    }
    if (isRequiredInputField(field) && field.deprecationReason != null) {
      var _field$astNode3;
      context.reportError(`Required input field ${inputObj.name}.${field.name} cannot be deprecated.`, [
        getDeprecatedDirectiveNode(field.astNode),
        (_field$astNode3 = field.astNode) === null || _field$astNode3 === undefined ? undefined : _field$astNode3.type
      ]);
    }
    if (inputObj.isOneOf) {
      validateOneOfInputObjectField(inputObj, field, context);
    }
  }
}
function validateOneOfInputObjectField(type, field, context) {
  if (isNonNullType(field.type)) {
    var _field$astNode4;
    context.reportError(`OneOf input field ${type.name}.${field.name} must be nullable.`, (_field$astNode4 = field.astNode) === null || _field$astNode4 === undefined ? undefined : _field$astNode4.type);
  }
  if (field.defaultValue !== undefined) {
    context.reportError(`OneOf input field ${type.name}.${field.name} cannot have a default value.`, field.astNode);
  }
}
function createInputObjectCircularRefsValidator(context) {
  const visitedTypes = Object.create(null);
  const fieldPath = [];
  const fieldPathIndexByTypeName = Object.create(null);
  return detectCycleRecursive;
  function detectCycleRecursive(inputObj) {
    if (visitedTypes[inputObj.name]) {
      return;
    }
    visitedTypes[inputObj.name] = true;
    fieldPathIndexByTypeName[inputObj.name] = fieldPath.length;
    const fields = Object.values(inputObj.getFields());
    for (const field of fields) {
      if (isNonNullType(field.type) && isInputObjectType(field.type.ofType)) {
        const fieldType = field.type.ofType;
        const cycleIndex = fieldPathIndexByTypeName[fieldType.name];
        fieldPath.push(field);
        if (cycleIndex === undefined) {
          detectCycleRecursive(fieldType);
        } else {
          const cyclePath = fieldPath.slice(cycleIndex);
          const pathStr = cyclePath.map((fieldObj) => fieldObj.name).join(".");
          context.reportError(`Cannot reference Input Object "${fieldType.name}" within itself through a series of non-null fields: "${pathStr}".`, cyclePath.map((fieldObj) => fieldObj.astNode));
        }
        fieldPath.pop();
      }
    }
    fieldPathIndexByTypeName[inputObj.name] = undefined;
  }
}
function getAllImplementsInterfaceNodes(type, iface) {
  const { astNode, extensionASTNodes } = type;
  const nodes = astNode != null ? [astNode, ...extensionASTNodes] : extensionASTNodes;
  return nodes.flatMap((typeNode) => {
    var _typeNode$interfaces;
    return (_typeNode$interfaces = typeNode.interfaces) !== null && _typeNode$interfaces !== undefined ? _typeNode$interfaces : [];
  }).filter((ifaceNode) => ifaceNode.name.value === iface.name);
}
function getUnionMemberTypeNodes(union, typeName) {
  const { astNode, extensionASTNodes } = union;
  const nodes = astNode != null ? [astNode, ...extensionASTNodes] : extensionASTNodes;
  return nodes.flatMap((unionNode) => {
    var _unionNode$types;
    return (_unionNode$types = unionNode.types) !== null && _unionNode$types !== undefined ? _unionNode$types : [];
  }).filter((typeNode) => typeNode.name.value === typeName);
}
function getDeprecatedDirectiveNode(definitionNode) {
  var _definitionNode$direc;
  return definitionNode === null || definitionNode === undefined ? undefined : (_definitionNode$direc = definitionNode.directives) === null || _definitionNode$direc === undefined ? undefined : _definitionNode$direc.find((node) => node.name.value === GraphQLDeprecatedDirective.name);
}

// node_modules/graphql/utilities/typeFromAST.mjs
function typeFromAST(schema, typeNode) {
  switch (typeNode.kind) {
    case Kind.LIST_TYPE: {
      const innerType = typeFromAST(schema, typeNode.type);
      return innerType && new GraphQLList(innerType);
    }
    case Kind.NON_NULL_TYPE: {
      const innerType = typeFromAST(schema, typeNode.type);
      return innerType && new GraphQLNonNull(innerType);
    }
    case Kind.NAMED_TYPE:
      return schema.getType(typeNode.name.value);
  }
}

// node_modules/graphql/utilities/TypeInfo.mjs
class TypeInfo {
  constructor(schema, initialType, getFieldDefFn) {
    this._schema = schema;
    this._typeStack = [];
    this._parentTypeStack = [];
    this._inputTypeStack = [];
    this._fieldDefStack = [];
    this._defaultValueStack = [];
    this._directive = null;
    this._argument = null;
    this._enumValue = null;
    this._getFieldDef = getFieldDefFn !== null && getFieldDefFn !== undefined ? getFieldDefFn : getFieldDef;
    if (initialType) {
      if (isInputType(initialType)) {
        this._inputTypeStack.push(initialType);
      }
      if (isCompositeType(initialType)) {
        this._parentTypeStack.push(initialType);
      }
      if (isOutputType(initialType)) {
        this._typeStack.push(initialType);
      }
    }
  }
  get [Symbol.toStringTag]() {
    return "TypeInfo";
  }
  getType() {
    if (this._typeStack.length > 0) {
      return this._typeStack[this._typeStack.length - 1];
    }
  }
  getParentType() {
    if (this._parentTypeStack.length > 0) {
      return this._parentTypeStack[this._parentTypeStack.length - 1];
    }
  }
  getInputType() {
    if (this._inputTypeStack.length > 0) {
      return this._inputTypeStack[this._inputTypeStack.length - 1];
    }
  }
  getParentInputType() {
    if (this._inputTypeStack.length > 1) {
      return this._inputTypeStack[this._inputTypeStack.length - 2];
    }
  }
  getFieldDef() {
    if (this._fieldDefStack.length > 0) {
      return this._fieldDefStack[this._fieldDefStack.length - 1];
    }
  }
  getDefaultValue() {
    if (this._defaultValueStack.length > 0) {
      return this._defaultValueStack[this._defaultValueStack.length - 1];
    }
  }
  getDirective() {
    return this._directive;
  }
  getArgument() {
    return this._argument;
  }
  getEnumValue() {
    return this._enumValue;
  }
  enter(node) {
    const schema = this._schema;
    switch (node.kind) {
      case Kind.SELECTION_SET: {
        const namedType = getNamedType(this.getType());
        this._parentTypeStack.push(isCompositeType(namedType) ? namedType : undefined);
        break;
      }
      case Kind.FIELD: {
        const parentType = this.getParentType();
        let fieldDef;
        let fieldType;
        if (parentType) {
          fieldDef = this._getFieldDef(schema, parentType, node);
          if (fieldDef) {
            fieldType = fieldDef.type;
          }
        }
        this._fieldDefStack.push(fieldDef);
        this._typeStack.push(isOutputType(fieldType) ? fieldType : undefined);
        break;
      }
      case Kind.DIRECTIVE:
        this._directive = schema.getDirective(node.name.value);
        break;
      case Kind.OPERATION_DEFINITION: {
        const rootType = schema.getRootType(node.operation);
        this._typeStack.push(isObjectType(rootType) ? rootType : undefined);
        break;
      }
      case Kind.INLINE_FRAGMENT:
      case Kind.FRAGMENT_DEFINITION: {
        const typeConditionAST = node.typeCondition;
        const outputType = typeConditionAST ? typeFromAST(schema, typeConditionAST) : getNamedType(this.getType());
        this._typeStack.push(isOutputType(outputType) ? outputType : undefined);
        break;
      }
      case Kind.VARIABLE_DEFINITION: {
        const inputType = typeFromAST(schema, node.type);
        this._inputTypeStack.push(isInputType(inputType) ? inputType : undefined);
        break;
      }
      case Kind.ARGUMENT: {
        var _this$getDirective;
        let argDef;
        let argType;
        const fieldOrDirective = (_this$getDirective = this.getDirective()) !== null && _this$getDirective !== undefined ? _this$getDirective : this.getFieldDef();
        if (fieldOrDirective) {
          argDef = fieldOrDirective.args.find((arg) => arg.name === node.name.value);
          if (argDef) {
            argType = argDef.type;
          }
        }
        this._argument = argDef;
        this._defaultValueStack.push(argDef ? argDef.defaultValue : undefined);
        this._inputTypeStack.push(isInputType(argType) ? argType : undefined);
        break;
      }
      case Kind.LIST: {
        const listType = getNullableType(this.getInputType());
        const itemType = isListType(listType) ? listType.ofType : listType;
        this._defaultValueStack.push(undefined);
        this._inputTypeStack.push(isInputType(itemType) ? itemType : undefined);
        break;
      }
      case Kind.OBJECT_FIELD: {
        const objectType = getNamedType(this.getInputType());
        let inputFieldType;
        let inputField;
        if (isInputObjectType(objectType)) {
          inputField = objectType.getFields()[node.name.value];
          if (inputField) {
            inputFieldType = inputField.type;
          }
        }
        this._defaultValueStack.push(inputField ? inputField.defaultValue : undefined);
        this._inputTypeStack.push(isInputType(inputFieldType) ? inputFieldType : undefined);
        break;
      }
      case Kind.ENUM: {
        const enumType = getNamedType(this.getInputType());
        let enumValue;
        if (isEnumType(enumType)) {
          enumValue = enumType.getValue(node.value);
        }
        this._enumValue = enumValue;
        break;
      }
      default:
    }
  }
  leave(node) {
    switch (node.kind) {
      case Kind.SELECTION_SET:
        this._parentTypeStack.pop();
        break;
      case Kind.FIELD:
        this._fieldDefStack.pop();
        this._typeStack.pop();
        break;
      case Kind.DIRECTIVE:
        this._directive = null;
        break;
      case Kind.OPERATION_DEFINITION:
      case Kind.INLINE_FRAGMENT:
      case Kind.FRAGMENT_DEFINITION:
        this._typeStack.pop();
        break;
      case Kind.VARIABLE_DEFINITION:
        this._inputTypeStack.pop();
        break;
      case Kind.ARGUMENT:
        this._argument = null;
        this._defaultValueStack.pop();
        this._inputTypeStack.pop();
        break;
      case Kind.LIST:
      case Kind.OBJECT_FIELD:
        this._defaultValueStack.pop();
        this._inputTypeStack.pop();
        break;
      case Kind.ENUM:
        this._enumValue = null;
        break;
      default:
    }
  }
}
function getFieldDef(schema, parentType, fieldNode) {
  const name = fieldNode.name.value;
  if (name === SchemaMetaFieldDef.name && schema.getQueryType() === parentType) {
    return SchemaMetaFieldDef;
  }
  if (name === TypeMetaFieldDef.name && schema.getQueryType() === parentType) {
    return TypeMetaFieldDef;
  }
  if (name === TypeNameMetaFieldDef.name && isCompositeType(parentType)) {
    return TypeNameMetaFieldDef;
  }
  if (isObjectType(parentType) || isInterfaceType(parentType)) {
    return parentType.getFields()[name];
  }
}
function visitWithTypeInfo(typeInfo, visitor) {
  return {
    enter(...args) {
      const node = args[0];
      typeInfo.enter(node);
      const fn = getEnterLeaveForKind(visitor, node.kind).enter;
      if (fn) {
        const result = fn.apply(visitor, args);
        if (result !== undefined) {
          typeInfo.leave(node);
          if (isNode(result)) {
            typeInfo.enter(result);
          }
        }
        return result;
      }
    },
    leave(...args) {
      const node = args[0];
      const fn = getEnterLeaveForKind(visitor, node.kind).leave;
      let result;
      if (fn) {
        result = fn.apply(visitor, args);
      }
      typeInfo.leave(node);
      return result;
    }
  };
}

// node_modules/graphql/language/predicates.mjs
function isExecutableDefinitionNode(node) {
  return node.kind === Kind.OPERATION_DEFINITION || node.kind === Kind.FRAGMENT_DEFINITION;
}
function isTypeSystemDefinitionNode(node) {
  return node.kind === Kind.SCHEMA_DEFINITION || isTypeDefinitionNode(node) || node.kind === Kind.DIRECTIVE_DEFINITION;
}
function isTypeDefinitionNode(node) {
  return node.kind === Kind.SCALAR_TYPE_DEFINITION || node.kind === Kind.OBJECT_TYPE_DEFINITION || node.kind === Kind.INTERFACE_TYPE_DEFINITION || node.kind === Kind.UNION_TYPE_DEFINITION || node.kind === Kind.ENUM_TYPE_DEFINITION || node.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION;
}
function isTypeSystemExtensionNode(node) {
  return node.kind === Kind.SCHEMA_EXTENSION || isTypeExtensionNode(node);
}
function isTypeExtensionNode(node) {
  return node.kind === Kind.SCALAR_TYPE_EXTENSION || node.kind === Kind.OBJECT_TYPE_EXTENSION || node.kind === Kind.INTERFACE_TYPE_EXTENSION || node.kind === Kind.UNION_TYPE_EXTENSION || node.kind === Kind.ENUM_TYPE_EXTENSION || node.kind === Kind.INPUT_OBJECT_TYPE_EXTENSION;
}

// node_modules/graphql/validation/rules/ExecutableDefinitionsRule.mjs
function ExecutableDefinitionsRule(context) {
  return {
    Document(node) {
      for (const definition of node.definitions) {
        if (!isExecutableDefinitionNode(definition)) {
          const defName = definition.kind === Kind.SCHEMA_DEFINITION || definition.kind === Kind.SCHEMA_EXTENSION ? "schema" : '"' + definition.name.value + '"';
          context.reportError(new GraphQLError(`The ${defName} definition is not executable.`, {
            nodes: definition
          }));
        }
      }
      return false;
    }
  };
}

// node_modules/graphql/validation/rules/FieldsOnCorrectTypeRule.mjs
function FieldsOnCorrectTypeRule(context) {
  return {
    Field(node) {
      const type = context.getParentType();
      if (type) {
        const fieldDef = context.getFieldDef();
        if (!fieldDef) {
          const schema = context.getSchema();
          const fieldName = node.name.value;
          let suggestion = didYouMean("to use an inline fragment on", getSuggestedTypeNames(schema, type, fieldName));
          if (suggestion === "") {
            suggestion = didYouMean(getSuggestedFieldNames(type, fieldName));
          }
          context.reportError(new GraphQLError(`Cannot query field "${fieldName}" on type "${type.name}".` + suggestion, {
            nodes: node
          }));
        }
      }
    }
  };
}
function getSuggestedTypeNames(schema, type, fieldName) {
  if (!isAbstractType(type)) {
    return [];
  }
  const suggestedTypes = new Set;
  const usageCount = Object.create(null);
  for (const possibleType of schema.getPossibleTypes(type)) {
    if (!possibleType.getFields()[fieldName]) {
      continue;
    }
    suggestedTypes.add(possibleType);
    usageCount[possibleType.name] = 1;
    for (const possibleInterface of possibleType.getInterfaces()) {
      var _usageCount$possibleI;
      if (!possibleInterface.getFields()[fieldName]) {
        continue;
      }
      suggestedTypes.add(possibleInterface);
      usageCount[possibleInterface.name] = ((_usageCount$possibleI = usageCount[possibleInterface.name]) !== null && _usageCount$possibleI !== undefined ? _usageCount$possibleI : 0) + 1;
    }
  }
  return [...suggestedTypes].sort((typeA, typeB) => {
    const usageCountDiff = usageCount[typeB.name] - usageCount[typeA.name];
    if (usageCountDiff !== 0) {
      return usageCountDiff;
    }
    if (isInterfaceType(typeA) && schema.isSubType(typeA, typeB)) {
      return -1;
    }
    if (isInterfaceType(typeB) && schema.isSubType(typeB, typeA)) {
      return 1;
    }
    return naturalCompare(typeA.name, typeB.name);
  }).map((x) => x.name);
}
function getSuggestedFieldNames(type, fieldName) {
  if (isObjectType(type) || isInterfaceType(type)) {
    const possibleFieldNames = Object.keys(type.getFields());
    return suggestionList(fieldName, possibleFieldNames);
  }
  return [];
}

// node_modules/graphql/validation/rules/FragmentsOnCompositeTypesRule.mjs
function FragmentsOnCompositeTypesRule(context) {
  return {
    InlineFragment(node) {
      const typeCondition = node.typeCondition;
      if (typeCondition) {
        const type = typeFromAST(context.getSchema(), typeCondition);
        if (type && !isCompositeType(type)) {
          const typeStr = print(typeCondition);
          context.reportError(new GraphQLError(`Fragment cannot condition on non composite type "${typeStr}".`, {
            nodes: typeCondition
          }));
        }
      }
    },
    FragmentDefinition(node) {
      const type = typeFromAST(context.getSchema(), node.typeCondition);
      if (type && !isCompositeType(type)) {
        const typeStr = print(node.typeCondition);
        context.reportError(new GraphQLError(`Fragment "${node.name.value}" cannot condition on non composite type "${typeStr}".`, {
          nodes: node.typeCondition
        }));
      }
    }
  };
}

// node_modules/graphql/validation/rules/KnownArgumentNamesRule.mjs
function KnownArgumentNamesRule(context) {
  return {
    ...KnownArgumentNamesOnDirectivesRule(context),
    Argument(argNode) {
      const argDef = context.getArgument();
      const fieldDef = context.getFieldDef();
      const parentType = context.getParentType();
      if (!argDef && fieldDef && parentType) {
        const argName = argNode.name.value;
        const knownArgsNames = fieldDef.args.map((arg) => arg.name);
        const suggestions = suggestionList(argName, knownArgsNames);
        context.reportError(new GraphQLError(`Unknown argument "${argName}" on field "${parentType.name}.${fieldDef.name}".` + didYouMean(suggestions), {
          nodes: argNode
        }));
      }
    }
  };
}
function KnownArgumentNamesOnDirectivesRule(context) {
  const directiveArgs = Object.create(null);
  const schema = context.getSchema();
  const definedDirectives = schema ? schema.getDirectives() : specifiedDirectives;
  for (const directive of definedDirectives) {
    directiveArgs[directive.name] = directive.args.map((arg) => arg.name);
  }
  const astDefinitions = context.getDocument().definitions;
  for (const def of astDefinitions) {
    if (def.kind === Kind.DIRECTIVE_DEFINITION) {
      var _def$arguments;
      const argsNodes = (_def$arguments = def.arguments) !== null && _def$arguments !== undefined ? _def$arguments : [];
      directiveArgs[def.name.value] = argsNodes.map((arg) => arg.name.value);
    }
  }
  return {
    Directive(directiveNode) {
      const directiveName = directiveNode.name.value;
      const knownArgs = directiveArgs[directiveName];
      if (directiveNode.arguments && knownArgs) {
        for (const argNode of directiveNode.arguments) {
          const argName = argNode.name.value;
          if (!knownArgs.includes(argName)) {
            const suggestions = suggestionList(argName, knownArgs);
            context.reportError(new GraphQLError(`Unknown argument "${argName}" on directive "@${directiveName}".` + didYouMean(suggestions), {
              nodes: argNode
            }));
          }
        }
      }
      return false;
    }
  };
}

// node_modules/graphql/validation/rules/KnownDirectivesRule.mjs
function KnownDirectivesRule(context) {
  const locationsMap = Object.create(null);
  const schema = context.getSchema();
  const definedDirectives = schema ? schema.getDirectives() : specifiedDirectives;
  for (const directive of definedDirectives) {
    locationsMap[directive.name] = directive.locations;
  }
  const astDefinitions = context.getDocument().definitions;
  for (const def of astDefinitions) {
    if (def.kind === Kind.DIRECTIVE_DEFINITION) {
      locationsMap[def.name.value] = def.locations.map((name) => name.value);
    }
  }
  return {
    Directive(node, _key, _parent, _path, ancestors) {
      const name = node.name.value;
      const locations = locationsMap[name];
      if (!locations) {
        context.reportError(new GraphQLError(`Unknown directive "@${name}".`, {
          nodes: node
        }));
        return;
      }
      const candidateLocation = getDirectiveLocationForASTPath(ancestors);
      if (candidateLocation && !locations.includes(candidateLocation)) {
        context.reportError(new GraphQLError(`Directive "@${name}" may not be used on ${candidateLocation}.`, {
          nodes: node
        }));
      }
    }
  };
}
function getDirectiveLocationForASTPath(ancestors) {
  const appliedTo = ancestors[ancestors.length - 1];
  "kind" in appliedTo || invariant(false);
  switch (appliedTo.kind) {
    case Kind.OPERATION_DEFINITION:
      return getDirectiveLocationForOperation(appliedTo.operation);
    case Kind.FIELD:
      return DirectiveLocation.FIELD;
    case Kind.FRAGMENT_SPREAD:
      return DirectiveLocation.FRAGMENT_SPREAD;
    case Kind.INLINE_FRAGMENT:
      return DirectiveLocation.INLINE_FRAGMENT;
    case Kind.FRAGMENT_DEFINITION:
      return DirectiveLocation.FRAGMENT_DEFINITION;
    case Kind.VARIABLE_DEFINITION:
      return DirectiveLocation.VARIABLE_DEFINITION;
    case Kind.SCHEMA_DEFINITION:
    case Kind.SCHEMA_EXTENSION:
      return DirectiveLocation.SCHEMA;
    case Kind.SCALAR_TYPE_DEFINITION:
    case Kind.SCALAR_TYPE_EXTENSION:
      return DirectiveLocation.SCALAR;
    case Kind.OBJECT_TYPE_DEFINITION:
    case Kind.OBJECT_TYPE_EXTENSION:
      return DirectiveLocation.OBJECT;
    case Kind.FIELD_DEFINITION:
      return DirectiveLocation.FIELD_DEFINITION;
    case Kind.INTERFACE_TYPE_DEFINITION:
    case Kind.INTERFACE_TYPE_EXTENSION:
      return DirectiveLocation.INTERFACE;
    case Kind.UNION_TYPE_DEFINITION:
    case Kind.UNION_TYPE_EXTENSION:
      return DirectiveLocation.UNION;
    case Kind.ENUM_TYPE_DEFINITION:
    case Kind.ENUM_TYPE_EXTENSION:
      return DirectiveLocation.ENUM;
    case Kind.ENUM_VALUE_DEFINITION:
      return DirectiveLocation.ENUM_VALUE;
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
    case Kind.INPUT_OBJECT_TYPE_EXTENSION:
      return DirectiveLocation.INPUT_OBJECT;
    case Kind.INPUT_VALUE_DEFINITION: {
      const parentNode = ancestors[ancestors.length - 3];
      "kind" in parentNode || invariant(false);
      return parentNode.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION ? DirectiveLocation.INPUT_FIELD_DEFINITION : DirectiveLocation.ARGUMENT_DEFINITION;
    }
    default:
      invariant(false, "Unexpected kind: " + inspect(appliedTo.kind));
  }
}
function getDirectiveLocationForOperation(operation) {
  switch (operation) {
    case OperationTypeNode.QUERY:
      return DirectiveLocation.QUERY;
    case OperationTypeNode.MUTATION:
      return DirectiveLocation.MUTATION;
    case OperationTypeNode.SUBSCRIPTION:
      return DirectiveLocation.SUBSCRIPTION;
  }
}

// node_modules/graphql/validation/rules/KnownFragmentNamesRule.mjs
function KnownFragmentNamesRule(context) {
  return {
    FragmentSpread(node) {
      const fragmentName = node.name.value;
      const fragment = context.getFragment(fragmentName);
      if (!fragment) {
        context.reportError(new GraphQLError(`Unknown fragment "${fragmentName}".`, {
          nodes: node.name
        }));
      }
    }
  };
}

// node_modules/graphql/validation/rules/KnownTypeNamesRule.mjs
function KnownTypeNamesRule(context) {
  const schema = context.getSchema();
  const existingTypesMap = schema ? schema.getTypeMap() : Object.create(null);
  const definedTypes = Object.create(null);
  for (const def of context.getDocument().definitions) {
    if (isTypeDefinitionNode(def)) {
      definedTypes[def.name.value] = true;
    }
  }
  const typeNames = [
    ...Object.keys(existingTypesMap),
    ...Object.keys(definedTypes)
  ];
  return {
    NamedType(node, _1, parent, _2, ancestors) {
      const typeName = node.name.value;
      if (!existingTypesMap[typeName] && !definedTypes[typeName]) {
        var _ancestors$;
        const definitionNode = (_ancestors$ = ancestors[2]) !== null && _ancestors$ !== undefined ? _ancestors$ : parent;
        const isSDL = definitionNode != null && isSDLNode(definitionNode);
        if (isSDL && standardTypeNames.includes(typeName)) {
          return;
        }
        const suggestedTypes = suggestionList(typeName, isSDL ? standardTypeNames.concat(typeNames) : typeNames);
        context.reportError(new GraphQLError(`Unknown type "${typeName}".` + didYouMean(suggestedTypes), {
          nodes: node
        }));
      }
    }
  };
}
var standardTypeNames = [...specifiedScalarTypes, ...introspectionTypes].map((type) => type.name);
function isSDLNode(value) {
  return "kind" in value && (isTypeSystemDefinitionNode(value) || isTypeSystemExtensionNode(value));
}

// node_modules/graphql/validation/rules/LoneAnonymousOperationRule.mjs
function LoneAnonymousOperationRule(context) {
  let operationCount = 0;
  return {
    Document(node) {
      operationCount = node.definitions.filter((definition) => definition.kind === Kind.OPERATION_DEFINITION).length;
    },
    OperationDefinition(node) {
      if (!node.name && operationCount > 1) {
        context.reportError(new GraphQLError("This anonymous operation must be the only defined operation.", {
          nodes: node
        }));
      }
    }
  };
}

// node_modules/graphql/validation/rules/LoneSchemaDefinitionRule.mjs
function LoneSchemaDefinitionRule(context) {
  var _ref, _ref2, _oldSchema$astNode;
  const oldSchema = context.getSchema();
  const alreadyDefined = (_ref = (_ref2 = (_oldSchema$astNode = oldSchema === null || oldSchema === undefined ? undefined : oldSchema.astNode) !== null && _oldSchema$astNode !== undefined ? _oldSchema$astNode : oldSchema === null || oldSchema === undefined ? undefined : oldSchema.getQueryType()) !== null && _ref2 !== undefined ? _ref2 : oldSchema === null || oldSchema === undefined ? undefined : oldSchema.getMutationType()) !== null && _ref !== undefined ? _ref : oldSchema === null || oldSchema === undefined ? undefined : oldSchema.getSubscriptionType();
  let schemaDefinitionsCount = 0;
  return {
    SchemaDefinition(node) {
      if (alreadyDefined) {
        context.reportError(new GraphQLError("Cannot define a new schema within a schema extension.", {
          nodes: node
        }));
        return;
      }
      if (schemaDefinitionsCount > 0) {
        context.reportError(new GraphQLError("Must provide only one schema definition.", {
          nodes: node
        }));
      }
      ++schemaDefinitionsCount;
    }
  };
}

// node_modules/graphql/validation/rules/MaxIntrospectionDepthRule.mjs
var MAX_LISTS_DEPTH = 3;
function MaxIntrospectionDepthRule(context) {
  function checkDepth(node, visitedFragments = Object.create(null), depth = 0) {
    if (node.kind === Kind.FRAGMENT_SPREAD) {
      const fragmentName = node.name.value;
      if (visitedFragments[fragmentName] === true) {
        return false;
      }
      const fragment = context.getFragment(fragmentName);
      if (!fragment) {
        return false;
      }
      try {
        visitedFragments[fragmentName] = true;
        return checkDepth(fragment, visitedFragments, depth);
      } finally {
        visitedFragments[fragmentName] = undefined;
      }
    }
    if (node.kind === Kind.FIELD && (node.name.value === "fields" || node.name.value === "interfaces" || node.name.value === "possibleTypes" || node.name.value === "inputFields")) {
      depth++;
      if (depth >= MAX_LISTS_DEPTH) {
        return true;
      }
    }
    if ("selectionSet" in node && node.selectionSet) {
      for (const child of node.selectionSet.selections) {
        if (checkDepth(child, visitedFragments, depth)) {
          return true;
        }
      }
    }
    return false;
  }
  return {
    Field(node) {
      if (node.name.value === "__schema" || node.name.value === "__type") {
        if (checkDepth(node)) {
          context.reportError(new GraphQLError("Maximum introspection depth exceeded", {
            nodes: [node]
          }));
          return false;
        }
      }
    }
  };
}

// node_modules/graphql/validation/rules/NoFragmentCyclesRule.mjs
function NoFragmentCyclesRule(context) {
  const visitedFrags = Object.create(null);
  const spreadPath = [];
  const spreadPathIndexByName = Object.create(null);
  return {
    OperationDefinition: () => false,
    FragmentDefinition(node) {
      detectCycleRecursive(node);
      return false;
    }
  };
  function detectCycleRecursive(fragment) {
    if (visitedFrags[fragment.name.value]) {
      return;
    }
    const fragmentName = fragment.name.value;
    visitedFrags[fragmentName] = true;
    const spreadNodes = context.getFragmentSpreads(fragment.selectionSet);
    if (spreadNodes.length === 0) {
      return;
    }
    spreadPathIndexByName[fragmentName] = spreadPath.length;
    for (const spreadNode of spreadNodes) {
      const spreadName = spreadNode.name.value;
      const cycleIndex = spreadPathIndexByName[spreadName];
      spreadPath.push(spreadNode);
      if (cycleIndex === undefined) {
        const spreadFragment = context.getFragment(spreadName);
        if (spreadFragment) {
          detectCycleRecursive(spreadFragment);
        }
      } else {
        const cyclePath = spreadPath.slice(cycleIndex);
        const viaPath = cyclePath.slice(0, -1).map((s) => '"' + s.name.value + '"').join(", ");
        context.reportError(new GraphQLError(`Cannot spread fragment "${spreadName}" within itself` + (viaPath !== "" ? ` via ${viaPath}.` : "."), {
          nodes: cyclePath
        }));
      }
      spreadPath.pop();
    }
    spreadPathIndexByName[fragmentName] = undefined;
  }
}

// node_modules/graphql/validation/rules/NoUndefinedVariablesRule.mjs
function NoUndefinedVariablesRule(context) {
  let variableNameDefined = Object.create(null);
  return {
    OperationDefinition: {
      enter() {
        variableNameDefined = Object.create(null);
      },
      leave(operation) {
        const usages = context.getRecursiveVariableUsages(operation);
        for (const { node } of usages) {
          const varName = node.name.value;
          if (variableNameDefined[varName] !== true) {
            context.reportError(new GraphQLError(operation.name ? `Variable "$${varName}" is not defined by operation "${operation.name.value}".` : `Variable "$${varName}" is not defined.`, {
              nodes: [node, operation]
            }));
          }
        }
      }
    },
    VariableDefinition(node) {
      variableNameDefined[node.variable.name.value] = true;
    }
  };
}

// node_modules/graphql/validation/rules/NoUnusedFragmentsRule.mjs
function NoUnusedFragmentsRule(context) {
  const operationDefs = [];
  const fragmentDefs = [];
  return {
    OperationDefinition(node) {
      operationDefs.push(node);
      return false;
    },
    FragmentDefinition(node) {
      fragmentDefs.push(node);
      return false;
    },
    Document: {
      leave() {
        const fragmentNameUsed = Object.create(null);
        for (const operation of operationDefs) {
          for (const fragment of context.getRecursivelyReferencedFragments(operation)) {
            fragmentNameUsed[fragment.name.value] = true;
          }
        }
        for (const fragmentDef of fragmentDefs) {
          const fragName = fragmentDef.name.value;
          if (fragmentNameUsed[fragName] !== true) {
            context.reportError(new GraphQLError(`Fragment "${fragName}" is never used.`, {
              nodes: fragmentDef
            }));
          }
        }
      }
    }
  };
}

// node_modules/graphql/validation/rules/NoUnusedVariablesRule.mjs
function NoUnusedVariablesRule(context) {
  let variableDefs = [];
  return {
    OperationDefinition: {
      enter() {
        variableDefs = [];
      },
      leave(operation) {
        const variableNameUsed = Object.create(null);
        const usages = context.getRecursiveVariableUsages(operation);
        for (const { node } of usages) {
          variableNameUsed[node.name.value] = true;
        }
        for (const variableDef of variableDefs) {
          const variableName = variableDef.variable.name.value;
          if (variableNameUsed[variableName] !== true) {
            context.reportError(new GraphQLError(operation.name ? `Variable "$${variableName}" is never used in operation "${operation.name.value}".` : `Variable "$${variableName}" is never used.`, {
              nodes: variableDef
            }));
          }
        }
      }
    },
    VariableDefinition(def) {
      variableDefs.push(def);
    }
  };
}

// node_modules/graphql/utilities/sortValueNode.mjs
function sortValueNode(valueNode) {
  switch (valueNode.kind) {
    case Kind.OBJECT:
      return { ...valueNode, fields: sortFields(valueNode.fields) };
    case Kind.LIST:
      return { ...valueNode, values: valueNode.values.map(sortValueNode) };
    case Kind.INT:
    case Kind.FLOAT:
    case Kind.STRING:
    case Kind.BOOLEAN:
    case Kind.NULL:
    case Kind.ENUM:
    case Kind.VARIABLE:
      return valueNode;
  }
}
function sortFields(fields) {
  return fields.map((fieldNode) => ({
    ...fieldNode,
    value: sortValueNode(fieldNode.value)
  })).sort((fieldA, fieldB) => naturalCompare(fieldA.name.value, fieldB.name.value));
}

// node_modules/graphql/validation/rules/OverlappingFieldsCanBeMergedRule.mjs
function reasonMessage(reason) {
  if (Array.isArray(reason)) {
    return reason.map(([responseName, subReason]) => `subfields "${responseName}" conflict because ` + reasonMessage(subReason)).join(" and ");
  }
  return reason;
}
function OverlappingFieldsCanBeMergedRule(context) {
  const comparedFieldsAndFragmentPairs = new OrderedPairSet;
  const comparedFragmentPairs = new PairSet;
  const cachedFieldsAndFragmentNames = new Map;
  return {
    SelectionSet(selectionSet) {
      const conflicts = findConflictsWithinSelectionSet(context, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, context.getParentType(), selectionSet);
      for (const [[responseName, reason], fields1, fields2] of conflicts) {
        const reasonMsg = reasonMessage(reason);
        context.reportError(new GraphQLError(`Fields "${responseName}" conflict because ${reasonMsg}. Use different aliases on the fields to fetch both if this was intentional.`, {
          nodes: fields1.concat(fields2)
        }));
      }
    }
  };
}
function findConflictsWithinSelectionSet(context, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, parentType, selectionSet) {
  const conflicts = [];
  const [fieldMap, fragmentNames] = getFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, parentType, selectionSet);
  collectConflictsWithin(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, fieldMap);
  if (fragmentNames.length !== 0) {
    for (let i = 0;i < fragmentNames.length; i++) {
      collectConflictsBetweenFieldsAndFragment(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, false, fieldMap, fragmentNames[i]);
      for (let j = i + 1;j < fragmentNames.length; j++) {
        collectConflictsBetweenFragments(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, false, fragmentNames[i], fragmentNames[j]);
      }
    }
  }
  return conflicts;
}
function collectConflictsBetweenFieldsAndFragment(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, areMutuallyExclusive, fieldMap, fragmentName) {
  if (comparedFieldsAndFragmentPairs.has(fieldMap, fragmentName, areMutuallyExclusive)) {
    return;
  }
  comparedFieldsAndFragmentPairs.add(fieldMap, fragmentName, areMutuallyExclusive);
  const fragment = context.getFragment(fragmentName);
  if (!fragment) {
    return;
  }
  const [fieldMap2, referencedFragmentNames] = getReferencedFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, fragment);
  if (fieldMap === fieldMap2) {
    return;
  }
  collectConflictsBetween(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, areMutuallyExclusive, fieldMap, fieldMap2);
  for (const referencedFragmentName of referencedFragmentNames) {
    collectConflictsBetweenFieldsAndFragment(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, areMutuallyExclusive, fieldMap, referencedFragmentName);
  }
}
function collectConflictsBetweenFragments(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, areMutuallyExclusive, fragmentName1, fragmentName2) {
  if (fragmentName1 === fragmentName2) {
    return;
  }
  if (comparedFragmentPairs.has(fragmentName1, fragmentName2, areMutuallyExclusive)) {
    return;
  }
  comparedFragmentPairs.add(fragmentName1, fragmentName2, areMutuallyExclusive);
  const fragment1 = context.getFragment(fragmentName1);
  const fragment2 = context.getFragment(fragmentName2);
  if (!fragment1 || !fragment2) {
    return;
  }
  const [fieldMap1, referencedFragmentNames1] = getReferencedFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, fragment1);
  const [fieldMap2, referencedFragmentNames2] = getReferencedFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, fragment2);
  collectConflictsBetween(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, areMutuallyExclusive, fieldMap1, fieldMap2);
  for (const referencedFragmentName2 of referencedFragmentNames2) {
    collectConflictsBetweenFragments(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, areMutuallyExclusive, fragmentName1, referencedFragmentName2);
  }
  for (const referencedFragmentName1 of referencedFragmentNames1) {
    collectConflictsBetweenFragments(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, areMutuallyExclusive, referencedFragmentName1, fragmentName2);
  }
}
function findConflictsBetweenSubSelectionSets(context, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, areMutuallyExclusive, parentType1, selectionSet1, parentType2, selectionSet2) {
  const conflicts = [];
  const [fieldMap1, fragmentNames1] = getFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, parentType1, selectionSet1);
  const [fieldMap2, fragmentNames2] = getFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, parentType2, selectionSet2);
  collectConflictsBetween(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, areMutuallyExclusive, fieldMap1, fieldMap2);
  for (const fragmentName2 of fragmentNames2) {
    collectConflictsBetweenFieldsAndFragment(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, areMutuallyExclusive, fieldMap1, fragmentName2);
  }
  for (const fragmentName1 of fragmentNames1) {
    collectConflictsBetweenFieldsAndFragment(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, areMutuallyExclusive, fieldMap2, fragmentName1);
  }
  for (const fragmentName1 of fragmentNames1) {
    for (const fragmentName2 of fragmentNames2) {
      collectConflictsBetweenFragments(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, areMutuallyExclusive, fragmentName1, fragmentName2);
    }
  }
  return conflicts;
}
function collectConflictsWithin(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, fieldMap) {
  for (const [responseName, fields] of Object.entries(fieldMap)) {
    if (fields.length > 1) {
      for (let i = 0;i < fields.length; i++) {
        for (let j = i + 1;j < fields.length; j++) {
          const conflict = findConflict(context, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, false, responseName, fields[i], fields[j]);
          if (conflict) {
            conflicts.push(conflict);
          }
        }
      }
    }
  }
}
function collectConflictsBetween(context, conflicts, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, parentFieldsAreMutuallyExclusive, fieldMap1, fieldMap2) {
  for (const [responseName, fields1] of Object.entries(fieldMap1)) {
    const fields2 = fieldMap2[responseName];
    if (fields2) {
      for (const field1 of fields1) {
        for (const field2 of fields2) {
          const conflict = findConflict(context, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, parentFieldsAreMutuallyExclusive, responseName, field1, field2);
          if (conflict) {
            conflicts.push(conflict);
          }
        }
      }
    }
  }
}
function findConflict(context, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, parentFieldsAreMutuallyExclusive, responseName, field1, field2) {
  const [parentType1, node1, def1] = field1;
  const [parentType2, node2, def2] = field2;
  const areMutuallyExclusive = parentFieldsAreMutuallyExclusive || parentType1 !== parentType2 && isObjectType(parentType1) && isObjectType(parentType2);
  if (!areMutuallyExclusive) {
    const name1 = node1.name.value;
    const name2 = node2.name.value;
    if (name1 !== name2) {
      return [
        [responseName, `"${name1}" and "${name2}" are different fields`],
        [node1],
        [node2]
      ];
    }
    if (!sameArguments(node1, node2)) {
      return [
        [responseName, "they have differing arguments"],
        [node1],
        [node2]
      ];
    }
  }
  const type1 = def1 === null || def1 === undefined ? undefined : def1.type;
  const type2 = def2 === null || def2 === undefined ? undefined : def2.type;
  if (type1 && type2 && doTypesConflict(type1, type2)) {
    return [
      [
        responseName,
        `they return conflicting types "${inspect(type1)}" and "${inspect(type2)}"`
      ],
      [node1],
      [node2]
    ];
  }
  const selectionSet1 = node1.selectionSet;
  const selectionSet2 = node2.selectionSet;
  if (selectionSet1 && selectionSet2) {
    const conflicts = findConflictsBetweenSubSelectionSets(context, cachedFieldsAndFragmentNames, comparedFieldsAndFragmentPairs, comparedFragmentPairs, areMutuallyExclusive, getNamedType(type1), selectionSet1, getNamedType(type2), selectionSet2);
    return subfieldConflicts(conflicts, responseName, node1, node2);
  }
}
function sameArguments(node1, node2) {
  const args1 = node1.arguments;
  const args2 = node2.arguments;
  if (args1 === undefined || args1.length === 0) {
    return args2 === undefined || args2.length === 0;
  }
  if (args2 === undefined || args2.length === 0) {
    return false;
  }
  if (args1.length !== args2.length) {
    return false;
  }
  const values2 = new Map(args2.map(({ name, value }) => [name.value, value]));
  return args1.every((arg1) => {
    const value1 = arg1.value;
    const value2 = values2.get(arg1.name.value);
    if (value2 === undefined) {
      return false;
    }
    return stringifyValue(value1) === stringifyValue(value2);
  });
}
function stringifyValue(value) {
  return print(sortValueNode(value));
}
function doTypesConflict(type1, type2) {
  if (isListType(type1)) {
    return isListType(type2) ? doTypesConflict(type1.ofType, type2.ofType) : true;
  }
  if (isListType(type2)) {
    return true;
  }
  if (isNonNullType(type1)) {
    return isNonNullType(type2) ? doTypesConflict(type1.ofType, type2.ofType) : true;
  }
  if (isNonNullType(type2)) {
    return true;
  }
  if (isLeafType(type1) || isLeafType(type2)) {
    return type1 !== type2;
  }
  return false;
}
function getFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, parentType, selectionSet) {
  const cached = cachedFieldsAndFragmentNames.get(selectionSet);
  if (cached) {
    return cached;
  }
  const nodeAndDefs = Object.create(null);
  const fragmentNames = Object.create(null);
  _collectFieldsAndFragmentNames(context, parentType, selectionSet, nodeAndDefs, fragmentNames);
  const result = [nodeAndDefs, Object.keys(fragmentNames)];
  cachedFieldsAndFragmentNames.set(selectionSet, result);
  return result;
}
function getReferencedFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, fragment) {
  const cached = cachedFieldsAndFragmentNames.get(fragment.selectionSet);
  if (cached) {
    return cached;
  }
  const fragmentType = typeFromAST(context.getSchema(), fragment.typeCondition);
  return getFieldsAndFragmentNames(context, cachedFieldsAndFragmentNames, fragmentType, fragment.selectionSet);
}
function _collectFieldsAndFragmentNames(context, parentType, selectionSet, nodeAndDefs, fragmentNames) {
  for (const selection of selectionSet.selections) {
    switch (selection.kind) {
      case Kind.FIELD: {
        const fieldName = selection.name.value;
        let fieldDef;
        if (isObjectType(parentType) || isInterfaceType(parentType)) {
          fieldDef = parentType.getFields()[fieldName];
        }
        const responseName = selection.alias ? selection.alias.value : fieldName;
        if (!nodeAndDefs[responseName]) {
          nodeAndDefs[responseName] = [];
        }
        nodeAndDefs[responseName].push([parentType, selection, fieldDef]);
        break;
      }
      case Kind.FRAGMENT_SPREAD:
        fragmentNames[selection.name.value] = true;
        break;
      case Kind.INLINE_FRAGMENT: {
        const typeCondition = selection.typeCondition;
        const inlineFragmentType = typeCondition ? typeFromAST(context.getSchema(), typeCondition) : parentType;
        _collectFieldsAndFragmentNames(context, inlineFragmentType, selection.selectionSet, nodeAndDefs, fragmentNames);
        break;
      }
    }
  }
}
function subfieldConflicts(conflicts, responseName, node1, node2) {
  if (conflicts.length > 0) {
    return [
      [responseName, conflicts.map(([reason]) => reason)],
      [node1, ...conflicts.map(([, fields1]) => fields1).flat()],
      [node2, ...conflicts.map(([, , fields2]) => fields2).flat()]
    ];
  }
}

class OrderedPairSet {
  constructor() {
    this._data = new Map;
  }
  has(a, b, weaklyPresent) {
    var _this$_data$get;
    const result = (_this$_data$get = this._data.get(a)) === null || _this$_data$get === undefined ? undefined : _this$_data$get.get(b);
    if (result === undefined) {
      return false;
    }
    return weaklyPresent ? true : weaklyPresent === result;
  }
  add(a, b, weaklyPresent) {
    const map = this._data.get(a);
    if (map === undefined) {
      this._data.set(a, new Map([[b, weaklyPresent]]));
    } else {
      map.set(b, weaklyPresent);
    }
  }
}

class PairSet {
  constructor() {
    this._orderedPairSet = new OrderedPairSet;
  }
  has(a, b, weaklyPresent) {
    return a < b ? this._orderedPairSet.has(a, b, weaklyPresent) : this._orderedPairSet.has(b, a, weaklyPresent);
  }
  add(a, b, weaklyPresent) {
    if (a < b) {
      this._orderedPairSet.add(a, b, weaklyPresent);
    } else {
      this._orderedPairSet.add(b, a, weaklyPresent);
    }
  }
}

// node_modules/graphql/validation/rules/PossibleFragmentSpreadsRule.mjs
function PossibleFragmentSpreadsRule(context) {
  return {
    InlineFragment(node) {
      const fragType = context.getType();
      const parentType = context.getParentType();
      if (isCompositeType(fragType) && isCompositeType(parentType) && !doTypesOverlap(context.getSchema(), fragType, parentType)) {
        const parentTypeStr = inspect(parentType);
        const fragTypeStr = inspect(fragType);
        context.reportError(new GraphQLError(`Fragment cannot be spread here as objects of type "${parentTypeStr}" can never be of type "${fragTypeStr}".`, {
          nodes: node
        }));
      }
    },
    FragmentSpread(node) {
      const fragName = node.name.value;
      const fragType = getFragmentType(context, fragName);
      const parentType = context.getParentType();
      if (fragType && parentType && !doTypesOverlap(context.getSchema(), fragType, parentType)) {
        const parentTypeStr = inspect(parentType);
        const fragTypeStr = inspect(fragType);
        context.reportError(new GraphQLError(`Fragment "${fragName}" cannot be spread here as objects of type "${parentTypeStr}" can never be of type "${fragTypeStr}".`, {
          nodes: node
        }));
      }
    }
  };
}
function getFragmentType(context, name) {
  const frag = context.getFragment(name);
  if (frag) {
    const type = typeFromAST(context.getSchema(), frag.typeCondition);
    if (isCompositeType(type)) {
      return type;
    }
  }
}

// node_modules/graphql/validation/rules/PossibleTypeExtensionsRule.mjs
function PossibleTypeExtensionsRule(context) {
  const schema = context.getSchema();
  const definedTypes = Object.create(null);
  for (const def of context.getDocument().definitions) {
    if (isTypeDefinitionNode(def)) {
      definedTypes[def.name.value] = def;
    }
  }
  return {
    ScalarTypeExtension: checkExtension,
    ObjectTypeExtension: checkExtension,
    InterfaceTypeExtension: checkExtension,
    UnionTypeExtension: checkExtension,
    EnumTypeExtension: checkExtension,
    InputObjectTypeExtension: checkExtension
  };
  function checkExtension(node) {
    const typeName = node.name.value;
    const defNode = definedTypes[typeName];
    const existingType = schema === null || schema === undefined ? undefined : schema.getType(typeName);
    let expectedKind;
    if (defNode) {
      expectedKind = defKindToExtKind[defNode.kind];
    } else if (existingType) {
      expectedKind = typeToExtKind(existingType);
    }
    if (expectedKind) {
      if (expectedKind !== node.kind) {
        const kindStr = extensionKindToTypeName(node.kind);
        context.reportError(new GraphQLError(`Cannot extend non-${kindStr} type "${typeName}".`, {
          nodes: defNode ? [defNode, node] : node
        }));
      }
    } else {
      const allTypeNames = Object.keys({
        ...definedTypes,
        ...schema === null || schema === undefined ? undefined : schema.getTypeMap()
      });
      const suggestedTypes = suggestionList(typeName, allTypeNames);
      context.reportError(new GraphQLError(`Cannot extend type "${typeName}" because it is not defined.` + didYouMean(suggestedTypes), {
        nodes: node.name
      }));
    }
  }
}
var defKindToExtKind = {
  [Kind.SCALAR_TYPE_DEFINITION]: Kind.SCALAR_TYPE_EXTENSION,
  [Kind.OBJECT_TYPE_DEFINITION]: Kind.OBJECT_TYPE_EXTENSION,
  [Kind.INTERFACE_TYPE_DEFINITION]: Kind.INTERFACE_TYPE_EXTENSION,
  [Kind.UNION_TYPE_DEFINITION]: Kind.UNION_TYPE_EXTENSION,
  [Kind.ENUM_TYPE_DEFINITION]: Kind.ENUM_TYPE_EXTENSION,
  [Kind.INPUT_OBJECT_TYPE_DEFINITION]: Kind.INPUT_OBJECT_TYPE_EXTENSION
};
function typeToExtKind(type) {
  if (isScalarType(type)) {
    return Kind.SCALAR_TYPE_EXTENSION;
  }
  if (isObjectType(type)) {
    return Kind.OBJECT_TYPE_EXTENSION;
  }
  if (isInterfaceType(type)) {
    return Kind.INTERFACE_TYPE_EXTENSION;
  }
  if (isUnionType(type)) {
    return Kind.UNION_TYPE_EXTENSION;
  }
  if (isEnumType(type)) {
    return Kind.ENUM_TYPE_EXTENSION;
  }
  if (isInputObjectType(type)) {
    return Kind.INPUT_OBJECT_TYPE_EXTENSION;
  }
  invariant(false, "Unexpected type: " + inspect(type));
}
function extensionKindToTypeName(kind) {
  switch (kind) {
    case Kind.SCALAR_TYPE_EXTENSION:
      return "scalar";
    case Kind.OBJECT_TYPE_EXTENSION:
      return "object";
    case Kind.INTERFACE_TYPE_EXTENSION:
      return "interface";
    case Kind.UNION_TYPE_EXTENSION:
      return "union";
    case Kind.ENUM_TYPE_EXTENSION:
      return "enum";
    case Kind.INPUT_OBJECT_TYPE_EXTENSION:
      return "input object";
    default:
      invariant(false, "Unexpected kind: " + inspect(kind));
  }
}

// node_modules/graphql/validation/rules/ProvidedRequiredArgumentsRule.mjs
function ProvidedRequiredArgumentsRule(context) {
  return {
    ...ProvidedRequiredArgumentsOnDirectivesRule(context),
    Field: {
      leave(fieldNode) {
        var _fieldNode$arguments;
        const fieldDef = context.getFieldDef();
        if (!fieldDef) {
          return false;
        }
        const providedArgs = new Set((_fieldNode$arguments = fieldNode.arguments) === null || _fieldNode$arguments === undefined ? undefined : _fieldNode$arguments.map((arg) => arg.name.value));
        for (const argDef of fieldDef.args) {
          if (!providedArgs.has(argDef.name) && isRequiredArgument(argDef)) {
            const argTypeStr = inspect(argDef.type);
            context.reportError(new GraphQLError(`Field "${fieldDef.name}" argument "${argDef.name}" of type "${argTypeStr}" is required, but it was not provided.`, {
              nodes: fieldNode
            }));
          }
        }
      }
    }
  };
}
function ProvidedRequiredArgumentsOnDirectivesRule(context) {
  var _schema$getDirectives;
  const requiredArgsMap = Object.create(null);
  const schema = context.getSchema();
  const definedDirectives = (_schema$getDirectives = schema === null || schema === undefined ? undefined : schema.getDirectives()) !== null && _schema$getDirectives !== undefined ? _schema$getDirectives : specifiedDirectives;
  for (const directive of definedDirectives) {
    requiredArgsMap[directive.name] = keyMap(directive.args.filter(isRequiredArgument), (arg) => arg.name);
  }
  const astDefinitions = context.getDocument().definitions;
  for (const def of astDefinitions) {
    if (def.kind === Kind.DIRECTIVE_DEFINITION) {
      var _def$arguments;
      const argNodes = (_def$arguments = def.arguments) !== null && _def$arguments !== undefined ? _def$arguments : [];
      requiredArgsMap[def.name.value] = keyMap(argNodes.filter(isRequiredArgumentNode), (arg) => arg.name.value);
    }
  }
  return {
    Directive: {
      leave(directiveNode) {
        const directiveName = directiveNode.name.value;
        const requiredArgs = requiredArgsMap[directiveName];
        if (requiredArgs) {
          var _directiveNode$argume;
          const argNodes = (_directiveNode$argume = directiveNode.arguments) !== null && _directiveNode$argume !== undefined ? _directiveNode$argume : [];
          const argNodeMap = new Set(argNodes.map((arg) => arg.name.value));
          for (const [argName, argDef] of Object.entries(requiredArgs)) {
            if (!argNodeMap.has(argName)) {
              const argType = isType(argDef.type) ? inspect(argDef.type) : print(argDef.type);
              context.reportError(new GraphQLError(`Directive "@${directiveName}" argument "${argName}" of type "${argType}" is required, but it was not provided.`, {
                nodes: directiveNode
              }));
            }
          }
        }
      }
    }
  };
}
function isRequiredArgumentNode(arg) {
  return arg.type.kind === Kind.NON_NULL_TYPE && arg.defaultValue == null;
}

// node_modules/graphql/validation/rules/ScalarLeafsRule.mjs
function ScalarLeafsRule(context) {
  return {
    Field(node) {
      const type = context.getType();
      const selectionSet = node.selectionSet;
      if (type) {
        if (isLeafType(getNamedType(type))) {
          if (selectionSet) {
            const fieldName = node.name.value;
            const typeStr = inspect(type);
            context.reportError(new GraphQLError(`Field "${fieldName}" must not have a selection since type "${typeStr}" has no subfields.`, {
              nodes: selectionSet
            }));
          }
        } else if (!selectionSet) {
          const fieldName = node.name.value;
          const typeStr = inspect(type);
          context.reportError(new GraphQLError(`Field "${fieldName}" of type "${typeStr}" must have a selection of subfields. Did you mean "${fieldName} { ... }"?`, {
            nodes: node
          }));
        } else if (selectionSet.selections.length === 0) {
          const fieldName = node.name.value;
          const typeStr = inspect(type);
          context.reportError(new GraphQLError(`Field "${fieldName}" of type "${typeStr}" must have at least one field selected.`, {
            nodes: node
          }));
        }
      }
    }
  };
}

// node_modules/graphql/jsutils/printPathArray.mjs
function printPathArray(path) {
  return path.map((key) => typeof key === "number" ? "[" + key.toString() + "]" : "." + key).join("");
}

// node_modules/graphql/jsutils/Path.mjs
function addPath(prev, key, typename) {
  return {
    prev,
    key,
    typename
  };
}
function pathToArray(path) {
  const flattened = [];
  let curr = path;
  while (curr) {
    flattened.push(curr.key);
    curr = curr.prev;
  }
  return flattened.reverse();
}

// node_modules/graphql/utilities/coerceInputValue.mjs
function coerceInputValue(inputValue, type, onError = defaultOnError) {
  return coerceInputValueImpl(inputValue, type, onError, undefined);
}
function defaultOnError(path, invalidValue, error) {
  let errorPrefix = "Invalid value " + inspect(invalidValue);
  if (path.length > 0) {
    errorPrefix += ` at "value${printPathArray(path)}"`;
  }
  error.message = errorPrefix + ": " + error.message;
  throw error;
}
function coerceInputValueImpl(inputValue, type, onError, path) {
  if (isNonNullType(type)) {
    if (inputValue != null) {
      return coerceInputValueImpl(inputValue, type.ofType, onError, path);
    }
    onError(pathToArray(path), inputValue, new GraphQLError(`Expected non-nullable type "${inspect(type)}" not to be null.`));
    return;
  }
  if (inputValue == null) {
    return null;
  }
  if (isListType(type)) {
    const itemType = type.ofType;
    if (isIterableObject(inputValue)) {
      return Array.from(inputValue, (itemValue, index) => {
        const itemPath = addPath(path, index, undefined);
        return coerceInputValueImpl(itemValue, itemType, onError, itemPath);
      });
    }
    return [coerceInputValueImpl(inputValue, itemType, onError, path)];
  }
  if (isInputObjectType(type)) {
    if (!isObjectLike(inputValue) || Array.isArray(inputValue)) {
      onError(pathToArray(path), inputValue, new GraphQLError(`Expected type "${type.name}" to be an object.`));
      return;
    }
    const coercedValue = {};
    const fieldDefs = type.getFields();
    for (const field of Object.values(fieldDefs)) {
      const fieldValue = inputValue[field.name];
      if (fieldValue === undefined) {
        if (field.defaultValue !== undefined) {
          coercedValue[field.name] = field.defaultValue;
        } else if (isNonNullType(field.type)) {
          const typeStr = inspect(field.type);
          onError(pathToArray(path), inputValue, new GraphQLError(`Field "${field.name}" of required type "${typeStr}" was not provided.`));
        }
        continue;
      }
      coercedValue[field.name] = coerceInputValueImpl(fieldValue, field.type, onError, addPath(path, field.name, type.name));
    }
    for (const fieldName of Object.keys(inputValue)) {
      if (!fieldDefs[fieldName]) {
        const suggestions = suggestionList(fieldName, Object.keys(type.getFields()));
        onError(pathToArray(path), inputValue, new GraphQLError(`Field "${fieldName}" is not defined by type "${type.name}".` + didYouMean(suggestions)));
      }
    }
    if (type.isOneOf) {
      const keys = Object.keys(coercedValue);
      if (keys.length !== 1) {
        onError(pathToArray(path), inputValue, new GraphQLError(`Exactly one key must be specified for OneOf type "${type.name}".`));
      }
      const key = keys[0];
      const value = coercedValue[key];
      if (value === null) {
        onError(pathToArray(path).concat(key), value, new GraphQLError(`Field "${key}" must be non-null.`));
      }
    }
    return coercedValue;
  }
  if (isLeafType(type)) {
    let parseResult;
    try {
      parseResult = type.parseValue(inputValue);
    } catch (error) {
      if (error instanceof GraphQLError) {
        onError(pathToArray(path), inputValue, error);
      } else {
        onError(pathToArray(path), inputValue, new GraphQLError(`Expected type "${type.name}". ` + error.message, {
          originalError: error
        }));
      }
      return;
    }
    if (parseResult === undefined) {
      onError(pathToArray(path), inputValue, new GraphQLError(`Expected type "${type.name}".`));
    }
    return parseResult;
  }
  invariant(false, "Unexpected input type: " + inspect(type));
}

// node_modules/graphql/utilities/valueFromAST.mjs
function valueFromAST(valueNode, type, variables) {
  if (!valueNode) {
    return;
  }
  if (valueNode.kind === Kind.VARIABLE) {
    const variableName = valueNode.name.value;
    if (variables == null || variables[variableName] === undefined) {
      return;
    }
    const variableValue = variables[variableName];
    if (variableValue === null && isNonNullType(type)) {
      return;
    }
    return variableValue;
  }
  if (isNonNullType(type)) {
    if (valueNode.kind === Kind.NULL) {
      return;
    }
    return valueFromAST(valueNode, type.ofType, variables);
  }
  if (valueNode.kind === Kind.NULL) {
    return null;
  }
  if (isListType(type)) {
    const itemType = type.ofType;
    if (valueNode.kind === Kind.LIST) {
      const coercedValues = [];
      for (const itemNode of valueNode.values) {
        if (isMissingVariable(itemNode, variables)) {
          if (isNonNullType(itemType)) {
            return;
          }
          coercedValues.push(null);
        } else {
          const itemValue = valueFromAST(itemNode, itemType, variables);
          if (itemValue === undefined) {
            return;
          }
          coercedValues.push(itemValue);
        }
      }
      return coercedValues;
    }
    const coercedValue = valueFromAST(valueNode, itemType, variables);
    if (coercedValue === undefined) {
      return;
    }
    return [coercedValue];
  }
  if (isInputObjectType(type)) {
    if (valueNode.kind !== Kind.OBJECT) {
      return;
    }
    const coercedObj = Object.create(null);
    const fieldNodes = keyMap(valueNode.fields, (field) => field.name.value);
    for (const field of Object.values(type.getFields())) {
      const fieldNode = fieldNodes[field.name];
      if (!fieldNode || isMissingVariable(fieldNode.value, variables)) {
        if (field.defaultValue !== undefined) {
          coercedObj[field.name] = field.defaultValue;
        } else if (isNonNullType(field.type)) {
          return;
        }
        continue;
      }
      const fieldValue = valueFromAST(fieldNode.value, field.type, variables);
      if (fieldValue === undefined) {
        return;
      }
      coercedObj[field.name] = fieldValue;
    }
    if (type.isOneOf) {
      const keys = Object.keys(coercedObj);
      if (keys.length !== 1) {
        return;
      }
      if (coercedObj[keys[0]] === null) {
        return;
      }
    }
    return coercedObj;
  }
  if (isLeafType(type)) {
    let result;
    try {
      result = type.parseLiteral(valueNode, variables);
    } catch (_error) {
      return;
    }
    if (result === undefined) {
      return;
    }
    return result;
  }
  invariant(false, "Unexpected input type: " + inspect(type));
}
function isMissingVariable(valueNode, variables) {
  return valueNode.kind === Kind.VARIABLE && (variables == null || variables[valueNode.name.value] === undefined);
}

// node_modules/graphql/execution/values.mjs
function getVariableValues(schema, varDefNodes, inputs, options) {
  const errors = [];
  const maxErrors = options === null || options === undefined ? undefined : options.maxErrors;
  try {
    const coerced = coerceVariableValues(schema, varDefNodes, inputs, (error) => {
      if (maxErrors != null && errors.length >= maxErrors) {
        throw new GraphQLError("Too many errors processing variables, error limit reached. Execution aborted.");
      }
      errors.push(error);
    });
    if (errors.length === 0) {
      return {
        coerced
      };
    }
  } catch (error) {
    errors.push(error);
  }
  return {
    errors
  };
}
function coerceVariableValues(schema, varDefNodes, inputs, onError) {
  const coercedValues = {};
  for (const varDefNode of varDefNodes) {
    const varName = varDefNode.variable.name.value;
    const varType = typeFromAST(schema, varDefNode.type);
    if (!isInputType(varType)) {
      const varTypeStr = print(varDefNode.type);
      onError(new GraphQLError(`Variable "$${varName}" expected value of type "${varTypeStr}" which cannot be used as an input type.`, {
        nodes: varDefNode.type
      }));
      continue;
    }
    if (!hasOwnProperty(inputs, varName)) {
      if (varDefNode.defaultValue) {
        coercedValues[varName] = valueFromAST(varDefNode.defaultValue, varType);
      } else if (isNonNullType(varType)) {
        const varTypeStr = inspect(varType);
        onError(new GraphQLError(`Variable "$${varName}" of required type "${varTypeStr}" was not provided.`, {
          nodes: varDefNode
        }));
      }
      continue;
    }
    const value = inputs[varName];
    if (value === null && isNonNullType(varType)) {
      const varTypeStr = inspect(varType);
      onError(new GraphQLError(`Variable "$${varName}" of non-null type "${varTypeStr}" must not be null.`, {
        nodes: varDefNode
      }));
      continue;
    }
    coercedValues[varName] = coerceInputValue(value, varType, (path, invalidValue, error) => {
      let prefix = `Variable "$${varName}" got invalid value ` + inspect(invalidValue);
      if (path.length > 0) {
        prefix += ` at "${varName}${printPathArray(path)}"`;
      }
      onError(new GraphQLError(prefix + "; " + error.message, {
        nodes: varDefNode,
        originalError: error
      }));
    });
  }
  return coercedValues;
}
function getArgumentValues(def, node, variableValues) {
  var _node$arguments;
  const coercedValues = {};
  const argumentNodes = (_node$arguments = node.arguments) !== null && _node$arguments !== undefined ? _node$arguments : [];
  const argNodeMap = keyMap(argumentNodes, (arg) => arg.name.value);
  for (const argDef of def.args) {
    const name = argDef.name;
    const argType = argDef.type;
    const argumentNode = argNodeMap[name];
    if (!argumentNode) {
      if (argDef.defaultValue !== undefined) {
        coercedValues[name] = argDef.defaultValue;
      } else if (isNonNullType(argType)) {
        throw new GraphQLError(`Argument "${name}" of required type "${inspect(argType)}" ` + "was not provided.", {
          nodes: node
        });
      }
      continue;
    }
    const valueNode = argumentNode.value;
    let isNull = valueNode.kind === Kind.NULL;
    if (valueNode.kind === Kind.VARIABLE) {
      const variableName = valueNode.name.value;
      if (variableValues == null || !hasOwnProperty(variableValues, variableName)) {
        if (argDef.defaultValue !== undefined) {
          coercedValues[name] = argDef.defaultValue;
        } else if (isNonNullType(argType)) {
          throw new GraphQLError(`Argument "${name}" of required type "${inspect(argType)}" ` + `was provided the variable "$${variableName}" which was not provided a runtime value.`, {
            nodes: valueNode
          });
        }
        continue;
      }
      isNull = variableValues[variableName] == null;
    }
    if (isNull && isNonNullType(argType)) {
      throw new GraphQLError(`Argument "${name}" of non-null type "${inspect(argType)}" ` + "must not be null.", {
        nodes: valueNode
      });
    }
    const coercedValue = valueFromAST(valueNode, argType, variableValues);
    if (coercedValue === undefined) {
      throw new GraphQLError(`Argument "${name}" has invalid value ${print(valueNode)}.`, {
        nodes: valueNode
      });
    }
    coercedValues[name] = coercedValue;
  }
  return coercedValues;
}
function getDirectiveValues(directiveDef, node, variableValues) {
  var _node$directives;
  const directiveNode = (_node$directives = node.directives) === null || _node$directives === undefined ? undefined : _node$directives.find((directive) => directive.name.value === directiveDef.name);
  if (directiveNode) {
    return getArgumentValues(directiveDef, directiveNode, variableValues);
  }
}
function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

// node_modules/graphql/execution/collectFields.mjs
function collectFields(schema, fragments, variableValues, runtimeType, selectionSet) {
  const fields = new Map;
  collectFieldsImpl(schema, fragments, variableValues, runtimeType, selectionSet, fields, new Set);
  return fields;
}
function collectSubfields(schema, fragments, variableValues, returnType, fieldNodes) {
  const subFieldNodes = new Map;
  const visitedFragmentNames = new Set;
  for (const node of fieldNodes) {
    if (node.selectionSet) {
      collectFieldsImpl(schema, fragments, variableValues, returnType, node.selectionSet, subFieldNodes, visitedFragmentNames);
    }
  }
  return subFieldNodes;
}
function collectFieldsImpl(schema, fragments, variableValues, runtimeType, selectionSet, fields, visitedFragmentNames) {
  for (const selection of selectionSet.selections) {
    switch (selection.kind) {
      case Kind.FIELD: {
        if (!shouldIncludeNode(variableValues, selection)) {
          continue;
        }
        const name = getFieldEntryKey(selection);
        const fieldList = fields.get(name);
        if (fieldList !== undefined) {
          fieldList.push(selection);
        } else {
          fields.set(name, [selection]);
        }
        break;
      }
      case Kind.INLINE_FRAGMENT: {
        if (!shouldIncludeNode(variableValues, selection) || !doesFragmentConditionMatch(schema, selection, runtimeType)) {
          continue;
        }
        collectFieldsImpl(schema, fragments, variableValues, runtimeType, selection.selectionSet, fields, visitedFragmentNames);
        break;
      }
      case Kind.FRAGMENT_SPREAD: {
        const fragName = selection.name.value;
        if (visitedFragmentNames.has(fragName) || !shouldIncludeNode(variableValues, selection)) {
          continue;
        }
        visitedFragmentNames.add(fragName);
        const fragment = fragments[fragName];
        if (!fragment || !doesFragmentConditionMatch(schema, fragment, runtimeType)) {
          continue;
        }
        collectFieldsImpl(schema, fragments, variableValues, runtimeType, fragment.selectionSet, fields, visitedFragmentNames);
        break;
      }
    }
  }
}
function shouldIncludeNode(variableValues, node) {
  const skip = getDirectiveValues(GraphQLSkipDirective, node, variableValues);
  if ((skip === null || skip === undefined ? undefined : skip.if) === true) {
    return false;
  }
  const include = getDirectiveValues(GraphQLIncludeDirective, node, variableValues);
  if ((include === null || include === undefined ? undefined : include.if) === false) {
    return false;
  }
  return true;
}
function doesFragmentConditionMatch(schema, fragment, type) {
  const typeConditionNode = fragment.typeCondition;
  if (!typeConditionNode) {
    return true;
  }
  const conditionalType = typeFromAST(schema, typeConditionNode);
  if (conditionalType === type) {
    return true;
  }
  if (isAbstractType(conditionalType)) {
    return schema.isSubType(conditionalType, type);
  }
  return false;
}
function getFieldEntryKey(node) {
  return node.alias ? node.alias.value : node.name.value;
}

// node_modules/graphql/validation/rules/SingleFieldSubscriptionsRule.mjs
function SingleFieldSubscriptionsRule(context) {
  return {
    OperationDefinition(node) {
      if (node.operation === "subscription") {
        const schema = context.getSchema();
        const subscriptionType = schema.getSubscriptionType();
        if (subscriptionType) {
          const operationName = node.name ? node.name.value : null;
          const variableValues = Object.create(null);
          const document = context.getDocument();
          const fragments = Object.create(null);
          for (const definition of document.definitions) {
            if (definition.kind === Kind.FRAGMENT_DEFINITION) {
              fragments[definition.name.value] = definition;
            }
          }
          const fields = collectFields(schema, fragments, variableValues, subscriptionType, node.selectionSet);
          if (fields.size > 1) {
            const fieldSelectionLists = [...fields.values()];
            const extraFieldSelectionLists = fieldSelectionLists.slice(1);
            const extraFieldSelections = extraFieldSelectionLists.flat();
            context.reportError(new GraphQLError(operationName != null ? `Subscription "${operationName}" must select only one top level field.` : "Anonymous Subscription must select only one top level field.", {
              nodes: extraFieldSelections
            }));
          }
          for (const fieldNodes of fields.values()) {
            const field = fieldNodes[0];
            const fieldName = field.name.value;
            if (fieldName.startsWith("__")) {
              context.reportError(new GraphQLError(operationName != null ? `Subscription "${operationName}" must not select an introspection top level field.` : "Anonymous Subscription must not select an introspection top level field.", {
                nodes: fieldNodes
              }));
            }
          }
        }
      }
    }
  };
}

// node_modules/graphql/jsutils/groupBy.mjs
function groupBy(list, keyFn) {
  const result = new Map;
  for (const item of list) {
    const key = keyFn(item);
    const group = result.get(key);
    if (group === undefined) {
      result.set(key, [item]);
    } else {
      group.push(item);
    }
  }
  return result;
}

// node_modules/graphql/validation/rules/UniqueArgumentDefinitionNamesRule.mjs
function UniqueArgumentDefinitionNamesRule(context) {
  return {
    DirectiveDefinition(directiveNode) {
      var _directiveNode$argume;
      const argumentNodes = (_directiveNode$argume = directiveNode.arguments) !== null && _directiveNode$argume !== undefined ? _directiveNode$argume : [];
      return checkArgUniqueness(`@${directiveNode.name.value}`, argumentNodes);
    },
    InterfaceTypeDefinition: checkArgUniquenessPerField,
    InterfaceTypeExtension: checkArgUniquenessPerField,
    ObjectTypeDefinition: checkArgUniquenessPerField,
    ObjectTypeExtension: checkArgUniquenessPerField
  };
  function checkArgUniquenessPerField(typeNode) {
    var _typeNode$fields;
    const typeName = typeNode.name.value;
    const fieldNodes = (_typeNode$fields = typeNode.fields) !== null && _typeNode$fields !== undefined ? _typeNode$fields : [];
    for (const fieldDef of fieldNodes) {
      var _fieldDef$arguments;
      const fieldName = fieldDef.name.value;
      const argumentNodes = (_fieldDef$arguments = fieldDef.arguments) !== null && _fieldDef$arguments !== undefined ? _fieldDef$arguments : [];
      checkArgUniqueness(`${typeName}.${fieldName}`, argumentNodes);
    }
    return false;
  }
  function checkArgUniqueness(parentName, argumentNodes) {
    const seenArgs = groupBy(argumentNodes, (arg) => arg.name.value);
    for (const [argName, argNodes] of seenArgs) {
      if (argNodes.length > 1) {
        context.reportError(new GraphQLError(`Argument "${parentName}(${argName}:)" can only be defined once.`, {
          nodes: argNodes.map((node) => node.name)
        }));
      }
    }
    return false;
  }
}

// node_modules/graphql/validation/rules/UniqueArgumentNamesRule.mjs
function UniqueArgumentNamesRule(context) {
  return {
    Field: checkArgUniqueness,
    Directive: checkArgUniqueness
  };
  function checkArgUniqueness(parentNode) {
    var _parentNode$arguments;
    const argumentNodes = (_parentNode$arguments = parentNode.arguments) !== null && _parentNode$arguments !== undefined ? _parentNode$arguments : [];
    const seenArgs = groupBy(argumentNodes, (arg) => arg.name.value);
    for (const [argName, argNodes] of seenArgs) {
      if (argNodes.length > 1) {
        context.reportError(new GraphQLError(`There can be only one argument named "${argName}".`, {
          nodes: argNodes.map((node) => node.name)
        }));
      }
    }
  }
}

// node_modules/graphql/validation/rules/UniqueDirectiveNamesRule.mjs
function UniqueDirectiveNamesRule(context) {
  const knownDirectiveNames = Object.create(null);
  const schema = context.getSchema();
  return {
    DirectiveDefinition(node) {
      const directiveName = node.name.value;
      if (schema !== null && schema !== undefined && schema.getDirective(directiveName)) {
        context.reportError(new GraphQLError(`Directive "@${directiveName}" already exists in the schema. It cannot be redefined.`, {
          nodes: node.name
        }));
        return;
      }
      if (knownDirectiveNames[directiveName]) {
        context.reportError(new GraphQLError(`There can be only one directive named "@${directiveName}".`, {
          nodes: [knownDirectiveNames[directiveName], node.name]
        }));
      } else {
        knownDirectiveNames[directiveName] = node.name;
      }
      return false;
    }
  };
}

// node_modules/graphql/validation/rules/UniqueDirectivesPerLocationRule.mjs
function UniqueDirectivesPerLocationRule(context) {
  const uniqueDirectiveMap = Object.create(null);
  const schema = context.getSchema();
  const definedDirectives = schema ? schema.getDirectives() : specifiedDirectives;
  for (const directive of definedDirectives) {
    uniqueDirectiveMap[directive.name] = !directive.isRepeatable;
  }
  const astDefinitions = context.getDocument().definitions;
  for (const def of astDefinitions) {
    if (def.kind === Kind.DIRECTIVE_DEFINITION) {
      uniqueDirectiveMap[def.name.value] = !def.repeatable;
    }
  }
  const schemaDirectives = Object.create(null);
  const typeDirectivesMap = Object.create(null);
  return {
    enter(node) {
      if (!("directives" in node) || !node.directives) {
        return;
      }
      let seenDirectives;
      if (node.kind === Kind.SCHEMA_DEFINITION || node.kind === Kind.SCHEMA_EXTENSION) {
        seenDirectives = schemaDirectives;
      } else if (isTypeDefinitionNode(node) || isTypeExtensionNode(node)) {
        const typeName = node.name.value;
        seenDirectives = typeDirectivesMap[typeName];
        if (seenDirectives === undefined) {
          typeDirectivesMap[typeName] = seenDirectives = Object.create(null);
        }
      } else {
        seenDirectives = Object.create(null);
      }
      for (const directive of node.directives) {
        const directiveName = directive.name.value;
        if (uniqueDirectiveMap[directiveName]) {
          if (seenDirectives[directiveName]) {
            context.reportError(new GraphQLError(`The directive "@${directiveName}" can only be used once at this location.`, {
              nodes: [seenDirectives[directiveName], directive]
            }));
          } else {
            seenDirectives[directiveName] = directive;
          }
        }
      }
    }
  };
}

// node_modules/graphql/validation/rules/UniqueEnumValueNamesRule.mjs
function UniqueEnumValueNamesRule(context) {
  const schema = context.getSchema();
  const existingTypeMap = schema ? schema.getTypeMap() : Object.create(null);
  const knownValueNames = Object.create(null);
  return {
    EnumTypeDefinition: checkValueUniqueness,
    EnumTypeExtension: checkValueUniqueness
  };
  function checkValueUniqueness(node) {
    var _node$values;
    const typeName = node.name.value;
    if (!knownValueNames[typeName]) {
      knownValueNames[typeName] = Object.create(null);
    }
    const valueNodes = (_node$values = node.values) !== null && _node$values !== undefined ? _node$values : [];
    const valueNames = knownValueNames[typeName];
    for (const valueDef of valueNodes) {
      const valueName = valueDef.name.value;
      const existingType = existingTypeMap[typeName];
      if (isEnumType(existingType) && existingType.getValue(valueName)) {
        context.reportError(new GraphQLError(`Enum value "${typeName}.${valueName}" already exists in the schema. It cannot also be defined in this type extension.`, {
          nodes: valueDef.name
        }));
      } else if (valueNames[valueName]) {
        context.reportError(new GraphQLError(`Enum value "${typeName}.${valueName}" can only be defined once.`, {
          nodes: [valueNames[valueName], valueDef.name]
        }));
      } else {
        valueNames[valueName] = valueDef.name;
      }
    }
    return false;
  }
}

// node_modules/graphql/validation/rules/UniqueFieldDefinitionNamesRule.mjs
function UniqueFieldDefinitionNamesRule(context) {
  const schema = context.getSchema();
  const existingTypeMap = schema ? schema.getTypeMap() : Object.create(null);
  const knownFieldNames = Object.create(null);
  return {
    InputObjectTypeDefinition: checkFieldUniqueness,
    InputObjectTypeExtension: checkFieldUniqueness,
    InterfaceTypeDefinition: checkFieldUniqueness,
    InterfaceTypeExtension: checkFieldUniqueness,
    ObjectTypeDefinition: checkFieldUniqueness,
    ObjectTypeExtension: checkFieldUniqueness
  };
  function checkFieldUniqueness(node) {
    var _node$fields;
    const typeName = node.name.value;
    if (!knownFieldNames[typeName]) {
      knownFieldNames[typeName] = Object.create(null);
    }
    const fieldNodes = (_node$fields = node.fields) !== null && _node$fields !== undefined ? _node$fields : [];
    const fieldNames = knownFieldNames[typeName];
    for (const fieldDef of fieldNodes) {
      const fieldName = fieldDef.name.value;
      if (hasField(existingTypeMap[typeName], fieldName)) {
        context.reportError(new GraphQLError(`Field "${typeName}.${fieldName}" already exists in the schema. It cannot also be defined in this type extension.`, {
          nodes: fieldDef.name
        }));
      } else if (fieldNames[fieldName]) {
        context.reportError(new GraphQLError(`Field "${typeName}.${fieldName}" can only be defined once.`, {
          nodes: [fieldNames[fieldName], fieldDef.name]
        }));
      } else {
        fieldNames[fieldName] = fieldDef.name;
      }
    }
    return false;
  }
}
function hasField(type, fieldName) {
  if (isObjectType(type) || isInterfaceType(type) || isInputObjectType(type)) {
    return type.getFields()[fieldName] != null;
  }
  return false;
}

// node_modules/graphql/validation/rules/UniqueFragmentNamesRule.mjs
function UniqueFragmentNamesRule(context) {
  const knownFragmentNames = Object.create(null);
  return {
    OperationDefinition: () => false,
    FragmentDefinition(node) {
      const fragmentName = node.name.value;
      if (knownFragmentNames[fragmentName]) {
        context.reportError(new GraphQLError(`There can be only one fragment named "${fragmentName}".`, {
          nodes: [knownFragmentNames[fragmentName], node.name]
        }));
      } else {
        knownFragmentNames[fragmentName] = node.name;
      }
      return false;
    }
  };
}

// node_modules/graphql/validation/rules/UniqueInputFieldNamesRule.mjs
function UniqueInputFieldNamesRule(context) {
  const knownNameStack = [];
  let knownNames = Object.create(null);
  return {
    ObjectValue: {
      enter() {
        knownNameStack.push(knownNames);
        knownNames = Object.create(null);
      },
      leave() {
        const prevKnownNames = knownNameStack.pop();
        prevKnownNames || invariant(false);
        knownNames = prevKnownNames;
      }
    },
    ObjectField(node) {
      const fieldName = node.name.value;
      if (knownNames[fieldName]) {
        context.reportError(new GraphQLError(`There can be only one input field named "${fieldName}".`, {
          nodes: [knownNames[fieldName], node.name]
        }));
      } else {
        knownNames[fieldName] = node.name;
      }
    }
  };
}

// node_modules/graphql/validation/rules/UniqueOperationNamesRule.mjs
function UniqueOperationNamesRule(context) {
  const knownOperationNames = Object.create(null);
  return {
    OperationDefinition(node) {
      const operationName = node.name;
      if (operationName) {
        if (knownOperationNames[operationName.value]) {
          context.reportError(new GraphQLError(`There can be only one operation named "${operationName.value}".`, {
            nodes: [
              knownOperationNames[operationName.value],
              operationName
            ]
          }));
        } else {
          knownOperationNames[operationName.value] = operationName;
        }
      }
      return false;
    },
    FragmentDefinition: () => false
  };
}

// node_modules/graphql/validation/rules/UniqueOperationTypesRule.mjs
function UniqueOperationTypesRule(context) {
  const schema = context.getSchema();
  const definedOperationTypes = Object.create(null);
  const existingOperationTypes = schema ? {
    query: schema.getQueryType(),
    mutation: schema.getMutationType(),
    subscription: schema.getSubscriptionType()
  } : {};
  return {
    SchemaDefinition: checkOperationTypes,
    SchemaExtension: checkOperationTypes
  };
  function checkOperationTypes(node) {
    var _node$operationTypes;
    const operationTypesNodes = (_node$operationTypes = node.operationTypes) !== null && _node$operationTypes !== undefined ? _node$operationTypes : [];
    for (const operationType of operationTypesNodes) {
      const operation = operationType.operation;
      const alreadyDefinedOperationType = definedOperationTypes[operation];
      if (existingOperationTypes[operation]) {
        context.reportError(new GraphQLError(`Type for ${operation} already defined in the schema. It cannot be redefined.`, {
          nodes: operationType
        }));
      } else if (alreadyDefinedOperationType) {
        context.reportError(new GraphQLError(`There can be only one ${operation} type in schema.`, {
          nodes: [alreadyDefinedOperationType, operationType]
        }));
      } else {
        definedOperationTypes[operation] = operationType;
      }
    }
    return false;
  }
}

// node_modules/graphql/validation/rules/UniqueTypeNamesRule.mjs
function UniqueTypeNamesRule(context) {
  const knownTypeNames = Object.create(null);
  const schema = context.getSchema();
  return {
    ScalarTypeDefinition: checkTypeName,
    ObjectTypeDefinition: checkTypeName,
    InterfaceTypeDefinition: checkTypeName,
    UnionTypeDefinition: checkTypeName,
    EnumTypeDefinition: checkTypeName,
    InputObjectTypeDefinition: checkTypeName
  };
  function checkTypeName(node) {
    const typeName = node.name.value;
    if (schema !== null && schema !== undefined && schema.getType(typeName)) {
      context.reportError(new GraphQLError(`Type "${typeName}" already exists in the schema. It cannot also be defined in this type definition.`, {
        nodes: node.name
      }));
      return;
    }
    if (knownTypeNames[typeName]) {
      context.reportError(new GraphQLError(`There can be only one type named "${typeName}".`, {
        nodes: [knownTypeNames[typeName], node.name]
      }));
    } else {
      knownTypeNames[typeName] = node.name;
    }
    return false;
  }
}

// node_modules/graphql/validation/rules/UniqueVariableNamesRule.mjs
function UniqueVariableNamesRule(context) {
  return {
    OperationDefinition(operationNode) {
      var _operationNode$variab;
      const variableDefinitions = (_operationNode$variab = operationNode.variableDefinitions) !== null && _operationNode$variab !== undefined ? _operationNode$variab : [];
      const seenVariableDefinitions = groupBy(variableDefinitions, (node) => node.variable.name.value);
      for (const [variableName, variableNodes] of seenVariableDefinitions) {
        if (variableNodes.length > 1) {
          context.reportError(new GraphQLError(`There can be only one variable named "$${variableName}".`, {
            nodes: variableNodes.map((node) => node.variable.name)
          }));
        }
      }
    }
  };
}

// node_modules/graphql/validation/rules/ValuesOfCorrectTypeRule.mjs
function ValuesOfCorrectTypeRule(context) {
  let variableDefinitions = {};
  return {
    OperationDefinition: {
      enter() {
        variableDefinitions = {};
      }
    },
    VariableDefinition(definition) {
      variableDefinitions[definition.variable.name.value] = definition;
    },
    ListValue(node) {
      const type = getNullableType(context.getParentInputType());
      if (!isListType(type)) {
        isValidValueNode(context, node);
        return false;
      }
    },
    ObjectValue(node) {
      const type = getNamedType(context.getInputType());
      if (!isInputObjectType(type)) {
        isValidValueNode(context, node);
        return false;
      }
      const fieldNodeMap = keyMap(node.fields, (field) => field.name.value);
      for (const fieldDef of Object.values(type.getFields())) {
        const fieldNode = fieldNodeMap[fieldDef.name];
        if (!fieldNode && isRequiredInputField(fieldDef)) {
          const typeStr = inspect(fieldDef.type);
          context.reportError(new GraphQLError(`Field "${type.name}.${fieldDef.name}" of required type "${typeStr}" was not provided.`, {
            nodes: node
          }));
        }
      }
      if (type.isOneOf) {
        validateOneOfInputObject(context, node, type, fieldNodeMap);
      }
    },
    ObjectField(node) {
      const parentType = getNamedType(context.getParentInputType());
      const fieldType = context.getInputType();
      if (!fieldType && isInputObjectType(parentType)) {
        const suggestions = suggestionList(node.name.value, Object.keys(parentType.getFields()));
        context.reportError(new GraphQLError(`Field "${node.name.value}" is not defined by type "${parentType.name}".` + didYouMean(suggestions), {
          nodes: node
        }));
      }
    },
    NullValue(node) {
      const type = context.getInputType();
      if (isNonNullType(type)) {
        context.reportError(new GraphQLError(`Expected value of type "${inspect(type)}", found ${print(node)}.`, {
          nodes: node
        }));
      }
    },
    EnumValue: (node) => isValidValueNode(context, node),
    IntValue: (node) => isValidValueNode(context, node),
    FloatValue: (node) => isValidValueNode(context, node),
    StringValue: (node) => isValidValueNode(context, node),
    BooleanValue: (node) => isValidValueNode(context, node)
  };
}
function isValidValueNode(context, node) {
  const locationType = context.getInputType();
  if (!locationType) {
    return;
  }
  const type = getNamedType(locationType);
  if (!isLeafType(type)) {
    const typeStr = inspect(locationType);
    context.reportError(new GraphQLError(`Expected value of type "${typeStr}", found ${print(node)}.`, {
      nodes: node
    }));
    return;
  }
  try {
    const parseResult = type.parseLiteral(node, undefined);
    if (parseResult === undefined) {
      const typeStr = inspect(locationType);
      context.reportError(new GraphQLError(`Expected value of type "${typeStr}", found ${print(node)}.`, {
        nodes: node
      }));
    }
  } catch (error) {
    const typeStr = inspect(locationType);
    if (error instanceof GraphQLError) {
      context.reportError(error);
    } else {
      context.reportError(new GraphQLError(`Expected value of type "${typeStr}", found ${print(node)}; ` + error.message, {
        nodes: node,
        originalError: error
      }));
    }
  }
}
function validateOneOfInputObject(context, node, type, fieldNodeMap) {
  var _fieldNodeMap$keys$;
  const keys = Object.keys(fieldNodeMap);
  const isNotExactlyOneField = keys.length !== 1;
  if (isNotExactlyOneField) {
    context.reportError(new GraphQLError(`OneOf Input Object "${type.name}" must specify exactly one key.`, {
      nodes: [node]
    }));
    return;
  }
  const value = (_fieldNodeMap$keys$ = fieldNodeMap[keys[0]]) === null || _fieldNodeMap$keys$ === undefined ? undefined : _fieldNodeMap$keys$.value;
  const isNullLiteral = !value || value.kind === Kind.NULL;
  if (isNullLiteral) {
    context.reportError(new GraphQLError(`Field "${type.name}.${keys[0]}" must be non-null.`, {
      nodes: [node]
    }));
  }
}

// node_modules/graphql/validation/rules/VariablesAreInputTypesRule.mjs
function VariablesAreInputTypesRule(context) {
  return {
    VariableDefinition(node) {
      const type = typeFromAST(context.getSchema(), node.type);
      if (type !== undefined && !isInputType(type)) {
        const variableName = node.variable.name.value;
        const typeName = print(node.type);
        context.reportError(new GraphQLError(`Variable "$${variableName}" cannot be non-input type "${typeName}".`, {
          nodes: node.type
        }));
      }
    }
  };
}

// node_modules/graphql/validation/rules/VariablesInAllowedPositionRule.mjs
function VariablesInAllowedPositionRule(context) {
  let varDefMap = Object.create(null);
  return {
    OperationDefinition: {
      enter() {
        varDefMap = Object.create(null);
      },
      leave(operation) {
        const usages = context.getRecursiveVariableUsages(operation);
        for (const { node, type, defaultValue, parentType } of usages) {
          const varName = node.name.value;
          const varDef = varDefMap[varName];
          if (varDef && type) {
            const schema = context.getSchema();
            const varType = typeFromAST(schema, varDef.type);
            if (varType && !allowedVariableUsage(schema, varType, varDef.defaultValue, type, defaultValue)) {
              const varTypeStr = inspect(varType);
              const typeStr = inspect(type);
              context.reportError(new GraphQLError(`Variable "$${varName}" of type "${varTypeStr}" used in position expecting type "${typeStr}".`, {
                nodes: [varDef, node]
              }));
            }
            if (isInputObjectType(parentType) && parentType.isOneOf && isNullableType(varType)) {
              context.reportError(new GraphQLError(`Variable "$${varName}" is of type "${varType}" but must be non-nullable to be used for OneOf Input Object "${parentType}".`, {
                nodes: [varDef, node]
              }));
            }
          }
        }
      }
    },
    VariableDefinition(node) {
      varDefMap[node.variable.name.value] = node;
    }
  };
}
function allowedVariableUsage(schema, varType, varDefaultValue, locationType, locationDefaultValue) {
  if (isNonNullType(locationType) && !isNonNullType(varType)) {
    const hasNonNullVariableDefaultValue = varDefaultValue != null && varDefaultValue.kind !== Kind.NULL;
    const hasLocationDefaultValue = locationDefaultValue !== undefined;
    if (!hasNonNullVariableDefaultValue && !hasLocationDefaultValue) {
      return false;
    }
    const nullableLocationType = locationType.ofType;
    return isTypeSubTypeOf(schema, varType, nullableLocationType);
  }
  return isTypeSubTypeOf(schema, varType, locationType);
}

// node_modules/graphql/validation/specifiedRules.mjs
var recommendedRules = Object.freeze([MaxIntrospectionDepthRule]);
var specifiedRules = Object.freeze([
  ExecutableDefinitionsRule,
  UniqueOperationNamesRule,
  LoneAnonymousOperationRule,
  SingleFieldSubscriptionsRule,
  KnownTypeNamesRule,
  FragmentsOnCompositeTypesRule,
  VariablesAreInputTypesRule,
  ScalarLeafsRule,
  FieldsOnCorrectTypeRule,
  UniqueFragmentNamesRule,
  KnownFragmentNamesRule,
  NoUnusedFragmentsRule,
  PossibleFragmentSpreadsRule,
  NoFragmentCyclesRule,
  UniqueVariableNamesRule,
  NoUndefinedVariablesRule,
  NoUnusedVariablesRule,
  KnownDirectivesRule,
  UniqueDirectivesPerLocationRule,
  KnownArgumentNamesRule,
  UniqueArgumentNamesRule,
  ValuesOfCorrectTypeRule,
  ProvidedRequiredArgumentsRule,
  VariablesInAllowedPositionRule,
  OverlappingFieldsCanBeMergedRule,
  UniqueInputFieldNamesRule,
  ...recommendedRules
]);
var specifiedSDLRules = Object.freeze([
  LoneSchemaDefinitionRule,
  UniqueOperationTypesRule,
  UniqueTypeNamesRule,
  UniqueEnumValueNamesRule,
  UniqueFieldDefinitionNamesRule,
  UniqueArgumentDefinitionNamesRule,
  UniqueDirectiveNamesRule,
  KnownTypeNamesRule,
  KnownDirectivesRule,
  UniqueDirectivesPerLocationRule,
  PossibleTypeExtensionsRule,
  KnownArgumentNamesOnDirectivesRule,
  UniqueArgumentNamesRule,
  UniqueInputFieldNamesRule,
  ProvidedRequiredArgumentsOnDirectivesRule
]);

// node_modules/graphql/validation/ValidationContext.mjs
class ASTValidationContext {
  constructor(ast, onError) {
    this._ast = ast;
    this._fragments = undefined;
    this._fragmentSpreads = new Map;
    this._recursivelyReferencedFragments = new Map;
    this._onError = onError;
  }
  get [Symbol.toStringTag]() {
    return "ASTValidationContext";
  }
  reportError(error) {
    this._onError(error);
  }
  getDocument() {
    return this._ast;
  }
  getFragment(name) {
    let fragments;
    if (this._fragments) {
      fragments = this._fragments;
    } else {
      fragments = Object.create(null);
      for (const defNode of this.getDocument().definitions) {
        if (defNode.kind === Kind.FRAGMENT_DEFINITION) {
          fragments[defNode.name.value] = defNode;
        }
      }
      this._fragments = fragments;
    }
    return fragments[name];
  }
  getFragmentSpreads(node) {
    let spreads = this._fragmentSpreads.get(node);
    if (!spreads) {
      spreads = [];
      const setsToVisit = [node];
      let set;
      while (set = setsToVisit.pop()) {
        for (const selection of set.selections) {
          if (selection.kind === Kind.FRAGMENT_SPREAD) {
            spreads.push(selection);
          } else if (selection.selectionSet) {
            setsToVisit.push(selection.selectionSet);
          }
        }
      }
      this._fragmentSpreads.set(node, spreads);
    }
    return spreads;
  }
  getRecursivelyReferencedFragments(operation) {
    let fragments = this._recursivelyReferencedFragments.get(operation);
    if (!fragments) {
      fragments = [];
      const collectedNames = Object.create(null);
      const nodesToVisit = [operation.selectionSet];
      let node;
      while (node = nodesToVisit.pop()) {
        for (const spread of this.getFragmentSpreads(node)) {
          const fragName = spread.name.value;
          if (collectedNames[fragName] !== true) {
            collectedNames[fragName] = true;
            const fragment = this.getFragment(fragName);
            if (fragment) {
              fragments.push(fragment);
              nodesToVisit.push(fragment.selectionSet);
            }
          }
        }
      }
      this._recursivelyReferencedFragments.set(operation, fragments);
    }
    return fragments;
  }
}
class ValidationContext extends ASTValidationContext {
  constructor(schema, ast, typeInfo, onError) {
    super(ast, onError);
    this._schema = schema;
    this._typeInfo = typeInfo;
    this._variableUsages = new Map;
    this._recursiveVariableUsages = new Map;
  }
  get [Symbol.toStringTag]() {
    return "ValidationContext";
  }
  getSchema() {
    return this._schema;
  }
  getVariableUsages(node) {
    let usages = this._variableUsages.get(node);
    if (!usages) {
      const newUsages = [];
      const typeInfo = new TypeInfo(this._schema);
      visit(node, visitWithTypeInfo(typeInfo, {
        VariableDefinition: () => false,
        Variable(variable) {
          newUsages.push({
            node: variable,
            type: typeInfo.getInputType(),
            defaultValue: typeInfo.getDefaultValue(),
            parentType: typeInfo.getParentInputType()
          });
        }
      }));
      usages = newUsages;
      this._variableUsages.set(node, usages);
    }
    return usages;
  }
  getRecursiveVariableUsages(operation) {
    let usages = this._recursiveVariableUsages.get(operation);
    if (!usages) {
      usages = this.getVariableUsages(operation);
      for (const frag of this.getRecursivelyReferencedFragments(operation)) {
        usages = usages.concat(this.getVariableUsages(frag));
      }
      this._recursiveVariableUsages.set(operation, usages);
    }
    return usages;
  }
  getType() {
    return this._typeInfo.getType();
  }
  getParentType() {
    return this._typeInfo.getParentType();
  }
  getInputType() {
    return this._typeInfo.getInputType();
  }
  getParentInputType() {
    return this._typeInfo.getParentInputType();
  }
  getFieldDef() {
    return this._typeInfo.getFieldDef();
  }
  getDirective() {
    return this._typeInfo.getDirective();
  }
  getArgument() {
    return this._typeInfo.getArgument();
  }
  getEnumValue() {
    return this._typeInfo.getEnumValue();
  }
}

// node_modules/graphql/validation/validate.mjs
var QueryDocumentKeysToValidate = mapValue(QueryDocumentKeys, (keys) => keys.filter((key) => key !== "description"));
function validate(schema, documentAST, rules = specifiedRules, options, typeInfo = new TypeInfo(schema)) {
  var _options$maxErrors;
  const maxErrors = (_options$maxErrors = options === null || options === undefined ? undefined : options.maxErrors) !== null && _options$maxErrors !== undefined ? _options$maxErrors : 100;
  documentAST || devAssert(false, "Must provide document.");
  assertValidSchema(schema);
  const abortObj = Object.freeze({});
  const errors = [];
  const context = new ValidationContext(schema, documentAST, typeInfo, (error) => {
    if (errors.length >= maxErrors) {
      errors.push(new GraphQLError("Too many validation errors, error limit reached. Validation aborted."));
      throw abortObj;
    }
    errors.push(error);
  });
  const visitor = visitInParallel(rules.map((rule) => rule(context)));
  try {
    visit(documentAST, visitWithTypeInfo(typeInfo, visitor), QueryDocumentKeysToValidate);
  } catch (e) {
    if (e !== abortObj) {
      throw e;
    }
  }
  return errors;
}

// node_modules/graphql/jsutils/memoize3.mjs
function memoize3(fn) {
  let cache0;
  return function memoized(a1, a2, a3) {
    if (cache0 === undefined) {
      cache0 = new WeakMap;
    }
    let cache1 = cache0.get(a1);
    if (cache1 === undefined) {
      cache1 = new WeakMap;
      cache0.set(a1, cache1);
    }
    let cache2 = cache1.get(a2);
    if (cache2 === undefined) {
      cache2 = new WeakMap;
      cache1.set(a2, cache2);
    }
    let fnResult = cache2.get(a3);
    if (fnResult === undefined) {
      fnResult = fn(a1, a2, a3);
      cache2.set(a3, fnResult);
    }
    return fnResult;
  };
}

// node_modules/graphql/jsutils/promiseForObject.mjs
function promiseForObject(object) {
  return Promise.all(Object.values(object)).then((resolvedValues) => {
    const resolvedObject = Object.create(null);
    for (const [i, key] of Object.keys(object).entries()) {
      resolvedObject[key] = resolvedValues[i];
    }
    return resolvedObject;
  });
}

// node_modules/graphql/jsutils/promiseReduce.mjs
function promiseReduce(values, callbackFn, initialValue) {
  let accumulator = initialValue;
  for (const value of values) {
    accumulator = isPromise(accumulator) ? accumulator.then((resolved) => callbackFn(resolved, value)) : callbackFn(accumulator, value);
  }
  return accumulator;
}

// node_modules/graphql/jsutils/toError.mjs
function toError(thrownValue) {
  return thrownValue instanceof Error ? thrownValue : new NonErrorThrown(thrownValue);
}

class NonErrorThrown extends Error {
  constructor(thrownValue) {
    super("Unexpected error value: " + inspect(thrownValue));
    this.name = "NonErrorThrown";
    this.thrownValue = thrownValue;
  }
}

// node_modules/graphql/error/locatedError.mjs
function locatedError(rawOriginalError, nodes, path) {
  var _nodes;
  const originalError = toError(rawOriginalError);
  if (isLocatedGraphQLError(originalError)) {
    return originalError;
  }
  return new GraphQLError(originalError.message, {
    nodes: (_nodes = originalError.nodes) !== null && _nodes !== undefined ? _nodes : nodes,
    source: originalError.source,
    positions: originalError.positions,
    path,
    originalError
  });
}
function isLocatedGraphQLError(error) {
  return Array.isArray(error.path);
}

// node_modules/graphql/execution/execute.mjs
var collectSubfields2 = memoize3((exeContext, returnType, fieldNodes) => collectSubfields(exeContext.schema, exeContext.fragments, exeContext.variableValues, returnType, fieldNodes));

class CollectedErrors {
  constructor() {
    this._errorPositions = new Set;
    this._errors = [];
  }
  get errors() {
    return this._errors;
  }
  add(error, path) {
    if (this._hasNulledPosition(path)) {
      return;
    }
    this._errorPositions.add(path);
    this._errors.push(error);
  }
  _hasNulledPosition(startPath) {
    let path = startPath;
    while (path !== undefined) {
      if (this._errorPositions.has(path)) {
        return true;
      }
      path = path.prev;
    }
    return this._errorPositions.has(undefined);
  }
}
function execute(args) {
  arguments.length < 2 || devAssert(false, "graphql@16 dropped long-deprecated support for positional arguments, please pass an object instead.");
  const { schema, document, variableValues, rootValue } = args;
  assertValidExecutionArguments(schema, document, variableValues);
  const exeContext = buildExecutionContext(args);
  if (!("schema" in exeContext)) {
    return {
      errors: exeContext
    };
  }
  try {
    const { operation } = exeContext;
    const result = executeOperation(exeContext, operation, rootValue);
    if (isPromise(result)) {
      return result.then((data) => buildResponse(data, exeContext.collectedErrors.errors), (error) => {
        exeContext.collectedErrors.add(error, undefined);
        return buildResponse(null, exeContext.collectedErrors.errors);
      });
    }
    return buildResponse(result, exeContext.collectedErrors.errors);
  } catch (error) {
    exeContext.collectedErrors.add(error, undefined);
    return buildResponse(null, exeContext.collectedErrors.errors);
  }
}
function buildResponse(data, errors) {
  return errors.length === 0 ? {
    data
  } : {
    errors,
    data
  };
}
function assertValidExecutionArguments(schema, document, rawVariableValues) {
  document || devAssert(false, "Must provide document.");
  assertValidSchema(schema);
  rawVariableValues == null || isObjectLike(rawVariableValues) || devAssert(false, "Variables must be provided as an Object where each property is a variable value. Perhaps look to see if an unparsed JSON string was provided.");
}
function buildExecutionContext(args) {
  var _definition$name, _operation$variableDe, _options$maxCoercionE;
  const {
    schema,
    document,
    rootValue,
    contextValue,
    variableValues: rawVariableValues,
    operationName,
    fieldResolver,
    typeResolver,
    subscribeFieldResolver,
    options
  } = args;
  let operation;
  const fragments = Object.create(null);
  for (const definition of document.definitions) {
    switch (definition.kind) {
      case Kind.OPERATION_DEFINITION:
        if (operationName == null) {
          if (operation !== undefined) {
            return [
              new GraphQLError("Must provide operation name if query contains multiple operations.")
            ];
          }
          operation = definition;
        } else if (((_definition$name = definition.name) === null || _definition$name === undefined ? undefined : _definition$name.value) === operationName) {
          operation = definition;
        }
        break;
      case Kind.FRAGMENT_DEFINITION:
        fragments[definition.name.value] = definition;
        break;
      default:
    }
  }
  if (!operation) {
    if (operationName != null) {
      return [new GraphQLError(`Unknown operation named "${operationName}".`)];
    }
    return [new GraphQLError("Must provide an operation.")];
  }
  const variableDefinitions = (_operation$variableDe = operation.variableDefinitions) !== null && _operation$variableDe !== undefined ? _operation$variableDe : [];
  const coercedVariableValues = getVariableValues(schema, variableDefinitions, rawVariableValues !== null && rawVariableValues !== undefined ? rawVariableValues : {}, {
    maxErrors: (_options$maxCoercionE = options === null || options === undefined ? undefined : options.maxCoercionErrors) !== null && _options$maxCoercionE !== undefined ? _options$maxCoercionE : 50
  });
  if (coercedVariableValues.errors) {
    return coercedVariableValues.errors;
  }
  return {
    schema,
    fragments,
    rootValue,
    contextValue,
    operation,
    variableValues: coercedVariableValues.coerced,
    fieldResolver: fieldResolver !== null && fieldResolver !== undefined ? fieldResolver : defaultFieldResolver,
    typeResolver: typeResolver !== null && typeResolver !== undefined ? typeResolver : defaultTypeResolver,
    subscribeFieldResolver: subscribeFieldResolver !== null && subscribeFieldResolver !== undefined ? subscribeFieldResolver : defaultFieldResolver,
    collectedErrors: new CollectedErrors
  };
}
function executeOperation(exeContext, operation, rootValue) {
  const rootType = exeContext.schema.getRootType(operation.operation);
  if (rootType == null) {
    throw new GraphQLError(`Schema is not configured to execute ${operation.operation} operation.`, {
      nodes: operation
    });
  }
  const rootFields = collectFields(exeContext.schema, exeContext.fragments, exeContext.variableValues, rootType, operation.selectionSet);
  const path = undefined;
  switch (operation.operation) {
    case OperationTypeNode.QUERY:
      return executeFields(exeContext, rootType, rootValue, path, rootFields);
    case OperationTypeNode.MUTATION:
      return executeFieldsSerially(exeContext, rootType, rootValue, path, rootFields);
    case OperationTypeNode.SUBSCRIPTION:
      return executeFields(exeContext, rootType, rootValue, path, rootFields);
  }
}
function executeFieldsSerially(exeContext, parentType, sourceValue, path, fields) {
  return promiseReduce(fields.entries(), (results, [responseName, fieldNodes]) => {
    const fieldPath = addPath(path, responseName, parentType.name);
    const result = executeField(exeContext, parentType, sourceValue, fieldNodes, fieldPath);
    if (result === undefined) {
      return results;
    }
    if (isPromise(result)) {
      return result.then((resolvedResult) => {
        results[responseName] = resolvedResult;
        return results;
      });
    }
    results[responseName] = result;
    return results;
  }, Object.create(null));
}
function executeFields(exeContext, parentType, sourceValue, path, fields) {
  const results = Object.create(null);
  let containsPromise = false;
  try {
    for (const [responseName, fieldNodes] of fields.entries()) {
      const fieldPath = addPath(path, responseName, parentType.name);
      const result = executeField(exeContext, parentType, sourceValue, fieldNodes, fieldPath);
      if (result !== undefined) {
        results[responseName] = result;
        if (isPromise(result)) {
          containsPromise = true;
        }
      }
    }
  } catch (error) {
    if (containsPromise) {
      return promiseForObject(results).finally(() => {
        throw error;
      });
    }
    throw error;
  }
  if (!containsPromise) {
    return results;
  }
  return promiseForObject(results);
}
function executeField(exeContext, parentType, source, fieldNodes, path) {
  var _fieldDef$resolve;
  const fieldDef = getFieldDef2(exeContext.schema, parentType, fieldNodes[0]);
  if (!fieldDef) {
    return;
  }
  const returnType = fieldDef.type;
  const resolveFn = (_fieldDef$resolve = fieldDef.resolve) !== null && _fieldDef$resolve !== undefined ? _fieldDef$resolve : exeContext.fieldResolver;
  const info = buildResolveInfo(exeContext, fieldDef, fieldNodes, parentType, path);
  try {
    const args = getArgumentValues(fieldDef, fieldNodes[0], exeContext.variableValues);
    const contextValue = exeContext.contextValue;
    const result = resolveFn(source, args, contextValue, info);
    let completed;
    if (isPromise(result)) {
      completed = result.then((resolved) => completeValue(exeContext, returnType, fieldNodes, info, path, resolved));
    } else {
      completed = completeValue(exeContext, returnType, fieldNodes, info, path, result);
    }
    if (isPromise(completed)) {
      return completed.then(undefined, (rawError) => {
        const error = locatedError(rawError, fieldNodes, pathToArray(path));
        return handleFieldError(error, returnType, path, exeContext);
      });
    }
    return completed;
  } catch (rawError) {
    const error = locatedError(rawError, fieldNodes, pathToArray(path));
    return handleFieldError(error, returnType, path, exeContext);
  }
}
function buildResolveInfo(exeContext, fieldDef, fieldNodes, parentType, path) {
  return {
    fieldName: fieldDef.name,
    fieldNodes,
    returnType: fieldDef.type,
    parentType,
    path,
    schema: exeContext.schema,
    fragments: exeContext.fragments,
    rootValue: exeContext.rootValue,
    operation: exeContext.operation,
    variableValues: exeContext.variableValues
  };
}
function handleFieldError(error, returnType, path, exeContext) {
  if (isNonNullType(returnType)) {
    throw error;
  }
  exeContext.collectedErrors.add(error, path);
  return null;
}
function completeValue(exeContext, returnType, fieldNodes, info, path, result) {
  if (result instanceof Error) {
    throw result;
  }
  if (isNonNullType(returnType)) {
    const completed = completeValue(exeContext, returnType.ofType, fieldNodes, info, path, result);
    if (completed === null) {
      throw new Error(`Cannot return null for non-nullable field ${info.parentType.name}.${info.fieldName}.`);
    }
    return completed;
  }
  if (result == null) {
    return null;
  }
  if (isListType(returnType)) {
    return completeListValue(exeContext, returnType, fieldNodes, info, path, result);
  }
  if (isLeafType(returnType)) {
    return completeLeafValue(returnType, result);
  }
  if (isAbstractType(returnType)) {
    return completeAbstractValue(exeContext, returnType, fieldNodes, info, path, result);
  }
  if (isObjectType(returnType)) {
    return completeObjectValue(exeContext, returnType, fieldNodes, info, path, result);
  }
  invariant(false, "Cannot complete value of unexpected output type: " + inspect(returnType));
}
function completeListValue(exeContext, returnType, fieldNodes, info, path, result) {
  if (!isIterableObject(result)) {
    throw new GraphQLError(`Expected Iterable, but did not find one for field "${info.parentType.name}.${info.fieldName}".`);
  }
  const itemType = returnType.ofType;
  let containsPromise = false;
  const completedResults = Array.from(result, (item, index) => {
    const itemPath = addPath(path, index, undefined);
    try {
      let completedItem;
      if (isPromise(item)) {
        completedItem = item.then((resolved) => completeValue(exeContext, itemType, fieldNodes, info, itemPath, resolved));
      } else {
        completedItem = completeValue(exeContext, itemType, fieldNodes, info, itemPath, item);
      }
      if (isPromise(completedItem)) {
        containsPromise = true;
        return completedItem.then(undefined, (rawError) => {
          const error = locatedError(rawError, fieldNodes, pathToArray(itemPath));
          return handleFieldError(error, itemType, itemPath, exeContext);
        });
      }
      return completedItem;
    } catch (rawError) {
      const error = locatedError(rawError, fieldNodes, pathToArray(itemPath));
      return handleFieldError(error, itemType, itemPath, exeContext);
    }
  });
  return containsPromise ? Promise.all(completedResults) : completedResults;
}
function completeLeafValue(returnType, result) {
  const serializedResult = returnType.serialize(result);
  if (serializedResult == null) {
    throw new Error(`Expected \`${inspect(returnType)}.serialize(${inspect(result)})\` to ` + `return non-nullable value, returned: ${inspect(serializedResult)}`);
  }
  return serializedResult;
}
function completeAbstractValue(exeContext, returnType, fieldNodes, info, path, result) {
  var _returnType$resolveTy;
  const resolveTypeFn = (_returnType$resolveTy = returnType.resolveType) !== null && _returnType$resolveTy !== undefined ? _returnType$resolveTy : exeContext.typeResolver;
  const contextValue = exeContext.contextValue;
  const runtimeType = resolveTypeFn(result, contextValue, info, returnType);
  if (isPromise(runtimeType)) {
    return runtimeType.then((resolvedRuntimeType) => completeObjectValue(exeContext, ensureValidRuntimeType(resolvedRuntimeType, exeContext, returnType, fieldNodes, info, result), fieldNodes, info, path, result));
  }
  return completeObjectValue(exeContext, ensureValidRuntimeType(runtimeType, exeContext, returnType, fieldNodes, info, result), fieldNodes, info, path, result);
}
function ensureValidRuntimeType(runtimeTypeName, exeContext, returnType, fieldNodes, info, result) {
  if (runtimeTypeName == null) {
    throw new GraphQLError(`Abstract type "${returnType.name}" must resolve to an Object type at runtime for field "${info.parentType.name}.${info.fieldName}". Either the "${returnType.name}" type should provide a "resolveType" function or each possible type should provide an "isTypeOf" function.`, fieldNodes);
  }
  if (isObjectType(runtimeTypeName)) {
    throw new GraphQLError("Support for returning GraphQLObjectType from resolveType was removed in graphql-js@16.0.0 please return type name instead.");
  }
  if (typeof runtimeTypeName !== "string") {
    throw new GraphQLError(`Abstract type "${returnType.name}" must resolve to an Object type at runtime for field "${info.parentType.name}.${info.fieldName}" with ` + `value ${inspect(result)}, received "${inspect(runtimeTypeName)}".`);
  }
  const runtimeType = exeContext.schema.getType(runtimeTypeName);
  if (runtimeType == null) {
    throw new GraphQLError(`Abstract type "${returnType.name}" was resolved to a type "${runtimeTypeName}" that does not exist inside the schema.`, {
      nodes: fieldNodes
    });
  }
  if (!isObjectType(runtimeType)) {
    throw new GraphQLError(`Abstract type "${returnType.name}" was resolved to a non-object type "${runtimeTypeName}".`, {
      nodes: fieldNodes
    });
  }
  if (!exeContext.schema.isSubType(returnType, runtimeType)) {
    throw new GraphQLError(`Runtime Object type "${runtimeType.name}" is not a possible type for "${returnType.name}".`, {
      nodes: fieldNodes
    });
  }
  return runtimeType;
}
function completeObjectValue(exeContext, returnType, fieldNodes, info, path, result) {
  const subFieldNodes = collectSubfields2(exeContext, returnType, fieldNodes);
  if (returnType.isTypeOf) {
    const isTypeOf = returnType.isTypeOf(result, exeContext.contextValue, info);
    if (isPromise(isTypeOf)) {
      return isTypeOf.then((resolvedIsTypeOf) => {
        if (!resolvedIsTypeOf) {
          throw invalidReturnTypeError(returnType, result, fieldNodes);
        }
        return executeFields(exeContext, returnType, result, path, subFieldNodes);
      });
    }
    if (!isTypeOf) {
      throw invalidReturnTypeError(returnType, result, fieldNodes);
    }
  }
  return executeFields(exeContext, returnType, result, path, subFieldNodes);
}
function invalidReturnTypeError(returnType, result, fieldNodes) {
  return new GraphQLError(`Expected value of type "${returnType.name}" but got: ${inspect(result)}.`, {
    nodes: fieldNodes
  });
}
var defaultTypeResolver = function(value, contextValue, info, abstractType) {
  if (isObjectLike(value) && typeof value.__typename === "string") {
    return value.__typename;
  }
  const possibleTypes = info.schema.getPossibleTypes(abstractType);
  const promisedIsTypeOfResults = [];
  for (let i = 0;i < possibleTypes.length; i++) {
    const type = possibleTypes[i];
    if (type.isTypeOf) {
      const isTypeOfResult = type.isTypeOf(value, contextValue, info);
      if (isPromise(isTypeOfResult)) {
        promisedIsTypeOfResults[i] = isTypeOfResult;
      } else if (isTypeOfResult) {
        if (promisedIsTypeOfResults.length) {
          Promise.allSettled(promisedIsTypeOfResults).catch(() => {});
        }
        return type.name;
      }
    }
  }
  if (promisedIsTypeOfResults.length) {
    return Promise.all(promisedIsTypeOfResults).then((isTypeOfResults) => {
      for (let i = 0;i < isTypeOfResults.length; i++) {
        if (isTypeOfResults[i]) {
          return possibleTypes[i].name;
        }
      }
    });
  }
};
var defaultFieldResolver = function(source, args, contextValue, info) {
  if (isObjectLike(source) || typeof source === "function") {
    const property = source[info.fieldName];
    if (typeof property === "function") {
      return source[info.fieldName](args, contextValue, info);
    }
    return property;
  }
};
function getFieldDef2(schema, parentType, fieldNode) {
  const fieldName = fieldNode.name.value;
  if (fieldName === SchemaMetaFieldDef.name && schema.getQueryType() === parentType) {
    return SchemaMetaFieldDef;
  } else if (fieldName === TypeMetaFieldDef.name && schema.getQueryType() === parentType) {
    return TypeMetaFieldDef;
  } else if (fieldName === TypeNameMetaFieldDef.name) {
    return TypeNameMetaFieldDef;
  }
  return parentType.getFields()[fieldName];
}
// node_modules/graphql/jsutils/isAsyncIterable.mjs
function isAsyncIterable(maybeAsyncIterable) {
  return typeof (maybeAsyncIterable === null || maybeAsyncIterable === undefined ? undefined : maybeAsyncIterable[Symbol.asyncIterator]) === "function";
}

// node_modules/graphql/execution/mapAsyncIterator.mjs
function mapAsyncIterator(iterable, callback) {
  const iterator = iterable[Symbol.asyncIterator]();
  async function mapResult(result) {
    if (result.done) {
      return result;
    }
    try {
      return {
        value: await callback(result.value),
        done: false
      };
    } catch (error) {
      if (typeof iterator.return === "function") {
        try {
          await iterator.return();
        } catch (_e) {}
      }
      throw error;
    }
  }
  return {
    async next() {
      return mapResult(await iterator.next());
    },
    async return() {
      return typeof iterator.return === "function" ? mapResult(await iterator.return()) : {
        value: undefined,
        done: true
      };
    },
    async throw(error) {
      if (typeof iterator.throw === "function") {
        return mapResult(await iterator.throw(error));
      }
      throw error;
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  };
}

// node_modules/graphql/execution/subscribe.mjs
async function subscribe(args) {
  arguments.length < 2 || devAssert(false, "graphql@16 dropped long-deprecated support for positional arguments, please pass an object instead.");
  const resultOrStream = await createSourceEventStream(args);
  if (!isAsyncIterable(resultOrStream)) {
    return resultOrStream;
  }
  const mapSourceToResponse = (payload) => execute({ ...args, rootValue: payload });
  return mapAsyncIterator(resultOrStream, mapSourceToResponse);
}
function toNormalizedArgs(args) {
  const firstArg = args[0];
  if (firstArg && "document" in firstArg) {
    return firstArg;
  }
  return {
    schema: firstArg,
    document: args[1],
    rootValue: args[2],
    contextValue: args[3],
    variableValues: args[4],
    operationName: args[5],
    subscribeFieldResolver: args[6]
  };
}
async function createSourceEventStream(...rawArgs) {
  const args = toNormalizedArgs(rawArgs);
  const { schema, document, variableValues } = args;
  assertValidExecutionArguments(schema, document, variableValues);
  const exeContext = buildExecutionContext(args);
  if (!("schema" in exeContext)) {
    return {
      errors: exeContext
    };
  }
  try {
    const eventStream = await executeSubscription(exeContext);
    if (!isAsyncIterable(eventStream)) {
      throw new Error("Subscription field must return Async Iterable. " + `Received: ${inspect(eventStream)}.`);
    }
    return eventStream;
  } catch (error) {
    if (error instanceof GraphQLError) {
      return {
        errors: [error]
      };
    }
    throw error;
  }
}
async function executeSubscription(exeContext) {
  const { schema, fragments, operation, variableValues, rootValue } = exeContext;
  const rootType = schema.getSubscriptionType();
  if (rootType == null) {
    throw new GraphQLError("Schema is not configured to execute subscription operation.", {
      nodes: operation
    });
  }
  const rootFields = collectFields(schema, fragments, variableValues, rootType, operation.selectionSet);
  const [responseName, fieldNodes] = [...rootFields.entries()][0];
  const fieldDef = getFieldDef2(schema, rootType, fieldNodes[0]);
  if (!fieldDef) {
    const fieldName = fieldNodes[0].name.value;
    throw new GraphQLError(`The subscription field "${fieldName}" is not defined.`, {
      nodes: fieldNodes
    });
  }
  const path = addPath(undefined, responseName, rootType.name);
  const info = buildResolveInfo(exeContext, fieldDef, fieldNodes, rootType, path);
  try {
    var _fieldDef$subscribe;
    const args = getArgumentValues(fieldDef, fieldNodes[0], variableValues);
    const contextValue = exeContext.contextValue;
    const resolveFn = (_fieldDef$subscribe = fieldDef.subscribe) !== null && _fieldDef$subscribe !== undefined ? _fieldDef$subscribe : exeContext.subscribeFieldResolver;
    const eventStream = await resolveFn(rootValue, args, contextValue, info);
    if (eventStream instanceof Error) {
      throw eventStream;
    }
    return eventStream;
  } catch (error) {
    throw locatedError(error, fieldNodes, pathToArray(path));
  }
}
// node_modules/graphql/utilities/getOperationAST.mjs
function getOperationAST(documentAST, operationName) {
  let operation = null;
  for (const definition of documentAST.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      var _definition$name;
      if (operationName == null) {
        if (operation) {
          return null;
        }
        operation = definition;
      } else if (((_definition$name = definition.name) === null || _definition$name === undefined ? undefined : _definition$name.value) === operationName) {
        return definition;
      }
    }
  }
  return operation;
}
// src/process/types.ts
var SANDBOX_MODES = ["full", "network-only", "none"];
var APPROVAL_MODES = [
  "always",
  "unless-allow-listed",
  "never",
  "on-failure"
];
var STREAM_GRANULARITIES = ["event", "char"];

// src/graphql/params.ts
function parseJsonLiteral(ast) {
  switch (ast.kind) {
    case Kind.NULL:
      return null;
    case Kind.STRING:
    case Kind.ENUM:
      return ast.value;
    case Kind.INT:
    case Kind.FLOAT:
      return Number(ast.value);
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.LIST:
      return ast.values.map((value) => parseJsonLiteral(value));
    case Kind.OBJECT:
      return Object.fromEntries(ast.fields.map((field) => [
        field.name.value,
        parseJsonLiteral(field.value)
      ]));
    default:
      return null;
  }
}
function toRecord4(value, label = "params") {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GraphQLError(`${label} must be a JSON object`);
  }
  return value;
}
function readString5(record, key) {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}
function readNumber3(record, key) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function readBoolean(record, key) {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}
function readStringArray2(record, key) {
  const value = record[key];
  if (!Array.isArray(value)) {
    return;
  }
  if (value.some((entry) => typeof entry !== "string")) {
    throw new GraphQLError(`${key} must be a string array`);
  }
  return value;
}
function readStringUnion(record, key, allowedValues) {
  const rawValue = record[key];
  if (rawValue === undefined) {
    return;
  }
  if (typeof rawValue !== "string") {
    throw new GraphQLError(`${key} must be a string`);
  }
  const value = rawValue;
  if (!isAllowedString(value, allowedValues)) {
    throw new GraphQLError(`${key} must be one of: ${allowedValues.join(", ")}`);
  }
  return value;
}
function requireStringUnion(record, key, allowedValues) {
  const value = requireString(record, key);
  if (!isAllowedString(value, allowedValues)) {
    throw new GraphQLError(`${key} must be one of: ${allowedValues.join(", ")}`);
  }
  return value;
}
function isAllowedString(value, allowedValues) {
  return allowedValues.includes(value);
}
function readStringRecord(record, key) {
  const value = record[key];
  if (value === undefined) {
    return;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GraphQLError(`${key} must be a string-keyed JSON object`);
  }
  const entries = Object.entries(value);
  const invalid = entries.find(([, entryValue]) => typeof entryValue !== "string");
  if (invalid !== undefined) {
    throw new GraphQLError(`${key}.${invalid[0]} must be a string`);
  }
  return Object.fromEntries(entries);
}
function requireString(record, key) {
  const value = readString5(record, key);
  if (value === undefined || value.trim().length === 0) {
    throw new GraphQLError(`${key} is required`);
  }
  return value;
}
function requireNumber(record, key) {
  const value = readNumber3(record, key);
  if (value === undefined) {
    throw new GraphQLError(`${key} is required`);
  }
  return value;
}
function readProcessOptions(record) {
  const options = {};
  const model = readString5(record, "model");
  if (model !== undefined)
    options.model = model;
  const cwd = readString5(record, "cwd");
  if (cwd !== undefined)
    options.cwd = cwd;
  const sandbox = readStringUnion(record, "sandbox", SANDBOX_MODES);
  if (sandbox !== undefined)
    options.sandbox = sandbox;
  const approvalMode = readStringUnion(record, "approvalMode", APPROVAL_MODES);
  if (approvalMode !== undefined)
    options.approvalMode = approvalMode;
  const fullAuto = readBoolean(record, "fullAuto");
  if (fullAuto !== undefined)
    options.fullAuto = fullAuto;
  const additionalArgs = readStringArray2(record, "additionalArgs");
  if (additionalArgs !== undefined)
    options.additionalArgs = additionalArgs;
  const images = readStringArray2(record, "images");
  if (images !== undefined)
    options.images = images;
  const configOverrides = readStringArray2(record, "configOverrides");
  if (configOverrides !== undefined)
    options.configOverrides = configOverrides;
  const streamGranularity = readStringUnion(record, "streamGranularity", STREAM_GRANULARITIES);
  if (streamGranularity !== undefined) {
    options.streamGranularity = streamGranularity;
  }
  const environmentVariables = readStringRecord(record, "environmentVariables");
  if (environmentVariables !== undefined) {
    options.environmentVariables = environmentVariables;
  }
  const codexBinary = readString5(record, "codexBinary");
  if (codexBinary !== undefined)
    options.codexBinary = codexBinary;
  return options;
}
function extractSessionId(lines) {
  for (const line of lines) {
    if (typeof line !== "object" || line === null) {
      continue;
    }
    const record = line;
    if (record["type"] !== "session_meta") {
      continue;
    }
    const payload = typeof record["payload"] === "object" && record["payload"] !== null ? record["payload"] : null;
    const meta = payload !== null && typeof payload["meta"] === "object" && payload["meta"] !== null ? payload["meta"] : null;
    const id = meta === null ? undefined : readString5(meta, "id");
    if (id !== undefined) {
      return id;
    }
  }
  return;
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
import { stat as stat3 } from "fs/promises";
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
    const completionPromise = new Promise((resolve3) => {
      resolveCompletion = resolve3;
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
      await new Promise((resolve3) => {
        this.state.waiter = resolve3;
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
    const payload2 = toRecord5(line.payload);
    if (payload2?.["type"] === "AgentMessage" && typeof payload2["message"] === "string") {
      return [payload2["message"]];
    }
    return [];
  }
  if (line.type !== "response_item") {
    return [];
  }
  const payload = toRecord5(line.payload);
  if (payload?.["type"] !== "message" || payload["role"] !== "assistant" || !Array.isArray(payload["content"])) {
    return [];
  }
  const segments = [];
  for (const item of payload["content"]) {
    const content = toRecord5(item);
    if (content === null) {
      continue;
    }
    if ((content["type"] === "output_text" || content["type"] === "input_text") && typeof content["text"] === "string" && content["text"].length > 0) {
      segments.push(content["text"]);
    }
  }
  return segments;
}
function toRecord5(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value;
}
function sleep(ms) {
  return new Promise((resolve3) => {
    setTimeout(resolve3, ms);
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
// src/sdk/mock-session-runner.ts
import { EventEmitter as EventEmitter3 } from "events";

class MockCodexRunningSession extends EventEmitter3 {
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
    this.#completion = new Promise((resolve3) => {
      this.#completionResolver = resolve3;
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
      await new Promise((resolve3) => {
        this.#waiter = resolve3;
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
// src/sdk/agent-runner.ts
import { mkdtemp, rm, writeFile as writeFile6 } from "fs/promises";
import { tmpdir } from "os";
import { extname, join as join10 } from "path";
import { randomUUID as randomUUID8 } from "crypto";
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
      error: toError2(error)
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
    const tempDir = await mkdtemp(join10(tmpdir(), "codex-agent-attachment-"));
    tempDirs.push(tempDir);
    const parsed = parseBase64Input(attachment.data);
    const mediaType = attachment.mediaType ?? parsed.mediaType;
    const ext = extensionForMediaType(mediaType);
    const fileName = sanitizeFileName(attachment.filename, ext);
    const filePath = join10(tempDir, fileName);
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
function toError2(value) {
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
    const payload2 = toRecord6(chunk.payload);
    if (payload2 === null) {
      return events;
    }
    const payloadType = readString6(payload2["type"]);
    if (payloadType === "AgentMessage") {
      const message = readString6(payload2["message"]);
      if (message !== undefined) {
        events.push(...toAssistantTextEvents(sessionId, message, state));
      }
      return events;
    }
    if (payloadType === "AgentReasoning") {
      const message = readString6(payload2["text"]);
      events.push({
        type: "activity",
        sessionId,
        ...message !== undefined ? { message } : {}
      });
      return events;
    }
    if (payloadType === "ExecCommandBegin") {
      const callId = readString6(payload2["call_id"]);
      const command = readStringArray3(payload2["command"]);
      const input = {
        callId,
        turnId: readString6(payload2["turn_id"]),
        cwd: readString6(payload2["cwd"]),
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
      const callId = readString6(payload2["call_id"]);
      const exitCode = readNumber4(payload2["exit_code"]);
      const output = {
        callId,
        turnId: readString6(payload2["turn_id"]),
        cwd: readString6(payload2["cwd"]),
        command: readStringArray3(payload2["command"]),
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
        error: new Error(readString6(payload2["message"]) ?? "Unknown rollout error")
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
  const payload = toRecord6(chunk.payload);
  if (payload === null) {
    return events;
  }
  const itemType = readString6(payload["type"]);
  if (itemType === "function_call") {
    const name = readString6(payload["name"]) ?? "unknown-tool";
    const callId = readString6(payload["call_id"]);
    if (callId !== undefined) {
      state.toolNamesByCallId.set(callId, name);
    }
    events.push({
      type: "tool.call",
      sessionId,
      name,
      input: parseMaybeJson2(readString6(payload["arguments"]))
    });
    return events;
  }
  if (itemType === "function_call_output") {
    const callId = readString6(payload["call_id"]);
    const output = payload["output"];
    const outputRecord = toRecord6(output);
    const isError = outputRecord?.["is_error"] === true || readString6(outputRecord?.["status"]) === "error";
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
    const status = readString6(payload["status"]);
    const action = payload["action"];
    const output = payload["output"];
    const callId = readString6(payload["call_id"]);
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
  if (itemType === "message" && readString6(payload["role"]) === "assistant" && Array.isArray(payload["content"])) {
    for (const item of payload["content"]) {
      const content = toRecord6(item);
      if (content === null) {
        continue;
      }
      const contentType = readString6(content["type"]);
      if (contentType !== "output_text" && contentType !== "input_text") {
        continue;
      }
      const text = readString6(content["text"]);
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
function toRecord6(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value;
}
function readString6(value) {
  return typeof value === "string" ? value : undefined;
}
function readNumber4(value) {
  return typeof value === "number" ? value : undefined;
}
function readStringArray3(value) {
  if (!Array.isArray(value)) {
    return;
  }
  const strings = value.filter((item) => typeof item === "string");
  return strings.length > 0 ? strings : undefined;
}
function parseMaybeJson2(value) {
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
  return await new Promise((resolve3) => {
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
      resolve3(result);
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
  return await new Promise((resolve3) => {
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
      resolve3(result);
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
import { join as join11 } from "path";
var ROLLOUT_PREFIX3 = "rollout-";
var ROLLOUT_EXT3 = ".jsonl";
var DEFAULT_RECENT_DAYS = 14;
var DEFAULT_CACHE_TTL_MS = 5000;
var usageStatsCache = null;
async function getCodexUsageStats(options) {
  const sessionsDir = options?.codexSessionsDir ?? join11(resolveCodexHome(), "sessions");
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
    const fullPath = join11(dirPath, entry.name);
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
    const payload = toRecord7(line.payload);
    const eventType = readString7(payload, "type");
    return eventType === "UserMessage" || eventType === "AgentMessage";
  }
  if (isResponseItem(line)) {
    const payload = toRecord7(line.payload);
    if (readString7(payload, "type") !== "message") {
      return false;
    }
    const role = readString7(payload, "role");
    return role === "user" || role === "assistant";
  }
  return false;
}
function extractToolCallCount(line) {
  if (isEventMsg(line)) {
    const payload = toRecord7(line.payload);
    if (readString7(payload, "type") === "ExecCommandBegin") {
      return 1;
    }
  }
  if (isResponseItem(line)) {
    const payload = toRecord7(line.payload);
    const itemType = readString7(payload, "type");
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
  const payload = toRecord7(line.payload);
  if (payload === null) {
    return null;
  }
  const eventType = readString7(payload, "type");
  let usage = null;
  let modelFromInfo;
  let source = null;
  let isCumulative = false;
  let aggregationKey;
  let model;
  if (eventType === "TurnComplete") {
    source = "turn_complete";
    usage = toRecord7(payload["usage"]);
  } else if (eventType === "token_count" || eventType === "TokenCount") {
    const info = toRecord7(payload["info"]);
    if (info === null) {
      return null;
    }
    source = "token_count";
    modelFromInfo = readString7(info, "model");
    const lastTokenUsage = toRecord7(info["last_token_usage"]) ?? toRecord7(payload["last_token_usage"]);
    const totalTokenUsage = toRecord7(info["total_token_usage"]) ?? toRecord7(payload["total_token_usage"]);
    if (lastTokenUsage !== null) {
      usage = lastTokenUsage;
      isCumulative = false;
    } else if (totalTokenUsage !== null) {
      usage = totalTokenUsage;
      isCumulative = true;
    } else {
      usage = toRecord7(info["usage"]) ?? toRecord7(payload["usage"]) ?? payload;
      isCumulative = false;
    }
    model = resolveTokenCountModel(payload, usage, info, modelFromInfo);
    aggregationKey = extractTokenCountAggregationKey(payload, info, model);
  }
  if (source === null || usage === null) {
    return null;
  }
  const inputTokens = readNumber5(usage, "input_tokens") ?? readNumber5(usage, "inputTokens") ?? 0;
  const outputTokens = readNumber5(usage, "output_tokens") ?? readNumber5(usage, "outputTokens") ?? 0;
  const cacheReadInputTokens = readNumber5(usage, "cache_read_input_tokens") ?? readNumber5(usage, "cacheReadInputTokens") ?? readNumber5(usage, "cached_input_tokens") ?? 0;
  const cacheCreationInputTokens = readNumber5(usage, "cache_creation_input_tokens") ?? readNumber5(usage, "cacheCreationInputTokens") ?? 0;
  const computedTotal = inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens;
  const totalTokens = readNumber5(usage, "total_tokens") ?? readNumber5(usage, "totalTokens") ?? computedTotal;
  model = model ?? modelFromInfo ?? readString7(usage, "model") ?? readString7(usage, "model_id") ?? readString7(payload, "model") ?? "unknown";
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
  const infoStreamId = readString7(info, "stream_id");
  if (infoStreamId !== undefined) {
    parts.push(`stream:${infoStreamId}`);
  }
  const infoTurnId = readString7(info, "turn_id");
  if (infoTurnId !== undefined) {
    parts.push(`info_turn:${infoTurnId}`);
  }
  const payloadTurnId = readString7(payload, "turn_id");
  if (payloadTurnId !== undefined) {
    parts.push(`payload_turn:${payloadTurnId}`);
  }
  const responseId = readString7(info, "response_id");
  if (responseId !== undefined) {
    parts.push(`response:${responseId}`);
  }
  const messageId = readString7(info, "message_id");
  if (messageId !== undefined) {
    parts.push(`message:${messageId}`);
  }
  parts.push(`model:${model}`);
  return parts.join("|");
}
function resolveTokenCountModel(payload, usage, info, modelFromInfo) {
  const explicitModel = modelFromInfo ?? readString7(usage, "model") ?? readString7(usage, "model_id") ?? readString7(payload, "model");
  if (explicitModel !== undefined) {
    return explicitModel;
  }
  const payloadRateLimitsModel = extractModelFromRateLimits(toRecord7(payload["rate_limits"]));
  if (payloadRateLimitsModel !== undefined) {
    return payloadRateLimitsModel;
  }
  const infoRateLimitsModel = extractModelFromRateLimits(toRecord7(info["rate_limits"]));
  if (infoRateLimitsModel !== undefined) {
    return infoRateLimitsModel;
  }
  return "unknown";
}
function extractModelFromRateLimits(rateLimits) {
  const limitName = readString7(rateLimits, "limit_name");
  const normalizedLimitName = normalizeRateLimitModel(limitName);
  if (normalizedLimitName !== undefined) {
    return normalizedLimitName;
  }
  const limitId = readString7(rateLimits, "limit_id");
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
  const payload = toRecord7(payloadValue);
  if (payload === null) {
    return;
  }
  const payloadTimestamp = readString7(payload, "timestamp");
  if (payloadTimestamp !== undefined) {
    return payloadTimestamp;
  }
  const meta = toRecord7(payload["meta"]);
  return readString7(meta, "timestamp");
}
function toRecord7(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value;
}
function readString7(value, key) {
  if (value === null) {
    return;
  }
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}
function readNumber5(value, key) {
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
// src/graphql/command-handlers.ts
async function executeCommand(name, params, context) {
  switch (name) {
    case "version.get":
      return handleVersionGet(params);
    case "session.list":
      return handleSessionList(params, context);
    case "session.show":
      return handleSessionShow(params, context);
    case "session.search":
      return handleSessionSearch(params, context);
    case "session.searchTranscript":
      return handleSessionSearchTranscript(params, context);
    case "session.run":
      return handleSessionRun(params);
    case "session.resume":
      return handleSessionResume(params);
    case "session.fork":
      return handleSessionFork(params);
    case "group.list":
      return listGroups(context.configDir);
    case "group.create":
      return handleGroupCreate(params, context);
    case "group.show":
      return handleGroupShow(params, context);
    case "group.add":
      return handleGroupAdd(params, context);
    case "group.remove":
      return handleGroupRemove(params, context);
    case "group.pause":
      return handleGroupPause(params, context);
    case "group.resume":
      return handleGroupResume(params, context);
    case "group.delete":
      return handleGroupDelete(params, context);
    case "group.run":
      return handleGroupRun(params, context);
    case "queue.list":
      return listQueues(context.configDir);
    case "queue.create":
      return handleQueueCreate(params, context);
    case "queue.show":
      return handleQueueShow(params, context);
    case "queue.add":
      return handleQueueAdd(params, context);
    case "queue.pause":
      return handleQueuePause(params, context);
    case "queue.resume":
      return handleQueueResume(params, context);
    case "queue.delete":
      return handleQueueDelete(params, context);
    case "queue.update":
      return handleQueueUpdate(params, context);
    case "queue.remove":
      return handleQueueRemove(params, context);
    case "queue.move":
      return handleQueueMove(params, context);
    case "queue.mode":
      return handleQueueMode(params, context);
    case "queue.run":
      return handleQueueRun(params, context);
    case "bookmark.add":
      return handleBookmarkAdd(params, context);
    case "bookmark.list":
      return handleBookmarkList(params, context);
    case "bookmark.get":
      return handleBookmarkGet(params, context);
    case "bookmark.delete":
      return handleBookmarkDelete(params, context);
    case "bookmark.search":
      return handleBookmarkSearch(params, context);
    case "token.create":
      return handleTokenCreate(params, context);
    case "token.list":
      return listTokens(context.configDir);
    case "token.revoke":
      return handleTokenRevoke(params, context);
    case "token.rotate":
      return handleTokenRotate(params, context);
    case "files.list":
      return handleFilesList(params, context);
    case "files.patches":
      return handleFilesPatches(params, context);
    case "files.find":
      return handleFilesFind(params, context);
    case "files.rebuild":
      return rebuildFileIndex(context.configDir, context.codexHome);
    default:
      throw new GraphQLError(`Unknown GraphQL command: ${name}`);
  }
}
async function subscribeCommand(name, params, context) {
  switch (name) {
    case "session.watch":
      return handleSessionWatch(params, context);
    default:
      throw new GraphQLError(`Unsupported GraphQL subscription command: ${name}`);
  }
}
async function collectItems(iterable) {
  const items = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}
async function handleVersionGet(params) {
  const input = params === undefined ? {} : toRecord4(params);
  return getToolVersions({
    includeGit: readBoolean(input, "includeGit") ?? false
  });
}
async function handleSessionList(params, context) {
  const input = params === undefined ? {} : toRecord4(params);
  const options = {};
  const limit = readNumber3(input, "limit");
  if (limit !== undefined)
    options.limit = limit;
  const offset = readNumber3(input, "offset");
  if (offset !== undefined)
    options.offset = offset;
  const source = readString5(input, "source");
  if (source === "cli" || source === "vscode" || source === "exec" || source === "unknown") {
    options.source = source;
  }
  const cwd = readString5(input, "cwd");
  if (cwd !== undefined)
    options.cwd = cwd;
  const branch = readString5(input, "branch");
  if (branch !== undefined)
    options.branch = branch;
  if (context.codexHome !== undefined)
    options.codexHome = context.codexHome;
  return listSessions(options);
}
async function handleSessionShow(params, context) {
  const input = toRecord4(params);
  const session = await findSession(requireString(input, "id"), context.codexHome);
  if (session === null) {
    throw new GraphQLError("Session not found");
  }
  return session;
}
async function handleSessionSearch(params, context) {
  const input = toRecord4(params);
  const options = {};
  const limit = readNumber3(input, "limit");
  if (limit !== undefined)
    options.limit = limit;
  const offset = readNumber3(input, "offset");
  if (offset !== undefined)
    options.offset = offset;
  const source = readString5(input, "source");
  if (source === "cli" || source === "vscode" || source === "exec" || source === "unknown") {
    options.source = source;
  }
  const cwd = readString5(input, "cwd");
  if (cwd !== undefined)
    options.cwd = cwd;
  const branch = readString5(input, "branch");
  if (branch !== undefined)
    options.branch = branch;
  const role = readString5(input, "role");
  if (role === "user" || role === "assistant" || role === "both") {
    options.role = role;
  }
  const caseSensitive = readBoolean(input, "caseSensitive");
  if (caseSensitive !== undefined)
    options.caseSensitive = caseSensitive;
  const maxBytes = readNumber3(input, "maxBytes");
  if (maxBytes !== undefined)
    options.maxBytes = maxBytes;
  const maxEvents = readNumber3(input, "maxEvents");
  if (maxEvents !== undefined)
    options.maxEvents = maxEvents;
  const maxSessions = readNumber3(input, "maxSessions");
  if (maxSessions !== undefined)
    options.maxSessions = maxSessions;
  const timeoutMs = readNumber3(input, "timeoutMs");
  if (timeoutMs !== undefined)
    options.timeoutMs = timeoutMs;
  if (context.codexHome !== undefined)
    options.codexHome = context.codexHome;
  return searchSessions(requireString(input, "query"), options);
}
async function handleSessionSearchTranscript(params, context) {
  const input = toRecord4(params);
  const options = {};
  const role = readString5(input, "role");
  if (role === "user" || role === "assistant" || role === "both") {
    options.role = role;
  }
  const caseSensitive = readBoolean(input, "caseSensitive");
  if (caseSensitive !== undefined)
    options.caseSensitive = caseSensitive;
  const maxBytes = readNumber3(input, "maxBytes");
  if (maxBytes !== undefined)
    options.maxBytes = maxBytes;
  const maxEvents = readNumber3(input, "maxEvents");
  if (maxEvents !== undefined)
    options.maxEvents = maxEvents;
  const timeoutMs = readNumber3(input, "timeoutMs");
  if (timeoutMs !== undefined)
    options.timeoutMs = timeoutMs;
  if (context.codexHome !== undefined)
    options.codexHome = context.codexHome;
  return searchSessionTranscript(requireString(input, "id"), requireString(input, "query"), options);
}
async function handleSessionRun(params) {
  const input = toRecord4(params);
  const prompt = requireString(input, "prompt");
  const options = readProcessOptions(input);
  const pm = new ProcessManager(options.codexBinary);
  const result = await pm.spawnExec(prompt, options);
  return {
    sessionId: extractSessionId(result.lines),
    exitCode: result.exitCode,
    lines: result.lines
  };
}
async function handleSessionResume(params) {
  const input = toRecord4(params);
  const options = readProcessOptions(input);
  const pm = new ProcessManager(options.codexBinary);
  return pm.spawnResume(requireString(input, "id"), options, readString5(input, "prompt"));
}
async function handleSessionFork(params) {
  const input = toRecord4(params);
  const options = readProcessOptions(input);
  const pm = new ProcessManager(options.codexBinary);
  return pm.spawnFork(requireString(input, "id"), readNumber3(input, "nthMessage"), options);
}
async function handleSessionWatch(params, context) {
  const input = toRecord4(params);
  const session = await findSession(requireString(input, "id"), context.codexHome);
  if (session === null) {
    throw new GraphQLError("Session not found");
  }
  const startOffset = readNumber3(input, "startOffset");
  return createWatchStream(session.rolloutPath, startOffset);
}
async function handleGroupCreate(params, context) {
  const input = toRecord4(params);
  return addGroup(requireString(input, "name"), readString5(input, "description"), context.configDir);
}
async function handleGroupShow(params, context) {
  const input = toRecord4(params);
  const group = await findGroup(requireString(input, "id"), context.configDir);
  if (group === null) {
    throw new GraphQLError("Group not found");
  }
  return group;
}
async function handleGroupAdd(params, context) {
  const input = toRecord4(params);
  const group = await findGroup(requireString(input, "id"), context.configDir);
  if (group === null) {
    throw new GraphQLError("Group not found");
  }
  await addSessionToGroup(group.id, requireString(input, "sessionId"), context.configDir);
  return { ok: true };
}
async function handleGroupRemove(params, context) {
  const input = toRecord4(params);
  const group = await findGroup(requireString(input, "id"), context.configDir);
  if (group === null) {
    throw new GraphQLError("Group not found");
  }
  await removeSessionFromGroup(group.id, requireString(input, "sessionId"), context.configDir);
  return { ok: true };
}
async function handleGroupPause(params, context) {
  const ok = await pauseGroup(requireString(toRecord4(params), "id"), context.configDir);
  if (!ok) {
    throw new GraphQLError("Group not found");
  }
  return { ok: true };
}
async function handleGroupResume(params, context) {
  const ok = await resumeGroup(requireString(toRecord4(params), "id"), context.configDir);
  if (!ok) {
    throw new GraphQLError("Group not found");
  }
  return { ok: true };
}
async function handleGroupDelete(params, context) {
  const ok = await removeGroup(requireString(toRecord4(params), "id"), context.configDir);
  if (!ok) {
    throw new GraphQLError("Group not found");
  }
  return { ok: true };
}
async function handleGroupRun(params, context) {
  const input = toRecord4(params);
  const group = await findGroup(requireString(input, "id"), context.configDir);
  if (group === null) {
    throw new GraphQLError("Group not found");
  }
  return collectItems(runGroup(group, requireString(input, "prompt"), {
    ...readProcessOptions(input),
    maxConcurrent: readNumber3(input, "maxConcurrent")
  }));
}
async function handleQueueCreate(params, context) {
  const input = toRecord4(params);
  return createQueue(requireString(input, "name"), requireString(input, "projectPath"), context.configDir);
}
async function handleQueueShow(params, context) {
  const queue = await findQueue(requireString(toRecord4(params), "id"), context.configDir);
  if (queue === null) {
    throw new GraphQLError("Queue not found");
  }
  return queue;
}
async function handleQueueAdd(params, context) {
  const input = toRecord4(params);
  const queue = await findQueue(requireString(input, "id"), context.configDir);
  if (queue === null) {
    throw new GraphQLError("Queue not found");
  }
  return addPrompt(queue.id, requireString(input, "prompt"), readStringArray2(input, "images"), context.configDir);
}
async function handleQueuePause(params, context) {
  const ok = await pauseQueue(requireString(toRecord4(params), "id"), context.configDir);
  if (!ok) {
    throw new GraphQLError("Queue not found");
  }
  return { ok: true };
}
async function handleQueueResume(params, context) {
  const ok = await resumeQueue(requireString(toRecord4(params), "id"), context.configDir);
  if (!ok) {
    throw new GraphQLError("Queue not found");
  }
  return { ok: true };
}
async function handleQueueDelete(params, context) {
  const ok = await removeQueue(requireString(toRecord4(params), "id"), context.configDir);
  if (!ok) {
    throw new GraphQLError("Queue not found");
  }
  return { ok: true };
}
async function handleQueueUpdate(params, context) {
  const input = toRecord4(params);
  const ok = await updateQueueCommand(requireString(input, "id"), requireString(input, "commandId"), {
    prompt: readString5(input, "prompt"),
    status: readStringUnion(input, "status", QUEUE_PROMPT_STATUSES)
  }, context.configDir);
  if (!ok) {
    throw new GraphQLError("Queue command not found");
  }
  return { ok: true };
}
async function handleQueueRemove(params, context) {
  const input = toRecord4(params);
  const ok = await removeQueueCommand(requireString(input, "id"), requireString(input, "commandId"), context.configDir);
  if (!ok) {
    throw new GraphQLError("Queue command not found");
  }
  return { ok: true };
}
async function handleQueueMove(params, context) {
  const input = toRecord4(params);
  const ok = await moveQueueCommand(requireString(input, "id"), requireNumber(input, "from"), requireNumber(input, "to"), context.configDir);
  if (!ok) {
    throw new GraphQLError("Queue or command position not found");
  }
  return { ok: true };
}
async function handleQueueMode(params, context) {
  const input = toRecord4(params);
  const mode = requireStringUnion(input, "mode", QUEUE_COMMAND_MODES);
  const ok = await toggleQueueCommandMode(requireString(input, "id"), requireString(input, "commandId"), mode, context.configDir);
  if (!ok) {
    throw new GraphQLError("Queue command not found");
  }
  return { ok: true };
}
async function handleQueueRun(params, context) {
  const input = toRecord4(params);
  const queue = await findQueue(requireString(input, "id"), context.configDir);
  if (queue === null) {
    throw new GraphQLError("Queue not found");
  }
  const options = {
    ...readProcessOptions(input)
  };
  if (context.configDir !== undefined) {
    options.configDir = context.configDir;
  }
  return collectItems(runQueue(queue, options, { stopped: false }));
}
async function handleBookmarkAdd(params, context) {
  const input = toRecord4(params);
  return addBookmark({
    type: requireStringUnion(input, "type", BOOKMARK_TYPES),
    sessionId: requireString(input, "sessionId"),
    name: requireString(input, "name"),
    description: readString5(input, "description"),
    tags: readStringArray2(input, "tags"),
    messageId: readString5(input, "messageId"),
    fromMessageId: readString5(input, "fromMessageId"),
    toMessageId: readString5(input, "toMessageId")
  }, context.configDir);
}
async function handleBookmarkList(params, context) {
  const input = params === undefined ? {} : toRecord4(params);
  return listBookmarks({
    sessionId: readString5(input, "sessionId"),
    type: readStringUnion(input, "type", BOOKMARK_TYPES),
    tag: readString5(input, "tag")
  }, context.configDir);
}
async function handleBookmarkGet(params, context) {
  const bookmark = await getBookmark(requireString(toRecord4(params), "id"), context.configDir);
  if (bookmark === null) {
    throw new GraphQLError("Bookmark not found");
  }
  return bookmark;
}
async function handleBookmarkDelete(params, context) {
  const ok = await deleteBookmark(requireString(toRecord4(params), "id"), context.configDir);
  if (!ok) {
    throw new GraphQLError("Bookmark not found");
  }
  return { ok: true };
}
async function handleBookmarkSearch(params, context) {
  const input = toRecord4(params);
  return searchBookmarks(requireString(input, "query"), { limit: readNumber3(input, "limit") }, context.configDir);
}
async function handleTokenCreate(params, context) {
  const input = toRecord4(params);
  const rawPermissions = readStringArray2(input, "permissions");
  const permissions = rawPermissions === undefined ? DEFAULT_TOKEN_PERMISSIONS : normalizePermissions(rawPermissions);
  if (permissions.length === 0) {
    throw new GraphQLError("permissions must include at least one valid permission");
  }
  return createToken({
    name: requireString(input, "name"),
    permissions,
    expiresAt: readString5(input, "expiresAt")
  }, context.configDir);
}
async function handleTokenRevoke(params, context) {
  return revokeToken(requireString(toRecord4(params), "id"), context.configDir);
}
async function handleTokenRotate(params, context) {
  return rotateToken(requireString(toRecord4(params), "id"), context.configDir);
}
async function handleFilesList(params, context) {
  return getChangedFiles(requireString(toRecord4(params), "sessionId"), {
    configDir: context.configDir,
    codexHome: context.codexHome
  });
}
async function handleFilesPatches(params, context) {
  return getSessionFilePatchHistory(requireString(toRecord4(params), "sessionId"), {
    configDir: context.configDir,
    codexHome: context.codexHome
  });
}
async function handleFilesFind(params, context) {
  const input = toRecord4(params);
  return findSessionsByFile(requireString(input, "path"), {
    configDir: context.configDir,
    codexHome: context.codexHome
  });
}
async function* createWatchStream(rolloutPath, startOffset) {
  const watcher = new RolloutWatcher;
  const queue = [];
  let failure = null;
  let resolveNext = null;
  const wake = () => {
    resolveNext?.();
    resolveNext = null;
  };
  watcher.on("line", (_path, line) => {
    queue.push(line);
    wake();
  });
  watcher.on("error", (error) => {
    failure = error;
    wake();
  });
  await watcher.watchFile(rolloutPath, startOffset === undefined ? undefined : { startOffset });
  try {
    while (true) {
      while (queue.length > 0) {
        const item = queue.shift();
        if (item !== undefined) {
          yield item;
        }
      }
      if (failure !== null) {
        throw failure;
      }
      await new Promise((resolve3) => {
        resolveNext = resolve3;
      });
    }
  } finally {
    watcher.stop();
    wake();
  }
}

// src/graphql/schema.ts
var JSON_SCALAR = new GraphQLScalarType({
  name: "JSON",
  serialize(value) {
    return value;
  },
  parseValue(value) {
    return value;
  },
  parseLiteral(ast) {
    return parseJsonLiteral(ast);
  }
});
var QUERY_TYPE = new GraphQLObjectType({
  name: "Query",
  fields: {
    command: {
      type: new GraphQLNonNull(JSON_SCALAR),
      args: {
        name: { type: new GraphQLNonNull(GraphQLString) },
        params: { type: JSON_SCALAR }
      },
      async resolve(_source, args, context) {
        return executeCommand(args.name, args.params, context);
      }
    },
    ping: {
      type: new GraphQLNonNull(GraphQLBoolean),
      resolve() {
        return true;
      }
    }
  }
});
var MUTATION_TYPE = new GraphQLObjectType({
  name: "Mutation",
  fields: {
    command: {
      type: new GraphQLNonNull(JSON_SCALAR),
      args: {
        name: { type: new GraphQLNonNull(GraphQLString) },
        params: { type: JSON_SCALAR }
      },
      async resolve(_source, args, context) {
        return executeCommand(args.name, args.params, context);
      }
    }
  }
});
var SUBSCRIPTION_TYPE = new GraphQLObjectType({
  name: "Subscription",
  fields: {
    command: {
      type: new GraphQLNonNull(JSON_SCALAR),
      args: {
        name: { type: new GraphQLNonNull(GraphQLString) },
        params: { type: JSON_SCALAR }
      },
      async subscribe(_source, args, context) {
        return subscribeCommand(args.name, args.params, context);
      },
      resolve(payload) {
        return payload;
      }
    }
  }
});
var SCHEMA = new GraphQLSchema({
  query: QUERY_TYPE,
  mutation: MUTATION_TYPE,
  subscription: SUBSCRIPTION_TYPE
});
function getGraphqlSchema() {
  return SCHEMA;
}
// src/graphql/execute.ts
function toErrorResult(error) {
  return {
    errors: [error]
  };
}
function isAsyncIterable2(value) {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}
async function executeGraphqlOperation(request) {
  let document;
  try {
    document = parse(request.document);
  } catch (error) {
    return toErrorResult(error instanceof GraphQLError ? error : new GraphQLError(String(error)));
  }
  const schema = getGraphqlSchema();
  const validationErrors = validate(schema, document);
  if (validationErrors.length > 0) {
    return {
      errors: validationErrors
    };
  }
  const operation = getOperationAST(document);
  if (operation?.operation === "subscription") {
    return subscribe({
      schema,
      document,
      variableValues: request.variables,
      contextValue: request.context ?? {}
    });
  }
  return execute({
    schema,
    document,
    variableValues: request.variables,
    contextValue: request.context ?? {}
  });
}
async function executeGraphqlDocument(request) {
  const result = await executeGraphqlOperation(request);
  if (isAsyncIterable2(result)) {
    throw new GraphQLError("Subscriptions must be executed with executeGraphqlOperation");
  }
  return result;
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
// src/cli/parsing.ts
function parseListArgs(args) {
  const result = { limit: 50, format: "table" };
  for (let i = 0;i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    switch (arg) {
      case "--source":
        if (next !== undefined && isSessionSource(next)) {
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
function isSessionSource(s) {
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
  const sandbox = readAllowedArg(args, "--sandbox", SANDBOX_MODES);
  if (sandbox !== undefined)
    opts.sandbox = sandbox;
  const approvalMode = readAllowedArg(args, "--approval-mode", APPROVAL_MODES);
  if (approvalMode !== undefined)
    opts.approvalMode = approvalMode;
  if (args.includes("--full-auto")) {
    opts.fullAuto = true;
  }
  const images = getArgValues(args, "--image");
  if (images.length > 0) {
    opts.images = images;
  }
  const streamGranularity = readAllowedArg(args, "--stream-granularity", STREAM_GRANULARITIES);
  if (streamGranularity !== undefined) {
    opts.streamGranularity = streamGranularity;
  }
  return opts;
}
function readAllowedArg(args, flag, allowedValues) {
  const value = getArgValue(args, flag);
  if (value === undefined) {
    return;
  }
  return allowedValues.includes(value) ? value : undefined;
}
function parseCharDelayMs(args) {
  const raw = getArgValue(args, "--char-delay-ms");
  if (raw === undefined) {
    return 8;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 8;
  }
  return parsed;
}
function isCharChunk2(chunk) {
  if (typeof chunk !== "object" || chunk === null) {
    return false;
  }
  const record = chunk;
  return record["kind"] === "char" && typeof record["char"] === "string";
}
function sleep2(ms) {
  return new Promise((resolve3) => {
    setTimeout(resolve3, ms);
  });
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

// src/cli/usage.ts
var CLI_NAME = "codex-agent";
var USAGE = `${CLI_NAME} - Codex session manager

Usage:
  ${CLI_NAME} session list [options]
  ${CLI_NAME} session show <id> [--tasks]
  ${CLI_NAME} session watch <id>
  ${CLI_NAME} session run --prompt <P> [options]
  ${CLI_NAME} session resume <id> [options]
  ${CLI_NAME} session fork <id> [--nth-message N] [options]

  ${CLI_NAME} group create <name> [--description D]
  ${CLI_NAME} group list [--format json|table]
  ${CLI_NAME} group show <group>
  ${CLI_NAME} group add <group> <session>
  ${CLI_NAME} group remove <group> <session>
  ${CLI_NAME} group pause <group>
  ${CLI_NAME} group resume <group>
  ${CLI_NAME} group delete <group>
  ${CLI_NAME} group run <name> --prompt <P> [--max-concurrent N] [--image FILE]...

  ${CLI_NAME} bookmark add --type <session|message|range> --session <id> --name <name> [options]
  ${CLI_NAME} bookmark list [--format json|table] [--session <id>] [--type <type>] [--tag <tag>]
  ${CLI_NAME} bookmark get <id>
  ${CLI_NAME} bookmark delete <id>
  ${CLI_NAME} bookmark search <query> [--limit <n>] [--format json|table]

  ${CLI_NAME} token create --name <name> [--permissions <csv>] [--expires-at <iso8601>]
  ${CLI_NAME} token list [--format json|table]
  ${CLI_NAME} token revoke <id>
  ${CLI_NAME} token rotate <id>

  ${CLI_NAME} files list <session-id> [--format json|table]
  ${CLI_NAME} files patches <session-id> [--format json|table]
  ${CLI_NAME} files find <path> [--format json|table]
  ${CLI_NAME} files rebuild

  ${CLI_NAME} queue create <name> --project <path>
  ${CLI_NAME} queue add <name> --prompt <prompt> [--image FILE]...
  ${CLI_NAME} queue show <name>
  ${CLI_NAME} queue list [--format json|table]
  ${CLI_NAME} queue pause <name>
  ${CLI_NAME} queue resume <name>
  ${CLI_NAME} queue delete <name>
  ${CLI_NAME} queue update <name> <command-id> [--prompt <text>] [--status <status>]
  ${CLI_NAME} queue remove <name> <command-id>
  ${CLI_NAME} queue move <name> --from <n> --to <n>
  ${CLI_NAME} queue mode <name> <command-id> --mode <auto|manual>
  ${CLI_NAME} queue run <name> [--image FILE]...

  ${CLI_NAME} model check --model <model> [--json] [--timeout-ms <ms>]

  ${CLI_NAME} graphql <query|command> [--param <json|path>] [--variables <json|path>]

  ${CLI_NAME} version [--json] [--include-git]

Session list options:
  --source <cli|vscode|exec>  Filter by session source
  --cwd <path>                Filter by working directory
  --branch <name>             Filter by git branch
  --limit <n>                 Max results (default: 50)
  --format <table|json>       Output format (default: table)

Common process options:
  --model <model>             Model to use
  --sandbox <full|network-only|none>  Sandbox mode
  --approval-mode <mode>       Approval mode: always, unless-allow-listed, never, on-failure
  --full-auto                 Enable full-auto mode
  --stream-granularity <event|char>  Stream by rollout event or character
  --char-delay-ms <n>         Delay per rendered char in ms (session run only, default: 8)
  --image <path>              Attach image(s) to prompt (repeatable)

`;

// src/cli/commands/bookmark.ts
async function handleBookmark(action, args) {
  switch (action) {
    case "add":
      await handleBookmarkAdd2(args);
      break;
    case "list":
      await handleBookmarkList2(args);
      break;
    case "get":
      await handleBookmarkGet2(args);
      break;
    case "delete":
      await handleBookmarkDelete2(args);
      break;
    case "search":
      await handleBookmarkSearch2(args);
      break;
    default:
      console.error(`Unknown bookmark action: ${action ?? "(none)"}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
async function handleBookmarkAdd2(args) {
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
async function handleBookmarkList2(args) {
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
  const headers = {
    id: "ID",
    type: "TYPE",
    session: "SESSION",
    name: "NAME",
    tags: "TAGS"
  };
  const cols = Object.keys(headers);
  const widths = Object.fromEntries(cols.map((col) => [
    col,
    Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)
  ]));
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join(`
`));
}
async function handleBookmarkGet2(args) {
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
async function handleBookmarkDelete2(args) {
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
async function handleBookmarkSearch2(args) {
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
  const widths = Object.fromEntries(cols.map((col) => [
    col,
    Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)
  ]));
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join(`
`));
}

// src/cli/commands/files.ts
async function handleFiles(action, args) {
  switch (action) {
    case "list":
      await handleFilesList2(args);
      break;
    case "patches":
      await handleFilesPatches2(args);
      break;
    case "find":
      await handleFilesFind2(args);
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
async function handleFilesList2(args) {
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
    const headers = {
      path: "PATH",
      op: "OP",
      count: "COUNT",
      last: "LAST_MODIFIED"
    };
    const cols = Object.keys(headers);
    const widths = Object.fromEntries(cols.map((col) => [
      col,
      Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)
    ]));
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
async function handleFilesPatches2(args) {
  const sessionId = args[0];
  if (sessionId === undefined) {
    console.error("Usage: codex-agent files patches <session-id> [--format json|table]");
    process.exitCode = 1;
    return;
  }
  const format = getArgValue(args, "--format") ?? "table";
  try {
    const history = await getSessionFilePatchHistory(sessionId);
    if (format === "json") {
      console.log(JSON.stringify(history, null, 2));
      return;
    }
    if (history.files.length === 0) {
      console.log("No file patch history found.");
      return;
    }
    for (const file of history.files) {
      console.log(`${file.path} (${file.changeCount} changes, latest ${file.lastModified})`);
      for (const change of file.changes) {
        const summary = change.patch !== undefined ? change.patch.split(`
`)[0] ?? change.operation : change.command ?? change.operation;
        console.log(`  ${change.timestamp}  ${change.operation}  ${change.source}  ${summary}`);
      }
      console.log("");
    }
  } catch (err) {
    console.error(`Failed to get file patch history: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
async function handleFilesFind2(args) {
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
  const headers = {
    session: "SESSION",
    operation: "OP",
    last: "LAST_MODIFIED"
  };
  const cols = Object.keys(headers);
  const widths = Object.fromEntries(cols.map((col) => [
    col,
    Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)
  ]));
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

// src/cli/commands/group.ts
async function handleGroup(action, args) {
  switch (action) {
    case "create":
      await handleGroupCreate2(args);
      break;
    case "list":
      await handleGroupList(args);
      break;
    case "show":
      await handleGroupShow2(args);
      break;
    case "add":
      await handleGroupAdd2(args);
      break;
    case "remove":
      await handleGroupRemove2(args);
      break;
    case "pause":
      await handleGroupPause2(args);
      break;
    case "resume":
      await handleGroupResume2(args);
      break;
    case "delete":
      await handleGroupDelete2(args);
      break;
    case "run":
      await handleGroupRun2(args);
      break;
    default:
      console.error(`Unknown group action: ${action ?? "(none)"}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
async function handleGroupCreate2(args) {
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
  const headers = {
    id: "ID",
    name: "NAME",
    sessions: "SESSIONS",
    created: "CREATED"
  };
  const cols = Object.keys(headers);
  const widths = Object.fromEntries(cols.map((col) => [
    col,
    Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)
  ]));
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join(`
`));
}
async function handleGroupShow2(args) {
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
async function handleGroupAdd2(args) {
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
async function handleGroupRemove2(args) {
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
async function handleGroupPause2(args) {
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
async function handleGroupResume2(args) {
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
async function handleGroupDelete2(args) {
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
async function handleGroupRun2(args) {
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
  for await (const event of runGroup(group, prompt, {
    ...opts,
    maxConcurrent
  })) {
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

// src/cli/commands/queue.ts
async function handleQueue(action, args) {
  switch (action) {
    case "create":
      await handleQueueCreate2(args);
      break;
    case "add":
      await handleQueueAdd2(args);
      break;
    case "show":
      await handleQueueShow2(args);
      break;
    case "list":
      await handleQueueList(args);
      break;
    case "pause":
      await handleQueuePause2(args);
      break;
    case "resume":
      await handleQueueResume2(args);
      break;
    case "delete":
      await handleQueueDelete2(args);
      break;
    case "update":
      await handleQueueUpdate2(args);
      break;
    case "remove":
      await handleQueueRemoveCommand(args);
      break;
    case "move":
      await handleQueueMove2(args);
      break;
    case "mode":
      await handleQueueMode2(args);
      break;
    case "run":
      await handleQueueRun2(args);
      break;
    default:
      console.error(`Unknown queue action: ${action ?? "(none)"}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
async function handleQueueCreate2(args) {
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
async function handleQueueAdd2(args) {
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
async function handleQueueShow2(args) {
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
  const headers = {
    id: "ID",
    name: "NAME",
    project: "PROJECT",
    prompts: "PROMPTS",
    pending: "PENDING",
    created: "CREATED"
  };
  const cols = Object.keys(headers);
  const widths = Object.fromEntries(cols.map((col) => [
    col,
    Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)
  ]));
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join(`
`));
}
async function handleQueuePause2(args) {
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
async function handleQueueResume2(args) {
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
async function handleQueueDelete2(args) {
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
async function handleQueueUpdate2(args) {
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
async function handleQueueMove2(args) {
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
async function handleQueueMode2(args) {
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
async function handleQueueRun2(args) {
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

// src/cli/commands/session.ts
async function handleSession(action, args) {
  switch (action) {
    case "list":
      await handleSessionList2(args);
      break;
    case "show":
      await handleSessionShow2(args);
      break;
    case "watch":
      await handleSessionWatch2(args);
      break;
    case "run":
      await handleSessionRun2(args);
      break;
    case "resume":
      await handleSessionResume2(args);
      break;
    case "fork":
      await handleSessionFork2(args);
      break;
    default:
      console.error(`Unknown session action: ${action ?? "(none)"}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
async function handleSessionList2(args) {
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
async function handleSessionShow2(args) {
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
async function handleSessionWatch2(args) {
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
  await new Promise((resolve3) => {
    const handler = () => {
      watcher.stop();
      resolve3();
    };
    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
  });
}
async function handleSessionRun2(args) {
  const prompt = getArgValue(args, "--prompt");
  if (prompt === undefined || prompt.trim().length === 0) {
    console.error("Usage: codex-agent session run --prompt <P> [options]");
    process.exitCode = 1;
    return;
  }
  const opts = parseProcessOptions(args);
  const charDelayMs = parseCharDelayMs(args);
  const runner = new SessionRunner;
  const session = await runner.startSession({
    prompt,
    cwd: opts.cwd,
    model: opts.model,
    sandbox: opts.sandbox,
    approvalMode: opts.approvalMode,
    fullAuto: opts.fullAuto,
    additionalArgs: opts.additionalArgs,
    images: opts.images,
    streamGranularity: opts.streamGranularity
  });
  console.log(`Started session ${session.sessionId} with ${opts.streamGranularity ?? "event"} streaming`);
  for await (const chunk of session.messages()) {
    if (isCharChunk2(chunk)) {
      process.stdout.write(chunk.char);
      if (charDelayMs > 0) {
        await sleep2(charDelayMs);
      }
      continue;
    }
    console.log(formatRolloutLine(chunk));
  }
  if (opts.streamGranularity === "char") {
    process.stdout.write(`
`);
  }
  const result = await session.waitForCompletion();
  console.log(`Session ${session.sessionId} exited with code ${result.exitCode}`);
}
async function handleSessionResume2(args) {
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
async function handleSessionFork2(args) {
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

// src/cli/commands/token.ts
async function handleToken(action, args) {
  switch (action) {
    case "create":
      await handleTokenCreate2(args);
      break;
    case "list":
      await handleTokenList(args);
      break;
    case "revoke":
      await handleTokenRevoke2(args);
      break;
    case "rotate":
      await handleTokenRotate2(args);
      break;
    default:
      console.error(`Unknown token action: ${action ?? "(none)"}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
async function handleTokenCreate2(args) {
  const name = getArgValue(args, "--name");
  if (name === undefined || name.trim().length === 0) {
    console.error("Usage: codex-agent token create --name <name> [--permissions <csv>] [--expires-at <iso8601>]");
    process.exitCode = 1;
    return;
  }
  const permissionsCsv = getArgValue(args, "--permissions");
  const expiresAt = getArgValue(args, "--expires-at");
  const permissions = permissionsCsv !== undefined ? parsePermissionList(permissionsCsv) : DEFAULT_TOKEN_PERMISSIONS;
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
  const widths = Object.fromEntries(cols.map((col) => [
    col,
    Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)
  ]));
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join(`
`));
}
async function handleTokenRevoke2(args) {
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
async function handleTokenRotate2(args) {
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

// src/cli/graphql.ts
import { access, readFile as readFile7 } from "fs/promises";
import { constants as fsConstants } from "fs";
async function runGraphqlCli(args, options) {
  const parsed = await parseGraphqlCliArgs(args);
  const result = await executeGraphqlOperation({
    document: parsed.document,
    variables: parsed.variables,
    context: {
      codexHome: options?.codexHome,
      configDir: options?.configDir
    }
  });
  if (isAsyncIterable3(result)) {
    for await (const event of result) {
      console.log(JSON.stringify(event, null, 2));
      if (Array.isArray(event.errors) && event.errors.length > 0) {
        process.exitCode = 1;
      }
    }
    return;
  }
  console.log(JSON.stringify(result, null, 2));
  if (Array.isArray(result.errors) && result.errors.length > 0) {
    process.exitCode = 1;
  }
}
async function parseGraphqlCliArgs(args) {
  const documentArg = args[0];
  if (documentArg === undefined || documentArg.trim().length === 0) {
    throw new Error("Usage: codex-agent graphql <query|command> [--param <json|path>] [--variables <json|path>]");
  }
  const variables = await readVariables(args);
  return {
    document: normalizeGraphqlDocument(documentArg),
    ...variables === undefined ? {} : { variables }
  };
}
function normalizeGraphqlDocument(input) {
  const trimmed = input.trim();
  if (trimmed.startsWith("query") || trimmed.startsWith("mutation") || trimmed.startsWith("subscription") || trimmed.startsWith("{") || trimmed.startsWith("#")) {
    return trimmed;
  }
  const operation = shorthandOperation(trimmed);
  return `${operation} ($param: JSON) { command(name: ${JSON.stringify(trimmed)}, params: $param) }`;
}
async function readVariables(args) {
  const variablesRaw = getArgValue2(args, "--variables");
  const paramRaw = getArgValue2(args, "--param") ?? getArgValue2(args, "--arg");
  let variables;
  if (variablesRaw !== undefined) {
    const parsed = await parseJsonSource(variablesRaw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("--variables must be a JSON object");
    }
    variables = parsed;
  }
  if (paramRaw === undefined) {
    return variables;
  }
  const param = await parseJsonSource(paramRaw);
  return {
    ...variables ?? {},
    param
  };
}
async function parseJsonSource(raw) {
  const path = raw.startsWith("@") ? raw.slice(1) : raw;
  const source = await isReadableFile(path) ? await readFile7(path, "utf-8") : raw;
  try {
    return JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON input: ${message}`);
  }
}
async function isReadableFile(path) {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}
function getArgValue2(args, flag) {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) {
    return;
  }
  return args[idx + 1];
}
function shorthandOperation(command) {
  if (command === "session.watch") {
    return "subscription";
  }
  if (MUTATION_COMMANDS.has(command)) {
    return "mutation";
  }
  return "query";
}
function isAsyncIterable3(value) {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}
var MUTATION_COMMANDS = new Set([
  "session.run",
  "session.resume",
  "session.fork",
  "group.create",
  "group.add",
  "group.remove",
  "group.pause",
  "group.resume",
  "group.delete",
  "group.run",
  "queue.create",
  "queue.add",
  "queue.pause",
  "queue.resume",
  "queue.delete",
  "queue.update",
  "queue.remove",
  "queue.move",
  "queue.mode",
  "queue.run",
  "bookmark.add",
  "bookmark.delete",
  "token.create",
  "token.revoke",
  "token.rotate",
  "files.rebuild"
]);

// src/cli/version-model.ts
async function handleVersion(args) {
  const { asJson, includeGit } = parseVersionArgs(args);
  const versions = await getToolVersions({ includeGit });
  if (asJson) {
    console.log(JSON.stringify(versions, null, 2));
    return;
  }
  printToolVersion("codex", versions.codex);
  if (versions.git !== undefined) {
    printToolVersion("git", versions.git);
  }
}
function parseVersionArgs(args) {
  return {
    asJson: args.includes("--json"),
    includeGit: args.includes("--include-git")
  };
}
function printToolVersion(name, info) {
  if (info.error === null) {
    console.log(`${name}: ${info.version}`);
    return;
  }
  console.log(`${name}: unavailable (${info.error})`);
}
async function handleModel(action, args) {
  if (action !== "check") {
    console.error(`Unknown model action: ${action ?? "(none)"}`);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }
  const parsed = parseModelCheckArgs(args);
  if (parsed.model === undefined || parsed.model.trim().length === 0) {
    console.error("Usage: codex-agent model check --model <model> [--json] [--timeout-ms <ms>]");
    process.exitCode = 1;
    return;
  }
  const result = await checkCodexModelAvailability({
    model: parsed.model,
    ...parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}
  });
  if (parsed.asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`Overall: ${result.ok ? "available" : "unavailable"}`);
    console.log(`Auth:    ${result.auth.ok ? "available" : "unavailable"}${result.auth.status !== null ? ` (${result.auth.status})` : ""}`);
    console.log(`Model:   ${result.model}`);
    console.log(`Probe:   ${result.probe.ok ? "available" : "unavailable"}${result.probe.error !== null ? ` (${result.probe.error})` : ""}`);
  }
  if (!result.ok) {
    process.exitCode = 1;
  }
}
function parseModelCheckArgs(args) {
  const timeoutRaw = getArgValue(args, "--timeout-ms");
  const timeoutMs = timeoutRaw !== undefined ? Number.parseInt(timeoutRaw, 10) : undefined;
  const parsed = {
    asJson: args.includes("--json")
  };
  const model = getArgValue(args, "--model");
  if (model !== undefined) {
    parsed.model = model;
  }
  if (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    parsed.timeoutMs = timeoutMs;
  }
  return parsed;
}

// src/cli/index.ts
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
    case "model":
      await handleModel(action, rest);
      break;
    case "version":
      await handleVersion(args.slice(1));
      break;
    case "graphql":
      await runGraphqlCli(args.slice(1));
      break;
    default:
      console.error(`Unknown command: ${subcommand}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}
export {
  verifyToken,
  validateCreateBookmarkInput,
  updateQueuePrompts,
  updateQueueCommand,
  tool,
  toggleQueueCommandMode,
  toNormalizedEvents,
  streamEvents,
  sessionsWatchDir,
  searchSessions,
  searchSessionTranscript,
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
  normalizePermissions,
  moveQueueCommand,
  loadTokenConfig,
  loadQueues,
  loadGroups,
  loadBookmarks,
  listTokens,
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
  getToolVersions,
  getSessionMessages,
  getSessionFilePatchHistory,
  getSessionActivity,
  getGraphqlSchema,
  getCodexUsageStats,
  getCodexLoginStatus,
  getCodexCliVersion,
  getChangedFiles,
  getBookmark,
  findSessionsByFile,
  findSession,
  findQueue,
  findLatestSession,
  findGroup,
  extractMarkdownTasks,
  extractFirstUserMessage,
  extractFileChangeDetails,
  extractChangedFiles,
  executeGraphqlOperation,
  executeGraphqlDocument,
  discoverRolloutPaths,
  deriveActivityEntry,
  deleteBookmark,
  createToken,
  createQueue,
  createMockCodexSessionRunner,
  checkCodexModelAvailability,
  buildSession,
  addSessionToGroup,
  addPrompt,
  addGroup,
  addBookmark,
  ToolRegistry,
  SessionRunner,
  STREAM_GRANULARITIES,
  SANDBOX_MODES,
  RunningSession,
  RolloutWatcher,
  QUEUE_PROMPT_STATUSES,
  QUEUE_COMMAND_MODES,
  ProcessManager,
  PERMISSIONS,
  MockCodexSessionRunner,
  MockCodexRunningSession,
  DEFAULT_TOKEN_PERMISSIONS,
  BasicSdkEventEmitter,
  BOOKMARK_TYPES,
  APPROVAL_MODES,
  ALL_PERMISSIONS
};
