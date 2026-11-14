/**
 * Minimal Codex app-server WebSocket client.
 */

export interface AppServerClientConfig {
  readonly url: string;
  readonly reconnectMs?: number | undefined;
  readonly requestTimeoutMs?: number | undefined;
}

export interface AppServerSessionEvent {
  readonly type: string;
  readonly sessionId?: string | undefined;
  readonly payload: unknown;
}

export interface AppServerClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  request<TResponse>(method: string, params?: unknown): Promise<TResponse>;
  subscribe(onEvent: (event: AppServerSessionEvent) => void): () => void;
}

interface AppServerRpcMessage {
  readonly id?: string | undefined;
  readonly method?: string | undefined;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

interface WebSocketLike {
  send(data: string): void;
  close(): void;
  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: unknown) => void,
  ): void;
}

type WebSocketFactory = (url: string) => WebSocketLike;

const DEFAULT_TIMEOUT_MS = 10_000;

function randomId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getMessageData(evt: unknown): unknown {
  if (typeof evt !== "object" || evt === null) return undefined;
  const rec = evt as Record<string, unknown>;
  return rec["data"];
}

function parseMessage(raw: unknown): AppServerRpcMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw) as AppServerRpcMessage;
    return parsed;
  } catch {
    return null;
  }
}

class DefaultAppServerClient implements AppServerClient {
  private readonly config: AppServerClientConfig;
  private readonly wsFactory: WebSocketFactory;
  private ws: WebSocketLike | null = null;
  private readonly listeners = new Set<(event: AppServerSessionEvent) => void>();
  private readonly pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (reason: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(config: AppServerClientConfig, wsFactory: WebSocketFactory) {
    this.config = config;
    this.wsFactory = wsFactory;
  }

  async connect(): Promise<void> {
    if (this.ws !== null) return;
    this.ws = this.wsFactory(this.config.url);

    await new Promise<void>((resolve, reject) => {
      const ws = this.ws;
      if (ws === null) {
        reject(new Error("App-server WebSocket unavailable"));
        return;
      }

      let settled = false;
      ws.addEventListener("open", () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      ws.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          reject(new Error("Failed to connect to app-server"));
        }
      });
      ws.addEventListener("close", () => {
        if (!settled) {
          settled = true;
          reject(new Error("App-server connection closed during connect"));
        }
        this.rejectAllPending(new Error("App-server connection closed"));
      });
      ws.addEventListener("message", (evt) => {
        const data = getMessageData(evt);
        const msg = parseMessage(data);
        if (msg === null) return;
        this.handleMessage(msg);
      });
    });
  }

  async close(): Promise<void> {
    if (this.ws === null) return;
    this.ws.close();
    this.ws = null;
    this.rejectAllPending(new Error("App-server client closed"));
  }

  async request<TResponse>(method: string, params?: unknown): Promise<TResponse> {
    if (this.ws === null) {
      throw new Error("App-server is not connected");
    }

    const id = randomId();
    const timeoutMs = this.config.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;

    const payload: AppServerRpcMessage = {
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    const responsePromise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`App-server request timeout (${method})`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
    });

    this.ws.send(JSON.stringify(payload));
    const raw = await responsePromise;
    return raw as TResponse;
  }

  subscribe(onEvent: (event: AppServerSessionEvent) => void): () => void {
    this.listeners.add(onEvent);
    return () => {
      this.listeners.delete(onEvent);
    };
  }

  private handleMessage(msg: AppServerRpcMessage): void {
    if (msg.id !== undefined) {
      const pending = this.pending.get(msg.id);
      if (pending !== undefined) {
        clearTimeout(pending.timer);
        this.pending.delete(msg.id);
        if (msg.error !== undefined) {
          pending.reject(
            msg.error instanceof Error
              ? msg.error
              : new Error(String(msg.error)),
          );
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    if (msg.method !== undefined) {
      const evt: AppServerSessionEvent = {
        type: msg.method,
        sessionId: getSessionId(msg.params),
        payload: msg.params,
      };
      for (const listener of this.listeners) {
        listener(evt);
      }
    }
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(id);
    }
  }
}

function getSessionId(payload: unknown): string | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const rec = payload as Record<string, unknown>;
  return typeof rec["sessionId"] === "string" ? rec["sessionId"] : undefined;
}

export function createAppServerClient(
  config: AppServerClientConfig,
  wsFactory: WebSocketFactory = (url) => new WebSocket(url) as WebSocketLike,
): AppServerClient {
  return new DefaultAppServerClient(config, wsFactory);
}
