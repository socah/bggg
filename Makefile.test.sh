#!/bin/sh
set -eu

MAKEFILE=${MAKEFILE:-Makefile}
failures=0
check() {
  if [ "$2" = expected ]; then
    printf 'ok   %s\n' "$1"
  else
    failures=$((failures + 1))
    printf 'FAIL %s (got %s)\n' "$1" "$2"
  fi
}

check "migration generation target exists" \
  "$(grep -q '^migration-generate:' "$MAKEFILE" && printf expected || printf missing)"
check "migration generation has an automatic fallback name" \
  "$(grep -q 'date -u +%Y%m%d%H%M%S' "$MAKEFILE" && printf expected || printf missing)"
check "dev setup delegates to worktree helper" \
  "$(grep -q '^dev-setup:' "$MAKEFILE" && grep -q 'scripts/worktree-dev.sh setup' "$MAKEFILE" && ! grep -q '^dev-setup:.*migration-generate' "$MAKEFILE" && printf expected || printf wrong-order)"
check "automatic migration sync is not part of dev setup" \
  "$(grep -q '^migration-sync:' "$MAKEFILE" && printf present || printf expected)"
check "no-change generation is not fatal" \
  "$(grep -q 'No changes in database schema were found' "$MAKEFILE" && printf expected || printf missing)"
check "host-side generation connects through localhost" \
  "$(grep -q 'DB_HOST=localhost npm run migration:generate' "$MAKEFILE" && printf expected || printf missing)"
check "API dev command uses worktree port" \
  "$(grep -q 'API_HOST_PORT' package.json && printf expected || printf missing)"
check "dev targets do not use removed seed variables" \
  "$( ! grep -q 'DEV_SEED_USER_' "$MAKEFILE" && printf expected || printf present)"

if [ "$failures" -gt 0 ]; then
  printf '\n%s test(s) failed\n' "$failures"
  exit 1
fi
printf '\nall tests passed\n'
