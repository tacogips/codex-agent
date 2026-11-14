# Phase 5: Claude-Code-Agent Parity Features Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-claude-parity-gap.md
**Created**: 2026-02-20
**Last Updated**: 2026-02-20

---

## Design Document Reference

**Source**: `design-docs/specs/design-claude-parity-gap.md`

### Summary
Implement missing high-value parity features identified against `claude-code-agent`: bookmarks, token/permission management, file-change indexing, activity tracking, markdown parsing, and expanded queue/group controls.

### Scope
**Included**: New modules, persistence, CLI/server integration, SDK exports, and tests for parity gaps  
**Excluded**: UI/dashboard work, full schema migration from external tools

---

## Modules

### 1. Bookmark Subsystem

#### `src/bookmark/types.ts`
**Status**: COMPLETED

```typescript
export type BookmarkType = "session" | "message" | "range";

export interface Bookmark {
  readonly id: string;
  readonly type: BookmarkType;
  readonly sessionId: string;
  readonly messageId?: string | undefined;
  readonly fromMessageId?: string | undefined;
  readonly toMessageId?: string | undefined;
  readonly name: string;
  readonly description?: string | undefined;
  readonly tags: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
```

#### `src/bookmark/repository.ts`, `src/bookmark/manager.ts`, `src/bookmark/index.ts`
**Status**: COMPLETED

```typescript
export declare function addBookmark(input: CreateBookmarkInput, configDir?: string): Promise<Bookmark>;
export declare function listBookmarks(filter?: BookmarkFilter, configDir?: string): Promise<readonly Bookmark[]>;
export declare function getBookmark(id: string, configDir?: string): Promise<Bookmark | null>;
export declare function deleteBookmark(id: string, configDir?: string): Promise<boolean>;
export declare function searchBookmarks(query: string, options?: SearchOptions, configDir?: string): Promise<readonly BookmarkSearchResult[]>;
```

**Checklist**:
- [x] Bookmark types and validators
- [x] JSON persistence (`~/.config/codex-agent/bookmarks.json`)
- [x] CRUD + search manager
- [x] Unit tests

### 2. Token and Permission Management

#### `src/auth/types.ts`, `src/auth/token-manager.ts`, `src/auth/index.ts`
**Status**: COMPLETED

```typescript
export type Permission =
  | "session:create"
  | "session:read"
  | "session:cancel"
  | "group:*"
  | "queue:*"
  | "bookmark:*";

export interface ApiTokenMetadata {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly Permission[];
  readonly createdAt: string;
  readonly expiresAt?: string | undefined;
  readonly revokedAt?: string | undefined;
}

export declare function createToken(input: CreateTokenInput, configDir?: string): Promise<string>;
export declare function listTokens(configDir?: string): Promise<readonly ApiTokenMetadata[]>;
export declare function revokeToken(id: string, configDir?: string): Promise<boolean>;
export declare function rotateToken(id: string, configDir?: string): Promise<string>;
```

**Checklist**:
- [x] Permission type model and parser
- [x] Hashed token storage + metadata store
- [x] CLI lifecycle commands (`token create/list/revoke/rotate`)
- [x] Server auth integration with permission checks
- [x] Unit and integration tests

### 3. File-Change Indexing

#### `src/file-changes/types.ts`, `src/file-changes/extractor.ts`, `src/file-changes/service.ts`, `src/file-changes/index.ts`
**Status**: COMPLETED

```typescript
export type FileOperation = "created" | "modified" | "deleted";

export interface ChangedFile {
  readonly path: string;
  readonly operation: FileOperation;
  readonly changeCount: number;
  readonly lastModified: string;
}

export declare function getChangedFiles(sessionId: string, options?: GetFilesOptions): Promise<ChangedFilesSummary>;
export declare function findSessionsByFile(path: string, options?: FindOptions): Promise<FileHistory>;
export declare function rebuildFileIndex(configDir?: string): Promise<IndexStats>;
```

**Checklist**:
- [x] Rollout-driven file change extraction
- [x] Index manager and rebuild flow
- [x] CLI commands for files list/find/index stats
- [x] HTTP API endpoints for file queries
- [x] Tests with fixture rollouts

### 4. Activity and Markdown Parsing

#### `src/activity/types.ts`, `src/activity/manager.ts`, `src/markdown/parser.ts`, `src/markdown/types.ts`
**Status**: COMPLETED

```typescript
export type ActivityStatus = "idle" | "running" | "waiting_approval" | "failed";

export interface ActivityEntry {
  readonly sessionId: string;
  readonly status: ActivityStatus;
  readonly updatedAt: string;
}

export interface ParsedMarkdown {
  readonly sections: readonly {
    readonly heading: string;
    readonly content: string;
  }[];
}

export declare function parseMarkdown(content: string): ParsedMarkdown;
export declare function getSessionActivity(sessionId: string): Promise<ActivityEntry | null>;
```

**Checklist**:
- [x] Activity status derivation from rollout events
- [x] Markdown parser utility
- [x] Session detail integration options (`--tasks` / parse views)
- [x] Tests for parser and activity transitions

### 5. Queue and Group Control Surface Expansion

#### `src/cli/index.ts`, `src/server/handlers/groups.ts`, `src/server/handlers/queues.ts`, `src/group/manager.ts`, `src/queue/runner.ts`
**Status**: COMPLETED

```typescript
export declare function pauseGroup(groupId: string, configDir?: string): Promise<boolean>;
export declare function resumeGroup(groupId: string, configDir?: string): Promise<boolean>;
export declare function deleteGroup(groupId: string, configDir?: string): Promise<boolean>;
export declare function updateQueueCommand(queueId: string, commandId: string, patch: UpdateQueueCommandInput, configDir?: string): Promise<boolean>;
export declare function moveQueueCommand(queueId: string, from: number, to: number, configDir?: string): Promise<boolean>;
```

**Checklist**:
- [x] `group show/watch/pause/resume/delete` command/API support
- [x] `queue show/pause/resume/delete` command/API support
- [x] queue command edit/remove/move/toggle-mode operations
- [x] End-to-end tests for new control actions

### 6. SDK Compatibility Surface

#### `src/sdk/events.ts`, `src/sdk/tool-registry.ts`, `src/sdk/index.ts` (new module tree)
**Status**: COMPLETED

```typescript
export interface SdkEventEmitter {
  on<T extends SdkEventType>(event: T, handler: SdkEventHandler<T>): void;
  off<T extends SdkEventType>(event: T, handler: SdkEventHandler<T>): void;
  emit<T extends SdkEventType>(event: T, payload: SdkEventPayload<T>): void;
}

export declare function tool<TInput, TOutput>(
  config: ToolConfig<TInput, TOutput>,
): RegisteredTool<TInput, TOutput>;
```

**Checklist**:
- [x] SDK event emitter contract
- [x] Minimal tool registry support
- [x] Public exports from `src/main.ts`
- [x] SDK-focused tests

---

## Task Breakdown

### TASK-001: Bookmark Foundation
**Status**: Completed  
**Parallelizable**: Yes  
**Deliverables**: `src/bookmark/*`, CLI bookmark commands, tests  
**Dependencies**: None

**Completion Criteria**:
- [x] Bookmark CRUD/search implemented
- [x] CLI bookmark parity commands available
- [x] Tests pass

### TASK-002: Token/Permission Control Plane
**Status**: Completed  
**Parallelizable**: Yes  
**Deliverables**: `src/auth/*`, token CLI commands, server auth checks, tests  
**Dependencies**: None

**Completion Criteria**:
- [x] Token lifecycle implemented
- [x] Permission checks enforced in server handlers
- [x] Tests pass

### TASK-003: File Change Index
**Status**: Completed  
**Parallelizable**: Yes  
**Deliverables**: `src/file-changes/*`, files CLI/API, tests  
**Dependencies**: TASK-001

**Completion Criteria**:
- [x] Changed file extraction/indexing works
- [x] CLI/API query paths implemented
- [x] Tests pass

### TASK-004: Activity and Markdown Parsing
**Status**: Completed  
**Parallelizable**: Yes  
**Deliverables**: `src/activity/*`, `src/markdown/*`, session output integration, tests  
**Dependencies**: None

**Completion Criteria**:
- [x] Activity states produced for sessions
- [x] Markdown parsing available for message content
- [x] Tests pass

### TASK-005: Group/Queue Command Parity Expansion
**Status**: Completed  
**Parallelizable**: No  
**Deliverables**: CLI/server/manager updates for advanced controls, tests  
**Dependencies**: TASK-001, TASK-002

**Completion Criteria**:
- [x] Missing group controls added
- [x] Missing queue controls added
- [x] End-to-end tests pass

### TASK-006: SDK Compatibility Layer
**Status**: Completed  
**Parallelizable**: No  
**Deliverables**: `src/sdk/*`, exports, tests  
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004

**Completion Criteria**:
- [x] SDK events/tool registry available
- [x] Public API exports updated
- [x] SDK tests pass

### TASK-007: Integration Hardening
**Status**: Completed  
**Parallelizable**: No  
**Deliverables**: integration tests, docs updates, release notes skeleton  
**Dependencies**: TASK-005, TASK-006

**Completion Criteria**:
- [x] Full test suite and typecheck pass
- [x] Parity matrix updated with final status
- [x] Documentation links updated

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Bookmark subsystem | `src/bookmark/*` | COMPLETED | `src/bookmark/manager.test.ts` |
| Auth/token subsystem | `src/auth/*` | COMPLETED | `src/auth/token-manager.test.ts`, `src/server/server.test.ts` |
| File changes subsystem | `src/file-changes/*` | COMPLETED | `src/file-changes/extractor.test.ts`, `src/file-changes/service.test.ts` |
| Activity subsystem | `src/activity/*` | COMPLETED | `src/activity/manager.test.ts` |
| Markdown parser | `src/markdown/*` | COMPLETED | `src/markdown/parser.test.ts` |
| Group/queue parity extensions | `src/group/*`, `src/queue/*`, `src/cli/index.ts`, `src/server/handlers/*` | COMPLETED | `src/server/server.test.ts` |
| SDK parity layer | `src/sdk/*` | COMPLETED | `src/sdk/events.test.ts`, `src/sdk/tool-registry.test.ts` |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Phase 5 foundation | Phase 4 completion | Available |
| Files index | Bookmark metadata conventions | READY (TASK-001 complete) |
| Group/Queue control expansion | Token permissions + bookmark references | READY (TASK-001 and TASK-002 complete) |
| SDK layer | Core new modules | READY (TASK-001/002/003/004 complete; TASK-005 optional) |
| Integration hardening | Group + SDK readiness | READY (TASK-005 and TASK-006 complete) |

## Completion Criteria

- [x] All Phase 5 modules implemented
- [x] CLI/API parity targets achieved for planned scope
- [x] Unit/integration tests passing
- [x] Type checking passes (`bun run typecheck`)
- [x] Plan and `PROGRESS.json` synchronized

## Progress Log

### Session: 2026-02-20
**Tasks Completed**: Plan created  
**Tasks In Progress**: None  
**Blockers**: None  
**Notes**: Created from parity-gap analysis in `design-docs/specs/design-claude-parity-gap.md`.

### Session: 2026-02-20 12:35
**Tasks Completed**: TASK-001  
**Tasks In Progress**: None  
**Blockers**: None  
**Notes**: Implemented bookmark subsystem (`src/bookmark/*`), added CLI bookmark commands in `src/cli/index.ts`, exported public bookmark API in `src/main.ts`, and passed `bun run test` + `bun run typecheck`.

### Session: 2026-02-20 12:36
**Tasks Completed**: TASK-004  
**Tasks In Progress**: None  
**Blockers**: None  
**Notes**: Implemented activity/markdown modules (`src/activity/*`, `src/markdown/*`), integrated markdown-task extraction via `session show --tasks` in `src/cli/index.ts`, exported APIs in `src/main.ts`, and passed full test suite/typecheck.

### Session: 2026-02-20 13:05
**Tasks Completed**: TASK-002  
**Tasks In Progress**: None  
**Blockers**: None  
**Notes**: Implemented token and permission control plane (`src/auth/*`), added token CLI commands (`token create/list/revoke/rotate`) in `src/cli/index.ts`, integrated managed-token authentication and route-level permission checks in `src/server/auth.ts` + `src/server/server.ts`, and passed `bun run typecheck` + full tests.

### Session: 2026-02-20 13:09
**Tasks Completed**: TASK-003  
**Tasks In Progress**: None  
**Blockers**: None  
**Notes**: Implemented file-change indexing (`src/file-changes/*`), added `files list/find/rebuild` CLI commands, added `/api/files/*` server handlers/routes, and passed full typecheck + test suite.

### Session: 2026-02-20 13:14
**Tasks Completed**: TASK-005  
**Tasks In Progress**: None  
**Blockers**: None  
**Notes**: Expanded group/queue controls with pause/resume/delete and queue command update/remove/move/mode operations across repository, CLI, and server handlers; added integration coverage in `src/server/server.test.ts`; full typecheck and tests passing.

### Session: 2026-02-20 13:16
**Tasks Completed**: TASK-006  
**Tasks In Progress**: None  
**Blockers**: None  
**Notes**: Implemented SDK compatibility layer (`src/sdk/events.ts`, `src/sdk/tool-registry.ts`, `src/sdk/index.ts`), exported SDK APIs from `src/main.ts`, and added SDK unit tests with full suite passing.

### Session: 2026-02-20 13:17
**Tasks Completed**: TASK-007  
**Tasks In Progress**: None  
**Blockers**: None  
**Notes**: Completed integration hardening by validating full suite/typecheck, updating parity matrix in `design-docs/specs/design-claude-parity-gap.md`, and adding release notes skeleton in `design-docs/specs/phase5-release-notes.md`.

## Related Plans

- **Previous**: `impl-plans/active/phase4-daemon-app-server.md`
- **Next**: (none)
- **Depends On**: `impl-plans/active/phase4-daemon-app-server.md`
