#!/bin/sh
# Unit tests for dev-servers.sh — starts REAL processes, but fake ones
# ('sleep'), so no npm/Next/Nest is involved and the test is fast and
# hermetic. Verifies the process-management contract only: pidfiles,
# duplicate-start guard, stop actually kills, status reporting.
#
# Run: sh scripts/dev-servers.test.sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
UNDER_TEST="$SCRIPT_DIR/dev-servers.sh"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

failures=0
check() {
  if [ "$2" = "expected" ]; then
    printf 'ok   %s\n' "$1"
  else
    failures=$((failures + 1))
    printf 'FAIL %s (got %s)\n' "$1" "$2"
  fi
}

# Every run of the script under test operates on this scratch state dir.
run() {
  PID_DIR="$WORK/pids" LOG_DIR="$WORK/logs" \
  API_CMD="${API_CMD:-}" WEB_CMD="${WEB_CMD:-}" \
  sh "$UNDER_TEST" "$@"
}

pid_alive() {
  kill -0 "$1" 2>/dev/null
}

# --- start: launches both fakes, records live pids -------------------------
API_CMD="FOO=expected sh -c 'env > $WORK/env-marker; sleep 30'" WEB_CMD="sleep 30" run start >/dev/null
api_pid=$(cat "$WORK/pids/api.pid")
web_pid=$(cat "$WORK/pids/web.pid")
if pid_alive "$api_pid" && pid_alive "$web_pid"; then check "start: both servers running with pids recorded" expected
else check "start: both servers running with pids recorded" missing; fi
if grep -qx 'FOO=expected' "$WORK/env-marker"; then
  check "start: command environment assignments are applied" expected
else
  check "start: command environment assignments are applied" missing
fi

# --- start twice: must not duplicate ---------------------------------------
API_CMD="sleep 30" WEB_CMD="sleep 30" run start >/dev/null
api_pid2=$(cat "$WORK/pids/api.pid")
if [ "$api_pid" = "$api_pid2" ] && pid_alive "$api_pid"; then
  check "restart guard: second start keeps original processes" expected
else
  check "restart guard: second start keeps original processes" replaced
fi

# --- stop: kills both, removes pidfiles ------------------------------------
run stop >/dev/null
sleep 0.3
if pid_alive "$api_pid" || pid_alive "$web_pid"; then
  check "stop: kills running servers" still-alive
else
  check "stop: kills running servers" expected
fi
if [ ! -f "$WORK/pids/api.pid" ] && [ ! -f "$WORK/pids/web.pid" ]; then
  check "stop: cleans up pidfiles" expected
else
  check "stop: cleans up pidfiles" leftover
fi

# --- stop when nothing runs: quiet success, not an error -------------------
if run stop >/dev/null 2>&1; then
  check "stop: succeeds when nothing is running" expected
else
  check "stop: succeeds when nothing is running" errored
fi

# --- stale pidfile: recycled/unknown pid must not abort stop ---------------
mkdir -p "$WORK/pids"
echo 999999 > "$WORK/pids/api.pid"
if run stop >/dev/null 2>&1 && [ ! -f "$WORK/pids/api.pid" ]; then
  check "stop: tolerates stale pidfile" expected
else
  check "stop: tolerates stale pidfile" failed
fi

if [ "$failures" -gt 0 ]; then
  printf '\n%s test(s) failed\n' "$failures"
  exit 1
fi
printf '\nall tests passed\n'
