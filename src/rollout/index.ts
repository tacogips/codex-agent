export {
  parseRolloutLine,
  readRollout,
  parseSessionMeta,
  streamEvents,
  extractFirstUserMessage,
} from "./reader";

export { RolloutWatcher, sessionsWatchDir } from "./watcher";
export type { RolloutWatcherEvents } from "./watcher";
