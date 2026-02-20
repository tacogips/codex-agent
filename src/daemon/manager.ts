/**
 * Daemon lifecycle management.
 *
 * PID file at ~/.config/codex-agent/daemon.pid (JSON: { pid, port, startedAt, mode }).
 * startDaemon(): spawns detached subprocess, polls /health until ready.
 * stopDaemon(): reads PID file, sends SIGTERM.
 * getDaemonStatus(): returns running/stopped/stale.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile, rename, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DaemonConfig, DaemonInfo, DaemonStatusResult } from "./types";

const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "codex-agent");
const PID_FILENAME = "daemon.pid";
const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 10_000;

function pidFilePath(configDir?: string): string {
  return join(configDir ?? DEFAULT_CONFIG_DIR, PID_FILENAME);
}

async function readPidFile(configDir?: string): Promise<DaemonInfo | null> {
  try {
    const raw = await readFile(pidFilePath(configDir), "utf-8");
    const data = JSON.parse(raw) as DaemonInfo & {
      mode?: "http" | "app-server" | undefined;
    };
    if (
      typeof data.pid !== "number" ||
      typeof data.port !== "number" ||
      typeof data.startedAt !== "string"
    ) {
      return null;
    }
    return {
      pid: data.pid,
      port: data.port,
      startedAt: data.startedAt,
      mode: data.mode ?? "http",
    };
  } catch {
    return null;
  }
}

async function writePidFile(
  info: DaemonInfo,
  configDir?: string,
): Promise<void> {
  const dir = configDir ?? DEFAULT_CONFIG_DIR;
  const finalPath = pidFilePath(configDir);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(dir, { recursive: true });
  await writeFile(tmpPath, JSON.stringify(info, null, 2));
  await rename(tmpPath, finalPath);
}

async function removePidFile(configDir?: string): Promise<void> {
  try {
    await unlink(pidFilePath(configDir));
  } catch {
    // Ignore if doesn't exist
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pollHealth(
  port: number,
  timeoutMs: number = POLL_TIMEOUT_MS,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`);
      if (resp.ok) return true;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

export async function startDaemon(
  config: DaemonConfig = {},
): Promise<DaemonInfo> {
  const port = config.port ?? 3100;
  const host = config.host;
  const mode = config.mode ?? "http";
  const configDir = config.configDir;
  if (
    mode === "app-server" &&
    (config.appServerUrl === undefined || config.appServerUrl === "")
  ) {
    throw new Error("Daemon app-server mode requires appServerUrl");
  }

  // Check if already running
  const existing = await getDaemonStatus(configDir);
  if (existing.status === "running" && existing.info !== undefined) {
    throw new Error(
      `Daemon already running (pid: ${existing.info.pid}, port: ${existing.info.port}, mode: ${existing.info.mode})`,
    );
  }

  // Clean up stale PID file
  if (existing.status === "stale") {
    await removePidFile(configDir);
  }

  // Find the bin.ts entry point relative to this file
  const binPath = join(import.meta.dir, "..", "bin.ts");
  const daemonArgs = ["run", binPath, "server", "start", "--port", String(port)];
  if (host !== undefined && host !== "") {
    daemonArgs.push("--host", host);
  }
  if (config.token !== undefined && config.token !== "") {
    daemonArgs.push("--token", config.token);
  }
  if (mode === "app-server") {
    daemonArgs.push("--transport", "app-server");
    if (config.appServerUrl !== undefined && config.appServerUrl !== "") {
      daemonArgs.push("--app-server-url", config.appServerUrl);
    }
  }

  const child = spawn("bun", daemonArgs, { detached: true, stdio: "ignore" });

  child.unref();

  if (child.pid === undefined) {
    throw new Error("Failed to spawn daemon process");
  }

  const info: DaemonInfo = {
    pid: child.pid,
    port,
    startedAt: new Date().toISOString(),
    mode,
  };

  await writePidFile(info, configDir);

  // Poll until healthy
  const ready = await pollHealth(port);
  if (!ready) {
    // Clean up if server didn't start
    await removePidFile(configDir);
    throw new Error(
      `Daemon started but health check failed after ${POLL_TIMEOUT_MS}ms`,
    );
  }

  return info;
}

export async function stopDaemon(configDir?: string): Promise<boolean> {
  const info = await readPidFile(configDir);
  if (info === null) {
    return false;
  }

  if (isProcessAlive(info.pid)) {
    try {
      process.kill(info.pid, "SIGTERM");
    } catch {
      // Process may have already exited
    }
  }

  await removePidFile(configDir);
  return true;
}

export async function getDaemonStatus(
  configDir?: string,
): Promise<DaemonStatusResult> {
  const info = await readPidFile(configDir);
  if (info === null) {
    return { status: "stopped" };
  }

  if (!isProcessAlive(info.pid)) {
    return { status: "stale", info };
  }

  return { status: "running", info };
}
