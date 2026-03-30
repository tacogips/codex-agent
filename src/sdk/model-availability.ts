import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_PROBE_PROMPT = "Reply with exactly OK.";

export interface CodexLoginStatusInfo {
  readonly ok: boolean;
  readonly status: string | null;
  readonly error: string | null;
  readonly exitCode: number | null;
}

export interface GetCodexLoginStatusOptions {
  readonly codexBinary?: string | undefined;
  readonly cwd?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface CodexModelProbeInfo {
  readonly ok: boolean;
  readonly model: string;
  readonly output: string | null;
  readonly error: string | null;
  readonly exitCode: number | null;
}

export interface CheckCodexModelAvailabilityOptions
  extends GetCodexLoginStatusOptions {
  readonly model: string;
  readonly prompt?: string | undefined;
}

export interface CodexModelAvailabilityResult {
  readonly ok: boolean;
  readonly model: string;
  readonly auth: CodexLoginStatusInfo;
  readonly probe: CodexModelProbeInfo;
}

interface CommandResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error: string | null;
}

export async function getCodexLoginStatus(
  options?: GetCodexLoginStatusOptions,
): Promise<CodexLoginStatusInfo> {
  const result = await runCodexCommand(
    options?.codexBinary ?? "codex",
    ["login", "status"],
    options,
  );
  const status =
    firstNonEmptyLine(result.stdout) ?? firstNonEmptyLine(result.stderr);

  if (result.error !== null) {
    return {
      ok: false,
      status,
      error:
        status !== null && looksUnauthenticated(status) ? status : result.error,
      exitCode: result.exitCode,
    };
  }

  if (status === null) {
    return {
      ok: false,
      status: null,
      error: "login status command succeeded but produced no output",
      exitCode: result.exitCode,
    };
  }

  if (looksUnauthenticated(status)) {
    return {
      ok: false,
      status,
      error: status,
      exitCode: result.exitCode,
    };
  }

  return {
    ok: true,
    status,
    error: null,
    exitCode: result.exitCode,
  };
}

export async function checkCodexModelAvailability(
  options: CheckCodexModelAvailabilityOptions,
): Promise<CodexModelAvailabilityResult> {
  const model = options.model.trim();
  if (model.length === 0) {
    throw new Error("model is required");
  }

  const [auth, probe] = await Promise.all([
    getCodexLoginStatus(options),
    runModelProbe({
      ...options,
      model,
    }),
  ]);

  return {
    ok: auth.ok && probe.ok,
    model,
    auth,
    probe,
  };
}

async function runModelProbe(
  options: CheckCodexModelAvailabilityOptions & { readonly model: string },
): Promise<CodexModelProbeInfo> {
  const args = [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "--sandbox",
    "read-only",
  ];

  if (options.cwd !== undefined) {
    args.push("--cd", options.cwd);
  }

  args.push("--model", options.model, options.prompt ?? DEFAULT_PROBE_PROMPT);

  const result = await runCodexCommand(
    options.codexBinary ?? "codex",
    args,
    options,
  );
  const output = firstNonEmptyLine(result.stdout);

  return {
    ok: result.error === null,
    model: options.model,
    output,
    error: result.error,
    exitCode: result.exitCode,
  };
}

async function runCodexCommand(
  binary: string,
  args: readonly string[],
  options?: GetCodexLoginStatusOptions,
): Promise<CommandResult> {
  const timeoutMs = normalizeTimeout(options?.timeoutMs);

  return await new Promise<CommandResult>((resolve) => {
    const child = spawn(binary, args, {
      cwd: options?.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (result: CommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolve(result);
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error: unknown) => {
      settle({
        exitCode: null,
        stdout,
        stderr,
        error: toErrorMessage(error),
      });
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        settle({
          exitCode: 0,
          stdout,
          stderr,
          error: null,
        });
        return;
      }

      const reason =
        signal !== null
          ? `signal ${signal}`
          : `exit code ${String(code ?? "unknown")}`;
      const details = firstNonEmptyLine(stderr) ?? firstNonEmptyLine(stdout);
      settle({
        exitCode: code ?? null,
        stdout,
        stderr,
        error:
          details === null
            ? `command failed (${reason})`
            : `command failed (${reason}): ${details}`,
      });
    });

    timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle({
        exitCode: null,
        stdout,
        stderr,
        error: `command timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
  });
}

function normalizeTimeout(value: number | undefined): number {
  if (value !== undefined && Number.isFinite(value) && value > 0) {
    return value;
  }
  return DEFAULT_TIMEOUT_MS;
}

function looksUnauthenticated(status: string): boolean {
  return /not\s+logged|logged\s*out|unauthenticated|no\s+stored\s+credentials/iu.test(
    status,
  );
}

function firstNonEmptyLine(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.split(/\r?\n/u)[0] ?? null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
