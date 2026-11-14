# Architecture Design

This document describes system architecture and design decisions.

## Overview

Architectural patterns, system structure, and technical decisions.

---

## Sections

### Codex Session Management

This project is a Codex-compatible process manager -- the counterpart of `claude-code-agent` for OpenAI Codex CLI.

For detailed research findings and design, see [design-codex-session-management.md](./design-codex-session-management.md).

**Summary:**
- Codex stores sessions as JSONL rollout files at `~/.codex/sessions/YYYY/MM/DD/rollout-{ts}-{uuid}.jsonl`
- SQLite state DB at `~/.codex/state` indexes thread metadata for fast queries
- RolloutRecorder handles async JSONL writing with deferred materialization
- ThreadManager manages session lifecycle (create/resume/fork)
- This project adapts claude-code-agent's SDK-first architecture to Codex's rollout format

**Key architectural components:**
- RolloutReader: Parse Codex JSONL rollout files
- SessionIndex: Hybrid SQLite + filesystem session discovery
- ProcessManager: Codex CLI subprocess management (exec mode)
- RolloutWatcher: fs.watch-based real-time monitoring
- GroupManager/QueueManager: Multi-session orchestration (from claude-code-agent)

### Claude Parity Gap and Phase 5 Scope

A feature parity inventory against `/g/gits/tacogips/claude-code-agent` is documented in [design-claude-parity-gap.md](./design-claude-parity-gap.md).

The next architecture phase (Phase 5) adds missing subsystems:
- Bookmark management
- Token/permission auth control plane
- File-change indexing and query
- Activity tracking and markdown parsing
- Expanded queue/group controls and SDK parity surface

---
