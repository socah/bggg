#!/bin/sh
set -eu

# Unlike bootstrap.sh's dev version — which only waits for Vault to be
# reachable, because dev mode is unsealed the instant it starts — prod
# Vault takes a real (if usually short) round trip to OCI KMS to
# auto-unseal on every boot. 'vault status' exits 0 only once it's
# genuinely unsealed; 2 means reachable but still sealed; anything else
# means it isn't up yet at all. Looping on exit code 0 specifically avoids
# racing a login attempt against a Vault that's technically listening but
# not yet able to authenticate anyone.
until vault status >/dev/null 2>&1; do
  echo "waiting for vault to unseal..."
  sleep 1
done

# AppRole login: exchange this role's role_id + secret_id for a real
# token, scoped to whatever policy the role was created with
# (policies/vault-bootstrap.hcl — read/create/update on exactly one path).
# Both files are delivered by Ansible from Infisical-sourced Ansible vars —
# see infra/ansible/roles/app_deploy/tasks/main.yml.
ROLE_ID=$(cat /vault/approle/role_id)
SECRET_ID=$(cat /vault/approle/secret_id)
VAULT_TOKEN=$(vault write -field=token auth/approle/login role_id="$ROLE_ID" secret_id="$SECRET_ID")
export VAULT_TOKEN

# Same guard as bootstrap.sh's dev version, same reasoning: Ansible hands
# this script a fresh random DB_PASSWORD on every single deploy run, but
# Postgres only reads its password file once, on first init. Overwriting
# an already-adopted password here would leave Vault holding a value
# Postgres was never actually given.
if vault kv get secret/bggg/db >/dev/null 2>&1; then
  echo "bootstrap skipped: secret/bggg/db already exists"
  exit 0
fi

vault kv put secret/bggg/db password="$DB_PASSWORD"

echo "bootstrap complete: secret/bggg/db written"
