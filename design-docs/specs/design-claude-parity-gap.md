# Claude-Code-Agent Parity Gap Analysis and Design

This document inventories major capabilities in `/g/gits/tacogips/claude-code-agent`, verifies parity in `/g/gits/tacogips/codex-agent`, and defines the design scope for missing capabilities.

## Overview

`codex-agent` already covers the core orchestration baseline (sessions, groups, queues, server, daemon). However, parity with `claude-code-agent` is still incomplete in several product-facing and SDK-facing areas.

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
| Group orchestration | Create/list/add/remove/run | Partial | `src/cli/index.ts`, `src/group/manager.ts` |
| Group advanced controls | show/watch/pause/resume/archive/delete | Missing | no matching commands/routes |
| Queue orchestration | create/add/list/run/stop | Partial | `src/cli/index.ts`, `src/server/handlers/queues.ts` |
| Queue advanced controls | show/pause/resume/delete + command edit/move/toggle-mode | Missing | no matching commands/routes |
| Bookmark system | add/list/search/show/delete bookmarks | Missing | no `bookmark` module/CLI |
| Token and permission model | token create/list/revoke/rotate + scoped permissions | Missing | no `token` CLI/auth store |
| Files changed index | changed-file extraction/search/index stats | Missing | no file-change module |
| Activity tracking | status/activity extraction and APIs | Missing | no activity module |
| Markdown parsing utility | structured markdown parser for messages | Missing | no markdown parser module |
| SDK event/tool registry layer | event bus + tool registry/MCP helper surface | Missing | no SDK subpackage equivalent |
| REST control-plane parity | richer session/group/queue control endpoints | Partial | current routes in `src/server/server.ts` |

## Gap Summary

High-priority missing capabilities for parity:
1. Bookmark management
2. Token/permission-based auth management
3. File-change indexing/query
4. Activity extraction and status tracking
5. Markdown parser utility
6. Expanded group/queue command surface
7. SDK-facing event and tool registry APIs

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
