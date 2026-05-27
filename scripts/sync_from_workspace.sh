#!/usr/bin/env bash
# Copy implementation files from the dev aws/ workspace into final-repo.
set -euo pipefail
WS="${1:?Usage: sync_from_workspace.sh /path/to/aws}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

copy_tree() {
  local src="$1" dst="$2"
  shift 2
  if [[ ! -d "$src" ]]; then
    echo "skip missing: $src" >&2
    return 0
  fi
  mkdir -p "$dst"
  rsync -a "$@" "$src/" "$dst/"
}

echo "Syncing from $WS → $ROOT"

copy_tree "$WS/shooting1" "$ROOT/metrics-calculation/shooting1" --exclude '__pycache__'
copy_tree "$WS/src/aws_football" "$ROOT/src/aws_football" --exclude '__pycache__'
copy_tree "$WS/web/visualizer" "$ROOT/visualizer/web"
cp -f "$WS/scripts/serve_visualizer.py" "$ROOT/visualizer/scripts/serve_visualizer.py" 2>/dev/null || true
cp -f "$WS/scripts/remotion_explainer_export.py" "$ROOT/shooting-videos/scripts/remotion_explainer_export.py" 2>/dev/null || true

copy_tree "$WS/shooting-remotion" "$ROOT/shooting-videos/remotion" \
  --exclude 'node_modules' \
  --exclude 'out' \
  --exclude '.remotion'

# Feature-name template only (no match rows). Skip if you prefer zero derived files in git.
# if [[ -f "$WS/derived/shooting_feature_phase_annotation_scale_v3.csv" ]]; then
#   mkdir -p "$ROOT/shooting-videos/data"
#   cp -f "$WS/derived/shooting_feature_phase_annotation_scale_v3.csv" "$ROOT/shooting-videos/data/"
# fi

chmod +x "$ROOT/scripts/reproduce.sh" \
  "$ROOT/metrics-calculation/scripts/"*.sh \
  "$ROOT/visualizer/scripts/serve.sh" \
  "$ROOT/shooting-videos/scripts/"*.sh 2>/dev/null || true

echo "Done. Next: pip install -e \".[metrics]\" && ./scripts/reproduce.sh"
