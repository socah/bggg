# --- DNS: point the project's domain at the OCI VM's public IP ---

resource "cloudflare_record" "app" {
  zone_id = var.cloudflare_zone_id
  name    = var.domain_name
  type    = "A"
  content = oci_core_instance.app_server.public_ip
  ttl     = 300

  # Decision: proxied = false (Cloudflare "DNS only", grey cloud) rather
  # than true (orange cloud, Cloudflare's proxy/CDN in front of the VM).
  # If Cloudflare proxied this record, it would terminate TLS at
  # Cloudflare's edge and answer requests itself — but Traefik's own
  # Let's Encrypt HTTP-01 challenge (next topic) needs the raw HTTP
  # request to reach the VM directly and unmodified to prove ownership.
  # Proxying and self-managed ACME don't mix without extra configuration
  # this project doesn't need.
  proxied = false
}

# --- R2: the bucket 3_r2_uploads' application code already assumes exists ---

resource "cloudflare_r2_bucket" "uploads" {
  account_id = var.cloudflare_account_id
  name       = var.r2_bucket_name
  # Closest R2 location hint to where the OCI VM actually runs — R2 doesn't
  # guarantee physical placement, but this nudges it.
  location = "EEUR"

  # This bucket holds real user-uploaded play session photos, not
  # scaffolding — unlike the VM (safe to destroy/recreate because durable
  # state lives in Postgres, not on the VM itself), losing this bucket is
  # permanent data loss. See notes/4_terraform.md's worked example for how
  # this guard behaves.
  lifecycle {
    prevent_destroy = true
  }
}
