#!/bin/sh
# Unit tests for sync-dev-secrets.sh — the docker/exec boundary is stubbed,
# so no Docker or Keycloak is needed. Focus: the .env upsert rules and
# parsing of kcadm's pretty-printed client JSON.
#
# Run: sh scripts/sync-dev-secrets.test.sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
UNDER_TEST="$SCRIPT_DIR/sync-dev-secrets.sh"

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

web_json='[ {
  "clientId" : "web",
  "secret" : "WEBSECRET123"
} ]'
api_json='[ {
  "clientId" : "api-service",
  "secret" : "APISECRET456"
} ]'

# Stub standing in for 'docker compose exec -T keycloak <kcadm args...>' —
# answers whichever client query it recognizes, like real kcadm would.
stub_exec() {
  EXEC_CMD="sh $WORK/fake-exec.sh" \
  ENV_FILE="$1" \
  WEB_JSON="$web_json" API_JSON="$api_json" \
  sh "$UNDER_TEST"
}

cat > "$WORK/fake-exec.sh" <<'EOF'
#!/bin/sh
case "$*" in
  *clientId=web*) printf '%s' "$WEB_JSON" ;;
  *clientId=api-service*) printf '%s' "$API_JSON" ;;
  *) printf 'unexpected query: %s\n' "$*" >&2; exit 1 ;;
esac
EOF

value_of() {
  grep -E "^$1=" "$1_PLACEHOLDER_ENV" 2>/dev/null | tail -n1 | cut -d= -f2-
}
# helper needs the env path; do it inline per call instead:
get_val() { # $1=file $2=var
  grep -E "^$2=" "$1" | tail -n1 | cut -d= -f2-
}

# --- 1: missing vars get appended ------------------------------------------
printf 'DB_NAME=bggg_dev\n' > "$WORK/env1"
stub_exec "$WORK/env1" >/dev/null
check "missing: AUTH_KEYCLOAK_SECRET appended" \
  "$( [ "$(get_val "$WORK/env1" AUTH_KEYCLOAK_SECRET)" = "WEBSECRET123" ] && echo expected || echo wrong)"
check "missing: KEYCLOAK_API_SERVICE_SECRET appended" \
  "$( [ "$(get_val "$WORK/env1" KEYCLOAK_API_SERVICE_SECRET)" = "APISECRET456" ] && echo expected || echo wrong)"
check "missing: existing unrelated lines preserved" \
  "$( [ "$(head -n1 "$WORK/env1")" = "DB_NAME=bggg_dev" ] && echo expected || echo wrong)"

# --- 2: empty values get filled --------------------------------------------
printf 'AUTH_KEYCLOAK_SECRET=\nKEYCLOAK_API_SERVICE_SECRET=\n' > "$WORK/env2"
stub_exec "$WORK/env2" >/dev/null
check "empty: AUTH_KEYCLOAK_SECRET filled" \
  "$( [ "$(get_val "$WORK/env2" AUTH_KEYCLOAK_SECRET)" = "WEBSECRET123" ] && echo expected || echo wrong)"
check "empty: no duplicate lines left behind" \
  "$( [ "$(grep -c '^AUTH_KEYCLOAK_SECRET=' "$WORK/env2")" = "1" ] && echo expected || echo wrong)"

# --- 3: different non-empty value gets updated (stale after realm reset) ---
printf 'AUTH_KEYCLOAK_SECRET=STALE\nKEYCLOAK_API_SERVICE_SECRET=STALE\n' > "$WORK/env3"
stub_exec "$WORK/env3" >/dev/null
check "stale: secrets overwritten with current value" \
  "$( [ "$(get_val "$WORK/env3" AUTH_KEYCLOAK_SECRET)" = "WEBSECRET123" ] && [ "$(get_val "$WORK/env3" KEYCLOAK_API_SERVICE_SECRET)" = "APISECRET456" ] && echo expected || echo wrong)"

# --- 4: already-correct values left byte-identical --------------------------
printf 'AUTH_KEYCLOAK_SECRET=WEBSECRET123\nKEYCLOAK_API_SERVICE_SECRET=APISECRET456\nKEEPME=yes\n' > "$WORK/env4"
cp "$WORK/env4" "$WORK/env4.before"
stub_exec "$WORK/env4" >/dev/null
check "current: file untouched when secret already matches" \
  "$( cmp -s "$WORK/env4" "$WORK/env4.before" && echo expected || echo changed )"

# --- 5: unreachable keycloak fails loudly ----------------------------------
EXEC_CMD="false" ENV_FILE="$WORK/env5" sh "$UNDER_TEST" >/dev/null 2>&1 &&
  check "unreachable: exits nonzero when exec fails" errored ||
  check "unreachable: exits nonzero when exec fails" expected

if [ "$failures" -gt 0 ]; then
  printf '\n%s test(s) failed\n' "$failures"
  exit 1
fi
printf '\nall tests passed\n'
