#!/usr/bin/env bash
# Rebuild BSQ outputs with skeleton pitch-control pass routing (~35-50 min when AWS works).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f aws-hackathon.env ]]; then
  # shellcheck disable=SC1091
  source aws-hackathon.env
fi

echo "Checking AWS profile ${AWS_PROFILE:-hackathon}..."
if ! aws sts get-caller-identity --profile "${AWS_PROFILE:-hackathon}" --cli-connect-timeout 5 --cli-read-timeout 10 >/dev/null 2>&1; then
  echo "AWS credentials missing or expired. Run from repo root:" >&2
  echo "  ./bin/hackathon login" >&2
  exit 1
fi

export HACKATHON_DATA_ROOT="${HACKATHON_DATA_ROOT:-$HOME/bundesliga-challenge2-data}"
if [[ ! -d "${HACKATHON_DATA_ROOT}/Match_Data" ]]; then
  export HACKATHON_DATA_ROOT="${HACKATHON_DATA_ROOT:-$(dirname "$ROOT")/data-small}"
fi

pip install -e ".[metrics]" -q
python -m shooting1.build \
  --data-root "${HACKATHON_DATA_ROOT}/Match_Data" \
  --output-dir metrics-calculation/outputs/all_matches \
  --skip-tracking-samples \
  --skip-review-artifacts \
  "$@"

./scripts/export_reference_outputs.sh metrics-calculation/outputs/all_matches
echo "Done. Re-run notebooks: jupyter nbconvert --execute --inplace metrics-calculation/notebooks/02_*.ipynb metrics-calculation/notebooks/03_*.ipynb"
