import { describe, expect, it } from "vitest";
import { deriveActivityEntry } from "./manager";

describe("deriveActivityEntry", () => {
  it("marks running on TurnStarted and idle on TurnComplete", () => {
    const entry = deriveActivityEntry("s1", [
      {
        timestamp: "2026-02-20T00:00:00.000Z",
        type: "event_msg",
        payload: { type: "TurnStarted", turn_id: "t1" },
      },
      {
        timestamp: "2026-02-20T00:00:05.000Z",
        type: "event_msg",
        payload: { type: "TurnComplete", turn_id: "t1" },
      },
    ]);

    expect(entry.status).toBe("idle");
    expect(entry.updatedAt).toBe("2026-02-20T00:00:05.000Z");
  });

  it("marks waiting_approval from local_shell_call approval status", () => {
    const entry = deriveActivityEntry("s1", [
      {
        timestamp: "2026-02-20T00:00:00.000Z",
        type: "response_item",
        payload: {
          type: "local_shell_call",
          status: "needs_approval",
          action: { type: "exec" },
        },
      },
    ]);

    expect(entry.status).toBe("waiting_approval");
  });

  it("marks failed on error events", () => {
    const entry = deriveActivityEntry("s1", [
      {
        timestamp: "2026-02-20T00:00:00.000Z",
        type: "event_msg",
        payload: { type: "Error", message: "boom" },
      },
    ]);

    expect(entry.status).toBe("failed");
  });
});

