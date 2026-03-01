# Command Design

This document describes CLI command interface design specifications.

## Overview

Command-line interface design decisions, including subcommands, flags, options, and environment variables.

---

## Sections

### Subcommands

- `codex-agent session run --prompt <P> [--stream-granularity event|char] [--char-delay-ms <n>] [common process options]`
  - Starts a new session and sends one prompt in the same command.
  - Streams session output to stdout.
- `codex-agent session resume <id> [common process options]`
  - Resumes an existing session.
- `codex-agent session watch <id>`
  - Watches rollout updates for an existing session.

### Flags and Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--prompt` | string | none | Required for `session run`; prompt text sent to codex. |
| `--stream-granularity` | enum(`event`,`char`) | `event` | Streaming mode for `session run`. |
| `--char-delay-ms` | number | `8` | Delay in milliseconds per rendered char for `session run` when `--stream-granularity char` is set. |
| `--model` | string | codex default | Model override (common process option). |
| `--sandbox` | enum(`full`,`network-only`,`none`) | codex default | Sandbox mode (common process option). |
| `--full-auto` | boolean | `false` | Enable full-auto mode (common process option). |
| `--image` | string[] | empty | Attach image(s) to prompt (common process option). |

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| (Add env vars here) | | | |

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 1 | Usage error (missing required args like `--prompt`) |

---
