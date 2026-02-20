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

// SQLite session index
export {
  openCodexDb,
  listSessionsSqlite,
  findSessionSqlite,
  findLatestSessionSqlite,
} from "./session/sqlite";

// Group manager
export type {
  SessionGroup,
  SessionGroupData,
  GroupConfig,
  GroupRunOptions,
  GroupEvent,
  GroupEventType,
} from "./group/index";

export {
  loadGroups,
  saveGroups,
  addGroup,
  removeGroup,
  findGroup,
  listGroups,
  addSessionToGroup,
  removeSessionFromGroup,
  runGroup,
} from "./group/index";

// Queue manager
export type {
  PromptQueue,
  PromptQueueData,
  QueuePrompt,
  QueuePromptData,
  QueueConfig,
  QueuePromptStatus,
  QueueEvent,
  QueueEventType,
} from "./queue/index";

export {
  loadQueues,
  saveQueues,
  createQueue,
  addPrompt,
  removeQueue,
  findQueue,
  listQueues,
  updateQueuePrompts,
  runQueue,
} from "./queue/index";

// Server
export {
  startServer,
  resolveServerConfig,
  createAppServerClient,
} from "./server/index";
export type {
  ServerConfig,
  ServerHandle,
  RouteHandler,
  RouteParams,
  AppServerClientConfig,
  AppServerClient,
  AppServerSessionEvent,
} from "./server/index";

// Daemon
export { startDaemon, stopDaemon, getDaemonStatus } from "./daemon/index";
export type {
  DaemonInfo,
  DaemonConfig,
  DaemonStatus,
  DaemonStatusResult,
} from "./daemon/index";

// CLI
export { run as runCli } from "./cli/index";
