/**
 * Session endpoint handlers.
 */

import { listSessions, findSession } from "../../session/index";
import { readRollout } from "../../rollout/reader";
import { RolloutWatcher } from "../../rollout/watcher";
import { sseResponse } from "../sse";
import type { RouteHandler } from "../types";
import type { SessionSource } from "../../types/rollout";
import type { RolloutLine } from "../../types/rollout";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isSessionSource(s: string): s is SessionSource {
  return s === "cli" || s === "vscode" || s === "exec" || s === "unknown";
}

export const handleListSessions: RouteHandler = async (req, _params, config) => {
  const url = new URL(req.url);
  const sourceParam = url.searchParams.get("source");
  const source =
    sourceParam !== null && isSessionSource(sourceParam)
      ? sourceParam
      : undefined;
  const cwd = url.searchParams.get("cwd") ?? undefined;
  const branch = url.searchParams.get("branch") ?? undefined;
  const limitStr = url.searchParams.get("limit");
  const limit = limitStr !== null ? parseInt(limitStr, 10) || 50 : 50;
  const offsetStr = url.searchParams.get("offset");
  const offset = offsetStr !== null ? parseInt(offsetStr, 10) || 0 : 0;

  const result = await listSessions({
    limit,
    offset,
    ...(source !== undefined ? { source } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(branch !== undefined ? { branch } : {}),
    ...(config.codexHome !== undefined ? { codexHome: config.codexHome } : {}),
  });

  return json(result);
};

export const handleGetSession: RouteHandler = async (_req, params, config) => {
  const id = params["id"];
  if (id === undefined) {
    return json({ error: "Missing session id" }, 400);
  }

  const session = await findSession(id, config.codexHome);
  if (session === null) {
    return json({ error: "Session not found" }, 404);
  }

  return json(session);
};

export const handleSessionEvents: RouteHandler = async (req, params, config) => {
  const id = params["id"];
  if (id === undefined) {
    return json({ error: "Missing session id" }, 400);
  }

  const session = await findSession(id, config.codexHome);
  if (session === null) {
    return json({ error: "Session not found" }, 404);
  }

  const url = new URL(req.url);
  const follow = url.searchParams.get("follow") === "true";

  if (!follow) {
    const lines = await readRollout(session.rolloutPath);
    return sseResponse(arrayToGenerator(lines));
  }

  // Live tailing via RolloutWatcher
  return sseResponse(watchSession(session.rolloutPath));
};

async function* arrayToGenerator<T>(
  items: readonly T[],
): AsyncGenerator<T, void, undefined> {
  for (const item of items) {
    yield item;
  }
}

async function* watchSession(
  rolloutPath: string,
): AsyncGenerator<RolloutLine, void, undefined> {
  // First emit existing lines
  const existing = await readRollout(rolloutPath);
  for (const line of existing) {
    yield line;
  }

  // Then watch for new lines
  const watcher = new RolloutWatcher();
  const queue: RolloutLine[] = [];
  let resolve: (() => void) | null = null;

  watcher.on("line", (_path, line) => {
    queue.push(line);
    if (resolve !== null) {
      resolve();
      resolve = null;
    }
  });

  await watcher.watchFile(rolloutPath);

  try {
    while (!watcher.isClosed) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        await new Promise<void>((r) => {
          resolve = r;
        });
      }
    }
  } finally {
    watcher.stop();
  }
}
