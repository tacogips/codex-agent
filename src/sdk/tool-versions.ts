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
  readonly timeoutMs?: number | undefined;
}

export interface GetToolVersionsOptions extends GetCodexCliVersionOptions {
  readonly includeGit?: boolean | undefined;
  readonly gitBinary?: string | undefined;
}

export async function getCodexCliVersion(
  options?: GetCodexCliVersionOptions,
): Promise<ToolVersionInfo> {
  return await readToolVersion(
    options?.codexBinary ?? "codex",
    options?.timeoutMs,
  );
}

export async function getToolVersions(
  options?: GetToolVersionsOptions,
): Promise<AgentToolVersions> {
  const codex = await getCodexCliVersion(options);

  if (options?.includeGit !== true) {
    return { codex };
  }

  const git = await readToolVersion(
    options.gitBinary ?? "git",
    options.timeoutMs,
  );
  return { codex, git };
}

async function readToolVersion(
  binary: string,
  timeoutMs: number | undefined,
): Promise<ToolVersionInfo> {
  const effectiveTimeout =
    timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_TIMEOUT_MS;

  return await new Promise<ToolVersionInfo>((resolve) => {
    const child = spawn(binary, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (result: ToolVersionInfo): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      settle({ version: null, error: message });
    });

    child.on("close", (code, signal) => {
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

function firstLine(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.split(/\r?\n/u)[0] ?? null;
}
