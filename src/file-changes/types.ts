export type FileOperation = "created" | "modified" | "deleted";

export interface ChangedFile {
  readonly path: string;
  readonly operation: FileOperation;
  readonly changeCount: number;
  readonly lastModified: string;
}

export interface ChangedFilesSummary {
  readonly sessionId: string;
  readonly files: readonly ChangedFile[];
  readonly totalFiles: number;
}

export interface FileHistoryEntry {
  readonly sessionId: string;
  readonly operation: FileOperation;
  readonly lastModified: string;
}

export interface FileHistory {
  readonly path: string;
  readonly sessions: readonly FileHistoryEntry[];
}

export interface IndexStats {
  readonly indexedSessions: number;
  readonly indexedFiles: number;
  readonly updatedAt: string;
}

export interface GetFilesOptions {
  readonly codexHome?: string | undefined;
  readonly configDir?: string | undefined;
}

export interface FindOptions {
  readonly codexHome?: string | undefined;
  readonly configDir?: string | undefined;
}

export interface SessionFileIndexEntry {
  readonly sessionId: string;
  readonly files: readonly ChangedFile[];
  readonly indexedAt: string;
}

export interface FileChangeIndex {
  readonly sessions: readonly SessionFileIndexEntry[];
  readonly updatedAt: string;
}

