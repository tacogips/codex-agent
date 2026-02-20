/**
 * CLI entry point for codex-agent.
 *
 * Subcommands:
 *   session list [--source S] [--cwd P] [--branch B] [--format json|table]
 *   session show <id>
 *   session watch <id>
 *   session resume <id> [--model M] [--sandbox S] [--full-auto]
 *   session fork <id> [--nth-message N] [--model M] [--sandbox S] [--full-auto]
 *
 *   group create <name> [--description D]
 *   group list [--format json|table]
 *   group add <group> <session>
 *   group remove <group> <session>
 *   group run <name> --prompt <P> [--max-concurrent N] [--model M]
 *
 *   queue create <name> --project <path>
 *   queue add <name> --prompt <prompt>
 *   queue list [--format json|table]
 *   queue run <name> [--model M] [--sandbox S] [--full-auto]
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
  runGroup,
} from "../group/index";
import {
  createQueue,
  addPrompt,
  findQueue,
  listQueues,
  runQueue,
} from "../queue/index";
import { startServer } from "../server/server";
import { resolveServerConfig } from "../server/types";
import { startDaemon, stopDaemon, getDaemonStatus } from "../daemon/manager";
import {
  formatSessionTable,
  formatSessionDetail,
  formatSessionsJson,
  formatRolloutLine,
} from "./format";
import type { SessionSource } from "../types/rollout";
import type { CodexProcessOptions, SandboxMode, ApprovalMode } from "../process/types";
import type { DaemonConfig } from "../daemon/types";
import type { ServerConfig } from "../server/types";

const USAGE = `codex-agent - Codex session manager

Usage:
  codex-agent session list [options]
  codex-agent session show <id>
  codex-agent session watch <id>
  codex-agent session resume <id> [options]
  codex-agent session fork <id> [--nth-message N] [options]

  codex-agent group create <name> [--description D]
  codex-agent group list [--format json|table]
  codex-agent group add <group> <session>
  codex-agent group remove <group> <session>
  codex-agent group run <name> --prompt <P> [--max-concurrent N]

  codex-agent queue create <name> --project <path>
  codex-agent queue add <name> --prompt <prompt>
  codex-agent queue list [--format json|table]
  codex-agent queue run <name>

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
    case "add":
      await handleGroupAdd(args);
      break;
    case "remove":
      await handleGroupRemove(args);
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
    case "list":
      await handleQueueList(args);
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
    console.error("Usage: codex-agent queue add <name> --prompt <prompt>");
    process.exitCode = 1;
    return;
  }

  const prompt = getArgValue(args, "--prompt");
  if (prompt === undefined) {
    console.error("--prompt is required for queue add");
    process.exitCode = 1;
    return;
  }

  const queue = await findQueue(name);
  if (queue === null) {
    console.error(`Queue not found: ${name}`);
    process.exitCode = 1;
    return;
  }

  const queuePrompt = await addPrompt(queue.id, prompt);
  console.log(`Prompt added to queue ${queue.name}: ${queuePrompt.id.slice(0, 8)}`);
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

function parseProcessOptions(args: readonly string[]): CodexProcessOptions {
  const opts: {
    model?: string;
    sandbox?: SandboxMode;
    approvalMode?: ApprovalMode;
    fullAuto?: boolean;
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

  return opts;
}
