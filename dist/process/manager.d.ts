/**
 * ProcessManager - Spawn and manage Codex CLI subprocesses.
 *
 * Supports exec mode (non-interactive), resume, and fork.
 * Parses JSONL output from `codex exec --json`.
 */
import type { CodexProcess, CodexProcessOptions, ExecResult, ExecStreamResult } from "./types";
/**
 * Manages Codex CLI subprocess lifecycle.
 */
export declare class ProcessManager {
    private readonly processes;
    private readonly binary;
    constructor(binary?: string);
    /**
     * Spawn a non-interactive `codex exec --json` process.
     * Returns the parsed JSONL output and exit code once complete.
     */
    spawnExec(prompt: string, options?: CodexProcessOptions): Promise<ExecResult>;
    /**
     * Spawn `codex exec --json` and stream parsed JSONL lines in real-time.
     * Returns a process handle, line stream, and completion promise.
     */
    spawnExecStream(prompt: string, options?: CodexProcessOptions): ExecStreamResult;
    /**
     * Spawn `codex exec resume --json <sessionId> [prompt]` as a non-interactive process.
     * Returns the process handle for monitoring.
     */
    spawnResume(sessionId: string, options?: CodexProcessOptions, prompt?: string): CodexProcess;
    /**
     * Spawn `codex exec resume --json <sessionId> [prompt]` and stream parsed JSONL lines.
     * This is used by higher-level session orchestration to combine stdout with rollout watch.
     */
    spawnResumeStream(sessionId: string, options?: CodexProcessOptions, prompt?: string): ExecStreamResult;
    /**
     * Spawn `codex fork <sessionId>` as an interactive process.
     * Returns the process handle for monitoring.
     */
    spawnFork(sessionId: string, nthMessage?: number, options?: CodexProcessOptions): CodexProcess;
    /**
     * List all tracked processes.
     */
    list(): readonly CodexProcess[];
    /**
     * Get a specific process by ID.
     */
    get(id: string): CodexProcess | null;
    /**
     * Kill a running process.
     */
    kill(id: string): boolean;
    /**
     * Write plain text input to a running interactive process.
     */
    writeInput(id: string, input: string): boolean;
    /**
     * Kill all running processes.
     */
    killAll(): void;
    /**
     * Remove completed/killed processes from tracking.
     */
    prune(): number;
    private spawnTracked;
}
//# sourceMappingURL=manager.d.ts.map