#!/usr/bin/env bash
# Fetches the Keycloak-generated client secrets for 'api-service' and 'web'
# and writes them into .env. Both are intentionally blank in .env.example
# (see its own comments there) — the 'web'/'api-service' clients in
# infra/keycloak/boardgame-realm.json deliberately have no "secret" field,
# so Keycloak generates one on every --import-realm instead of one being
# committed to git in plaintext.
#
# This has to be a script, not a one-time manual step: Keycloak has no
# persistent volume in dev (see docs/reference/authentication-keycloak.md),
# so every 'docker compose down' + up re-imports the realm and generates
# BOTH secrets fresh — whatever was previously in .env goes stale the
# moment Keycloak's container is recreated, not just on the very first run.
#
# Run after Keycloak is confirmed ready (see Makefile's reset-dev), before
# anything that authenticates as either client (seed-admin.ts, 'api' itself).
#
# Usage: infra/scripts/fetch-keycloak-dev-secrets.sh

set -euo pipefail

cd "$(dirname "$0")/../.."

set -a
# shellcheck disable=SC1091
. ./.env
set +a

# Same container-name-vs-localhost split as everywhere else in this repo
# (KEYCLOAK_URL, DB_HOST, ...): this script runs on the host, never inside
# a container, so it needs localhost regardless of what .env's own
# KEYCLOAK_URL (the container-network value) says.
KEYCLOAK_URL="http://localhost:8080"
REALM="${KEYCLOAK_REALM:-boardgame}"

echo "Fetching Keycloak client secrets for the '$REALM' realm..."

ADMIN_TOKEN=$(curl -sf -X POST "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
  -d "grant_type=password" \
  -d "client_id=admin-cli" \
  -d "username=$KEYCLOAK_ADMIN_USER" \
  -d "password=$KEYCLOAK_ADMIN_PASSWORD" \
  | node -e "process.stdin.once('data', d => process.stdout.write(JSON.parse(d).access_token))") \
  || { echo "Could not authenticate to Keycloak as \$KEYCLOAK_ADMIN_USER — is the stack up?" >&2; exit 1; }

# Looks up a client by its clientId (e.g. 'api-service'), returning its
# generated secret. Keycloak's clients API only returns a client's own
# internal UUID by clientId, not its secret directly — the secret lives at
# a separate /client-secret sub-resource keyed by that UUID.
fetch_secret() {
  local client_id="$1"
  local internal_id
  internal_id=$(curl -sf "$KEYCLOAK_URL/admin/realms/$REALM/clients?clientId=$client_id" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    | node -e "process.stdin.once('data', d => { const c = JSON.parse(d)[0]; process.stdout.write(c ? c.id : ''); })")
  if [ -z "$internal_id" ]; then
    echo "No client named '$client_id' found in realm '$REALM'" >&2
    exit 1
  fi
  curl -sf "$KEYCLOAK_URL/admin/realms/$REALM/clients/$internal_id/client-secret" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    | node -e "process.stdin.once('data', d => process.stdout.write(JSON.parse(d).value))"
}

API_SERVICE_SECRET=$(fetch_secret api-service)
WEB_SECRET=$(fetch_secret web)

# In place, same two variables .env.example ships blank on purpose.
sed -i "s|^KEYCLOAK_API_SERVICE_SECRET=.*|KEYCLOAK_API_SERVICE_SECRET=$API_SERVICE_SECRET|" .env
sed -i "s|^AUTH_KEYCLOAK_SECRET=.*|AUTH_KEYCLOAK_SECRET=$WEB_SECRET|" .env

echo "Updated KEYCLOAK_API_SERVICE_SECRET and AUTH_KEYCLOAK_SECRET in .env."
