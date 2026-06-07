/**
 * Types for Codex CLI process management.
 */
import type { RolloutLine } from "../types/rollout";
export declare const SANDBOX_MODES: readonly ["read-only", "workspace-write", "danger-full-access"];
export type SandboxMode = (typeof SANDBOX_MODES)[number];
export declare const APPROVAL_MODES: readonly ["always", "unless-allow-listed", "never", "on-failure"];
export type ApprovalMode = (typeof APPROVAL_MODES)[number];
export declare const STREAM_GRANULARITIES: readonly ["event", "char"];
export type StreamGranularity = (typeof STREAM_GRANULARITIES)[number];
export type CodexEnvironmentVariables = Readonly<Record<string, string>>;
export interface CodexProcessOptions {
    readonly systemPrompt?: string | undefined;
    readonly model?: string | undefined;
    readonly cwd?: string | undefined;
    readonly sandbox?: SandboxMode | undefined;
    /**
     * Deprecated: Codex CLI 0.137.0 removed the approval-mode flag for
     * non-interactive exec. The field is kept as a no-op input for older SDK
     * callers, but ProcessManager must not emit `--ask-for-approval`.
     */
    readonly approvalMode?: ApprovalMode | undefined;
    /**
     * Enables Codex CLI's current explicit bypass flag for callers that request
     * legacy full-auto behavior.
     */
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
//# sourceMappingURL=types.d.ts.map