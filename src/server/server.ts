/**
 * HTTP server using Bun.serve().
 *
 * Registers all REST routes, handles auth, CORS, 404.
 * WebSocket upgrade at /ws.
 */

import { Router } from "./router";
import { authenticateRequest, ensurePermission } from "./auth";
import { WebSocketManager } from "./websocket";
import { createAppServerClient } from "./app-server-client";
import { handleHealth, handleStatus } from "./handlers/health";
import {
  handleListSessions,
  handleSearchSessions,
  handleGetSession,
  handleSearchSessionTranscript,
  handleSessionEvents,
} from "./handlers/sessions";
import {
  handleListGroups,
  handleCreateGroup,
  handleGetGroup,
  handleAddSessionToGroup,
  handleRemoveSessionFromGroup,
  handleRunGroup,
  handlePauseGroup,
  handleResumeGroup,
  handleDeleteGroup,
} from "./handlers/groups";
import {
  handleListQueues,
  handleCreateQueue,
  handleGetQueue,
  handleAddPrompt,
  handleRunQueue,
  handleStopQueue,
  handleDeleteQueue,
  handlePauseQueue,
  handleResumeQueue,
  handleUpdateQueueCommand,
  handleRemoveQueueCommand,
  handleMoveQueueCommand,
  handleToggleQueueCommandMode,
} from "./handlers/queues";
import {
  handleGetChangedFiles,
  handleFindSessionsByFile,
  handleRebuildFileIndex,
} from "./handlers/files";
import type { ServerConfig, ServerHandle } from "./types";
import type { ServerWebSocket } from "bun";
import type { Permission } from "../auth/index";

interface WsData {
  subscribedSessions: Set<string>;
  subscribedNewSessions: boolean;
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function requiredPermission(method: string, path: string): Permission | undefined {
  if (path === "/health" || path === "/status" || path === "/ws") {
    return undefined;
  }

  if (path === "/api/sessions" && method === "GET") {
    return "session:read";
  }
  if (path.startsWith("/api/sessions/") && method === "GET") {
    return "session:read";
  }
  if (path.startsWith("/api/groups")) {
    return "group:*";
  }
  if (path.startsWith("/api/queues")) {
    return "queue:*";
  }
  if (path.startsWith("/api/files")) {
    return "session:read";
  }
  if (path.startsWith("/api/bookmarks")) {
    return "bookmark:*";
  }
  return undefined;
}

export function startServer(config: ServerConfig): ServerHandle {
  const router = new Router();
  const wsManager = new WebSocketManager(config.codexHome);
  const appServerClient =
    config.transport === "app-server" && config.appServerUrl !== undefined
      ? createAppServerClient({ url: config.appServerUrl })
      : null;

  if (appServerClient !== null) {
    void appServerClient.connect().then(
      () => {
        appServerClient.subscribe((event) => {
          if (event.type === "new_session") {
            const payload =
              typeof event.payload === "object" && event.payload !== null
                ? (event.payload as Record<string, unknown>)
                : {};
            const path =
              typeof payload["path"] === "string" ? payload["path"] : "";
            if (path !== "") {
              wsManager.publishNewSession(path);
            }
            return;
          }
          if (event.type === "session_event" && event.sessionId !== undefined) {
            wsManager.publishSessionEvent(event.sessionId, event.payload);
          }
        });
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to connect app-server client: ${message}`);
      },
    );
  }

  // Health
  router.add("GET", "/health", handleHealth);
  router.add("GET", "/status", handleStatus);

  // Sessions
  router.add("GET", "/api/sessions", handleListSessions);
  router.add("GET", "/api/sessions/search", handleSearchSessions);
  router.add("GET", "/api/sessions/:id", handleGetSession);
  router.add("GET", "/api/sessions/:id/search", handleSearchSessionTranscript);
  router.add("GET", "/api/sessions/:id/events", handleSessionEvents);

  // Groups
  router.add("GET", "/api/groups", handleListGroups);
  router.add("POST", "/api/groups", handleCreateGroup);
  router.add("GET", "/api/groups/:id", handleGetGroup);
  router.add("POST", "/api/groups/:id/sessions", handleAddSessionToGroup);
  router.add(
    "DELETE",
    "/api/groups/:id/sessions/:sid",
    handleRemoveSessionFromGroup,
  );
  router.add("POST", "/api/groups/:id/run", handleRunGroup);
  router.add("POST", "/api/groups/:id/pause", handlePauseGroup);
  router.add("POST", "/api/groups/:id/resume", handleResumeGroup);
  router.add("DELETE", "/api/groups/:id", handleDeleteGroup);

  // Queues
  router.add("GET", "/api/queues", handleListQueues);
  router.add("POST", "/api/queues", handleCreateQueue);
  router.add("GET", "/api/queues/:id", handleGetQueue);
  router.add("POST", "/api/queues/:id/prompts", handleAddPrompt);
  router.add("POST", "/api/queues/:id/run", handleRunQueue);
  router.add("POST", "/api/queues/:id/stop", handleStopQueue);
  router.add("POST", "/api/queues/:id/pause", handlePauseQueue);
  router.add("POST", "/api/queues/:id/resume", handleResumeQueue);
  router.add("DELETE", "/api/queues/:id", handleDeleteQueue);
  router.add("PATCH", "/api/queues/:id/commands/:cid", handleUpdateQueueCommand);
  router.add("DELETE", "/api/queues/:id/commands/:cid", handleRemoveQueueCommand);
  router.add("POST", "/api/queues/:id/commands/move", handleMoveQueueCommand);
  router.add("POST", "/api/queues/:id/commands/:cid/mode", handleToggleQueueCommandMode);

  // File-change index
  router.add("GET", "/api/files/find", handleFindSessionsByFile);
  router.add("GET", "/api/files/:id", handleGetChangedFiles);
  router.add("POST", "/api/files/rebuild", handleRebuildFileIndex);

  const startedAt = new Date();

  const server = Bun.serve<WsData>({
    port: config.port,
    hostname: config.hostname,

    async fetch(req, server) {
      const url = new URL(req.url);

      // CORS preflight
      if (req.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }

      // WebSocket upgrade
      if (url.pathname === "/ws") {
        const upgraded = server.upgrade<WsData>(req, {
          data: wsManager.createWsData(),
        });
        if (upgraded) return undefined as unknown as Response;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Auth + permission checks
      const authResult = await authenticateRequest(req, config);
      if (authResult.error !== null) return authResult.error;
      const permErr = ensurePermission(
        authResult.context,
        requiredPermission(req.method, url.pathname),
      );
      if (permErr !== null) return permErr;

      // Route matching
      const match = router.match(req.method, url.pathname);
      if (match === null) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(),
          },
        });
      }

      try {
        const response = await match.handler(req, match.params, config);
        // Add CORS headers to response
        for (const [key, val] of Object.entries(corsHeaders())) {
          response.headers.set(key, val);
        }
        return response;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Internal server error";
        return new Response(JSON.stringify({ error: message }), {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders(),
          },
        });
      }
    },

    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        wsManager.handleOpen(ws);
      },
      message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
        wsManager.handleMessage(ws, message);
      },
      close(ws: ServerWebSocket<WsData>) {
        wsManager.handleClose(ws);
      },
    },
  });

  return {
    port: server.port,
    hostname: server.hostname,
    startedAt,
    stop() {
      wsManager.stop();
      void appServerClient?.close();
      server.stop();
    },
  };
}
