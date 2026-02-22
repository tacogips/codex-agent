# codex-agent

`codex-agent` is a Bun + TypeScript CLI/library for managing Codex session data and automation workflows.

It provides:
- Session discovery, inspection, streaming, resume, and fork operations
- Group orchestration for running prompts across multiple sessions
- Queue management for ordered prompt execution
- Bookmarking and search across sessions/messages
- Token-based auth helpers
- File-change indexing and lookup
- HTTP server and daemon modes for integration

## Requirements

- Bun (runtime/package manager)
- TypeScript (installed via dependencies)
- Optional: Nix + direnv for reproducible dev shell

## Quick Start

```bash
bun install
bun run test
bun run typecheck
```

Run CLI help:

```bash
bun run src/bin.ts --help
```

## Development Commands

Using Bun scripts:

```bash
bun run dev
bun run build
bun run start
bun run test
bun run test:watch
bun run typecheck
bun run format
bun run format:check
```

Using `task` (see `Taskfile.yml`):

```bash
task install
task test
task typecheck
task lint
task ci
```

## CLI Overview

Binary entrypoint: `src/bin.ts`

Top-level command groups:
- `session`: list/show/watch/resume/fork
- `group`: create/list/show/add/remove/pause/resume/delete/run
- `queue`: create/add/show/list/pause/resume/delete/update/remove/move/mode/run
- `bookmark`: add/list/get/delete/search
- `token`: create/list/revoke/rotate
- `files`: list/find/rebuild
- `server`: start
- `daemon`: start/stop/status

Examples:

```bash
# List sessions
bun run src/bin.ts session list --limit 20

# Show one session and extract markdown tasks
bun run src/bin.ts session show <session-id> --tasks

# Create and run a queue
bun run src/bin.ts queue create nightly --project /path/to/repo
bun run src/bin.ts queue add nightly --prompt "Run checks and summarize failures"
bun run src/bin.ts queue run nightly --model gpt-5

# Start API server
bun run src/bin.ts server start --host 127.0.0.1 --port 3100
```

## Project Structure

```text
src/
  activity/      Session activity derivation
  auth/          API token and permission handling
  bookmark/      Bookmark storage and search
  cli/           CLI parsing and text formatting
  daemon/        Background daemon lifecycle
  file-changes/  Changed-file extraction and indexing
  group/         Session group orchestration
  markdown/      Markdown parsing and task extraction
  process/       Codex process execution management
  queue/         Prompt queue lifecycle and execution
  rollout/       Rollout log parsing and file watching
  server/        HTTP/WebSocket server components
  session/       Session discovery and SQLite-backed lookup
  sdk/           Lightweight SDK/event abstractions
  types/         Shared strict TypeScript types
```

## Testing

Run full tests:

```bash
bun run test
```

Run type checks:

```bash
bun run typecheck
```

## Notes

- TypeScript strict mode is enabled (`tsconfig.json`).
- Nix users can enter the environment with `nix develop`.
- Design docs are stored in `design-docs/` and implementation plans in `impl-plans/`.
