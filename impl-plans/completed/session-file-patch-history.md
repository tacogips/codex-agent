# Session File Patch History Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/design-codex-session-management.md#22-persistence-modes
**Created**: 2026-03-15
**Last Updated**: 2026-03-15

---

## Design Document Reference

**Source**: design-docs/specs/design-codex-session-management.md

### Summary

Add session-scoped file patch history retrieval by reading rollout transcripts and reconstructing successful file edits, including per-file chronological patch entries when the rollout contains `apply_patch` data.

### Scope

**Included**: rollout edit-event extraction, per-file chronological session patch history service, CLI/API exposure, and tests.
**Excluded**: cross-session patch indexing, diffing against the current filesystem, and guaranteed patch recovery for sessions persisted without tool results.

---

## Modules

### 1. File Change Extraction

#### src/file-changes/extractor.ts, src/file-changes/types.ts

**Status**: COMPLETED

```typescript
export interface FileChangeDetail {
  readonly path: string;
  readonly timestamp: string;
  readonly operation: FileOperation;
  readonly source: FileChangeSource;
  readonly command?: string;
  readonly patch?: string;
}

export declare function extractFileChangeDetails(
  lines: readonly RolloutLine[],
): readonly FileChangeDetail[];
```

**Checklist**:

- [x] Extract only successful edit operations from rollout tool calls
- [x] Parse `apply_patch` payloads into per-file patch entries
- [x] Keep existing changed-file summaries working on top of the new detail extractor

### 2. Session Patch History Service

#### src/file-changes/service.ts, src/file-changes/index.ts, src/main.ts

**Status**: COMPLETED

```typescript
export interface SessionFilePatchHistory {
  readonly sessionId: string;
  readonly files: readonly SessionFileHistory[];
  readonly totalFiles: number;
  readonly totalChanges: number;
}

export declare function getSessionFilePatchHistory(
  sessionId: string,
  options?: GetFilesOptions,
): Promise<SessionFilePatchHistory>;
```

**Checklist**:

- [x] Group extracted change details by file
- [x] Sort per-file entries chronologically
- [x] Export the new API from the package surface

### 3. CLI, HTTP, and Tests

#### src/cli/index.ts, src/server/handlers/files.ts, src/server/server.ts, tests

**Status**: COMPLETED

```typescript
// CLI
codex-agent files patches <session-id> [--format json|table]

// HTTP
GET /api/files/:id/patches
```

**Checklist**:

- [x] Add CLI command for session patch history
- [x] Add HTTP route and handler for patch history
- [x] Add unit/integration tests for extractor, service, and server endpoint

---

## Module Status

| Module                        | File Path                                                                  | Status    | Tests  |
| ----------------------------- | -------------------------------------------------------------------------- | --------- | ------ |
| File change extraction        | `src/file-changes/extractor.ts`, `src/file-changes/types.ts`               | COMPLETED | Passed |
| Session patch history service | `src/file-changes/service.ts`, `src/file-changes/index.ts`, `src/main.ts`  | COMPLETED | Passed |
| CLI and HTTP surface          | `src/cli/index.ts`, `src/server/handlers/files.ts`, `src/server/server.ts` | COMPLETED | Passed |

## Dependencies

| Feature               | Depends On                                 | Status    |
| --------------------- | ------------------------------------------ | --------- |
| Session patch history | Existing rollout reader and session lookup | Available |

## Completion Criteria

- [x] Successful edit extraction works for modern rollout tool-call shapes
- [x] Session patch history is available via library API, CLI, and HTTP
- [x] Tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-03-15 00:00

**Tasks Completed**: Planning
**Tasks In Progress**: File change extraction implementation
**Blockers**: None
**Notes**: Verified local rollout files contain `apply_patch` payloads inside session transcripts, so the feature can be implemented directly from rollout data.

### Session: 2026-03-15 23:41

**Tasks Completed**: Extraction, service/API/CLI wiring, regression tests, typecheck
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added success-gated edit extraction for `shell`, `exec_command`, legacy exec events, and `custom_tool_call` `apply_patch` entries. Exposed grouped per-file chronological history through the library API, `files patches`, and `GET /api/files/:id/patches`.

## Related Plans

- **Previous**: None
- **Next**: None
- **Depends On**: Existing file-change indexing feature
