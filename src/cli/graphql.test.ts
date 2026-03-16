import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  normalizeGraphqlDocument,
  parseGraphqlCliArgs,
  runGraphqlCli,
} from "./graphql";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("normalizeGraphqlDocument", () => {
  it("wraps command shorthand in a GraphQL query", () => {
    expect(normalizeGraphqlDocument("session.list")).toContain(
      'command(name: "session.list"',
    );
  });

  it("uses mutations for mutating command shorthand", () => {
    expect(
      normalizeGraphqlDocument("group.create").startsWith("mutation"),
    ).toBe(true);
  });

  it("uses subscriptions for watch command shorthand", () => {
    expect(
      normalizeGraphqlDocument("session.watch").startsWith("subscription"),
    ).toBe(true);
  });

  it("keeps explicit GraphQL documents unchanged", () => {
    const document = "query { ping }";
    expect(normalizeGraphqlDocument(document)).toBe(document);
  });
});

describe("parseGraphqlCliArgs", () => {
  it("binds --param to the param variable", async () => {
    const parsed = await parseGraphqlCliArgs([
      "session.list",
      "--param",
      '{"limit":1}',
    ]);
    expect(parsed.variables).toEqual({
      param: { limit: 1 },
    });
  });

  it("loads variables from a JSON file path", async () => {
    const dir = await makeTempDir("codex-agent-gql-vars-");
    const path = join(dir, "vars.json");
    await writeFile(path, '{"limit":2}', "utf-8");

    const parsed = await parseGraphqlCliArgs(["session.list", "--param", path]);
    expect(parsed.variables).toEqual({
      param: { limit: 2 },
    });
  });
});

describe("runGraphqlCli", () => {
  it("prints a GraphQL result for shorthand commands", async () => {
    const codexHome = await makeTempDir("codex-agent-gql-home-");
    const sessionDir = join(codexHome, "sessions", "2026", "03", "16");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "rollout-session-001.jsonl"),
      [
        JSON.stringify({
          timestamp: "2026-03-16T00:00:00.000Z",
          type: "session_meta",
          payload: {
            meta: {
              id: "session-001",
              timestamp: "2026-03-16T00:00:00.000Z",
              cwd: "/tmp/demo",
              originator: "codex",
              cli_version: "1.0.0",
              source: "cli",
            },
          },
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runGraphqlCli(["session.list", "--param", '{"limit":1}'], {
      codexHome,
    });

    const rendered = logSpy.mock.calls[0]?.[0];
    expect(typeof rendered).toBe("string");
    const payload = JSON.parse(rendered as string) as {
      data: { command: { total: number } };
    };
    expect(payload.data.command.total).toBe(1);
  });
});
