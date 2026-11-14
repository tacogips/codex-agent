/**
 * RolloutWatcher - Real-time monitoring of Codex rollout files.
 *
 * Uses fs.watch to detect file changes and reads appended JSONL lines
 * incrementally. Also watches session directories for new rollout files.
 */

import { watch, type FSWatcher } from "node:fs";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { RolloutLine } from "../types/rollout";
import { parseRolloutLine } from "./reader";

const ROLLOUT_PREFIX = "rollout-";
const ROLLOUT_EXT = ".jsonl";
const DEBOUNCE_MS = 100;

export interface RolloutWatcherEvents {
  line: [path: string, line: RolloutLine];
  newSession: [path: string];
  error: [error: Error];
}

export interface WatchFileOptions {
  readonly startOffset?: number | undefined;
}

/**
 * Watches rollout files and directories for real-time updates.
 */
export class RolloutWatcher extends EventEmitter<RolloutWatcherEvents> {
  private readonly fileWatchers = new Map<string, FileWatchState>();
  private readonly dirWatchers = new Map<string, FSWatcher>();
  private closed = false;

  /**
   * Watch a single rollout file for appended lines.
   * Emits 'line' events for each new RolloutLine parsed.
   */
  async watchFile(path: string, options?: WatchFileOptions): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.fileWatchers.has(path)) {
      return;
    }

    const fileSize = await getFileSize(path);
    const requestedOffset = options?.startOffset;
    const startOffset =
      requestedOffset !== undefined && Number.isFinite(requestedOffset)
        ? Math.max(0, Math.floor(requestedOffset))
        : fileSize;
    const state: FileWatchState = {
      path,
      offset: startOffset,
      watcher: null,
      debounceTimer: null,
      inFlightRead: null,
      pendingRead: false,
    };

    const watcher = watch(path, () => {
      this.debouncedReadAppended(state);
    });

    watcher.on("error", (err: Error) => {
      this.emit("error", err);
    });

    state.watcher = watcher;
    this.fileWatchers.set(path, state);
    void this.enqueueRead(state);
  }

  /**
   * Watch a sessions directory for new rollout files.
   * Scans date subdirectories (YYYY/MM/DD/) for new files.
   * Emits 'newSession' events when new rollout files appear.
   */
  watchDirectory(dir: string): void {
    if (this.closed) {
      return;
    }
    if (this.dirWatchers.has(dir)) {
      return;
    }

    const watcher = watch(dir, { recursive: true }, (_event, filename) => {
      if (filename === null) {
        return;
      }
      const basename = filename.split("/").pop() ?? filename;
      if (basename.startsWith(ROLLOUT_PREFIX) && basename.endsWith(ROLLOUT_EXT)) {
        const fullPath = join(dir, filename);
        this.emit("newSession", fullPath);
      }
    });

    watcher.on("error", (err: Error) => {
      this.emit("error", err);
    });

    this.dirWatchers.set(dir, watcher);
  }

  /**
   * Stop all watchers and clean up resources.
   */
  stop(): void {
    this.closed = true;

    for (const state of this.fileWatchers.values()) {
      if (state.debounceTimer !== null) {
        clearTimeout(state.debounceTimer);
      }
      state.watcher?.close();
    }
    this.fileWatchers.clear();

    for (const watcher of this.dirWatchers.values()) {
      watcher.close();
    }
    this.dirWatchers.clear();

    this.removeAllListeners();
  }

  /**
   * Flush unread appended data from all watched files.
   */
  async flush(): Promise<void> {
    if (this.closed) {
      return;
    }
    for (const state of this.fileWatchers.values()) {
      await this.enqueueRead(state);
    }
  }

  /**
   * Check if the watcher has been stopped.
   */
  get isClosed(): boolean {
    return this.closed;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private debouncedReadAppended(state: FileWatchState): void {
    if (state.debounceTimer !== null) {
      clearTimeout(state.debounceTimer);
    }
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      void this.enqueueRead(state);
    }, DEBOUNCE_MS);
  }

  private async enqueueRead(state: FileWatchState): Promise<void> {
    if (state.inFlightRead !== null) {
      state.pendingRead = true;
      await state.inFlightRead;
      return;
    }

    const run = (async () => {
      do {
        state.pendingRead = false;
        await this.readAppendedLines(state);
      } while (state.pendingRead && !this.closed);
    })();

    state.inFlightRead = run;
    try {
      await run;
    } finally {
      state.inFlightRead = null;
    }
  }

  private async readAppendedLines(state: FileWatchState): Promise<void> {
    if (this.closed) {
      return;
    }

    try {
      const currentSize = await getFileSize(state.path);
      if (currentSize <= state.offset) {
        return;
      }

      const fd = await open(state.path, "r");
      try {
        const bytesToRead = currentSize - state.offset;
        const buffer = new Uint8Array(bytesToRead);
        await fd.read(buffer, 0, bytesToRead, state.offset);
        state.offset = currentSize;

        const text = new TextDecoder().decode(buffer);
        const lines = text.split("\n");
        for (const line of lines) {
          const parsed = parseRolloutLine(line);
          if (parsed !== null) {
            this.emit("line", state.path, parsed);
          }
        }
      } finally {
        await fd.close();
      }
    } catch (err: unknown) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }
}

interface FileWatchState {
  path: string;
  offset: number;
  watcher: FSWatcher | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  inFlightRead: Promise<void> | null;
  pendingRead: boolean;
}

async function getFileSize(path: string): Promise<number> {
  try {
    const s = await stat(path);
    return s.size;
  } catch {
    return 0;
  }
}

/**
 * Discover the active sessions directory path for watching.
 */
export function sessionsWatchDir(codexHome: string): string {
  return join(codexHome, "sessions");
}
