# Phase 3: SQLite SessionIndex, GroupManager, QueueManager Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-codex-session-management.md#4.3.2, #5.1, #4.6
**Created**: 2026-02-20
**Last Updated**: 2026-02-20

---

## Design Document Reference

**Source**: design-docs/specs/design-codex-session-management.md

### Summary
Implement the SQLite-backed session index for fast querying (reading Codex's own state DB), the GroupManager for multi-session orchestration, and the QueueManager for sequential prompt execution. Also extend the CLI with group/queue subcommands and session resume/fork.

### Scope
**Included**: SQLite session index, GroupManager, QueueManager, CLI group/queue/resume/fork commands
**Excluded**: Daemon server, app-server WebSocket integration, HTTP API

---

## Modules

### 1. SQLite Session Index

#### src/session/sqlite.ts
**Status**: NOT_STARTED

Read Codex's SQLite state DB (`~/.codex/state`) for fast session queries.

**Functions:**
- `openCodexDb(codexHome?: string): Database | null` - Open Codex's SQLite DB (returns null if missing)
- `listSessionsSqlite(db: Database, options?: SessionListOptions): SessionListResult` - Query sessions from DB with filtering/pagination/sorting via SQL
- `findSessionSqlite(db: Database, id: string): CodexSession | null` - Fast lookup by UUID primary key
- `findLatestSessionSqlite(db: Database, cwd?: string): CodexSession | null` - Most recent by `updated_at DESC`

**Key details:**
- Uses `bun:sqlite` (built-in, zero deps) for DB access
- Read-only access; never writes to Codex's DB
- Maps Codex's `threads` table schema to our `CodexSession` type:
  - `id` -> `id`
  - `rollout_path` -> `rolloutPath`
  - `created_at` -> `createdAt` (parse ISO timestamp)
  - `updated_at` -> `updatedAt`
  - `source` -> `source`
  - `model_provider` -> `modelProvider`
  - `cwd` -> `cwd`
  - `cli_version` -> `cliVersion`
  - `title` -> `title`
  - `first_user_message` -> `firstUserMessage`
  - `archived_at` -> `archivedAt`
  - `git_sha`, `git_branch`, `git_origin_url` -> `git`

#### src/session/index.ts (modify)
**Status**: NOT_STARTED

Upgrade existing session index to hybrid strategy:
- Try SQLite first (fast path)
- Fallback to filesystem scan if DB unavailable or query fails

**Changes:**
- `listSessions` tries `listSessionsSqlite` first, falls back to current filesystem scan
- `findSession` tries `findSessionSqlite` first, falls back to filename-based scan
- `findLatestSession` tries SQLite first

**Checklist:**
- [ ] `openCodexDb` DB opener
- [ ] `listSessionsSqlite` with SQL filtering
- [ ] `findSessionSqlite` by primary key
- [ ] `findLatestSessionSqlite`
- [ ] Hybrid wrapper in session/index.ts
- [ ] Unit tests (create temp SQLite DB with test data)

### 2. GroupManager

#### src/group/types.ts
**Status**: NOT_STARTED

**Types:**
- `SessionGroup`: `{ id, name, description?, sessionIds[], createdAt, updatedAt }`
- `GroupRunOptions`: `{ maxConcurrent?, model?, sandbox?, fullAuto? }`
- `GroupRunStatus`: `{ groupId, running[], completed[], failed[], pending[] }`

#### src/group/repository.ts
**Status**: NOT_STARTED

Persistent storage for group definitions. Uses a JSON file at `~/.config/codex-agent/groups.json`.

**Functions:**
- `loadGroups(configDir?: string): GroupConfig` - Load all groups
- `saveGroups(config: GroupConfig, configDir?: string): void` - Persist groups
- `addGroup(name: string, description?: string): SessionGroup` - Create group
- `removeGroup(id: string): boolean` - Delete group
- `addSessionToGroup(groupId: string, sessionId: string): void`
- `removeSessionFromGroup(groupId: string, sessionId: string): void`

#### src/group/manager.ts
**Status**: NOT_STARTED

Orchestrates running prompts across multiple sessions in a group.

**Functions:**
- `runGroup(group: SessionGroup, prompt: string, options?: GroupRunOptions): AsyncGenerator<GroupEvent>`
- Spawns Codex processes for each session (up to `maxConcurrent`)
- Tracks completion, emits events for progress monitoring
- Uses ProcessManager from Phase 2

**Checklist:**
- [ ] Group types
- [ ] GroupRepository (JSON file storage)
- [ ] GroupManager with concurrency control
- [ ] Unit tests

### 3. QueueManager

#### src/queue/types.ts
**Status**: NOT_STARTED

**Types:**
- `PromptQueue`: `{ id, name, projectPath, prompts[], createdAt }`
- `QueuePrompt`: `{ id, prompt, status, result?, addedAt, startedAt?, completedAt? }`
- `QueueRunStatus`: `{ queueId, current?, completed[], pending[], failed[] }`

#### src/queue/repository.ts
**Status**: NOT_STARTED

Persistent storage for queue definitions at `~/.config/codex-agent/queues.json`.

**Functions:**
- `loadQueues(configDir?: string): QueueConfig`
- `saveQueues(config: QueueConfig, configDir?: string): void`
- `createQueue(name: string, projectPath: string): PromptQueue`
- `addPrompt(queueId: string, prompt: string): QueuePrompt`
- `removeQueue(id: string): boolean`

#### src/queue/runner.ts
**Status**: NOT_STARTED

Sequentially executes prompts from a queue.

**Functions:**
- `runQueue(queue: PromptQueue, options?: CodexProcessOptions): AsyncGenerator<QueueEvent>`
- Executes prompts one at a time via `ProcessManager.spawnExec`
- Updates prompt status as each completes/fails
- Supports stop/pause signaling

**Checklist:**
- [ ] Queue types
- [ ] QueueRepository (JSON file storage)
- [ ] QueueRunner with sequential execution
- [ ] Unit tests

### 4. CLI Extensions

#### src/cli/index.ts (modify)
**Status**: NOT_STARTED

Add new subcommands:

```
session resume <id>          # Delegate to ProcessManager.spawnResume
session fork <id> [--nth-message N]  # Delegate to ProcessManager.spawnFork

group create <name>          # Create a new group
group list                   # List all groups
group add <group> <session>  # Add session to group
group run <name> [--prompt P] [--max-concurrent N]  # Run prompt across group
group watch <name>           # Watch group activity

queue create <name> --project <path>  # Create a queue
queue add <name> --prompt <prompt>    # Add prompt to queue
queue list                            # List queues
queue run <name>                      # Run queue sequentially
```

**Checklist:**
- [ ] session resume command
- [ ] session fork command
- [ ] group CRUD commands
- [ ] group run/watch commands
- [ ] queue CRUD commands
- [ ] queue run command
- [ ] Unit tests for new commands

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| SQLite session index | `src/session/sqlite.ts` | DONE | sqlite.test.ts (17) |
| Session index hybrid | `src/session/index.ts` | DONE | index.test.ts (13) |
| Group types | `src/group/types.ts` | DONE | - |
| Group repository | `src/group/repository.ts` | DONE | repository.test.ts (14) |
| Group manager | `src/group/manager.ts` | DONE | - |
| Queue types | `src/queue/types.ts` | DONE | - |
| Queue repository | `src/queue/repository.ts` | DONE | repository.test.ts (13) |
| Queue runner | `src/queue/runner.ts` | DONE | - |
| CLI extensions | `src/cli/index.ts` | DONE | - |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| SQLite index | Phase 1 types, bun:sqlite | Available |
| Hybrid session index | SQLite index + existing filesystem index | SQLite first |
| GroupManager | ProcessManager (Phase 2), GroupRepository | Available |
| QueueManager | ProcessManager (Phase 2), QueueRepository | Available |
| CLI extensions | All above | Last |

## Subtask Order

1. **TASK-001**: SQLite Session Index (parallelizable: yes, deps: Phase 1)
2. **TASK-002**: GroupManager + Repository (parallelizable: yes, deps: Phase 2)
3. **TASK-003**: QueueManager + Repository (parallelizable: yes, deps: Phase 2)
4. **TASK-004**: CLI Extensions (parallelizable: no, deps: TASK-001, TASK-002, TASK-003)

**Note**: TASK-001, TASK-002, TASK-003 are all parallelizable since they have no mutual dependencies. TASK-004 integrates everything into the CLI.

## Completion Criteria

- [x] SQLite index reads Codex's state DB correctly
- [x] Hybrid index transparently falls back to filesystem
- [x] Groups can be created, modified, and run with concurrency control
- [x] Queues execute prompts sequentially with status tracking
- [x] CLI commands work end-to-end
- [x] All tests passing (99 total)
- [x] Type checking passes

## Key Design Decisions

### SQLite Access
- Read-only; we never mutate Codex's state DB
- Use `bun:sqlite` (zero external deps, built into Bun runtime)
- Graceful degradation: if DB is locked or missing, silently fall back to filesystem scan
- Column mapping validated at startup; if schema changes, fall back

### Group/Queue Persistence
- JSON files at `~/.config/codex-agent/` (XDG-compliant)
- Simple file-based storage (no DB needed for config data)
- Atomic writes via write-to-temp + rename pattern

### Concurrency Model (GroupManager)
- `maxConcurrent` controls how many Codex processes run simultaneously
- Implemented via a simple semaphore/counter pattern
- Each process monitored via RolloutWatcher for real-time status
- Events emitted as AsyncGenerator yields for streaming consumption

### Sequential Execution (QueueManager)
- Prompts execute strictly one at a time
- Each prompt creates a fresh `codex exec` session
- Status persisted after each prompt completes (crash recovery)
- Supports `stop()` signal to halt after current prompt finishes

## Progress Log

### Session: 2026-02-20 (Implementation)
**Tasks Completed**: TASK-001, TASK-002, TASK-003, TASK-004
**Summary**:
- TASK-001: Created `src/session/sqlite.ts` with `openCodexDb`, `listSessionsSqlite`, `findSessionSqlite`, `findLatestSessionSqlite`. Updated `src/session/index.ts` with hybrid SQLite-first fallback. 17 tests.
- TASK-002: Created `src/group/types.ts`, `src/group/repository.ts`, `src/group/manager.ts`, `src/group/index.ts`. JSON persistence with atomic writes. Concurrency-controlled group runner via AsyncGenerator. 14 tests.
- TASK-003: Created `src/queue/types.ts`, `src/queue/repository.ts`, `src/queue/runner.ts`, `src/queue/index.ts`. Sequential prompt execution with stop signal and crash recovery. 13 tests.
- TASK-004: Extended `src/cli/index.ts` with session resume/fork, group create/list/add/remove/run, queue create/add/list/run commands. Updated `src/main.ts` with all new exports.
**Blockers**: None
