#!/bin/sh
# Unit tests for seed-dev-user.sh — no Docker or Keycloak required.
#
# The script under test talks to Keycloak exclusively through kcadm.sh, whose
# path is overridable via KCADM_BIN. Each test points that at a stub that
# records every invocation to a log file and simulates one scenario (auth
# failing N times before succeeding, user existing or not), then asserts on
# the recorded call sequence — the same way the TS suite swaps in mockable
# HttpService clients.
#
# Run: sh infra/keycloak/seed-dev-user.test.sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SCRIPT="$SCRIPT_DIR/seed-dev-user.sh"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
CALL_LOG="$WORK/calls.log"
STUB="$WORK/kcadm.sh"

failures=0

# Writes the fake kcadm.sh. Behavior knobs come from the environment at run
# time (they must be exported by whoever runs the script under test):
#   AUTH_FAILS     number of 'config credentials' calls to reject first
#   EXISTING_JSON  JSON returned by 'get users' once the user exists
# The stub is stateful in exactly one way: after a logged 'create', 'get'
# reports the user as existing even if EXISTING_JSON was empty — mirroring
# real Keycloak, where a created user immediately shows up in queries.
cat > "$STUB" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "${CALL_LOG:?}"
case "$1" in
  config)
    if [ "${AUTH_FAILS:-0}" -gt 0 ]; then
      AUTH_FAILS=$((AUTH_FAILS - 1))
      export AUTH_FAILS
      echo "connection refused" >&2
      exit 1
    fi
    ;;
  get)
    if [ -n "${EXISTING_JSON:-}" ]; then
      printf '%s' "$EXISTING_JSON"
    elif grep -q '^create ' "$CALL_LOG" 2>/dev/null; then
      printf '[ {\n  "username" : "user",\n  "id" : "stub-user-id"\n} ]'
    else
      printf '[ ]'
    fi
    ;;
esac
exit 0
EOF
chmod +x "$STUB"

assert_eq() {
  if [ "$1" = "$2" ]; then
    printf 'ok   %s\n' "$3"
  else
    failures=$((failures + 1))
    printf 'FAIL %s\n     expected: [%s]\n     actual:   [%s]\n' "$3" "$2" "$1"
  fi
}

assert_contains() {
  case "$1" in
    *"$2"*) printf 'ok   %s\n' "$3" ;;
    *)
      failures=$((failures + 1))
      printf 'FAIL %s\n     [%s] does not contain [%s]\n' "$3" "$1" "$2"
      ;;
  esac
}

run_seed() {
  CALL_LOG="$1" AUTH_FAILS="${2:-0}" EXISTING_JSON="${3:-}" \
  KC_BOOTSTRAP_ADMIN_USERNAME=dev-admin KC_BOOTSTRAP_ADMIN_PASSWORD=dev-secret \
  KCADM_BIN="$STUB" SEED_WAIT_ATTEMPTS="${4:-3}" SEED_WAIT_SLEEP=0 \
  sh "$SCRIPT"
}

# Test 1: fresh realm — user absent, so the script creates it (enabled) and
# resets its password, using the bootstrap admin credentials from its env.
out=$(run_seed "$WORK/t1.log")
calls=$(cat "$WORK/t1.log")
create_count=$(grep -c '^create users' "$WORK/t1.log" || true)
setpw_count=$(grep -c '^set-password' "$WORK/t1.log" || true)
assert_eq "$create_count" "1" "fresh: creates the user exactly once"
assert_contains "$calls" "-s username=user" "fresh: create targets username 'user'"
assert_contains "$calls" "-s enabled=true" "fresh: create enables the user"
assert_eq "$setpw_count" "1" "fresh: sets the password exactly once"
assert_contains "$calls" "--new-password user" "fresh: password is 'user'"
assert_contains "$calls" "--userid stub-user-id" "fresh: password set on the created user's id"
assert_contains "$calls" "--realm master --user dev-admin" "auth: uses KC_BOOTSTRAP_ADMIN_USERNAME from env"

# Test 2: user already exists — no second create, but the password is still
# reset so stale passwords can't lock a dev machine out. JSON here (and in
# the stub's post-create reply above) mirrors kcadm's real pretty-printed
# output — the first implementation parsed only compact JSON and passed the
# literal spaces into --userid, which only showed up against live Keycloak.
run_seed "$WORK/t2.log" 0 '[ {
  "id" : "existing-id"
} ]' >/dev/null
create_count=$(grep -c '^create users' "$WORK/t2.log" || true)
setpw_count=$(grep -c '^set-password' "$WORK/t2.log" || true)
assert_eq "$create_count" "0" "idempotent: does not recreate an existing user"
assert_eq "$setpw_count" "1" "idempotent: still resets the password"
assert_contains "$(cat "$WORK/t2.log")" "--userid existing-id" \
  "idempotent: resets password on the found user's id"

# Test 3: Keycloak never comes up — bounded retries, then a loud failure with
# nothing half-done.
if out=$(run_seed "$WORK/t3.log" 9999 '' 2); then
  failures=$((failures + 1))
  printf 'FAIL timeout: exits nonzero when Keycloak never accepts admin login\n'
else
  printf 'ok   timeout: exits nonzero when Keycloak never accepts admin login\n'
fi
if [ -f "$WORK/t3.log" ] && grep -q '^create\|^set-password' "$WORK/t3.log"; then
  failures=$((failures + 1))
  printf 'FAIL timeout: no user mutations attempted before Keycloak was ready\n'
else
  printf 'ok   timeout: no user mutations attempted before Keycloak was ready\n'
fi

if [ "$failures" -gt 0 ]; then
  printf '\n%s test(s) failed\n' "$failures"
  exit 1
fi
printf '\nall tests passed\n'
