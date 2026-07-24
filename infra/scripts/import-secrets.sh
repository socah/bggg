# Pull dev secrets from Infisical onto a fresh machine/devcontainer.
#
# Usage:
#   source infra/scripts/import-secrets.sh
#
# Layout this script expects in Infisical (folder -> handling):
#   /ENV_VARS/*                 exported as environment variables in this shell
#   /FILEABLES/OCI_PRIVATE_KEY  written to $TF_VAR_OCI_PRIVATE_KEY_PATH
#                                (that path is itself one of the ENV_VARS secrets,
#                                 matching infra/terraform/variables.tf's
#                                 oci_private_key_path)
#   /FILEABLES/SSH_PRIVATE_KEY  written to ~/.ssh/id_ed25519, chmod 600, loaded
#                                into the running ssh-agent if there is one
#
# Optional env vars to set before sourcing:
#   INFISICAL_ENV                 environment slug to read from (default: dev)
#   INFISICAL_PROJECT_ID           overrides project lookup if no .infisical.json
#                                   is present in the current directory
#   INFISICAL_CLIENT_ID / INFISICAL_CLIENT_SECRET
#                                   if both are set, logs in non-interactively via
#                                   Universal Auth instead of the interactive
#                                   browser flow

# Must be sourced, not executed: everything below exports variables into the
# calling shell (TF_VAR_OCI_PRIVATE_KEY_PATH, etc.) and loads the SSH key into
# that shell's ssh-agent. Run as './import-secrets.sh' instead, all of that
# would land in a subshell that exits immediately, and none of it would stick.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "Run this with 'source infra/scripts/import-secrets.sh', not by executing it directly." >&2
  echo "(Executing it would export everything into a subshell that exits immediately.)" >&2
  exit 1
fi

bggg_import_secrets() {
  local env="${INFISICAL_ENV:-dev}"
  local project_flag=()
  [ -n "${INFISICAL_PROJECT_ID:-}" ] && project_flag=(--projectId="$INFISICAL_PROJECT_ID")

  if ! command -v infisical >/dev/null 2>&1; then
    echo "infisical CLI not found — see https://infisical.com/docs/cli/overview" >&2
    return 1
  fi

  # Decision: default to interactive 'infisical login' (opens a browser),
  # only switching to non-interactive Universal Auth when both
  # INFISICAL_CLIENT_ID and INFISICAL_CLIENT_SECRET are already in the
  # environment. Interactive is the friendlier default for a human opening a
  # fresh devcontainer; Universal Auth lets this same script run unattended
  # (CI, an Ansible provisioning step) once those two values are supplied
  # out-of-band.
  if [ -n "${INFISICAL_CLIENT_ID:-}" ] && [ -n "${INFISICAL_CLIENT_SECRET:-}" ]; then
    local token
    token=$(infisical login --method=universal-auth \
      --client-id="$INFISICAL_CLIENT_ID" \
      --client-secret="$INFISICAL_CLIENT_SECRET" \
      --silent --plain) || { echo "Universal Auth login failed" >&2; return 1; }
    export INFISICAL_TOKEN="$token"
  else
    infisical login || { echo "infisical login failed" >&2; return 1; }
  fi

  echo "Importing /ENV_VARS as environment variables (env=$env)..."
  # 'dotenv-export' formats each secret as `export KEY='value'` — eval'ing
  # that inside this sourced function is what lands the variables in the
  # calling shell instead of a throwaway subshell.
  local exports
  exports=$(infisical export --format=dotenv-export --env="$env" --path=/ENV_VARS "${project_flag[@]}") \
    || { echo "Failed to export /ENV_VARS from Infisical" >&2; return 1; }
  eval "$exports"

  if [ -z "${TF_VAR_OCI_PRIVATE_KEY_PATH:-}" ]; then
    echo "TF_VAR_OCI_PRIVATE_KEY_PATH was not set by /ENV_VARS — cannot place OCI_PRIVATE_KEY" >&2
    return 1
  fi

  # 'infisical export' quotes the value (export KEY='~/.oci/...'), so the shell
  # never gets a chance to tilde-expand it on eval — expand it here instead, or
  # a literal '~' directory gets created in the current working directory.
  TF_VAR_OCI_PRIVATE_KEY_PATH="${TF_VAR_OCI_PRIVATE_KEY_PATH/#\~/$HOME}"
  export TF_VAR_OCI_PRIVATE_KEY_PATH

  echo "Writing OCI_PRIVATE_KEY to $TF_VAR_OCI_PRIVATE_KEY_PATH..."
  mkdir -p "$(dirname "$TF_VAR_OCI_PRIVATE_KEY_PATH")"
  infisical secrets get OCI_PRIVATE_KEY --path=/FILEABLES --env="$env" --plain "${project_flag[@]}" \
    > "$TF_VAR_OCI_PRIVATE_KEY_PATH" || { echo "Failed to fetch OCI_PRIVATE_KEY" >&2; return 1; }
  chmod 600 "$TF_VAR_OCI_PRIVATE_KEY_PATH"

  local ssh_key_path="$HOME/.ssh/id_ed25519"
  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh"
  # Back up rather than silently clobber: this is the fixed path ssh checks
  # by default, so if a real key is already sitting here this script has no
  # business overwriting it without a trace.
  if [ -f "$ssh_key_path" ]; then
    cp "$ssh_key_path" "$ssh_key_path.bak-$(date +%s)"
    echo "Existing $ssh_key_path backed up."
  fi
  echo "Writing SSH_PRIVATE_KEY to $ssh_key_path..."
  infisical secrets get SSH_PRIVATE_KEY --path=/FILEABLES --env="$env" --plain "${project_flag[@]}" \
    > "$ssh_key_path" || { echo "Failed to fetch SSH_PRIVATE_KEY" >&2; return 1; }
  chmod 600 "$ssh_key_path"

  # Load it into a running agent if there is one, so plain 'ssh'/Ansible
  # calls don't need '-i' every time. Not fatal if there's no agent yet
  # (e.g. the very first shell in a brand new devcontainer).
  if [ -n "${SSH_AUTH_SOCK:-}" ]; then
    ssh-add "$ssh_key_path" 2>/dev/null || true
  fi

  echo "Done. TF_VAR_OCI_PRIVATE_KEY_PATH, the OCI key file, and the SSH key are ready for this shell session."
}

if bggg_import_secrets; then
  unset -f bggg_import_secrets
  return 0
else
  unset -f bggg_import_secrets
  return 1
fi
