# Phase 5: Claude-Code-Agent Parity Features Implementation Plan

**Status**: Ready
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
**Status**: NOT_STARTED

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
**Status**: NOT_STARTED

```typescript
export declare function addBookmark(input: CreateBookmarkInput, configDir?: string): Promise<Bookmark>;
export declare function listBookmarks(filter?: BookmarkFilter, configDir?: string): Promise<readonly Bookmark[]>;
export declare function getBookmark(id: string, configDir?: string): Promise<Bookmark | null>;
export declare function deleteBookmark(id: string, configDir?: string): Promise<boolean>;
export declare function searchBookmarks(query: string, options?: SearchOptions, configDir?: string): Promise<readonly BookmarkSearchResult[]>;
```

**Checklist**:
- [ ] Bookmark types and validators
- [ ] JSON persistence (`~/.config/codex-agent/bookmarks.json`)
- [ ] CRUD + search manager
- [ ] Unit tests

### 2. Token and Permission Management

#### `src/auth/types.ts`, `src/auth/token-manager.ts`, `src/auth/index.ts`
**Status**: NOT_STARTED

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
- [ ] Permission type model and parser
- [ ] Hashed token storage + metadata store
- [ ] CLI lifecycle commands (`token create/list/revoke/rotate`)
- [ ] Server auth integration with permission checks
- [ ] Unit and integration tests

### 3. File-Change Indexing

#### `src/file-changes/types.ts`, `src/file-changes/extractor.ts`, `src/file-changes/service.ts`, `src/file-changes/index.ts`
**Status**: NOT_STARTED

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
- [ ] Rollout-driven file change extraction
- [ ] Index manager and rebuild flow
- [ ] CLI commands for files list/find/index stats
- [ ] HTTP API endpoints for file queries
- [ ] Tests with fixture rollouts

### 4. Activity and Markdown Parsing

#### `src/activity/types.ts`, `src/activity/manager.ts`, `src/markdown/parser.ts`, `src/markdown/types.ts`
**Status**: NOT_STARTED

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
- [ ] Activity status derivation from rollout events
- [ ] Markdown parser utility
- [ ] Session detail integration options (`--tasks` / parse views)
- [ ] Tests for parser and activity transitions

### 5. Queue and Group Control Surface Expansion

#### `src/cli/index.ts`, `src/server/handlers/groups.ts`, `src/server/handlers/queues.ts`, `src/group/manager.ts`, `src/queue/runner.ts`
**Status**: NOT_STARTED

```typescript
export declare function pauseGroup(groupId: string, configDir?: string): Promise<boolean>;
export declare function resumeGroup(groupId: string, configDir?: string): Promise<boolean>;
export declare function deleteGroup(groupId: string, configDir?: string): Promise<boolean>;
export declare function updateQueueCommand(queueId: string, commandId: string, patch: UpdateQueueCommandInput, configDir?: string): Promise<boolean>;
export declare function moveQueueCommand(queueId: string, from: number, to: number, configDir?: string): Promise<boolean>;
```

**Checklist**:
- [ ] `group show/watch/pause/resume/delete` command/API support
- [ ] `queue show/pause/resume/delete` command/API support
- [ ] queue command edit/remove/move/toggle-mode operations
- [ ] End-to-end tests for new control actions

### 6. SDK Compatibility Surface

#### `src/sdk/events.ts`, `src/sdk/tool-registry.ts`, `src/sdk/index.ts` (new module tree)
**Status**: NOT_STARTED

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
- [ ] SDK event emitter contract
- [ ] Minimal tool registry support
- [ ] Public exports from `src/main.ts`
- [ ] SDK-focused tests

---

## Task Breakdown

### TASK-001: Bookmark Foundation
**Status**: Not Started  
**Parallelizable**: Yes  
**Deliverables**: `src/bookmark/*`, CLI bookmark commands, tests  
**Dependencies**: None

**Completion Criteria**:
- [ ] Bookmark CRUD/search implemented
- [ ] CLI bookmark parity commands available
- [ ] Tests pass

### TASK-002: Token/Permission Control Plane
**Status**: Not Started  
**Parallelizable**: Yes  
**Deliverables**: `src/auth/*`, token CLI commands, server auth checks, tests  
**Dependencies**: None

**Completion Criteria**:
- [ ] Token lifecycle implemented
- [ ] Permission checks enforced in server handlers
- [ ] Tests pass

### TASK-003: File Change Index
**Status**: Not Started  
**Parallelizable**: Yes  
**Deliverables**: `src/file-changes/*`, files CLI/API, tests  
**Dependencies**: TASK-001

**Completion Criteria**:
- [ ] Changed file extraction/indexing works
- [ ] CLI/API query paths implemented
- [ ] Tests pass

### TASK-004: Activity and Markdown Parsing
**Status**: Not Started  
**Parallelizable**: Yes  
**Deliverables**: `src/activity/*`, `src/markdown/*`, session output integration, tests  
**Dependencies**: None

**Completion Criteria**:
- [ ] Activity states produced for sessions
- [ ] Markdown parsing available for message content
- [ ] Tests pass

### TASK-005: Group/Queue Command Parity Expansion
**Status**: Not Started  
**Parallelizable**: No  
**Deliverables**: CLI/server/manager updates for advanced controls, tests  
**Dependencies**: TASK-001, TASK-002

**Completion Criteria**:
- [ ] Missing group controls added
- [ ] Missing queue controls added
- [ ] End-to-end tests pass

### TASK-006: SDK Compatibility Layer
**Status**: Not Started  
**Parallelizable**: No  
**Deliverables**: `src/sdk/*`, exports, tests  
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004

**Completion Criteria**:
- [ ] SDK events/tool registry available
- [ ] Public API exports updated
- [ ] SDK tests pass

### TASK-007: Integration Hardening
**Status**: Not Started  
**Parallelizable**: No  
**Deliverables**: integration tests, docs updates, release notes skeleton  
**Dependencies**: TASK-005, TASK-006

**Completion Criteria**:
- [ ] Full test suite and typecheck pass
- [ ] Parity matrix updated with final status
- [ ] Documentation links updated

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Bookmark subsystem | `src/bookmark/*` | NOT_STARTED | - |
| Auth/token subsystem | `src/auth/*` | NOT_STARTED | - |
| File changes subsystem | `src/file-changes/*` | NOT_STARTED | - |
| Activity subsystem | `src/activity/*` | NOT_STARTED | - |
| Markdown parser | `src/markdown/*` | NOT_STARTED | - |
| Group/queue parity extensions | `src/group/*`, `src/queue/*`, `src/cli/index.ts`, `src/server/handlers/*` | NOT_STARTED | - |
| SDK parity layer | `src/sdk/*` | NOT_STARTED | - |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Phase 5 foundation | Phase 4 completion | Available |
| Files index | Bookmark metadata conventions | BLOCKED by TASK-001 |
| Group/Queue control expansion | Token permissions + bookmark references | BLOCKED by TASK-001, TASK-002 |
| SDK layer | Core new modules | BLOCKED by TASK-001-004 |

## Completion Criteria

- [ ] All Phase 5 modules implemented
- [ ] CLI/API parity targets achieved for planned scope
- [ ] Unit/integration tests passing
- [ ] Type checking passes (`bun run typecheck`)
- [ ] Plan and `PROGRESS.json` synchronized

## Progress Log

### Session: 2026-02-20
**Tasks Completed**: Plan created  
**Tasks In Progress**: None  
**Blockers**: None  
**Notes**: Created from parity-gap analysis in `design-docs/specs/design-claude-parity-gap.md`.

## Related Plans

- **Previous**: `impl-plans/active/phase4-daemon-app-server.md`
- **Next**: (none)
- **Depends On**: `impl-plans/active/phase4-daemon-app-server.md`
