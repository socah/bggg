# Policy attached to the 'vault-bootstrap' AppRole role (created once by
# bootstrap-prod-init.sh). 'read' is required alongside 'create'/'update':
# bootstrap-prod.sh's idempotency guard ('vault kv get secret/bggg/db',
# see its own comment for why) needs to read this same path before
# deciding whether to write it — same reasoning as vault-agent.hcl, scoped
# to exactly the one path this container ever touches.
path "secret/data/bggg/db" {
  capabilities = ["read", "create", "update"]
}
