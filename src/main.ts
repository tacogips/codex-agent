/**
 * codex-agent - Codex-compatible process manager
 *
 * Public API re-exports.
 */

// Types
export type {
  RolloutLine,
  RolloutItem,
  SessionMeta,
  SessionMetaLine,
  SessionSource,
  GitInfo,
  ResponseItem,
  EventMsg,
  CompactedItem,
  TurnContextItem,
  CodexSession,
  SessionListOptions,
  SessionListResult,
} from "./types/index";

export {
  isSessionMeta,
  isResponseItem,
  isEventMsg,
  isCompacted,
  isTurnContext,
} from "./types/index";

// Rollout reader
export {
  parseRolloutLine,
  readRollout,
  parseSessionMeta,
  streamEvents,
  extractFirstUserMessage,
} from "./rollout/index";

// Rollout watcher
export { RolloutWatcher, sessionsWatchDir } from "./rollout/index";
export type { RolloutWatcherEvents } from "./rollout/index";

// Session index
export {
  resolveCodexHome,
  discoverRolloutPaths,
  buildSession,
  listSessions,
  findSession,
  findLatestSession,
} from "./session/index";

// Process manager
export { ProcessManager } from "./process/index";
export type {
  CodexProcess,
  CodexProcessOptions,
  ExecResult,
  ProcessStatus,
  SandboxMode,
  ApprovalMode,
} from "./process/index";

// CLI
export { run as runCli } from "./cli/index";
