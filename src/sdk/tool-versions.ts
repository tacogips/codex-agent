import { spawn } from "node:child_process";
import { mkdtemp, open, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  const captureDir = await mkdtemp(join(tmpdir(), "codex-agent-version-"));
  const stdoutPath = join(captureDir, "stdout.log");
  const stderrPath = join(captureDir, "stderr.log");
  const stdoutHandle = await open(stdoutPath, "w");
  const stderrHandle = await open(stderrPath, "w");

  return await new Promise<ToolVersionInfo>((resolve) => {
    const child = spawn(binary, ["--version"], {
      cwd: options?.cwd,
      stdio: ["ignore", stdoutHandle.fd, stderrHandle.fd],
      env: buildProcessEnv(options?.env),
    });

    let settled = false;

    const settle = (
      buildResult: (logs: {
        readonly stdout: string;
        readonly stderr: string;
      }) => ToolVersionInfo,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      void (async () => {
        await Promise.all([
          stdoutHandle.close().catch(() => {}),
          stderrHandle.close().catch(() => {}),
        ]);
        const [stdout, stderr] = await Promise.all([
          readFile(stdoutPath, "utf8").catch(() => ""),
          readFile(stderrPath, "utf8").catch(() => ""),
        ]);
        await rm(captureDir, { recursive: true, force: true }).catch(() => {});
        resolve(buildResult({ stdout, stderr }));
      })();
    };

    child.on("error", (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      settle(() => ({ version: null, error: message }));
    });

    child.on("close", (code, signal) => {
      settle(({ stdout, stderr }) => {
        if (code === 0) {
          const line = firstLine(stdout);
          if (line !== null) {
            return { version: line, error: null };
          }
          return {
            version: null,
            error: "version command succeeded but produced no output",
          };
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
        return { version: null, error: message };
      });
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      settle(() => ({
        version: null,
        error: `version command timed out after ${effectiveTimeout}ms`,
      }));
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
