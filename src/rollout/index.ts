export {
  parseRolloutLine,
  readRollout,
  parseSessionMeta,
  streamEvents,
  extractFirstUserMessage,
  getSessionMessages,
} from "./reader";
export type {
  SessionMessageCategory,
  SessionMessage,
  GetSessionMessagesOptions,
} from "./reader";

export { RolloutWatcher, sessionsWatchDir } from "./watcher";
export type { RolloutWatcherEvents } from "./watcher";
