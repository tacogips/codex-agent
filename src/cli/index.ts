/**
 * CLI entry point for codex-agent.
 *
 * Subcommands:
 *   session list [--source S] [--cwd P] [--branch B] [--format json|table]
 *   session show <id> [--tasks]
 *   session watch <id>
 *   session resume <id> [--model M] [--sandbox S] [--full-auto]
 *   session fork <id> [--nth-message N] [--model M] [--sandbox S] [--full-auto]
 *
 *   group create <name> [--description D]
 *   group list [--format json|table]
 *   group show <group>
 *   group add <group> <session>
 *   group remove <group> <session>
 *   group pause <group>
 *   group resume <group>
 *   group delete <group>
 *   group run <name> --prompt <P> [--max-concurrent N] [--model M] [--image FILE]...
 *
 *   bookmark add --type <session|message|range> --session <id> --name <name> [options]
 *   bookmark list [--format json|table] [--session <id>] [--type <type>] [--tag <tag>]
 *   bookmark get <id>
 *   bookmark delete <id>
 *   bookmark search <query> [--limit <n>] [--format json|table]
 *
 *   token create --name <name> [--permissions <csv>] [--expires-at <iso8601>]
 *   token list [--format json|table]
 *   token revoke <id>
 *   token rotate <id>
 *
 *   files list <session-id> [--format json|table]
 *   files find <path> [--format json|table]
 *   files rebuild
 *
 *   queue create <name> --project <path>
 *   queue add <name> --prompt <prompt> [--image FILE]...
 *   queue show <name>
 *   queue list [--format json|table]
 *   queue pause <name>
 *   queue resume <name>
 *   queue delete <name>
 *   queue update <name> <command-id> [--prompt <text>] [--status <status>]
 *   queue remove <name> <command-id>
 *   queue move <name> --from <n> --to <n>
 *   queue mode <name> <command-id> --mode <auto|manual>
 *   queue run <name> [--model M] [--sandbox S] [--full-auto] [--image FILE]...
 *
 *   server start [--port N] [--host H] [--token T] [--transport local-cli|app-server] [--app-server-url ws://...]
 *
 *   daemon start [--port N] [--host H] [--token T] [--mode http|app-server] [--app-server-url ws://...]
 *   daemon stop
 *   daemon status
 */

import {
  listSessions,
  findSession,
} from "../session/index";
import { readRollout } from "../rollout/reader";
import { RolloutWatcher } from "../rollout/watcher";
import { ProcessManager } from "../process/manager";
import {
  addGroup,
  findGroup,
  listGroups,
  addSessionToGroup,
  removeSessionFromGroup,
  pauseGroup,
  resumeGroup,
  removeGroup,
  runGroup,
} from "../group/index";
import {
  createQueue,
  addPrompt,
  findQueue,
  listQueues,
  runQueue,
  pauseQueue,
  resumeQueue,
  removeQueue,
  updateQueueCommand,
  removeQueueCommand,
  moveQueueCommand,
  toggleQueueCommandMode,
} from "../queue/index";
import {
  addBookmark,
  listBookmarks,
  getBookmark,
  deleteBookmark,
  searchBookmarks,
  isBookmarkType,
} from "../bookmark/index";
import {
  PERMISSIONS,
  createToken,
  listTokens,
  revokeToken,
  rotateToken,
  parsePermissionList,
} from "../auth/index";
import {
  getChangedFiles,
  findSessionsByFile,
  rebuildFileIndex,
} from "../file-changes/index";
import { startServer } from "../server/server";
import { resolveServerConfig } from "../server/types";
import { startDaemon, stopDaemon, getDaemonStatus } from "../daemon/manager";
import {
  formatSessionTable,
  formatSessionDetail,
  formatSessionsJson,
  formatRolloutLine,
} from "./format";
import { extractMarkdownTasks } from "../markdown/parser";
import type { SessionSource } from "../types/rollout";
import type { CodexProcessOptions, SandboxMode, ApprovalMode } from "../process/types";
import type { DaemonConfig } from "../daemon/types";
import type { ServerConfig } from "../server/types";
import type { BookmarkType } from "../bookmark/types";

const USAGE = `codex-agent - Codex session manager

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

export async function run(argv: readonly string[]): Promise<void> {
  const args = argv.slice(2); // skip node and script path

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

// ---------------------------------------------------------------------------
// Session commands
// ---------------------------------------------------------------------------

async function handleSession(
  action: string | undefined,
  args: readonly string[],
): Promise<void> {
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

async function handleSessionList(args: readonly string[]): Promise<void> {
  const opts = parseListArgs(args);

  const result = await listSessions({
    source: opts.source,
    cwd: opts.cwd,
    branch: opts.branch,
    limit: opts.limit,
  });

  if (opts.format === "json") {
    console.log(formatSessionsJson(result.sessions));
  } else {
    console.log(formatSessionTable(result.sessions));
    if (result.total > result.sessions.length) {
      console.log(`\nShowing ${result.sessions.length} of ${result.total} sessions`);
    }
  }
}

async function handleSessionShow(args: readonly string[]): Promise<void> {
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

  // Show recent events
  const lines = await readRollout(session.rolloutPath);
  if (lines.length > 1) {
    console.log(`\nEvents (${lines.length} total):`);
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

async function handleSessionWatch(args: readonly string[]): Promise<void> {
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
  console.log("\nWatching for updates... (Ctrl+C to stop)\n");

  const watcher = new RolloutWatcher();

  watcher.on("line", (_path, line) => {
    console.log(formatRolloutLine(line));
  });

  watcher.on("error", (err) => {
    console.error(`Watch error: ${err.message}`);
  });

  await watcher.watchFile(session.rolloutPath);

  // Keep alive until SIGINT
  await new Promise<void>((resolve) => {
    const handler = (): void => {
      watcher.stop();
      resolve();
    };
    process.on("SIGINT", handler);
    process.on("SIGTERM", handler);
  });
}

async function handleSessionResume(args: readonly string[]): Promise<void> {
  const id = args[0];
  if (id === undefined) {
    console.error("Usage: codex-agent session resume <id>");
    process.exitCode = 1;
    return;
  }

  const opts = parseProcessOptions(args.slice(1));
  const pm = new ProcessManager();
  const proc = pm.spawnResume(id, opts);
  console.log(`Resuming session ${id} (pid: ${proc.pid})`);
}

async function handleSessionFork(args: readonly string[]): Promise<void> {
  const id = args[0];
  if (id === undefined) {
    console.error("Usage: codex-agent session fork <id> [--nth-message N]");
    process.exitCode = 1;
    return;
  }

  const nthMessage = getArgValue(args, "--nth-message");
  const nth = nthMessage !== undefined ? parseInt(nthMessage, 10) : undefined;
  const opts = parseProcessOptions(args.slice(1));
  const pm = new ProcessManager();
  const proc = pm.spawnFork(id, nth, opts);
  console.log(`Forking session ${id} (pid: ${proc.pid})`);
}

// ---------------------------------------------------------------------------
// Group commands
// ---------------------------------------------------------------------------

async function handleGroup(
  action: string | undefined,
  args: readonly string[],
): Promise<void> {
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

async function handleGroupCreate(args: readonly string[]): Promise<void> {
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

async function handleGroupList(args: readonly string[]): Promise<void> {
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

  // Table format
  const rows = groups.map((g) => ({
    id: g.id.slice(0, 8),
    name: g.name,
    sessions: String(g.sessionIds.length),
    created: g.createdAt.toISOString().slice(0, 19).replace("T", " "),
  }));

  const headers = { id: "ID", name: "NAME", sessions: "SESSIONS", created: "CREATED" };
  const cols = Object.keys(headers) as (keyof typeof headers)[];
  const widths = Object.fromEntries(
    cols.map((col) => [col, Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)]),
  );
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join("\n"));
}

async function handleGroupShow(args: readonly string[]): Promise<void> {
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

async function handleGroupAdd(args: readonly string[]): Promise<void> {
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

async function handleGroupRemove(args: readonly string[]): Promise<void> {
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

async function handleGroupPause(args: readonly string[]): Promise<void> {
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

async function handleGroupResume(args: readonly string[]): Promise<void> {
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

async function handleGroupDelete(args: readonly string[]): Promise<void> {
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

async function handleGroupRun(args: readonly string[]): Promise<void> {
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
        console.log(`\nGroup run complete: ${event.completed.length} completed, ${event.failed.length} failed`);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Bookmark commands
// ---------------------------------------------------------------------------

async function handleBookmark(
  action: string | undefined,
  args: readonly string[],
): Promise<void> {
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

async function handleBookmarkAdd(args: readonly string[]): Promise<void> {
  const typeValue = getArgValue(args, "--type");
  const sessionId = getArgValue(args, "--session");
  const name = getArgValue(args, "--name");
  const description = getArgValue(args, "--description");
  const tags = getArgValues(args, "--tag");
  const messageId = getArgValue(args, "--message");
  const fromMessageId = getArgValue(args, "--from");
  const toMessageId = getArgValue(args, "--to");

  if (typeValue === undefined || sessionId === undefined || name === undefined) {
    console.error(
      "Usage: codex-agent bookmark add --type <session|message|range> --session <id> --name <name> [--description <text>] [--tag <tag>] [--message <id>] [--from <id>] [--to <id>]",
    );
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
      toMessageId,
    });
    console.log(`Bookmark created: ${bookmark.name} (${bookmark.id})`);
  } catch (err: unknown) {
    console.error(
      `Failed to add bookmark: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
}

async function handleBookmarkList(args: readonly string[]): Promise<void> {
  const format = getArgValue(args, "--format") ?? "table";
  const typeArg = getArgValue(args, "--type");
  const sessionId = getArgValue(args, "--session");
  const tag = getArgValue(args, "--tag");
  let type: BookmarkType | undefined;
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
    tags: bookmark.tags.join(","),
  }));

  const headers = { id: "ID", type: "TYPE", session: "SESSION", name: "NAME", tags: "TAGS" };
  const cols = Object.keys(headers) as (keyof typeof headers)[];
  const widths = Object.fromEntries(
    cols.map((col) => [col, Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)]),
  );
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join("\n"));
}

async function handleBookmarkGet(args: readonly string[]): Promise<void> {
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

async function handleBookmarkDelete(args: readonly string[]): Promise<void> {
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

async function handleBookmarkSearch(args: readonly string[]): Promise<void> {
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
    name:
      result.bookmark.name.length > 28
        ? result.bookmark.name.slice(0, 25) + "..."
        : result.bookmark.name,
  }));
  const headers = { score: "SCORE", id: "ID", type: "TYPE", name: "NAME" };
  const cols = Object.keys(headers) as (keyof typeof headers)[];
  const widths = Object.fromEntries(
    cols.map((col) => [col, Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)]),
  );
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join("\n"));
}

// ---------------------------------------------------------------------------
// File-change commands
// ---------------------------------------------------------------------------

async function handleFiles(
  action: string | undefined,
  args: readonly string[],
): Promise<void> {
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

async function handleFilesList(args: readonly string[]): Promise<void> {
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
      last: file.lastModified,
    }));
    const headers = { path: "PATH", op: "OP", count: "COUNT", last: "LAST_MODIFIED" };
    const cols = Object.keys(headers) as (keyof typeof headers)[];
    const widths = Object.fromEntries(
      cols.map((col) => [col, Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)]),
    );
    const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
    const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
    const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
    console.log([headerLine, separator, ...dataLines].join("\n"));
  } catch (err: unknown) {
    console.error(`Failed to list file changes: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

async function handleFilesFind(args: readonly string[]): Promise<void> {
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
    last: entry.lastModified,
  }));
  const headers = { session: "SESSION", operation: "OP", last: "LAST_MODIFIED" };
  const cols = Object.keys(headers) as (keyof typeof headers)[];
  const widths = Object.fromEntries(
    cols.map((col) => [col, Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)]),
  );
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join("\n"));
}

async function handleFilesRebuild(): Promise<void> {
  const stats = await rebuildFileIndex();
  console.log(
    `Indexed ${stats.indexedFiles} files across ${stats.indexedSessions} sessions (updated: ${stats.updatedAt})`,
  );
}

// ---------------------------------------------------------------------------
// Token commands
// ---------------------------------------------------------------------------

async function handleToken(
  action: string | undefined,
  args: readonly string[],
): Promise<void> {
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

async function handleTokenCreate(args: readonly string[]): Promise<void> {
  const name = getArgValue(args, "--name");
  if (name === undefined || name.trim().length === 0) {
    console.error("Usage: codex-agent token create --name <name> [--permissions <csv>] [--expires-at <iso8601>]");
    process.exitCode = 1;
    return;
  }

  const permissionsCsv = getArgValue(args, "--permissions");
  const expiresAt = getArgValue(args, "--expires-at");
  const permissions =
    permissionsCsv !== undefined
      ? parsePermissionList(permissionsCsv)
      : (["session:read"] as const);

  if (permissions.length === 0) {
    console.error(`No valid permissions provided. Allowed: ${PERMISSIONS.join(", ")}`);
    process.exitCode = 1;
    return;
  }

  try {
    const token = await createToken({
      name,
      permissions,
      expiresAt,
    });
    console.log("Token created:");
    console.log(token);
  } catch (err: unknown) {
    console.error(`Failed to create token: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

async function handleTokenList(args: readonly string[]): Promise<void> {
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
    revoked: token.revokedAt ?? "-",
  }));

  const headers = {
    id: "ID",
    name: "NAME",
    permissions: "PERMISSIONS",
    expires: "EXPIRES_AT",
    revoked: "REVOKED_AT",
  };
  const cols = Object.keys(headers) as (keyof typeof headers)[];
  const widths = Object.fromEntries(
    cols.map((col) => [col, Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)]),
  );
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join("\n"));
}

async function handleTokenRevoke(args: readonly string[]): Promise<void> {
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

async function handleTokenRotate(args: readonly string[]): Promise<void> {
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
  } catch (err: unknown) {
    console.error(`Failed to rotate token: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Queue commands
// ---------------------------------------------------------------------------

async function handleQueue(
  action: string | undefined,
  args: readonly string[],
): Promise<void> {
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

async function handleQueueCreate(args: readonly string[]): Promise<void> {
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

async function handleQueueAdd(args: readonly string[]): Promise<void> {
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

  const queuePrompt = await addPrompt(
    queue.id,
    prompt,
    images.length > 0 ? images : undefined,
  );
  console.log(`Prompt added to queue ${queue.name}: ${queuePrompt.id.slice(0, 8)}`);
}

async function handleQueueShow(args: readonly string[]): Promise<void> {
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

async function handleQueueList(args: readonly string[]): Promise<void> {
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

  // Table format
  const rows = queues.map((q) => ({
    id: q.id.slice(0, 8),
    name: q.name,
    project: q.projectPath.length > 40 ? "..." + q.projectPath.slice(-37) : q.projectPath,
    prompts: String(q.prompts.length),
    pending: String(q.prompts.filter((p) => p.status === "pending").length),
    created: q.createdAt.toISOString().slice(0, 19).replace("T", " "),
  }));

  const headers = { id: "ID", name: "NAME", project: "PROJECT", prompts: "PROMPTS", pending: "PENDING", created: "CREATED" };
  const cols = Object.keys(headers) as (keyof typeof headers)[];
  const widths = Object.fromEntries(
    cols.map((col) => [col, Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0)]),
  );
  const headerLine = cols.map((c) => headers[c].padEnd(widths[c] ?? 0)).join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) => cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "));
  console.log([headerLine, separator, ...dataLines].join("\n"));
}

async function handleQueuePause(args: readonly string[]): Promise<void> {
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

async function handleQueueResume(args: readonly string[]): Promise<void> {
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

async function handleQueueDelete(args: readonly string[]): Promise<void> {
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

async function handleQueueUpdate(args: readonly string[]): Promise<void> {
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
  const status =
    statusRaw === "pending" ||
    statusRaw === "running" ||
    statusRaw === "completed" ||
    statusRaw === "failed"
      ? statusRaw
      : undefined;
  const ok = await updateQueueCommand(queue.id, commandId, { prompt, status });
  if (!ok) {
    console.error(`Queue command not found: ${commandId}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Updated command ${commandId} in queue ${queue.name}`);
}

async function handleQueueRemoveCommand(args: readonly string[]): Promise<void> {
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

async function handleQueueMove(args: readonly string[]): Promise<void> {
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

async function handleQueueMode(args: readonly string[]): Promise<void> {
  const name = args[0];
  const commandId = args[1];
  const modeRaw = getArgValue(args, "--mode");
  if (name === undefined || commandId === undefined || (modeRaw !== "auto" && modeRaw !== "manual")) {
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

async function handleQueueRun(args: readonly string[]): Promise<void> {
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

  const handler = (): void => {
    console.log("\nStopping after current prompt...");
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
        console.log(`\nQueue complete: ${event.completed.length} completed, ${event.failed.length} failed`);
        break;
      case "queue_stopped":
        console.log(`\nQueue stopped: ${event.completed.length} completed, ${event.pending.length} remaining`);
        break;
    }
  }

  process.removeListener("SIGINT", handler);
}

// ---------------------------------------------------------------------------
// Server commands
// ---------------------------------------------------------------------------

async function handleServer(
  action: string | undefined,
  args: readonly string[],
): Promise<void> {
  if (action !== "start") {
    console.error(`Unknown server action: ${action ?? "(none)"}`);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  let config: ServerConfig;
  try {
    config = resolveServerConfig(parseServerStartArgs(args));
  } catch (err: unknown) {
    console.error(
      `Invalid server options: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
    return;
  }

  const handle = startServer(config);
  console.log(
    `Server listening on http://${handle.hostname}:${handle.port}`,
  );

  // Keep alive until SIGINT/SIGTERM
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      console.log("\nShutting down server...");
      handle.stop();
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

// ---------------------------------------------------------------------------
// Daemon commands
// ---------------------------------------------------------------------------

async function handleDaemon(
  action: string | undefined,
  args: readonly string[],
): Promise<void> {
  switch (action) {
    case "start": {
      const daemonConfig = parseDaemonStartArgs(args);
      try {
        const info = await startDaemon(daemonConfig);
        console.log(
          `Daemon started (pid: ${info.pid}, port: ${info.port}, mode: ${info.mode})`,
        );
      } catch (err: unknown) {
        console.error(
          `Failed to start daemon: ${err instanceof Error ? err.message : String(err)}`,
        );
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
          console.log(
            `Daemon is running (pid: ${result.info!.pid}, port: ${result.info!.port}, started: ${result.info!.startedAt})`,
          );
          break;
        case "stopped":
          console.log("Daemon is not running.");
          break;
        case "stale":
          console.log(
            `Daemon PID file is stale (pid: ${result.info!.pid} no longer running).`,
          );
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

// ---------------------------------------------------------------------------
// Arg parsing helpers
// ---------------------------------------------------------------------------

interface ListArgs {
  source?: SessionSource | undefined;
  cwd?: string | undefined;
  branch?: string | undefined;
  limit: number;
  format: "table" | "json";
}

export interface ServerStartArgs {
  port?: number;
  hostname?: string;
  token?: string;
  transport?: ServerConfig["transport"];
  appServerUrl?: string;
}

export function parseServerStartArgs(args: readonly string[]): ServerStartArgs {
  const portStr = getArgValue(args, "--port");
  const host = getArgValue(args, "--host");
  const token = getArgValue(args, "--token");
  const transport = getArgValue(args, "--transport");
  const appServerUrl = getArgValue(args, "--app-server-url");

  const parsed: ServerStartArgs = {};
  if (portStr !== undefined) parsed.port = parseInt(portStr, 10) || 3100;
  if (host !== undefined) parsed.hostname = host;
  if (token !== undefined) parsed.token = token;
  if (transport === "local-cli" || transport === "app-server") {
    parsed.transport = transport;
  }
  if (appServerUrl !== undefined) parsed.appServerUrl = appServerUrl;
  return parsed;
}

function parseDaemonStartArgs(args: readonly string[]): DaemonConfig {
  const portStr = getArgValue(args, "--port");
  const host = getArgValue(args, "--host");
  const token = getArgValue(args, "--token");
  const modeRaw = getArgValue(args, "--mode");
  const appServerUrl = getArgValue(args, "--app-server-url");

  return {
    ...(portStr !== undefined ? { port: parseInt(portStr, 10) || 3100 } : {}),
    ...(host !== undefined ? { host } : {}),
    ...(token !== undefined ? { token } : {}),
    ...(modeRaw === "http" || modeRaw === "app-server" ? { mode: modeRaw } : {}),
    ...(appServerUrl !== undefined ? { appServerUrl } : {}),
  };
}

function parseListArgs(args: readonly string[]): ListArgs {
  const result: ListArgs = { limit: 50, format: "table" };

  for (let i = 0; i < args.length; i++) {
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

function isSessionSource(s: string): s is SessionSource {
  return s === "cli" || s === "vscode" || s === "exec" || s === "unknown";
}

function getArgValue(args: readonly string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function getArgValues(args: readonly string[], flag: string): readonly string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) {
      const value = args[i + 1];
      if (value !== undefined) {
        values.push(value);
      }
    }
  }
  return values;
}

function parseProcessOptions(args: readonly string[]): CodexProcessOptions {
  const opts: {
    model?: string;
    sandbox?: SandboxMode;
    approvalMode?: ApprovalMode;
    fullAuto?: boolean;
    images?: readonly string[];
  } = {};

  const model = getArgValue(args, "--model");
  if (model !== undefined) opts.model = model;

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

function renderMarkdownTasks(lines: readonly { readonly type: string; readonly payload: unknown }[]): void {
  const tasks: { sectionHeading: string; text: string; checked: boolean }[] = [];

  for (const line of lines) {
    if (line.type === "event_msg") {
      const payload = line.payload as Record<string, unknown>;
      const eventType = payload["type"];
      const message = payload["message"];
      if (
        (eventType === "UserMessage" || eventType === "AgentMessage") &&
        typeof message === "string"
      ) {
        tasks.push(...extractMarkdownTasks(message));
      }
      continue;
    }

    if (line.type === "response_item") {
      const payload = line.payload as Record<string, unknown>;
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
        const itemObj = item as Record<string, unknown>;
        if (
          (itemObj["type"] === "input_text" || itemObj["type"] === "output_text") &&
          typeof itemObj["text"] === "string"
        ) {
          tasks.push(...extractMarkdownTasks(itemObj["text"]));
        }
      }
    }
  }

  if (tasks.length === 0) {
    console.log("\nMarkdown tasks: none");
    return;
  }

  console.log("\nMarkdown tasks:");
  for (const task of tasks) {
    const checkbox = task.checked ? "[x]" : "[ ]";
    const sectionPrefix = task.sectionHeading.length > 0 ? `${task.sectionHeading}: ` : "";
    console.log(`  ${checkbox} ${sectionPrefix}${task.text}`);
  }
}
