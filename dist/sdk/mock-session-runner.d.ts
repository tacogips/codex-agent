import { EventEmitter } from "node:events";
import type { ApprovalMode, CodexEnvironmentVariables, SandboxMode, StreamGranularity } from "../process/types";
import type { RolloutLine } from "../types/rollout";
export interface MockCodexProcessOptions {
    readonly resumeSessionId?: string;
    readonly cwd?: string;
    readonly sandbox?: SandboxMode;
    readonly approvalMode?: ApprovalMode;
    readonly fullAuto?: boolean;
    readonly model?: string;
    readonly additionalArgs?: readonly string[];
    readonly configOverrides?: readonly string[];
    readonly images?: readonly string[];
    readonly streamGranularity?: StreamGranularity;
    readonly environmentVariables?: CodexEnvironmentVariables;
}
export interface MockCodexSessionConfig extends MockCodexProcessOptions {
    readonly prompt: string;
}
export type MockCodexResumeOptions = Omit<MockCodexProcessOptions, "resumeSessionId">;
export interface MockCodexSessionResult {
    readonly success: boolean;
    readonly exitCode: number;
    readonly stats: {
        readonly startedAt: string;
        readonly completedAt: string;
        readonly messageCount: number;
    };
}
export interface MockCodexSessionCharStreamChunk {
    readonly kind: "char";
    readonly char: string;
    readonly sessionId: string;
    readonly timestamp: string;
    readonly sourceType: RolloutLine["type"];
    readonly source: RolloutLine;
}
export type MockCodexSessionStreamChunk = RolloutLine | MockCodexSessionCharStreamChunk;
export interface MockCodexSessionResultInput {
    readonly success?: boolean;
    readonly exitCode?: number;
    readonly startedAt?: string;
    readonly completedAt?: string;
    readonly messageCount?: number;
}
export interface MockCodexRunningSessionOptions {
    readonly sessionId: string;
    readonly messages?: readonly MockCodexSessionStreamChunk[];
    readonly result?: MockCodexSessionResultInput;
    readonly autoComplete?: boolean;
}
export interface MockCodexStartSessionCall {
    readonly config: MockCodexSessionConfig;
}
export interface MockCodexResumeSessionCall {
    readonly sessionId: string;
    readonly prompt?: string;
    readonly options?: MockCodexResumeOptions;
}
export declare class MockCodexRunningSession extends EventEmitter {
    #private;
    constructor(options: MockCodexRunningSessionOptions);
    get sessionId(): string;
    getState(): Readonly<Record<string, string>>;
    pushMessage(message: MockCodexSessionStreamChunk): void;
    complete(result?: MockCodexSessionResultInput): void;
    messages(): AsyncGenerator<MockCodexSessionStreamChunk, void, undefined>;
    waitForCompletion(): Promise<MockCodexSessionResult>;
    cancel(): Promise<void>;
}
export declare class MockCodexSessionRunner {
    #private;
    readonly startSessionCalls: MockCodexStartSessionCall[];
    readonly resumeSessionCalls: MockCodexResumeSessionCall[];
    enqueueStartSession(session: MockCodexRunningSession): void;
    enqueueResumeSession(session: MockCodexRunningSession): void;
    startSession(config: MockCodexSessionConfig): Promise<MockCodexRunningSession>;
    resumeSession(sessionId: string, prompt?: string, options?: MockCodexResumeOptions): Promise<MockCodexRunningSession>;
}
export declare function createMockCodexSessionRunner(input?: {
    readonly startSessions?: readonly MockCodexRunningSession[];
    readonly resumeSessions?: readonly MockCodexRunningSession[];
}): MockCodexSessionRunner;
//# sourceMappingURL=mock-session-runner.d.ts.map