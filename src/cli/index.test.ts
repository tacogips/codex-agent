import { describe, it, expect } from "vitest";
import { parseServerStartArgs } from "./index";

describe("parseServerStartArgs", () => {
  it("parses core server flags", () => {
    const args = parseServerStartArgs([
      "--port",
      "8080",
      "--host",
      "0.0.0.0",
      "--token",
      "t1",
    ]);
    expect(args).toEqual({
      port: 8080,
      hostname: "0.0.0.0",
      token: "t1",
    });
  });

  it("parses app-server transport flags", () => {
    const args = parseServerStartArgs([
      "--transport",
      "app-server",
      "--app-server-url",
      "ws://127.0.0.1:12345/ws",
    ]);
    expect(args).toEqual({
      transport: "app-server",
      appServerUrl: "ws://127.0.0.1:12345/ws",
    });
  });
});
