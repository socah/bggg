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
# whoever's machine runs this script, so it's read from an env var (set
# alongside TF_VAR_oci_private_key_path in Infisical's /ENV_VARS and exported
# by infra/scripts/import-secrets.sh) rather than a path guessed on their behalf.
SSH_KEY_PATH="${SSH_KEY_PATH:?Set SSH_KEY_PATH to the private key matching var.ssh_public_key}"

# infisical's dotenv-export quotes values, so a literal '~/...' never gets
# shell tilde-expansion on the way in (same issue as
# TF_VAR_oci_private_key_path in import-secrets.sh) — expand it here. '/bin/sh'
# has no ${VAR/#pattern/repl}, so this uses a POSIX case match instead.
case "$SSH_KEY_PATH" in
  "~/"*) SSH_KEY_PATH="$HOME/${SSH_KEY_PATH#"~/"}" ;;
  "~") SSH_KEY_PATH="$HOME" ;;
esac

# 'ubuntu' matches the default login user baked into the Ubuntu 22.04
# image referenced by var.oci_image_id in infra/terraform/variables.tf.
cat > "$(dirname "$0")/inventory.ini" <<EOF
[web]
$APP_SERVER_IP ansible_user=ubuntu ansible_ssh_private_key_file=$SSH_KEY_PATH
EOF

echo "inventory.ini written for $APP_SERVER_IP"

# --- SSH config entry: 'ssh bggg' works the same in every shell ---
#
# Without this, reaching the VM by hand depends on either passing
# '-i "$SSH_KEY_PATH"' explicitly on every 'ssh' invocation, or having an
# ssh-agent already holding the key — and this devcontainer has no agent
# forwarding configured, so a freshly opened shell has neither (agents
# are scoped to whatever process tree started them, not shared across
# every terminal automatically). A Host entry in ~/.ssh/config sidesteps
# both: 'ssh bggg' resolves to the right IP and key regardless of
# per-shell agent state.
SSH_CONFIG="$HOME/.ssh/config"
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
touch "$SSH_CONFIG"
chmod 600 "$SSH_CONFIG"

# Idempotent: strip any block this script wrote on a previous run before
# appending a fresh one, rather than piling up duplicate 'Host bggg'
# entries. This matters because the IP changes whenever the VM is
# recreated — ssh uses the *first* matching Host block it finds, so a
# stale leftover entry would silently keep winning over a freshly
# appended correct one.
if grep -qF "# BEGIN bggg-app-server (managed by generate_inventory.sh)" "$SSH_CONFIG"; then
  awk '
    /^# BEGIN bggg-app-server \(managed by generate_inventory\.sh\)$/ { skip = 1 }
    !skip { print }
    /^# END bggg-app-server$/ { skip = 0 }
  ' "$SSH_CONFIG" > "$SSH_CONFIG.tmp"
  mv "$SSH_CONFIG.tmp" "$SSH_CONFIG"
fi

cat >> "$SSH_CONFIG" <<EOF
# BEGIN bggg-app-server (managed by generate_inventory.sh)
Host bggg
  HostName $APP_SERVER_IP
  User ubuntu
  IdentityFile $SSH_KEY_PATH
# END bggg-app-server
EOF

echo "~/.ssh/config updated — 'ssh bggg' now reaches $APP_SERVER_IP"
