/**
 * WebSocketManager - Real-time session event subscriptions.
 *
 * Client messages:
 *   { type: "subscribe_session", sessionId: string }
 *   { type: "unsubscribe_session", sessionId: string }
 *   { type: "subscribe_new_sessions" }
 *
 * Server messages:
 *   { type: "session_event", sessionId: string, event: RolloutLine }
 *   { type: "new_session", path: string }
 *   { type: "subscribed", channel: string }
 *   { type: "error", message: string }
 */

import { RolloutWatcher, sessionsWatchDir } from "../rollout/watcher";
import { findSession, resolveCodexHome } from "../session/index";
import type { ServerWebSocket } from "bun";
import type { RolloutLine } from "../types/rollout";

interface WsData {
  subscribedSessions: Set<string>;
  subscribedNewSessions: boolean;
}

type ClientMessage =
  | { type: "subscribe_session"; sessionId: string }
  | { type: "unsubscribe_session"; sessionId: string }
  | { type: "subscribe_new_sessions" };

function isClientMessage(data: unknown): data is ClientMessage {
  if (typeof data !== "object" || data === null) return false;
  const msg = data as Record<string, unknown>;
  if (msg["type"] === "subscribe_session") {
    return typeof msg["sessionId"] === "string";
  }
  if (msg["type"] === "unsubscribe_session") {
    return typeof msg["sessionId"] === "string";
  }
  if (msg["type"] === "subscribe_new_sessions") {
    return true;
  }
  return false;
}

export class WebSocketManager {
  private readonly watcher = new RolloutWatcher();
  private readonly clients = new Set<ServerWebSocket<WsData>>();
  /** Maps session ID to its rollout path (for watcher). */
  private readonly sessionPaths = new Map<string, string>();
  private directoryWatchStarted = false;
  private readonly codexHome: string;

  constructor(codexHome?: string) {
    this.codexHome = codexHome ?? resolveCodexHome();

    this.watcher.on("line", (path, line) => {
      this.broadcastSessionEvent(path, line);
    });

    this.watcher.on("newSession", (path) => {
      this.broadcastNewSession(path);
    });
  }

  handleOpen(ws: ServerWebSocket<WsData>): void {
    this.clients.add(ws);
  }

  handleMessage(ws: ServerWebSocket<WsData>, raw: string | Buffer): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === "string" ? raw : raw.toString());
    } catch {
      ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      return;
    }

    if (!isClientMessage(parsed)) {
      ws.send(
        JSON.stringify({ type: "error", message: "Unknown message type" }),
      );
      return;
    }

    switch (parsed.type) {
      case "subscribe_session":
        void this.subscribeSession(ws, parsed.sessionId);
        break;
      case "unsubscribe_session":
        ws.data.subscribedSessions.delete(parsed.sessionId);
        ws.send(
          JSON.stringify({
            type: "subscribed",
            channel: `unsubscribed:${parsed.sessionId}`,
          }),
        );
        break;
      case "subscribe_new_sessions":
        this.subscribeNewSessions(ws);
        break;
    }
  }

  handleClose(ws: ServerWebSocket<WsData>): void {
    this.clients.delete(ws);
  }

  stop(): void {
    this.watcher.stop();
  }

  publishSessionEvent(sessionId: string, event: unknown): void {
    const msg = JSON.stringify({
      type: "session_event",
      sessionId,
      event,
    });
    for (const ws of this.clients) {
      if (ws.data.subscribedSessions.has(sessionId)) {
        ws.send(msg);
      }
    }
  }

  publishNewSession(path: string): void {
    const msg = JSON.stringify({ type: "new_session", path });
    for (const ws of this.clients) {
      if (ws.data.subscribedNewSessions) {
        ws.send(msg);
      }
    }
  }

  createWsData(): WsData {
    return { subscribedSessions: new Set(), subscribedNewSessions: false };
  }

  private async subscribeSession(
    ws: ServerWebSocket<WsData>,
    sessionId: string,
  ): Promise<void> {
    ws.data.subscribedSessions.add(sessionId);

    // Start watching rollout file if not already watched
    if (!this.sessionPaths.has(sessionId)) {
      const session = await findSession(sessionId, this.codexHome);
      if (session === null) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Session not found: ${sessionId}`,
          }),
        );
        return;
      }
      this.sessionPaths.set(sessionId, session.rolloutPath);
      await this.watcher.watchFile(session.rolloutPath);
    }

    ws.send(
      JSON.stringify({ type: "subscribed", channel: `session:${sessionId}` }),
    );
  }

  private subscribeNewSessions(ws: ServerWebSocket<WsData>): void {
    ws.data.subscribedNewSessions = true;

    if (!this.directoryWatchStarted) {
      const dir = sessionsWatchDir(this.codexHome);
      this.watcher.watchDirectory(dir);
      this.directoryWatchStarted = true;
    }

    ws.send(
      JSON.stringify({ type: "subscribed", channel: "new_sessions" }),
    );
  }

  private broadcastSessionEvent(path: string, line: RolloutLine): void {
    // Find session ID by path
    let sessionId: string | undefined;
    for (const [id, p] of this.sessionPaths) {
      if (p === path) {
        sessionId = id;
        break;
      }
    }
    if (sessionId === undefined) return;

    this.publishSessionEvent(sessionId, line);
  }

  private broadcastNewSession(path: string): void {
    this.publishNewSession(path);
  }
}
