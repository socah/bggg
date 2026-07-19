# --- DNS: handled by DuckDNS instead of a Terraform-managed resource ---
# See notes/4_duckdns.md — a Terraform resource only reflects reality when
# you run 'apply'; DuckDNS's whole point is staying correct even when the
# VM's IP changes without anyone doing that (e.g. a reboot reassigning an
# ephemeral IP). infra/ansible/roles/duckdns/ owns this instead, via a
# systemd timer running directly on the VM.

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
