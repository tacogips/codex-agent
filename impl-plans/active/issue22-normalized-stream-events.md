# Issue #22 Normalized Stream Events Implementation Plan

**Status**: In Progress
**Design Reference**: https://github.com/tacogips/codex-agent/issues/22
**Created**: 2026-03-01
**Last Updated**: 2026-03-01

---

## Design Document Reference

**Source**: GitHub Issue `#22` - https://github.com/tacogips/codex-agent/issues/22

### Summary
Add an opt-in, provider-schema-agnostic normalized streaming event mode for `runAgent` while keeping existing raw event and char behaviors backward compatible.

### Scope
**Included**: `streamMode: "normalized"` in SDK facade, normalized event mapper, convenience adapter for existing message streams, tests, and public exports.
**Excluded**: Breaking changes to existing `event`/`char` streaming or CLI streaming behavior.

---

## Modules

### 1. Normalized Streaming API and Mapper

#### src/sdk/agent-runner.ts

**Status**: COMPLETED

```typescript
export type AgentStreamMode = "raw" | "normalized";

declare function runAgent(
  request: AgentRequest & { readonly streamMode: "normalized" },
  options?: AgentRunnerOptions,
): AsyncGenerator<AgentNormalizedEvent>;

declare function toNormalizedEvents(
  chunks: AsyncIterable<SessionStreamChunk>,
): AsyncGenerator<AgentNormalizedChunkEvent>;
```

**Checklist**:
- [x] Add opt-in `streamMode: "normalized"` without breaking existing defaults
- [x] Map rollout `event` and `char` chunk streams to normalized events
- [x] Keep existing raw mode (`session.message`) behavior unchanged
- [x] Include completion and error mapping for normalized mode

### 2. Public Export Surface

#### src/sdk/index.ts, src/main.ts

**Status**: COMPLETED

```typescript
export { runAgent, toNormalizedEvents } from "./agent-runner";
```

**Checklist**:
- [x] Export normalized types/events from SDK index
- [x] Export normalized APIs from package root

### 3. Test Coverage

#### src/sdk/agent-runner.test.ts, src/sdk/agent-runner.dist-runtime.test.ts

**Status**: COMPLETED

```typescript
test("streamMode normalized maps event stream", ...)
test("streamMode normalized maps char stream", ...)
test("toNormalizedEvents adapts raw chunks", ...)
```

**Checklist**:
- [x] `event -> normalized`
- [x] `char -> normalized`
- [x] tool call/result mapping
- [x] completion/error mapping
- [x] dist runtime export coverage for adapter

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Normalized streaming API | `src/sdk/agent-runner.ts` | COMPLETED | Passed |
| Public exports | `src/sdk/index.ts`, `src/main.ts` | COMPLETED | Passed |
| Normalized tests | `src/sdk/agent-runner.test.ts`, `src/sdk/agent-runner.dist-runtime.test.ts` | COMPLETED | Passed |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| Issue #22 normalized stream layer | Existing `SessionRunner` stream chunks | Available |

## Completion Criteria

- [x] Opt-in normalized stream mode implemented
- [x] Backward compatibility preserved for existing API behavior
- [x] Tests added for event/char/tool/completion/error and adapter
- [x] Full test suite passes
- [x] Type checking passes
- [ ] Dist sync check passes

## Progress Log

### Session: 2026-03-01 09:00
**Tasks Completed**: TASK-001, TASK-002, TASK-003 implementation + test additions
**Tasks In Progress**: Validation (tests/typecheck/build/dist-sync)
**Blockers**: None
**Notes**: Implemented normalized stream mode and adapter with backward-compatible raw mode.

### Session: 2026-03-01 09:50
**Tasks Completed**: Validation for test/typecheck/build
**Tasks In Progress**: Dist sync finalization
**Blockers**: `check:dist-sync` reports expected working-tree diff for updated `dist/main.js`
**Notes**: `bun run test`, `bun run typecheck`, and `bun run build` all passed after implementation.

## Related Plans

- **Previous**: `impl-plans/issue6-stable-runner-api.md`
- **Next**: N/A
- **Depends On**: Existing SDK/session runner implementation
