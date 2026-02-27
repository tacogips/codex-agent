# Issue 17 Public Export Session Search Plan

**Status**: Completed
**Design Reference**: https://github.com/tacogips/codex-agent/issues/17
**Created**: 2026-02-27
**Last Updated**: 2026-02-27

## Scope
Expose session transcript search APIs through the stable package entrypoint and verify distribution artifacts include runtime exports for downstream consumers.

## Tasks

### TASK-001: Public Entrypoint Exports
**Status**: Completed
**Parallelizable**: No
**Deliverables**:
- `src/main.ts`
- `src/types/index.ts`

**Completion Criteria**:
- [x] `searchSessions` exported from package entrypoint
- [x] `searchSessionTranscript` exported from package entrypoint
- [x] Search-related types exported through public type index

### TASK-002: Dist Runtime Verification
**Status**: Completed
**Parallelizable**: No
**Deps**: TASK-001
**Deliverables**:
- `src/sdk/agent-runner.dist-runtime.test.ts`
- `dist/main.js`

**Completion Criteria**:
- [x] Test verifies dist entrypoint exports session search APIs
- [x] `bun run build` updates dist artifact with new exports
- [x] Typecheck and tests pass

## Completion Criteria
- [x] All tasks completed
- [x] Public API includes session search exports
- [x] Distribution artifact validated

## Progress Log

### Session: 2026-02-27 18:45
**Tasks Completed**: TASK-001, TASK-002
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Added public exports for session search and types, added dist runtime export assertion, rebuilt dist, and verified checks.
