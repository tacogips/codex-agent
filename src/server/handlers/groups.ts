/**
 * Group endpoint handlers.
 */

import {
  addGroup,
  findGroup,
  listGroups,
  addSessionToGroup,
  removeSessionFromGroup,
  removeGroup,
  pauseGroup,
  resumeGroup,
  runGroup,
} from "../../group/index";
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

export const handleListGroups: RouteHandler = async (_req, _params, config) => {
  const groups = await listGroups(config.configDir);
  return json(groups);
};

export const handleCreateGroup: RouteHandler = async (req, _params, config) => {
  const body = (await readJsonBody(req)) as {
    name?: string;
    description?: string;
  } | null;
  if (body === null || typeof body.name !== "string" || body.name === "") {
    return json({ error: "Missing required field: name" }, 400);
  }

  const group = await addGroup(body.name, body.description, config.configDir);
  return json(group, 201);
};

export const handleGetGroup: RouteHandler = async (_req, params, config) => {
  const id = params["id"];
  if (id === undefined) {
    return json({ error: "Missing group id" }, 400);
  }

  const group = await findGroup(id, config.configDir);
  if (group === null) {
    return json({ error: "Group not found" }, 404);
  }

  return json(group);
};

export const handleAddSessionToGroup: RouteHandler = async (
  req,
  params,
  config,
) => {
  const groupId = params["id"];
  if (groupId === undefined) {
    return json({ error: "Missing group id" }, 400);
  }

  const group = await findGroup(groupId, config.configDir);
  if (group === null) {
    return json({ error: "Group not found" }, 404);
  }

  const body = (await readJsonBody(req)) as {
    sessionId?: string;
  } | null;
  if (
    body === null ||
    typeof body.sessionId !== "string" ||
    body.sessionId === ""
  ) {
    return json({ error: "Missing required field: sessionId" }, 400);
  }

  await addSessionToGroup(group.id, body.sessionId, config.configDir);
  return json({ ok: true });
};

export const handleRemoveSessionFromGroup: RouteHandler = async (
  _req,
  params,
  config,
) => {
  const groupId = params["id"];
  const sessionId = params["sid"];
  if (groupId === undefined || sessionId === undefined) {
    return json({ error: "Missing group or session id" }, 400);
  }

  const group = await findGroup(groupId, config.configDir);
  if (group === null) {
    return json({ error: "Group not found" }, 404);
  }

  await removeSessionFromGroup(group.id, sessionId, config.configDir);
  return json({ ok: true });
};

export const handleRunGroup: RouteHandler = async (req, params, config) => {
  const groupId = params["id"];
  if (groupId === undefined) {
    return json({ error: "Missing group id" }, 400);
  }

  const group = await findGroup(groupId, config.configDir);
  if (group === null) {
    return json({ error: "Group not found" }, 404);
  }

  const body = (await readJsonBody(req)) as {
    prompt?: string;
    maxConcurrent?: number;
    model?: string;
    sandbox?: string;
    fullAuto?: boolean;
  } | null;
  if (body === null || typeof body.prompt !== "string" || body.prompt === "") {
    return json({ error: "Missing required field: prompt" }, 400);
  }

  const generator = runGroup(group, body.prompt, {
    maxConcurrent: body.maxConcurrent,
    model: body.model,
    fullAuto: body.fullAuto,
  });

  return sseResponse(generator);
};

export const handlePauseGroup: RouteHandler = async (_req, params, config) => {
  const groupId = params["id"];
  if (groupId === undefined) {
    return json({ error: "Missing group id" }, 400);
  }
  const ok = await pauseGroup(groupId, config.configDir);
  if (!ok) {
    return json({ error: "Group not found" }, 404);
  }
  return json({ ok: true });
};

export const handleResumeGroup: RouteHandler = async (_req, params, config) => {
  const groupId = params["id"];
  if (groupId === undefined) {
    return json({ error: "Missing group id" }, 400);
  }
  const ok = await resumeGroup(groupId, config.configDir);
  if (!ok) {
    return json({ error: "Group not found" }, 404);
  }
  return json({ ok: true });
};

export const handleDeleteGroup: RouteHandler = async (_req, params, config) => {
  const groupId = params["id"];
  if (groupId === undefined) {
    return json({ error: "Missing group id" }, 400);
  }
  const ok = await removeGroup(groupId, config.configDir);
  if (!ok) {
    return json({ error: "Group not found" }, 404);
  }
  return json({ ok: true });
};
