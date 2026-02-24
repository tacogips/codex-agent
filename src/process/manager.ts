/**
 * ProcessManager - Spawn and manage Codex CLI subprocesses.
 *
 * Supports exec mode (non-interactive), resume, and fork.
 * Parses JSONL output from `codex exec --json`.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type {
  CodexProcess,
  CodexProcessOptions,
  ExecResult,
  ProcessStatus,
} from "./types";
import type { RolloutLine } from "../types/rollout";
import { parseRolloutLine } from "../rollout/reader";

const DEFAULT_BINARY = "codex";

/**
 * Manages Codex CLI subprocess lifecycle.
 */
export class ProcessManager {
  private readonly processes = new Map<string, ManagedProcess>();
  private readonly binary: string;

  constructor(binary?: string) {
    this.binary = binary ?? DEFAULT_BINARY;
  }

  /**
   * Spawn a non-interactive `codex exec --json` process.
   * Returns the parsed JSONL output and exit code once complete.
   */
  async spawnExec(
    prompt: string,
    options?: CodexProcessOptions,
  ): Promise<ExecResult> {
    const args = buildExecArgs(prompt, options);
    const binary = options?.codexBinary ?? this.binary;
    const cwd = options?.cwd;

    const child = spawn(binary, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    const id = randomUUID();
    const managed = createManagedProcess(id, child, binary + " " + args.join(" "), prompt);
    this.processes.set(id, managed);

    const lines = await collectJsonlOutput(child);

    const exitCode = await waitForExit(child);
    managed.status = "exited";
    managed.exitCode = exitCode;

    return { exitCode, lines };
  }

  /**
   * Spawn `codex resume <sessionId>` as an interactive process.
   * Returns the process handle for monitoring.
   */
  spawnResume(
    sessionId: string,
    options?: CodexProcessOptions,
  ): CodexProcess {
    const args = ["resume", sessionId, ...buildCommonArgs(options)];
    return this.spawnTracked(args, options, `resume ${sessionId}`);
  }

  /**
   * Spawn `codex fork <sessionId>` as an interactive process.
   * Returns the process handle for monitoring.
   */
  spawnFork(
    sessionId: string,
    nthMessage?: number,
    options?: CodexProcessOptions,
  ): CodexProcess {
    const args = ["fork", sessionId];
    if (nthMessage !== undefined) {
      args.push("--nth-message", String(nthMessage));
    }
    args.push(...buildCommonArgs(options));
    return this.spawnTracked(args, options, `fork ${sessionId}`);
  }

  /**
   * List all tracked processes.
   */
  list(): readonly CodexProcess[] {
    return Array.from(this.processes.values()).map(toCodexProcess);
  }

  /**
   * Get a specific process by ID.
   */
  get(id: string): CodexProcess | null {
    const managed = this.processes.get(id);
    if (managed === undefined) {
      return null;
    }
    return toCodexProcess(managed);
  }

  /**
   * Kill a running process.
   */
  kill(id: string): boolean {
    const managed = this.processes.get(id);
    if (managed === undefined) {
      return false;
    }
    if (managed.status !== "running") {
      return false;
    }
    managed.child.kill("SIGTERM");
    managed.status = "killed";
    return true;
  }

  /**
   * Kill all running processes.
   */
  killAll(): void {
    for (const managed of this.processes.values()) {
      if (managed.status === "running") {
        managed.child.kill("SIGTERM");
        managed.status = "killed";
      }
    }
  }

  /**
   * Remove completed/killed processes from tracking.
   */
  prune(): number {
    let count = 0;
    for (const [id, managed] of this.processes) {
      if (managed.status !== "running") {
        this.processes.delete(id);
        count++;
      }
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private spawnTracked(
    args: string[],
    options: CodexProcessOptions | undefined,
    prompt: string,
  ): CodexProcess {
    const binary = options?.codexBinary ?? this.binary;
    const cwd = options?.cwd;

    const child = spawn(binary, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const id = randomUUID();
    const managed = createManagedProcess(id, child, binary + " " + args.join(" "), prompt);
    this.processes.set(id, managed);

    child.on("exit", (code) => {
      managed.status = "exited";
      managed.exitCode = code ?? 1;
    });

    return toCodexProcess(managed);
  }
}

// ---------------------------------------------------------------------------
// Arg builders
// ---------------------------------------------------------------------------

function buildExecArgs(
  prompt: string,
  options?: CodexProcessOptions,
): string[] {
  const args = ["exec", "--json", prompt];
  if (options?.images !== undefined) {
    for (const imagePath of options.images) {
      args.push("--image", imagePath);
    }
  }
  args.push(...buildCommonArgs(options));
  return args;
}

function buildCommonArgs(options?: CodexProcessOptions): string[] {
  const args: string[] = [];
  if (options?.model !== undefined) {
    args.push("--model", options.model);
  }
  if (options?.fullAuto === true) {
    args.push("--full-auto");
  }
  if (options?.sandbox !== undefined) {
    args.push("--sandbox", options.sandbox);
  }
  if (options?.approvalMode !== undefined) {
    args.push("--ask-for-approval", options.approvalMode);
  }
  if (options?.configOverrides !== undefined) {
    for (const override of options.configOverrides) {
      args.push("-c", override);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

interface ManagedProcess {
  id: string;
  child: ChildProcess;
  command: string;
  prompt: string;
  startedAt: Date;
  status: ProcessStatus;
  exitCode: number | undefined;
}

function createManagedProcess(
  id: string,
  child: ChildProcess,
  command: string,
  prompt: string,
): ManagedProcess {
  return {
    id,
    child,
    command,
    prompt,
    startedAt: new Date(),
    status: "running",
    exitCode: undefined,
  };
}

function toCodexProcess(managed: ManagedProcess): CodexProcess {
  return {
    id: managed.id,
    pid: managed.child.pid ?? -1,
    command: managed.command,
    prompt: managed.prompt,
    startedAt: managed.startedAt,
    status: managed.status,
    exitCode: managed.exitCode,
  };
}

async function collectJsonlOutput(child: ChildProcess): Promise<readonly RolloutLine[]> {
  if (child.stdout === null) {
    return [];
  }

  const lines: RolloutLine[] = [];
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });

  for await (const line of rl) {
    const parsed = parseRolloutLine(line);
    if (parsed !== null) {
      lines.push(parsed);
    }
  }

  return lines;
}

function waitForExit(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
    child.on("error", () => {
      resolve(1);
    });
  });
}
