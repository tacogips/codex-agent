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
} from "../../queue/index";
import { getArgValue, getArgValues, parseProcessOptions } from "../parsing";
import { USAGE } from "../usage";

// ---------------------------------------------------------------------------
// Queue commands
// ---------------------------------------------------------------------------

export async function handleQueue(
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

export async function handleQueueCreate(
  args: readonly string[],
): Promise<void> {
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

export async function handleQueueAdd(args: readonly string[]): Promise<void> {
  const name = args[0];
  if (name === undefined) {
    console.error(
      "Usage: codex-agent queue add <name> --prompt <prompt> [--image <path>]...",
    );
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
  console.log(
    `Prompt added to queue ${queue.name}: ${queuePrompt.id.slice(0, 8)}`,
  );
}

export async function handleQueueShow(args: readonly string[]): Promise<void> {
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

export async function handleQueueList(args: readonly string[]): Promise<void> {
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
    project:
      q.projectPath.length > 40
        ? "..." + q.projectPath.slice(-37)
        : q.projectPath,
    prompts: String(q.prompts.length),
    pending: String(q.prompts.filter((p) => p.status === "pending").length),
    created: q.createdAt.toISOString().slice(0, 19).replace("T", " "),
  }));

  const headers = {
    id: "ID",
    name: "NAME",
    project: "PROJECT",
    prompts: "PROMPTS",
    pending: "PENDING",
    created: "CREATED",
  };
  const cols = Object.keys(headers) as (keyof typeof headers)[];
  const widths = Object.fromEntries(
    cols.map((col) => [
      col,
      Math.max(headers[col].length, ...rows.map((r) => r[col].length), 0),
    ]),
  );
  const headerLine = cols
    .map((c) => headers[c].padEnd(widths[c] ?? 0))
    .join("  ");
  const separator = cols.map((c) => "-".repeat(widths[c] ?? 0)).join("  ");
  const dataLines = rows.map((row) =>
    cols.map((c) => row[c].padEnd(widths[c] ?? 0)).join("  "),
  );
  console.log([headerLine, separator, ...dataLines].join("\n"));
}

export async function handleQueuePause(args: readonly string[]): Promise<void> {
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

export async function handleQueueResume(
  args: readonly string[],
): Promise<void> {
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

export async function handleQueueDelete(
  args: readonly string[],
): Promise<void> {
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

export async function handleQueueUpdate(
  args: readonly string[],
): Promise<void> {
  const name = args[0];
  const commandId = args[1];
  if (name === undefined || commandId === undefined) {
    console.error(
      "Usage: codex-agent queue update <name> <command-id> [--prompt <text>] [--status <status>]",
    );
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

export async function handleQueueRemoveCommand(
  args: readonly string[],
): Promise<void> {
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

export async function handleQueueMove(args: readonly string[]): Promise<void> {
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

export async function handleQueueMode(args: readonly string[]): Promise<void> {
  const name = args[0];
  const commandId = args[1];
  const modeRaw = getArgValue(args, "--mode");
  if (
    name === undefined ||
    commandId === undefined ||
    (modeRaw !== "auto" && modeRaw !== "manual")
  ) {
    console.error(
      "Usage: codex-agent queue mode <name> <command-id> --mode <auto|manual>",
    );
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
  console.log(
    `Set mode ${modeRaw} for command ${commandId} in queue ${queue.name}`,
  );
}

export async function handleQueueRun(args: readonly string[]): Promise<void> {
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

  const pendingCount = queue.prompts.filter(
    (p) => p.status === "pending",
  ).length;
  console.log(
    `Running queue "${queue.name}" (${pendingCount} pending prompts)...`,
  );

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
        console.log(
          `  [completed] ${event.promptId?.slice(0, 8)} (exit: ${event.exitCode})`,
        );
        break;
      case "prompt_failed":
        console.log(
          `  [failed]    ${event.promptId?.slice(0, 8)} (exit: ${event.exitCode})`,
        );
        break;
      case "queue_completed":
        console.log(
          `\nQueue complete: ${event.completed.length} completed, ${event.failed.length} failed`,
        );
        break;
      case "queue_stopped":
        console.log(
          `\nQueue stopped: ${event.completed.length} completed, ${event.pending.length} remaining`,
        );
        break;
    }
  }

  process.removeListener("SIGINT", handler);
}
