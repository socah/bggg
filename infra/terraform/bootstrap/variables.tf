variable "cloudflare_api_token" {
  description = "Cloudflare API token, scoped to R2 admin permissions (same token used by the main config's cloudflare provider)"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the R2 bucket"
  type        = string
}

variable "state_bucket_name" {
  description = "Name of the R2 bucket that stores this project's Terraform state (separate from the uploads bucket)"
  type        = string
  default     = "bggg-terraform-state"
}
