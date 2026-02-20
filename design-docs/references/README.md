# Design References

This directory contains reference materials for system design and implementation.

## External References

| Name | URL | Description |
|------|-----|-------------|
| TypeScript Documentation | https://www.typescriptlang.org/docs/ | Official TypeScript documentation |
| Bun Documentation | https://bun.sh/docs | Official Bun runtime documentation |
| OpenAI Codex CLI (GitHub) | https://github.com/openai/codex | Codex CLI source - Rust-based coding agent |
| claude-code-agent | /g/gits/tacogips/claude-code-agent | Source project: Claude Code process manager |
| Codex Rollout Format | codex-rs/core/src/rollout/ | JSONL session persistence (recorder.rs, list.rs) |
| Codex State DB | codex-rs/state/src/ | SQLite-backed thread metadata (thread_metadata.rs, log_db.rs) |
| Codex ThreadManager | codex-rs/core/src/thread_manager.rs | Session lifecycle management |
| Codex Config | codex-rs/core/src/config/ | Configuration system (mod.rs, types.rs) |
| Codex CLI Main | codex-rs/cli/src/main.rs | CLI entry point with resume/fork commands |
| Codex Protocol | codex-rs/protocol/src/ | Shared protocol types |

## Reference Documents

Reference documents should be organized by topic:

```
references/
├── README.md              # This index file
├── typescript/            # TypeScript patterns and practices
└── <topic>/               # Other topic-specific references
```

## Adding References

When adding new reference materials:

1. Create a topic directory if it does not exist
2. Add reference documents with clear naming
3. Update this README.md with the reference entry
