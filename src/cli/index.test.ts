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
  it("dispatches the graphql command", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await run(["bun", "src/bin.ts", "graphql", "query { ping }"]);

    const rendered = logSpy.mock.calls[0]?.[0];
    expect(typeof rendered).toBe("string");
    expect(JSON.parse(rendered as string)).toEqual({
      data: { ping: true },
    });
  });

  it("documents codex-agent graphql in help output", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await run(["bun", "codex-agent", "--help"]);

    const rendered = logSpy.mock.calls[0]?.[0];
    expect(typeof rendered).toBe("string");
    expect(rendered as string).toContain("codex-agent graphql <query|command>");
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
      "workspace-write",
      "--approval-mode",
      "on-failure",
    ]);
    expect(parsed).toEqual({
      sandbox: "workspace-write",
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
