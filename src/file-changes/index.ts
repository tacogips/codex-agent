export type {
  FileOperation,
  ChangedFile,
  ChangedFilesSummary,
  FileHistory,
  FileHistoryEntry,
  IndexStats,
  GetFilesOptions,
  FindOptions,
  SessionFileIndexEntry,
  FileChangeIndex,
} from "./types";

export { extractChangedFiles } from "./extractor";
export { getChangedFiles, findSessionsByFile, rebuildFileIndex } from "./service";

