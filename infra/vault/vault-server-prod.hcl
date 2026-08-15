# Vault SERVER config for production — NOT Vault Agent's config (that's
# agent-prod.hcl, a separate process this same image also runs, in a
# separate container). Dev mode needs no file like this at all —
# VAULT_DEV_ROOT_TOKEN_ID alone tells the image to auto-launch
# 'vault server -dev' with everything in memory. Real 'vault server' has no
# such shortcut: storage and how to reach it must be spelled out explicitly.
#
# A plain static file (not a Jinja2 .j2 template, unlike an earlier version
# of this file) — bind-mounted directly from the git checkout, same as
# agent-prod.hcl. The seal config that used to live here as
# '{{ vault_kms_key_id }}'-style placeholders moved to environment
# variables on docker-compose.prod.yml's 'vault' service instead (see that
# file's comment for why): HashiCorp's own support docs document a parsing
# bug for 'key_id' specifically inside a 'seal "ocikms" { ... }' config-file
# block, observed here as a reproducible "more than one enabled seal found"
# error on every single startup attempt, even against a freshly wiped raft
# volume. The env-var path (VAULT_OCIKMS_SEAL_KEY_ID and friends) sidesteps
# that parser entirely.

storage "raft" {
  path    = "/vault/data"
  node_id = "bggg-vault-node-1"
}

listener "tcp" {
  address = "0.0.0.0:8200"
  # Decision: TLS disabled at Vault's own listener, not left as a gap by
  # omission. Because: nothing outside this Docker network ever talks to
  # Vault directly — no 'ports:' entry publishes 8200 anywhere (same
  # internal-only reasoning as 'db'), so the only callers are vault-agent
  # and vault-bootstrap, sibling containers on the same isolated bridge
  # network. TLS between containers on a network nothing external can join
  # adds encryption overhead without a real threat here for it to defend
  # against.
  tls_disable = true
}

# Raft needs to know its own address to talk to other raft peers. With a
# single node this is purely self-referential, but the stanza is required
# regardless of cluster size — Vault won't start without it.
api_addr     = "http://vault:8200"
cluster_addr = "http://vault:8201"

# No 'seal "ocikms" { ... }' block here — see the file header comment and
# docker-compose.prod.yml's 'vault' service for where that config actually
# lives now (VAULT_SEAL_TYPE/VAULT_OCIKMS_* environment variables).
# auth_type_api_key has no documented env var equivalent, but its default
# (false — instance principal auth, not an OCI API key credential) is
# already what this project wants; infra/terraform/vault.tf's dynamic
# group + policy are what actually authorize this VM to use the key.

ui = true
