import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const WORKDIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

describe("Yoga GraphQL runtime", () => {
  it("serves GraphQL queries over /graphql", () => {
    const result = runBunScript(`
      import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
      import { join } from "node:path";
      import { tmpdir } from "node:os";
      import { startServer } from "./src/server/server";

      const codexHome = await mkdtemp(join(tmpdir(), "codex-agent-yoga-test-home-"));
      const configDir = await mkdtemp(join(tmpdir(), "codex-agent-yoga-test-config-"));
      const today = new Date();
      const dateDir = join(
        codexHome,
        "sessions",
        String(today.getFullYear()),
        String(today.getMonth() + 1).padStart(2, "0"),
        String(today.getDate()).padStart(2, "0"),
      );
      await mkdir(dateDir, { recursive: true });
      await writeFile(
        join(dateDir, "rollout-test-session-001.jsonl"),
        JSON.stringify({
          timestamp: "2026-03-15T00:00:00.000Z",
          type: "session_meta",
          payload: {
            meta: {
              id: "test-session-001",
              timestamp: "2026-03-15T00:00:00.000Z",
              cwd: "/tmp/test",
              originator: "codex",
              cli_version: "1.0.0",
              source: "cli",
            },
          },
        }) + "\\n",
        "utf-8",
      );

      const server = startServer({
        port: 0,
        hostname: "127.0.0.1",
        codexHome,
        configDir,
        transport: "local-cli",
      });

      try {
        const response = await fetch(\`http://127.0.0.1:\${server.port}/graphql\`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: 'query ($param: JSON) { command(name: "session.list", params: $param) }',
            variables: { param: { limit: 5 } },
          }),
        });
        console.log(JSON.stringify({
          status: response.status,
          body: await response.json(),
        }));
      } finally {
        server.stop();
        await rm(codexHome, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    `);

    expect(result.status).toBe(200);
    const payload = result.body as {
      data?: { command?: { total?: number } };
    };
    expect(payload.data?.command?.total).toBeTypeOf("number");
  });

  it("enforces managed-token permissions for GraphQL commands", () => {
    const result = runBunScript(`
      import { mkdtemp, mkdir, rm } from "node:fs/promises";
      import { join } from "node:path";
      import { tmpdir } from "node:os";
      import { createToken } from "./src/auth";
      import { startServer } from "./src/server/server";

      const codexHome = await mkdtemp(join(tmpdir(), "codex-agent-yoga-auth-home-"));
      const configDir = await mkdtemp(join(tmpdir(), "codex-agent-yoga-auth-config-"));
      await mkdir(join(codexHome, "sessions"), { recursive: true });

      const token = await createToken(
        { name: "read-only-session", permissions: ["session:read"] },
        configDir,
      );

      const server = startServer({
        port: 0,
        hostname: "127.0.0.1",
        codexHome,
        configDir,
        transport: "local-cli",
      });

      try {
        const response = await fetch(\`http://127.0.0.1:\${server.port}/graphql\`, {
          method: "POST",
          headers: {
            Authorization: \`Bearer \${token}\`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: 'query { command(name: "group.list") }',
          }),
        });
        console.log(JSON.stringify({
          status: response.status,
          body: await response.json(),
        }));
      } finally {
        server.stop();
        await rm(codexHome, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    `);

    expect(result.status).toBe(200);
    const payload = result.body as {
      errors?: Array<{ message?: string }>;
    };
    expect(payload.errors?.[0]?.message).toContain("missing permission");
  });
});

function runBunScript(source: string): {
  readonly status: number;
  readonly body: unknown;
} {
  const completed = spawnSync("bun", ["-e", source], {
    cwd: WORKDIR,
    encoding: "utf-8",
  });

  if (completed.status !== 0) {
    throw new Error(
      `bun subprocess failed with code ${completed.status}: ${completed.stderr}`,
    );
  }

  const stdout = completed.stdout.trim();
  if (stdout.length === 0) {
    throw new Error("bun subprocess produced no stdout");
  }

  const parsed = JSON.parse(stdout) as {
    status: number;
    body: unknown;
  };
  return parsed;
}
