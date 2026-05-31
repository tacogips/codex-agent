import type { ChangedFilesSummary, FileHistory, FindOptions, GetFilesOptions, IndexStats, SessionFilePatchHistory } from "./types";
export declare function getChangedFiles(sessionId: string, options?: GetFilesOptions): Promise<ChangedFilesSummary>;
export declare function getSessionFilePatchHistory(sessionId: string, options?: GetFilesOptions): Promise<SessionFilePatchHistory>;
export declare function findSessionsByFile(path: string, options?: FindOptions): Promise<FileHistory>;
export declare function rebuildFileIndex(configDir?: string, codexHome?: string): Promise<IndexStats>;
//# sourceMappingURL=service.d.ts.map