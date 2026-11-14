import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { readRollout } from "../rollout/reader";
import { findSession, listSessions } from "../session/index";
import { extractChangedFiles } from "./extractor";
import type {
  ChangedFile,
  ChangedFilesSummary,
  FileChangeIndex,
  FileHistory,
  FileHistoryEntry,
  FindOptions,
  GetFilesOptions,
  IndexStats,
  SessionFileIndexEntry,
} from "./types";

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "codex-agent");
const FILE_INDEX_FILE = "file-changes-index.json";

function resolveConfigDir(configDir?: string): string {
  return configDir ?? DEFAULT_CONFIG_DIR;
}

function fileIndexPath(configDir?: string): string {
  return join(resolveConfigDir(configDir), FILE_INDEX_FILE);
}

async function loadIndex(configDir?: string): Promise<FileChangeIndex> {
  const path = fileIndexPath(configDir);
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as FileChangeIndex;
  } catch {
    return {
      sessions: [],
      updatedAt: new Date(0).toISOString(),
    };
  }
}

async function saveIndex(index: FileChangeIndex, configDir?: string): Promise<void> {
  const dir = resolveConfigDir(configDir);
  await mkdir(dir, { recursive: true });
  const path = fileIndexPath(configDir);
  const tmpPath = path + ".tmp." + randomUUID().slice(0, 8);
  const json = JSON.stringify(index, null, 2) + "\n";
  await writeFile(tmpPath, json, "utf-8");
  await rename(tmpPath, path);
}

function toSummary(sessionId: string, files: readonly ChangedFile[]): ChangedFilesSummary {
  return {
    sessionId,
    files,
    totalFiles: files.length,
  };
}

export async function getChangedFiles(
  sessionId: string,
  options?: GetFilesOptions,
): Promise<ChangedFilesSummary> {
  const session = await findSession(sessionId, options?.codexHome);
  if (session === null) {
    throw new Error(`session not found: ${sessionId}`);
  }
  const lines = await readRollout(session.rolloutPath);
  const files = extractChangedFiles(lines);
  return toSummary(sessionId, files);
}

export async function findSessionsByFile(
  path: string,
  options?: FindOptions,
): Promise<FileHistory> {
  const target = path.trim();
  if (target.length === 0) {
    throw new Error("path is required");
  }

  const index = await loadIndex(options?.configDir);
  const sessions: FileHistoryEntry[] = [];

  for (const entry of index.sessions) {
    for (const changed of entry.files) {
      if (changed.path === target) {
        sessions.push({
          sessionId: entry.sessionId,
          operation: changed.operation,
          lastModified: changed.lastModified,
        });
      }
    }
  }

  sessions.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  return { path: target, sessions };
}

export async function rebuildFileIndex(configDir?: string, codexHome?: string): Promise<IndexStats> {
  const sessions = await listSessions({
    limit: Number.MAX_SAFE_INTEGER,
    ...(codexHome !== undefined ? { codexHome } : {}),
  });

  const entries: SessionFileIndexEntry[] = [];
  let indexedFiles = 0;

  for (const session of sessions.sessions) {
    const lines = await readRollout(session.rolloutPath);
    const files = extractChangedFiles(lines);
    indexedFiles += files.length;
    entries.push({
      sessionId: session.id,
      files,
      indexedAt: new Date().toISOString(),
    });
  }

  const updatedAt = new Date().toISOString();
  await saveIndex(
    {
      sessions: entries,
      updatedAt,
    },
    configDir,
  );

  return {
    indexedSessions: entries.length,
    indexedFiles,
    updatedAt,
  };
}
