/**
 * Queue endpoint handlers.
 */

import {
  createQueue,
  addPrompt,
  findQueue,
  listQueues,
  runQueue,
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

  const body = (await readJsonBody(req)) as { prompt?: string } | null;
  if (body === null || typeof body.prompt !== "string" || body.prompt === "") {
    return json({ error: "Missing required field: prompt" }, 400);
  }

  const prompt = await addPrompt(queue.id, body.prompt, config.configDir);
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
  } | null;

  const stopSignal = { stopped: false };
  activeQueues.set(queue.id, stopSignal);

  const runOpts: Parameters<typeof runQueue>[1] = {};
  if (body?.model !== undefined) (runOpts as Record<string, unknown>)["model"] = body.model;
  if (body?.fullAuto !== undefined) (runOpts as Record<string, unknown>)["fullAuto"] = body.fullAuto;
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
