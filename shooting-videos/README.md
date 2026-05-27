# Shooting videos (Remotion)

Broadcast-style **telestration explainers** per shot, driven by metric outputs + exported shot JSON bundles.

## Layout

```text
shooting-videos/
  remotion/           # Remotion project (sync from aws/shooting-remotion, no node_modules)
  scripts/
    export_shot_bundle.sh
    render_template_a.sh
  data/               # per-shot JSON for compositions (small, committable)
  outputs/            # rendered MP4s (gitignored; use for presentation_video.mp4)
```

## Workflow

1. Reproduce metrics (`../scripts/reproduce.sh`).
2. Export shot bundles:

   ```bash
   ./shooting-videos/scripts/export_shot_bundle.sh
   ```

3. Install and render:

   ```bash
   cd shooting-videos/remotion
   npm ci
   npm run render:template-a
   ```

4. Copy a hero MP4 to your submission zip as `presentation_video.mp4` (≤3 min, &lt;720p).

## Key compositions (after sync)

| Composition | Description |
|-------------|-------------|
| `PhaseMechanicsGroundedA4` | ~15.5 s grounded telestration (Template A) |
| `ShotBreakdownV4` | Full phase breakdown (planned) |

## Presentation deliverable

The hackathon asks for a **demo video**, not necessarily every rendered variant. Commit **source + scripts**; upload one polished MP4 in the zip.
