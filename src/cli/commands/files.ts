import {
  findSessionsByFile,
  getChangedFiles,
  getSessionFilePatchHistory,
  rebuildFileIndex,
} from "../../file-changes/index";
import { getArgValue } from "../parsing";
import { USAGE } from "../usage";

// ---------------------------------------------------------------------------
// File-change commands
// ---------------------------------------------------------------------------

export async function handleFiles(
  action: string | undefined,
  args: readonly string[],
): Promise<void> {
  switch (action) {
    case "list":
      await handleFilesList(args);
      break;
    case "patches":
      await handleFilesPatches(args);
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

export async function handleFilesList(args: readonly string[]): Promise<void> {
  const sessionId = args[0];
  if (sessionId === undefined) {
    console.error(
      "Usage: codex-agent files list <session-id> [--format json|table]",
    );
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
    const headers = {
      path: "PATH",
      op: "OP",
      count: "COUNT",
      last: "LAST_MODIFIED",
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
  } catch (err: unknown) {
    console.error(
      `Failed to list file changes: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
}

export async function handleFilesPatches(
  args: readonly string[],
): Promise<void> {
  const sessionId = args[0];
  if (sessionId === undefined) {
    console.error(
      "Usage: codex-agent files patches <session-id> [--format json|table]",
    );
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
      console.log(
        `${file.path} (${file.changeCount} changes, latest ${file.lastModified})`,
      );
      for (const change of file.changes) {
        const summary =
          change.patch !== undefined
            ? (change.patch.split("\n")[0] ?? change.operation)
            : (change.command ?? change.operation);
        console.log(
          `  ${change.timestamp}  ${change.operation}  ${change.source}  ${summary}`,
        );
      }
      console.log("");
    }
  } catch (err: unknown) {
    console.error(
      `Failed to get file patch history: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 1;
  }
}

export async function handleFilesFind(args: readonly string[]): Promise<void> {
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
  const headers = {
    session: "SESSION",
    operation: "OP",
    last: "LAST_MODIFIED",
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

export async function handleFilesRebuild(): Promise<void> {
  const stats = await rebuildFileIndex();
  console.log(
    `Indexed ${stats.indexedFiles} files across ${stats.indexedSessions} sessions (updated: ${stats.updatedAt})`,
  );
}
