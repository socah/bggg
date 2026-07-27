# Policy attached to the 'vault-agent' AppRole role (created once by
# bootstrap-prod-init.sh). Read-only, and only this one secret — Agent's
# job is rendering db_password to a file, nothing else, so it has no
# business holding a token that can read or write anything beyond this
# single path.
path "secret/data/bggg/db" {
  capabilities = ["read"]
}
