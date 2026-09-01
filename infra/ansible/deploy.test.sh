#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DEPLOY_SCRIPT="$SCRIPT_DIR/deploy.sh"
TASKS_FILE="$SCRIPT_DIR/roles/app_deploy/tasks/main.yml"
DOCKERFILE="$SCRIPT_DIR/../../apps/api/Dockerfile"

failures=0
check() {
  if [ "$2" = expected ]; then
    printf 'ok   %s\n' "$1"
  else
    failures=$((failures + 1))
    printf 'FAIL %s (got %s)\n' "$1" "$2"
  fi
}

check "deploy wrapper forwards BGG_API_TOKEN" \
  "$(grep -q -- '-e bgg_api_token=' "$DEPLOY_SCRIPT" && printf expected || printf missing)"
check "compose task exports BGG_API_TOKEN" \
  "$(grep -c '^    BGG_API_TOKEN:' "$TASKS_FILE" | grep -q '^4$' && printf expected || printf missing)"
check "migration task exports database Compose variables" \
  "$(grep -c '^    DB_USER:' "$TASKS_FILE" | grep -q '^3$' && grep -c '^    DB_NAME:' "$TASKS_FILE" | grep -q '^3$' && grep -c '^    DB_PASSWORD:' "$TASKS_FILE" | grep -q '^4$' && printf expected || printf missing)"
check "migration task does not require a running api service" \
  "$(grep -A4 -- '- name: Run database migrations' "$TASKS_FILE" | grep -q ' run --rm --no-deps api ' && printf expected || printf missing)"
check "api runtime image includes workspace dependencies" \
  "$(grep -c '^COPY --from=build /workspace/apps/api/node_modules ./apps/api/node_modules$' "$DOCKERFILE" | grep -q '^1$' && printf expected || printf missing)"

if [ "$failures" -gt 0 ]; then
  printf '\n%s test(s) failed\n' "$failures"
  exit 1
fi
printf '\nall tests passed\n'
