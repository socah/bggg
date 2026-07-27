output "app_server_public_ip" {
  description = "Public IP of the OCI VM — Ansible's inventory file reads this instead of a hardcoded address"
  value       = oci_core_instance.app_server.public_ip
}

output "r2_bucket_name" {
  description = "Name of the R2 bucket the NestJS app uploads photos to"
  value       = cloudflare_r2_bucket.uploads.name
}

# Not secret — an OCID and two HTTPS endpoint URLs, not credentials.
# infra/vault/vault.hcl's 'seal "ocikms"' stanza needs these three values;
# Ansible reads them from here (via 'terraform output') the same way
# generate_inventory.sh already reads app_server_public_ip.
output "vault_unseal_key_id" {
  description = "OCID of the OCI KMS key backing Vault's auto-unseal"
  value       = oci_kms_key.vault_unseal.id
}

output "vault_kms_crypto_endpoint" {
  description = "OCI KMS crypto (data plane) endpoint — for encrypt/decrypt requests"
  value       = oci_kms_vault.bggg.crypto_endpoint
}

output "vault_kms_management_endpoint" {
  description = "OCI KMS management (control plane) endpoint — for key management requests"
  value       = oci_kms_vault.bggg.management_endpoint
}
