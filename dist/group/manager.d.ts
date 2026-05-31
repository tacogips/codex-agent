/**
 * GroupManager - Orchestrates running prompts across multiple sessions in a group.
 *
 * Uses ProcessManager from Phase 2 to spawn Codex processes.
 * Supports concurrency control via maxConcurrent.
 * Emits progress events as an AsyncGenerator.
 */
import type { SessionGroup, GroupEvent, GroupRunOptions } from "./types";
/**
 * Run a prompt across all sessions in a group.
 * Spawns up to maxConcurrent processes simultaneously.
 * Yields GroupEvent objects as sessions start, complete, or fail.
 */
export declare function runGroup(group: SessionGroup, prompt: string, options?: GroupRunOptions): AsyncGenerator<GroupEvent, void, undefined>;
//# sourceMappingURL=manager.d.ts.map