# Resume Config Overrides Regression Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/architecture.md#sdk-config-override-forwarding-parity`
**Created**: 2026-05-26
**Last Updated**: 2026-05-26

## Source Context

This plan implements the accepted issue-resolution design for the delegated
recent-change review finding from `recent-change-quality-loop` /
`step3-handoff`.

- **Reviewed Range**: `83c3c2b6445df3d31b047b93d27a4bfe3e64ddcb..HEAD`
- **Finding**: `src/sdk/agent-runner.test.ts:314` lacks resume-session
  `configOverrides` regression coverage.
- **Review Decision**: Blocking, mid severity.
- **Scope**: Add regression coverage only. Do not change runtime code unless the
  new test proves resume `configOverrides` forwarding is broken.

## Codex-Agent References

| Path | Purpose |
| --- | --- |
| `src/sdk/agent-runner.test.ts` | Primary deliverable; mirror existing resume `additionalArgs` and new-session `configOverrides` tests. |
| `src/sdk/agent-runner.ts` | Routing reference; `AgentRequest.configOverrides` should flow into `SessionRunner.resumeSession`. |
| `src/sdk/session-runner.ts` | Resume orchestration reference; `resumeSession` forwards options into the process manager. |
| `src/sdk/mock-session-runner.ts` | Structured mock reference for preserving `configOverrides` in call records. |
| `src/process/manager.test.ts` | Process-level reference for `-c <override>` command argument expectations. |

## Tasks

### TASK-001: Add Resume Config Override Regression Test

**Status**: Completed
**Parallelizable**: No
**Deliverable**: `src/sdk/agent-runner.test.ts`
**Dependencies**: None

Add a test beside `forwards additional args for resume sessions` that:

- creates a temporary `codexHome` session rollout file for a known session id;
- creates a fake Codex binary that writes received arguments to a log file;
- calls `runAgent` with `{ sessionId, configOverrides: ['model_reasoning_effort="high"'] }`;
- drains the returned async event stream;
- asserts the argument log contains `exec`, `resume`, `--json`, the target
  session id, and the newline-separated pair `-c` then
  `model_reasoning_effort="high"`.

**Completion Criteria**:

- [x] Test name clearly identifies resume-session `configOverrides` forwarding.
- [x] Test follows existing fixture cleanup conventions using `createdDirs`.
- [x] Assertions prove resume command parity with new-session `configOverrides`.
- [x] No unrelated runtime behavior or broad refactor is introduced.

### TASK-002: Contingency Runtime Fix If Regression Fails

**Status**: Skipped
**Parallelizable**: No
**Deliverables**: `src/sdk/agent-runner.ts`, `src/sdk/session-runner.ts`
**Dependencies**: TASK-001 failure showing a real forwarding defect

If TASK-001 fails because `configOverrides` is not forwarded through resume
execution, make the smallest source change needed to preserve
`AgentRequest.configOverrides` through:

`runAgent -> startFromRequest -> SessionRunner.resumeSession -> ProcessManager.spawnResumeStream`

**Completion Criteria**:

- [x] Source edits are limited to the broken forwarding boundary. Skipped because
  TASK-001 passed without runtime changes.
- [x] Existing new-session behavior remains unchanged.
- [x] TASK-001 passes after the fix. Skipped because no runtime fix was needed.

### TASK-003: Verify Issue-Resolution Scope

**Status**: Completed
**Parallelizable**: No
**Deliverables**: Verification command results and progress-log update
**Dependencies**: TASK-001, and TASK-002 only if triggered

Run required verification commands:

```bash
bun test src/process/manager.test.ts src/sdk/agent-runner.test.ts
bun run typecheck
```

Then rerun recent-change review for the same 24-hour target scope and target
paths if the workflow provides that review step.

**Completion Criteria**:

- [x] Targeted tests pass.
- [x] Type checking passes.
- [x] Recent-change review is rerun or explicitly deferred to the workflow step.
- [x] Progress log records implemented task, commands, and any deviations.

## Dependencies

| Task | Depends On | Reason |
| --- | --- | --- |
| TASK-001 | None | The primary finding is a missing test. |
| TASK-002 | TASK-001 failure | Runtime edits are allowed only if the new regression exposes a defect. |
| TASK-003 | TASK-001, optional TASK-002 | Verification must run after the implementation state is final. |

## Parallelization

No tasks are parallelizable. All tasks touch or depend on
`src/sdk/agent-runner.test.ts`, and TASK-002 is conditional on TASK-001 results.

## Completion Criteria

- [x] `src/sdk/agent-runner.test.ts` includes resume-session `configOverrides`
  regression coverage.
- [x] The test asserts `exec`, `resume`, `--json`, session id, `-c`, and the
  override value.
- [x] Runtime source files are unchanged unless a real forwarding defect is
  demonstrated.
- [x] `bun test src/process/manager.test.ts src/sdk/agent-runner.test.ts` passes.
- [x] `bun run typecheck` passes.
- [x] Workflow issue reference remains traceable to
  `recent-change-quality-loop` / `step3-handoff`.

## Progress Log Expectations

Each implementation session must append a dated entry with:

- tasks completed or skipped;
- files changed;
- verification commands and outcomes;
- whether TASK-002 was triggered;
- residual risks or explicit none.

## Progress Log

### Session: 2026-05-26 00:00
**Tasks Completed**: TASK-001 completed; TASK-002 skipped; TASK-003 completed.
**Files Changed**: `src/sdk/agent-runner.test.ts`,
`impl-plans/active/resume-config-overrides-regression.md`.
**Verification Commands**:
`bun test src/process/manager.test.ts src/sdk/agent-runner.test.ts` passed
with 35 tests passing; `bun run typecheck` passed.
**TASK-002 Triggered**: No. The new resume-session `configOverrides`
regression test exercises existing forwarding without requiring runtime source
changes.
**Residual Risks**: Recent-change review rerun is explicitly deferred to the
downstream workflow review step.
