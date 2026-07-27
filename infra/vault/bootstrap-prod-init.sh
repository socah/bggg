#!/bin/sh
set -eu

# Run this ONCE, by a human, after the very first prod deploy brings up a
# fresh (uninitialized, sealed) Vault container — never by Ansible, and
# never on every deploy the way bootstrap-prod.sh runs. Initializing Vault,
# and minting AppRole credentials, are exactly the kind of operations that
# should happen in front of a human's eyes, not silently inside an
# unattended pipeline — this whole topic (notes/4_environments.md) exists
# because concentrating trust in one automated place is the thing to avoid.
#
# How to run it: SSH into the app server, then —
#   cd /opt/bggg
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml \
#     exec vault sh < infra/vault/bootstrap-prod-init.sh
# 'exec' reaches the already-running 'vault' container directly over the
# SSH session you already have — no port needs to be published anywhere,
# no separate SSH tunnel required.

echo "=== Step 1: vault operator init (skip if already initialized) ==="
if vault status 2>/dev/null | grep -q "Initialized.*true"; then
  echo "Vault is already initialized — skipping init. If you need to redo"
  echo "AppRole setup only, re-run from Step 2 by hand."
else
  echo "Running 'vault operator init'. This prints recovery keys and an"
  echo "initial root token ONCE — nothing else, including this script,"
  echo "will ever show them to you again."
  echo
  echo ">>> STOP: copy every line of the following output into a"
  echo ">>> password manager or other secure offline storage NOW."
  echo ">>> Do NOT put these in Infisical, git, or any file on this VM."
  echo
  vault operator init
  echo
  echo "Press Enter once you have saved the above somewhere secure."
  # A deliberate manual pause, not a fixed sleep — this genuinely waits on
  # the human, since there's no way to verify "did you actually save that"
  # from inside a script.
  read -r _
fi

echo "=== Step 2: enable AppRole auth (skip if already enabled) ==="
if vault auth list -format=json | grep -q '"approle/"'; then
  echo "approle auth already enabled — skipping."
else
  vault auth enable approle
fi

echo "=== Step 3: write policies ==="
# These two files are already on the box (part of the git checkout at
# /opt/bggg) — no need to paste their contents by hand.
vault policy write vault-agent /opt/bggg/infra/vault/policies/vault-agent.hcl
vault policy write vault-bootstrap /opt/bggg/infra/vault/policies/vault-bootstrap.hcl

echo "=== Step 4: create AppRole roles bound to those policies ==="
# secret_id_ttl/token_ttl are deliberately short-ish and renewable via
# Agent's own lease-renewal behavior (see agent-prod.hcl) rather than long
# — the smaller the window a stolen secret_id or token stays valid, the
# less it's worth stealing.
vault write auth/approle/role/vault-agent \
  token_policies="vault-agent" \
  token_ttl=1h \
  token_max_ttl=4h \
  secret_id_ttl=0

vault write auth/approle/role/vault-bootstrap \
  token_policies="vault-bootstrap" \
  token_ttl=15m \
  token_max_ttl=1h \
  secret_id_ttl=0

echo "=== Step 5: read back role_id / generate secret_id for each role ==="
echo
echo ">>> Copy these four values into Infisical's /ENV_VARS, under these"
echo ">>> exact names (see infra/ansible/roles/app_deploy/defaults/main.yml):"
echo ">>>   VAULT_AGENT_ROLE_ID, VAULT_AGENT_SECRET_ID,"
echo ">>>   VAULT_BOOTSTRAP_ROLE_ID, VAULT_BOOTSTRAP_SECRET_ID"
echo

echo "--- vault-agent ---"
echo "VAULT_AGENT_ROLE_ID=$(vault read -field=role_id auth/approle/role/vault-agent/role-id)"
echo "VAULT_AGENT_SECRET_ID=$(vault write -f -field=secret_id auth/approle/role/vault-agent/secret-id)"

echo "--- vault-bootstrap ---"
echo "VAULT_BOOTSTRAP_ROLE_ID=$(vault read -field=role_id auth/approle/role/vault-bootstrap/role-id)"
echo "VAULT_BOOTSTRAP_SECRET_ID=$(vault write -f -field=secret_id auth/approle/role/vault-bootstrap/secret-id)"

echo
echo "=== Done. Store the four values above in Infisical, then re-run"
echo "'ansible-playbook' so it can deliver them to vault-agent/vault-bootstrap. ==="
