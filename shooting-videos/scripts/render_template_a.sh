#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REMOTION="$ROOT/shooting-videos/remotion"
OUT="$ROOT/shooting-videos/outputs/template-a"
PUBLIC="$REMOTION/public/template-a"

if [[ ! -d "$REMOTION/src" ]]; then
  echo "Remotion project missing — sync shooting-remotion into shooting-videos/remotion" >&2
  exit 1
fi

mkdir -p "$OUT" "$PUBLIC"
cd "$REMOTION"

for id in bahoya gnabry goretzka; do
  if [[ ! -f "$PUBLIC/${id}.json" ]]; then
    echo "Missing $PUBLIC/${id}.json — run export_shot_bundle.sh first" >&2
    exit 1
  fi
  out="$OUT/template-a-${id}.mp4"
  echo "Rendering → $out"
  npx remotion render src/index.ts PhaseMechanicsGroundedA4 "$out" \
    --codec=h264 --concurrency=1 --props="{\"shotId\":\"${id}\"}"
done

echo "Done: $OUT"
