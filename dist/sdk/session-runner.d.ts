import { EventEmitter } from "node:events";
import { ProcessManager } from "../process/manager";
import type { ApprovalMode, CodexEnvironmentVariables, CodexProcessOptions, SandboxMode, StreamGranularity } from "../process/types";
import type { RolloutLine } from "../types/rollout";
export interface SessionRunnerOptions {
    readonly codexBinary?: string | undefined;
    readonly codexHome?: string | undefined;
    readonly includeExistingOnResume?: boolean | undefined;
}
export interface SessionConfig {
    readonly prompt: string;
    readonly systemPrompt?: string | undefined;
    readonly resumeSessionId?: string | undefined;
    readonly cwd?: string | undefined;
    readonly sandbox?: SandboxMode | undefined;
    readonly approvalMode?: ApprovalMode | undefined;
    readonly fullAuto?: boolean | undefined;
    readonly model?: string | undefined;
    readonly additionalArgs?: readonly string[] | undefined;
    readonly configOverrides?: readonly string[] | undefined;
    readonly images?: readonly string[] | undefined;
    readonly streamGranularity?: StreamGranularity | undefined;
    readonly environmentVariables?: CodexEnvironmentVariables | undefined;
}
export interface SessionResult {
    readonly success: boolean;
    readonly exitCode: number;
    readonly stats: {
        readonly startedAt: string;
        readonly completedAt: string;
        readonly messageCount: number;
    };
}
export interface SessionCharStreamChunk {
    readonly kind: "char";
    readonly char: string;
    readonly sessionId: string;
    readonly timestamp: string;
    readonly sourceType: RolloutLine["type"];
    readonly source: RolloutLine;
}
export type SessionStreamChunk = RolloutLine | SessionCharStreamChunk;
export declare class RunningSession extends EventEmitter {
    private _sessionId;
    private readonly allowSessionIdUpdate;
    private readonly pm;
    private readonly processId;
    private readonly startedAt;
    private readonly streamGranularity;
    private readonly state;
    private stopHook;
    constructor(sessionId: string, pm: ProcessManager, processId: string, startedAt: Date, streamGranularity: StreamGranularity, allowSessionIdUpdate?: boolean);
    get sessionId(): string;
    setStopHook(stop: () => void): void;
    pushLine(line: RolloutLine): void;
    finish(exitCode: number): void;
    messages(): AsyncGenerator<SessionStreamChunk, void, undefined>;
    waitForCompletion(): Promise<SessionResult>;
    cancel(): Promise<void>;
    interrupt(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
}
export declare class SessionRunner {
    private readonly options;
    private readonly pm;
    private readonly active;
    constructor(options?: SessionRunnerOptions);
    startSession(config: SessionConfig): Promise<RunningSession>;
    resumeSession(sessionId: string, prompt?: string, options?: Omit<CodexProcessOptions, "codexBinary">): Promise<RunningSession>;
    private attachWatchWhenSessionAppears;
    listActiveSessions(): readonly RunningSession[];
    private trackSession;
    private toProcessOptions;
    private resolveCodexHome;
    private forwardExecStream;
}
//# sourceMappingURL=session-runner.d.ts.map