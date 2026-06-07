import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { runAgent } from "./agent-runner";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(async (dir) => {
      await rm(dir, { recursive: true, force: true });
    }),
  );
});

describe("runAgent process options", () => {
  test("forwards request-level Codex CLI 0.137 options without obsolete flags", async () => {
    const fixtureDir = await mkdtemp(
      join(tmpdir(), "codex-agent-run-agent-process-options-"),
    );
    createdDirs.push(fixtureDir);

    const argsLogPath = join(fixtureDir, "process-options.log");
    const fakeCodexPath = join(fixtureDir, "fake-codex-process-options.sh");
    await writeFile(
      fakeCodexPath,
      [
        "#!/usr/bin/env bash",
        "set -eu",
        `printf '%s\\n' "$@" > '${argsLogPath}'`,
        'printf \'%s\\n\' \'{"timestamp":"2026-01-01T00:00:00Z","type":"session_meta","payload":{"meta":{"id":"agent-process-options-001","timestamp":"2026-01-01T00:00:00Z","cwd":"/tmp/project","originator":"codex","cli_version":"0.137.0","source":"exec"}}}\'',
        "exit 0",
      ].join("\n"),
      "utf-8",
    );
    await chmod(fakeCodexPath, 0o755);

    for await (const _event of runAgent(
      {
        prompt: "say hello",
        sandbox: "workspace-write",
        approvalMode: "on-failure",
        fullAuto: true,
      },
      {
        codexBinary: fakeCodexPath,
      },
    )) {
      // Drain stream.
    }

    const args = (await readFile(argsLogPath, "utf-8")).trimEnd().split("\n");
    expect(args).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--sandbox",
      "workspace-write",
      "say hello",
    ]);
    expect(args).not.toContain("--ask-for-approval");
    expect(args).not.toContain("--full-auto");
  });
});
