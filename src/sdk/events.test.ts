import { describe, expect, it, vi } from "vitest";
import { BasicSdkEventEmitter } from "./events";

describe("BasicSdkEventEmitter", () => {
  it("registers and emits typed events", () => {
    const emitter = new BasicSdkEventEmitter();
    const handler = vi.fn();
    emitter.on("session.started", handler);

    emitter.emit("session.started", { sessionId: "s1" });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ sessionId: "s1" });
  });

  it("removes handlers with off", () => {
    const emitter = new BasicSdkEventEmitter();
    const handler = vi.fn();
    emitter.on("error", handler);
    emitter.off("error", handler);

    emitter.emit("error", { message: "boom" });
    expect(handler).not.toHaveBeenCalled();
  });
});

