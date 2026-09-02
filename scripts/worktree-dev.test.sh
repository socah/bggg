#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SCRIPT=$ROOT/scripts/worktree-dev.sh
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
failures=0
check() { if [ "$2" = expected ]; then printf 'ok   %s\n' "$1"; else failures=$((failures + 1)); printf 'FAIL %s (got %s)\n' "$1" "$2"; fi; }
mkdir -p "$WORK/first" "$WORK/second" "$WORK/bin"
cat >"$WORK/bin/docker" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$WORK/bin/docker"
cat >"$WORK/bin/curl" <<'EOF'
#!/bin/sh
exit 0
EOF
cat >"$WORK/bin/npm" <<'EOF'
#!/bin/sh
exit 0
EOF
cat >"$WORK/bin/infisical" <<'EOF'
#!/bin/sh
if [ "${INFISICAL_TEST_MODE:-}" = configured ]; then
  printf 'test-token\n'
  exit 0
fi
printf '\033[1mWelcome to Infisical\033[0m\nRun infisical login to continue.\n'
exit 1
EOF
chmod +x "$WORK/bin/curl" "$WORK/bin/npm" "$WORK/bin/infisical"

run_init() { WORKTREE_DIR="$1" REPO_ROOT="$ROOT" ENV_FILE="$2" PORT_CHECK_CMD=false sh "$SCRIPT" init; }
run_init "$WORK/first" "$WORK/first.env" >/dev/null
first_slot=$(get_slot_placeholder=1; awk -F= '$1 == "WORKTREE_SLOT" { print $2 }' "$WORK/first.env")
run_init "$WORK/first" "$WORK/first.env" >/dev/null
run_init "$WORK/second" "$WORK/second.env" >/dev/null
get() { awk -F= -v key="$2" '$1 == key { print substr($0, index($0, "=") + 1) }' "$1"; }
check "fresh init creates env" "$( [ -f "$WORK/first.env" ] && echo expected || echo missing )"
check "fresh init derives selected web URL" "$( [ "$(get "$WORK/first.env" AUTH_URL)" = "http://localhost:$(get "$WORK/first.env" WEB_HOST_PORT)" ] && echo expected || echo wrong )"
check "fresh init allocates an API port" "$( [ -n "$(get "$WORK/first.env" API_HOST_PORT)" ] && echo expected || echo missing )"
check "same path keeps slot" "$( [ "$first_slot" = "$(get "$WORK/first.env" WORKTREE_SLOT)" ] && echo expected || echo changed )"
check "different paths get project names" "$( [ "$(get "$WORK/first.env" COMPOSE_PROJECT_NAME)" != "$(get "$WORK/second.env" COMPOSE_PROJECT_NAME)" ] && echo expected || echo same )"
check "API dev command uses allocated port" "$( grep -q 'API_HOST_PORT:-3001' "$ROOT/package.json" && echo expected || echo missing )"
check "web dev command does not hard-code port" "$( ! grep -q -- '--port 3000' "$ROOT/apps/web/package.json" && echo expected || echo hard-coded )"
check "host commands use published database port" "$( [ "$(grep -c 'DB_PORT="\$host_db_port"' "$SCRIPT")" = 2 ] && ! grep -q 'DB_PORT="\$(read_var DB_HOST_PORT)"' "$SCRIPT" && echo expected || echo wrong )"

check "dev setup uses canonical bootstrap credentials" "$( grep -q 'BOOTSTRAP_ADMIN_EMAIL="\$BOOTSTRAP_ADMIN_EMAIL"' "$SCRIPT" && grep -q 'BOOTSTRAP_ADMIN_PASSWORD="\$BOOTSTRAP_ADMIN_PASSWORD"' "$SCRIPT" && ! grep -q 'DEV_SEED_USER_' "$SCRIPT" && echo expected || echo wrong )"
check "setup cleans legacy server state" "$( grep -q 'LEGACY_DEV_STATE_DIR' "$SCRIPT" && echo expected || echo missing )"
check "web dev command targets allocated API" "$( grep -q 'NEXT_PUBLIC_API_URL=http://localhost:\$api_port' "$SCRIPT" && echo expected || echo missing )"
check "auth cookies are isolated per worktree" "$( grep -q 'cookieSuffix' "$ROOT/apps/web/auth.ts" && echo expected || echo missing )"

printf 'DB_PASSWORD=my-password\nAUTH_URL=http://custom.example\n' >"$WORK/preserved.env"
WORKTREE_DIR="$WORK/first" REPO_ROOT="$ROOT" ENV_FILE="$WORK/preserved.env" PORT_CHECK_CMD=false sh "$SCRIPT" init >/dev/null
check "existing user secret preserved" "$( [ "$(get "$WORK/preserved.env" DB_PASSWORD)" = my-password ] && echo expected || echo overwritten )"
check "existing user URL preserved" "$( [ "$(get "$WORK/preserved.env" AUTH_URL)" = http://custom.example ] && echo expected || echo overwritten )"

printf 'WORKTREE_SLOT=7\nAUTH_URL=http://localhost:3000\n' >"$WORK/stale-derived.env"
WORKTREE_DIR="$WORK/first" REPO_ROOT="$ROOT" ENV_FILE="$WORK/stale-derived.env" PORT_CHECK_CMD=false sh "$SCRIPT" init >/dev/null
check "stale generated URL follows allocated port" "$( [ "$(get "$WORK/stale-derived.env" AUTH_URL)" = "http://localhost:3070" ] && echo expected || echo stale )"

status_output=$(PATH="$WORK/bin:$PATH" WORKTREE_DIR="$WORK/first" REPO_ROOT="$ROOT" ENV_FILE="$WORK/first.env" PORT_CHECK_CMD=false sh "$SCRIPT" status)
check "status displays web URL" "$( printf '%s\n' "$status_output" | grep -q "web: http://localhost:$(get "$WORK/first.env" WEB_HOST_PORT)" && echo expected || echo missing )"
check "status displays Keycloak URL on its own line" "$( printf '%s\n' "$status_output" | grep -qx "keycloak: http://localhost:$(get "$WORK/first.env" KEYCLOAK_HOST_PORT)" && echo expected || echo missing )"

if WORKTREE_DIR="$WORK/first" REPO_ROOT="$ROOT" ENV_FILE="$WORK/conflict.env" WORKTREE_SLOT_COUNT=1 PORT_CHECK_CMD='test "$1" = 3000' sh "$SCRIPT" init >/dev/null 2>&1; then result=accepted; else result=expected; fi
check "occupied port block is rejected" "$result"

onboarding_env="$WORK/onboarding.env"
PATH="$WORK/bin:$PATH" WORKTREE_DIR="$WORK/first" REPO_ROOT="$ROOT" ENV_FILE="$onboarding_env" PORT_CHECK_CMD=false sh "$SCRIPT" setup >/dev/null 2>&1 || true
check "unconfigured Infisical does not populate BGG token" "$( [ -z "$(get "$onboarding_env" BGG_API_TOKEN)" ] && echo expected || echo corrupted )"

configured_env="$WORK/configured.env"
INFISICAL_TEST_MODE=configured PATH="$WORK/bin:$PATH" WORKTREE_DIR="$WORK/first" REPO_ROOT="$ROOT" ENV_FILE="$configured_env" PORT_CHECK_CMD=false sh "$SCRIPT" setup >/dev/null 2>&1 || true
check "configured Infisical populates BGG token" "$( [ "$(get "$configured_env" BGG_API_TOKEN)" = test-token ] && echo expected || echo missing )"

[ "$failures" -eq 0 ] || exit 1
printf '\nall tests passed\n'
