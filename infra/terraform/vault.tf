# OCI KMS backs Vault's auto-unseal (see infra/vault/vault.hcl's
# 'seal "ocikms"' stanza, added alongside this). Vault itself never stores
# its raw master key anywhere — only a ciphertext blob wrapping it. OCI KMS
# is the only thing that can turn that blob back into the real key, and it
# will only do that for a caller that is, cryptographically, this exact VM
# (instance principal) — not a copyable credential the way a token or
# client secret would be. See notes/4_environments.md for the full
# reasoning against storing raw Shamir unseal keys in Infisical instead.

resource "oci_kms_vault" "bggg" {
  compartment_id = var.oci_compartment_id
  display_name   = "bggg-vault"

  # Decision: DEFAULT (Standard), not VIRTUAL_PRIVATE. VIRTUAL_PRIVATE
  # dedicates an entire HSM partition to this tenancy alone — several
  # $/hour, a five-figure annual commitment, wildly out of scope for a
  # personal project. DEFAULT shares HSM partitions across OCI customers
  # (each customer's own keys stay isolated from every other customer's)
  # and is free to create.
  vault_type = "DEFAULT"
}

resource "oci_kms_key" "vault_unseal" {
  compartment_id      = var.oci_compartment_id
  display_name        = "bggg-vault-unseal-key"
  management_endpoint = oci_kms_vault.bggg.management_endpoint

  key_shape {
    algorithm = "AES"
    length    = 32 # AES-256
  }

  # Decision: SOFTWARE, not the HSM default (protection_mode can't be
  # changed after creation, so this has to be right from the start).
  # Because: Always Free's HSM-protected key versions come with a limited
  # monthly allowance; SOFTWARE-protected keys sidestep that limit
  # entirely, at the cost of a weaker guarantee — the key material lives on
  # OCI's servers behind the vault's own RSA wrapping key, not inside
  # dedicated HSM hardware for every operation.
  #
  # TODO(security): deliberate cost/security tradeoff for this project's
  # Always Free budget, not a free lunch. Revisit if this Vault instance
  # ever holds something more sensitive than a single Postgres password, or
  # if OCI's HSM-key-version free allowance turns out to comfortably cover
  # a single key (worth re-checking OCI's current pricing before assuming
  # this call still holds).
  protection_mode = "SOFTWARE"
}

# --- IAM: only this exact VM instance may decrypt this exact key ---

resource "oci_identity_dynamic_group" "vault_unseal" {
  # Dynamic groups only ever live in the tenancy (root) compartment — this
  # is an OCI-wide rule, not a project-specific choice. var.oci_compartment_id
  # (where the VM/vault/key actually live) would be rejected here.
  compartment_id = var.oci_tenancy_ocid
  name           = "bggg-vault-unseal-instance"
  description    = "Matches only the bggg app server VM — the one caller allowed to auto-unseal Vault"

  # Decision: match this exact instance OCID, not "any instance in this
  # compartment." This project runs exactly one VM (same one-VM assumption
  # infra/ansible/generate_inventory.sh already makes) — matching by
  # instance.id keeps the policy below as narrow as it can possibly be. A
  # compartment-wide match would silently hand this same access to any
  # future VM added to the compartment, whether or not it has any business
  # touching this key.
  matching_rule = "ALL {instance.id = '${oci_core_instance.app_server.id}'}"
}

resource "oci_identity_policy" "vault_unseal" {
  compartment_id = var.oci_compartment_id
  name           = "bggg-vault-unseal-policy"
  description    = "Lets the app server VM decrypt (only) its own Vault auto-unseal key via instance principal auth"

  statements = [
    "Allow dynamic-group ${oci_identity_dynamic_group.vault_unseal.name} to use keys in compartment id ${var.oci_compartment_id} where target.key.id = '${oci_kms_key.vault_unseal.id}'",
  ]
}
