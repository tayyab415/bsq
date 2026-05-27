#!/usr/bin/env bash
# Quick check: imports + optional --no-s3 smoke run.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

. .venv/bin/activate 2>/dev/null || {
  echo "Create venv first: python3.11 -m venv .venv && source .venv/bin/activate && pip install --upgrade pip && pip install -e \".[metrics]\"" >&2
  exit 1
}

python -c "import shooting1.build, aws_football.dribble_pose; print('imports: ok')"

if [[ -n "${HACKATHON_DATA_ROOT:-}" ]]; then
  ./scripts/reproduce.sh --no-s3 --max-windows-per-match 1
  test -f metrics-calculation/outputs/all_matches/scores_v1.csv
  echo "smoke run: ok"
else
  echo "Set HACKATHON_DATA_ROOT to run smoke pipeline"
fi
