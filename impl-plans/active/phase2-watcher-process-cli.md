# Phase 2: RolloutWatcher, ProcessManager, CLI Implementation Plan

**Status**: In Progress
**Design Reference**: design-docs/specs/design-codex-session-management.md#4.3.3, #4.3.4, #4.6
**Created**: 2026-02-19
**Last Updated**: 2026-02-19

---

## Design Document Reference

**Source**: design-docs/specs/design-codex-session-management.md

### Summary
Implement real-time rollout monitoring (RolloutWatcher), Codex CLI subprocess management (ProcessManager), and CLI commands for session list/show/watch.

### Scope
**Included**: RolloutWatcher, ProcessManager (exec mode), CLI session subcommands
**Excluded**: SQLite index, GroupManager, QueueManager, daemon server, app-server

---

## Modules

### 1. RolloutWatcher

#### src/rollout/watcher.ts
**Status**: NOT_STARTED

- `RolloutWatcher` class using `fs.watch` for file monitoring
- `watchFile(path)`: watch a single rollout file for appended lines
- `watchDirectory(dir)`: watch sessions dir for new rollout files
- `stop()`: cleanup all watchers
- Event emitter pattern: `on('line', cb)`, `on('newSession', cb)`, `on('error', cb)`
- Debounce fs events, track file offset for incremental reads

**Checklist**:
- [ ] RolloutWatcher class with EventEmitter
- [ ] watchFile with incremental JSONL reading
- [ ] watchDirectory for new session detection
- [ ] Debounce and cleanup logic
- [ ] Unit tests

### 2. ProcessManager

#### src/process/manager.ts
**Status**: NOT_STARTED

- `CodexProcessOptions`: spawn config (model, sandbox, approval, cwd, config overrides)
- `CodexProcess`: running process handle (pid, stdin, stdout stream, kill)
- `spawnExec(prompt, options)`: spawn `codex exec --json` subprocess
- `resume(sessionId)`: spawn `codex resume <id>`
- `fork(sessionId, nth?)`: spawn `codex fork <id>`
- `list()`: list running processes
- `kill(id)`: kill a process

**Checklist**:
- [ ] CodexProcessOptions and CodexProcess types
- [ ] spawnExec with JSONL stdout parsing
- [ ] resume and fork commands
- [ ] Process tracking (list/kill)
- [ ] Unit tests (mock spawn)

### 3. CLI Entry Point

#### src/cli/index.ts
**Status**: NOT_STARTED

- CLI framework using commander.js or manual arg parsing
- `session list` command with filters (--source, --cwd, --branch, --format)
- `session show <id>` command showing session details + events
- `session watch <id>` command using RolloutWatcher for live output

**Checklist**:
- [ ] CLI argument parsing
- [ ] session list command
- [ ] session show command
- [ ] session watch command
- [ ] Integration with main.ts as bin entry

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| RolloutWatcher | `src/rollout/watcher.ts` | NOT_STARTED | - |
| ProcessManager types | `src/process/types.ts` | NOT_STARTED | - |
| ProcessManager | `src/process/manager.ts` | NOT_STARTED | - |
| CLI entry | `src/cli/index.ts` | NOT_STARTED | - |

## Subtask Order

1. **TASK-001**: RolloutWatcher (parallelizable: yes, deps: Phase 1)
2. **TASK-002**: ProcessManager (parallelizable: yes, deps: Phase 1)
3. **TASK-003**: CLI entry point (parallelizable: no, deps: TASK-001, TASK-002)

## Completion Criteria

- [ ] All modules implemented
- [ ] All tests passing
- [ ] Type checking passes
- [ ] CLI commands work end-to-end

## Progress Log

### Session: 2026-02-19
**Tasks Completed**: Plan created
**Tasks In Progress**: Starting TASK-001, TASK-002 in parallel
**Blockers**: None
