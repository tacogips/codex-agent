# Claude-Code-Agent Parity Gap Analysis and Design

This document inventories major capabilities in `/g/gits/tacogips/claude-code-agent`, verifies parity in `/g/gits/tacogips/codex-agent`, and defines the design scope for missing capabilities.

## Overview

`codex-agent` now covers the core orchestration baseline (sessions, groups, queues, server, daemon) plus the Phase 5 parity additions. Remaining gaps are narrowed to non-goal areas such as full protocol-level compatibility and UI/dashboard work.

## Feature Inventory and Parity Status

Status labels:
- `Implemented`: equivalent capability exists in `codex-agent`
- `Partial`: capability exists but with narrower scope or missing controls
- `Missing`: no equivalent implementation found

| Capability Area | claude-code-agent capability (inventory) | codex-agent status | Evidence (codex-agent) |
|---|---|---|---|
| Session index/read | Session listing/detail and transcript parsing | Implemented | `src/session/index.ts`, `src/rollout/reader.ts` |
| Real-time session monitoring | Watch transcript updates/live stream | Implemented | `src/rollout/watcher.ts`, `src/server/handlers/sessions.ts` |
| Session lifecycle control | Resume/fork controls in CLI | Implemented | `src/cli/index.ts`, `src/process/manager.ts` |
| Group orchestration | Create/list/add/remove/run | Implemented | `src/cli/index.ts`, `src/group/manager.ts` |
| Group advanced controls | show/watch/pause/resume/archive/delete | Partial | `src/cli/index.ts`, `src/server/handlers/groups.ts` |
| Queue orchestration | create/add/list/run/stop | Implemented | `src/cli/index.ts`, `src/server/handlers/queues.ts` |
| Queue advanced controls | show/pause/resume/delete + command edit/move/toggle-mode | Implemented | `src/cli/index.ts`, `src/server/handlers/queues.ts` |
| Bookmark system | add/list/search/show/delete bookmarks | Implemented | `src/bookmark/*`, `src/cli/index.ts` |
| Token and permission model | token create/list/revoke/rotate + scoped permissions | Implemented | `src/auth/*`, `src/server/auth.ts`, `src/cli/index.ts` |
| Files changed index | changed-file extraction/search/index stats | Implemented | `src/file-changes/*`, `src/server/handlers/files.ts`, `src/cli/index.ts` |
| Activity tracking | status/activity extraction and APIs | Implemented | `src/activity/*` |
| Markdown parsing utility | structured markdown parser for messages | Implemented | `src/markdown/*` |
| SDK event/tool registry layer | event bus + tool registry/MCP helper surface | Implemented | `src/sdk/*`, `src/main.ts` |
| REST control-plane parity | richer session/group/queue control endpoints | Implemented | `src/server/server.ts`, `src/server/handlers/*` |

## Gap Summary

Phase 5 closure summary:
1. Bookmark management implemented
2. Token/permission-based auth management implemented
3. File-change indexing/query implemented
4. Activity extraction and status tracking implemented
5. Markdown parser utility implemented
6. Expanded group/queue command surface implemented
7. SDK-facing event and tool registry APIs implemented

## Design Scope for Phase 5

### Included
- Introduce missing feature modules and wire to CLI + server
- Add persistent stores for bookmarks/tokens/file-change index metadata
- Extend queue/group APIs to cover pause/resume/delete/show/edit-style operations
- Add SDK compatibility layer for events + minimal tool registry
- Add tests for new modules and command flows

### Excluded
- UI/dashboard implementation
- Full protocol-level compatibility with every `claude-code-agent` internal type
- Migration of existing persisted data from external tools

## Proposed Module Additions

### Bookmarks

`src/bookmark/types.ts`
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

### Tokens and Permissions

`src/auth/types.ts`
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
```

### File Change Index

`src/file-changes/types.ts`
```typescript
export type FileOperation = "created" | "modified" | "deleted";

export interface ChangedFile {
  readonly path: string;
  readonly operation: FileOperation;
  readonly changeCount: number;
  readonly lastModified: string;
}
```

### Activity and Markdown

`src/activity/types.ts`
```typescript
export type ActivityStatus = "idle" | "running" | "waiting_approval" | "failed";

export interface ActivityEntry {
  readonly sessionId: string;
  readonly status: ActivityStatus;
  readonly updatedAt: string;
}
```

`src/markdown/types.ts`
```typescript
export interface ParsedMarkdown {
  readonly sections: readonly { readonly heading: string; readonly content: string }[];
}
```

## Delivery Strategy

Phase 5 should be executed in incremental slices:
1. Core data models + repositories
2. CLI/server control surface expansions
3. SDK compatibility layer and parser/index utilities
4. Test and typecheck hardening

## References

- `/g/gits/tacogips/claude-code-agent/README.md`
- `/g/gits/tacogips/claude-code-agent/src/cli/main.ts`
- `/g/gits/tacogips/claude-code-agent/src/cli/commands/bookmark.ts`
- `/g/gits/tacogips/claude-code-agent/src/cli/commands/token.ts`
- `/g/gits/tacogips/claude-code-agent/src/cli/commands/files.ts`
- `/g/gits/tacogips/claude-code-agent/src/sdk/index.ts`
