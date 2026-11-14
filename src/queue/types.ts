/**
 * Types for sequential prompt queue execution.
 */

export const QUEUE_PROMPT_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;

export type QueuePromptStatus = (typeof QUEUE_PROMPT_STATUSES)[number];

export const QUEUE_COMMAND_MODES = ["auto", "manual"] as const;

export type QueueCommandMode = (typeof QUEUE_COMMAND_MODES)[number];

export interface QueuePrompt {
  readonly id: string;
  readonly prompt: string;
  readonly images?: readonly string[] | undefined;
  readonly status: QueuePromptStatus;
  readonly mode?: QueueCommandMode | undefined;
  readonly result?: { exitCode: number } | undefined;
  readonly addedAt: Date;
  readonly startedAt?: Date | undefined;
  readonly completedAt?: Date | undefined;
}

export interface PromptQueue {
  readonly id: string;
  readonly name: string;
  readonly projectPath: string;
  readonly paused?: boolean | undefined;
  readonly prompts: readonly QueuePrompt[];
  readonly createdAt: Date;
}

export type QueueEventType =
  | "prompt_started"
  | "prompt_completed"
  | "prompt_failed"
  | "queue_completed"
  | "queue_stopped";

export interface QueueEvent {
  readonly type: QueueEventType;
  readonly queueId: string;
  readonly promptId?: string | undefined;
  readonly exitCode?: number | undefined;
  readonly current?: string | undefined;
  readonly completed: readonly string[];
  readonly pending: readonly string[];
  readonly failed: readonly string[];
}

/**
 * Serializable representations for JSON persistence.
 */
export interface QueuePromptData {
  readonly id: string;
  readonly prompt: string;
  readonly images?: readonly string[] | undefined;
  readonly status: QueuePromptStatus;
  readonly mode?: QueueCommandMode | undefined;
  readonly result?: { exitCode: number } | undefined;
  readonly addedAt: string;
  readonly startedAt?: string | undefined;
  readonly completedAt?: string | undefined;
}

export interface PromptQueueData {
  readonly id: string;
  readonly name: string;
  readonly projectPath: string;
  readonly paused?: boolean | undefined;
  readonly prompts: readonly QueuePromptData[];
  readonly createdAt: string;
}

export interface QueueConfig {
  readonly queues: readonly PromptQueueData[];
}
