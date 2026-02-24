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
  MessageOrigin,
  MessageProvenance,
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
  ExecStreamResult,
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
  pauseGroup,
  resumeGroup,
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
  UpdateQueueCommandInput,
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
  pauseQueue,
  resumeQueue,
  updateQueueCommand,
  removeQueueCommand,
  moveQueueCommand,
  toggleQueueCommandMode,
  runQueue,
} from "./queue/index";

// Bookmark manager
export type {
  BookmarkType,
  Bookmark,
  BookmarkData,
  BookmarkConfig,
  CreateBookmarkInput,
  BookmarkFilter,
  SearchOptions,
  BookmarkSearchResult,
} from "./bookmark/index";

export {
  BOOKMARK_TYPES,
  isBookmarkType,
  validateCreateBookmarkInput,
  loadBookmarks,
  saveBookmarks,
  addBookmark,
  listBookmarks,
  getBookmark,
  deleteBookmark,
  searchBookmarks,
} from "./bookmark/index";

// Auth/token manager
export type {
  Permission,
  ApiTokenMetadata,
  CreateTokenInput,
  VerifyTokenResult,
} from "./auth/index";
export {
  PERMISSIONS,
  isPermission,
  normalizePermissions,
  hasPermission,
  loadTokenConfig,
  saveTokenConfig,
  createToken,
  listTokens,
  revokeToken,
  rotateToken,
  verifyToken,
  parsePermissionList,
} from "./auth/index";

// File changes
export type {
  FileOperation,
  ChangedFile,
  ChangedFilesSummary,
  FileHistory,
  FileHistoryEntry,
  IndexStats,
  GetFilesOptions,
  FindOptions,
} from "./file-changes/index";
export {
  extractChangedFiles,
  getChangedFiles,
  findSessionsByFile,
  rebuildFileIndex,
} from "./file-changes/index";

// Activity
export type { ActivityStatus, ActivityEntry } from "./activity/index";
export { deriveActivityEntry, getSessionActivity } from "./activity/index";

// Markdown
export type {
  ParsedMarkdownSection,
  ParsedMarkdown,
  MarkdownTask,
} from "./markdown/index";
export { parseMarkdown, extractMarkdownTasks } from "./markdown/index";

// SDK
export type {
  SdkEventType,
  SdkEventPayloadMap,
  SdkEventPayload,
  SdkEventHandler,
  SdkEventEmitter,
  ToolContext,
  ToolConfig,
  RegisteredTool,
  SessionRunnerOptions,
  SessionConfig,
  SessionResult,
} from "./sdk/index";
export {
  BasicSdkEventEmitter,
  tool,
  ToolRegistry,
  SessionRunner,
  RunningSession,
} from "./sdk/index";

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
