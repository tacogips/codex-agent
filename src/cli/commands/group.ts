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
} from "../../group/index";
import { getArgValue, parseProcessOptions } from "../parsing";
import { USAGE } from "../usage";

// ---------------------------------------------------------------------------
// Group commands
// ---------------------------------------------------------------------------

export async function handleGroup(
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

export async function handleGroupCreate(
  args: readonly string[],
): Promise<void> {
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

export async function handleGroupList(args: readonly string[]): Promise<void> {
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

  const headers = {
    id: "ID",
    name: "NAME",
    sessions: "SESSIONS",
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

export async function handleGroupShow(args: readonly string[]): Promise<void> {
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

export async function handleGroupAdd(args: readonly string[]): Promise<void> {
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

export async function handleGroupRemove(
  args: readonly string[],
): Promise<void> {
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

export async function handleGroupPause(args: readonly string[]): Promise<void> {
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

export async function handleGroupResume(
  args: readonly string[],
): Promise<void> {
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

export async function handleGroupDelete(
  args: readonly string[],
): Promise<void> {
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

export async function handleGroupRun(args: readonly string[]): Promise<void> {
  const name = args[0];
  if (name === undefined) {
    console.error(
      "Usage: codex-agent group run <name> --prompt <P> [--max-concurrent N]",
    );
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
  const maxConcurrent =
    maxConcurrentStr !== undefined ? parseInt(maxConcurrentStr, 10) : undefined;
  const opts = parseProcessOptions(args.slice(1));

  console.log(
    `Running prompt across ${group.sessionIds.length} sessions in group "${group.name}"...`,
  );

  for await (const event of runGroup(group, prompt, {
    ...opts,
    maxConcurrent,
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
        console.log(
          `\nGroup run complete: ${event.completed.length} completed, ${event.failed.length} failed`,
        );
        break;
    }
  }
}
