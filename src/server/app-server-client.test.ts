import { describe, it, expect } from "vitest";
import { createAppServerClient } from "./app-server-client";

interface FakeMessageEvent {
  data: string;
}

class FakeSocket {
  private readonly listeners: Record<string, Array<(event: unknown) => void>> = {
    open: [],
    message: [],
    close: [],
    error: [],
  };
  sent: string[] = [];

  constructor() {
    setTimeout(() => this.emit("open", {}), 0);
  }

  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: unknown) => void,
  ): void {
    const bucket = this.listeners[type];
    if (bucket === undefined) return;
    bucket.push(listener);
  }

  send(data: string): void {
    this.sent.push(data);
    const msg = JSON.parse(data) as { id?: string; method?: string };
    if (msg.id !== undefined) {
      setTimeout(() => {
        this.emit("message", {
          data: JSON.stringify({ id: msg.id, result: { ok: true, method: msg.method } }),
        } satisfies FakeMessageEvent);
      }, 0);
    }
  }

  close(): void {
    this.emit("close", {});
  }

  emit(type: "open" | "message" | "close" | "error", event: unknown): void {
    const bucket = this.listeners[type];
    if (bucket === undefined) return;
    for (const listener of bucket) {
      listener(event);
    }
  }
}

describe("createAppServerClient", () => {
  it("connects and resolves request/response", async () => {
    const fake = new FakeSocket();
    const client = createAppServerClient(
      {
        url: "ws://example/ws",
        requestTimeoutMs: 500,
      },
      () => fake,
    );

    await client.connect();
    const result = await client.request<{ ok: boolean; method?: string }>("sessions.list");
    expect(result.ok).toBe(true);
    expect(result.method).toBe("sessions.list");
    await client.close();
  });

  it("forwards server events to subscribers", async () => {
    const fake = new FakeSocket();
    const client = createAppServerClient({ url: "ws://example/ws" }, () => fake);

    const events: string[] = [];
    const unsubscribe = client.subscribe((evt) => {
      events.push(evt.type);
    });

    await client.connect();
    fake.emit("message", {
      data: JSON.stringify({
        method: "session_event",
        params: { sessionId: "s1", type: "agent_message" },
      }),
    } satisfies FakeMessageEvent);

    expect(events).toEqual(["session_event"]);
    unsubscribe();
    await client.close();
  });
});
