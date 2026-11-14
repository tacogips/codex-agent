export type {
  FileOperation,
  ChangedFile,
  ChangedFilesSummary,
  FileHistory,
  FileHistoryEntry,
  FileChangeSource,
  FileChangeDetail,
  SessionFileHistory,
  SessionFilePatchHistory,
  IndexStats,
  GetFilesOptions,
  FindOptions,
  SessionFileIndexEntry,
  FileChangeIndex,
} from "./types";

export { extractChangedFiles, extractFileChangeDetails } from "./extractor";
export {
  getChangedFiles,
  getSessionFilePatchHistory,
  findSessionsByFile,
  rebuildFileIndex,
} from "./service";
