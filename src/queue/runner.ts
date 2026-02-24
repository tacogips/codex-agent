/**
 * QueueRunner - Sequentially executes prompts from a queue.
 *
 * Uses ProcessManager.spawnExec for each prompt.
 * Supports stop signaling to halt after current prompt finishes.
 * Persists prompt status after each completion for crash recovery.
 */

import { ProcessManager } from "../process/manager";
import { updateQueuePrompts } from "./repository";
import type { CodexProcessOptions } from "../process/types";
import type { PromptQueue, QueuePrompt, QueueEvent } from "./types";

interface MutablePrompt {
  id: string;
  prompt: string;
  images?: readonly string[] | undefined;
  status: QueuePrompt["status"];
  result?: { exitCode: number } | undefined;
  addedAt: Date;
  startedAt?: Date | undefined;
  completedAt?: Date | undefined;
}

function toQueuePrompt(m: MutablePrompt): QueuePrompt {
  return {
    id: m.id,
    prompt: m.prompt,
    images: m.images,
    status: m.status,
    result: m.result,
    addedAt: m.addedAt,
    startedAt: m.startedAt,
    completedAt: m.completedAt,
  };
}

/**
 * Run all pending prompts in a queue sequentially.
 * Yields QueueEvent objects as prompts start, complete, or fail.
 *
 * Call stopSignal.stop() to halt after the current prompt finishes.
 */
export async function* runQueue(
  queue: PromptQueue,
  options?: CodexProcessOptions & { configDir?: string },
  stopSignal?: { stopped: boolean },
): AsyncGenerator<QueueEvent, void, undefined> {
  if (queue.paused === true) {
    yield {
      type: "queue_stopped",
      queueId: queue.id,
      completed: [],
      pending: queue.prompts.filter((p) => p.status === "pending").map((p) => p.id),
      failed: [],
    };
    return;
  }

  const pm = new ProcessManager(options?.codexBinary);
  const prompts: MutablePrompt[] = queue.prompts.map((p) => ({
    id: p.id,
    prompt: p.prompt,
    images: p.images,
    status: p.status,
    result: p.result,
    addedAt: p.addedAt,
    startedAt: p.startedAt,
    completedAt: p.completedAt,
  }));
  const configDir = options?.configDir;

  const completedIds: string[] = [];
  const failedIds: string[] = [];
  const pendingIds = prompts.filter((p) => p.status === "pending").map((p) => p.id);

  function makeEvent(
    type: QueueEvent["type"],
    promptId?: string,
    exitCode?: number,
  ): QueueEvent {
    const currentPrompt = prompts.find((p) => p.status === "running");
    return {
      type,
      queueId: queue.id,
      promptId,
      exitCode,
      current: currentPrompt?.id,
      completed: [...completedIds],
      pending: [...pendingIds],
      failed: [...failedIds],
    };
  }

  for (const mp of prompts) {
    if (mp.status !== "pending") continue;

    // Check stop signal
    if (stopSignal?.stopped) {
      yield makeEvent("queue_stopped");
      return;
    }

    // Mark as running
    mp.status = "running";
    mp.startedAt = new Date();
    const pidx = pendingIds.indexOf(mp.id);
    if (pidx !== -1) pendingIds.splice(pidx, 1);

    yield makeEvent("prompt_started", mp.id);

    try {
      const result = await pm.spawnExec(mp.prompt, {
        ...options,
        cwd: queue.projectPath,
        images: mergeImages(mp.images, options?.images),
      });

      mp.completedAt = new Date();
      if (result.exitCode === 0) {
        mp.status = "completed";
        mp.result = { exitCode: 0 };
        completedIds.push(mp.id);
        yield makeEvent("prompt_completed", mp.id, 0);
      } else {
        mp.status = "failed";
        mp.result = { exitCode: result.exitCode };
        failedIds.push(mp.id);
        yield makeEvent("prompt_failed", mp.id, result.exitCode);
      }
    } catch {
      mp.status = "failed";
      mp.result = { exitCode: 1 };
      mp.completedAt = new Date();
      failedIds.push(mp.id);
      yield makeEvent("prompt_failed", mp.id, 1);
    }

    // Persist status after each prompt
    await updateQueuePrompts(queue.id, prompts.map(toQueuePrompt), configDir);
  }

  yield makeEvent("queue_completed");
}

function mergeImages(
  promptImages?: readonly string[] | undefined,
  runImages?: readonly string[] | undefined,
): readonly string[] | undefined {
  if (promptImages === undefined && runImages === undefined) {
    return undefined;
  }
  const merged = new Set<string>();
  for (const image of promptImages ?? []) {
    merged.add(image);
  }
  for (const image of runImages ?? []) {
    merged.add(image);
  }
  return [...merged];
}
