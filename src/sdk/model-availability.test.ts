import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkCodexModelAvailability,
  getCodexLoginStatus,
} from "./model-availability";

const createdDirs: string[] = [];

afterEach(async () => {
  for (const dir of createdDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("getCodexLoginStatus", () => {
  it("returns authenticated status when login status succeeds", async () => {
    const codexBinary = await createExecutable(`
case "$1:$2" in
  "login:status")
    printf 'Logged in using ChatGPT\\n'
    ;;
  *)
    echo "unexpected args: $*" 1>&2
    exit 1
    ;;
esac
`);

    const result = await getCodexLoginStatus({ codexBinary });

    expect(result).toEqual({
      ok: true,
      status: "Logged in using ChatGPT",
      error: null,
      exitCode: 0,
    });
  });

  it("treats not logged in status as unavailable auth", async () => {
    const codexBinary = await createExecutable(`
case "$1:$2" in
  "login:status")
    printf 'Not logged in\\n'
    ;;
  *)
    echo "unexpected args: $*" 1>&2
    exit 1
    ;;
esac
`);

    const result = await getCodexLoginStatus({ codexBinary });

    expect(result).toEqual({
      ok: false,
      status: "Not logged in",
      error: "Not logged in",
      exitCode: 0,
    });
  });
});

describe("checkCodexModelAvailability", () => {
  it("confirms auth and model availability for the requested model", async () => {
    const codexBinary = await createExecutable(`
case "$1:$2" in
  "login:status")
    printf 'Logged in using ChatGPT\\n'
    ;;
  "exec:--skip-git-repo-check")
    if [[ " $* " != *" --ephemeral "* ]]; then
      echo "missing ephemeral flag" 1>&2
      exit 8
    fi
    if [[ " $* " != *" --model gpt-5.4 "* ]]; then
      echo "wrong model" 1>&2
      exit 9
    fi
    printf 'OK\\n'
    ;;
  *)
    echo "unexpected args: $*" 1>&2
    exit 1
    ;;
esac
`);

    const result = await checkCodexModelAvailability({
      codexBinary,
      model: "gpt-5.4",
    });

    expect(result).toEqual({
      ok: true,
      model: "gpt-5.4",
      auth: {
        ok: true,
        status: "Logged in using ChatGPT",
        error: null,
        exitCode: 0,
      },
      probe: {
        ok: true,
        model: "gpt-5.4",
        output: "OK",
        error: null,
        exitCode: 0,
      },
    });
  });

  it("surfaces model probe failure even when auth is available", async () => {
    const codexBinary = await createExecutable(`
case "$1:$2" in
  "login:status")
    printf 'Logged in using ChatGPT\\n'
    ;;
  "exec:--skip-git-repo-check")
    echo 'model gpt-5.4 is not enabled for this account' 1>&2
    exit 11
    ;;
  *)
    echo "unexpected args: $*" 1>&2
    exit 1
    ;;
esac
`);

    const result = await checkCodexModelAvailability({
      codexBinary,
      model: "gpt-5.4",
    });

    expect(result.ok).toBe(false);
    expect(result.auth.ok).toBe(true);
    expect(result.probe).toEqual({
      ok: false,
      model: "gpt-5.4",
      output: null,
      error:
        "command failed (exit code 11): model gpt-5.4 is not enabled for this account",
      exitCode: 11,
    });
  });

  it("prefers structured Codex JSON error messages over progress stderr", async () => {
    const codexBinary = await createExecutable(`
case "$1:$2" in
  "login:status")
    printf 'Logged in using ChatGPT\\n'
    ;;
  "exec:--skip-git-repo-check")
    echo 'Reading additional input from stdin...' 1>&2
    echo 'ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The gpt-5 model is not supported for this account."}}' 1>&2
    exit 11
    ;;
  *)
    echo "unexpected args: $*" 1>&2
    exit 1
    ;;
esac
`);

    const result = await checkCodexModelAvailability({
      codexBinary,
      model: "gpt-5",
    });

    expect(result.ok).toBe(false);
    expect(result.auth.ok).toBe(true);
    expect(result.probe.error).toBe(
      "command failed (exit code 11): The gpt-5 model is not supported for this account.",
    );
  });

  it("passes explicit environment overrides to Codex probes", async () => {
    const codexBinary = await createExecutable(`
if [[ "\${CODEX_AGENT_TEST_ENV:-}" != "ready" ]]; then
  echo "missing env" 1>&2
  exit 13
fi
case "$1:$2" in
  "login:status")
    printf 'Logged in using ChatGPT\\n'
    ;;
  "exec:--skip-git-repo-check")
    printf 'OK\\n'
    ;;
  *)
    echo "unexpected args: $*" 1>&2
    exit 1
    ;;
esac
`);

    const result = await checkCodexModelAvailability({
      codexBinary,
      model: "gpt-5.4",
      env: {
        CODEX_AGENT_TEST_ENV: "ready",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.probe.output).toBe("OK");
  });

  it("reports unavailable auth alongside a failed probe", async () => {
    const codexBinary = await createExecutable(`
case "$1:$2" in
  "login:status")
    printf 'Not logged in\\n'
    ;;
  "exec:--skip-git-repo-check")
    echo 'authentication required' 1>&2
    exit 12
    ;;
  *)
    echo "unexpected args: $*" 1>&2
    exit 1
    ;;
esac
`);

    const result = await checkCodexModelAvailability({
      codexBinary,
      model: "gpt-5.4",
    });

    expect(result.ok).toBe(false);
    expect(result.auth).toEqual({
      ok: false,
      status: "Not logged in",
      error: "Not logged in",
      exitCode: 0,
    });
    expect(result.probe).toEqual({
      ok: false,
      model: "gpt-5.4",
      output: null,
      error: "command failed (exit code 12): authentication required",
      exitCode: 12,
    });
  });
});

async function createExecutable(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "codex-agent-model-check-"));
  createdDirs.push(dir);
  const path = join(dir, "fake-codex.sh");
  await writeFile(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}
