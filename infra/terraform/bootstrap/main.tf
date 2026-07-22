terraform {
  required_version = ">= 1.7"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }

  # Deliberately NO backend block here — this config's own state stays
  # local. It manages exactly one resource, gets applied once (maybe again
  # if the bucket is ever recreated from scratch), and is the one place in
  # this project where "state should be remote" is a deliberate exception:
  # a remote backend for the bootstrap config would just recreate the same
  # chicken-and-egg problem it exists to solve.
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# The bucket the MAIN config's backend.tf will point at. It has to be
# created here, ahead of time, by a config that isn't itself using it as a
# backend yet.
resource "cloudflare_r2_bucket" "terraform_state" {
  account_id = var.cloudflare_account_id
  name       = var.state_bucket_name
  location   = "EEUR"

  # Same guard as the uploads bucket, for the same reason: destroying this
  # bucket doesn't just lose a file, it erases the only record of every
  # OCI/Cloudflare resource this project has ever provisioned.
  lifecycle {
    prevent_destroy = true
  }
}

output "state_bucket_name" {
  value = cloudflare_r2_bucket.terraform_state.name
}
