#!/bin/sh
# Unit tests for devcontainer-up.sh — every external tool (docker, curl,
# devcontainer) is a stub on PATH, so nothing here touches a real container
# runtime. The install-if-missing path is exercised through the documented
# interface itself: the fake curl recognizes the standalone installer URL and
# pretends to install a CLI into $HOME/.devcontainers/bin, exactly like
# 'curl -fsSL .../install.sh | sh' would.
#
# Run: sh infra/scripts/devcontainer-up.test.sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
UNDER_TEST="$SCRIPT_DIR/devcontainer-up.sh"
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
STUBS="$WORK/bin"
mkdir -p "$STUBS" "$WORK/home"

failures=0
check() {
  if [ "$2" = "expected" ]; then
    printf 'ok   %s\n' "$1"
  else
    failures=$((failures + 1))
    printf 'FAIL %s (got %s)\n' "$1" "$2"
  fi
}

# --- generic call-recording stub factory ------------------------------------
# Each named stub appends its argv to $CALL_LOG and exits with $STUB_RC.
make_stub() { # $1=name $2=rc
  cat >"$STUBS/$1" <<EOF
#!/bin/sh
printf '%s\n' "\$0 \$*" >> "\${CALL_LOG:?}"
exit $2
EOF
  chmod +x "$STUBS/$1"
}

run_up() { # $@ = extra args; caller presets PATH additions
  CALL_LOG="$WORK/calls.log" HOME="$WORK/home" \
    PATH="$STUBS:${EXTRA_PATH-$PATH}" \
    PROBE_ATTEMPTS=1 PROBE_SLEEP=0 \
    CURL_RC="${CURL_RC_EXPORT-0}" \
    sh "$UNDER_TEST" "$@"
}

fresh_stubs() { # $1=have_devcontainer(0/1) $2=curl_rc $3=docker_rc
  rm -rf "$STUBS"; mkdir -p "$STUBS"
  rm -rf "$WORK/home"          # no state leakage between scenarios
  mkdir -p "$WORK/home"
  rm -f "$WORK/calls.log"
  make_stub docker "$3"
  make_stub devcontainer 0
  [ "$1" = "0" ] || rm "$STUBS/devcontainer"
  CURL_RC_EXPORT="$2"
  # fake curl: only knows the installer URL; 'installs' a CLI binary.
  cat >"$STUBS/curl" <<'EOF'
#!/bin/sh
printf '%s\n' "$*" >> "${CALL_LOG:?}"
case "$*" in
  *raw.githubusercontent.com/devcontainers/cli/main/scripts/install.sh*)
    if [ "${CURL_RC:-0}" -ne 0 ]; then exit "$CURL_RC"; fi
    # Real curl would save the installer to the '-o' target; running THAT
    # script is what installs the CLI into $HOME/.devcontainers/bin.
    out=""
    prev=""
    for a in "$@"; do
      [ "$prev" = "-o" ] && out="$a"
      prev="$a"
    done
    [ -n "$out" ] || { echo "stub curl: no -o target given" >&2; exit 9; }
    cat >"$out" <<BIN
#!/bin/sh
mkdir -p "\$HOME/.devcontainers/bin"
cat > "\$HOME/.devcontainers/bin/devcontainer" <<'INNER'
#!/bin/sh
printf '%s\n' "\$0 \$*" >> "\${CALL_LOG:?}"
exit 0
INNER
chmod +x "\$HOME/.devcontainers/bin/devcontainer"
BIN
    exit 0
    ;;
esac
  echo "unexpected curl invocation: $*" >&2
  exit 9
EOF
  chmod +x "$STUBS/curl"
}

calls() { cat "$WORK/calls.log" 2>/dev/null; }

# --- 1: CLI present -> used directly, full setup flow -----------------------
fresh_stubs 0 0 0
if run_up; then check "happy: exits 0" expected; else check "happy: exits 0" errored; fi
check "happy: no installer download when CLI already exists" \
  "$( calls | grep -qF "curl" && echo downloaded || echo expected )"
check "happy: runs devcontainer up with repo root" \
  "$( calls | grep -qF "up --workspace-folder $REPO_ROOT" && echo expected || echo wrong-args )"
check "happy: runs make dev-setup inside via exec" \
  "$( calls | grep -qF "exec --workspace-folder $REPO_ROOT make dev-setup" && echo expected || echo wrong-args )"

# --- 2: --no-setup skips the in-container bootstrap -------------------------
fresh_stubs 0 0 0
run_up --no-setup >/dev/null
check "--no-setup: never runs make dev-setup" \
  "$( calls | grep -qF 'make dev-setup' && echo ran-setup || echo expected )"
check "--no-setup: still brings the container up" \
  "$( calls | grep -qF 'up --workspace-folder' && echo expected || echo wrong-args )"

# --- 3: CLI missing -> installs via documented standalone script ------------
fresh_stubs 1 0 0
if run_up; then check "install: completes successfully" expected; else check "install: completes successfully" errored; fi
check "install: downloads the official install.sh" \
  "$( calls | grep -qF 'raw.githubusercontent.com/devcontainers/cli/main/scripts/install.sh' && echo expected || echo missing )"
check "install: uses the freshly installed CLI afterwards" \
  "$( calls | grep -qF "$WORK/home/.devcontainers/bin/devcontainer up" && echo expected || echo wrong-binary )"

# --- 4: installer fails -> loud error, no half-state ------------------------
fresh_stubs 1 1 0
if run_up 2>/dev/null; then
  check "install-failure: exits nonzero" swallowed
else
  check "install-failure: exits nonzero" expected
fi
check "install-failure: does not proceed to up/exec" \
  "$( calls | grep -qF 'workspace-folder' && echo proceeded || echo expected )"

# --- 5: docker missing -> refuses before touching anything ------------------
fresh_stubs 0 0 0
rm "$STUBS/docker"
# EXTRA_PATH scoped to this one call: later tests must keep normal PATH.
if EXTRA_PATH=/nonexistent-if-any run_up 2>/dev/null; then
  check "no-docker: exits nonzero" swallowed
else
  check "no-docker: exits nonzero" expected
fi
check "no-docker: nothing attempted" \
  "$( [ -z "$(cat "$WORK/calls.log" 2>/dev/null)" ] && echo expected || echo attempted )"

# --- 6: devcontainer up failure -> propagates -------------------------------
fresh_stubs 0 0 0
cat >"$STUBS/devcontainer" <<'EOF'
#!/bin/sh
printf '%s\n' "$0 $*" >> "${CALL_LOG:?}"
exit 7
EOF
chmod +x "$STUBS/devcontainer"
if run_up 2>/dev/null; then
  check "up-failure: exit code propagates" swallowed
else
  check "up-failure: exit code propagates" expected
fi

# --- 7: default run ends inside the container shell --------------------------
fresh_stubs 0 0 0
run_up >/dev/null
check "default: drops into an interactive bash via exec" \
  "$( calls | grep -qF "exec --workspace-folder $REPO_ROOT bash" && echo expected || echo missing )"

# --- 8: --no-shell keeps the script non-interactive --------------------------
fresh_stubs 0 0 0
run_up --no-shell >/dev/null
check "--no-shell: never opens a shell" \
  "$( calls | grep -qF "$REPO_ROOT bash" && echo opened-shell || echo expected )"
check "--no-shell: still runs setup" \
  "$( calls | grep -qF 'make dev-setup' && echo expected || echo missing )"

# --- 9: unknown arguments are rejected ---------------------------------------
fresh_stubs 0 0 0
if run_up --bogus 2>/dev/null; then
  check "bad-arg: exits nonzero" swallowed
else
  check "bad-arg: exits nonzero" expected
fi

if [ "$failures" -gt 0 ]; then
  printf '\n%s test(s) failed\n' "$failures"
  exit 1
fi
printf '\nall tests passed\n'
