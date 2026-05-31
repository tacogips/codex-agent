/**
 * RolloutWatcher - Real-time monitoring of Codex rollout files.
 *
 * Uses fs.watch to detect file changes and reads appended JSONL lines
 * incrementally. Also watches session directories for new rollout files.
 */
import { EventEmitter } from "node:events";
import type { RolloutLine } from "../types/rollout";
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
export declare class RolloutWatcher extends EventEmitter<RolloutWatcherEvents> {
    private readonly fileWatchers;
    private readonly dirWatchers;
    private closed;
    /**
     * Watch a single rollout file for appended lines.
     * Emits 'line' events for each new RolloutLine parsed.
     */
    watchFile(path: string, options?: WatchFileOptions): Promise<void>;
    /**
     * Watch a sessions directory for new rollout files.
     * Scans date subdirectories (YYYY/MM/DD/) for new files.
     * Emits 'newSession' events when new rollout files appear.
     */
    watchDirectory(dir: string): void;
    /**
     * Stop all watchers and clean up resources.
     */
    stop(): void;
    /**
     * Flush unread appended data from all watched files.
     */
    flush(): Promise<void>;
    /**
     * Check if the watcher has been stopped.
     */
    get isClosed(): boolean;
    private debouncedReadAppended;
    private enqueueRead;
    private readAppendedLines;
}
/**
 * Discover the active sessions directory path for watching.
 */
export declare function sessionsWatchDir(codexHome: string): string;
//# sourceMappingURL=watcher.d.ts.map