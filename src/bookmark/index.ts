export type {
  BookmarkType,
  Bookmark,
  BookmarkData,
  BookmarkConfig,
  CreateBookmarkInput,
  BookmarkFilter,
  SearchOptions,
  BookmarkSearchResult,
} from "./types";

export { BOOKMARK_TYPES, isBookmarkType, validateCreateBookmarkInput } from "./types";

export { loadBookmarks, saveBookmarks } from "./repository";

export {
  addBookmark,
  listBookmarks,
  getBookmark,
  deleteBookmark,
  searchBookmarks,
} from "./manager";

