import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { getCodexCliVersion, getToolVersions } from "./tool-versions";

const createdDirs: string[] = [];

afterEach(async () => {
  for (const dir of createdDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("getCodexCliVersion", () => {
  it("returns first line of --version output when command succeeds", async () => {
    const script = await createExecutable(
      "fake-codex-ok.sh",
      "printf 'codex 9.9.9\\nextra\\n'",
    );

    const result = await getCodexCliVersion({ codexBinary: script });

    expect(result).toEqual({
      version: "codex 9.9.9",
      error: null,
    });
  });

  it("returns structured error when command is missing", async () => {
    const result = await getCodexCliVersion({
      codexBinary: join(tmpdir(), "codex-agent-missing-codex-binary"),
    });

    expect(result.version).toBeNull();
    expect(result.error).not.toBeNull();
  });

  it("returns structured error when command exits non-zero", async () => {
    const script = await createExecutable(
      "fake-codex-fail.sh",
      "echo 'permission denied' 1>&2; exit 7",
    );

    const result = await getCodexCliVersion({ codexBinary: script });

    expect(result).toEqual({
      version: null,
      error: "version command failed (exit code 7): permission denied",
    });
  });
});

describe("getToolVersions", () => {
  it("returns codex only when includeGit is false", async () => {
    const codexScript = await createExecutable(
      "fake-codex-only.sh",
      "printf 'codex 1.2.3\\n'",
    );

    const versions = await getToolVersions({
      codexBinary: codexScript,
      includeGit: false,
    });

    expect(versions).toEqual({
      codex: {
        version: "codex 1.2.3",
        error: null,
      },
    });
  });

  it("returns codex and git when includeGit is true", async () => {
    const codexScript = await createExecutable(
      "fake-codex-with-git.sh",
      "printf 'codex 1.0.0\\n'",
    );
    const gitScript = await createExecutable(
      "fake-git-with-codex.sh",
      "printf 'git version 2.50.1\\n'",
    );

    const versions = await getToolVersions({
      codexBinary: codexScript,
      includeGit: true,
      gitBinary: gitScript,
    });

    expect(versions).toEqual({
      codex: {
        version: "codex 1.0.0",
        error: null,
      },
      git: {
        version: "git version 2.50.1",
        error: null,
      },
    });
  });
});

async function createExecutable(name: string, body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "codex-agent-tool-version-"));
  createdDirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}
