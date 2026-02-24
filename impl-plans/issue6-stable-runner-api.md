# Issue #6 Stable Runner API Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/github-issue-6.md#stable-ts-runner-api
**Created**: 2026-02-24
**Last Updated**: 2026-02-25

---

## Design Document Reference

**Source**: GitHub Issue `#6` - https://github.com/tacogips/codex-agent/issues/6

### Summary
Expose a single stable TypeScript runner facade that accepts a provider-agnostic request and hides Codex CLI command composition details from callers.

### Scope
**Included**: SDK facade API, attachment normalization in internals, internal resume/new-session selection, tests, and README API contract documentation.
**Excluded**: CLI command surface changes and server endpoint redesign.

---

## Modules

### 1. Stable SDK Runner Facade

#### src/sdk/agent-runner.ts

**Status**: COMPLETED

```typescript
interface AgentRunnerOptions {
  readonly codexBinary?: string | undefined;
  readonly codexHome?: string | undefined;
  readonly includeExistingOnResume?: boolean | undefined;
}

type AgentAttachment =
  | { readonly type: "path"; readonly path: string }
  | { readonly type: "base64"; readonly data: string; readonly mediaType?: string | undefined; readonly filename?: string | undefined };

type AgentRequest =
  | {
      readonly prompt: string;
      readonly sessionId?: undefined;
      readonly attachments?: readonly AgentAttachment[] | undefined;
    }
  | {
      readonly sessionId: string;
      readonly prompt?: string | undefined;
      readonly attachments?: readonly AgentAttachment[] | undefined;
    };

interface AgentEvent {
  readonly type: "session.started" | "session.message" | "session.completed" | "session.error";
}

declare function runAgent(
  request: AgentRequest,
  options?: AgentRunnerOptions,
): AsyncIterable<AgentEvent>;
```

**Checklist**:
- [x] Add stable facade function for callers
- [x] Keep CLI command selection internal
- [x] Normalize attachments to image paths in internals
- [x] Support both new and resume flow through one API

### 2. SDK Tests and Public Contract Docs

#### src/sdk/agent-runner.test.ts

**Status**: COMPLETED

```typescript
declare function runAgent(
  request: AgentRequest,
  options?: AgentRunnerOptions,
): AsyncIterable<AgentEvent>;
```

**Checklist**:
- [x] Test new session flow via stable API
- [x] Test resume flow via stable API
- [x] Test base64/path attachment normalization and internal image handling
- [x] Prove callers do not pass CLI command forms

#### src/sdk/index.ts

**Status**: COMPLETED

```typescript
export type {
  AgentAttachment,
  AgentEvent,
  AgentRequest,
  AgentRunnerOptions,
} from "./agent-runner";
export { runAgent } from "./agent-runner";
```

**Checklist**:
- [x] Export stable runner API from SDK root

#### README.md

**Status**: COMPLETED

**Checklist**:
- [x] Document stable API contract and usage path

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Stable runner facade | `src/sdk/agent-runner.ts` | COMPLETED | Passed |
| Facade tests | `src/sdk/agent-runner.test.ts` | COMPLETED | Passed |
| Public exports | `src/sdk/index.ts` | COMPLETED | Passed |
| Documentation | `README.md` | COMPLETED | Passed |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Stable runner facade | Existing `SessionRunner` and process layer | Available |

## Completion Criteria

- [x] Stable `runAgent(request)` API implemented
- [x] Attachment normalization handled internally
- [x] Resume/new branching hidden from callers
- [x] Full test suite passes
- [x] README includes public API contract

## Progress Log

### Session: 2026-02-24 23:43
**Tasks Completed**: Plan drafted
**Tasks In Progress**: SDK facade implementation
**Blockers**: None
**Notes**: Implementing directly against issue #6 contract with tests.

### Session: 2026-02-25 00:05
**Tasks Completed**: SDK facade, tests, exports, docs, full test/typecheck validation
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added stable `runAgent` API and proved CLI command composition remains internal.

## Related Plans

- **Previous**: `impl-plans/completed/phase5-claude-parity-features.md`
- **Next**: N/A
- **Depends On**: Existing completed phase plans
