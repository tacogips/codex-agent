export type ActivityStatus = "idle" | "running" | "waiting_approval" | "failed";

export interface ActivityEntry {
  readonly sessionId: string;
  readonly status: ActivityStatus;
  readonly updatedAt: string;
}

