#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8765}"
METRICS_ROOT="${METRICS_ROOT:-$ROOT/metrics-calculation/outputs/all_matches}"

if [[ ! -f "$ROOT/visualizer/scripts/serve_visualizer.py" ]]; then
  echo "Missing serve_visualizer.py — run scripts/sync_from_workspace.sh first" >&2
  exit 1
fi

if [[ -z "${HACKATHON_DATA_ROOT:-}" && -z "${DATA_ROOT:-}" ]]; then
  echo "Set HACKATHON_DATA_ROOT (outside repo) or DATA_ROOT to Match_Data parent" >&2
  exit 1
fi

export METRICS_ROOT
exec python "$ROOT/visualizer/scripts/serve_visualizer.py" \
  --port "$PORT" \
  --root "$ROOT" \
  --shooting-review-dir "$METRICS_ROOT" \
  ${DATA_ROOT:+--data-root "$DATA_ROOT"}
