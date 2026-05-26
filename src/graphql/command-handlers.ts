import { GraphQLError } from "graphql";
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
  QUEUE_COMMAND_MODES,
  QUEUE_PROMPT_STATUSES,
  removeQueue,
  removeQueueCommand,
  resumeQueue,
  runQueue,
  toggleQueueCommandMode,
  updateQueueCommand,
} from "../queue/index";
import {
  addBookmark,
  BOOKMARK_TYPES,
  deleteBookmark,
  getBookmark,
  listBookmarks,
  searchBookmarks,
} from "../bookmark/index";
import {
  createToken,
  DEFAULT_TOKEN_PERMISSIONS,
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
import { RolloutWatcher } from "../rollout/index";
import { ProcessManager } from "../process/index";
import { getToolVersions } from "../sdk/index";
import type { CodexProcessOptions } from "../process/types";
import type { GraphqlExecutionContext } from "./types";
import {
  extractSessionId,
  readBoolean,
  readNumber,
  readProcessOptions,
  readString,
  readStringArray,
  readStringUnion,
  requireNumber,
  requireString,
  requireStringUnion,
  toRecord,
} from "./params";

export async function executeCommand(
  name: string,
  params: unknown,
  context: GraphqlExecutionContext,
): Promise<unknown> {
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

export async function subscribeCommand(
  name: string,
  params: unknown,
  context: GraphqlExecutionContext,
): Promise<AsyncIterable<unknown>> {
  switch (name) {
    case "session.watch":
      return handleSessionWatch(params, context);
    default:
      throw new GraphQLError(
        `Unsupported GraphQL subscription command: ${name}`,
      );
  }
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  const options = readProcessOptions(input);
  const pm = new ProcessManager(options.codexBinary);
  const result = await pm.spawnExec(prompt, options);
  return {
    sessionId: extractSessionId(result.lines),
    exitCode: result.exitCode,
    lines: result.lines,
  };
}

async function handleSessionResume(params: unknown): Promise<unknown> {
  const input = toRecord(params);
  const options = readProcessOptions(input);
  const pm = new ProcessManager(options.codexBinary);
  return pm.spawnResume(
    requireString(input, "id"),
    options,
    readString(input, "prompt"),
  );
}

async function handleSessionFork(params: unknown): Promise<unknown> {
  const input = toRecord(params);
  const options = readProcessOptions(input);
  const pm = new ProcessManager(options.codexBinary);
  return pm.spawnFork(
    requireString(input, "id"),
    readNumber(input, "nthMessage"),
    options,
  );
}

async function handleSessionWatch(
  params: unknown,
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
): Promise<unknown> {
  const input = toRecord(params);
  const ok = await updateQueueCommand(
    requireString(input, "id"),
    requireString(input, "commandId"),
    {
      prompt: readString(input, "prompt"),
      status: readStringUnion(input, "status", QUEUE_PROMPT_STATUSES),
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
): Promise<unknown> {
  const input = toRecord(params);
  const mode = requireStringUnion(input, "mode", QUEUE_COMMAND_MODES);
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
): Promise<unknown> {
  const input = toRecord(params);
  return addBookmark(
    {
      type: requireStringUnion(input, "type", BOOKMARK_TYPES),
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
  context: GraphqlExecutionContext,
): Promise<unknown> {
  const input = params === undefined ? {} : toRecord(params);
  return listBookmarks(
    {
      sessionId: readString(input, "sessionId"),
      type: readStringUnion(input, "type", BOOKMARK_TYPES),
      tag: readString(input, "tag"),
    },
    context.configDir,
  );
}

async function handleBookmarkGet(
  params: unknown,
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
): Promise<unknown> {
  const input = toRecord(params);
  const rawPermissions = readStringArray(input, "permissions");
  const permissions =
    rawPermissions === undefined
      ? DEFAULT_TOKEN_PERMISSIONS
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
  context: GraphqlExecutionContext,
): Promise<unknown> {
  return revokeToken(requireString(toRecord(params), "id"), context.configDir);
}

async function handleTokenRotate(
  params: unknown,
  context: GraphqlExecutionContext,
): Promise<unknown> {
  return rotateToken(requireString(toRecord(params), "id"), context.configDir);
}

async function handleFilesList(
  params: unknown,
  context: GraphqlExecutionContext,
): Promise<unknown> {
  return getChangedFiles(requireString(toRecord(params), "sessionId"), {
    configDir: context.configDir,
    codexHome: context.codexHome,
  });
}

async function handleFilesPatches(
  params: unknown,
  context: GraphqlExecutionContext,
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
  context: GraphqlExecutionContext,
): Promise<unknown> {
  const input = toRecord(params);
  return findSessionsByFile(requireString(input, "path"), {
    configDir: context.configDir,
    codexHome: context.codexHome,
  });
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
