# Pull dev secrets from Infisical onto a fresh machine/devcontainer.
#
# Usage:
#   source infra/scripts/import-secrets.sh
#
# Layout this script expects in Infisical (folder -> handling):
#   /ENV_VARS/*                 exported as environment variables in this shell
#   /FILEABLES/OCI_PRIVATE_KEY  written to $TF_VAR_oci_private_key_path
#                                (that path is itself one of the ENV_VARS secrets,
#                                 matching infra/terraform/variables.tf's
#                                 oci_private_key_path)
#   /FILEABLES/SSH_PRIVATE_KEY  written to $SSH_KEY_PATH, chmod 600, loaded
#                                into the running ssh-agent if there is one
#                                (that path is itself one of the ENV_VARS secrets,
#                                 matching infra/ansible/generate_inventory.sh's
#                                 SSH_KEY_PATH)
#   /FILEABLES/GITHUB_DEPLOY_KEY   written to $GITHUB_DEPLOY_KEY_PATH, chmod 600
#                                (that path is itself one of the ENV_VARS secrets;
#                                 this key is a read-only GitHub deploy key, not
#                                 loaded into ssh-agent — Ansible's app_deploy role
#                                 copies the file itself to the server and passes
#                                 it to the 'git' module's key_file, matching
#                                 infra/ansible/roles/app_deploy/defaults/main.yml's
#                                 github_deploy_key_dest)
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
# calling shell (TF_VAR_oci_private_key_path, etc.) and loads the SSH key into
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
  # 'infisical user get token' surfaces a still-valid cached session (from a
  # previous interactive login) without prompting. Its stdin is pinned to
  # /dev/null because on a session miss it tries to launch its own login
  # flow rather than just failing — with stdin already closed that attempt
  # hits EOF and returns nonzero immediately instead of prompting twice.
  elif infisical user get token --plain >/dev/null 2>&1 </dev/null; then
    : # already logged in from a previous run; skip the browser flow
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

  if [ -z "${TF_VAR_oci_private_key_path:-}" ]; then
    echo "TF_VAR_oci_private_key_path was not set by /ENV_VARS — cannot place OCI_PRIVATE_KEY" >&2
    return 1
  fi

  # 'infisical export' quotes the value (export KEY='~/.oci/...'), so the shell
  # never gets a chance to tilde-expand it on eval — expand it here instead, or
  # a literal '~' directory gets created in the current working directory.
  TF_VAR_oci_private_key_path="${TF_VAR_oci_private_key_path/#\~/$HOME}"
  export TF_VAR_oci_private_key_path

  echo "Writing OCI_PRIVATE_KEY to $TF_VAR_oci_private_key_path..."
  mkdir -p "$(dirname "$TF_VAR_oci_private_key_path")"
  infisical secrets get OCI_PRIVATE_KEY --path=/FILEABLES --env="$env" --plain "${project_flag[@]}" \
    > "$TF_VAR_oci_private_key_path" || { echo "Failed to fetch OCI_PRIVATE_KEY" >&2; return 1; }
  chmod 600 "$TF_VAR_oci_private_key_path"

  if [ -z "${SSH_KEY_PATH:-}" ]; then
    echo "SSH_KEY_PATH was not set by /ENV_VARS — cannot place SSH_PRIVATE_KEY" >&2
    return 1
  fi
  # Same infisical dotenv-export quoting issue as TF_VAR_oci_private_key_path
  # above: a literal '~/...' value never gets shell tilde-expansion on eval.
  SSH_KEY_PATH="${SSH_KEY_PATH/#\~/$HOME}"
  export SSH_KEY_PATH

  local ssh_key_path="$SSH_KEY_PATH"
  mkdir -p "$(dirname "$ssh_key_path")"
  chmod 700 "$(dirname "$ssh_key_path")"
  # Back up rather than silently clobber: if a real key is already sitting at
  # this path this script has no business overwriting it without a trace.
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

  if [ -z "${GITHUB_DEPLOY_KEY_PATH:-}" ]; then
    echo "GITHUB_DEPLOY_KEY_PATH was not set by /ENV_VARS — cannot place GITHUB_DEPLOY_KEY" >&2
    return 1
  fi
  # Same infisical dotenv-export quoting issue as the paths above: a literal
  # '~/...' value never gets shell tilde-expansion on eval.
  GITHUB_DEPLOY_KEY_PATH="${GITHUB_DEPLOY_KEY_PATH/#\~/$HOME}"
  export GITHUB_DEPLOY_KEY_PATH

  mkdir -p "$(dirname "$GITHUB_DEPLOY_KEY_PATH")"
  chmod 700 "$(dirname "$GITHUB_DEPLOY_KEY_PATH")"
  if [ -f "$GITHUB_DEPLOY_KEY_PATH" ]; then
    cp "$GITHUB_DEPLOY_KEY_PATH" "$GITHUB_DEPLOY_KEY_PATH.bak-$(date +%s)"
    echo "Existing $GITHUB_DEPLOY_KEY_PATH backed up."
  fi
  echo "Writing GITHUB_DEPLOY_KEY to $GITHUB_DEPLOY_KEY_PATH..."
  infisical secrets get GITHUB_DEPLOY_KEY --path=/FILEABLES --env="$env" --plain "${project_flag[@]}" \
    > "$GITHUB_DEPLOY_KEY_PATH" || { echo "Failed to fetch GITHUB_DEPLOY_KEY" >&2; return 1; }
  chmod 600 "$GITHUB_DEPLOY_KEY_PATH"
  # Not ssh-add'd into the agent: this key isn't for this shell's own SSH
  # connections, it's read by 'ansible-playbook' (via lookup('env', ...) in
  # app_deploy/tasks/main.yml) and copied over to the server, where it's
  # what the server uses to authenticate to GitHub.

  echo "Done. TF_VAR_oci_private_key_path, SSH_KEY_PATH, GITHUB_DEPLOY_KEY_PATH, and all three key files are ready for this shell session."
}

if bggg_import_secrets; then
  unset -f bggg_import_secrets
  return 0
else
  unset -f bggg_import_secrets
  return 1
fi
