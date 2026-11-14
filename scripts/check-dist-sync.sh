#!/usr/bin/env bash
set -eu

if ! command -v git >/dev/null 2>&1; then
  echo "git is required for dist sync check" >&2
  exit 1
fi

tracked_dist_files="$(git ls-files -- dist)"
if [ -z "$tracked_dist_files" ]; then
  echo "No tracked files under dist/. Check cannot validate distribution sync." >&2
  exit 1
fi

bun run build >/dev/null

if ! git diff --quiet -- dist; then
  echo "Distribution artifacts are out of sync with source." >&2
  echo "Run 'bun run build' and commit updated dist files." >&2
  git --no-pager diff --stat -- dist >&2
  exit 1
fi

untracked_dist="$(git ls-files --others --exclude-standard -- dist)"
if [ -n "$untracked_dist" ]; then
  echo "Untracked files exist under dist/. Commit or remove them:" >&2
  echo "$untracked_dist" >&2
  exit 1
fi

echo "dist artifacts are in sync"
