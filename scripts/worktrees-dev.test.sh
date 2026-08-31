#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/bin"
cat >"$WORK/bin/git" <<'EOF'
#!/bin/sh
printf 'worktree /tmp/main\n\nworktree /tmp/branch with spaces\n\n'
EOF
cat >"$WORK/helper" <<'EOF'
#!/bin/sh
case "$WORKTREE_DIR" in */branch*) exit 1;; esac
exit 0
EOF
chmod +x "$WORK/bin/git" "$WORK/helper"
set +e
output=$(PATH="$WORK/bin:$PATH" WORKTREE_HELPER="$WORK/helper" REPO_ROOT="$WORK/root" WORKTREE_CONCURRENCY=1 sh "$ROOT/scripts/worktrees-dev.sh" setup 2>&1)
rc=$?
set -e
printf '%s\n' "$output" | grep -q '/tmp/main: PASS'
printf '%s\n' "$output" | grep -q '/tmp/branch with spaces: FAIL'
[ "$rc" -ne 0 ]
printf 'ok   all-worktree parsing, continuation, and summary\n'
printf '\nall tests passed\n'
