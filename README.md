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
bun run check:dist-sync
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

- `session`: list/show/watch/run/resume/fork
- `group`: create/list/show/add/remove/pause/resume/delete/run
- `queue`: create/add/show/list/pause/resume/delete/update/remove/move/mode/run
- `bookmark`: add/list/get/delete/search
- `token`: create/list/revoke/rotate
- `files`: list/find/rebuild
- `server`: start
- `daemon`: start/stop/status
- `version`: inspect installed tool versions as human-readable text or JSON

Examples:

```bash
# List sessions
bun run src/bin.ts session list --limit 20

# Show one session and extract markdown tasks
bun run src/bin.ts session show <session-id> --tasks

# Start a new session, send one prompt, and stream output
bun run src/bin.ts session run --prompt "say hello" --stream-granularity char

# Create and run a queue
bun run src/bin.ts queue create nightly --project /path/to/repo
bun run src/bin.ts queue add nightly --prompt "Run checks and summarize failures"
bun run src/bin.ts queue run nightly --model gpt-5

# Start API server
bun run src/bin.ts server start --host 127.0.0.1 --port 3100

# Tool versions for system status UI
bun run src/bin.ts version --json
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

## Stable SDK Runner API

Use the stable SDK facade when integrating from TypeScript applications.
Callers pass a typed request object and do not compose Codex CLI command forms.

```ts
import { runAgent, type AgentEvent } from "codex-agent";

const events: AgentEvent[] = [];
for await (const event of runAgent({
  prompt: "Summarize the latest test failures",
  attachments: [
    { type: "path", path: "./screenshots/failure.png" },
    { type: "base64", data: "iVBORw0KGgoAAA...", mediaType: "image/png" },
  ],
})) {
  events.push(event);
}
```

Request routing (`exec` vs `resume`) and attachment normalization are handled
inside `codex-agent` internals.

### Streaming Options (CLI + SDK)

`codex-agent` supports two stream granularities:

- `event`: emit rollout events (`session_meta`, `event_msg`, `response_item`, ...)
- `char`: emit assistant text as character chunks

#### CLI: one command to start a new session and stream response

```bash
# Event-level stream (default)
bun run src/bin.ts session run --prompt "say hello"

# Character stream
bun run src/bin.ts session run --prompt "say hello" --stream-granularity char

# Slower "typing" effect in terminal
bun run src/bin.ts session run --prompt "say hello" --stream-granularity char --char-delay-ms 30
```

Relevant flags:

- `--prompt <P>`: required for `session run`
- `--stream-granularity <event|char>`: output mode
- `--char-delay-ms <n>`: delay per rendered character in `session run` char mode (default: `8`)

#### SDK: character chunks in library integrations

```ts
import { runAgent } from "codex-agent";

for await (const event of runAgent({
  prompt: "say hello",
  streamGranularity: "char",
})) {
  if (event.type === "session.message") {
    const chunk = event.chunk;
    if (typeof chunk === "object" && chunk !== null && "kind" in chunk && chunk.kind === "char") {
      process.stdout.write(chunk.char);
    }
  }
}
process.stdout.write("\n");
```

If you want a visible typing effect in your app, apply delay in your render loop (the SDK returns chunks, but display pacing is caller-controlled).

#### Important behavior note

Depending on the upstream `codex exec --json` event shape, assistant text may arrive as completed message items (not token deltas).  
In that case, `char` mode still emits per-character chunks from the completed text, and CLI `session run` can pace rendering with `--char-delay-ms`.

Tool-version introspection is available for health/system status screens:

```ts
import { getToolVersions } from "codex-agent";

const versions = await getToolVersions({ includeGit: true });
// {
//   codex: { version: "codex 0.x.y", error: null },
//   git: { version: "git version 2.x.y", error: null }
// }
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

Verify distribution artifacts are synced with source:

```bash
bun run check:dist-sync
```

## Notes

- TypeScript strict mode is enabled (`tsconfig.json`).
- Nix users can enter the environment with `nix develop`.
- Design docs are stored in `design-docs/` and implementation plans in `impl-plans/`.
