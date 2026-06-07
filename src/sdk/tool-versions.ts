import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 5000;

export interface ToolVersionInfo {
  readonly version: string | null;
  readonly error: string | null;
}

export interface AgentToolVersions {
  readonly codex: ToolVersionInfo;
  readonly git?: ToolVersionInfo;
}

export interface GetCodexCliVersionOptions {
  readonly codexBinary?: string | undefined;
  readonly cwd?: string | undefined;
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface GetToolVersionsOptions extends GetCodexCliVersionOptions {
  readonly includeGit?: boolean | undefined;
  readonly gitBinary?: string | undefined;
}

export async function getCodexCliVersion(
  options?: GetCodexCliVersionOptions,
): Promise<ToolVersionInfo> {
  return await readToolVersion(options?.codexBinary ?? "codex", options);
}

export async function getToolVersions(
  options?: GetToolVersionsOptions,
): Promise<AgentToolVersions> {
  const codex = await getCodexCliVersion(options);

  if (options?.includeGit !== true) {
    return { codex };
  }

  const git = await readToolVersion(options.gitBinary ?? "git", options);
  return { codex, git };
}

async function readToolVersion(
  binary: string,
  options: GetCodexCliVersionOptions | undefined,
): Promise<ToolVersionInfo> {
  const timeoutMs = options?.timeoutMs;
  const effectiveTimeout =
    timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_TIMEOUT_MS;

  return await new Promise<ToolVersionInfo>((resolve) => {
    const child = spawn(binary, ["--version"], {
      cwd: options?.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: buildProcessEnv(options?.env),
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let childResult:
      | {
          readonly code: number | null;
          readonly signal: NodeJS.Signals | null;
        }
      | undefined;
    let stdoutClosed = child.stdout === null;
    let stderrClosed = child.stderr === null;

    const settle = (result: ToolVersionInfo): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const markStdoutClosed = (): void => {
      stdoutClosed = true;
      finalizeClosedCommand();
    };

    const markStderrClosed = (): void => {
      stderrClosed = true;
      finalizeClosedCommand();
    };

    const finalizeClosedCommand = (): void => {
      if (
        childResult === undefined ||
        !stdoutClosed ||
        !stderrClosed ||
        settled
      ) {
        return;
      }
      const { code, signal } = childResult;
      if (code === 0) {
        const line = firstLine(stdout);
        if (line !== null) {
          settle({ version: line, error: null });
          return;
        }
        settle({
          version: null,
          error: "version command succeeded but produced no output",
        });
        return;
      }

      const reason =
        signal !== null
          ? `signal ${signal}`
          : `exit code ${String(code ?? "unknown")}`;
      const details = firstLine(stderr);
      const message =
        details === null
          ? `version command failed (${reason})`
          : `version command failed (${reason}): ${details}`;
      settle({ version: null, error: message });
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stdout.on("end", markStdoutClosed);
    child.stdout.on("close", markStdoutClosed);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stderr.on("end", markStderrClosed);
    child.stderr.on("close", markStderrClosed);

    child.on("error", (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      settle({ version: null, error: message });
    });

    child.on("close", (code, signal) => {
      childResult = { code, signal };
      finalizeClosedCommand();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle({
        version: null,
        error: `version command timed out after ${effectiveTimeout}ms`,
      });
    }, effectiveTimeout);
  });
}

function buildProcessEnv(
  env: Readonly<Record<string, string | undefined>> | undefined,
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = { ...process.env };
  if (env === undefined) {
    return nextEnv;
  }
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      nextEnv[key] = value;
    }
  }
  return nextEnv;
}

function firstLine(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.split(/\r?\n/u)[0] ?? null;
}
