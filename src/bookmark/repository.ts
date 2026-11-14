/**
 * BookmarkRepository - Persistent storage for bookmarks.
 *
 * Stores bookmarks as JSON at ~/.config/codex-agent/bookmarks.json.
 * Uses atomic write (write-to-temp + rename) for crash safety.
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Bookmark, BookmarkConfig, BookmarkData } from "./types";

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "codex-agent");
const BOOKMARKS_FILE = "bookmarks.json";

function resolveConfigDir(configDir?: string): string {
  return configDir ?? DEFAULT_CONFIG_DIR;
}

function bookmarkFilePath(configDir?: string): string {
  return join(resolveConfigDir(configDir), BOOKMARKS_FILE);
}

function toBookmark(data: BookmarkData): Bookmark {
  return {
    id: data.id,
    type: data.type,
    sessionId: data.sessionId,
    messageId: data.messageId,
    fromMessageId: data.fromMessageId,
    toMessageId: data.toMessageId,
    name: data.name,
    description: data.description,
    tags: [...data.tags],
    createdAt: new Date(data.createdAt),
    updatedAt: new Date(data.updatedAt),
  };
}

function toData(bookmark: Bookmark): BookmarkData {
  return {
    id: bookmark.id,
    type: bookmark.type,
    sessionId: bookmark.sessionId,
    messageId: bookmark.messageId,
    fromMessageId: bookmark.fromMessageId,
    toMessageId: bookmark.toMessageId,
    name: bookmark.name,
    description: bookmark.description,
    tags: [...bookmark.tags],
    createdAt: bookmark.createdAt.toISOString(),
    updatedAt: bookmark.updatedAt.toISOString(),
  };
}

/**
 * Load all bookmarks from persistent storage.
 */
export async function loadBookmarks(configDir?: string): Promise<readonly Bookmark[]> {
  const path = bookmarkFilePath(configDir);
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as BookmarkConfig;
    return parsed.bookmarks.map(toBookmark);
  } catch {
    return [];
  }
}

/**
 * Persist bookmarks to storage using atomic write.
 */
export async function saveBookmarks(
  bookmarks: readonly Bookmark[],
  configDir?: string,
): Promise<void> {
  const dir = resolveConfigDir(configDir);
  await mkdir(dir, { recursive: true });
  const path = bookmarkFilePath(configDir);
  const tmpPath = path + ".tmp." + randomUUID().slice(0, 8);
  const config: BookmarkConfig = {
    bookmarks: bookmarks.map(toData),
  };
  const json = JSON.stringify(config, null, 2) + "\n";
  await writeFile(tmpPath, json, "utf-8");
  await rename(tmpPath, path);
}

