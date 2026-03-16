import {
  GraphQLBoolean,
  GraphQLError,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  Kind,
  execute,
  getOperationAST,
  parse,
  subscribe,
  validate,
  type ExecutionResult,
  type ValueNode,
} from "graphql";
import { findSession, listSessions } from "../session/index";
import { searchSessionTranscript, searchSessions } from "../session/search";
import {
  addGroup,
  addSessionToGroup,
  findGroup,
  listGroups,
  pauseGroup,
  removeGroup,
  removeSessionFromGroup,
  resumeGroup,
  runGroup,
} from "../group/index";
import {
  addPrompt,
  createQueue,
  findQueue,
  listQueues,
  moveQueueCommand,
  pauseQueue,
  removeQueue,
  removeQueueCommand,
  resumeQueue,
  runQueue,
  toggleQueueCommandMode,
  updateQueueCommand,
} from "../queue/index";
import {
  addBookmark,
  deleteBookmark,
  getBookmark,
  listBookmarks,
  searchBookmarks,
} from "../bookmark/index";
import {
  createToken,
  hasPermission,
  listTokens,
  normalizePermissions,
  revokeToken,
  rotateToken,
} from "../auth/index";
import {
  findSessionsByFile,
  getChangedFiles,
  getSessionFilePatchHistory,
  rebuildFileIndex,
} from "../file-changes/index";
import { startDaemon, stopDaemon, getDaemonStatus } from "../daemon/index";
import { RolloutWatcher } from "../rollout/index";
import { ProcessManager } from "../process/index";
import { getToolVersions } from "../sdk/index";
import type { ServerHandle } from "../server/types";
import { resolveServerConfig } from "../server/types";
import type {
  ApprovalMode,
  CodexProcessOptions,
  SandboxMode,
  StreamGranularity,
} from "../process/types";
import type { Permission } from "../auth/index";
import type { AuthContext } from "../server/auth";

export interface GraphqlExecutionContext {
  readonly codexHome?: string | undefined;
  readonly configDir?: string | undefined;
  readonly authContext?: AuthContext | undefined;
  readonly serverMode?: boolean | undefined;
}

export interface GraphqlExecutionRequest {
  readonly document: string;
  readonly variables?: Readonly<Record<string, unknown>> | undefined;
  readonly context?: GraphqlExecutionContext | undefined;
}

interface CommandContext extends GraphqlExecutionContext {}

interface RecordLike {
  readonly [key: string]: unknown;
}

export type GraphqlOperationResult =
  | ExecutionResult
  | AsyncIterable<ExecutionResult>;

const JSON_SCALAR = new GraphQLScalarType({
  name: "JSON",
  serialize(value: unknown): unknown {
    return value;
  },
  parseValue(value: unknown): unknown {
    return value;
  },
  parseLiteral(ast: ValueNode): unknown {
    return parseJsonLiteral(ast);
  },
});

const QUERY_TYPE = new GraphQLObjectType<CommandContext>({
  name: "Query",
  fields: {
    command: {
      type: new GraphQLNonNull(JSON_SCALAR),
      args: {
        name: { type: new GraphQLNonNull(GraphQLString) },
        params: { type: JSON_SCALAR },
      },
      async resolve(_source, args, context) {
        return executeCommand(args.name, args.params, context);
      },
    },
    ping: {
      type: new GraphQLNonNull(GraphQLBoolean),
      resolve() {
        return true;
      },
    },
  },
});

const MUTATION_TYPE = new GraphQLObjectType<CommandContext>({
  name: "Mutation",
  fields: {
    command: {
      type: new GraphQLNonNull(JSON_SCALAR),
      args: {
        name: { type: new GraphQLNonNull(GraphQLString) },
        params: { type: JSON_SCALAR },
      },
      async resolve(_source, args, context) {
        return executeCommand(args.name, args.params, context);
      },
    },
  },
});

const SUBSCRIPTION_TYPE = new GraphQLObjectType<CommandContext>({
  name: "Subscription",
  fields: {
    command: {
      type: new GraphQLNonNull(JSON_SCALAR),
      args: {
        name: { type: new GraphQLNonNull(GraphQLString) },
        params: { type: JSON_SCALAR },
      },
      async subscribe(_source, args, context) {
        return subscribeCommand(args.name, args.params, context);
      },
      resolve(payload) {
        return payload;
      },
    },
  },
});

const SCHEMA = new GraphQLSchema({
  query: QUERY_TYPE,
  mutation: MUTATION_TYPE,
  subscription: SUBSCRIPTION_TYPE,
});

export function getGraphqlSchema(): GraphQLSchema {
  return SCHEMA;
}

const activeServerHandles = new Set<ServerHandle>();
let hasServerShutdownHooks = false;

function ensureServerShutdownHooks(): void {
  if (hasServerShutdownHooks) {
    return;
  }

  const shutdown = (): void => {
    for (const handle of activeServerHandles) {
      try {
        handle.stop();
      } catch {
        // Best-effort cleanup during process shutdown.
      }
    }
    activeServerHandles.clear();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  hasServerShutdownHooks = true;
}

function trackServerHandle(handle: ServerHandle): void {
  activeServerHandles.add(handle);
  ensureServerShutdownHooks();
}

function toErrorResult(error: GraphQLError): ExecutionResult {
  return {
    errors: [error],
  };
}

export async function executeGraphqlOperation(
  request: GraphqlExecutionRequest,
): Promise<GraphqlOperationResult> {
  let document;
  try {
    document = parse(request.document);
  } catch (error: unknown) {
    return toErrorResult(
      error instanceof GraphQLError ? error : new GraphQLError(String(error)),
    );
  }

  const validationErrors = validate(SCHEMA, document);
  if (validationErrors.length > 0) {
    return {
      errors: validationErrors,
    };
  }

  const operation = getOperationAST(document);
  if (operation?.operation === "subscription") {
    return subscribe({
      schema: SCHEMA,
      document,
      variableValues: request.variables,
      contextValue: request.context ?? {},
    });
  }

  return execute({
    schema: SCHEMA,
    document,
    variableValues: request.variables,
    contextValue: request.context ?? {},
  });
}

export async function executeGraphqlDocument(
  request: GraphqlExecutionRequest,
): Promise<ExecutionResult> {
  const result = await executeGraphqlOperation(request);
  if (isAsyncIterable(result)) {
    throw new GraphQLError(
      "Subscriptions must be executed with executeGraphqlOperation",
    );
  }
  return result;
}

async function executeCommand(
  name: string,
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  assertCommandAvailable(name, context);
  assertPermission(name, context.authContext);

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
    case "daemon.start":
      return handleDaemonStart(params, context);
    case "daemon.stop":
      return stopDaemon(context.configDir);
    case "daemon.status":
      return getDaemonStatus(context.configDir);
    case "server.start":
      return handleServerStart(params, context);
    default:
      throw new GraphQLError(`Unknown GraphQL command: ${name}`);
  }
}

async function subscribeCommand(
  name: string,
  params: unknown,
  context: CommandContext,
): Promise<AsyncIterable<unknown>> {
  assertCommandAvailable(name, context);
  assertPermission(name, context.authContext);

  switch (name) {
    case "session.watch":
      return handleSessionWatch(params, context);
    default:
      throw new GraphQLError(
        `Unsupported GraphQL subscription command: ${name}`,
      );
  }
}

function assertCommandAvailable(name: string, context: CommandContext): void {
  if (!context.serverMode) {
    return;
  }

  if (SERVER_EXPOSED_COMMANDS.has(name)) {
    return;
  }

  throw new GraphQLError(
    `Command is not available over the GraphQL server: ${name}`,
  );
}

function assertPermission(
  name: string,
  authContext: AuthContext | undefined,
): void {
  const required = requiredPermissionForCommand(name);
  if (required === undefined || authContext === undefined) {
    return;
  }
  if (!hasPermission(authContext.permissions, required)) {
    throw new GraphQLError(`Forbidden: missing permission ${required}`);
  }
}

function requiredPermissionForCommand(name: string): Permission | undefined {
  if (
    name === "session.list" ||
    name === "session.show" ||
    name === "session.search" ||
    name === "session.searchTranscript" ||
    name === "session.watch" ||
    name.startsWith("files.")
  ) {
    return "session:read";
  }
  if (
    name === "session.run" ||
    name === "session.resume" ||
    name === "session.fork"
  ) {
    return "session:create";
  }
  if (name.startsWith("group.")) {
    return "group:*";
  }
  if (name.startsWith("queue.")) {
    return "queue:*";
  }
  if (name.startsWith("bookmark.")) {
    return "bookmark:*";
  }
  return undefined;
}

const SERVER_EXPOSED_COMMANDS = new Set<string>([
  "version.get",
  "session.list",
  "session.show",
  "session.search",
  "session.searchTranscript",
  "session.watch",
  "session.run",
  "session.resume",
  "session.fork",
  "group.list",
  "group.create",
  "group.show",
  "group.add",
  "group.remove",
  "group.pause",
  "group.resume",
  "group.delete",
  "group.run",
  "queue.list",
  "queue.create",
  "queue.show",
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
  "bookmark.list",
  "bookmark.get",
  "bookmark.delete",
  "bookmark.search",
  "files.list",
  "files.patches",
  "files.find",
  "files.rebuild",
]);

function parseJsonLiteral(ast: ValueNode): unknown {
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
      return Object.fromEntries(
        ast.fields.map((field) => [
          field.name.value,
          parseJsonLiteral(field.value),
        ]),
      );
    default:
      return null;
  }
}

function toRecord(value: unknown, label = "params"): RecordLike {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GraphQLError(`${label} must be a JSON object`);
  }
  return value as RecordLike;
}

function readString(record: RecordLike, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(record: RecordLike, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readBoolean(record: RecordLike, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(
  record: RecordLike,
  key: string,
): readonly string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.some((entry) => typeof entry !== "string")) {
    throw new GraphQLError(`${key} must be a string array`);
  }
  return value as readonly string[];
}

function requireString(record: RecordLike, key: string): string {
  const value = readString(record, key);
  if (value === undefined || value.trim().length === 0) {
    throw new GraphQLError(`${key} is required`);
  }
  return value;
}

function requireNumber(record: RecordLike, key: string): number {
  const value = readNumber(record, key);
  if (value === undefined) {
    throw new GraphQLError(`${key} is required`);
  }
  return value;
}

function isSandboxMode(value: string): value is SandboxMode {
  return value === "full" || value === "network-only" || value === "none";
}

function isApprovalMode(value: string): value is ApprovalMode {
  return (
    value === "always" ||
    value === "unless-allow-listed" ||
    value === "never" ||
    value === "on-failure"
  );
}

function isStreamGranularity(value: string): value is StreamGranularity {
  return value === "event" || value === "char";
}

function readProcessOptions(record: RecordLike): CodexProcessOptions {
  const options: {
    model?: string;
    cwd?: string;
    sandbox?: SandboxMode;
    approvalMode?: ApprovalMode;
    fullAuto?: boolean;
    additionalArgs?: readonly string[];
    images?: readonly string[];
    configOverrides?: readonly string[];
    streamGranularity?: StreamGranularity;
    codexBinary?: string;
  } = {};
  const model = readString(record, "model");
  if (model !== undefined) options.model = model;
  const cwd = readString(record, "cwd");
  if (cwd !== undefined) options.cwd = cwd;
  const sandbox = readString(record, "sandbox");
  if (sandbox !== undefined) {
    if (!isSandboxMode(sandbox)) {
      throw new GraphQLError("sandbox must be full, network-only, or none");
    }
    options.sandbox = sandbox;
  }
  const approvalMode = readString(record, "approvalMode");
  if (approvalMode !== undefined) {
    if (!isApprovalMode(approvalMode)) {
      throw new GraphQLError(
        "approvalMode must be always, unless-allow-listed, never, or on-failure",
      );
    }
    options.approvalMode = approvalMode;
  }
  const fullAuto = readBoolean(record, "fullAuto");
  if (fullAuto !== undefined) options.fullAuto = fullAuto;
  const additionalArgs = readStringArray(record, "additionalArgs");
  if (additionalArgs !== undefined) options.additionalArgs = additionalArgs;
  const images = readStringArray(record, "images");
  if (images !== undefined) options.images = images;
  const configOverrides = readStringArray(record, "configOverrides");
  if (configOverrides !== undefined) options.configOverrides = configOverrides;
  const streamGranularity = readString(record, "streamGranularity");
  if (streamGranularity !== undefined) {
    if (!isStreamGranularity(streamGranularity)) {
      throw new GraphQLError("streamGranularity must be event or char");
    }
    options.streamGranularity = streamGranularity;
  }
  const codexBinary = readString(record, "codexBinary");
  if (codexBinary !== undefined) options.codexBinary = codexBinary;
  return options;
}

function extractSessionId(lines: readonly unknown[]): string | undefined {
  for (const line of lines) {
    if (typeof line !== "object" || line === null) {
      continue;
    }
    const record = line as RecordLike;
    if (record["type"] !== "session_meta") {
      continue;
    }
    const payload =
      typeof record["payload"] === "object" && record["payload"] !== null
        ? (record["payload"] as RecordLike)
        : null;
    const meta =
      payload !== null &&
      typeof payload["meta"] === "object" &&
      payload["meta"] !== null
        ? (payload["meta"] as RecordLike)
        : null;
    const id = meta === null ? undefined : readString(meta, "id");
    if (id !== undefined) {
      return id;
    }
  }
  return undefined;
}

async function collectItems<T>(
  iterable: AsyncIterable<T>,
): Promise<readonly T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

async function handleVersionGet(params: unknown): Promise<unknown> {
  const input = params === undefined ? {} : toRecord(params);
  return getToolVersions({
    includeGit: readBoolean(input, "includeGit") ?? false,
  });
}

async function handleSessionList(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = params === undefined ? {} : toRecord(params);
  const options: {
    limit?: number;
    offset?: number;
    source?: "cli" | "vscode" | "exec" | "unknown";
    cwd?: string;
    branch?: string;
    codexHome?: string;
  } = {};
  const limit = readNumber(input, "limit");
  if (limit !== undefined) options.limit = limit;
  const offset = readNumber(input, "offset");
  if (offset !== undefined) options.offset = offset;
  const source = readString(input, "source");
  if (
    source === "cli" ||
    source === "vscode" ||
    source === "exec" ||
    source === "unknown"
  ) {
    options.source = source;
  }
  const cwd = readString(input, "cwd");
  if (cwd !== undefined) options.cwd = cwd;
  const branch = readString(input, "branch");
  if (branch !== undefined) options.branch = branch;
  if (context.codexHome !== undefined) options.codexHome = context.codexHome;
  return listSessions(options);
}

async function handleSessionShow(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  const session = await findSession(
    requireString(input, "id"),
    context.codexHome,
  );
  if (session === null) {
    throw new GraphQLError("Session not found");
  }
  return session;
}

async function handleSessionSearch(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  const options: {
    limit?: number;
    offset?: number;
    source?: "cli" | "vscode" | "exec" | "unknown";
    cwd?: string;
    branch?: string;
    role?: "user" | "assistant" | "both";
    caseSensitive?: boolean;
    maxBytes?: number;
    maxEvents?: number;
    maxSessions?: number;
    timeoutMs?: number;
    codexHome?: string;
  } = {};
  const limit = readNumber(input, "limit");
  if (limit !== undefined) options.limit = limit;
  const offset = readNumber(input, "offset");
  if (offset !== undefined) options.offset = offset;
  const source = readString(input, "source");
  if (
    source === "cli" ||
    source === "vscode" ||
    source === "exec" ||
    source === "unknown"
  ) {
    options.source = source;
  }
  const cwd = readString(input, "cwd");
  if (cwd !== undefined) options.cwd = cwd;
  const branch = readString(input, "branch");
  if (branch !== undefined) options.branch = branch;
  const role = readString(input, "role");
  if (role === "user" || role === "assistant" || role === "both") {
    options.role = role;
  }
  const caseSensitive = readBoolean(input, "caseSensitive");
  if (caseSensitive !== undefined) options.caseSensitive = caseSensitive;
  const maxBytes = readNumber(input, "maxBytes");
  if (maxBytes !== undefined) options.maxBytes = maxBytes;
  const maxEvents = readNumber(input, "maxEvents");
  if (maxEvents !== undefined) options.maxEvents = maxEvents;
  const maxSessions = readNumber(input, "maxSessions");
  if (maxSessions !== undefined) options.maxSessions = maxSessions;
  const timeoutMs = readNumber(input, "timeoutMs");
  if (timeoutMs !== undefined) options.timeoutMs = timeoutMs;
  if (context.codexHome !== undefined) options.codexHome = context.codexHome;
  return searchSessions(requireString(input, "query"), options);
}

async function handleSessionSearchTranscript(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  const options: {
    role?: "user" | "assistant" | "both";
    caseSensitive?: boolean;
    maxBytes?: number;
    maxEvents?: number;
    timeoutMs?: number;
    codexHome?: string;
  } = {};
  const role = readString(input, "role");
  if (role === "user" || role === "assistant" || role === "both") {
    options.role = role;
  }
  const caseSensitive = readBoolean(input, "caseSensitive");
  if (caseSensitive !== undefined) options.caseSensitive = caseSensitive;
  const maxBytes = readNumber(input, "maxBytes");
  if (maxBytes !== undefined) options.maxBytes = maxBytes;
  const maxEvents = readNumber(input, "maxEvents");
  if (maxEvents !== undefined) options.maxEvents = maxEvents;
  const timeoutMs = readNumber(input, "timeoutMs");
  if (timeoutMs !== undefined) options.timeoutMs = timeoutMs;
  if (context.codexHome !== undefined) options.codexHome = context.codexHome;
  return searchSessionTranscript(
    requireString(input, "id"),
    requireString(input, "query"),
    options,
  );
}

async function handleSessionRun(params: unknown): Promise<unknown> {
  const input = toRecord(params);
  const prompt = requireString(input, "prompt");
  const pm = new ProcessManager(readProcessOptions(input).codexBinary);
  const result = await pm.spawnExec(prompt, readProcessOptions(input));
  return {
    sessionId: extractSessionId(result.lines),
    exitCode: result.exitCode,
    lines: result.lines,
  };
}

async function handleSessionResume(params: unknown): Promise<unknown> {
  const input = toRecord(params);
  const pm = new ProcessManager(readProcessOptions(input).codexBinary);
  return pm.spawnResume(
    requireString(input, "id"),
    readProcessOptions(input),
    readString(input, "prompt"),
  );
}

async function handleSessionFork(params: unknown): Promise<unknown> {
  const input = toRecord(params);
  const pm = new ProcessManager(readProcessOptions(input).codexBinary);
  return pm.spawnFork(
    requireString(input, "id"),
    readNumber(input, "nthMessage"),
    readProcessOptions(input),
  );
}

async function handleSessionWatch(
  params: unknown,
  context: CommandContext,
): Promise<AsyncIterable<unknown>> {
  const input = toRecord(params);
  const session = await findSession(
    requireString(input, "id"),
    context.codexHome,
  );
  if (session === null) {
    throw new GraphQLError("Session not found");
  }

  const startOffset = readNumber(input, "startOffset");
  return createWatchStream(session.rolloutPath, startOffset);
}

async function handleGroupCreate(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  return addGroup(
    requireString(input, "name"),
    readString(input, "description"),
    context.configDir,
  );
}

async function handleGroupShow(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  const group = await findGroup(requireString(input, "id"), context.configDir);
  if (group === null) {
    throw new GraphQLError("Group not found");
  }
  return group;
}

async function handleGroupAdd(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  const group = await findGroup(requireString(input, "id"), context.configDir);
  if (group === null) {
    throw new GraphQLError("Group not found");
  }
  await addSessionToGroup(
    group.id,
    requireString(input, "sessionId"),
    context.configDir,
  );
  return { ok: true };
}

async function handleGroupRemove(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  const group = await findGroup(requireString(input, "id"), context.configDir);
  if (group === null) {
    throw new GraphQLError("Group not found");
  }
  await removeSessionFromGroup(
    group.id,
    requireString(input, "sessionId"),
    context.configDir,
  );
  return { ok: true };
}

async function handleGroupPause(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const ok = await pauseGroup(
    requireString(toRecord(params), "id"),
    context.configDir,
  );
  if (!ok) {
    throw new GraphQLError("Group not found");
  }
  return { ok: true };
}

async function handleGroupResume(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const ok = await resumeGroup(
    requireString(toRecord(params), "id"),
    context.configDir,
  );
  if (!ok) {
    throw new GraphQLError("Group not found");
  }
  return { ok: true };
}

async function handleGroupDelete(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const ok = await removeGroup(
    requireString(toRecord(params), "id"),
    context.configDir,
  );
  if (!ok) {
    throw new GraphQLError("Group not found");
  }
  return { ok: true };
}

async function handleGroupRun(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  const group = await findGroup(requireString(input, "id"), context.configDir);
  if (group === null) {
    throw new GraphQLError("Group not found");
  }
  return collectItems(
    runGroup(group, requireString(input, "prompt"), {
      ...readProcessOptions(input),
      maxConcurrent: readNumber(input, "maxConcurrent"),
    }),
  );
}

async function handleQueueCreate(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  return createQueue(
    requireString(input, "name"),
    requireString(input, "projectPath"),
    context.configDir,
  );
}

async function handleQueueShow(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const queue = await findQueue(
    requireString(toRecord(params), "id"),
    context.configDir,
  );
  if (queue === null) {
    throw new GraphQLError("Queue not found");
  }
  return queue;
}

async function handleQueueAdd(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  const queue = await findQueue(requireString(input, "id"), context.configDir);
  if (queue === null) {
    throw new GraphQLError("Queue not found");
  }
  return addPrompt(
    queue.id,
    requireString(input, "prompt"),
    readStringArray(input, "images"),
    context.configDir,
  );
}

async function handleQueuePause(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const ok = await pauseQueue(
    requireString(toRecord(params), "id"),
    context.configDir,
  );
  if (!ok) {
    throw new GraphQLError("Queue not found");
  }
  return { ok: true };
}

async function handleQueueResume(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const ok = await resumeQueue(
    requireString(toRecord(params), "id"),
    context.configDir,
  );
  if (!ok) {
    throw new GraphQLError("Queue not found");
  }
  return { ok: true };
}

async function handleQueueDelete(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const ok = await removeQueue(
    requireString(toRecord(params), "id"),
    context.configDir,
  );
  if (!ok) {
    throw new GraphQLError("Queue not found");
  }
  return { ok: true };
}

async function handleQueueUpdate(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  const ok = await updateQueueCommand(
    requireString(input, "id"),
    requireString(input, "commandId"),
    {
      prompt: readString(input, "prompt"),
      status: readString(input, "status") as
        | "pending"
        | "running"
        | "completed"
        | "failed"
        | undefined,
    },
    context.configDir,
  );
  if (!ok) {
    throw new GraphQLError("Queue command not found");
  }
  return { ok: true };
}

async function handleQueueRemove(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  const ok = await removeQueueCommand(
    requireString(input, "id"),
    requireString(input, "commandId"),
    context.configDir,
  );
  if (!ok) {
    throw new GraphQLError("Queue command not found");
  }
  return { ok: true };
}

async function handleQueueMove(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  const ok = await moveQueueCommand(
    requireString(input, "id"),
    requireNumber(input, "from"),
    requireNumber(input, "to"),
    context.configDir,
  );
  if (!ok) {
    throw new GraphQLError("Queue or command position not found");
  }
  return { ok: true };
}

async function handleQueueMode(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  const mode = requireString(input, "mode");
  if (mode !== "auto" && mode !== "manual") {
    throw new GraphQLError("mode must be auto or manual");
  }
  const ok = await toggleQueueCommandMode(
    requireString(input, "id"),
    requireString(input, "commandId"),
    mode,
    context.configDir,
  );
  if (!ok) {
    throw new GraphQLError("Queue command not found");
  }
  return { ok: true };
}

async function handleQueueRun(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  const queue = await findQueue(requireString(input, "id"), context.configDir);
  if (queue === null) {
    throw new GraphQLError("Queue not found");
  }
  const options: CodexProcessOptions & { configDir?: string } = {
    ...readProcessOptions(input),
  };
  if (context.configDir !== undefined) {
    options.configDir = context.configDir;
  }
  return collectItems(runQueue(queue, options, { stopped: false }));
}

async function handleBookmarkAdd(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  return addBookmark(
    {
      type: requireString(input, "type") as "session" | "message" | "range",
      sessionId: requireString(input, "sessionId"),
      name: requireString(input, "name"),
      description: readString(input, "description"),
      tags: readStringArray(input, "tags"),
      messageId: readString(input, "messageId"),
      fromMessageId: readString(input, "fromMessageId"),
      toMessageId: readString(input, "toMessageId"),
    },
    context.configDir,
  );
}

async function handleBookmarkList(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = params === undefined ? {} : toRecord(params);
  return listBookmarks(
    {
      sessionId: readString(input, "sessionId"),
      type: readString(input, "type") as
        | "session"
        | "message"
        | "range"
        | undefined,
      tag: readString(input, "tag"),
    },
    context.configDir,
  );
}

async function handleBookmarkGet(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const bookmark = await getBookmark(
    requireString(toRecord(params), "id"),
    context.configDir,
  );
  if (bookmark === null) {
    throw new GraphQLError("Bookmark not found");
  }
  return bookmark;
}

async function handleBookmarkDelete(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const ok = await deleteBookmark(
    requireString(toRecord(params), "id"),
    context.configDir,
  );
  if (!ok) {
    throw new GraphQLError("Bookmark not found");
  }
  return { ok: true };
}

async function handleBookmarkSearch(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  return searchBookmarks(
    requireString(input, "query"),
    { limit: readNumber(input, "limit") },
    context.configDir,
  );
}

async function handleTokenCreate(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  const rawPermissions = readStringArray(input, "permissions");
  const permissions =
    rawPermissions === undefined
      ? (["session:read"] satisfies readonly Permission[])
      : normalizePermissions(rawPermissions);
  if (permissions.length === 0) {
    throw new GraphQLError(
      "permissions must include at least one valid permission",
    );
  }
  return createToken(
    {
      name: requireString(input, "name"),
      permissions,
      expiresAt: readString(input, "expiresAt"),
    },
    context.configDir,
  );
}

async function handleTokenRevoke(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  return revokeToken(requireString(toRecord(params), "id"), context.configDir);
}

async function handleTokenRotate(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  return rotateToken(requireString(toRecord(params), "id"), context.configDir);
}

async function handleFilesList(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  return getChangedFiles(requireString(toRecord(params), "sessionId"), {
    configDir: context.configDir,
    codexHome: context.codexHome,
  });
}

async function handleFilesPatches(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  return getSessionFilePatchHistory(
    requireString(toRecord(params), "sessionId"),
    {
      configDir: context.configDir,
      codexHome: context.codexHome,
    },
  );
}

async function handleFilesFind(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = toRecord(params);
  return findSessionsByFile(requireString(input, "path"), {
    configDir: context.configDir,
    codexHome: context.codexHome,
  });
}

async function handleDaemonStart(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = params === undefined ? {} : toRecord(params);
  return startDaemon({
    port: readNumber(input, "port"),
    host: readString(input, "host"),
    token: readString(input, "token"),
    mode: readString(input, "mode") as "http" | "app-server" | undefined,
    appServerUrl: readString(input, "appServerUrl"),
    configDir: context.configDir,
  });
}

async function handleServerStart(
  params: unknown,
  context: CommandContext,
): Promise<unknown> {
  const input = params === undefined ? {} : toRecord(params);
  const transport = readString(input, "transport");
  if (
    transport !== undefined &&
    transport !== "local-cli" &&
    transport !== "app-server"
  ) {
    throw new GraphQLError("transport must be local-cli or app-server");
  }

  const overrides: Partial<{
    port: number;
    hostname: string;
    token: string;
    transport: "local-cli" | "app-server";
    appServerUrl: string;
    codexHome: string;
    configDir: string;
  }> = {};
  const port = readNumber(input, "port");
  if (port !== undefined) overrides.port = port;
  const hostname = readString(input, "hostname");
  if (hostname !== undefined) overrides.hostname = hostname;
  const token = readString(input, "token");
  if (token !== undefined) overrides.token = token;
  if (transport !== undefined) overrides.transport = transport;
  const appServerUrl = readString(input, "appServerUrl");
  if (appServerUrl !== undefined) overrides.appServerUrl = appServerUrl;
  if (context.codexHome !== undefined) overrides.codexHome = context.codexHome;
  if (context.configDir !== undefined) overrides.configDir = context.configDir;

  const config = resolveServerConfig(overrides);
  const { startServer } = await import("../server/index");
  const handle = startServer(config);
  trackServerHandle(handle);
  return {
    hostname: handle.hostname,
    port: handle.port,
    startedAt: handle.startedAt.toISOString(),
    transport: config.transport,
    appServerUrl: config.appServerUrl,
  };
}

function isAsyncIterable<T>(
  value: T | AsyncIterable<T>,
): value is AsyncIterable<T> {
  return (
    typeof value === "object" && value !== null && Symbol.asyncIterator in value
  );
}

async function* createWatchStream(
  rolloutPath: string,
  startOffset?: number,
): AsyncGenerator<unknown, void, undefined> {
  const watcher = new RolloutWatcher();
  const queue: unknown[] = [];
  let failure: Error | null = null;
  let resolveNext: (() => void) | null = null;

  const wake = (): void => {
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

  await watcher.watchFile(
    rolloutPath,
    startOffset === undefined ? undefined : { startOffset },
  );

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

      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
    }
  } finally {
    watcher.stop();
    wake();
  }
}
