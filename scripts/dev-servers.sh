#!/bin/sh
# Starts/stops the host-side dev servers ('npm run dev:api', 'npm run
# dev:web') with pidfiles under logs/, so 'make dev-setup' can go from zero
# to a working localhost:3000 without juggling terminals. The Docker stack's
# own web/api containers stay unpublished by design — this is the intended
# dev split (see docker-compose.yml's api comment).
#
# API_CMD/WEB_CMD/PID_DIR/LOG_DIR are overridable so the test harness can
# drive this script with fake throwaway processes instead of npm.
set -eu

PID_DIR="${PID_DIR:-${DEV_STATE_DIR:-logs}}"
LOG_DIR="${LOG_DIR:-${DEV_STATE_DIR:-logs}}"
API_CMD="${API_CMD:-npm run dev:api}"
WEB_CMD="${WEB_CMD:-npm run dev:web}"

pid_alive() {
  [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null
}

start_one() { # $1=name $2=cmd
  pidfile="$PID_DIR/$1.pid"
  if pid_alive "$pidfile"; then
    echo "$1: already running (pid $(cat "$pidfile"))"
    return 0
  fi
  mkdir -p "$PID_DIR" "$LOG_DIR"
  # shellcheck disable=SC2086 — cmd is deliberately word-split
  if command -v setsid >/dev/null 2>&1; then
    setsid sh -c "exec $2" >>"$LOG_DIR/$1.log" 2>&1 </dev/null &
  else
    sh -c "exec $2" >>"$LOG_DIR/$1.log" 2>&1 </dev/null &
  fi
  echo $! >"$pidfile"
  echo "$1: started (pid $(cat "$pidfile"), log $LOG_DIR/$1.log)"
}

stop_one() { # $1=name
  pidfile="$PID_DIR/$1.pid"
  if [ ! -f "$pidfile" ]; then
    return 0
  fi
  pid=$(cat "$pidfile")
  # npm inserts a process tree between us and the dev server; kill the
  # children, then prefer the whole process group (setsid made our child
  # its own leader) before falling back to the bare pid. Stale/recycled
  # pids just fail every form and are cleaned up quietly.
  pkill -P "$pid" 2>/dev/null || true
  kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  i=0
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 10 ]; do
    i=$((i + 1))
    sleep 0.2
  done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$pidfile"
}

case "${1:-}" in
  start)
    start_one api "$API_CMD"
    start_one web "$WEB_CMD"
    ;;
  stop)
    stop_one api
    stop_one web
    echo "dev servers stopped"
    ;;
  status)
    for name in api web; do
      if pid_alive "$PID_DIR/$name.pid"; then
        echo "$name: running (pid $(cat "$PID_DIR/$name.pid"))"
      else
        echo "$name: stopped"
      fi
    done
    ;;
  *)
    echo "usage: dev-servers.sh start|stop|status" >&2
    exit 2
    ;;
esac
