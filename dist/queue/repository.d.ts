/**
 * QueueRepository - Persistent storage for queue definitions.
 *
 * Stores queues as JSON at ~/.config/codex-agent/queues.json.
 * Uses atomic write (write-to-temp + rename) for crash safety.
 */
import type { PromptQueue, QueuePrompt, QueueCommandMode, QueueConfig } from "./types";
/**
 * Load all queues from persistent storage.
 */
export declare function loadQueues(configDir?: string): Promise<QueueConfig>;
/**
 * Persist queues to storage using atomic write.
 */
export declare function saveQueues(config: QueueConfig, configDir?: string): Promise<void>;
/**
 * Create a new queue.
 */
export declare function createQueue(name: string, projectPath: string, configDir?: string): Promise<PromptQueue>;
/**
 * Add a prompt to a queue.
 */
export declare function addPrompt(queueId: string, prompt: string, images?: readonly string[], configDir?: string): Promise<QueuePrompt>;
/**
 * Delete a queue by ID.
 */
export declare function removeQueue(id: string, configDir?: string): Promise<boolean>;
/**
 * Find a queue by ID or name.
 */
export declare function findQueue(idOrName: string, configDir?: string): Promise<PromptQueue | null>;
/**
 * List all queues.
 */
export declare function listQueues(configDir?: string): Promise<readonly PromptQueue[]>;
/**
 * Update a queue's prompt statuses in storage.
 */
export declare function updateQueuePrompts(queueId: string, prompts: readonly QueuePrompt[], configDir?: string): Promise<void>;
export declare function pauseQueue(queueId: string, configDir?: string): Promise<boolean>;
export declare function resumeQueue(queueId: string, configDir?: string): Promise<boolean>;
export interface UpdateQueueCommandInput {
    readonly prompt?: string | undefined;
    readonly status?: QueuePrompt["status"] | undefined;
}
export declare function updateQueueCommand(queueId: string, commandId: string, patch: UpdateQueueCommandInput, configDir?: string): Promise<boolean>;
export declare function removeQueueCommand(queueId: string, commandId: string, configDir?: string): Promise<boolean>;
export declare function moveQueueCommand(queueId: string, from: number, to: number, configDir?: string): Promise<boolean>;
export declare function toggleQueueCommandMode(queueId: string, commandId: string, mode: QueueCommandMode, configDir?: string): Promise<boolean>;
//# sourceMappingURL=repository.d.ts.map