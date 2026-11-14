# Source Refactor Auth/Server Cleanup Implementation Plan

**Status**: Completed
**Design Reference**: design-docs/specs/architecture.md#overview
**Created**: 2026-03-17
**Last Updated**: 2026-03-17

---

## Design Document Reference

**Source**: `design-docs/specs/architecture.md`

### Summary
Refactor the auth and server layers to reduce duplication, remove dead template code, and centralize route and permission definitions.

### Scope
**Included**: auth permission constant cleanup, server route registration consolidation, router metadata support, dead template file removal, and regression tests.
**Excluded**: behavior changes to existing APIs, CLI UX redesign, or unrelated large-scale module rewrites.

---

## Modules

### 1. Auth Permission Cleanup

#### src/auth/types.ts, src/auth/index.ts, src/auth/token-manager.ts, src/server/auth.ts

**Status**: COMPLETED

```typescript
export const ALL_PERMISSIONS: readonly Permission[];
export const DEFAULT_TOKEN_PERMISSIONS: readonly Permission[];
export function parsePermissionList(input: string): readonly Permission[];
```

**Checklist**:
- [x] Centralize reusable permission constants
- [x] Remove duplicated permission parsing logic
- [x] Remove server-local full-permission hardcoding

### 2. Server Route Definition Consolidation

#### src/server/router.ts, src/server/server.ts

**Status**: COMPLETED

```typescript
interface RouteOptions {
  readonly requiredPermission?: Permission | undefined;
}
```

**Checklist**:
- [x] Attach permission metadata to routes
- [x] Register REST routes from a single definition list
- [x] Remove duplicated route-to-permission logic

### 3. Dead Code Removal and Verification

#### src/lib.ts, src/lib.test.ts, src/server/server.test.ts, src/auth/token-manager.test.ts

**Status**: COMPLETED

```typescript
// Remove unused template library helpers and keep tests aligned with active code.
```

**Checklist**:
- [x] Delete unused template source/test files
- [x] Add/adjust regression coverage for refactored code
- [x] Run typecheck and relevant tests

---

## Module Status

| Module | File Path | Status | Tests |
|--------|-----------|--------|-------|
| Auth permission cleanup | `src/auth/types.ts`, `src/auth/index.ts`, `src/auth/token-manager.ts`, `src/server/auth.ts` | COMPLETED | Passed |
| Server route definitions | `src/server/router.ts`, `src/server/server.ts` | COMPLETED | Passed |
| Dead code removal and tests | `src/lib.ts`, `src/lib.test.ts`, `src/server/server.test.ts`, `src/auth/token-manager.test.ts` | COMPLETED | Passed |

## Dependencies

| Feature | Depends On | Status |
|---------|------------|--------|
| This refactor | Existing auth/server modules | Available |

## Completion Criteria

- [x] Permission constants centralized without behavior regressions
- [x] Server routes and permission checks share one source of truth
- [x] Unused template code removed
- [x] Targeted tests pass
- [x] Type checking passes

## Progress Log

### Session: 2026-03-17 00:00
**Tasks Completed**: Planning
**Tasks In Progress**: Auth/server refactor and dead code removal
**Blockers**: None
**Notes**: Scoped the refactor to auth constants, server route metadata, and unused template files to avoid conflicts with unrelated in-progress changes.

### Session: 2026-03-17 13:34
**Tasks Completed**: Auth permission cleanup, server route consolidation, dead code removal, regression verification
**Tasks In Progress**: None
**Blockers**: None
**Notes**: `bun run typecheck`, `bun run test`, and targeted Vitest reruns for auth/server/CLI/GraphQL all passed after formatting.

## Related Plans

- **Previous**: N/A
- **Next**: N/A
- **Depends On**: Existing repository architecture
