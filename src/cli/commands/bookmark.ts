import {
  addBookmark,
  deleteBookmark,
  getBookmark,
  isBookmarkType,
  listBookmarks,
  searchBookmarks,
} from "../../bookmark/index";
import type { BookmarkType } from "../../bookmark/types";
import { getArgValue, getArgValues } from "../parsing";
import { USAGE } from "../usage";

// ---------------------------------------------------------------------------
// Bookmark commands
// ---------------------------------------------------------------------------

export async function handleBookmark(
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

export async function handleBookmarkAdd(
  args: readonly string[],
): Promise<void> {
  const typeValue = getArgValue(args, "--type");
  const sessionId = getArgValue(args, "--session");
  const name = getArgValue(args, "--name");
  const description = getArgValue(args, "--description");
  const tags = getArgValues(args, "--tag");
  const messageId = getArgValue(args, "--message");
  const fromMessageId = getArgValue(args, "--from");
  const toMessageId = getArgValue(args, "--to");

  if (
    typeValue === undefined ||
    sessionId === undefined ||
    name === undefined
  ) {
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

export async function handleBookmarkList(
  args: readonly string[],
): Promise<void> {
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
    name:
      bookmark.name.length > 28
        ? bookmark.name.slice(0, 25) + "..."
        : bookmark.name,
    tags: bookmark.tags.join(","),
  }));

  const headers = {
    id: "ID",
    type: "TYPE",
    session: "SESSION",
    name: "NAME",
    tags: "TAGS",
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

export async function handleBookmarkGet(
  args: readonly string[],
): Promise<void> {
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

export async function handleBookmarkDelete(
  args: readonly string[],
): Promise<void> {
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

export async function handleBookmarkSearch(
  args: readonly string[],
): Promise<void> {
  const query = args[0];
  if (query === undefined) {
    console.error(
      "Usage: codex-agent bookmark search <query> [--limit <n>] [--format json|table]",
    );
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
