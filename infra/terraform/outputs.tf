output "app_server_public_ip" {
  description = "Public IP of the OCI VM — Ansible's inventory file reads this instead of a hardcoded address"
  value       = oci_core_instance.app_server.public_ip
}

output "r2_bucket_name" {
  description = "Name of the R2 bucket the NestJS app uploads photos to"
  value       = cloudflare_r2_bucket.uploads.name
}
