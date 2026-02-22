/**
 * BookmarkManager - CRUD and search APIs for bookmarks.
 */

import { randomUUID } from "node:crypto";
import { loadBookmarks, saveBookmarks } from "./repository";
import type {
  Bookmark,
  BookmarkFilter,
  BookmarkSearchResult,
  CreateBookmarkInput,
  SearchOptions,
} from "./types";
import { normalizeTags, validateCreateBookmarkInput } from "./types";

function applyFilter(
  bookmarks: readonly Bookmark[],
  filter?: BookmarkFilter,
): readonly Bookmark[] {
  if (filter === undefined) {
    return bookmarks;
  }
  return bookmarks.filter((bookmark) => {
    if (filter.sessionId !== undefined && bookmark.sessionId !== filter.sessionId) {
      return false;
    }
    if (filter.type !== undefined && bookmark.type !== filter.type) {
      return false;
    }
    if (filter.tag !== undefined && !bookmark.tags.includes(filter.tag)) {
      return false;
    }
    return true;
  });
}

function scoreBookmark(bookmark: Bookmark, normalizedQuery: string): number {
  if (normalizedQuery.length === 0) {
    return 0;
  }

  let score = 0;
  const q = normalizedQuery;
  const name = bookmark.name.toLowerCase();
  const description = bookmark.description?.toLowerCase() ?? "";

  if (name.includes(q)) score += 5;
  if (description.includes(q)) score += 3;
  if (bookmark.sessionId.toLowerCase().includes(q)) score += 2;
  if (
    bookmark.messageId?.toLowerCase().includes(q) === true ||
    bookmark.fromMessageId?.toLowerCase().includes(q) === true ||
    bookmark.toMessageId?.toLowerCase().includes(q) === true
  ) {
    score += 2;
  }

  const tagMatches = bookmark.tags.reduce((acc, tag) => {
    if (tag.toLowerCase().includes(q)) return acc + 1;
    return acc;
  }, 0);
  score += tagMatches;
  return score;
}

export async function addBookmark(
  input: CreateBookmarkInput,
  configDir?: string,
): Promise<Bookmark> {
  const errors = validateCreateBookmarkInput(input);
  if (errors.length > 0) {
    throw new Error(`Invalid bookmark input: ${errors.join("; ")}`);
  }

  const now = new Date();
  const bookmark: Bookmark = {
    id: randomUUID(),
    type: input.type,
    sessionId: input.sessionId.trim(),
    messageId: input.messageId?.trim(),
    fromMessageId: input.fromMessageId?.trim(),
    toMessageId: input.toMessageId?.trim(),
    name: input.name.trim(),
    description: input.description?.trim(),
    tags: normalizeTags(input.tags),
    createdAt: now,
    updatedAt: now,
  };

  const existing = await loadBookmarks(configDir);
  await saveBookmarks([...existing, bookmark], configDir);
  return bookmark;
}

export async function listBookmarks(
  filter?: BookmarkFilter,
  configDir?: string,
): Promise<readonly Bookmark[]> {
  const all = await loadBookmarks(configDir);
  const filtered = applyFilter(all, filter);
  return [...filtered].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
  );
}

export async function getBookmark(
  id: string,
  configDir?: string,
): Promise<Bookmark | null> {
  const all = await loadBookmarks(configDir);
  const found = all.find((bookmark) => bookmark.id === id);
  return found ?? null;
}

export async function deleteBookmark(
  id: string,
  configDir?: string,
): Promise<boolean> {
  const all = await loadBookmarks(configDir);
  const filtered = all.filter((bookmark) => bookmark.id !== id);
  if (filtered.length === all.length) {
    return false;
  }
  await saveBookmarks(filtered, configDir);
  return true;
}

export async function searchBookmarks(
  query: string,
  options?: SearchOptions,
  configDir?: string,
): Promise<readonly BookmarkSearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return [];
  }

  const all = await loadBookmarks(configDir);
  const scored = all
    .map((bookmark) => ({
      bookmark,
      score: scoreBookmark(bookmark, normalizedQuery),
    }))
    .filter((result) => result.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return b.bookmark.updatedAt.getTime() - a.bookmark.updatedAt.getTime();
    });

  const limit = options?.limit;
  if (limit === undefined || limit <= 0) {
    return scored;
  }
  return scored.slice(0, limit);
}

