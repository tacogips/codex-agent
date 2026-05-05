import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseModelCheckArgs,
  parseProcessOptions,
  parseVersionArgs,
  run,
} from "./index";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("run", () => {
  it.each(["graphql", "gql"])("dispatches the %s command", async (command) => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await run(["bun", "src/bin.ts", command, "query { ping }"]);

    const rendered = logSpy.mock.calls[0]?.[0];
    expect(typeof rendered).toBe("string");
    expect(JSON.parse(rendered as string)).toEqual({
      data: { ping: true },
    });
  });
});

describe("parseVersionArgs", () => {
  it("parses --json and --include-git", () => {
    const parsed = parseVersionArgs(["--json", "--include-git"]);
    expect(parsed).toEqual({
      asJson: true,
      includeGit: true,
    });
  });

  it("defaults flags to false", () => {
    const parsed = parseVersionArgs([]);
    expect(parsed).toEqual({
      asJson: false,
      includeGit: false,
    });
  });
});

describe("parseModelCheckArgs", () => {
  it("parses model-check flags", () => {
    const parsed = parseModelCheckArgs([
      "--model",
      "gpt-5.4",
      "--json",
      "--timeout-ms",
      "1200",
    ]);

    expect(parsed).toEqual({
      model: "gpt-5.4",
      asJson: true,
      timeoutMs: 1200,
    });
  });

  it("drops invalid timeout values", () => {
    const parsed = parseModelCheckArgs([
      "--model",
      "gpt-5.4",
      "--timeout-ms",
      "nope",
    ]);

    expect(parsed).toEqual({
      model: "gpt-5.4",
      asJson: false,
    });
  });
});

describe("parseProcessOptions", () => {
  it("parses sandbox and approval mode flags", () => {
    const parsed = parseProcessOptions([
      "--sandbox",
      "network-only",
      "--approval-mode",
      "on-failure",
    ]);
    expect(parsed).toEqual({
      sandbox: "network-only",
      approvalMode: "on-failure",
    });
  });

  it("parses stream granularity char", () => {
    const parsed = parseProcessOptions(["--stream-granularity", "char"]);
    expect(parsed).toEqual({
      streamGranularity: "char",
    });
  });

  it("ignores invalid enum-like process option values", () => {
    const parsed = parseProcessOptions([
      "--sandbox",
      "invalid",
      "--approval-mode",
      "invalid",
      "--stream-granularity",
      "invalid",
    ]);
    expect(parsed).toEqual({});
  });
});
