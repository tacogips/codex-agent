# Phase 5 Release Notes (Skeleton)

## Summary

Phase 5 closes major parity gaps with `claude-code-agent` across bookmark management, auth/token controls, file-change indexing, activity/markdown utilities, queue/group controls, and SDK primitives.

## Major Additions

- Bookmark subsystem: `src/bookmark/*`
- Token/permission subsystem: `src/auth/*`
- File-change index subsystem: `src/file-changes/*`
- Activity + markdown subsystem: `src/activity/*`, `src/markdown/*`
- Group/queue control-surface expansion: `src/group/*`, `src/queue/*`, `src/cli/index.ts`
- SDK compatibility layer: `src/sdk/*`

## API and CLI Changes

- New CLI groups:
  - `bookmark ...`
  - `token ...`
  - `files ...`
- Expanded CLI controls:
  - `group show/pause/resume/delete`
  - `queue show/pause/resume/delete/update/remove/move/mode`
- Local GraphQL command execution:
  - `codex-agent graphql <query|command>`
  - `codex-agent gql <query|command>` remains available as a compatibility alias

## Validation

- Typecheck: `bun run typecheck`
- Tests: `bun run test`

## Known Follow-ups

- Align residual semantic differences for `group watch/archive` with upstream behavior
- Evaluate richer SDK compatibility coverage beyond minimal event/tool contracts
