#!/usr/bin/env bash
# Copy latest pipeline outputs into reference_outputs for notebooks.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/metrics-calculation/outputs/all_matches}"
DST="$ROOT/metrics-calculation/reference_outputs"
mkdir -p "$DST"
for f in scores_v1.csv shots.csv features.csv validation_report.md; do
  cp "$SRC/$f" "$DST/$f"
done
echo "Updated $DST from $SRC"
