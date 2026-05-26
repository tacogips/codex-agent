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
