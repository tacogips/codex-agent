# Design Notes

This document contains research findings, investigations, and miscellaneous design notes.

## Overview

Notable items that do not fit into architecture or client categories.

---

## Sections

### Codex vs Claude Code Session Format Differences

Key differences discovered during research (see [design-codex-session-management.md](./design-codex-session-management.md) Section 3):

1. **Directory structure**: Codex uses date-hierarchical directories (`YYYY/MM/DD/`), Claude Code uses project-based directories (`projects/{projId}/`)
2. **Metadata**: Codex embeds git context (sha, branch, origin) in session_meta; Claude Code does not
3. **Indexing**: Codex uses SQLite + filesystem fallback; Claude Code relies on filesystem only
4. **Session control**: Codex supports resume and fork natively; Claude Code does not
5. **Archiving**: Codex supports session archiving to `archived_sessions/`; Claude Code does not
6. **Deferred writes**: Codex defers file creation until user interaction; Claude Code writes immediately

### Codex CLI Integration Points

Two modes for integration:
1. **CLI exec mode** (`codex exec --json`): JSONL on stdout, suitable for simple automation
2. **App Server** (`codex app-server --listen ws://`): WebSocket protocol, full bidirectional control

The exec mode is the simpler starting point. App-server provides richer control for later phases.

### Claude-Code-Agent Feature Parity Findings (2026-02-20)

Detailed parity results are documented in [design-claude-parity-gap.md](./design-claude-parity-gap.md).

Main findings:
1. Core session/group/queue/server/daemon baselines are implemented in `codex-agent`.
2. `codex-agent` lacks bookmark, token management, file-change indexing, activity tracking, and markdown parser modules.
3. Group/queue command surfaces are narrower than `claude-code-agent` (missing several lifecycle and edit operations).
4. SDK-oriented event/tool-registry compatibility is currently absent.

---
