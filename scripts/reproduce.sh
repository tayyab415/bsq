#!/usr/bin/env bash
# Reproduce BSQ metric outputs for all configured matches.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NO_S3=0
EXTRA=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-s3) NO_S3=1; shift ;;
    *) EXTRA+=("$1"); shift ;;
  esac
done

if [[ -f aws-hackathon.env ]]; then
  # shellcheck disable=SC1091
  source aws-hackathon.env
fi

ARGS=()
if [[ "$NO_S3" -eq 1 ]]; then
  ARGS+=(--no-s3)
  echo "Smoke mode: --no-s3 (no S3 parquet reads)"
  echo "Still set HACKATHON_DATA_ROOT if the builder needs local KPI XML."
fi

if [[ ${#EXTRA[@]} -gt 0 ]]; then
  ARGS+=("${EXTRA[@]}")
fi

if [[ ${#ARGS[@]} -gt 0 ]]; then
  exec "$ROOT/metrics-calculation/scripts/run_all_matches.sh" "${ARGS[@]}"
else
  exec "$ROOT/metrics-calculation/scripts/run_all_matches.sh"
fi
