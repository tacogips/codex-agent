import type { RolloutLine } from "../types/rollout";
import type { ActivityEntry } from "./types";
export declare function deriveActivityEntry(sessionId: string, lines: readonly RolloutLine[]): ActivityEntry;
export declare function getSessionActivity(sessionId: string, codexHome?: string): Promise<ActivityEntry | null>;
//# sourceMappingURL=manager.d.ts.map