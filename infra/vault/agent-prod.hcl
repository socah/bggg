# Production variant of agent.hcl — same job (authenticate, then render
# secret/data/bggg/db's password to a file 'db' reads), different auth
# method. This is exactly the swap agent.hcl's own comment already called
# out: "A real deployment (Phase 4) would swap this whole 'method' block
# for 'approle' instead — the 'template' block below wouldn't change at
# all, since it only cares that Agent is authenticated, not how."

vault {
  address = "http://vault:8200"
}

auto_auth {
  method "approle" {
    config = {
      # Both files are written by Ansible (see tasks/main.yml's 'Deliver
      # Vault Agent's AppRole credentials' task) from
      # vault_agent_role_id/vault_agent_secret_id — themselves sourced from
      # Infisical, generated once by infra/vault/bootstrap-prod-init.sh
      # against the 'vault-agent' AppRole role (policies/vault-agent.hcl).
      role_id_file_path = "/vault/approle/role_id"
      secret_id_file_path = "/vault/approle/secret_id"
      # false, deliberately, and this took a reboot walkthrough to catch:
      # this path is a bind mount from a host file
      # (/etc/bggg/vault-agent-secret_id, see docker-compose.prod.yml), not
      # an in-container copy. 'true' deletes straight through the bind
      # mount to the actual host file — fine for a genuinely single-use
      # secret_id, but bootstrap-prod-init.sh creates this one with
      # secret_id_ttl=0 and no num_uses limit specifically so it survives
      # container restarts and VM reboots. Deleting it after the first
      # login would strand every restart after that with no secret_id file
      # to read at all.
      remove_secret_id_file_after_reading = false
    }
  }
}

template {
  # Identical to agent.hcl's dev version — Agent's template rendering
  # doesn't know or care which auto_auth method got it authenticated.
  contents = <<EOT
{{- with secret "secret/data/bggg/db" -}}
{{ .Data.data.password }}
{{- end -}}
EOT

  destination = "/vault/secrets/db_password"
}
