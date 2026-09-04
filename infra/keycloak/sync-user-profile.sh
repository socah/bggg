#!/bin/sh
# Realm imports are ignored once a realm exists. Reconcile the versioned user
# profile through Keycloak's Admin API so upgrades also fix existing installs.
set -eu

KCADM="${KCADM_BIN:-/opt/keycloak/bin/kcadm.sh}"
SERVER="${PROFILE_SERVER:-http://localhost:8080}"
REALM="${PROFILE_REALM:-boardgame}"
PROFILE_FILE="${PROFILE_FILE:-/opt/keycloak/data/import/user-profile.json}"
ATTEMPTS="${PROFILE_WAIT_ATTEMPTS:-60}"
SLEEP_SECONDS="${PROFILE_WAIT_SLEEP:-2}"

i=0
until "$KCADM" config credentials \
    --server "$SERVER" --realm master \
    --user "$KC_BOOTSTRAP_ADMIN_USERNAME" \
    --password "$KC_BOOTSTRAP_ADMIN_PASSWORD" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge "$ATTEMPTS" ]; then
    echo "sync-user-profile: Keycloak not ready after $ATTEMPTS attempts" >&2
    exit 1
  fi
  sleep "$SLEEP_SECONDS"
done

"$KCADM" update users/profile -r "$REALM" -f "$PROFILE_FILE" >/dev/null
echo "Keycloak user profile synchronized — email and names are optional."
