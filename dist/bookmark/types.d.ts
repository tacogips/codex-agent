/**
 * Types for bookmark management.
 */
export declare const BOOKMARK_TYPES: readonly ["session", "message", "range"];
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
export declare function isBookmarkType(value: string): value is BookmarkType;
export declare function normalizeTags(tags?: readonly string[]): readonly string[];
export declare function validateCreateBookmarkInput(input: CreateBookmarkInput): readonly string[];
//# sourceMappingURL=types.d.ts.map