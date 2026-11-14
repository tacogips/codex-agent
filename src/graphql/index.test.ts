import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeGraphqlDocument, executeGraphqlOperation } from "./index";

const tempDirs: string[] = [];

afterEach(async () => {
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

describe("executeGraphqlDocument", () => {
  it("lists sessions through the command field", async () => {
    const codexHome = await makeTempDir("codex-agent-graphql-home-");
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

    const result = await executeGraphqlDocument({
      document:
        'query ($param: JSON) { command(name: "session.list", params: $param) }',
      variables: {
        param: {
          limit: 10,
        },
      },
      context: { codexHome },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data as Record<string, unknown>;
    const payload = data["command"] as Record<string, unknown>;
    expect(payload["total"]).toBe(1);
  });

  it("creates a group through a mutation", async () => {
    const configDir = await makeTempDir("codex-agent-graphql-config-");

    const result = await executeGraphqlDocument({
      document:
        'mutation ($param: JSON) { command(name: "group.create", params: $param) }',
      variables: {
        param: {
          name: "demo-group",
          description: "created from graphql",
        },
      },
      context: { configDir },
    });

    expect(result.errors).toBeUndefined();
    const data = result.data as Record<string, unknown>;
    const payload = data["command"] as Record<string, unknown>;
    expect(payload["name"]).toBe("demo-group");
    expect(payload["id"]).toBeTypeOf("string");
  });

  it("streams rollout lines through a session.watch subscription", async () => {
    const codexHome = await makeTempDir("codex-agent-graphql-watch-home-");
    const sessionDir = join(codexHome, "sessions", "2026", "03", "16");
    await mkdir(sessionDir, { recursive: true });
    const rolloutPath = join(sessionDir, "rollout-session-watch-001.jsonl");
    await writeFile(
      rolloutPath,
      [
        JSON.stringify({
          timestamp: "2026-03-16T00:00:00.000Z",
          type: "session_meta",
          payload: {
            meta: {
              id: "session-watch-001",
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

    const result = await executeGraphqlOperation({
      document:
        'subscription ($param: JSON) { command(name: "session.watch", params: $param) }',
      variables: {
        param: {
          id: "session-watch-001",
          startOffset: 0,
        },
      },
      context: { codexHome },
    });

    expect(Symbol.asyncIterator in (result as object)).toBe(true);
    const iterator = result as AsyncIterable<{
      data?: { command?: { type?: string } };
    }>;
    const stream = iterator[Symbol.asyncIterator]();
    const first = await stream.next();
    expect(first.done).toBe(false);
    expect(first.value.data?.command?.type).toBe("session_meta");
    await stream.return?.();
  });
});
