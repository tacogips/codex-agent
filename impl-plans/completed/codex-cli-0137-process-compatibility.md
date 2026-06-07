# Codex CLI 0.137 Process Compatibility Implementation Plan

**Status**: Completed
**Design Reference**: `design-docs/specs/command.md#process-manager-codex-cli-0137-compatibility`
**Created**: 2026-06-07
**Last Updated**: 2026-06-07

## Design Document Reference

**Primary Source**: `design-docs/specs/command.md`
**Supporting Source**: `design-docs/specs/design-codex-session-management.md#433-processmanager-codex-specific`

### Summary

Align codex-agent process execution with installed Codex CLI 0.137.0. Codex CLI
0.137 rejects `--ask-for-approval` and the legacy `--full-auto` exec flag, and
codex-agent must restrict sandbox values to `read-only`, `workspace-write`, and
`danger-full-access`.

`approvalMode` remains accepted at CLI, SDK, and GraphQL boundaries only for
source compatibility. It is intentionally a deprecated no-op at the
`ProcessManager` command-argument boundary.

### Scope

**Included**:

- Update process sandbox constants and TypeScript option types.
- Ensure `ProcessManager` never emits `--ask-for-approval`, including when
  `approvalMode` is supplied.
- Preserve `approvalMode` as parseable and forwardable deprecated no-op input.
- Map codex-agent's `fullAuto` compatibility input to Codex CLI 0.137's current
  `--dangerously-bypass-approvals-and-sandbox` flag.
- Update CLI parser/help tests for current sandbox values and deprecated
  approval-mode behavior.
- Add SDK and GraphQL regression coverage for option forwarding into the
  process layer without obsolete argv emission.
- Run targeted and full verification required by the issue-resolution workflow.

**Excluded**:

- Removing public `approvalMode` fields or GraphQL inputs.
- Rewriting `additionalArgs`; advanced passthrough arguments remain caller-owned.
- Implementing Cursor-specific behavior. Cursor adapter boundaries remain out of
  scope for this Codex CLI compatibility issue.

## Codex-Agent References

| Path or Reference | Purpose |
| --- | --- |
| Local codex-agent repository root | Target repository. |
| `src/process/types.ts` | `SandboxMode`, `SANDBOX_MODES`, `ApprovalMode`, and `CodexProcessOptions` compatibility surface. |
| `src/process/manager.ts` | Process argv construction boundary that must not emit `--ask-for-approval`. |
| `src/process/manager.test.ts` | Focused argv regression coverage. |
| `src/cli/parsing.ts` | CLI option parsing for sandbox and deprecated `approvalMode`. |
| `src/cli/usage.ts` | User-facing usage text for current sandbox modes and deprecated approval option. |
| `src/cli/index.test.ts` | CLI parser/help regression coverage. |
| `src/sdk/session-runner.ts` | SDK option forwarding into `ProcessManager`. |
| `src/sdk/session-runner.test.ts` | SessionRunner forwarding regression coverage. |
| `src/sdk/agent-runner.ts` | AgentRunner option forwarding into SessionRunner. |
| `src/sdk/agent-runner.test.ts` | AgentRunner forwarding regression coverage. |
| `src/sdk/agent-runner.process-options.test.ts` | Focused AgentRunner Codex CLI 0.137 process-option regression coverage. |
| `src/graphql/params.ts` | GraphQL input parsing for process options. |
| `src/graphql/command-handlers.ts` | GraphQL command path into SDK/process execution. |
| `src/graphql/index.test.ts` | GraphQL process option regression coverage. |
| `codex exec --sandbox read-only` | Installed Codex CLI 0.137 accepted-behavior reference. |
| `codex exec --ask-for-approval` | Installed Codex CLI 0.137 rejected-behavior reference. |
| `codex exec --dangerously-bypass-approvals-and-sandbox` | Installed Codex CLI 0.137 accepted bypass behavior reference. |

## Tasks

### TASK-001: Process Types And Arg Boundary

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/process/types.ts`, `src/process/manager.ts`,
`src/process/manager.test.ts`
**Dependencies**: Accepted Step 3 design review

Implement the process-boundary compatibility contract:

- `SANDBOX_MODES` is exactly `read-only`, `workspace-write`, and
  `danger-full-access`.
- `CodexProcessOptions.approvalMode` remains present and typed as deprecated
  compatibility input.
- `ProcessManager` omits `--ask-for-approval` for all ordinary option paths.
- `ProcessManager` maps `fullAuto` to
  `--dangerously-bypass-approvals-and-sandbox` and omits legacy `--full-auto`.
- Tests prove sandbox argv emission and prove `approvalMode` does not add the
  removed flag.

**Completion Criteria**:

- [x] `src/process/types.ts` exposes only current sandbox values.
- [x] `src/process/manager.ts` never maps `approvalMode` to
  `--ask-for-approval`.
- [x] `src/process/manager.ts` maps `fullAuto` to
  `--dangerously-bypass-approvals-and-sandbox`.
- [x] `additionalArgs` behavior is left intact and documented as caller-owned.
- [x] `bun test src/process/manager.test.ts` passes.

### TASK-002: CLI Parser And Usage Compatibility

**Status**: Completed
**Parallelizable**: No
**Deliverables**: `src/cli/parsing.ts`, `src/cli/usage.ts`,
`src/cli/index.test.ts`
**Dependencies**: TASK-001

Update the CLI layer so user input matches the process option contract:

- Parse and validate only current sandbox values.
- Keep `--approval-mode` accepted as deprecated no-op compatibility input.
- Keep `--full-auto` accepted as codex-agent compatibility input while
  documenting that it enables Codex CLI bypass mode.
- Update usage text to avoid documenting removed Codex CLI behavior.
- Cover accepted sandbox values, rejected stale values, and deprecated approval
  option parsing.

**Completion Criteria**:

- [x] CLI usage lists `read-only`, `workspace-write`, and
  `danger-full-access`.
- [x] CLI usage marks approval mode as deprecated no-op or avoids promising
  Codex CLI approval behavior.
- [x] CLI usage avoids promising legacy `--full-auto` Codex CLI behavior.
- [x] CLI tests cover parser/help compatibility.
- [x] `bun test src/cli/index.test.ts` passes.

### TASK-003: SDK Forwarding Regression Coverage

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/sdk/session-runner.ts`, `src/sdk/session-runner.test.ts`,
`src/sdk/agent-runner.ts`, `src/sdk/agent-runner.test.ts`,
`src/sdk/agent-runner.process-options.test.ts`
**Dependencies**: TASK-001

Verify SDK callers can still pass `sandbox` and deprecated `approvalMode`
without causing obsolete process argv:

- Preserve SDK option forwarding signatures unless tests reveal an actual break.
- Add or adjust SessionRunner tests around process options.
- Add or adjust AgentRunner tests around request-level process options.
- Limit runtime changes to the smallest forwarding boundary if a test exposes a
  real defect.

**Completion Criteria**:

- [x] SessionRunner tests prove current sandbox forwarding.
- [x] SessionRunner or process-level assertions prove approval mode remains a
  no-op at argv construction.
- [x] AgentRunner tests prove request options still flow through the SDK path.
- [x] `bun test src/sdk/session-runner.test.ts src/sdk/agent-runner.test.ts`
  passes.

### TASK-004: GraphQL Process Option Compatibility

**Status**: Completed
**Parallelizable**: Yes
**Deliverables**: `src/graphql/params.ts`, `src/graphql/command-handlers.ts`,
`src/graphql/index.test.ts`
**Dependencies**: TASK-001

Keep GraphQL inputs compatible with the updated process option contract:

- Accept current sandbox values through GraphQL params.
- Preserve deprecated approval-mode input for source/API compatibility.
- Ensure command handlers forward process options without adding
  `--ask-for-approval`.
- Add focused GraphQL regression coverage for sandbox and deprecated approval
  mode.

**Completion Criteria**:

- [x] GraphQL option parsing accepts the three current sandbox values.
- [x] GraphQL tests cover deprecated approval-mode compatibility.
- [x] Command-handler tests or mocks prove no obsolete flag reaches process
  argv.
- [x] `bun test src/graphql/index.test.ts` passes.

### TASK-005: Full Verification And Plan Closure

**Status**: Completed
**Parallelizable**: No
**Deliverables**: verification results, updated
`impl-plans/completed/codex-cli-0137-process-compatibility.md`,
`impl-plans/PROGRESS.json`
**Dependencies**: TASK-001, TASK-002, TASK-003, TASK-004

Run the required verification suite, update completion checkboxes, and record
the implementation session outcome.

**Completion Criteria**:

- [x] Targeted tests pass:
  `bun test src/process/manager.test.ts src/cli/index.test.ts src/sdk/session-runner.test.ts src/sdk/agent-runner.test.ts src/graphql/index.test.ts`.
- [x] `bun run typecheck` passes.
- [x] `bun run lint` passes.
- [x] `bun test` passes.
- [x] `bun run build` passes.
- [x] Installed CLI behavior is probed or explicitly recorded as delegated to
  adversarial review:
  `codex exec --sandbox read-only --help` and
  `codex exec --ask-for-approval on-request --help`.
- [x] Progress log records changed files, commands, outcomes, and residual
  risks.

## Dependencies

| Task | Depends On | Reason |
| --- | --- | --- |
| TASK-001 | Accepted Step 3 design review | Process boundary defines the shared contract. |
| TASK-002 | TASK-001 | CLI validation and help should match process types. |
| TASK-003 | TASK-001 | SDK regressions assert behavior at or below the process boundary. |
| TASK-004 | TASK-001 | GraphQL regressions assert behavior at or below the process boundary. |
| TASK-005 | TASK-001, TASK-002, TASK-003, TASK-004 | Full verification runs after implementation state is final. |

## Parallelization

`TASK-003` and `TASK-004` are parallelizable after `TASK-001` because their
primary write scopes are disjoint (`src/sdk/*` versus `src/graphql/*`).
`TASK-002` is not marked parallelizable because it shares parser/type semantics
with TASK-001 and should follow the finalized process contract. `TASK-005` is
serial and closes the implementation plan.

## Completion Criteria

- [x] ProcessManager never emits `--ask-for-approval` from ordinary
  `approvalMode` inputs.
- [x] ProcessManager never emits legacy `--full-auto` from ordinary `fullAuto`
  inputs.
- [x] Sandbox options match installed Codex CLI 0.137 values:
  `read-only`, `workspace-write`, `danger-full-access`.
- [x] Deprecated `approvalMode` remains accepted at CLI, SDK, and GraphQL
  boundaries for source compatibility.
- [x] Focused regression tests cover process, CLI, SDK, and GraphQL paths.
- [x] Required verification commands pass or failures are explicitly recorded
  with cause and next action.
- [x] High-risk adversarial implementation review is ready to run after Step 6.

## Progress Log Expectations

Each implementation session must append a dated entry with:

- tasks completed, skipped, or left in progress;
- files changed;
- verification commands and outcomes;
- confirmation that user/local partial changes were reviewed and preserved;
- whether installed Codex CLI 0.137 probing was run;
- residual risks or explicit none.

## Progress Log

### Session: 2026-06-07 00:00

**Tasks Completed**: Step 4 plan revised from accepted design.
**Files Changed**: `impl-plans/active/codex-cli-0137-process-compatibility.md`,
`impl-plans/PROGRESS.json`.
**Tasks In Progress**: None; plan is ready for implementation.
**Blockers**: None.
**Notes**: Plan incorporates Step 3 feedback to keep `approvalMode` as
deprecated no-op and carry installed Codex CLI 0.137 behavior verification into
implementation or adversarial review.

### Session: 2026-06-07 12:25

**Tasks Completed**: Updated process sandbox constants, removed ordinary
`approvalMode` to `--ask-for-approval` emission, mapped `fullAuto` to the
current Codex CLI bypass flag, updated CLI usage, and added focused process
argv regression coverage for both removed flags. Ran targeted tests, full
tests, typecheck, lint, build, and installed CLI probes successfully.
**Files Changed**: `src/process/types.ts`, `src/process/manager.ts`,
`src/process/manager.test.ts`, `src/cli/index.test.ts`, `src/cli/usage.ts`,
`design-docs/specs/command.md`,
`design-docs/specs/design-codex-session-management.md`,
`impl-plans/active/codex-cli-0137-process-compatibility.md`,
`impl-plans/PROGRESS.json`, generated `dist` outputs.
**Verification**: `bun test src/process/manager.test.ts src/cli/index.test.ts`;
`bun test src/sdk/session-runner.test.ts src/sdk/agent-runner.test.ts src/graphql/index.test.ts`;
`bun run typecheck`; `bun run lint:biome`; `bun test`; `bun run build`;
`codex exec --help`; `codex exec --dangerously-bypass-approvals-and-sandbox --help`;
`codex exec --ask-for-approval on-request --help` (expected rejection).
**Tasks In Progress**: Rielflow implementation review and adversarial review.
**Blockers**: None.
**Notes**: Local partial changes were reviewed and preserved. The explicit
`fullAuto` compatibility issue was added after checking the installed Codex CLI
0.137 help surface and existing tests.

### Session: 2026-06-07 21:32

**Tasks Completed**: Completed Step 6 coverage hardening for TASK-003,
TASK-004, and TASK-005. Added focused SessionRunner, AgentRunner, and GraphQL
regressions proving `sandbox: "workspace-write"`, deprecated `approvalMode`,
and `fullAuto` flow through public boundaries while spawned argv contains
`--dangerously-bypass-approvals-and-sandbox` and omits both
`--ask-for-approval` and legacy `--full-auto`.
**Files Changed**: `src/sdk/session-runner.test.ts`,
`src/sdk/agent-runner.process-options.test.ts`, `src/graphql/index.test.ts`,
`impl-plans/active/codex-cli-0137-process-compatibility.md`.
**Verification**: `bunx prettier --write src/process/types.ts
src/process/manager.ts src/process/manager.test.ts src/cli/usage.ts
src/cli/index.test.ts src/sdk/session-runner.test.ts
src/sdk/agent-runner.process-options.test.ts src/graphql/index.test.ts`;
`bun test src/process/manager.test.ts src/cli/index.test.ts
src/sdk/session-runner.test.ts src/sdk/agent-runner.process-options.test.ts
src/sdk/agent-runner.test.ts src/graphql/index.test.ts`; `bun run
lint:biome`; `bun run typecheck`; `bun run lint`; `bun test`; `bun run build`;
`codex --version`; `codex exec --sandbox read-only --help`;
`codex exec --dangerously-bypass-approvals-and-sandbox --help`; `codex exec
--ask-for-approval on-request --help` (expected rejection); `git diff --check`.
**Tasks In Progress**: Rielflow implementation review and adversarial review.
**Blockers**: None.
**Notes**: Existing local partial changes and generated `dist` outputs were
preserved. The new AgentRunner regression was kept in a focused 65-line test
file instead of expanding the existing oversized `src/sdk/agent-runner.test.ts`.

### Session: 2026-06-07 22:05

**Tasks Completed**: Addressed Step 7 adversarial review finding for resume
argv ordering. `buildResumeArgs` now places the exec-level `--sandbox` option
before the `resume` subcommand while keeping resume-supported options such as
`--json`, model, config overrides, image attachments, additional args, and
`--dangerously-bypass-approvals-and-sandbox` after `resume`.
**Files Changed**: `src/process/manager.ts`, `src/process/manager.test.ts`,
`impl-plans/active/codex-cli-0137-process-compatibility.md`.
**Verification**: `bunx prettier --write src/process/manager.ts
src/process/manager.test.ts`; `bun test src/process/manager.test.ts`; `bun run
lint:biome`; `bun run typecheck`; `bun test src/process/manager.test.ts
src/cli/index.test.ts src/sdk/session-runner.test.ts
src/sdk/agent-runner.process-options.test.ts src/sdk/agent-runner.test.ts
src/graphql/index.test.ts`; `bun run lint`; `bun test`; `bun run build`; `bun
run check:dist-sync`; `codex exec resume --json --sandbox read-only --help`
(expected rejection); `codex exec --sandbox read-only resume --json --help`;
`codex exec --sandbox workspace-write resume --json
--dangerously-bypass-approvals-and-sandbox abc hello --help`; `git diff
--check`; `jq empty impl-plans/PROGRESS.json`.
**Tasks In Progress**: Step 6 rerun complete; awaiting review.
**Blockers**: None.
**Notes**: The regression now covers resume with `sandbox: "workspace-write"`,
deprecated `approvalMode`, and `fullAuto`, and asserts both `--ask-for-approval`
and legacy `--full-auto` are absent.

### Session: 2026-06-07 22:20

**Tasks Completed**: Step 8 implementation-plan completion check archived this
plan after Step 7 and adversarial review accepted the implementation with no
high or mid findings.
**Files Changed**: `impl-plans/completed/codex-cli-0137-process-compatibility.md`,
`impl-plans/PROGRESS.json`, `impl-plans/README.md`.
**Verification**: `test ! -e impl-plans/active/codex-cli-0137-process-compatibility.md`;
`test -e impl-plans/completed/codex-cli-0137-process-compatibility.md`;
`jq -r '.plans["codex-cli-0137-process-compatibility"].status' impl-plans/PROGRESS.json`;
`git diff --check`.
**Blockers**: None.
**Notes**: README completed-plan index now includes this plan.

## Related Plans

- **Related**: `impl-plans/completed/model-auth-availability-preflight.md`
