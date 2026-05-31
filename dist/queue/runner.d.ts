/**
 * QueueRunner - Sequentially executes prompts from a queue.
 *
 * Uses ProcessManager.spawnExec for each prompt.
 * Supports stop signaling to halt after current prompt finishes.
 * Persists prompt status after each completion for crash recovery.
 */
import type { CodexProcessOptions } from "../process/types";
import type { PromptQueue, QueueEvent } from "./types";
/**
 * Run all pending prompts in a queue sequentially.
 * Yields QueueEvent objects as prompts start, complete, or fail.
 *
 * Call stopSignal.stop() to halt after the current prompt finishes.
 */
export declare function runQueue(queue: PromptQueue, options?: CodexProcessOptions & {
    configDir?: string;
}, stopSignal?: {
    stopped: boolean;
}): AsyncGenerator<QueueEvent, void, undefined>;
//# sourceMappingURL=runner.d.ts.map