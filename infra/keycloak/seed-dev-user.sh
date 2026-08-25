#!/bin/sh
# Seeds the throwaway dev login (username 'user', password 'user') by driving
# kcadm.sh inside the keycloak container — mounted and invoked via 'make
# seed-user' / 'make dev-setup' (see docker-compose.dev.yml). Deliberately NOT
# a users entry in boardgame-realm.json: that file is imported by prod too,
# and realm imports only apply on first boot anyway. Idempotent: safe to
# re-run against an existing realm/volume at any time.
set -eu

KCADM="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
SERVER="${SEED_SERVER:-http://localhost:8080}"
REALM="${SEED_REALM:-boardgame}"
USERNAME="${SEED_USERNAME:-user}"
PASSWORD="${SEED_PASSWORD:-user}"
# start-dev cold boots in ~10-30s; 'make dev-setup' runs this immediately
# after 'docker compose up -d --build' returns, so bounded waiting is part of
# the job. Overridable so the test harness can shrink it.
ATTEMPTS="${SEED_WAIT_ATTEMPTS:-60}"
SLEEP_SECONDS="${SEED_WAIT_SLEEP:-2}"

i=0
until "$KCADM" config credentials \
    --server "$SERVER" \
    --realm master \
    --user "$KC_BOOTSTRAP_ADMIN_USERNAME" \
    --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge "$ATTEMPTS" ]; then
    echo "seed-dev-user: Keycloak not ready after $ATTEMPTS attempts — is the stack up? ('make deploy-dev')" >&2
    exit 1
  fi
  sleep "$SLEEP_SECONDS"
done

find_user_id() {
  # Exact-match username search; no '"id"' in the output means no such user.
  # kcadm pretty-prints ("id" : "..."), so all whitespace is stripped before
  # parsing — the first version only handled compact JSON and fed the stray
  # spaces into --userid, which only surfaced against live Keycloak.
  json=$("$KCADM" get users -r "$REALM" \
      -q "username=$USERNAME" -q exact=true --fields id 2>/dev/null || true)
  json=$(printf '%s' "$json" | tr -d ' \t\n\r')
  case "$json" in
    *'"id"'*)
      id=${json#*'"id":"'}
      printf '%s' "${id%%\"*}"
      ;;
  esac
}

USER_ID=$(find_user_id)

if [ -z "$USER_ID" ]; then
  "$KCADM" create users -r "$REALM" \
      -s "username=$USERNAME" -s enabled=true >/dev/null
  USER_ID=$(find_user_id)
  if [ -z "$USER_ID" ]; then
    echo "seed-dev-user: created '$USERNAME' but could not read its id back" >&2
    exit 1
  fi
fi

# Unconditional reset (not just on creation): a previously seeded user whose
# password was changed through Keycloak's admin UI still ends up usable.
"$KCADM" set-password -r "$REALM" \
    --userid "$USER_ID" --new-password "$PASSWORD" >/dev/null

echo "Dev user ready — log in with username '$USERNAME' password '$PASSWORD'."
