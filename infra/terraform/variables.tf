variable "oci_tenancy_ocid" {
  description = "OCID of the Oracle Cloud tenancy Terraform provisions into"
  type        = string
}

variable "oci_user_ocid" {
  description = "OCID of the API-key user Terraform authenticates as"
  type        = string
}

variable "oci_fingerprint" {
  description = "Fingerprint of the API signing key uploaded to the OCI user"
  type        = string
}

variable "oci_private_key_path" {
  description = "Local path to the private key matching oci_fingerprint (the key file itself is never committed)"
  type        = string
}

variable "oci_region" {
  description = "OCI region to provision into, e.g. eu-frankfurt-1"
  type        = string
}

variable "oci_compartment_id" {
  description = "OCID of the compartment resources are created in"
  type        = string
}

variable "oci_availability_domain" {
  description = "Availability domain for the compute instance, e.g. 'lfup:EU-FRANKFURT-1-AD-1'"
  type        = string
}

variable "oci_image_id" {
  description = "OCID of the boot image (Ubuntu 22.04, ARM/aarch64) for the app server"
  type        = string
}

variable "ssh_public_key" {
  description = "Public key injected into the VM's authorized_keys at boot; Ansible connects with the matching private key"
  type        = string
}

variable "ssh_allowed_cidr" {
  description = "CIDR allowed to reach port 22 in the NSG. Defaults to 0.0.0.0/0 (anywhere) — override with your own IP/32 in terraform.tfvars for defense in depth; Fail2ban (a later topic) is the backstop if you don't."
  type        = string
  default     = "0.0.0.0/0"
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token, scoped to R2 admin permissions only for this account (DNS is handled by DuckDNS, not Terraform)"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID that owns the R2 bucket"
  type        = string
}

variable "r2_bucket_name" {
  description = "Name of the R2 bucket that stores uploaded play session photos"
  type        = string
  default     = "bggg-uploads"
}
