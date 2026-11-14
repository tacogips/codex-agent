/**
 * Types for bookmark management.
 */

export const BOOKMARK_TYPES = ["session", "message", "range"] as const;

export type BookmarkType = (typeof BOOKMARK_TYPES)[number];

export interface Bookmark {
  readonly id: string;
  readonly type: BookmarkType;
  readonly sessionId: string;
  readonly messageId?: string | undefined;
  readonly fromMessageId?: string | undefined;
  readonly toMessageId?: string | undefined;
  readonly name: string;
  readonly description?: string | undefined;
  readonly tags: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BookmarkData {
  readonly id: string;
  readonly type: BookmarkType;
  readonly sessionId: string;
  readonly messageId?: string | undefined;
  readonly fromMessageId?: string | undefined;
  readonly toMessageId?: string | undefined;
  readonly name: string;
  readonly description?: string | undefined;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BookmarkConfig {
  readonly bookmarks: readonly BookmarkData[];
}

export interface CreateBookmarkInput {
  readonly type: BookmarkType;
  readonly sessionId: string;
  readonly messageId?: string | undefined;
  readonly fromMessageId?: string | undefined;
  readonly toMessageId?: string | undefined;
  readonly name: string;
  readonly description?: string | undefined;
  readonly tags?: readonly string[] | undefined;
}

export interface BookmarkFilter {
  readonly sessionId?: string | undefined;
  readonly type?: BookmarkType | undefined;
  readonly tag?: string | undefined;
}

export interface SearchOptions {
  readonly limit?: number | undefined;
}

export interface BookmarkSearchResult {
  readonly bookmark: Bookmark;
  readonly score: number;
}

export function isBookmarkType(value: string): value is BookmarkType {
  return value === "session" || value === "message" || value === "range";
}

export function normalizeTags(tags?: readonly string[]): readonly string[] {
  if (tags === undefined) {
    return [];
  }
  const deduped = new Set<string>();
  for (const raw of tags) {
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      deduped.add(trimmed);
    }
  }
  return Array.from(deduped);
}

export function validateCreateBookmarkInput(input: CreateBookmarkInput): readonly string[] {
  const errors: string[] = [];

  if (input.sessionId.trim().length === 0) {
    errors.push("sessionId is required");
  }
  if (input.name.trim().length === 0) {
    errors.push("name is required");
  }

  switch (input.type) {
    case "session":
      if (input.messageId !== undefined) {
        errors.push("messageId is not allowed for session bookmarks");
      }
      if (input.fromMessageId !== undefined || input.toMessageId !== undefined) {
        errors.push("range fields are not allowed for session bookmarks");
      }
      break;
    case "message":
      if (input.messageId === undefined || input.messageId.trim().length === 0) {
        errors.push("messageId is required for message bookmarks");
      }
      if (input.fromMessageId !== undefined || input.toMessageId !== undefined) {
        errors.push("range fields are not allowed for message bookmarks");
      }
      break;
    case "range":
      if (input.fromMessageId === undefined || input.fromMessageId.trim().length === 0) {
        errors.push("fromMessageId is required for range bookmarks");
      }
      if (input.toMessageId === undefined || input.toMessageId.trim().length === 0) {
        errors.push("toMessageId is required for range bookmarks");
      }
      if (input.messageId !== undefined) {
        errors.push("messageId is not allowed for range bookmarks");
      }
      break;
  }

  return errors;
}

