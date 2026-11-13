#!/usr/bin/env sh
set -eu
kit_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 24 or later, then run setup again." >&2
  exit 1
fi
exec node "$kit_root/scripts/setup.mjs" "$@"
