# Vault Agent's own config — separate from anything the app or Vault server
# itself reads. Two jobs live here: how Agent authenticates to Vault
# (auto_auth), and what it renders once authenticated (template).

vault {
  address = "http://vault:8200"
}

auto_auth {
  method "token_file" {
    config = {
      # Written by agent-entrypoint.sh before this process starts. A real
      # deployment (Phase 4) would swap this whole 'method' block for
      # "approle" instead — the 'template' block below wouldn't change at
      # all, since it only cares that Agent is authenticated, not how.
      token_file_path = "/vault/token/.token"
    }
  }
}

template {
  # KV v2's HTTP API nests the actual payload under 'data' twice: once for
  # the KV v2 mount's own versioning wrapper, once for the field names you
  # wrote. 'secret/data/bggg/db' is that same wrapper the CLI hides from you
  # when you run 'vault kv put secret/bggg/db ...'.
  contents = <<EOT
{{- with secret "secret/data/bggg/db" -}}
{{ .Data.data.password }}
{{- end -}}
EOT

  # This file lands in the 'vault_secrets' volume, which only the 'db'
  # service also mounts — 'vault_token' (the auth token from auto_auth
  # above) is a separate volume nothing else can read.
  destination = "/vault/secrets/db_password"
}
