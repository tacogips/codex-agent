import { describe, expect, test } from "vitest";
import * as mainModule from "./main";

describe("package root source exports", () => {
  test("re-exports session and rollout APIs", () => {
    expect(typeof mainModule.listSessions).toBe("function");
    expect(typeof mainModule.findSession).toBe("function");
    expect(typeof mainModule.findLatestSession).toBe("function");
    expect(typeof mainModule.getSessionMessages).toBe("function");
    expect(typeof mainModule.runCli).toBe("function");
  });
});
