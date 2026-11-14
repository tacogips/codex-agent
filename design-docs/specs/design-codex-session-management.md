# Codex Session Management - Research and Design

Research findings on OpenAI Codex CLI session log management and design for a Codex-compatible process manager (the counterpart of `claude-code-agent`).

## 1. Codex CLI Architecture Overview

OpenAI Codex CLI is a Rust-based coding agent (`codex-rs/`) with a TypeScript wrapper (`codex-cli/`). Its architecture is modular with clear separation between core logic, state management, CLI/TUI, and the exec (non-interactive) mode.

### Key Crates

| Crate | Purpose |
|-------|---------|
| `codex-rs/core` | Core logic: sessions, rollouts, tools, sandboxing, config |
| `codex-rs/state` | SQLite-backed metadata DB for rollouts |
| `codex-rs/cli` | CLI entry point with clap-based subcommands |
| `codex-rs/tui` | Terminal UI (ratatui-based) |
| `codex-rs/exec` | Non-interactive execution mode |
| `codex-rs/protocol` | Shared protocol types (ThreadId, events, models) |
| `codex-rs/config` | Configuration requirements and layered loading |
| `codex-rs/app-server` | WebSocket/stdio server for IDE integration |

## 2. Session Log Management in Codex

### 2.1 Rollout Files (JSONL)

Codex persists every session as a **JSONL rollout file**. Each line is a timestamped event.

**File Location:**
```
~/.codex/sessions/YYYY/MM/DD/rollout-{timestamp}-{uuid}.jsonl
```

Example:
```
~/.codex/sessions/2025/05/07/rollout-2025-05-07T17-24-21-5973b6c0-94b8-487b-a530-2aeb6098ae0e.jsonl
```

**Archived sessions** are stored separately (flat layout):
```
~/.codex/archived_sessions/rollout-*.jsonl
```

**Session name index** (append-only, maps thread IDs to human-readable names):
```
~/.codex/session_index.jsonl
```

Each entry in the index:
```json
{"id":"uuid","thread_name":"fix auth bug","updated_at":"2025-05-07T17:24:21Z"}
```

This index is scanned from the end (newest-first) for lookups by both ID and name.

### 2.2 Persistence Modes

Codex supports two event persistence modes:

| Mode | Description |
|------|-------------|
| `Limited` (default) | Core conversational events: user/agent messages, reasoning, token counts, context compaction, turn lifecycle |
| `Extended` | Everything in Limited + tool execution results (shell output, web search, patches, MCP calls). Command output truncated to 10KB |

Events **never** persisted: streaming deltas, warnings, model reroutes, session config events, approval requests, UI events.

### 2.3 JSONL Line Format

Each line follows the `RolloutLine` structure:

```json
{
  "timestamp": "2025-05-07T17:24:21.123Z",
  "type": "<item_type>",
  "payload": { ... }
}
```

**RolloutItem Types:**

| Type | Description |
|------|-------------|
| `session_meta` | Session metadata (id, cwd, source, cli_version, git info) |
| `response_item` | Model response items (messages, function calls, reasoning) |
| `event_msg` | Events (user_message, agent_message, exec_command_start/end, session_configured) |
| `compacted` | Compacted history (for context window management) |
| `turn_context` | Turn-level context data |

### 2.3 Session Metadata Line

The first line of every rollout is `SessionMeta`:

```json
{
  "timestamp": "...",
  "type": "session_meta",
  "payload": {
    "id": "uuid",
    "forked_from_id": null,
    "timestamp": "...",
    "cwd": "/path/to/project",
    "originator": "codex-cli",
    "cli_version": "0.1.0",
    "source": "cli",
    "model_provider": "openai",
    "base_instructions": { ... },
    "dynamic_tools": [ ... ],
    "git": {
      "sha": "abc123",
      "branch": "main",
      "origin_url": "https://github.com/..."
    }
  }
}
```

**SessionSource** values: `cli`, `vscode`, `exec`, `unknown`

### 2.4 SQLite State Database

Codex maintains a SQLite database alongside JSONL files for fast querying.

**Location:** `~/.codex/state` (SQLite file, version 5)

**Thread Metadata stored in DB:**

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Thread identifier |
| `rollout_path` | PathBuf | Absolute path to JSONL file |
| `created_at` | DateTime | Creation timestamp |
| `updated_at` | DateTime | Last update timestamp |
| `source` | String | Session source (cli, vscode, exec) |
| `model_provider` | String | Model provider identifier |
| `cwd` | PathBuf | Working directory |
| `cli_version` | String | CLI version |
| `title` | String | Best-effort thread title |
| `sandbox_policy` | String | Sandbox mode |
| `approval_mode` | String | Approval policy |
| `tokens_used` | i64 | Token usage |
| `first_user_message` | String? | First user message (for display) |
| `archived_at` | DateTime? | Archive timestamp |
| `git_sha` | String? | Git commit SHA |
| `git_branch` | String? | Git branch |
| `git_origin_url` | String? | Git origin URL |

**Key DB operations:**
- `upsert_thread` - Insert or update thread metadata
- `find_rollout_path_by_id` - Find rollout file by thread ID
- `list_threads_db` - Paginated thread listing with filtering
- `mark_backfill_complete` - Signal that filesystem scan is done
- `read_repair_rollout_path` - Fix stale paths in DB

### 2.5 RolloutRecorder

The `RolloutRecorder` is the core persistence component:

- **Async writer**: Uses a Tokio task with bounded mpsc channel (256 buffer)
- **Deferred materialization**: File is NOT created until explicit `persist()` call
- **Commands**: `AddItems`, `Persist`, `Flush`, `Shutdown`
- **Dual storage**: Writes to JSONL file AND reconciles with SQLite DB
- **Truncation**: Command output is truncated to 10,000 bytes in extended mode
- **Thread-safe**: Cloneable handle (sender side of channel)

### 2.6 ThreadManager

Manages session lifecycle (creating, resuming, forking):

- **In-memory thread map**: `HashMap<ThreadId, Arc<CodexThread>>`
- **Thread creation**: Spawns `Codex` instance with config + initial history
- **Resume**: Loads rollout history from JSONL, creates new thread with resumed state
- **Fork**: Loads rollout up to Nth user message, starts fresh thread
- **Broadcast**: Notifies subscribers when threads are created
- **Cleanup**: Can shutdown and remove all threads

### 2.7 Multi-Agent Collaboration

Codex has built-in support for hierarchical multi-agent workflows:
- `CollaborationModeMask` controls which collaboration modes are available
- Events: `CollabAgentSpawn`, `CollabAgentInteraction`, `CollabWaiting`, `CollabClose`, `CollabResume`
- `SubAgentSource` identifies spawned child agents
- `MAX_THREAD_SPAWN_DEPTH` limits recursive agent spawning depth
- `AgentControl` and `AgentStatus` manage agent lifecycle within threads

### 2.8 Log Retention

The SQLite `logs` table has:
- **90-day retention** with automatic cleanup
- **Batch insertion**: 64 entries per batch, flushed every 250ms
- A `tracing_subscriber::Layer` (`LogDbLayer`) captures tracing events into the DB

## 3. Comparison: Claude Code vs Codex Session Format

| Aspect | Claude Code | Codex |
|--------|-------------|-------|
| **Format** | JSONL | JSONL |
| **Location** | `~/.claude/projects/{projId}/{sessionId}.jsonl` | `~/.codex/sessions/YYYY/MM/DD/rollout-{ts}-{uuid}.jsonl` |
| **Index** | Filesystem scan | SQLite DB + filesystem fallback |
| **Session ID** | UUID (filename) | UUID (embedded in filename + metadata) |
| **Metadata** | Inline in JSONL | First JSONL line (`session_meta`) + SQLite |
| **Message format** | `{type, uuid, sessionId, timestamp, message}` | `{timestamp, type, payload}` with `RolloutItem` variants |
| **Resume** | Session file path lookup | `codex resume [session_id\|--last]` with thread name support |
| **Fork** | Not supported | `codex fork [session_id\|--last]` with nth-message truncation |
| **Archive** | Not supported | `archived_sessions/` directory |
| **Git context** | Not embedded | Embedded in session_meta (sha, branch, origin) |
| **Persistence** | Immediate write | Deferred until first user interaction |

## 4. Design: codex-agent Process Manager

### 4.1 Goals

Build a TypeScript/Bun process manager for Codex sessions analogous to `claude-code-agent`, providing:

1. **Session monitoring** - Read and parse Codex rollout files
2. **Session listing/search** - Query sessions with filtering and pagination
3. **Session grouping** - Organize related sessions across projects
4. **Command queue** - Sequential prompt execution
5. **Real-time monitoring** - File watching for live session updates
6. **Process orchestration** - Spawn and manage Codex processes

### 4.2 Architecture

```
External Applications
        |
   CLI Interface (commander)
        |
  SDK Layer (Core Logic)
   |- RolloutReader         # Parse Codex JSONL rollout files
   |- SessionIndex          # SQLite-backed session index (read Codex's DB or build own)
   |- GroupManager/Runner   # Multi-session orchestration
   |- QueueManager/Runner   # Sequential prompt execution
   |- ActivityManager       # Real-time activity tracking
   +- ProcessManager        # Codex process spawning
        |
  Repository Layer (Data Access)
   |- SessionRepository     # Read-only access to Codex sessions
   |- GroupRepository       # Group configuration storage
   +- QueueRepository       # Queue configuration storage
        |
  System Interfaces
   |- FileSystem            # Filesystem abstraction
   |- ProcessSpawner        # Codex CLI subprocess management
   +- Clock                 # Time abstraction
        |
  Polling/Monitoring Layer
   |- RolloutWatcher        # fs.watch on rollout directories
   |- JsonlStreamParser     # Streaming JSONL parser
   +- StateTracker          # Session state machine
```

### 4.3 Key Modules

#### 4.3.1 RolloutReader

Parses Codex rollout JSONL files.

```
RolloutReader
  .readRollout(path) -> Rollout
  .parseSessionMeta(path) -> SessionMeta
  .streamEvents(path) -> AsyncIterator<RolloutItem>
  .loadHistory(path) -> RolloutItem[]
```

**Key differences from claude-code-agent's SessionReader:**
- Parse `RolloutLine` format (`{timestamp, type, payload}`) instead of Claude's `{type, uuid, sessionId, message}`
- Handle `RolloutItem` variants: `session_meta`, `response_item`, `event_msg`, `compacted`, `turn_context`
- Extract git context from session metadata
- Support both active and archived sessions

#### 4.3.2 SessionIndex

Session discovery and querying, leveraging Codex's hierarchical date directory structure.

```
SessionIndex
  .listSessions(options) -> SessionListResult
  .findSession(id) -> Session | null
  .findByName(name) -> Session | null
  .findLatest(cwd?) -> Session | null
  .searchSessions(query) -> Session[]
```

**Strategy:**
- **Primary**: Read Codex's SQLite state DB directly (if available)
- **Fallback**: Filesystem scan of `~/.codex/sessions/YYYY/MM/DD/` hierarchy
- Support filtering by: source, model_provider, cwd, date range, git branch
- Support sorting by: created_at, updated_at

#### 4.3.3 ProcessManager (Codex-specific)

Spawn and manage Codex CLI processes.

```
ProcessManager
  .spawn(options) -> CodexProcess
  .spawnExec(prompt, options) -> CodexExecProcess
  .resume(sessionId) -> CodexProcess
  .fork(sessionId, nthMessage?) -> CodexProcess
  .list() -> RunningProcess[]
  .kill(processId) -> void
```

**Codex CLI invocation modes:**
- Interactive: `codex [prompt]`
- Non-interactive: `codex exec [prompt]`
- Resume: `codex resume [session_id|--last]`
- Fork: `codex fork [session_id|--last]`

**Key flags:**
- `--model <model>` - Model selection
- `--full-auto` - Auto-approve all operations
- `--sandbox <mode>` - Sandbox policy
- `--ask-for-approval <mode>` - Approval policy
- `-c key=value` - Config overrides
- `--json` - JSON output (exec mode)

#### 4.3.4 RolloutWatcher

Monitor rollout files for real-time updates.

```
RolloutWatcher
  .watch(sessionPath) -> EventEmitter
  .watchDirectory(dir) -> EventEmitter  # Watch for new sessions
  .stop() -> void
```

**Implementation notes:**
- Watch `~/.codex/sessions/` for new date directories
- Watch individual rollout files for appended lines
- Debounce filesystem events
- Parse incremental JSONL appends

### 4.4 Data Types

#### Session (derived from rollout)

```typescript
interface CodexSession {
  id: string;                    // ThreadId (UUID)
  rolloutPath: string;           // Absolute path to JSONL
  createdAt: Date;
  updatedAt: Date;
  source: SessionSource;         // 'cli' | 'vscode' | 'exec' | 'unknown'
  modelProvider: string;
  cwd: string;
  cliVersion: string;
  title: string;
  sandboxPolicy: string;
  approvalMode: string;
  tokensUsed: number;
  firstUserMessage?: string;
  archivedAt?: Date;
  git?: {
    sha?: string;
    branch?: string;
    originUrl?: string;
  };
  forkedFromId?: string;
}
```

#### RolloutItem (parsed from JSONL)

```typescript
type RolloutItem =
  | { type: 'session_meta'; payload: SessionMetaLine }
  | { type: 'response_item'; payload: ResponseItem }
  | { type: 'event_msg'; payload: EventMsg }
  | { type: 'compacted'; payload: CompactedItem }
  | { type: 'turn_context'; payload: TurnContextItem };

type EventMsg =
  | { type: 'user_message'; message: string }
  | { type: 'agent_message'; message: string }
  | { type: 'exec_command_start'; command: string; ... }
  | { type: 'exec_command_end'; exitCode: number; ... }
  | { type: 'session_configured'; ... };
```

### 4.5 Configuration

**Codex Home:** `~/.codex/` (environment variable: `CODEX_HOME`)

**Agent config location:** `~/.config/codex-agent/` (XDG-compliant)

**Config file:** `config.toml`

```toml
[codex]
home = "~/.codex"                # Codex home directory
binary = "codex"                 # Codex CLI binary path

[sessions]
watch_interval_ms = 1000         # Polling interval for session changes
max_concurrent = 5               # Max concurrent monitored sessions

[server]
port = 3100                      # HTTP daemon port
auth_enabled = true              # Token authentication
```

### 4.6 CLI Commands

```
codex-agent session list [--source <source>] [--cwd <path>] [--format json|table]
codex-agent session show <id>
codex-agent session watch <id>
codex-agent session resume <id>
codex-agent session fork <id> [--nth-message <n>]

codex-agent group create <name>
codex-agent group list
codex-agent group run <name> [--max-concurrent <n>]
codex-agent group watch <name>

codex-agent queue create <name> --project <path>
codex-agent queue add <name> --prompt <prompt>
codex-agent queue run <name>

codex-agent server start [--port <port>]
codex-agent daemon start|stop|status
```

## 5. Key Design Decisions

### 5.1 SQLite Access Strategy

**Options:**
1. **Read Codex's SQLite DB directly** - Fast but couples to internal schema
2. **Build own index** by scanning rollout files - Independent but slower
3. **Hybrid** - Read Codex's DB when available, fallback to filesystem scan

**Decision: Option 3 (Hybrid)** - Mirrors Codex's own fallback strategy. Use `better-sqlite3` or `bun:sqlite` for DB access.

### 5.2 Process Spawning

Codex provides two integration points:
1. **CLI subprocess** (`codex exec --json`) - Simple, JSONL output on stdout
2. **App Server** (`codex app-server --listen ws://...`) - WebSocket protocol, full control

**Decision: Start with CLI subprocess**, upgrade to app-server protocol later. The exec mode with `--json` provides structured JSONL output suitable for programmatic consumption.

### 5.3 Rollout Format Parsing

Unlike Claude Code's simpler message format, Codex rollouts contain multiple item types with nested structures. The parser must:
- Handle forward-compatible unknown types gracefully
- Parse incrementally for streaming
- Support both active and archived session directories
- Handle parse errors in individual lines without failing the whole file

### 5.4 Session Lifecycle Mapping

```
Codex Thread States     codex-agent Session States
-------------------     --------------------------
New                  -> pending
Active (receiving)   -> active
Paused               -> paused
Completed            -> completed
Failed               -> failed
Archived             -> archived
```

## 6. Implementation Priority

| Priority | Feature | Rationale |
|----------|---------|-----------|
| P0 | RolloutReader | Foundation for all other features |
| P0 | SessionIndex (filesystem) | Session discovery |
| P1 | RolloutWatcher | Real-time monitoring |
| P1 | ProcessManager (exec mode) | Process spawning |
| P1 | CLI: session list/show/watch | Basic CLI interface |
| P2 | SessionIndex (SQLite) | Fast querying |
| P2 | GroupManager | Multi-session orchestration |
| P2 | QueueManager | Sequential execution |
| P3 | Daemon server | HTTP API |
| P3 | App-server integration | WebSocket protocol |

## References

- Codex CLI source: `github:openai/codex` (`codex-rs/`)
- claude-code-agent source: `/g/gits/tacogips/claude-code-agent`
- See `design-docs/references/README.md` for external references
