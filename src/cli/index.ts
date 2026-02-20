/**
 * CLI entry point for codex-agent.
 *
 * Subcommands:
 *   session list [--source S] [--cwd P] [--branch B] [--format json|table]
 *   session show <id>
 *   session watch <id>
 */

import {
  listSessions,
  findSession,
} from "../session/index";
import { readRollout } from "../rollout/reader";
import { RolloutWatcher } from "../rollout/watcher";
import {
  formatSessionTable,
  formatSessionDetail,
  formatSessionsJson,
  formatRolloutLine,
} from "./format";
import type { SessionSource } from "../types/rollout";

const USAGE = `codex-agent - Codex session manager

Usage:
  codex-agent session list [options]
  codex-agent session show <id>
  codex-agent session watch <id>

Session list options:
  --source <cli|vscode|exec>  Filter by session source
  --cwd <path>                Filter by working directory
  --branch <name>             Filter by git branch
  --limit <n>                 Max results (default: 50)
  --format <table|json>       Output format (default: table)

Session show:
  Display detailed information about a session

Session watch:
  Watch a session for real-time updates (Ctrl+C to stop)
`;

export async function run(argv: readonly string[]): Promise<void> {
  const args = argv.slice(2); // skip node and script path

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    return;
  }

  const subcommand = args[0];
  const action = args[1];

  if (subcommand !== "session") {
    console.error(`Unknown command: ${subcommand}`);
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }

  switch (action) {
    case "list":
      await handleSessionList(args.slice(2));
      break;
    case "show":
      await handleSessionShow(args.slice(2));
      break;
    case "watch":
      await handleSessionWatch(args.slice(2));
      break;
    default:
      console.error(`Unknown session action: ${action ?? "(none)"}`);
      console.log(USAGE);
      process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface ListArgs {
  source?: SessionSource | undefined;
  cwd?: string | undefined;
  branch?: string | undefined;
  limit: number;
  format: "table" | "json";
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
