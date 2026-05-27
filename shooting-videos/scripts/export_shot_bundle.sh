#!/usr/bin/env bash
# Export Remotion shot JSON from metric outputs (wraps workspace script after sync)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WS_SCRIPT="$ROOT/scripts/remotion_explainer_export.py"

if [[ -f "$WS_SCRIPT" ]]; then
  exec python "$WS_SCRIPT" "$@"
fi

if [[ -f "$ROOT/shooting-videos/scripts/remotion_explainer_export.py" ]]; then
  exec python "$ROOT/shooting-videos/scripts/remotion_explainer_export.py" "$@"
fi

echo "Export script not found. Run sync_from_workspace.sh or copy scripts/remotion_explainer_export.py" >&2
exit 1
