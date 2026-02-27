import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "./server";
import { Router } from "./router";
import { checkAuth } from "./auth";
import { sseResponse } from "./sse";
import { resolveServerConfig } from "./types";
import type { ServerHandle } from "./types";
import { createToken } from "../auth/index";

// ---------------------------------------------------------------------------
// Router unit tests
// ---------------------------------------------------------------------------

describe("Router", () => {
  it("matches exact paths", () => {
    const router = new Router();
    router.add("GET", "/health", async () => new Response("ok"));
    const match = router.match("GET", "/health");
    expect(match).not.toBeNull();
    expect(match!.params).toEqual({});
  });

  it("matches paths with params", () => {
    const router = new Router();
    router.add("GET", "/api/sessions/:id", async () => new Response("ok"));
    const match = router.match("GET", "/api/sessions/abc123");
    expect(match).not.toBeNull();
    expect(match!.params).toEqual({ id: "abc123" });
  });

  it("matches paths with multiple params", () => {
    const router = new Router();
    router.add("DELETE", "/api/groups/:id/sessions/:sid", async () => new Response("ok"));
    const match = router.match("DELETE", "/api/groups/g1/sessions/s2");
    expect(match).not.toBeNull();
    expect(match!.params).toEqual({ id: "g1", sid: "s2" });
  });

  it("returns null for non-matching path", () => {
    const router = new Router();
    router.add("GET", "/health", async () => new Response("ok"));
    expect(router.match("GET", "/status")).toBeNull();
  });

  it("returns null for wrong method", () => {
    const router = new Router();
    router.add("GET", "/health", async () => new Response("ok"));
    expect(router.match("POST", "/health")).toBeNull();
  });

  it("is case-insensitive on method", () => {
    const router = new Router();
    router.add("get", "/health", async () => new Response("ok"));
    expect(router.match("GET", "/health")).not.toBeNull();
  });

  it("handles trailing slashes in path", () => {
    const router = new Router();
    router.add("GET", "/api/sessions", async () => new Response("ok"));
    // Path with trailing slash should still match since we split/filter empty
    expect(router.match("GET", "/api/sessions/")).not.toBeNull();
  });

  it("does not match partial segments", () => {
    const router = new Router();
    router.add("GET", "/api/sessions", async () => new Response("ok"));
    expect(router.match("GET", "/api/sessions/extra/path")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Auth unit tests
// ---------------------------------------------------------------------------

describe("checkAuth", () => {
  it("returns null when no token configured", () => {
    const req = new Request("http://localhost/health");
    expect(checkAuth(req, undefined)).toBeNull();
  });

  it("returns null for valid Bearer token", () => {
    const req = new Request("http://localhost/health", {
      headers: { Authorization: "Bearer secret123" },
    });
    expect(checkAuth(req, "secret123")).toBeNull();
  });

  it("returns 401 for missing Authorization header", () => {
    const req = new Request("http://localhost/health");
    const resp = checkAuth(req, "secret123");
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(401);
  });

  it("returns 401 for wrong token", () => {
    const req = new Request("http://localhost/health", {
      headers: { Authorization: "Bearer wrong" },
    });
    const resp = checkAuth(req, "secret123");
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(401);
  });

  it("returns 401 for non-Bearer auth", () => {
    const req = new Request("http://localhost/health", {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    const resp = checkAuth(req, "secret123");
    expect(resp).not.toBeNull();
    expect(resp!.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// SSE unit tests
// ---------------------------------------------------------------------------

describe("sseResponse", () => {
  it("returns text/event-stream content type", () => {
    async function* gen(): AsyncGenerator<string, void, undefined> {
      yield "hello";
    }
    const resp = sseResponse(gen());
    expect(resp.headers.get("Content-Type")).toBe("text/event-stream");
    expect(resp.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("streams data as SSE events", async () => {
    async function* gen(): AsyncGenerator<{ n: number }, void, undefined> {
      yield { n: 1 };
      yield { n: 2 };
    }
    const resp = sseResponse(gen());
    const text = await resp.text();
    expect(text).toContain('data: {"n":1}\n\n');
    expect(text).toContain('data: {"n":2}\n\n');
  });

  it("handles empty generator", async () => {
    async function* gen(): AsyncGenerator<never, void, undefined> {
      // empty
    }
    const resp = sseResponse(gen());
    const text = await resp.text();
    expect(text).toBe("");
  });
});

// ---------------------------------------------------------------------------
// resolveServerConfig
// ---------------------------------------------------------------------------

describe("resolveServerConfig", () => {
  it("uses defaults when no overrides", () => {
    const config = resolveServerConfig();
    expect(config.port).toBe(3100);
    expect(config.hostname).toBe("127.0.0.1");
    expect(config.token).toBeUndefined();
    expect(config.transport).toBe("local-cli");
    expect(config.appServerUrl).toBeUndefined();
  });

  it("uses explicit overrides", () => {
    const config = resolveServerConfig({ port: 8080, hostname: "0.0.0.0" });
    expect(config.port).toBe(8080);
    expect(config.hostname).toBe("0.0.0.0");
  });

  it("sets token when provided", () => {
    const config = resolveServerConfig({ token: "abc" });
    expect(config.token).toBe("abc");
  });

  it("accepts app-server transport when appServerUrl is set", () => {
    const config = resolveServerConfig({
      transport: "app-server",
      appServerUrl: "ws://127.0.0.1:9999/ws",
    });
    expect(config.transport).toBe("app-server");
    expect(config.appServerUrl).toBe("ws://127.0.0.1:9999/ws");
  });

  it("throws when app-server transport is missing appServerUrl", () => {
    expect(() => resolveServerConfig({ transport: "app-server" })).toThrow(
      "app-server transport requires appServerUrl",
    );
  });
});

// ---------------------------------------------------------------------------
// HTTP endpoint integration tests
// ---------------------------------------------------------------------------

describe("HTTP Server", () => {
  let server: ServerHandle;
  let baseUrl: string;
  let codexHome: string;
  let configDir: string;

  beforeAll(async () => {
    codexHome = await mkdtemp(join(tmpdir(), "codex-agent-server-home-"));
    configDir = await mkdtemp(join(tmpdir(), "codex-agent-server-config-"));

    // Create a minimal session structure for testing
    const today = new Date();
    const dateDir = join(
      codexHome,
      "sessions",
      String(today.getFullYear()),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    );
    await mkdir(dateDir, { recursive: true });

    // Create a fake rollout file
    const sessionMeta = JSON.stringify({
      type: "session_meta",
      session_id: "test-session-001",
      model_provider: "openai",
      cwd: "/tmp/test",
      cli_version: "1.0.0",
      title: "Test Session",
    });
    await writeFile(
      join(dateDir, "rollout-test-session-001.jsonl"),
      sessionMeta + "\n",
    );

    server = startServer({
      port: 0, // random port
      hostname: "127.0.0.1",
      codexHome,
      configDir,
      transport: "local-cli",
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    server.stop();
    await rm(codexHome, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  });

  // Health endpoints

  it("GET /health returns ok", async () => {
    const resp = await fetch(`${baseUrl}/health`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("GET /status returns server status", async () => {
    const resp = await fetch(`${baseUrl}/status`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
    expect(body["uptime"]).toBeTypeOf("number");
    expect(body["sessions"]).toBeTypeOf("number");
    expect(body["groups"]).toBeTypeOf("number");
    expect(body["queues"]).toBeTypeOf("number");
  });

  // CORS

  it("OPTIONS returns CORS headers", async () => {
    const resp = await fetch(`${baseUrl}/health`, { method: "OPTIONS" });
    expect(resp.status).toBe(204);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("GET responses include CORS headers", async () => {
    const resp = await fetch(`${baseUrl}/health`);
    expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  // 404

  it("returns 404 for unknown routes", async () => {
    const resp = await fetch(`${baseUrl}/unknown`);
    expect(resp.status).toBe(404);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body["error"]).toBe("Not found");
  });

  // Session endpoints

  it("GET /api/sessions returns session list", async () => {
    const resp = await fetch(`${baseUrl}/api/sessions`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body["sessions"]).toBeInstanceOf(Array);
    expect(body["total"]).toBeTypeOf("number");
  });

  it("GET /api/sessions/:id returns 404 for non-existent session", async () => {
    const resp = await fetch(`${baseUrl}/api/sessions/nonexistent`);
    expect(resp.status).toBe(404);
  });

  it("GET /api/sessions/:id/events returns 404 for non-existent session", async () => {
    const resp = await fetch(`${baseUrl}/api/sessions/nonexistent/events`);
    expect(resp.status).toBe(404);
  });

  // Group endpoints

  it("GET /api/groups returns empty list", async () => {
    const resp = await fetch(`${baseUrl}/api/groups`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toEqual([]);
  });

  it("POST /api/groups creates a group", async () => {
    const resp = await fetch(`${baseUrl}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-group", description: "A test" }),
    });
    expect(resp.status).toBe(201);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body["name"]).toBe("test-group");
    expect(body["id"]).toBeTypeOf("string");
  });

  it("POST /api/groups returns 400 for missing name", async () => {
    const resp = await fetch(`${baseUrl}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(resp.status).toBe(400);
  });

  it("GET /api/groups/:id returns 404 for unknown group", async () => {
    const resp = await fetch(`${baseUrl}/api/groups/nonexistent`);
    expect(resp.status).toBe(404);
  });

  it("POST /api/groups/:id/sessions returns 404 for unknown group", async () => {
    const resp = await fetch(`${baseUrl}/api/groups/nonexistent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "s1" }),
    });
    expect(resp.status).toBe(404);
  });

  it("POST /api/groups/:id/run returns 404 for unknown group", async () => {
    const resp = await fetch(`${baseUrl}/api/groups/nonexistent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test" }),
    });
    expect(resp.status).toBe(404);
  });

  // Queue endpoints

  it("GET /api/queues returns empty list", async () => {
    const resp = await fetch(`${baseUrl}/api/queues`);
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toEqual([]);
  });

  it("POST /api/queues creates a queue", async () => {
    const resp = await fetch(`${baseUrl}/api/queues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-queue", projectPath: "/tmp/project" }),
    });
    expect(resp.status).toBe(201);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body["name"]).toBe("test-queue");
    expect(body["id"]).toBeTypeOf("string");
  });

  it("POST /api/queues returns 400 for missing fields", async () => {
    const resp = await fetch(`${baseUrl}/api/queues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "q" }),
    });
    expect(resp.status).toBe(400);
  });

  it("GET /api/queues/:id returns 404 for unknown queue", async () => {
    const resp = await fetch(`${baseUrl}/api/queues/nonexistent`);
    expect(resp.status).toBe(404);
  });

  it("POST /api/queues/:id/prompts returns 404 for unknown queue", async () => {
    const resp = await fetch(`${baseUrl}/api/queues/nonexistent/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test" }),
    });
    expect(resp.status).toBe(404);
  });

  it("POST /api/queues/:id/prompts returns 400 for invalid images payload", async () => {
    const createResp = await fetch(`${baseUrl}/api/queues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "img-queue", projectPath: "/tmp/project" }),
    });
    const created = (await createResp.json()) as Record<string, unknown>;
    const queueId = created["id"] as string;

    const resp = await fetch(`${baseUrl}/api/queues/${queueId}/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "test", images: ["ok.png", 123] }),
    });
    expect(resp.status).toBe(400);
  });

  it("POST /api/queues/:id/stop returns 404 when queue not running", async () => {
    const resp = await fetch(`${baseUrl}/api/queues/nonexistent/stop`, {
      method: "POST",
    });
    expect(resp.status).toBe(404);
  });

  // File-change endpoints

  it("GET /api/files/find returns 400 when path query is missing", async () => {
    const resp = await fetch(`${baseUrl}/api/files/find`);
    expect(resp.status).toBe(400);
  });

  it("POST /api/files/rebuild returns index stats", async () => {
    const resp = await fetch(`${baseUrl}/api/files/rebuild`, {
      method: "POST",
    });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body["indexedSessions"]).toBeTypeOf("number");
    expect(body["indexedFiles"]).toBeTypeOf("number");
  });
});

describe("HTTP Session Search API", () => {
  let server: ServerHandle;
  let baseUrl: string;
  let codexHome: string;
  let configDir: string;

  beforeAll(async () => {
    codexHome = await mkdtemp(join(tmpdir(), "codex-agent-search-home-"));
    configDir = await mkdtemp(join(tmpdir(), "codex-agent-search-config-"));

    const dayDir = join(codexHome, "sessions", "2026", "02", "27");
    await mkdir(dayDir, { recursive: true });

    const sessionId = "search-session-001";
    const rolloutPath = join(dayDir, `rollout-${sessionId}.jsonl`);

    const lines = [
      JSON.stringify({
        timestamp: "2026-02-27T10:00:00.000Z",
        type: "session_meta",
        payload: {
          meta: {
            id: sessionId,
            timestamp: "2026-02-27T10:00:00.000Z",
            cwd: "/tmp/search-project",
            originator: "codex",
            cli_version: "1.0.0",
            source: "cli",
          },
          git: {
            branch: "main",
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-27T10:00:01.000Z",
        type: "event_msg",
        payload: {
          type: "UserMessage",
          message: "Please tune performance",
        },
      }),
      JSON.stringify({
        timestamp: "2026-02-27T10:00:02.000Z",
        type: "event_msg",
        payload: {
          type: "AgentMessage",
          message: "もう一度 試してください",
        },
      }),
    ].join("\n");
    await writeFile(rolloutPath, lines + "\n", "utf-8");

    server = startServer({
      port: 0,
      hostname: "127.0.0.1",
      codexHome,
      configDir,
      transport: "local-cli",
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    server.stop();
    await rm(codexHome, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  });

  it("GET /api/sessions/search returns matching session IDs", async () => {
    const resp = await fetch(`${baseUrl}/api/sessions/search?q=performance&role=user`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body["sessionIds"]).toEqual(["search-session-001"]);
    expect(body["total"]).toBe(1);
  });

  it("GET /api/sessions/:id/search finds multilingual transcript text", async () => {
    const resp = await fetch(
      `${baseUrl}/api/sessions/search-session-001/search?q=${encodeURIComponent("もう一度")}&role=assistant`,
    );
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body["matched"]).toBe(true);
    expect(body["matchCount"]).toBeTypeOf("number");
  });

  it("returns 400 for empty query", async () => {
    const resp = await fetch(`${baseUrl}/api/sessions/search?q=`);
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(body["error"]).toBe("Missing search query: q");
  });
});

// ---------------------------------------------------------------------------
// HTTP Server with auth enabled
// ---------------------------------------------------------------------------

describe("HTTP Server with auth", () => {
  let server: ServerHandle;
  let baseUrl: string;
  let codexHome: string;
  let configDir: string;
  const TOKEN = "test-secret-token";

  beforeAll(async () => {
    codexHome = await mkdtemp(join(tmpdir(), "codex-agent-auth-home-"));
    configDir = await mkdtemp(join(tmpdir(), "codex-agent-auth-config-"));

    await mkdir(join(codexHome, "sessions"), { recursive: true });

    server = startServer({
      port: 0,
      hostname: "127.0.0.1",
      token: TOKEN,
      codexHome,
      configDir,
      transport: "local-cli",
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    server.stop();
    await rm(codexHome, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  });

  it("rejects requests without token", async () => {
    const resp = await fetch(`${baseUrl}/health`);
    expect(resp.status).toBe(401);
  });

  it("rejects requests with wrong token", async () => {
    const resp = await fetch(`${baseUrl}/health`, {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(resp.status).toBe(401);
  });

  it("accepts requests with correct token", async () => {
    const resp = await fetch(`${baseUrl}/health`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body).toEqual({ status: "ok" });
  });
});

// ---------------------------------------------------------------------------
// Group and Queue CRUD integration tests
// ---------------------------------------------------------------------------

describe("Group and Queue CRUD", () => {
  let server: ServerHandle;
  let baseUrl: string;
  let codexHome: string;
  let configDir: string;

  beforeEach(async () => {
    codexHome = await mkdtemp(join(tmpdir(), "codex-agent-crud-home-"));
    configDir = await mkdtemp(join(tmpdir(), "codex-agent-crud-config-"));
    await mkdir(join(codexHome, "sessions"), { recursive: true });

    server = startServer({
      port: 0,
      hostname: "127.0.0.1",
      codexHome,
      configDir,
      transport: "local-cli",
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterEach(async () => {
    server.stop();
    await rm(codexHome, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  });

  it("creates and retrieves a group", async () => {
    const createResp = await fetch(`${baseUrl}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "my-group" }),
    });
    const group = (await createResp.json()) as Record<string, unknown>;
    const groupId = group["id"] as string;

    const getResp = await fetch(`${baseUrl}/api/groups/${groupId}`);
    expect(getResp.status).toBe(200);
    const fetched = (await getResp.json()) as Record<string, unknown>;
    expect(fetched["name"]).toBe("my-group");
  });

  it("adds and removes sessions from a group", async () => {
    const createResp = await fetch(`${baseUrl}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "session-group" }),
    });
    const group = (await createResp.json()) as Record<string, unknown>;
    const groupId = group["id"] as string;

    // Add session
    const addResp = await fetch(`${baseUrl}/api/groups/${groupId}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "sess-abc" }),
    });
    expect(addResp.status).toBe(200);

    // Verify
    const getResp = await fetch(`${baseUrl}/api/groups/${groupId}`);
    const updated = (await getResp.json()) as Record<string, unknown>;
    expect(updated["sessionIds"]).toContain("sess-abc");

    // Remove session
    const removeResp = await fetch(
      `${baseUrl}/api/groups/${groupId}/sessions/sess-abc`,
      { method: "DELETE" },
    );
    expect(removeResp.status).toBe(200);

    // Verify removed
    const getResp2 = await fetch(`${baseUrl}/api/groups/${groupId}`);
    const updated2 = (await getResp2.json()) as Record<string, unknown>;
    expect(updated2["sessionIds"]).not.toContain("sess-abc");
  });

  it("creates a queue and adds prompts", async () => {
    const createResp = await fetch(`${baseUrl}/api/queues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "my-queue", projectPath: "/tmp/proj" }),
    });
    const queue = (await createResp.json()) as Record<string, unknown>;
    const queueId = queue["id"] as string;

    // Add prompt
    const addResp = await fetch(`${baseUrl}/api/queues/${queueId}/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Do something", images: ["./one.png", "./two.png"] }),
    });
    expect(addResp.status).toBe(201);
    const prompt = (await addResp.json()) as Record<string, unknown>;
    expect(prompt["prompt"]).toBe("Do something");
    expect(prompt["images"]).toEqual(["./one.png", "./two.png"]);
    expect(prompt["status"]).toBe("pending");

    // Get queue
    const getResp = await fetch(`${baseUrl}/api/queues/${queueId}`);
    expect(getResp.status).toBe(200);
    const fetched = (await getResp.json()) as Record<string, unknown>;
    const prompts = fetched["prompts"] as unknown[];
    expect(prompts).toHaveLength(1);
  });

  it("lists groups after creating", async () => {
    await fetch(`${baseUrl}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "group-a" }),
    });
    await fetch(`${baseUrl}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "group-b" }),
    });

    const resp = await fetch(`${baseUrl}/api/groups`);
    const groups = (await resp.json()) as unknown[];
    expect(groups).toHaveLength(2);
  });

  it("lists queues after creating", async () => {
    await fetch(`${baseUrl}/api/queues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "q1", projectPath: "/tmp/a" }),
    });

    const resp = await fetch(`${baseUrl}/api/queues`);
    const queues = (await resp.json()) as unknown[];
    expect(queues).toHaveLength(1);
  });

  it("pauses, resumes, and deletes a group", async () => {
    const createResp = await fetch(`${baseUrl}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ctl-group" }),
    });
    const group = (await createResp.json()) as Record<string, unknown>;
    const groupId = group["id"] as string;

    const pauseResp = await fetch(`${baseUrl}/api/groups/${groupId}/pause`, {
      method: "POST",
    });
    expect(pauseResp.status).toBe(200);

    const resumeResp = await fetch(`${baseUrl}/api/groups/${groupId}/resume`, {
      method: "POST",
    });
    expect(resumeResp.status).toBe(200);

    const delResp = await fetch(`${baseUrl}/api/groups/${groupId}`, {
      method: "DELETE",
    });
    expect(delResp.status).toBe(200);
  });

  it("pauses, resumes, updates commands, and deletes a queue", async () => {
    const createResp = await fetch(`${baseUrl}/api/queues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "ctl-queue", projectPath: "/tmp/proj" }),
    });
    const queue = (await createResp.json()) as Record<string, unknown>;
    const queueId = queue["id"] as string;

    const promptRespA = await fetch(`${baseUrl}/api/queues/${queueId}/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "A" }),
    });
    const promptA = (await promptRespA.json()) as Record<string, unknown>;
    const commandA = promptA["id"] as string;

    const promptRespB = await fetch(`${baseUrl}/api/queues/${queueId}/prompts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "B" }),
    });
    const promptB = (await promptRespB.json()) as Record<string, unknown>;
    const commandB = promptB["id"] as string;

    const pauseResp = await fetch(`${baseUrl}/api/queues/${queueId}/pause`, {
      method: "POST",
    });
    expect(pauseResp.status).toBe(200);

    const resumeResp = await fetch(`${baseUrl}/api/queues/${queueId}/resume`, {
      method: "POST",
    });
    expect(resumeResp.status).toBe(200);

    const patchResp = await fetch(`${baseUrl}/api/queues/${queueId}/commands/${commandA}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "A-updated" }),
    });
    expect(patchResp.status).toBe(200);

    const modeResp = await fetch(`${baseUrl}/api/queues/${queueId}/commands/${commandB}/mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "manual" }),
    });
    expect(modeResp.status).toBe(200);

    const moveResp = await fetch(`${baseUrl}/api/queues/${queueId}/commands/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: 0, to: 1 }),
    });
    expect(moveResp.status).toBe(200);

    const removeResp = await fetch(`${baseUrl}/api/queues/${queueId}/commands/${commandA}`, {
      method: "DELETE",
    });
    expect(removeResp.status).toBe(200);

    const delResp = await fetch(`${baseUrl}/api/queues/${queueId}`, {
      method: "DELETE",
    });
    expect(delResp.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Managed token permissions integration
// ---------------------------------------------------------------------------

describe("HTTP Server with managed token permissions", () => {
  let server: ServerHandle;
  let baseUrl: string;
  let codexHome: string;
  let configDir: string;
  let sessionReadToken: string;

  beforeAll(async () => {
    codexHome = await mkdtemp(join(tmpdir(), "codex-agent-managed-auth-home-"));
    configDir = await mkdtemp(join(tmpdir(), "codex-agent-managed-auth-config-"));
    await mkdir(join(codexHome, "sessions"), { recursive: true });

    sessionReadToken = await createToken(
      {
        name: "read-only-session",
        permissions: ["session:read"],
      },
      configDir,
    );

    server = startServer({
      port: 0,
      hostname: "127.0.0.1",
      codexHome,
      configDir,
      transport: "local-cli",
    });
    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    server.stop();
    await rm(codexHome, { recursive: true, force: true });
    await rm(configDir, { recursive: true, force: true });
  });

  it("allows session-read endpoint with managed token", async () => {
    const resp = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Authorization: `Bearer ${sessionReadToken}` },
    });
    expect(resp.status).toBe(200);
  });

  it("rejects group endpoint when token lacks group permission", async () => {
    const resp = await fetch(`${baseUrl}/api/groups`, {
      headers: { Authorization: `Bearer ${sessionReadToken}` },
    });
    expect(resp.status).toBe(403);
    const body = (await resp.json()) as Record<string, unknown>;
    expect(String(body["error"])).toContain("missing permission");
  });

  it("rejects malformed managed token", async () => {
    const resp = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Authorization: "Bearer invalid-token" },
    });
    expect(resp.status).toBe(401);
  });

  it("allows file index endpoints with session:read permission", async () => {
    const resp = await fetch(`${baseUrl}/api/files/rebuild`, {
      method: "POST",
      headers: { Authorization: `Bearer ${sessionReadToken}` },
    });
    expect(resp.status).toBe(200);
  });
});
