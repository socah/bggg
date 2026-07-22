# Decision: bucket/key/region are hardcoded literals, not var.xxx
# references — unlike every other .tf file in this project. This isn't a
# violation of the "never hardcode, always use variables" convention; it's
# a hard Terraform constraint. A backend block is resolved before the
# variable system exists, so it cannot read terraform.tfvars or any var.*
# reference at all.
#
# The endpoint URL (which embeds the Cloudflare account ID) is deliberately
# left OUT of this file entirely — not because the account ID is secret
# (it isn't; the same value already sits in terraform.tfvars as
# cloudflare_account_id), but to keep this file portable across
# clones/forks without editing committed HCL, and to keep every
# backend-specific setting in one place: the environment. It's supplied at
# init/plan/apply time via the AWS_ENDPOINT_URL_S3 environment variable,
# which the s3 backend honors because it's built on AWS SDK v2 — the same
# mechanism that already supplies AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
# below.
terraform {
  backend "s3" {
    bucket = "bggg-terraform-state"
    key    = "bggg/terraform.tfstate"
    region = "auto" # R2 has no AWS-style regions; "auto" satisfies the backend's required field

    # R2 isn't AWS: these turn off checks the s3 backend normally runs
    # against real AWS (region validation, an STS call to confirm account
    # identity) that don't apply to an S3-compatible store.
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    use_path_style              = true # R2 uses path-style URLs (host/bucket/key), not AWS's virtual-hosted style (bucket.host/key)

    # Nothing else is set here on purpose. Both the endpoint and the
    # credentials come entirely from environment variables at init time:
    #   AWS_ENDPOINT_URL_S3     = https://<account_id>.r2.cloudflarestorage.com
    #   AWS_ACCESS_KEY_ID       = <R2 Access Key ID>
    #   AWS_SECRET_ACCESS_KEY   = <R2 Secret Access Key>
    # The last two are an R2-scoped Access Key ID/Secret — a different
    # credential from cloudflare_api_token, generated separately in the
    # Cloudflare dashboard under R2 -> Manage API tokens.
  }
}
