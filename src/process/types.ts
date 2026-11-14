/**
 * Types for Codex CLI process management.
 */

import type { RolloutLine } from "../types/rollout";

export type SandboxMode = "full" | "network-only" | "none";
export type ApprovalMode = "always" | "unless-allow-listed" | "never" | "on-failure";
export type StreamGranularity = "event" | "char";

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
