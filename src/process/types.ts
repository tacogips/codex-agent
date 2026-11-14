/**
 * Types for Codex CLI process management.
 */

import type { RolloutLine } from "../types/rollout";

export const SANDBOX_MODES = ["full", "network-only", "none"] as const;
export type SandboxMode = (typeof SANDBOX_MODES)[number];

export const APPROVAL_MODES = [
  "always",
  "unless-allow-listed",
  "never",
  "on-failure",
] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const STREAM_GRANULARITIES = ["event", "char"] as const;
export type StreamGranularity = (typeof STREAM_GRANULARITIES)[number];

export type CodexEnvironmentVariables = Readonly<Record<string, string>>;

export interface CodexProcessOptions {
  readonly model?: string | undefined;
  readonly cwd?: string | undefined;
  readonly sandbox?: SandboxMode | undefined;
  readonly approvalMode?: ApprovalMode | undefined;
  readonly fullAuto?: boolean | undefined;
  readonly additionalArgs?: readonly string[] | undefined;
  readonly images?: readonly string[] | undefined;
  readonly configOverrides?: readonly string[] | undefined;
  readonly streamGranularity?: StreamGranularity | undefined;
  readonly environmentVariables?: CodexEnvironmentVariables | undefined;
  readonly codexBinary?: string | undefined;
}

export type ProcessStatus = "running" | "exited" | "killed";

export interface CodexProcess {
  readonly id: string;
  readonly pid: number;
  readonly command: string;
  readonly prompt: string;
  readonly startedAt: Date;
  readonly status: ProcessStatus;
  readonly exitCode?: number | undefined;
}

export interface ExecResult {
  readonly exitCode: number;
  readonly lines: readonly RolloutLine[];
}

export interface ExecStreamResult {
  readonly process: CodexProcess;
  readonly lines: AsyncIterable<RolloutLine>;
  readonly completion: Promise<number>;
}
