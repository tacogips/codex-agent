# Model/Auth Availability Preflight Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/command.md#cli-and-library-surface
**Created**: 2026-03-30
**Last Updated**: 2026-03-30

---

## Design Document Reference

**Source**: design-docs/specs/command.md

### Summary

Add a library-first preflight that accepts a model name, checks Codex login status, and performs a minimal probe run to confirm that the model is actually usable under the current auth state.

### Scope

**Included**: SDK API, package-root export coverage, CLI `model check` command, tests, and README usage notes.
**Excluded**: Server endpoint changes and background caching of probe results.

---

## Modules

### 1. SDK Preflight

#### src/sdk/model-availability.ts

**Status**: COMPLETED

```typescript
interface GetCodexLoginStatusOptions {
  readonly codexBinary?: string | undefined;
  readonly cwd?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

interface CheckCodexModelAvailabilityOptions
  extends GetCodexLoginStatusOptions {
  readonly model: string;
  readonly prompt?: string | undefined;
}

declare function getCodexLoginStatus(
  options?: GetCodexLoginStatusOptions,
): Promise<CodexLoginStatusInfo>;

declare function checkCodexModelAvailability(
  options: CheckCodexModelAvailabilityOptions,
): Promise<CodexModelAvailabilityResult>;
```

**Checklist**:

- [x] Add structured login-status API
- [x] Add active model probe API
- [x] Keep API library-friendly and reusable
- [x] Return separate auth and probe details

### 2. CLI Surface

#### src/cli/index.ts

**Status**: COMPLETED

**Checklist**:

- [x] Add `model check --model <model>` command
- [x] Add `--json` and timeout parsing
- [x] Set exit code on failed availability checks

### 3. Tests and Docs

#### src/sdk/model-availability.test.ts

**Status**: COMPLETED

**Checklist**:

- [x] Cover successful auth + model probe
- [x] Cover auth failure
- [x] Cover model failure

#### README.md

**Status**: COMPLETED

**Checklist**:

- [x] Document CLI usage
- [x] Document library API

---

## Module Status

| Module        | File Path                            | Status    | Tests  |
| ------------- | ------------------------------------ | --------- | ------ |
| SDK preflight | `src/sdk/model-availability.ts`      | COMPLETED | Passed |
| CLI command   | `src/cli/index.ts`                   | COMPLETED | Passed |
| Tests         | `src/sdk/model-availability.test.ts` | COMPLETED | Passed |
| Documentation | `README.md`                          | COMPLETED | Passed |

## Dependencies

| Feature              | Depends On                                | Status    |
| -------------------- | ----------------------------------------- | --------- |
| Model/auth preflight | Existing SDK export surface and Codex CLI | Available |

## Completion Criteria

- [x] Library API implemented
- [x] CLI command implemented
- [x] Tests passing
- [x] Type checking passes

## Progress Log

### Session: 2026-03-30 10:54

**Tasks Completed**: SDK preflight, CLI command, exports, tests, docs
**Tasks In Progress**: None
**Blockers**: None
**Notes**: Implemented an active ephemeral probe so the result reflects real auth/model usability.

## Related Plans

- **Previous**: `impl-plans/issue6-stable-runner-api.md`
- **Next**: N/A
- **Depends On**: Existing SDK and CLI command structure
