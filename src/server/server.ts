/**
 * HTTP server using Bun.serve().
 *
 * Registers REST routes plus a Yoga-backed GraphQL endpoint, handles auth,
 * CORS, 404.
 * WebSocket upgrade at /ws.
 */

import { createYoga } from "graphql-yoga";
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
  handleGetSessionFilePatches,
  handleFindSessionsByFile,
  handleRebuildFileIndex,
} from "./handlers/files";
import { getGraphqlSchema } from "../graphql/index";
import type { RouteHandler, ServerConfig, ServerHandle } from "./types";
import type { ServerWebSocket } from "bun";
import type { Permission } from "../auth/index";
import type { AuthContext } from "./auth";

interface WsData {
  subscribedSessions: Set<string>;
  subscribedNewSessions: boolean;
}

interface GraphqlServerContext {
  readonly authContext?: AuthContext | undefined;
}

interface ServerRouteDefinition {
  readonly method: string;
  readonly pattern: string;
  readonly handler: RouteHandler;
  readonly requiredPermission?: Permission | undefined;
}

const REST_ROUTES: readonly ServerRouteDefinition[] = [
  { method: "GET", pattern: "/health", handler: handleHealth },
  { method: "GET", pattern: "/status", handler: handleStatus },
  {
    method: "GET",
    pattern: "/api/sessions",
    handler: handleListSessions,
    requiredPermission: "session:read",
  },
  {
    method: "GET",
    pattern: "/api/sessions/search",
    handler: handleSearchSessions,
    requiredPermission: "session:read",
  },
  {
    method: "GET",
    pattern: "/api/sessions/:id",
    handler: handleGetSession,
    requiredPermission: "session:read",
  },
  {
    method: "GET",
    pattern: "/api/sessions/:id/search",
    handler: handleSearchSessionTranscript,
    requiredPermission: "session:read",
  },
  {
    method: "GET",
    pattern: "/api/sessions/:id/events",
    handler: handleSessionEvents,
    requiredPermission: "session:read",
  },
  {
    method: "GET",
    pattern: "/api/groups",
    handler: handleListGroups,
    requiredPermission: "group:*",
  },
  {
    method: "POST",
    pattern: "/api/groups",
    handler: handleCreateGroup,
    requiredPermission: "group:*",
  },
  {
    method: "GET",
    pattern: "/api/groups/:id",
    handler: handleGetGroup,
    requiredPermission: "group:*",
  },
  {
    method: "POST",
    pattern: "/api/groups/:id/sessions",
    handler: handleAddSessionToGroup,
    requiredPermission: "group:*",
  },
  {
    method: "DELETE",
    pattern: "/api/groups/:id/sessions/:sid",
    handler: handleRemoveSessionFromGroup,
    requiredPermission: "group:*",
  },
  {
    method: "POST",
    pattern: "/api/groups/:id/run",
    handler: handleRunGroup,
    requiredPermission: "group:*",
  },
  {
    method: "POST",
    pattern: "/api/groups/:id/pause",
    handler: handlePauseGroup,
    requiredPermission: "group:*",
  },
  {
    method: "POST",
    pattern: "/api/groups/:id/resume",
    handler: handleResumeGroup,
    requiredPermission: "group:*",
  },
  {
    method: "DELETE",
    pattern: "/api/groups/:id",
    handler: handleDeleteGroup,
    requiredPermission: "group:*",
  },
  {
    method: "GET",
    pattern: "/api/queues",
    handler: handleListQueues,
    requiredPermission: "queue:*",
  },
  {
    method: "POST",
    pattern: "/api/queues",
    handler: handleCreateQueue,
    requiredPermission: "queue:*",
  },
  {
    method: "GET",
    pattern: "/api/queues/:id",
    handler: handleGetQueue,
    requiredPermission: "queue:*",
  },
  {
    method: "POST",
    pattern: "/api/queues/:id/prompts",
    handler: handleAddPrompt,
    requiredPermission: "queue:*",
  },
  {
    method: "POST",
    pattern: "/api/queues/:id/run",
    handler: handleRunQueue,
    requiredPermission: "queue:*",
  },
  {
    method: "POST",
    pattern: "/api/queues/:id/stop",
    handler: handleStopQueue,
    requiredPermission: "queue:*",
  },
  {
    method: "POST",
    pattern: "/api/queues/:id/pause",
    handler: handlePauseQueue,
    requiredPermission: "queue:*",
  },
  {
    method: "POST",
    pattern: "/api/queues/:id/resume",
    handler: handleResumeQueue,
    requiredPermission: "queue:*",
  },
  {
    method: "DELETE",
    pattern: "/api/queues/:id",
    handler: handleDeleteQueue,
    requiredPermission: "queue:*",
  },
  {
    method: "PATCH",
    pattern: "/api/queues/:id/commands/:cid",
    handler: handleUpdateQueueCommand,
    requiredPermission: "queue:*",
  },
  {
    method: "DELETE",
    pattern: "/api/queues/:id/commands/:cid",
    handler: handleRemoveQueueCommand,
    requiredPermission: "queue:*",
  },
  {
    method: "POST",
    pattern: "/api/queues/:id/commands/move",
    handler: handleMoveQueueCommand,
    requiredPermission: "queue:*",
  },
  {
    method: "POST",
    pattern: "/api/queues/:id/commands/:cid/mode",
    handler: handleToggleQueueCommandMode,
    requiredPermission: "queue:*",
  },
  {
    method: "GET",
    pattern: "/api/files/find",
    handler: handleFindSessionsByFile,
    requiredPermission: "session:read",
  },
  {
    method: "GET",
    pattern: "/api/files/:id",
    handler: handleGetChangedFiles,
    requiredPermission: "session:read",
  },
  {
    method: "GET",
    pattern: "/api/files/:id/patches",
    handler: handleGetSessionFilePatches,
    requiredPermission: "session:read",
  },
  {
    method: "POST",
    pattern: "/api/files/rebuild",
    handler: handleRebuildFileIndex,
    requiredPermission: "session:read",
  },
];

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
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

  const yoga = createYoga<GraphqlServerContext>({
    schema: getGraphqlSchema(),
    graphqlEndpoint: "/graphql",
    landingPage: false,
    graphiql: false,
    maskedErrors: false,
    cors: {
      origin: "*",
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    },
    context: ({ authContext }) => ({
      codexHome: config.codexHome,
      configDir: config.configDir,
      authContext,
      serverMode: true,
    }),
  });

  for (const route of REST_ROUTES) {
    router.add(route.method, route.pattern, route.handler, {
      requiredPermission: route.requiredPermission,
    });
  }

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

      if (url.pathname === "/graphql") {
        const authResult = await authenticateRequest(req, config);
        if (authResult.error !== null) {
          return authResult.error;
        }
        return yoga.fetch(req, {
          authContext: authResult.context ?? undefined,
        });
      }

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

      // Auth + permission checks
      const authResult = await authenticateRequest(req, config);
      if (authResult.error !== null) return authResult.error;
      const permErr = ensurePermission(
        authResult.context,
        match.requiredPermission,
      );
      if (permErr !== null) return permErr;

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
