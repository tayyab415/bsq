#!/usr/bin/env python3
"""Diagnostics for stretched/low-quality logos in BSQ leaderboards."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", str(Path("/private/tmp") / "matplotlib-cache"))

import matplotlib

matplotlib.use("Agg")

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "src"))

from aws_football.bsq_leaderboards_v2 import (  # noqa: E402
    FIG_WIDTH_IN,
    LOGO_RECT,
    OUTPUT_DPI,
    _fit_logo,
    _logo_stamp_limits,
    _row_center_px,
    _rasterize_logo,
    _svg_viewbox_size,
    load_leaderboard_shots,
    load_logo_image,
    logo_path_for_team,
    player_metric_leaderboard,
    render_leaderboard_image,
)

REFERENCE = REPO / "metrics-calculation" / "reference_outputs"
OUT_DIR = REPO / "derived" / "logo_diagnostics"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def _image_metrics(path: Path | None) -> dict:
    if path is None:
        return {}
    from PIL import Image

    if path.suffix.lower() == ".svg":
        svg_size = _svg_viewbox_size(path)
        return {
            "path": str(path),
            "kind": "svg",
            "viewbox": [round(svg_size[0], 2), round(svg_size[1], 2)] if svg_size else None,
            "aspect_w_over_h": round(svg_size[0] / svg_size[1], 4) if svg_size else None,
        }
    try:
        img = Image.open(path)
    except OSError:
        return {"path": str(path), "error": "unreadable"}
    w, h = img.size
    return {
        "path": str(path),
        "kind": path.suffix.lower().lstrip("."),
        "px": [w, h],
        "aspect_w_over_h": round(w / h, 4) if h else None,
    }


def logo_source_metrics(team_id: str) -> dict:
    selected_path = logo_path_for_team(team_id)
    img = load_logo_image(team_id)
    if img is None:
        return {"team_id": team_id, "error": "no logo"}
    w, h = img.size
    raster_path = _rasterize_logo(selected_path) if selected_path else None
    return {
        "team_id": team_id,
        "selected": _image_metrics(selected_path),
        "rasterized": _image_metrics(raster_path),
        "source_px": [w, h],
        "source_aspect_w_over_h": round(w / h, 4) if h else None,
    }


def measure_stamp_aspect(team_id: str) -> dict:
    img = load_logo_image(team_id)
    if img is None:
        return {"team_id": team_id, "error": "no logo"}
    stamp = _fit_logo(img)
    w, h = stamp.size
    return {
        "team_id": team_id,
        "stamp_px": [w, h],
        "stamp_aspect_w_over_h": round(w / h, 4) if h else None,
    }


def bbox_aspect_in_png(png_path: Path, x0: int, x1: int, y0: int, y1: int) -> float | None:
    import numpy as np
    from PIL import Image

    arr = np.array(Image.open(png_path).convert("RGBA"))
    crop = arr[y0:y1, x0:x1]
    alpha = crop[:, :, 3]
    rgb = crop[:, :, :3].astype(int)
    non_white = (abs(rgb - 255) > 12).any(axis=2)
    mask = (alpha > 32) & non_white
    if not mask.any():
        return None
    ys, xs = np.where(mask)
    w = xs.max() - xs.min() + 1
    h = ys.max() - ys.min() + 1
    return round(w / h, 4) if h else None


def logo_bbox_aspects(
    png_path: Path,
    plot_df,
    team_id: str,
) -> list[dict]:
    from PIL import Image

    aspects = []
    for i, row in enumerate(plot_df.itertuples()):
        if str(row.team_id) != team_id:
            continue
        img = load_logo_image(team_id)
        if img is None:
            continue
        stamp = _fit_logo(img)
        with Image.open(png_path) as rendered:
            cx = (LOGO_RECT[0] + LOGO_RECT[2] / 2) * rendered.size[0]
            cy = _row_center_px(i, len(plot_df), panel_rect=LOGO_RECT, canvas_h=rendered.size[1])
        max_w, max_h = _logo_stamp_limits()
        pad_x = max(max_w, stamp.width) / 2 + 3
        pad_y = max(max_h, stamp.height) / 2 + 3
        aspect = bbox_aspect_in_png(
            png_path,
            int(round(cx - pad_x)),
            int(round(cx + pad_x)),
            int(round(cy - pad_y)),
            int(round(cy + pad_y)),
        )
        aspects.append(
            {
                "row_index_ascending": i,
                "player_name": row.player_name,
                "center_px": [round(cx, 1), round(cy, 1)],
                "content_bbox_aspect_w_over_h": aspect,
            }
        )
    return aspects


def main() -> None:
    report: dict = {"output_dpi": OUTPUT_DPI, "teams": [], "render": {}}

    team_ids = [
        "DFL-CLU-00000G",  # Bayern — round
        "DFL-CLU-000007",  # Dortmund
        "DFL-CLU-00000V",  # Union — wide
        "DFL-CLU-00000F",  # Frankfurt
    ]
    for tid in team_ids:
        entry = {
            "source": logo_source_metrics(tid),
            "stamp_after_fit": measure_stamp_aspect(tid),
        }
        report["teams"].append(entry)

    df = load_leaderboard_shots(REFERENCE)
    board = player_metric_leaderboard(df, "P2_score", top_n=15)
    img = render_leaderboard_image(
        board,
        title="DIAG: Arrival / receiving",
        subtitle="logo diagnostic render",
    )
    png_path = OUT_DIR / "leaderboard_diag.png"
    img.save(png_path)
    plot_df = board.sort_values("score", ascending=True).reset_index(drop=True)
    w, h = img.size
    report["render"] = {
        "png_path": str(png_path),
        "size_px": [w, h],
        "fig_width_in": FIG_WIDTH_IN,
        "effective_dpi_x": round(w / FIG_WIDTH_IN, 1),
        "effective_dpi_y": round(h / (0.38 * 15 + 1.45), 1),
    }

    report["render"]["bayern_logo_aspects"] = logo_bbox_aspects(
        png_path,
        plot_df,
        "DFL-CLU-00000G",
    )
    bayern_aspects = [
        row["content_bbox_aspect_w_over_h"]
        for row in report["render"]["bayern_logo_aspects"]
        if row["content_bbox_aspect_w_over_h"] is not None
    ]
    report["render"]["bayern_mean_content_aspect"] = (
        round(sum(bayern_aspects) / len(bayern_aspects), 4) if bayern_aspects else None
    )

    print(json.dumps(report, indent=2))

    html_path = OUT_DIR / "display_test.html"
    import base64
    import io

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    html_path.write_text(
        f"""<!DOCTYPE html>
<html><body style="margin:20px;background:#eee">
<h3>Native px (should be crisp, round Bayern)</h3>
<img src="data:image/png;base64,{b64}" width="{w}" height="{h}" style="width:{w}px;height:{h}px"/>
<h3>width:100% only (Jupyter-like squash?)</h3>
<img src="data:image/png;base64,{b64}" style="width:100%;height:auto"/>
<h3>width:100% + fixed height (broken aspect)</h3>
<img src="data:image/png;base64,{b64}" style="width:100%;height:400px"/>
<h3>retina notebook display style</h3>
<img src="data:image/png;base64,{b64}" width="{w}" style="width:min(100%, {round(w / (OUTPUT_DPI / 100))}px);height:auto;object-fit:contain;aspect-ratio:{w}/{h};display:block"/>
</body></html>"""
    )
    print(f"\nWrote {png_path} and {html_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
