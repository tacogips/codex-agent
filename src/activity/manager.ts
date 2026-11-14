import { readRollout } from "../rollout/reader";
import { findSession } from "../session/index";
import type { RolloutLine } from "../types/rollout";
import { isEventMsg, isResponseItem } from "../types/rollout";
import type { ActivityEntry, ActivityStatus } from "./types";

function deriveStatus(line: RolloutLine, current: ActivityStatus): ActivityStatus {
  if (isEventMsg(line)) {
    const event = line.payload;
    switch (event.type) {
      case "TurnStarted":
      case "ExecCommandBegin":
        return "running";
      case "TurnComplete":
      case "ExecCommandEnd":
        return "idle";
      case "TurnAborted":
      case "Error":
        return "failed";
      default:
        return current;
    }
  }

  if (isResponseItem(line) && line.payload.type === "local_shell_call") {
    const rawStatus = line.payload.status;
    if (typeof rawStatus !== "string") {
      return current;
    }
    const status = rawStatus.toLowerCase();
    if (status.includes("approval") || status.includes("consent")) {
      return "waiting_approval";
    }
    if (status === "in_progress" || status === "running") {
      return "running";
    }
  }

  return current;
}

export function deriveActivityEntry(
  sessionId: string,
  lines: readonly RolloutLine[],
): ActivityEntry {
  let status: ActivityStatus = "idle";
  let updatedAt = new Date(0).toISOString();

  for (const line of lines) {
    const next = deriveStatus(line, status);
    if (next !== status) {
      status = next;
      updatedAt = line.timestamp;
    }
  }

  return {
    sessionId,
    status,
    updatedAt,
  };
}

export async function getSessionActivity(
  sessionId: string,
  codexHome?: string,
): Promise<ActivityEntry | null> {
  const session = await findSession(sessionId, codexHome);
  if (session === null) {
    return null;
  }
  const lines = await readRollout(session.rolloutPath);
  return deriveActivityEntry(session.id, lines);
}
