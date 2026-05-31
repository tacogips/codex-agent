import type { SessionResult, SessionRunnerOptions, SessionStreamChunk } from "./session-runner";
import type { ApprovalMode, CodexEnvironmentVariables, SandboxMode, StreamGranularity } from "../process/types";
export interface AgentRunnerOptions extends SessionRunnerOptions {
}
export type AgentStreamMode = "raw" | "normalized";
interface AgentRequestBase {
    readonly cwd?: string | undefined;
    readonly sandbox?: SandboxMode | undefined;
    readonly approvalMode?: ApprovalMode | undefined;
    readonly fullAuto?: boolean | undefined;
    readonly model?: string | undefined;
    readonly additionalArgs?: readonly string[] | undefined;
    readonly configOverrides?: readonly string[] | undefined;
    readonly streamGranularity?: StreamGranularity | undefined;
    readonly environmentVariables?: CodexEnvironmentVariables | undefined;
    readonly streamMode?: AgentStreamMode | undefined;
    readonly attachments?: readonly AgentAttachment[] | undefined;
}
export interface NewAgentRequest extends AgentRequestBase {
    readonly prompt: string;
    readonly sessionId?: undefined;
}
export interface ResumeAgentRequest extends AgentRequestBase {
    readonly sessionId: string;
    readonly prompt?: string | undefined;
}
export type AgentRequest = NewAgentRequest | ResumeAgentRequest;
export type AgentAttachment = {
    readonly type: "path";
    readonly path: string;
} | {
    readonly type: "base64";
    readonly data: string;
    readonly mediaType?: string | undefined;
    readonly filename?: string | undefined;
};
export interface AgentSessionStartedEvent {
    readonly type: "session.started";
    readonly sessionId: string;
    readonly resumed: boolean;
}
export interface AgentSessionMessageEvent {
    readonly type: "session.message";
    readonly sessionId: string;
    readonly chunk: SessionStreamChunk;
}
export interface AgentSessionCompletedEvent {
    readonly type: "session.completed";
    readonly sessionId: string;
    readonly result: SessionResult;
}
export interface AgentSessionErrorEvent {
    readonly type: "session.error";
    readonly sessionId?: string | undefined;
    readonly error: Error;
}
export type AgentEvent = AgentSessionStartedEvent | AgentSessionMessageEvent | AgentSessionCompletedEvent | AgentSessionErrorEvent;
export interface AgentAssistantDeltaEvent {
    readonly type: "assistant.delta";
    readonly sessionId: string;
    readonly text: string;
}
export interface AgentAssistantSnapshotEvent {
    readonly type: "assistant.snapshot";
    readonly sessionId: string;
    readonly content: string;
}
export interface AgentToolCallEvent {
    readonly type: "tool.call";
    readonly sessionId: string;
    readonly name: string;
    readonly input?: unknown;
}
export interface AgentToolResultEvent {
    readonly type: "tool.result";
    readonly sessionId: string;
    readonly name: string;
    readonly isError: boolean;
    readonly output?: unknown;
}
export interface AgentActivityEvent {
    readonly type: "activity";
    readonly sessionId: string;
    readonly message?: string;
}
export interface AgentNormalizedSessionCompletedEvent {
    readonly type: "session.completed";
    readonly sessionId: string;
    readonly success: boolean;
    readonly exitCode: number;
    readonly error?: string;
}
export type AgentNormalizedEvent = AgentSessionStartedEvent | AgentAssistantDeltaEvent | AgentAssistantSnapshotEvent | AgentToolCallEvent | AgentToolResultEvent | AgentActivityEvent | AgentNormalizedSessionCompletedEvent | AgentSessionErrorEvent;
export type AgentNormalizedChunkEvent = Exclude<AgentNormalizedEvent, AgentNormalizedSessionCompletedEvent>;
export declare function runAgent(request: AgentRequest & {
    readonly streamMode: "normalized";
}, options?: AgentRunnerOptions): AsyncGenerator<AgentNormalizedEvent, void, undefined>;
export declare function runAgent(request: AgentRequest, options?: AgentRunnerOptions): AsyncGenerator<AgentEvent, void, undefined>;
export declare function toNormalizedEvents(chunks: AsyncIterable<SessionStreamChunk>): AsyncGenerator<AgentNormalizedChunkEvent, void, undefined>;
export {};
//# sourceMappingURL=agent-runner.d.ts.map