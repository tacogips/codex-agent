/**
 * Queue endpoint handlers.
 */

import {
  createQueue,
  addPrompt,
  findQueue,
  listQueues,
  runQueue,
  removeQueue,
  pauseQueue,
  resumeQueue,
  updateQueueCommand,
  removeQueueCommand,
  moveQueueCommand,
  toggleQueueCommandMode,
} from "../../queue/index";
import { sseResponse } from "../sse";
import type { RouteHandler } from "../types";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** In-memory stop signals for active queue runs. */
const activeQueues = new Map<string, { stopped: boolean }>();

export const handleListQueues: RouteHandler = async (_req, _params, config) => {
  const queues = await listQueues(config.configDir);
  return json(queues);
};

export const handleCreateQueue: RouteHandler = async (req, _params, config) => {
  const body = (await readJsonBody(req)) as {
    name?: string;
    projectPath?: string;
  } | null;
  if (
    body === null ||
    typeof body.name !== "string" ||
    body.name === "" ||
    typeof body.projectPath !== "string" ||
    body.projectPath === ""
  ) {
    return json(
      { error: "Missing required fields: name, projectPath" },
      400,
    );
  }

  const queue = await createQueue(
    body.name,
    body.projectPath,
    config.configDir,
  );
  return json(queue, 201);
};

export const handleGetQueue: RouteHandler = async (_req, params, config) => {
  const id = params["id"];
  if (id === undefined) {
    return json({ error: "Missing queue id" }, 400);
  }

  const queue = await findQueue(id, config.configDir);
  if (queue === null) {
    return json({ error: "Queue not found" }, 404);
  }

  return json(queue);
};

export const handleAddPrompt: RouteHandler = async (req, params, config) => {
  const queueId = params["id"];
  if (queueId === undefined) {
    return json({ error: "Missing queue id" }, 400);
  }

  const queue = await findQueue(queueId, config.configDir);
  if (queue === null) {
    return json({ error: "Queue not found" }, 404);
  }

  const body = (await readJsonBody(req)) as {
    prompt?: string;
    images?: unknown;
  } | null;
  if (body === null || typeof body.prompt !== "string" || body.prompt === "") {
    return json({ error: "Missing required field: prompt" }, 400);
  }
  if (
    body.images !== undefined &&
    (!Array.isArray(body.images) ||
      body.images.some((v) => typeof v !== "string" || v.length === 0))
  ) {
    return json({ error: "Invalid field: images must be a string array" }, 400);
  }

  const prompt = await addPrompt(
    queue.id,
    body.prompt,
    body.images as readonly string[] | undefined,
    config.configDir,
  );
  return json(prompt, 201);
};

export const handleRunQueue: RouteHandler = async (req, params, config) => {
  const queueId = params["id"];
  if (queueId === undefined) {
    return json({ error: "Missing queue id" }, 400);
  }

  const queue = await findQueue(queueId, config.configDir);
  if (queue === null) {
    return json({ error: "Queue not found" }, 404);
  }

  const body = (await readJsonBody(req)) as {
    model?: string;
    sandbox?: string;
    fullAuto?: boolean;
    images?: unknown;
  } | null;
  if (
    body?.images !== undefined &&
    (!Array.isArray(body.images) ||
      body.images.some((v) => typeof v !== "string" || v.length === 0))
  ) {
    return json({ error: "Invalid field: images must be a string array" }, 400);
  }

  const stopSignal = { stopped: false };
  activeQueues.set(queue.id, stopSignal);

  const runOpts: Parameters<typeof runQueue>[1] = {};
  if (body?.model !== undefined) (runOpts as Record<string, unknown>)["model"] = body.model;
  if (body?.fullAuto !== undefined) (runOpts as Record<string, unknown>)["fullAuto"] = body.fullAuto;
  if (body?.images !== undefined) (runOpts as Record<string, unknown>)["images"] = body.images;
  if (config.configDir !== undefined) (runOpts as Record<string, unknown>)["configDir"] = config.configDir;

  const generator = runQueue(queue, runOpts, stopSignal);

  // Wrap generator to clean up stop signal on completion
  const wrapped = cleanupOnDone(generator, () => {
    activeQueues.delete(queue.id);
  });

  return sseResponse(wrapped);
};

export const handleStopQueue: RouteHandler = async (_req, params, _config) => {
  const queueId = params["id"];
  if (queueId === undefined) {
    return json({ error: "Missing queue id" }, 400);
  }

  const signal = activeQueues.get(queueId);
  if (signal === undefined) {
    return json({ error: "Queue is not running" }, 404);
  }

  signal.stopped = true;
  return json({ status: "stopping" });
};

export const handleDeleteQueue: RouteHandler = async (_req, params, config) => {
  const queueId = params["id"];
  if (queueId === undefined) {
    return json({ error: "Missing queue id" }, 400);
  }
  const ok = await removeQueue(queueId, config.configDir);
  if (!ok) {
    return json({ error: "Queue not found" }, 404);
  }
  return json({ ok: true });
};

export const handlePauseQueue: RouteHandler = async (_req, params, config) => {
  const queueId = params["id"];
  if (queueId === undefined) {
    return json({ error: "Missing queue id" }, 400);
  }
  const ok = await pauseQueue(queueId, config.configDir);
  if (!ok) {
    return json({ error: "Queue not found" }, 404);
  }
  return json({ ok: true });
};

export const handleResumeQueue: RouteHandler = async (_req, params, config) => {
  const queueId = params["id"];
  if (queueId === undefined) {
    return json({ error: "Missing queue id" }, 400);
  }
  const ok = await resumeQueue(queueId, config.configDir);
  if (!ok) {
    return json({ error: "Queue not found" }, 404);
  }
  return json({ ok: true });
};

export const handleUpdateQueueCommand: RouteHandler = async (req, params, config) => {
  const queueId = params["id"];
  const commandId = params["cid"];
  if (queueId === undefined || commandId === undefined) {
    return json({ error: "Missing queue or command id" }, 400);
  }
  const body = (await readJsonBody(req)) as {
    prompt?: string;
    status?: "pending" | "running" | "completed" | "failed";
  } | null;
  if (body === null) {
    return json({ error: "Invalid request body" }, 400);
  }
  const ok = await updateQueueCommand(queueId, commandId, body, config.configDir);
  if (!ok) {
    return json({ error: "Queue command not found" }, 404);
  }
  return json({ ok: true });
};

export const handleRemoveQueueCommand: RouteHandler = async (_req, params, config) => {
  const queueId = params["id"];
  const commandId = params["cid"];
  if (queueId === undefined || commandId === undefined) {
    return json({ error: "Missing queue or command id" }, 400);
  }
  const ok = await removeQueueCommand(queueId, commandId, config.configDir);
  if (!ok) {
    return json({ error: "Queue command not found" }, 404);
  }
  return json({ ok: true });
};

export const handleMoveQueueCommand: RouteHandler = async (req, params, config) => {
  const queueId = params["id"];
  if (queueId === undefined) {
    return json({ error: "Missing queue id" }, 400);
  }
  const body = (await readJsonBody(req)) as { from?: number; to?: number } | null;
  if (
    body === null ||
    typeof body.from !== "number" ||
    typeof body.to !== "number"
  ) {
    return json({ error: "Missing required fields: from, to" }, 400);
  }
  const ok = await moveQueueCommand(queueId, body.from, body.to, config.configDir);
  if (!ok) {
    return json({ error: "Queue or command position not found" }, 404);
  }
  return json({ ok: true });
};

export const handleToggleQueueCommandMode: RouteHandler = async (req, params, config) => {
  const queueId = params["id"];
  const commandId = params["cid"];
  if (queueId === undefined || commandId === undefined) {
    return json({ error: "Missing queue or command id" }, 400);
  }
  const body = (await readJsonBody(req)) as { mode?: "auto" | "manual" } | null;
  if (body === null || (body.mode !== "auto" && body.mode !== "manual")) {
    return json({ error: "Missing required field: mode(auto|manual)" }, 400);
  }
  const ok = await toggleQueueCommandMode(queueId, commandId, body.mode, config.configDir);
  if (!ok) {
    return json({ error: "Queue command not found" }, 404);
  }
  return json({ ok: true });
};

async function* cleanupOnDone<T>(
  gen: AsyncGenerator<T, void, undefined>,
  cleanup: () => void,
): AsyncGenerator<T, void, undefined> {
  try {
    for await (const value of gen) {
      yield value;
    }
  } finally {
    cleanup();
  }
}
