#!/bin/sh
# Keeps the two Keycloak client secrets in .env in sync with what the realm
# actually generated. Keycloak creates random secrets for the confidential
# 'web' and 'api-service' clients on first import (deliberately not committed
# anywhere — see boardgame-realm.json); without them the web app's OIDC
# exchange fails outright and dev:api can't administer users, so 'make
# dev-setup' runs this before starting the servers.
#
# Runs on the HOST (it edits .env) and reaches kcadm through a docker compose
# exec — the same trick seed-dev-user.sh uses inside the container.
set -eu

ENV_FILE="${ENV_FILE:-.env}"
# Word-splitting is intentional: EXEC_CMD carries multiple words by design.
# shellcheck disable=SC2086
EXEC_CMD=${EXEC_CMD:-docker compose exec -T keycloak}

env_value() {
  awk -F= -v key="$1" '$1 == key { value=substr($0, index($0, "=") + 1) } END { print value }' "$ENV_FILE"
}

kcadm() {
  $EXEC_CMD /opt/keycloak/bin/kcadm.sh "$@"
}

fetch_secret() { # $1=clientId
  # kcadm pretty-prints; strip whitespace, then pull "secret":"..." — same
  # parsing approach seed-dev-user.sh uses for ids.
  json=$(kcadm get clients -r boardgame -q "clientId=$1" --fields secret 2>/dev/null || true)
  json=$(printf '%s' "$json" | tr -d ' \t\n\r')
  case "$json" in
    *'"secret"'*)
      val=${json#*'"secret":"'}
      printf '%s' "${val%%\"*}"
      ;;
    *)
      echo "sync-dev-secrets: could not read secret for client '$1' — is the stack up? ('make deploy-dev')" >&2
      return 1
      ;;
  esac
}

upsert() { # $1=var $2=value
  current=$(grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true)
  if [ "$current" = "$2" ]; then
    echo "$1: unchanged"
    return 0
  fi
  # Portable rewrite (GNU/BSD sed -i disagree): drop every existing line for
  # this var, append the canonical one. Line order in .env carries no
  # meaning, so repositioning to the end is safe.
  grep -vE "^$1=" "$ENV_FILE" >"$ENV_FILE.tmp" || true
  printf '%s=%s\n' "$1" "$2" >>"$ENV_FILE.tmp"
  mv "$ENV_FILE.tmp" "$ENV_FILE"
  if [ -z "$current" ]; then
    echo "$1: set"
  else
    echo "$1: updated (was stale)"
  fi
}

[ -f "$ENV_FILE" ] || {
  echo "sync-dev-secrets: $ENV_FILE not found — run 'cp .env.example .env' first" >&2
  exit 1
}

admin_user=${KEYCLOAK_ADMIN_USER:-$(env_value KEYCLOAK_ADMIN_USER)}
admin_password=${KEYCLOAK_ADMIN_PASSWORD:-$(env_value KEYCLOAK_ADMIN_PASSWORD)}
admin_user=${admin_user:-admin}
admin_password=${admin_password:-admin}

if ! kcadm config credentials \
    --server "${KEYCLOAK_KCADM_SERVER:-http://localhost:8080}" \
    --realm master --user "$admin_user" --password "$admin_password" >/dev/null 2>&1; then
  echo "sync-dev-secrets: could not authenticate to Keycloak — is the stack ready?" >&2
  exit 1
fi

web_secret=$(fetch_secret web)
api_secret=$(fetch_secret api-service)

web_client_id=$(kcadm get clients -r boardgame -q clientId=web --fields id 2>/dev/null \
  | tr -d ' \t\n\r' \
  | sed 's/.*"id":"//; s/".*//')
[ -n "$web_client_id" ] || {
  echo "sync-dev-secrets: could not find client 'web' — is the realm imported?" >&2
  exit 1
}
web_port=${WEB_HOST_PORT:-3000}
kcadm update "clients/$web_client_id" -r boardgame \
  -s "redirectUris=[\"http://localhost:$web_port/*\",\"https://bggg.duckdns.org/*\"]" \
  -s "webOrigins=[\"http://localhost:$web_port\",\"https://bggg.duckdns.org\"]" >/dev/null

upsert AUTH_KEYCLOAK_SECRET "$web_secret"
upsert KEYCLOAK_API_SERVICE_SECRET "$api_secret"
