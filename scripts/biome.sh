#!/usr/bin/env sh
set -eu

if [ -n "${BIOME_BINARY:-}" ]; then
  exec "$BIOME_BINARY" "$@"
fi

if command -v nix >/dev/null 2>&1; then
  exec nix develop -c biome "$@"
fi

exec biome "$@"
