/**
 * File-change index endpoint handlers.
 */

import {
  findSessionsByFile,
  getChangedFiles,
  rebuildFileIndex,
} from "../../file-changes/index";
import type { RouteHandler } from "../types";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handleGetChangedFiles: RouteHandler = async (_req, params, config) => {
  const id = params["id"];
  if (id === undefined) {
    return json({ error: "Missing session id" }, 400);
  }

  try {
    const result = await getChangedFiles(id, {
      codexHome: config.codexHome,
      configDir: config.configDir,
    });
    return json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("session not found")) {
      return json({ error: "Session not found" }, 404);
    }
    return json({ error: message }, 500);
  }
};

export const handleFindSessionsByFile: RouteHandler = async (req, _params, config) => {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");
  if (path === null || path.trim().length === 0) {
    return json({ error: "Missing required query parameter: path" }, 400);
  }

  const result = await findSessionsByFile(path, { configDir: config.configDir });
  return json(result);
};

export const handleRebuildFileIndex: RouteHandler = async (_req, _params, config) => {
  const stats = await rebuildFileIndex(config.configDir, config.codexHome);
  return json(stats);
};

