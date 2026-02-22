/**
 * GroupManager - Orchestrates running prompts across multiple sessions in a group.
 *
 * Uses ProcessManager from Phase 2 to spawn Codex processes.
 * Supports concurrency control via maxConcurrent.
 * Emits progress events as an AsyncGenerator.
 */

import { ProcessManager } from "../process/manager";
import type { SessionGroup, GroupEvent, GroupRunOptions } from "./types";

const DEFAULT_MAX_CONCURRENT = 3;

/**
 * Run a prompt across all sessions in a group.
 * Spawns up to maxConcurrent processes simultaneously.
 * Yields GroupEvent objects as sessions start, complete, or fail.
 */
export async function* runGroup(
  group: SessionGroup,
  prompt: string,
  options?: GroupRunOptions,
): AsyncGenerator<GroupEvent, void, undefined> {
  if (group.paused === true) {
    throw new Error(`group is paused: ${group.id}`);
  }

  const maxConcurrent = options?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const pm = new ProcessManager(options?.codexBinary);

  const pending = [...group.sessionIds];
  const running: string[] = [];
  const completed: string[] = [];
  const failed: string[] = [];

  function makeEvent(
    type: GroupEvent["type"],
    sessionId?: string,
    extra?: { exitCode?: number; error?: string },
  ): GroupEvent {
    return {
      type,
      groupId: group.id,
      sessionId,
      exitCode: extra?.exitCode,
      error: extra?.error,
      running: [...running],
      completed: [...completed],
      failed: [...failed],
      pending: [...pending],
    };
  }

  // Process sessions with concurrency control
  const inFlight = new Map<string, Promise<{ sessionId: string; exitCode: number }>>();

  while (pending.length > 0 || inFlight.size > 0) {
    // Fill up to maxConcurrent
    while (pending.length > 0 && inFlight.size < maxConcurrent) {
      const sessionId = pending.shift()!;
      running.push(sessionId);

      const promise = (async () => {
        try {
          const result = await pm.spawnExec(prompt, {
            ...options,
            cwd: options?.cwd,
          });
          return { sessionId, exitCode: result.exitCode };
        } catch (err) {
          return { sessionId, exitCode: 1 };
        }
      })();

      inFlight.set(sessionId, promise);

      yield makeEvent("session_started", sessionId);
    }

    if (inFlight.size === 0) break;

    // Wait for any one to finish
    const settled = await Promise.race(
      Array.from(inFlight.entries()).map(async ([sid, p]) => {
        const result = await p;
        return { sid, result };
      }),
    );

    const { sid, result } = settled;
    inFlight.delete(sid);
    const runIdx = running.indexOf(sid);
    if (runIdx !== -1) running.splice(runIdx, 1);

    if (result.exitCode === 0) {
      completed.push(sid);
      yield makeEvent("session_completed", sid, { exitCode: 0 });
    } else {
      failed.push(sid);
      yield makeEvent("session_failed", sid, { exitCode: result.exitCode });
    }
  }

  yield makeEvent("group_completed");
}
