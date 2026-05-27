#!/usr/bin/env bash
# Run BSQ builder for all matches in configs/matches.yaml
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

OUTPUT_DIR="${OUTPUT_DIR:-metrics-calculation/outputs/all_matches}"
AWS_PROFILE="${AWS_PROFILE:-hackathon}"
EXTRA_ARGS=()
if [[ $# -gt 0 ]]; then
  EXTRA_ARGS=("$@")
fi
SKIP_DATA_CHECK=0

if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
  for arg in "${EXTRA_ARGS[@]}"; do
    [[ "$arg" == "--no-s3" ]] && SKIP_DATA_CHECK=1
  done
fi

if [[ -f aws-hackathon.env ]]; then
  # shellcheck disable=SC1091
  source aws-hackathon.env
fi

if [[ "$SKIP_DATA_CHECK" -eq 0 && -z "${HACKATHON_DATA_ROOT:-}" ]]; then
  echo "Set HACKATHON_DATA_ROOT to a folder OUTSIDE this repo (hackathon data must not be in git):" >&2
  echo "  export HACKATHON_DATA_ROOT=\"\$HOME/bundesliga-challenge2-data\"" >&2
  echo "  # expects: \$HACKATHON_DATA_ROOT/Match_Data/<match>/kpi_data_*.xml …" >&2
  exit 1
fi

DATA_ROOT="${DATA_ROOT:-${HACKATHON_DATA_ROOT:?}/Match_Data}"

if ! python -c "import shooting1.build" 2>/dev/null; then
  echo "Install package first: pip install -e \".[metrics]\"" >&2
  exit 1
fi

BUILD_ARGS=(
  --data-root "$DATA_ROOT"
  --output-dir "$OUTPUT_DIR"
  --aws-profile "$AWS_PROFILE"
)
if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
  BUILD_ARGS+=("${EXTRA_ARGS[@]}")
fi
python -m shooting1.build "${BUILD_ARGS[@]}"

echo "Wrote outputs to $OUTPUT_DIR"
