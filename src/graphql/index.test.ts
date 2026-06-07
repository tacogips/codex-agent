import { afterEach, describe, expect, it } from "vitest";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { executeGraphqlDocument, executeGraphqlOperation } from "./index";
import { addPrompt, createQueue, findQueue } from "../queue/index";

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

  it("rejects invalid queue prompt statuses without persisting them", async () => {
    const configDir = await makeTempDir("codex-agent-graphql-queue-");
    const queue = await createQueue("demo-queue", "/tmp/demo", configDir);
    const prompt = await addPrompt(queue.id, "hello", undefined, configDir);

    const result = await executeGraphqlDocument({
      document:
        'mutation ($param: JSON) { command(name: "queue.update", params: $param) }',
      variables: {
        param: {
          id: queue.id,
          commandId: prompt.id,
          status: "archived",
        },
      },
      context: { configDir },
    });

    expect(result.errors?.[0]?.message).toBe(
      "status must be one of: pending, running, completed, failed",
    );
    const persisted = await findQueue(queue.id, configDir);
    expect(persisted?.prompts[0]?.status).toBe("pending");
  });

  it("rejects invalid bookmark types before persistence", async () => {
    const configDir = await makeTempDir("codex-agent-graphql-bookmark-");

    const result = await executeGraphqlDocument({
      document:
        'mutation ($param: JSON) { command(name: "bookmark.add", params: $param) }',
      variables: {
        param: {
          type: "invalid",
          sessionId: "session-001",
          name: "bad bookmark",
        },
      },
      context: { configDir },
    });

    expect(result.errors?.[0]?.message).toBe(
      "type must be one of: session, message, range",
    );
  });

  it("passes validated environment variables to session.run", async () => {
    const fixtureDir = await makeTempDir("codex-agent-graphql-env-");
    const envLogPath = join(fixtureDir, "env.log");
    const fakeCodexPath = join(fixtureDir, "fake-codex-env.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        `printf '%s' "\${CODEX_AGENT_GRAPHQL_ENV:-}" > '${envLogPath}'`,
        'printf \'%s\\n\' \'{"timestamp":"2026-03-16T00:00:00.000Z","type":"session_meta","payload":{"meta":{"id":"graphql-env-session","timestamp":"2026-03-16T00:00:00.000Z","cwd":"/tmp/demo","originator":"codex","cli_version":"1.0.0","source":"exec"}}}\'',
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    const result = await executeGraphqlDocument({
      document:
        'mutation ($param: JSON) { command(name: "session.run", params: $param) }',
      variables: {
        param: {
          prompt: "hello",
          codexBinary: fakeCodexPath,
          environmentVariables: {
            CODEX_AGENT_GRAPHQL_ENV: "graphql-env-value",
          },
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const envValue = await readFile(envLogPath, "utf-8");
    expect(envValue).toBe("graphql-env-value");
  });

  it("passes Codex CLI 0.137 process options to session.run without obsolete flags", async () => {
    const fixtureDir = await makeTempDir(
      "codex-agent-graphql-process-options-",
    );
    const argsLogPath = join(fixtureDir, "process-options.log");
    const fakeCodexPath = join(fixtureDir, "fake-codex-process-options.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        `printf '%s\\n' "$@" > '${argsLogPath}'`,
        'printf \'%s\\n\' \'{"timestamp":"2026-03-16T00:00:00.000Z","type":"session_meta","payload":{"meta":{"id":"graphql-process-options","timestamp":"2026-03-16T00:00:00.000Z","cwd":"/tmp/demo","originator":"codex","cli_version":"0.137.0","source":"exec"}}}\'',
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    const result = await executeGraphqlDocument({
      document:
        'mutation ($param: JSON) { command(name: "session.run", params: $param) }',
      variables: {
        param: {
          prompt: "hello from graphql",
          codexBinary: fakeCodexPath,
          sandbox: "workspace-write",
          approvalMode: "on-failure",
          fullAuto: true,
        },
      },
    });

    expect(result.errors).toBeUndefined();
    const args = (await readFile(argsLogPath, "utf-8")).trimEnd().split("\n");
    expect(args).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--sandbox",
      "workspace-write",
      "hello from graphql",
    ]);
    expect(args).not.toContain("--ask-for-approval");
    expect(args).not.toContain("--full-auto");
  });

  it("rejects non-string environment variable values", async () => {
    const result = await executeGraphqlDocument({
      document:
        'mutation ($param: JSON) { command(name: "session.run", params: $param) }',
      variables: {
        param: {
          prompt: "hello",
          environmentVariables: {
            CODEX_AGENT_GRAPHQL_ENV: 123,
          },
        },
      },
    });

    expect(result.errors?.[0]?.message).toBe(
      "environmentVariables.CODEX_AGENT_GRAPHQL_ENV must be a string",
    );
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
