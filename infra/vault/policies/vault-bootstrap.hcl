# Policy attached to the 'vault-bootstrap' AppRole role (created once by
# bootstrap-prod-init.sh). 'read' is required alongside 'create'/'update':
# bootstrap-prod.sh's idempotency guard ('vault kv get secret/bggg/db',
# see its own comment for why) needs to read this same path before
# deciding whether to write it — same reasoning as vault-agent.hcl, scoped
# to exactly the one path this container ever touches.
path "secret/data/bggg/db" {
  capabilities = ["read", "create", "update"]
}

# 'vault kv get'/'vault kv put' (both used in bootstrap-prod.sh) aren't
# thin wrappers over the raw API — before touching the actual secret, the
# CLI itself first calls GET sys/internal/ui/mounts/<path> to detect
# whether the mount is KV v1 or v2, so it knows whether to add the
# 'data/' segment for you. That preflight call is a genuinely separate,
# unauthenticated-by-default request needing its own capability — without
# it, both commands fail with "preflight capability check returned 403"
# before ever reaching secret/data/bggg/db above, even though that path's
# own capabilities are already correct. vault-agent.hcl doesn't need this:
# agent-prod.hcl's template block reads the raw 'secret/data/bggg/db' API
# path directly, bypassing the CLI helper (and its preflight) entirely.
# 'read' alone isn't enough here, verified empirically (not assumed):
# 'vault token capabilities' reported 'read' as granted and correct, yet
# the live 'vault kv get/put' call still 403'd on this exact path. 'sys/
# internal/ui/mounts/*' is one of Vault's root-protected paths — those
# enforce a 'sudo' capability check on top of whatever plain
# read/write ACL capability is listed, which 'token capabilities' doesn't
# surface (it only resolves what the policy grants, not whether that's
# actually sufficient for a protected path).
path "sys/internal/ui/mounts/secret/bggg/db" {
  capabilities = ["read", "sudo"]
}
