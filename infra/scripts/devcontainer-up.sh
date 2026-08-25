#!/bin/sh
# Host-side bootstrap: builds and starts this repo's devcontainer the way VS
# Code would, then leaves it fully usable headlessly. Requires only bash/sh,
# curl and docker on the host — the devcontainer CLI itself is installed on
# first run via the standalone installer (which bundles its own Node.js), so
# no pre-existing Node toolchain is needed:
#   https://github.com/devcontainers/cli/blob/main/README.md#install-script
#
# After 'up' it runs 'make dev-setup' inside the container unless --no-setup
# is passed, then polls the published ports from the host. Idempotent: the
# CLI reuses an existing container for the same workspace folder.
#
# Port publishing comes from appPort in .devcontainer/devcontainer.json —
# the spec's editor-independent mechanism. forwardPorts alone does nothing
# here: that one is implemented by editors (VS Code), not by this CLI.
#
# By default the script ends INSIDE the container (interactive bash — run
# opencode, npm, docker compose from there). Pass --no-shell to keep it
# non-interactive; --no-setup skips 'make dev-setup'.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

log() { printf '[devcontainer-up] %s\n' "$*"; }
die() { printf '[devcontainer-up] ERROR: %s\n' "$*" >&2; exit 1; }

SETUP=1
NO_SHELL=0
for arg in "$@"; do
  case "$arg" in
    --no-setup) SETUP=0 ;;
    --no-shell) NO_SHELL=1 ;;
    *) die "unknown argument '$arg' (supported: --no-setup, --no-shell)" ;;
  esac
done

command -v docker >/dev/null 2>&1 || die "docker not found on PATH — start Docker Desktop or install docker first"

INSTALLER_URL="https://raw.githubusercontent.com/devcontainers/cli/main/scripts/install.sh"

if command -v devcontainer >/dev/null 2>&1; then
  log "using devcontainer CLI from PATH ($(command -v devcontainer))"
else
  log "devcontainer CLI not found — installing via standalone script"
  mkdir -p "$HOME/.devcontainers/bin"
  # Download-then-execute rather than 'curl | sh': a bare pipeline returns
  # the LAST stage's status, so a failed download would be silently masked
  # by sh succeeding on empty input.
  installer="$HOME/.devcontainers/install.sh"
  curl -fsSL "$INSTALLER_URL" -o "$installer" || die "CLI installer download failed"
  sh "$installer" || die "CLI installer failed"
  rm -f "$installer"
  export PATH="$HOME/.devcontainers/bin:$PATH"
  command -v devcontainer >/dev/null 2>&1 \
    || die "installer finished but no devcontainer binary in $HOME/.devcontainers/bin"
  # The parent shell's PATH can't be changed by a child process, so future
  # manual invocations need this line once:
  log "add to your shell profile for future use: export PATH=\"\$HOME/.devcontainers/bin:\$PATH\""
fi

log "starting devcontainer (build + features + postCreate/postStart commands)"
devcontainer up --workspace-folder "$REPO_ROOT"

if [ "$SETUP" = "1" ]; then
  log "running make dev-setup inside the container (stack, seeded login user, secrets, migrations, servers)"
  devcontainer exec --workspace-folder "$REPO_ROOT" make dev-setup
else
  log "skipping make dev-setup (--no-setup)"
fi

probe() { # $1=port $2=name
  i=0
  # Env-overridable for the unit-test harness (same pattern as SEED_WAIT_*)
  while [ "$i" -lt "${PROBE_ATTEMPTS:-30}" ]; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$1/" 2>/dev/null || echo 000)
    [ "$code" != "000" ] && return 0
    i=$((i + 1))
    sleep "${PROBE_SLEEP:-2}"
  done
  return 1
}

if probe 3000 && probe 8080; then
  log "ready — web http://localhost:3000 (login user/user) · Keycloak http://localhost:8080"
else
  log "WARNING: container is up but a port did not answer yet — check 'docker ps' and logs inside the container (logs/api.log, logs/web.log)"
fi

if [ "$NO_SHELL" = "1" ]; then
  log "done (--no-shell)"
else
  # Default ending: an interactive shell inside the container — same
  # environment VS Code would attach to (opencode, npm workspaces, docker
  # compose all on PATH). exec replaces this script's process, so exiting
  # the shell ends the script cleanly with its status.
  log "entering devcontainer shell — 'exit' or Ctrl-D to leave (--no-shell skips this)"
  exec devcontainer exec --workspace-folder "$REPO_ROOT" bash
fi
