#!/bin/sh
# One worktree's complete local development lifecycle.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
WORKTREE_DIR=${WORKTREE_DIR:-$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)}
REPO_ROOT=${REPO_ROOT:-$(git -C "$WORKTREE_DIR" rev-parse --show-toplevel)}
ENV_FILE=${ENV_FILE:-$WORKTREE_DIR/.env}
EXAMPLE_FILE=$REPO_ROOT/.env.example
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-}
COMPOSE_FILES="-f $REPO_ROOT/docker-compose.yml -f $REPO_ROOT/docker-compose.dev.yml"
BASE_SLOT=${WORKTREE_SLOT_BASE:-100}
SLOT_COUNT=${WORKTREE_SLOT_COUNT:-100}
PORT_STEP=${WORKTREE_PORT_STEP:-10}

cd "$WORKTREE_DIR"

die() { printf 'worktree-dev: %s\n' "$*" >&2; exit 1; }

read_var() {
  awk -F= -v key="$1" '$1 == key { value=substr($0, index($0, "=") + 1) } END { print value }' "$ENV_FILE"
}

random_value() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 24
  else od -An -N24 -tx1 /dev/urandom | tr -d ' \n'
  fi
}

upsert_if_missing() {
  key=$1 value=$2 current=$(read_var "$1" || true)
  [ -n "$current" ] && return 0
  awk -v key="$key" '$1 !~ "^" key "=" { print }' "$ENV_FILE" >"$ENV_FILE.tmp"
  printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
}

set_value() {
  key=$1 value=$2
  awk -v key="$key" '$1 !~ "^" key "=" { print }' "$ENV_FILE" >"$ENV_FILE.tmp"
  printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
}

set_derived() {
  key=$1 value=$2
  if [ "${FRESH_ENV:-0}" != 1 ]; then
    current=$(read_var "$key" || true)
    case "$key:$current" in
      AUTH_URL:http://localhost:3000|AUTH_URL:http://localhost:3[0-9][0-9][0-9]) ;;
      AUTH_KEYCLOAK_ISSUER:http://localhost:*/realms/boardgame) ;;
      *) upsert_if_missing "$key" "$value"; return ;;
    esac
  fi
  set_value "$key" "$value"
}

ensure_local_secret() {
  key=$1 value=$2 current=$(read_var "$1" || true)
  case "$current" in ''|replace-with-*|*-change-me) set_value "$key" "$value" ;; esac
}

port_free() {
  port=$1
  if [ -n "${PORT_CHECK_CMD:-}" ]; then
    # Test hooks provide a command that exits zero when the port is occupied.
    if sh -c "$PORT_CHECK_CMD" port-check "$port"; then return 1; else return 0; fi
  fi
  if command -v nc >/dev/null 2>&1; then ! nc -z 127.0.0.1 "$port" >/dev/null 2>&1; return; fi
  if command -v ss >/dev/null 2>&1; then ! ss -H -ltn "sport = :$port" 2>/dev/null | grep -q .; return; fi
  if command -v lsof >/dev/null 2>&1; then ! lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; return; fi
  return 0
}

slot_ports() {
  slot=$1
  WEB_PORT=$((3000 + slot * PORT_STEP))
  API_PORT_HOST=$((3001 + slot * PORT_STEP))
  KEYCLOAK_PORT=$((8080 + slot * PORT_STEP))
  DB_PORT_HOST=$((5432 + slot * PORT_STEP))
  VAULT_PORT=$((8200 + slot * PORT_STEP))
}

ports_available() {
  slot_ports "$1"
  port_free "$WEB_PORT" && port_free "$API_PORT_HOST" && port_free "$KEYCLOAK_PORT" &&
    port_free "$DB_PORT_HOST" && port_free "$VAULT_PORT"
}

init_env() {
  [ -f "$EXAMPLE_FILE" ] || die "missing $EXAMPLE_FILE"
  FRESH_ENV=0
  if [ ! -f "$ENV_FILE" ]; then cp "$EXAMPLE_FILE" "$ENV_FILE"; FRESH_ENV=1; fi

  path_hash=$(printf '%s' "$WORKTREE_DIR" | cksum | awk '{ print $1 }')
  slot=$(read_var WORKTREE_SLOT || true)
  if [ -z "$slot" ]; then
    slot=$((path_hash % SLOT_COUNT))
    tries=0
    while ! ports_available "$slot"; do
      tries=$((tries + 1))
      [ "$tries" -lt "$SLOT_COUNT" ] || die "no free worktree port block found"
      slot=$(((slot + 1) % SLOT_COUNT))
    done
    upsert_if_missing WORKTREE_SLOT "$slot"
  else
    case "$slot" in *[!0-9]*|'') die "WORKTREE_SLOT must be numeric" ;; esac
    slot_ports "$slot"
  fi

  readable=$(basename "$WORKTREE_DIR" | tr -cd '[:alnum:]_-')
  [ -n "$readable" ] || readable=worktree
  readable=$(printf '%s' "$readable" | tr '[:upper:]' '[:lower:]' | cut -c1-24)
  project_hash=$(printf '%s' "$WORKTREE_DIR" | cksum | awk '{ printf "%06x", $1 % 16777216 }')
  set_derived COMPOSE_PROJECT_NAME "bggg-${readable}-${project_hash}"
  slot=$(read_var WORKTREE_SLOT)
  slot_ports "$slot"
  set_derived WEB_HOST_PORT "$WEB_PORT"
  set_derived API_HOST_PORT "$API_PORT_HOST"
  set_derived KEYCLOAK_HOST_PORT "$KEYCLOAK_PORT"
  set_derived DB_HOST_PORT "$DB_PORT_HOST"
  set_derived VAULT_HOST_PORT "$VAULT_PORT"
  set_derived KEYCLOAK_HOST_URL "http://localhost:$KEYCLOAK_PORT"
  set_derived DB_HOST localhost
  set_derived KEYCLOAK_URL "http://localhost:$KEYCLOAK_PORT"
  set_derived AUTH_KEYCLOAK_ISSUER "http://localhost:$KEYCLOAK_PORT/realms/boardgame"
  set_derived AUTH_URL "http://localhost:$WEB_PORT"
  ensure_local_secret DB_PASSWORD "$(random_value)"
  ensure_local_secret VAULT_DEV_ROOT_TOKEN "$(random_value)"
  ensure_local_secret KEYCLOAK_ADMIN_PASSWORD "$(random_value)"
  ensure_local_secret AUTH_SECRET "$(random_value)"
  ensure_local_secret BOOTSTRAP_ADMIN_PASSWORD "$(random_value)"
  chmod 600 "$ENV_FILE"
}

compose() {
  # shellcheck disable=SC2086
  docker compose --project-name "$(read_var COMPOSE_PROJECT_NAME)" --env-file "$ENV_FILE" $COMPOSE_FILES "$@"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "Docker is required; install Docker Desktop or Docker Engine"
  docker compose version >/dev/null 2>&1 || die "Docker Compose is required (try 'docker compose version')"
}

wait_for() {
  label=$1 url=$2
  retries=${DEV_READY_RETRIES:-30}
  i=0
  while [ "$i" -lt "$retries" ]; do
    curl -fsS "$url" >/dev/null 2>&1 && return 0
    i=$((i + 1)); sleep 2
  done
  compose ps >&2 || true
  compose logs --tail=30 keycloak vault >&2 || true
  die "$label did not become ready after $retries attempts"
}

wait_for_server() {
  label=$1 port=$2
  retries=${DEV_SERVER_READY_RETRIES:-30}
  i=0
  while [ "$i" -lt "$retries" ]; do
    curl -sS -o /dev/null --max-time 2 "http://localhost:$port" && return 0
    i=$((i + 1)); sleep 2
  done
  die "$label did not start on localhost:$port; check .dev/worktree-$(read_var WORKTREE_SLOT)/$label.log"
}

up() {
  require_docker
  if ! ports_available "$(read_var WORKTREE_SLOT)"; then
    [ -n "$(compose ps -q db 2>/dev/null || true)" ] || die "a selected worktree port is occupied; run 'make dev-setup' after freeing it or reset WORKTREE_SLOT"
  fi
  compose up -d db keycloak vault
  wait_for keycloak "http://localhost:$(read_var KEYCLOAK_HOST_PORT)/realms/master"
  wait_for vault "http://localhost:$(read_var VAULT_HOST_PORT)/v1/sys/health"
  compose exec -T db pg_isready -U "$(read_var DB_USER)" -d "$(read_var DB_NAME)" >/dev/null
}

sync_secrets() {
  EXEC_CMD="docker compose --project-name $(read_var COMPOSE_PROJECT_NAME) --env-file $ENV_FILE $COMPOSE_FILES exec -T keycloak" \
    ENV_FILE="$ENV_FILE" WEB_HOST_PORT="$(read_var WEB_HOST_PORT)" sh "$SCRIPT_DIR/sync-dev-secrets.sh"
}

setup() {
  init_env; require_docker
  if [ -z "$(read_var BGG_API_TOKEN || true)" ] && command -v infisical >/dev/null 2>&1; then
    token=$(infisical secrets get BGG_API_TOKEN --path=/ENV_VARS --env="${INFISICAL_ENV:-dev}" --plain 2>/dev/null || true)
    [ -z "$token" ] || { awk '$1 !~ "^BGG_API_TOKEN=" { print }' "$ENV_FILE" >"$ENV_FILE.tmp"; printf 'BGG_API_TOKEN=%s\n' "$token" >>"$ENV_FILE.tmp"; mv "$ENV_FILE.tmp" "$ENV_FILE"; }
  fi
  [ -n "$(read_var BGG_API_TOKEN || true)" ] || printf 'worktree-dev: warning: BGG_API_TOKEN is unset; BGG features will not work\n' >&2
  up
  sync_secrets
  compose exec -T keycloak /bin/sh /seed-dev-user.sh
  set -a; . "$ENV_FILE"; set +a
  host_db_port=$(read_var DB_HOST_PORT)
  [ -n "$host_db_port" ] || die "DB_HOST_PORT is empty; run 'make dev-setup' to regenerate worktree settings"
  api_port=$(read_var API_HOST_PORT)
  web_port=$(read_var WEB_HOST_PORT)
  [ -n "$api_port" ] && [ -n "$web_port" ] || die "worktree app ports are incomplete; run 'make dev-setup' to regenerate worktree settings"
  DB_HOST=localhost DB_PORT="$host_db_port" KEYCLOAK_URL="http://localhost:$(read_var KEYCLOAK_HOST_PORT)" \
    BOOTSTRAP_ADMIN_EMAIL="$BOOTSTRAP_ADMIN_EMAIL" BOOTSTRAP_ADMIN_PASSWORD="$BOOTSTRAP_ADMIN_PASSWORD" \
    npm run seed:admin --workspace=apps/api
  DB_HOST=localhost DB_PORT="$host_db_port" npm run migration:run --workspace=apps/api
  LEGACY_DEV_STATE_DIR=${LEGACY_DEV_STATE_DIR:-$WORKTREE_DIR/logs}
  if [ "$LEGACY_DEV_STATE_DIR" != "$WORKTREE_DIR/.dev/worktree-$(read_var WORKTREE_SLOT)" ] && [ -d "$LEGACY_DEV_STATE_DIR" ]; then
    DEV_STATE_DIR="$LEGACY_DEV_STATE_DIR" sh "$SCRIPT_DIR/dev-servers.sh" stop >/dev/null 2>&1 || true
  fi
  DEV_STATE_DIR="$WORKTREE_DIR/.dev/worktree-$(read_var WORKTREE_SLOT)" \
    API_CMD="DB_HOST=localhost DB_PORT=$host_db_port KEYCLOAK_URL=http://localhost:$(read_var KEYCLOAK_HOST_PORT) PORT=$api_port npm run start:dev --workspace=apps/api" \
    WEB_CMD="NEXT_PUBLIC_API_URL=http://localhost:$api_port PORT=$web_port npm run dev --workspace=apps/web -- --port $web_port" \
    KEYCLOAK_HOST_URL="http://localhost:$(read_var KEYCLOAK_HOST_PORT)" \
    sh "$SCRIPT_DIR/dev-servers.sh" stop >/dev/null 2>&1 || true
  DEV_STATE_DIR="$WORKTREE_DIR/.dev/worktree-$(read_var WORKTREE_SLOT)" \
    API_CMD="DB_HOST=localhost DB_PORT=$host_db_port KEYCLOAK_URL=http://localhost:$(read_var KEYCLOAK_HOST_PORT) PORT=$api_port npm run start:dev --workspace=apps/api" \
    WEB_CMD="NEXT_PUBLIC_API_URL=http://localhost:$api_port PORT=$web_port npm run dev --workspace=apps/web -- --port $web_port" \
    KEYCLOAK_HOST_URL="http://localhost:$(read_var KEYCLOAK_HOST_PORT)" \
    sh "$SCRIPT_DIR/dev-servers.sh" start
  wait_for_server api "$api_port"
  wait_for_server web "$web_port"
  status
}

status() {
  printf 'worktree: %s\nproject: %s\nweb: http://localhost:%s\nports: web=%s api=%s keycloak=%s db=%s vault=%s\n' \
    "$(basename "$WORKTREE_DIR")" "$(read_var COMPOSE_PROJECT_NAME)" \
    "$(read_var WEB_HOST_PORT)" "$(read_var WEB_HOST_PORT)" "$(read_var API_HOST_PORT)" "$(read_var KEYCLOAK_HOST_PORT)" "$(read_var DB_HOST_PORT)" "$(read_var VAULT_HOST_PORT)"
  compose ps 2>/dev/null || true
  DEV_STATE_DIR="$WORKTREE_DIR/.dev/worktree-$(read_var WORKTREE_SLOT)" sh "$SCRIPT_DIR/dev-servers.sh" status
  printf 'logs: %s/.dev/worktree-%s\n' "$WORKTREE_DIR" "$(read_var WORKTREE_SLOT)"
}

stop() { DEV_STATE_DIR="$WORKTREE_DIR/.dev/worktree-$(read_var WORKTREE_SLOT)" sh "$SCRIPT_DIR/dev-servers.sh" stop; }
down() { stop; require_docker; compose down; }
clean() { [ "${1:-}" = --confirm ] || die "clean requires --confirm"; stop; require_docker; compose down -v; }

case "${1:-}" in
  init) init_env ;;
  up) init_env; up ;;
  secrets) init_env; require_docker; sync_secrets ;;
  setup) setup ;;
  status) init_env; status ;;
  stop) init_env; stop ;;
  down) init_env; down ;;
  clean) init_env; clean "${2:-}" ;;
  *) die "usage: worktree-dev.sh init|up|secrets|setup|status|stop|down|clean --confirm" ;;
esac
