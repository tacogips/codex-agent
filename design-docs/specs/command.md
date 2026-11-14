# Command Design

This document describes CLI command interface design specifications.

## Overview

Command-line interface design decisions, including subcommands, flags, options, and environment variables.

---

## Sections

### Subcommands

Define the CLI subcommand structure and hierarchy.

### Flags and Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| (Add flags here) | | | |

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| (Add env vars here) | | | |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| (Add more exit codes as needed) | |

---

## Process Manager Codex CLI 0.137 Compatibility

### Context

Issue-resolution workflow `codex-design-and-implement-review-loop` is resolving
the supplied request "Fix codex-agent for Codex CLI 0.137 process
compatibility" for repository `tacogips/codex-agent`. No GitHub issue URL or
issue number was provided, so the design source is the Step 1 intake payload and
the local repository state.

The installed Codex CLI 0.137.0 command surface removed
`--ask-for-approval` and the legacy `--full-auto` exec flag. Its accepted
process sandbox values are:

- `read-only`
- `workspace-write`
- `danger-full-access`

### Design Requirement

`ProcessManager` is the only boundary that converts `CodexProcessOptions` into
Codex CLI argv. It must never emit `--ask-for-approval`, including when callers
still supply `approvalMode`.

`approvalMode` remains accepted at public API and parser boundaries as a
deprecated no-op compatibility input. Source compatibility is preserved for SDK,
CLI, and GraphQL callers, but no approval option is forwarded to the Codex CLI
process boundary.

`fullAuto` remains accepted as the codex-agent compatibility input for
hands-off execution, but `ProcessManager` must map it to Codex CLI 0.137's
current explicit `--dangerously-bypass-approvals-and-sandbox` flag instead of
the removed `--full-auto` flag.

### Data Flow

1. CLI parsing, SDK runners, and GraphQL command handlers normalize user input
   into `CodexProcessOptions`.
2. `SessionRunner` and `AgentRunner` forward process options without
   reinterpreting `approvalMode`.
3. `ProcessManager` builds the final Codex CLI argv.
4. Only current Codex CLI flags and values are emitted:
   - `--sandbox <read-only|workspace-write|danger-full-access>` when sandbox is
     supplied;
   - `--dangerously-bypass-approvals-and-sandbox` when `fullAuto` is true;
   - `-c <override>` for config overrides;
   - existing supported flags such as `--model` and `--json` where appropriate.

### Validation Rules

- `SANDBOX_MODES` must contain exactly `read-only`, `workspace-write`, and
  `danger-full-access`.
- CLI usage and parser validation must document and accept only those sandbox
  values.
- Deprecated `--approval-mode` may remain parseable for source compatibility,
  but help text must identify it as a compatibility no-op.
- Deprecated `--full-auto` may remain parseable at codex-agent CLI boundaries,
  but the spawned Codex process must receive only the current bypass flag.
- `additionalArgs` remains an advanced passthrough and is not rewritten by this
  compatibility rule.
- Tests must explicitly prove that `approvalMode` does not cause
  `--ask-for-approval` to appear in spawned argv, and that `fullAuto` does not
  cause `--full-auto` to appear in spawned argv.

### Boundaries

- `src/process/types.ts` owns public process option types and sandbox constants.
- `src/process/manager.ts` owns final Codex CLI argv construction.
- `src/cli/parsing.ts` and `src/cli/usage.ts` own command-line compatibility
  parsing and operator-facing documentation.
- `src/sdk/session-runner.ts` and `src/sdk/agent-runner.ts` own SDK option
  forwarding.
- `src/graphql/params.ts` and `src/graphql/command-handlers.ts` own GraphQL
  option parsing and forwarding.
- Cursor-specific CLI behavior is not part of this issue. If Cursor support is
  added later, it must remain behind adapter modules and must not change this
  Codex process contract.

### Review And Rollout Constraints

This is high-risk issue-resolution work because an obsolete flag can break
workflow executable preflight and all codex-agent process execution paths.
Existing local changes must be reviewed and improved in place rather than
discarded.

Required verification commands:

```bash
bun test src/process/manager.test.ts src/cli/index.test.ts src/sdk/session-runner.test.ts src/sdk/agent-runner.test.ts src/graphql/index.test.ts
bun run typecheck
bun run lint
bun test
bun run build
```
