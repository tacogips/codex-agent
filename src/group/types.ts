/**
 * Types for multi-session group orchestration.
 */

import type { CodexProcessOptions } from "../process/types";

export interface SessionGroup {
  readonly id: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly sessionIds: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface GroupRunOptions extends CodexProcessOptions {
  readonly maxConcurrent?: number | undefined;
}

export type GroupEventType =
  | "session_started"
  | "session_completed"
  | "session_failed"
  | "group_completed";

export interface GroupEvent {
  readonly type: GroupEventType;
  readonly groupId: string;
  readonly sessionId?: string | undefined;
  readonly exitCode?: number | undefined;
  readonly error?: string | undefined;
  readonly running: readonly string[];
  readonly completed: readonly string[];
  readonly failed: readonly string[];
  readonly pending: readonly string[];
}

/**
 * Serializable representation for JSON persistence.
 */
export interface SessionGroupData {
  readonly id: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly sessionIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GroupConfig {
  readonly groups: readonly SessionGroupData[];
}
