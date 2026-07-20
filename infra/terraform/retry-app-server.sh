#!/usr/bin/env bash
# Retries `terraform apply` scoped to just the app server instance, since
# OCI's Always Free A1.Flex shape is capacity-constrained and "out of host
# capacity" errors are transient — retrying later often succeeds even when
# an immediate retry doesn't. Everything else in the config (VCN, subnet,
# NSG, R2 bucket) is already applied and untouched by -target.
set -euo pipefail

INTERVAL_SECONDS="${1:-60}"
ATTEMPT=0

cd "$(dirname "$0")"

while true; do
  ATTEMPT=$((ATTEMPT + 1))
  echo "[$(date '+%H:%M:%S')] attempt ${ATTEMPT}..."

  if terraform apply -target=oci_core_instance.app_server -auto-approve; then
    echo "Success after ${ATTEMPT} attempt(s)."
    exit 0
  fi

  echo "Failed, retrying in ${INTERVAL_SECONDS}s (Ctrl+C to stop)..."
  sleep "${INTERVAL_SECONDS}"
done
