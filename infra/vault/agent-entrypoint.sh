#!/bin/sh
set -eu

# Vault Agent's 'token_file' auto_auth method only knows how to read a
# token from a file — it has no way to accept one directly from an
# environment variable. This entrypoint exists solely to bridge that gap:
# take the token Compose injected as VAULT_TOKEN and drop it where
# agent.hcl expects to find it, before handing off to the real process.
#
# This is a dev-only stand-in for a real auto_auth method (AppRole,
# Kubernetes, etc.) that would deliver a token to Agent without a human — or
# a docker-compose.dev.yml env var — ever holding it in one place. See
# notes/3_vault.md's SecOps section for why this is flagged for Phase 4.
echo -n "$VAULT_TOKEN" > /vault/token/.token

exec vault agent -config=/vault/config/agent.hcl
