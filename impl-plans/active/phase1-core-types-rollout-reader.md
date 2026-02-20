# Phase 1: Core Types & RolloutReader Implementation Plan

**Status**: In Progress
**Design Reference**: design-docs/specs/design-codex-session-management.md#2
**Created**: 2026-02-19
**Last Updated**: 2026-02-19

---

## Design Document Reference

**Source**: design-docs/specs/design-codex-session-management.md

### Summary
Implement the core type definitions and RolloutReader for parsing Codex JSONL rollout files. This is the P0 foundation for all other features.

### Scope
**Included**: Core types, JSONL line parser, rollout file reader, session metadata extraction
**Excluded**: SQLite index, process manager, CLI commands, watcher

---

## Modules

### 1. Core Types

#### src/types/rollout.ts
**Status**: NOT_STARTED

- `RolloutLine`: `{ timestamp: string } & RolloutItem`
- `RolloutItem`: discriminated union with `type` field (`session_meta`, `response_item`, `event_msg`, `compacted`, `turn_context`)
- `SessionMetaLine`: session metadata with git info
- `SessionMeta`: core session metadata fields
- `GitInfo`: `{ sha?: string; branch?: string; originUrl?: string }`
- `SessionSource`: `'cli' | 'vscode' | 'exec' | 'unknown'`
- `ResponseItem`: discriminated union (message, reasoning, local_shell_call, function_call, function_call_output, etc.)
- `EventMsg`: discriminated union of event types (user_message, agent_message, turn_started, turn_complete, exec_command_begin, exec_command_end, etc.)
- `CompactedItem`: compacted history marker
- `TurnContextItem`: per-turn context data

**Checklist**:
- [ ] RolloutLine type
- [ ] RolloutItem discriminated union
- [ ] SessionMetaLine and SessionMeta
- [ ] ResponseItem types (simplified)
- [ ] EventMsg types (core subset)
- [ ] Unit tests for type guards

#### src/types/session.ts
**Status**: NOT_STARTED

- `CodexSession`: derived session info from rollout metadata
- `SessionListOptions`: filtering/pagination options
- `SessionListResult`: paginated result type

**Checklist**:
- [ ] CodexSession interface
- [ ] SessionListOptions interface
- [ ] SessionListResult interface

### 2. RolloutReader

#### src/rollout/reader.ts
**Status**: NOT_STARTED

- `parseRolloutLine(line: string): RolloutLine | null` - parse single JSONL line
- `readRollout(path: string): Promise<RolloutLine[]>` - read entire file
- `parseSessionMeta(path: string): Promise<SessionMetaLine | null>` - read first line only
- `streamEvents(path: string): AsyncGenerator<RolloutLine>` - streaming line-by-line

**Checklist**:
- [ ] parseRolloutLine with error handling
- [ ] readRollout bulk reader
- [ ] parseSessionMeta fast metadata reader
- [ ] streamEvents async generator
- [ ] Unit tests with fixture data

### 3. SessionIndex (Filesystem)

#### src/session/index.ts
**Status**: NOT_STARTED

- `discoverSessions(codexHome: string): AsyncGenerator<CodexSession>` - scan date directories
- `listSessions(codexHome: string, options?: SessionListOptions): Promise<SessionListResult>` - filtered listing
- `findSession(codexHome: string, id: string): Promise<CodexSession | null>` - find by ID
- `findLatestSession(codexHome: string, cwd?: string): Promise<CodexSession | null>` - most recent

**Checklist**:
- [ ] discoverSessions directory scanner
- [ ] listSessions with filtering
- [ ] findSession by ID
- [ ] findLatestSession
- [ ] Unit tests with temp directories

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Core rollout types | `src/types/rollout.ts` | NOT_STARTED | - |
| Session types | `src/types/session.ts` | NOT_STARTED | - |
| RolloutReader | `src/rollout/reader.ts` | NOT_STARTED | - |
| SessionIndex | `src/session/index.ts` | NOT_STARTED | - |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| RolloutReader | Core Types | Must implement first |
| SessionIndex | RolloutReader + Core Types | Must implement after |

## Subtask Order

1. **TASK-001**: Core Types (parallelizable: yes, deps: none)
2. **TASK-002**: RolloutReader (parallelizable: no, deps: TASK-001)
3. **TASK-003**: SessionIndex filesystem (parallelizable: no, deps: TASK-001, TASK-002)

## Completion Criteria

- [ ] All modules implemented
- [ ] All tests passing
- [ ] Type checking passes (`tsc --noEmit`)
- [ ] Can parse a real Codex rollout file

## Progress Log

### Session: 2026-02-19
**Tasks Completed**: Plan created
**Tasks In Progress**: Starting TASK-001 (Core Types)
**Blockers**: None
**Notes**: Initial session, researched Codex source for exact type definitions
