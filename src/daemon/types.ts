/**
 * Daemon management types.
 */

export interface DaemonInfo {
  readonly pid: number;
  readonly port: number;
  readonly startedAt: string;
  readonly mode: "http" | "app-server";
}

export interface DaemonConfig {
  readonly port?: number | undefined;
  readonly host?: string | undefined;
  readonly token?: string | undefined;
  readonly codexHome?: string | undefined;
  readonly configDir?: string | undefined;
  readonly mode?: "http" | "app-server" | undefined;
  readonly appServerUrl?: string | undefined;
}

export type DaemonStatus = "running" | "stopped" | "stale";

export interface DaemonStatusResult {
  readonly status: DaemonStatus;
  readonly info?: DaemonInfo | undefined;
}
