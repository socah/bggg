terraform {
  required_version = ">= 1.7"

  required_providers {
    # Decision: pin to major version ranges (~>), not exact versions —
    # picks up patch/minor fixes automatically but never a breaking major
    # bump without a deliberate change to this file.
    oci = {
      source  = "oracle/oci"
      version = "~> 5.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

provider "oci" {
  # API-key authentication. Values come from variables — never hardcoded
  # here — and are supplied via terraform.tfvars (git-ignored) or
  # TF_VAR_* environment variables so nothing secret ever enters this file.
  tenancy_ocid     = var.oci_tenancy_ocid
  user_ocid        = var.oci_user_ocid
  fingerprint      = var.oci_fingerprint
  private_key_path = var.oci_private_key_path
  region           = var.oci_region
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

# --- Networking: one VCN, one subnet, one route to the internet ---
# (the NSG that actually filters traffic lives in nsg.tf)

resource "oci_core_vcn" "main" {
  # /16 leaves room to add more subnets later (e.g. splitting an app tier
  # from a data tier) without re-provisioning the VCN itself.
  cidr_block     = "10.0.0.0/16"
  compartment_id = var.oci_compartment_id
  display_name   = "bggg-vcn"
  dns_label      = "bggg"
}

resource "oci_core_internet_gateway" "main" {
  compartment_id = var.oci_compartment_id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "bggg-igw"
  enabled        = true
}

# A gateway existing isn't enough on its own — the route table is what
# tells the subnet "traffic to anywhere (0.0.0.0/0) goes out through the
# internet gateway." Without this rule the VM would have a public IP but
# no way to actually reach or be reached from the internet.
resource "oci_core_route_table" "main" {
  compartment_id = var.oci_compartment_id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "bggg-route-table"

  route_rules {
    destination       = "0.0.0.0/0"
    network_entity_id = oci_core_internet_gateway.main.id
  }
}

resource "oci_core_subnet" "main" {
  compartment_id = var.oci_compartment_id
  vcn_id         = oci_core_vcn.main.id
  cidr_block     = "10.0.1.0/24"
  display_name   = "bggg-subnet"
  route_table_id = oci_core_route_table.main.id

  # Decision: leave the subnet's own security_list_ids empty so the NSG
  # (nsg.tf) is the ONLY thing filtering traffic. Two overlapping firewall
  # mechanisms (security list + NSG) both attached to the same subnet is a
  # classic source of "why is this port blocked, I opened it in the NSG"
  # confusion — one mechanism, one place to look.
  security_list_ids = []
}

# --- Compute: the free-tier VM ---

resource "oci_core_instance" "app_server" {
  compartment_id      = var.oci_compartment_id
  availability_domain = var.oci_availability_domain
  display_name        = "bggg-app-server"

  # VM.Standard.A1.Flex (Ampere ARM) is the shape Oracle's Always Free tier
  # covers up to 2 OCPUs / 12GB RAM total — using it is what keeps this
  # instance inside the free tier.
  shape = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = 2
    memory_in_gbs = 12
  }

  create_vnic_details {
    subnet_id        = oci_core_subnet.main.id
    assign_public_ip = true
    # References nsg.tf — Terraform resolves cross-file references within
    # the same module automatically; file boundaries are just organization,
    # not a dependency barrier.
    nsg_ids = [oci_core_network_security_group.app_nsg.id]
  }

  source_details {
    source_type = "image"
    source_id   = var.oci_image_id
  }

  metadata = {
    # cloud-init injects this into ~/.ssh/authorized_keys on first boot.
    # Password auth is disabled from the very first second the VM exists —
    # Ansible (next topic) connects with this key, never a password.
    ssh_authorized_keys = var.ssh_public_key
  }
}
