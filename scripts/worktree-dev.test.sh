#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SCRIPT=$ROOT/scripts/worktree-dev.sh
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
failures=0
check() { if [ "$2" = expected ]; then printf 'ok   %s\n' "$1"; else failures=$((failures + 1)); printf 'FAIL %s (got %s)\n' "$1" "$2"; fi; }
mkdir -p "$WORK/first" "$WORK/second"

run_init() { WORKTREE_DIR="$1" REPO_ROOT="$ROOT" ENV_FILE="$2" PORT_CHECK_CMD=false sh "$SCRIPT" init; }
run_init "$WORK/first" "$WORK/first.env" >/dev/null
first_slot=$(get_slot_placeholder=1; awk -F= '$1 == "WORKTREE_SLOT" { print $2 }' "$WORK/first.env")
run_init "$WORK/first" "$WORK/first.env" >/dev/null
run_init "$WORK/second" "$WORK/second.env" >/dev/null
get() { awk -F= -v key="$2" '$1 == key { print substr($0, index($0, "=") + 1) }' "$1"; }
check "fresh init creates env" "$( [ -f "$WORK/first.env" ] && echo expected || echo missing )"
check "fresh init derives selected web URL" "$( [ "$(get "$WORK/first.env" AUTH_URL)" = "http://localhost:$(get "$WORK/first.env" WEB_HOST_PORT)" ] && echo expected || echo wrong )"
check "same path keeps slot" "$( [ "$first_slot" = "$(get "$WORK/first.env" WORKTREE_SLOT)" ] && echo expected || echo changed )"
check "different paths get project names" "$( [ "$(get "$WORK/first.env" COMPOSE_PROJECT_NAME)" != "$(get "$WORK/second.env" COMPOSE_PROJECT_NAME)" ] && echo expected || echo same )"
check "host commands use published database port" "$( [ "$(grep -c 'DB_PORT="\$host_db_port"' "$SCRIPT")" = 2 ] && ! grep -q 'DB_PORT="\$(read_var DB_HOST_PORT)"' "$SCRIPT" && echo expected || echo wrong )"

printf 'DB_PASSWORD=my-password\nAUTH_URL=http://custom.example\n' >"$WORK/preserved.env"
WORKTREE_DIR="$WORK/first" REPO_ROOT="$ROOT" ENV_FILE="$WORK/preserved.env" PORT_CHECK_CMD=false sh "$SCRIPT" init >/dev/null
check "existing user secret preserved" "$( [ "$(get "$WORK/preserved.env" DB_PASSWORD)" = my-password ] && echo expected || echo overwritten )"
check "existing user URL preserved" "$( [ "$(get "$WORK/preserved.env" AUTH_URL)" = http://custom.example ] && echo expected || echo overwritten )"

if WORKTREE_DIR="$WORK/first" REPO_ROOT="$ROOT" ENV_FILE="$WORK/conflict.env" WORKTREE_SLOT_COUNT=1 PORT_CHECK_CMD='test "$1" = 3000' sh "$SCRIPT" init >/dev/null 2>&1; then result=accepted; else result=expected; fi
check "occupied port block is rejected" "$result"

[ "$failures" -eq 0 ] || exit 1
printf '\nall tests passed\n'
