# This NSG is the "outermost firewall" from references/secops.md's Network
# Hardening section — traffic dropped here never reaches Traefik, Fail2ban,
# or the application at all.

resource "oci_core_network_security_group" "app_nsg" {
  compartment_id = var.oci_compartment_id
  vcn_id         = oci_core_vcn.main.id
  display_name   = "bggg-app-nsg"
}

# --- Ingress: exactly the three ports this project needs, nothing else ---

resource "oci_core_network_security_group_security_rule" "https_ingress" {
  network_security_group_id = oci_core_network_security_group.app_nsg.id
  direction                  = "INGRESS"
  protocol                   = "6" # TCP
  source                     = "0.0.0.0/0"
  source_type                = "CIDR_BLOCK"

  tcp_options {
    destination_port_range {
      min = 443
      max = 443
    }
  }
}

resource "oci_core_network_security_group_security_rule" "http_ingress" {
  network_security_group_id = oci_core_network_security_group.app_nsg.id
  direction                  = "INGRESS"
  protocol                   = "6"
  source                     = "0.0.0.0/0"
  source_type                = "CIDR_BLOCK"

  # Port 80 stays open only for Let's Encrypt's HTTP-01 challenge and
  # Traefik's redirect-to-HTTPS middleware — it never serves application
  # traffic directly. Closing it entirely would break certificate renewal.
  tcp_options {
    destination_port_range {
      min = 80
      max = 80
    }
  }
}

resource "oci_core_network_security_group_security_rule" "ssh_ingress" {
  network_security_group_id = oci_core_network_security_group.app_nsg.id
  direction                  = "INGRESS"
  protocol                   = "6"
  # Decision: source is a variable, not a hardcoded 0.0.0.0/0. Defaulting
  # open keeps this runnable out of the box, but the intent is you narrow
  # it to your own IP in terraform.tfvars — one more layer before Fail2ban
  # (a later topic) ever has to ban anything.
  source      = var.ssh_allowed_cidr
  source_type = "CIDR_BLOCK"

  tcp_options {
    destination_port_range {
      min = 22
      max = 22
    }
  }
}

# --- Egress: intentionally left open ---
#
# Decision: allow all outbound traffic rather than also locking down
# egress. The threat model this NSG addresses is "what can reach the VM
# from the internet," not "what can the VM reach" — the app needs
# unrestricted outbound to pull Docker images, apt packages, talk to R2,
# and let Let's Encrypt validate the ACME challenge. Restricting egress
# (e.g. to stop a compromised container calling out to an attacker's
# server) is real defense-in-depth, but it's an advanced, higher-effort
# control that's out of scope for this project's threat model right now.
resource "oci_core_network_security_group_security_rule" "all_egress" {
  network_security_group_id = oci_core_network_security_group.app_nsg.id
  direction                  = "EGRESS"
  protocol                   = "all"
  destination                = "0.0.0.0/0"
  destination_type           = "CIDR_BLOCK"
}
