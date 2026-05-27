#!/usr/bin/env bash
# Run BSQ builder for one match folder
set -euo pipefail
MATCH="${1:?Usage: run_single_match.sh <MatchFolder> [extra build.py args...]}"
shift || true
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

OUTPUT_DIR="${OUTPUT_DIR:-metrics-calculation/outputs/$MATCH}"
AWS_PROFILE="${AWS_PROFILE:-hackathon}"

exec "$ROOT/metrics-calculation/scripts/run_all_matches.sh" \
  --match-folder "$MATCH" \
  --output-dir "$OUTPUT_DIR" \
  "$@"
