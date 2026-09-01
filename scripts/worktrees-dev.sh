#!/bin/sh
# Apply worktree-dev.sh operations to every linked worktree.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT=${REPO_ROOT:-$(git -C "$SCRIPT_DIR/.." rev-parse --show-toplevel)}
WORKTREE_HELPER=${WORKTREE_HELPER:-$SCRIPT_DIR/worktree-dev.sh}
COMMAND=${1:-}
CONFIRM=${2:-}
CONCURRENCY=${WORKTREE_CONCURRENCY:-2}
[ "$CONCURRENCY" -gt 0 ] 2>/dev/null || { echo "worktrees-dev: WORKTREE_CONCURRENCY must be positive" >&2; exit 2; }
case "$COMMAND" in setup|status|stop|down) ;; clean) [ "$CONFIRM" = --confirm ] || { echo "worktrees-dev: clean requires --confirm" >&2; exit 2; } ;; *) echo "usage: worktrees-dev.sh setup|status|stop|down|clean --confirm" >&2; exit 2 ;; esac

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
index=0
active=0
paths_file=$WORK/paths
git -C "$ROOT" worktree list --porcelain | awk '
  /^worktree / { sub(/^worktree /, ""); print }
' >"$paths_file"

run_one() {
  n=$1 path=$2
  if WORKTREE_DIR="$path" REPO_ROOT="$ROOT" sh "$WORKTREE_HELPER" "$COMMAND" ${CONFIRM:+"$CONFIRM"} >"$WORK/$n.out" 2>&1; then
    printf 'PASS\n' >"$WORK/$n.result"
  else
    printf 'FAIL\n' >"$WORK/$n.result"
  fi
}

while IFS= read -r path; do
  [ -n "$path" ] || continue
  index=$((index + 1))
  run_one "$index" "$path" &
  active=$((active + 1))
  if [ "$active" -ge "$CONCURRENCY" ]; then wait; active=0; fi
done <"$paths_file"
[ "$active" -eq 0 ] || wait

failures=0
n=0
while IFS= read -r path; do
  n=$((n + 1))
  [ -f "$WORK/$n.result" ] || continue
  result=$(cat "$WORK/$n.result")
  printf '%s: %s\n' "$path" "$result"
  if [ "$result" = FAIL ]; then
    failures=$((failures + 1))
    printf '%s\n' "$(cat "$WORK/$n.out")" >&2
  else
    web_url=$(awk '/^web: http:\/\/localhost:/ { print; exit }' "$WORK/$n.out")
    [ -z "$web_url" ] || printf '%s: %s\n' "$path" "$web_url"
  fi
done <"$paths_file"
[ "$failures" -eq 0 ] || { printf '%s worktree(s) failed\n' "$failures" >&2; exit 1; }
