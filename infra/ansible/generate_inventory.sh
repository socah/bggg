#!/bin/sh
set -eu

# Decision: shell out to 'terraform output' rather than use Ansible's
# dynamic-inventory plugin system (e.g. a Terraform-state inventory
# plugin). Because: this project has exactly one VM — there's no fleet to
# discover, so a plugin's extra dependency and config just to read one IP
# isn't worth it. Alternative: a dynamic inventory plugin. Drawback: more
# moving parts (plugin install, its own config file) for something a
# three-line script already does.
TERRAFORM_DIR="$(dirname "$0")/../terraform"

# '-raw' returns the bare string (203.0.113.10), not JSON-quoted
# ("203.0.113.10") — inventory.ini needs the bare value, not a quoted one.
APP_SERVER_IP=$(terraform -chdir="$TERRAFORM_DIR" output -raw app_server_public_ip)

# The private key itself is never in this repo (same reasoning as
# oci_private_key_path in infra/terraform/variables.tf) — it lives on
# whoever's machine runs this script, so it's read from an env var rather
# than a path guessed on their behalf.
SSH_KEY_PATH="${SSH_KEY_PATH:?Set SSH_KEY_PATH to the private key matching var.ssh_public_key}"

# 'ubuntu' matches the default login user baked into the Ubuntu 22.04
# image referenced by var.oci_image_id in infra/terraform/variables.tf.
cat > "$(dirname "$0")/inventory.ini" <<EOF
[web]
$APP_SERVER_IP ansible_user=ubuntu ansible_ssh_private_key_file=$SSH_KEY_PATH
EOF

echo "inventory.ini written for $APP_SERVER_IP"
