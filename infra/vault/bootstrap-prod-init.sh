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
#     exec vault sh -c "$(cat infra/vault/bootstrap-prod-init.sh)"
# 'exec' reaches the already-running 'vault' container directly over the
# SSH session you already have — no port needs to be published anywhere,
# no separate SSH tunnel required. Passed via '-c' as a single argument
# (the host shell's own "$(cat ...)" reading the file once, literally —
# not re-interpreted, so every '$(...)' below still runs where it's meant
# to: inside the container), not piped over stdin with '< file' — piping
# it in consumes stdin for the script's own text, leaving nothing for
# Step 1's 'read' to wait on, and without '-T' to disable it, exec's
# default pseudo-TTY allocation then refuses to attach to a non-terminal
# stdin at all. This form leaves stdin (and the pseudo-TTY exec allocates
# by default) attached to your real terminal throughout, so Step 1's
# pause genuinely waits on you.

# The 'vault' CLI defaults to https://127.0.0.1:8200 when VAULT_ADDR isn't
# set — this container's own environment doesn't set it (only
# vault-agent/vault-bootstrap do, and only to the http://vault:8200
# service-DNS form, which isn't reachable from inside 'vault's own
# container as 127.0.0.1). vault-server-prod.hcl's listener has
# tls_disable = true, so the CLI needs telling explicitly to speak plain
# HTTP to itself, or every command below fails with "server gave HTTP
# response to HTTPS client".
export VAULT_ADDR=http://127.0.0.1:8200

echo "=== Step 1: vault operator init (skip if already initialized) ==="
if vault status 2>/dev/null | grep -q "Initialized.*true"; then
  echo "Vault is already initialized — skipping init."
  # No fresh root token to capture here (init already happened, possibly
  # in a previous, now-aborted run of this same script) — every command
  # from Step 2 on needs one, and there's no way to recover a lost token
  # short of another wipe/reinit. Fail loudly now, before a confusing
  # 403 further down, rather than let 'set -u' below crash on an unset var.
  if [ -z "${VAULT_TOKEN:-}" ]; then
    echo "VAULT_TOKEN isn't set. Re-run with the root token you saved" >&2
    echo "earlier, e.g.:" >&2
    echo "  docker compose ... exec -e VAULT_TOKEN=\"<root token>\" vault sh -c \"\$(cat infra/vault/bootstrap-prod-init.sh)\"" >&2
    exit 1
  fi
else
  echo "Running 'vault operator init'. This prints recovery keys and an"
  echo "initial root token ONCE — nothing else, including this script,"
  echo "will ever show them to you again."
  echo
  echo ">>> STOP: copy every line of the following output into a"
  echo ">>> password manager or other secure offline storage NOW."
  echo ">>> Do NOT put these in Infisical, git, or any file on this VM."
  echo
  # Captured, not just streamed straight to the terminal: Steps 2-5 all
  # need to authenticate as root, and 'vault operator init' only ever
  # prints the token — it doesn't log the CLI in the way 'vault login'
  # does. Parsed back out of the exact same text already shown above, not
  # a second API call.
  INIT_OUTPUT=$(vault operator init)
  echo "$INIT_OUTPUT"
  echo
  echo "Press Enter once you have saved the above somewhere secure."
  # A deliberate manual pause, not a fixed sleep — this genuinely waits on
  # the human, since there's no way to verify "did you actually save that"
  # from inside a script. Reading plain stdin (not stdin redirected from
  # this file) works correctly here specifically because the header's
  # invocation passes this script's contents via '-c', not '< file' —
  # stdin stays attached to your real terminal the whole time.
  read -r _
  VAULT_TOKEN=$(printf '%s\n' "$INIT_OUTPUT" | awk -F': ' '/^Initial Root Token/ {print $2}')
  export VAULT_TOKEN
fi

echo "=== Step 2: enable KV v2 secrets engine at secret/ (skip if already enabled) ==="
# Easy to miss because dev mode never needs this: docker-compose.dev.yml's
# 'vault' passes VAULT_DEV_ROOT_TOKEN_ID, which tells the image to launch
# 'vault server -dev' — and '-dev' mode auto-mounts a kv-v2 engine at
# 'secret/' for you as one of its convenience shortcuts. A real
# 'vault operator init' against real 'vault server' (this file's whole
# reason to exist) creates no default secrets engines at all. Without
# this step, every 'vault kv get/put secret/bggg/db' call below (and
# agent-prod.hcl's template block) 403s on Vault's own preflight mount
# lookup — a misleading error, since it reads like a missing capability
# even though the real problem is that the path doesn't exist yet at all.
if vault secrets list -format=json | grep -q '"secret/"'; then
  echo "secret/ already enabled — skipping."
else
  vault secrets enable -path=secret -version=2 kv
fi

echo "=== Step 3: enable AppRole auth (skip if already enabled) ==="
if vault auth list -format=json | grep -q '"approle/"'; then
  echo "approle auth already enabled — skipping."
else
  vault auth enable approle
fi

echo "=== Step 4: write policies ==="
# Read from /vault/policies, not /opt/bggg — this script runs inside the
# 'vault' container itself (see the header's 'docker compose exec'), which
# only has what docker-compose.prod.yml explicitly mounts into it, not the
# rest of the git checkout the way the host's /opt/bggg has.
vault policy write vault-agent /vault/policies/vault-agent.hcl
vault policy write vault-bootstrap /vault/policies/vault-bootstrap.hcl

echo "=== Step 5: create AppRole roles bound to those policies ==="
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

echo "=== Step 6: read back role_id / generate secret_id for each role ==="
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
