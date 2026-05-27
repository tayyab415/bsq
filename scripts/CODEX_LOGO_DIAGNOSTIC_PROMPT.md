# Codex diagnostic prompt: stretched club logos in BSQ leaderboards

## Symptom (user report)

In Jupyter notebook `metrics-calculation/notebooks/05_metric_leaderboards.ipynb`, horizontal bar leaderboards show **club logos stretched horizontally** (Bayern circle looks like an oval). Image also looks **low resolution / blurry** in VS Code notebook output.

## Stack

- Python 3.11, matplotlib, Pillow
- Renderer: `final-repo/src/aws_football/bsq_leaderboards_v2.py`
- Logos: `/Users/tayyabkhan/Downloads/aws/logos/` (SVG + PNG per team)
- Display: `display_leaderboard_image()` embeds base64 PNG in HTML `<img width={w} height={h}>`
- Notebook imports v2 with `importlib.reload`

## Pipeline (current v2)

1. Matplotlib draws bars/names at `OUTPUT_DPI=200`, `figsize=(9, h)` inches.
2. `fig.savefig` → PIL RGBA canvas.
3. `_composite_logos()` maps bar-axis row centers to pixel coords, `PIL.Image.paste()` with `_fit_logo()` (`thumbnail` max 54×46, preserves aspect).
4. HTML display with explicit pixel width/height.

Previous attempts failed: Plotly layout, matplotlib OffsetImage/AnnotationBbox on narrow axes, figure-coordinate AnnotationBbox.

## Automated diagnostic already run

```bash
cd /Users/tayyabkhan/Downloads/aws/final-repo
python3 scripts/diagnose_leaderboard_logos.py
```

Key findings:

- After `load_logo_image()`, **all teams report 256×256 px** (aspect 1.0) — likely `qlmanage -t -s 512` square thumbnails squashing wide crests before PIL ever sees them.
- `_fit_logo()` stamp is 46×46 (aspect 1.0) — paste step preserves square, but **content may already be distorted**.
- Crop aspect in final PNG for “Bayern region” was ~1.625 (crop box may be wrong, or composite x/y mapping off).

Outputs:

- `derived/logo_diagnostics/leaderboard_diag.png`
- `derived/logo_diagnostics/display_test.html` (tests width:100% CSS squash)

## Your tasks

1. **Read** `src/aws_football/bsq_leaderboards_v2.py` and `scripts/diagnose_leaderboard_logos.py`.
2. **Run** the diagnostic script and inspect `derived/logo_diagnostics/`.
3. **Identify root cause(s)** with evidence (source file dimensions vs cache vs stamp vs final PNG).
4. **Check** whether Jupyter/VS Code CSS (`max-width:100%`, missing height, output scaling) is a separate display-layer issue.
5. **Implement a fix** in v2 (or v3) that:
   - Rasterizes SVG/PNG at **correct aspect ratio** (no square qlmanage thumb; prefer native PNG, rsvg, inkscape, or PIL-only letterbox).
   - Composites logos at correct row y (verify bbox math after savefig).
   - Displays at 200+ DPI without browser stretch (consider `IPython.display.Image`, SVG wrapper, or `object-fit: contain`).
6. **Re-run** diagnostic and confirm Bayern circle aspect ≈ 1.0 in output crop.

## Constraints

- Bundesliga aesthetics: black bars, red leader only (`#C4050E`), white background.
- Do not download full S3 dataset.
- macOS has `qlmanage`; may not have cairo.

Return: concise diagnosis + list of files changed + before/after aspect metrics.
