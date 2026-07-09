#!/bin/sh
set -eu

# Vault and this bootstrap container start concurrently under Compose — dev
# mode auto-unseals almost instantly, but there's no guarantee it's ready
# before this script's first command runs. A short retry loop avoids racing
# the network instead of guessing a fixed sleep duration.
until vault status >/dev/null 2>&1; do
  echo "waiting for vault..."
  sleep 1
done

# KV v2 is mounted at 'secret/' by default in dev mode. This is the same
# engine and path that infra/vault/agent.hcl reads from via
# 'secret/data/bggg/db' — the '/data/' segment is KV v2's own convention,
# not something we chose; the CLI hides it, the HTTP API (which templates
# use) does not.
vault kv put secret/bggg/db password="$DB_PASSWORD"

echo "bootstrap complete: secret/bggg/db written"
