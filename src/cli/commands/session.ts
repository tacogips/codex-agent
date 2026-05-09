import { listSessions, findSession } from "../../session/index";
import { readRollout } from "../../rollout/reader";
import { RolloutWatcher } from "../../rollout/watcher";
import { ProcessManager } from "../../process/manager";
import {
  formatSessionDetail,
  formatRolloutLine,
  formatSessionTable,
  formatSessionsJson,
} from "../format";
import { SessionRunner } from "../../sdk/session-runner";
import {
  getArgValue,
  isCharChunk,
  parseCharDelayMs,
  parseListArgs,
  parseProcessOptions,
  renderMarkdownTasks,
  sleep,
} from "../parsing";
import { USAGE } from "../usage";

// ---------------------------------------------------------------------------
// Session commands
// ---------------------------------------------------------------------------

export async function handleSession(
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
    case "run":
      await handleSessionRun(args);
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

export async function handleSessionList(
  args: readonly string[],
): Promise<void> {
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
      console.log(
        `\nShowing ${result.sessions.length} of ${result.total} sessions`,
      );
    }
  }
}

export async function handleSessionShow(
  args: readonly string[],
): Promise<void> {
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

export async function handleSessionWatch(
  args: readonly string[],
): Promise<void> {
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

export async function handleSessionRun(args: readonly string[]): Promise<void> {
  const prompt = getArgValue(args, "--prompt");
  if (prompt === undefined || prompt.trim().length === 0) {
    console.error("Usage: codex-agent session run --prompt <P> [options]");
    process.exitCode = 1;
    return;
  }

  const opts = parseProcessOptions(args);
  const charDelayMs = parseCharDelayMs(args);
  const runner = new SessionRunner();
  const session = await runner.startSession({
    prompt,
    cwd: opts.cwd,
    model: opts.model,
    sandbox: opts.sandbox,
    approvalMode: opts.approvalMode,
    fullAuto: opts.fullAuto,
    additionalArgs: opts.additionalArgs,
    images: opts.images,
    streamGranularity: opts.streamGranularity,
  });

  console.log(
    `Started session ${session.sessionId} with ${opts.streamGranularity ?? "event"} streaming`,
  );

  for await (const chunk of session.messages()) {
    if (isCharChunk(chunk)) {
      process.stdout.write(chunk.char);
      if (charDelayMs > 0) {
        await sleep(charDelayMs);
      }
      continue;
    }
    console.log(formatRolloutLine(chunk));
  }

  if (opts.streamGranularity === "char") {
    process.stdout.write("\n");
  }

  const result = await session.waitForCompletion();
  console.log(
    `Session ${session.sessionId} exited with code ${result.exitCode}`,
  );
}

export async function handleSessionResume(
  args: readonly string[],
): Promise<void> {
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

export async function handleSessionFork(
  args: readonly string[],
): Promise<void> {
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
