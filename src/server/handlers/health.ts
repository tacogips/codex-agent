/**
 * Health and status endpoint handlers.
 */

import { listSessions } from "../../session/index";
import { listGroups } from "../../group/index";
import { listQueues } from "../../queue/index";
import type { RouteHandler } from "../types";

const startedAt = new Date();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const handleHealth: RouteHandler = () => {
  return json({ status: "ok" });
};

export const handleStatus: RouteHandler = async (_req, _params, config) => {
  const sessionOpts: Parameters<typeof listSessions>[0] & { codexHome?: string } = { limit: 0 };
  if (config.codexHome !== undefined) sessionOpts.codexHome = config.codexHome;

  const [sessions, groups, queues] = await Promise.all([
    listSessions(sessionOpts),
    listGroups(config.configDir),
    listQueues(config.configDir),
  ]);

  return json({
    status: "ok",
    startedAt: startedAt.toISOString(),
    uptime: Math.floor((Date.now() - startedAt.getTime()) / 1000),
    sessions: sessions.total,
    groups: groups.length,
    queues: queues.length,
  });
};
