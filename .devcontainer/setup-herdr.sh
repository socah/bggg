#!/bin/sh
set -eu

export PATH="$HOME/.local/bin:$PATH"

if ! command -v herdr >/dev/null 2>&1; then
  installer=$(mktemp)
  trap 'rm -f "$installer"' EXIT HUP INT TERM
  curl -fsSL https://herdr.dev/install.sh -o "$installer"
  bash "$installer"
  rm -f "$installer"
  trap - EXIT HUP INT TERM
fi

command -v herdr >/dev/null 2>&1 || {
  printf '%s\n' 'Herdr installer completed but herdr is not on PATH' >&2
  exit 1
}

npx --yes skills add herdrdev/herdr --skill herdr -g
