# Architecture Design

This document describes system architecture and design decisions.

## Overview

Architectural patterns, system structure, and technical decisions.

---

## Sections

(Add architecture design sections below)

---

## SDK Config Override Forwarding Parity

### Context

The recent-change quality loop delegated one issue-resolution finding from
`recent-change-quality-loop` / `step3-handoff`: resume-session command
construction must have the same `configOverrides` forwarding coverage as
new-session command construction.

The reviewed range is `83c3c2b6445df3d31b047b93d27a4bfe3e64ddcb..HEAD`.
The affected paths are:

- `src/sdk/agent-runner.ts`
- `src/sdk/agent-runner.test.ts`
- `src/sdk/session-runner.ts`
- `src/sdk/mock-session-runner.ts`
- `src/process/manager.test.ts`

### Design Requirement

`AgentRequest.configOverrides` is a command-construction option that must be
preserved across both SDK entry paths:

1. New session requests call `SessionRunner.startSession(...)`.
2. Resume session requests call `SessionRunner.resumeSession(...)`.

Both paths must pass `configOverrides` through to the process layer without
reinterpretation. The process layer is responsible for converting each override
into the Codex CLI argument pair `-c <override>`.

### Boundary Rules

- `src/sdk/agent-runner.ts` owns request normalization and start/resume routing.
- `src/sdk/session-runner.ts` owns session lifecycle orchestration and process
  manager invocation.
- `src/process/manager.ts` owns final CLI argument construction.
- SDK-level tests must cover both start and resume routing because the two flows
  build process commands through separate call paths.
- Mock session runner call records must preserve `configOverrides` as structured
  request data so higher-level SDK tests can assert forwarding without depending
  on CLI string formatting.

### Review Finding Mapping

The mid-severity review finding is a regression-coverage gap, not a requested
behavior expansion. `src/sdk/agent-runner.test.ts` must add a narrowly scoped
resume-session test modeled on the existing resume `additionalArgs` coverage and
new-session `configOverrides` coverage.

The test should:

- issue a resume request with `configOverrides`;
- assert the spawned command includes `exec`, `resume`, `--json`, and the target
  session id;
- assert the spawned command includes `-c` followed by the override value;
- avoid unrelated implementation changes unless the test exposes a real defect.

### Verification

Required verification commands for this issue-resolution path:

```bash
bun test src/process/manager.test.ts src/sdk/agent-runner.test.ts
bun run typecheck
```

After implementation, rerun the recent-change review for the same 24-hour target
scope and reviewed target paths.

---

## Distribution Artifact Synchronization

### Context

The recent-change quality loop delegated one issue-resolution finding from
`codex-recent-change-quality-loop` / `step3-handoff`: the committed generated
runtime artifact `dist/main.js` is out of sync with the TypeScript source after
recent changes in the process/session execution path.

The parent workflow execution is
`div-codex-recent-change-quality-loop-1779949794-40badc08`. The delegated
issue-resolution workflow execution is
`div-codex-design-and-implement-review-loop-1779949982-519185f1`.

The reviewed range is `f92afce1a1b691d45bb3fa05c476e744efa84d8f..HEAD`. The
affected paths are:

- `src/process/manager.ts`
- `src/process/manager.test.ts`
- `src/process/types.ts`
- `src/sdk/session-runner.ts`
- `dist/main.js`

### Design Requirement

`dist/main.js` is the package export entry point and published Bun runtime
artifact. Any source change that affects exported runtime behavior must keep this
artifact synchronized with the current `src/main.ts` bundle output before the
change can pass release-quality review.

The source files remain the behavioral authority. `dist/main.js` must be treated
as generated output that reflects source behavior, not as an independently edited
implementation surface.

### Boundary Rules

- `package.json` defines `dist/main.js` as the package `main`, `module`, and
  import export target.
- `bun run build` is the only accepted production artifact generation path for
  `dist/main.js`.
- `bun run check:dist-sync` is the release gate that rebuilds `dist/main.js` and
  fails if the committed file changes.
- Implementation should first run `bun run build`, inspect the generated
  `git diff -- dist/main.js`, and commit the synchronized artifact with the
  source change.
- If the generated diff is unexpectedly large or appears unrelated to source
  behavior, the implementation must check for build-tool nondeterminism before
  broadening the fix beyond `dist/main.js`.
- Cursor-specific behavior is not involved in this issue. If future Cursor CLI
  support needs a generated artifact, it must remain behind adapter modules and
  must not change Codex runtime bundle synchronization rules.

### Review Finding Mapping

The mid-severity review finding is a distribution sync defect:
`bun run check:dist-sync` rebuilt `dist/main.js`, exited with status `1`, and
left `dist/main.js` modified. This means a published consumer could run stale
generated JavaScript even though the TypeScript source and targeted tests pass.

The fix should:

- keep workflow mode as `issue-resolution`;
- keep scope limited to synchronizing `dist/main.js` unless build determinism
  requires a small tooling correction;
- preserve the recent source behavior for Codex exec option parsing and system
  prompt support;
- avoid manual edits to generated bundle logic;
- include generated diff inspection in the handoff notes so reviewers can
  distinguish expected bundle churn from runtime behavior changes.

### Verification

Required verification commands for this issue-resolution path:

```bash
bun run build
git diff -- dist/main.js
bun run check:dist-sync
bun run lint:biome
bun run typecheck
bun run test -- src/process/manager.test.ts src/sdk/session-runner.test.ts src/sdk/agent-runner.dist-runtime.test.ts
```

Before final acceptance, consider running full test coverage because
`dist/main.js` is a published runtime artifact:

```bash
bun run test
```
