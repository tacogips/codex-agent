/**
 * BookmarkRepository - Persistent storage for bookmarks.
 *
 * Stores bookmarks as JSON at ~/.config/codex-agent/bookmarks.json.
 * Uses atomic write (write-to-temp + rename) for crash safety.
 */
import type { Bookmark } from "./types";
/**
 * Load all bookmarks from persistent storage.
 */
export declare function loadBookmarks(configDir?: string): Promise<readonly Bookmark[]>;
/**
 * Persist bookmarks to storage using atomic write.
 */
export declare function saveBookmarks(bookmarks: readonly Bookmark[], configDir?: string): Promise<void>;
//# sourceMappingURL=repository.d.ts.map