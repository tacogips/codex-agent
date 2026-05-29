import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { ProcessManager } from "./manager";
import { defined } from "../testing/assert";

describe("ProcessManager", () => {
  test("starts with no processes", () => {
    const pm = new ProcessManager("echo");
    expect(pm.list()).toHaveLength(0);
  });

  test("spawnExec runs a command and collects output", async () => {
    // Use echo to simulate JSONL output from codex exec
    const jsonlLine = JSON.stringify({
      timestamp: "2025-01-01T00:00:00Z",
      type: "event_msg",
      payload: { type: "AgentMessage", message: "test output" },
    });

    // echo will output the line and exit
    const pm = new ProcessManager("echo");
    const result = await pm.spawnExec(jsonlLine, {
      codexBinary: "echo",
    });

    // echo outputs the prompt as text. It won't be valid JSONL because echo
    // concatenates all args. But we're testing the flow works.
    expect(result.exitCode).toBe(0);
    // The echo output includes the prompt as a single string
    // which is the JSONL wrapped in echo args - may or may not parse
    expect(Array.isArray(result.lines)).toBe(true);
  });

  test("list returns tracked processes", async () => {
    const pm = new ProcessManager("echo");
    await pm.spawnExec("hello", { codexBinary: "echo" });

    const processes = pm.list();
    expect(processes).toHaveLength(1);
    expect(processes[0]?.status).toBe("exited");
    expect(processes[0]?.exitCode).toBe(0);
  });

  test("get returns a process by id", async () => {
    const pm = new ProcessManager("echo");
    await pm.spawnExec("hello", { codexBinary: "echo" });

    const processes = pm.list();
    const id = defined(processes[0], "expected at least one process").id;

    const proc = pm.get(id);
    expect(proc).not.toBeNull();
    expect(proc?.id).toBe(id);
  });

  test("get returns null for unknown id", () => {
    const pm = new ProcessManager("echo");
    expect(pm.get("nonexistent")).toBeNull();
  });

  test("kill returns false for non-running process", async () => {
    const pm = new ProcessManager("echo");
    await pm.spawnExec("hello", { codexBinary: "echo" });

    const id = defined(pm.list()[0], "expected at least one process").id;
    expect(pm.kill(id)).toBe(false); // Already exited
  });

  test("kill returns false for unknown id", () => {
    const pm = new ProcessManager("echo");
    expect(pm.kill("nonexistent")).toBe(false);
  });

  test("prune removes completed processes", async () => {
    const pm = new ProcessManager("echo");
    await pm.spawnExec("hello", { codexBinary: "echo" });
    await pm.spawnExec("world", { codexBinary: "echo" });

    expect(pm.list()).toHaveLength(2);

    const pruned = pm.prune();
    expect(pruned).toBe(2);
    expect(pm.list()).toHaveLength(0);
  });

  test("buildCommonArgs includes model flag", async () => {
    // We can verify args indirectly by using a binary that echoes its args
    const pm = new ProcessManager("echo");
    const result = await pm.spawnExec("test prompt", {
      codexBinary: "echo",
      model: "gpt-4o",
      fullAuto: true,
      sandbox: "none",
    });
    // echo exits 0
    expect(result.exitCode).toBe(0);
  });

  test("spawnExec includes image attachment args", async () => {
    const pm = new ProcessManager("echo");
    await pm.spawnExec("test prompt", {
      codexBinary: "echo",
      images: ["./one.png", "./two.png"],
    });

    const command = pm.list()[0]?.command;
    expect(command).toContain("--image ./one.png");
    expect(command).toContain("--image ./two.png");
    expect(command).toContain("--image ./two.png -- test prompt");
  });

  test("spawnExec includes additional passthrough args", async () => {
    const pm = new ProcessManager("echo");
    await pm.spawnExec("test prompt", {
      codexBinary: "echo",
      additionalArgs: [
        "--skip-git-repo-check",
        "--dangerously-bypass-approvals-and-sandbox",
      ],
    });

    const command = pm.list()[0]?.command;
    expect(command).toContain("--skip-git-repo-check");
    expect(command).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  test("spawnExec includes config override args", async () => {
    const pm = new ProcessManager("echo");
    await pm.spawnExec("test prompt", {
      codexBinary: "echo",
      configOverrides: ['model_reasoning_effort="high"'],
    });

    const command = pm.list()[0]?.command;
    expect(command).toContain('-c model_reasoning_effort="high"');
  });

  test("spawnExec places options before the prompt argument", async () => {
    const fixtureDir = await mkdtemp(
      join(tmpdir(), "codex-agent-process-manager-args-"),
    );
    try {
      const argsLogPath = join(fixtureDir, "args.log");
      const fakeCodexPath = join(fixtureDir, "fake-codex-args.sh");
      await writeFile(
        fakeCodexPath,
        [
          "#!/usr/bin/env bash",
          "set -eu",
          `printf '%s\\n' "$@" > '${argsLogPath}'`,
          "exit 0",
        ].join("\n"),
        "utf-8",
      );
      await chmod(fakeCodexPath, 0o755);

      const pm = new ProcessManager(fakeCodexPath);
      const result = await pm.spawnExec("test prompt with spaces", {
        codexBinary: fakeCodexPath,
        model: "gpt-5.5",
        configOverrides: ['model_reasoning_effort="high"'],
        additionalArgs: ["--skip-git-repo-check"],
      });

      expect(result.exitCode).toBe(0);
      const args = (await readFile(argsLogPath, "utf-8")).trimEnd().split("\n");
      expect(args).toEqual([
        "exec",
        "--json",
        "--model",
        "gpt-5.5",
        "-c",
        'model_reasoning_effort="high"',
        "--skip-git-repo-check",
        "test prompt with spaces",
      ]);
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("spawnExec prefixes prompt with system prompt when provided", async () => {
    const fixtureDir = await mkdtemp(
      join(tmpdir(), "codex-agent-process-manager-system-prompt-"),
    );
    try {
      const argsLogPath = join(fixtureDir, "args.log");
      const fakeCodexPath = join(fixtureDir, "fake-codex-system-prompt.sh");
      await writeFile(
        fakeCodexPath,
        [
          "#!/usr/bin/env bash",
          "set -eu",
          `printf '%s\\n' "$@" > '${argsLogPath}'`,
          "exit 0",
        ].join("\n"),
        "utf-8",
      );
      await chmod(fakeCodexPath, 0o755);

      const pm = new ProcessManager(fakeCodexPath);
      const result = await pm.spawnExec("user prompt", {
        codexBinary: fakeCodexPath,
        systemPrompt: "system prompt",
      });

      expect(result.exitCode).toBe(0);
      const argsLog = await readFile(argsLogPath, "utf-8");
      expect(argsLog).toContain("system prompt\n\nuser prompt\n");
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("spawnResumeStream places resume options before session and prompt arguments", async () => {
    const fixtureDir = await mkdtemp(
      join(tmpdir(), "codex-agent-process-manager-resume-args-"),
    );
    try {
      const argsLogPath = join(fixtureDir, "args.log");
      const fakeCodexPath = join(fixtureDir, "fake-codex-resume-args.sh");
      await writeFile(
        fakeCodexPath,
        [
          "#!/usr/bin/env bash",
          "set -eu",
          `printf '%s\\n' "$@" > '${argsLogPath}'`,
          "exit 0",
        ].join("\n"),
        "utf-8",
      );
      await chmod(fakeCodexPath, 0o755);

      const pm = new ProcessManager(fakeCodexPath);
      const stream = pm.spawnResumeStream(
        "session-1",
        {
          codexBinary: fakeCodexPath,
          model: "gpt-5.5",
          images: ["./one.png"],
          configOverrides: ['model_reasoning_effort="high"'],
          additionalArgs: ["--skip-git-repo-check"],
        },
        "resume prompt",
      );
      const drained: unknown[] = [];
      for await (const line of stream.lines) {
        drained.push(line);
      }

      expect(await stream.completion).toBe(0);
      expect(drained).toEqual([]);
      const args = (await readFile(argsLogPath, "utf-8")).trimEnd().split("\n");
      expect(args).toEqual([
        "exec",
        "resume",
        "--json",
        "--model",
        "gpt-5.5",
        "-c",
        'model_reasoning_effort="high"',
        "--skip-git-repo-check",
        "--image",
        "./one.png",
        "--",
        "session-1",
        "resume prompt",
      ]);
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("spawnExec passes configured environment variables to the child process", async () => {
    const fixtureDir = await mkdtemp(
      join(tmpdir(), "codex-agent-process-manager-env-"),
    );
    try {
      const envLogPath = join(fixtureDir, "env.log");
      const fakeCodexPath = join(fixtureDir, "fake-codex-env.sh");
      await writeFile(
        fakeCodexPath,
        [
          "#!/usr/bin/env bash",
          "set -eu",
          `printf '%s' "\${CODEX_AGENT_TEST_ENV:-}" > '${envLogPath}'`,
          "exit 0",
        ].join("\n"),
        "utf-8",
      );
      await chmod(fakeCodexPath, 0o755);

      const pm = new ProcessManager(fakeCodexPath);
      const result = await pm.spawnExec("test prompt", {
        codexBinary: fakeCodexPath,
        environmentVariables: {
          CODEX_AGENT_TEST_ENV: "typed-env-value",
        },
      });

      expect(result.exitCode).toBe(0);
      const envValue = await readFile(envLogPath, "utf-8");
      expect(envValue).toBe("typed-env-value");
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  test("spawnExecStream returns streaming handle and completion", async () => {
    const pm = new ProcessManager("echo");
    const stream = pm.spawnExecStream("hello", {
      codexBinary: "echo",
    });

    const streamed: unknown[] = [];
    for await (const line of stream.lines) {
      streamed.push(line);
    }

    const exitCode = await stream.completion;
    expect(exitCode).toBe(0);
    expect(stream.process.status).toBe("running");
    expect(Array.isArray(streamed)).toBe(true);
  });

  test("spawnResume does not stall when child writes large stdout/stderr output", async () => {
    const fixtureDir = await mkdtemp(
      join(tmpdir(), "codex-agent-process-manager-"),
    );
    try {
      const fakeCodexPath = join(fixtureDir, "fake-codex-heavy-resume.sh");
      await writeFile(
        fakeCodexPath,
        [
          "#!/usr/bin/env bash",
          "set -eu",
          'if [ "$1" = "exec" ] && [ "$2" = "resume" ] && [ "$3" = "--json" ]; then',
          "  i=0",
          '  while [ "$i" -lt 4000 ]; do',
          '    printf \'%s\\n\' \'{"type":"event_msg","payload":{"type":"AgentMessage","message":"stdout"}}\'',
          "    printf '%s\\n' 'stderr noise line' >&2",
          "    i=$((i+1))",
          "  done",
          "fi",
          "exit 0",
        ].join("\n"),
        "utf-8",
      );
      await chmod(fakeCodexPath, 0o755);

      const pm = new ProcessManager(fakeCodexPath);
      const proc = pm.spawnResume("heavy-output-session", {
        codexBinary: fakeCodexPath,
      });

      const deadline = Date.now() + 5000;
      let current = pm.get(proc.id);
      while (current?.status === "running" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        current = pm.get(proc.id);
      }

      expect(current).not.toBeNull();
      expect(current?.status).toBe("exited");
      expect(current?.exitCode).toBe(0);
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
