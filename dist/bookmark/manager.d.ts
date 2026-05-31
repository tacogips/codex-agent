/**
 * BookmarkManager - CRUD and search APIs for bookmarks.
 */
import type { Bookmark, BookmarkFilter, BookmarkSearchResult, CreateBookmarkInput, SearchOptions } from "./types";
export declare function addBookmark(input: CreateBookmarkInput, configDir?: string): Promise<Bookmark>;
export declare function listBookmarks(filter?: BookmarkFilter, configDir?: string): Promise<readonly Bookmark[]>;
export declare function getBookmark(id: string, configDir?: string): Promise<Bookmark | null>;
export declare function deleteBookmark(id: string, configDir?: string): Promise<boolean>;
export declare function searchBookmarks(query: string, options?: SearchOptions, configDir?: string): Promise<readonly BookmarkSearchResult[]>;
//# sourceMappingURL=manager.d.ts.map