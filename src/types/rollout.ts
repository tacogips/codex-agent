/**
 * Core types for Codex rollout JSONL files.
 *
 * These types mirror the Codex CLI's Rust types from codex-rs/protocol.
 * We define a practical subset covering the items persisted in Limited and Extended modes.
 */

// ---------------------------------------------------------------------------
// Session metadata
// ---------------------------------------------------------------------------

export type SessionSource = "cli" | "vscode" | "exec" | "unknown";

export interface GitInfo {
  readonly sha?: string;
  readonly branch?: string;
  readonly origin_url?: string;
}

export interface SessionMeta {
  readonly id: string;
  readonly forked_from_id?: string;
  readonly timestamp: string;
  readonly cwd: string;
  readonly originator: string;
  readonly cli_version: string;
  readonly source: SessionSource;
  readonly model_provider?: string;
  readonly base_instructions?: unknown;
  readonly dynamic_tools?: readonly unknown[];
}

export interface SessionMetaLine {
  readonly meta: SessionMeta;
  readonly git?: GitInfo;
}

// ---------------------------------------------------------------------------
// Response items (model outputs)
// ---------------------------------------------------------------------------

export interface ContentItemText {
  readonly type: "input_text" | "output_text";
  readonly text: string;
}

export interface ContentItemOther {
  readonly type: string;
  readonly [key: string]: unknown;
}

export type ContentItem = ContentItemText | ContentItemOther;

export interface ResponseItemMessage {
  readonly type: "message";
  readonly id?: string;
  readonly role: string;
  readonly content: readonly ContentItem[];
  readonly end_turn?: boolean;
}

export interface ResponseItemReasoning {
  readonly type: "reasoning";
  readonly id: string;
  readonly summary: readonly { readonly text: string }[];
  readonly encrypted_content?: string;
}

export interface ResponseItemLocalShellCall {
  readonly type: "local_shell_call";
  readonly id?: string;
  readonly call_id?: string;
  readonly status: string;
  readonly action: {
    readonly type: string;
    readonly command?: readonly string[];
    readonly [key: string]: unknown;
  };
}

export interface ResponseItemFunctionCall {
  readonly type: "function_call";
  readonly id?: string;
  readonly name: string;
  readonly arguments: string;
  readonly call_id: string;
}

export interface ResponseItemFunctionCallOutput {
  readonly type: "function_call_output";
  readonly call_id: string;
  readonly output: unknown;
}

export interface ResponseItemOther {
  readonly type: string;
  readonly [key: string]: unknown;
}

export type ResponseItem =
  | ResponseItemMessage
  | ResponseItemReasoning
  | ResponseItemLocalShellCall
  | ResponseItemFunctionCall
  | ResponseItemFunctionCallOutput
  | ResponseItemOther;

// ---------------------------------------------------------------------------
// Event messages
// ---------------------------------------------------------------------------

export interface UserMessageEvent {
  readonly type: "UserMessage";
  readonly message: string;
  readonly images?: readonly string[];
}

export interface AgentMessageEvent {
  readonly type: "AgentMessage";
  readonly message: string;
}

export interface AgentReasoningEvent {
  readonly type: "AgentReasoning";
  readonly text: string;
}

export interface TurnStartedEvent {
  readonly type: "TurnStarted";
  readonly turn_id: string;
}

export interface TurnCompleteEvent {
  readonly type: "TurnComplete";
  readonly turn_id: string;
  readonly last_agent_message?: string;
}

export interface TurnAbortedEvent {
  readonly type: "TurnAborted";
  readonly turn_id: string;
  readonly reason?: string;
}

export interface TokenCountEvent {
  readonly type: "TokenCount";
  readonly model?: string;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly total_tokens?: number;
}

export interface ExecCommandBeginEvent {
  readonly type: "ExecCommandBegin";
  readonly call_id: string;
  readonly turn_id: string;
  readonly command: readonly string[];
  readonly cwd: string;
}

export interface ExecCommandEndEvent {
  readonly type: "ExecCommandEnd";
  readonly call_id: string;
  readonly turn_id: string;
  readonly command: readonly string[];
  readonly cwd: string;
  readonly exit_code: number;
  readonly aggregated_output?: string;
  readonly duration?: { readonly secs: number; readonly nanos: number };
}

export interface ContextCompactedEvent {
  readonly type: "ContextCompacted";
  readonly [key: string]: unknown;
}

export interface ErrorEvent {
  readonly type: "Error";
  readonly message: string;
}

export interface SessionConfiguredEvent {
  readonly type: "SessionConfigured";
  readonly [key: string]: unknown;
}

export interface ThreadNameUpdatedEvent {
  readonly type: "ThreadNameUpdated";
  readonly name: string;
}

export interface GenericEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

/**
 * Discriminated union of event message types.
 * We cover the core subset persisted in Limited/Extended mode.
 * Unknown event types are captured as GenericEvent.
 */
export type EventMsg =
  | UserMessageEvent
  | AgentMessageEvent
  | AgentReasoningEvent
  | TurnStartedEvent
  | TurnCompleteEvent
  | TurnAbortedEvent
  | TokenCountEvent
  | ExecCommandBeginEvent
  | ExecCommandEndEvent
  | ContextCompactedEvent
  | ErrorEvent
  | SessionConfiguredEvent
  | ThreadNameUpdatedEvent
  | GenericEvent;

// ---------------------------------------------------------------------------
// Compacted and TurnContext
// ---------------------------------------------------------------------------

export interface CompactedItem {
  readonly items?: readonly unknown[];
  readonly [key: string]: unknown;
}

export interface TurnContextItem {
  readonly cwd?: string;
  readonly model?: string;
  readonly sandbox_policy?: string;
  readonly approval_mode?: string;
  readonly [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// RolloutItem (tagged union) and RolloutLine
// ---------------------------------------------------------------------------

export interface RolloutItemSessionMeta {
  readonly type: "session_meta";
  readonly payload: SessionMetaLine;
}

export interface RolloutItemResponseItem {
  readonly type: "response_item";
  readonly payload: ResponseItem;
}

export interface RolloutItemEventMsg {
  readonly type: "event_msg";
  readonly payload: EventMsg;
}

export interface RolloutItemCompacted {
  readonly type: "compacted";
  readonly payload: CompactedItem;
}

export interface RolloutItemTurnContext {
  readonly type: "turn_context";
  readonly payload: TurnContextItem;
}

export type RolloutItem =
  | RolloutItemSessionMeta
  | RolloutItemResponseItem
  | RolloutItemEventMsg
  | RolloutItemCompacted
  | RolloutItemTurnContext;

/**
 * A single line from a Codex rollout JSONL file.
 */
export interface RolloutLine {
  readonly timestamp: string;
  readonly type: RolloutItem["type"];
  readonly payload: RolloutItem["payload"];
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isSessionMeta(
  item: RolloutLine,
): item is RolloutLine & { type: "session_meta"; payload: SessionMetaLine } {
  return item.type === "session_meta";
}

export function isResponseItem(
  item: RolloutLine,
): item is RolloutLine & { type: "response_item"; payload: ResponseItem } {
  return item.type === "response_item";
}

export function isEventMsg(
  item: RolloutLine,
): item is RolloutLine & { type: "event_msg"; payload: EventMsg } {
  return item.type === "event_msg";
}

export function isCompacted(
  item: RolloutLine,
): item is RolloutLine & { type: "compacted"; payload: CompactedItem } {
  return item.type === "compacted";
}

export function isTurnContext(
  item: RolloutLine,
): item is RolloutLine & { type: "turn_context"; payload: TurnContextItem } {
  return item.type === "turn_context";
}
