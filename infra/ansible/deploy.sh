#!/usr/bin/env bash
set -euo pipefail

# One command for a normal deploy: pulls the four Vault AppRole values and
# the DuckDNS token (and everything else under Infisical's /ENV_VARS) into
# this shell, then runs ansible-playbook with them already filled in via
# '-e'. Without this, every deploy meant manually re-typing (or
# copy-pasting) those values by hand — see roles/app_deploy/defaults/main.yml
# and roles/duckdns/defaults/main.yml's own comments for why each has no
# default and must come from '-e' every time: the four Vault values only
# exist after infra/vault/bootstrap-prod-init.sh has been run once, by
# hand; duckdns_token is a long-lived credential that can't live in git.
#
# Also used by .github/workflows/ci.yml's 'deploy' job — same required
# values, same '-e' flags, so that list only needs maintaining in one
# place (this file), not kept in sync by hand across a shell script and a
# YAML workflow. CI supplies vault_kms_key_id/crypto_endpoint/
# management_endpoint (Terraform outputs it already read as a separate
# step) as extra args via "$@" below, rather than as env vars like the
# rest — those three are Ansible variables, not something a Vault
# AppRole/DuckDNS credential model fits.
#
# Usage: infra/ansible/deploy.sh [extra ansible-playbook args...]
# Extra args are forwarded as-is, e.g.:
#   infra/ansible/deploy.sh -e app_deploy_source=local
#
# Bash, not '/bin/sh', deliberately: needs BASH_SOURCE (below) and the
# same of import-secrets.sh itself, which this sources.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$SCRIPT_DIR/inventory.ini" ]; then
  echo "inventory.ini not found — run infra/ansible/generate_inventory.sh first." >&2
  exit 1
fi

# Sourced only when at least one required value isn't already in this
# shell's environment — CI's 'deploy' job fetches the exact same
# /ENV_VARS path a different way (the Infisical GitHub Action, not the
# CLI), so on a runner every one of these is already exported before this
# script ever runs. import-secrets.sh assumes an interactive 'infisical'
# CLI login (see its own header) — calling it unconditionally would mean
# a runner with no 'infisical' binary at all fails here for no reason,
# atop work already done. Sourced, not run as a separate process, when it
# does run: its own exports (VAULT_AGENT_ROLE_ID and friends) need to land
# in *this* script's environment so the ansible-playbook invocation below
# can read them. This still works from inside a script, not just an
# interactive shell: import-secrets.sh's sourced-vs-executed check
# compares BASH_SOURCE (itself) against $0 (this script, unchanged by
# 'source'), which still differ here even though nothing is typed at a
# prompt.
if [ -z "${VAULT_AGENT_ROLE_ID:-}" ] || [ -z "${VAULT_AGENT_SECRET_ID:-}" ] ||
   [ -z "${VAULT_BOOTSTRAP_ROLE_ID:-}" ] || [ -z "${VAULT_BOOTSTRAP_SECRET_ID:-}" ] ||
   [ -z "${DUCKDNS_TOKEN:-}" ]; then
  # shellcheck source=../scripts/import-secrets.sh
  source "$SCRIPT_DIR/../scripts/import-secrets.sh"
fi

for var in VAULT_AGENT_ROLE_ID VAULT_AGENT_SECRET_ID VAULT_BOOTSTRAP_ROLE_ID VAULT_BOOTSTRAP_SECRET_ID; do
  if [ -z "${!var:-}" ]; then
    echo "$var isn't set in Infisical's /ENV_VARS." >&2
    echo "Run infra/vault/bootstrap-prod-init.sh once (by hand, see its own header) and store its Step 5 output there first." >&2
    exit 1
  fi
done

if [ -z "${DUCKDNS_TOKEN:-}" ]; then
  echo "DUCKDNS_TOKEN isn't set in Infisical's /ENV_VARS — add it there (see roles/duckdns/defaults/main.yml)." >&2
  exit 1
fi

ansible-playbook -i "$SCRIPT_DIR/inventory.ini" "$SCRIPT_DIR/playbook.yml" \
  -e vault_agent_role_id="$VAULT_AGENT_ROLE_ID" \
  -e vault_agent_secret_id="$VAULT_AGENT_SECRET_ID" \
  -e vault_bootstrap_role_id="$VAULT_BOOTSTRAP_ROLE_ID" \
  -e vault_bootstrap_secret_id="$VAULT_BOOTSTRAP_SECRET_ID" \
  -e duckdns_token="$DUCKDNS_TOKEN" \
  "$@"
