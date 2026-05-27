"""V2 metric leaderboards — high-DPI bars + PIL logo compositing (no stretch)."""

from __future__ import annotations

import io
import math
import re
import shutil
import subprocess
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from PIL import Image

from aws_football.bsq_fonts import apply_matplotlib_font_settings, font_properties, matplotlib_font_status
from aws_football.bsq_reports import (
    DEFAULT_REFERENCE_DIR,
    METRIC_COLUMNS,
    load_reference_tables,
    merge_shot_tables,
    notebook_plot_style_html,
)
from aws_football.bsq_theme import BSQ_COLORS as THEME_COLORS

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_ROOT = REPO_ROOT.parent

OUTPUT_DPI = 300  # export-grade PNG; notebook display scales down for screen
FIG_WIDTH_IN = 9.0
LOGO_RASTER_MAX_PX = 1024

# Layout (figure fractions): header band | logo | name | bars
HEADER_HEIGHT_FRAC = 0.17
PANEL_BOTTOM = 0.11
PANEL_HEIGHT = 0.70
PANEL_TOP = PANEL_BOTTOM + PANEL_HEIGHT

HEADER_RECT = [0.055, PANEL_TOP, 0.90, HEADER_HEIGHT_FRAC]
LOGO_RECT = [0.055, PANEL_BOTTOM, 0.095, PANEL_HEIGHT]
NAME_RECT = [0.155, PANEL_BOTTOM, 0.125, PANEL_HEIGHT]
BAR_RECT = [0.285, PANEL_BOTTOM, 0.695, PANEL_HEIGHT]

FONT_TITLE = 20
FONT_SUBTITLE = 12
FONT_HEADER = 10.5
FONT_PLAYER = 13
FONT_VALUE = 12
FONT_AXIS = 11.5
FONT_TICK = 10.5
FONT_FOOTNOTE = 9

ROW_HEIGHT_IN = 0.32
HEADER_BLOCK_IN = 1.05
BAR_HEIGHT = 0.56  # thinner bars → more vertical gap between rows


def _logo_stamp_limits() -> tuple[int, int]:
    scale = OUTPUT_DPI / 200
    return round(62 * scale), round(52 * scale)


def _figure_height_inches(row_count: int) -> float:
    return max(2.5, HEADER_BLOCK_IN + ROW_HEIGHT_IN * row_count)


def _fig_x_in_axes(fig_x: float, axes_rect: list[float]) -> float:
    left, _, width, _ = axes_rect
    return (fig_x - left) / width


def _draw_header(
    fig: plt.Figure,
    *,
    title: str,
    subtitle: str,
    logo_rect: list[float],
    name_rect: list[float],
) -> None:
    """Title block in its own axes so large fonts never overlap the chart."""
    ax = fig.add_axes(HEADER_RECT)
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.axis("off")

    ax.text(
        0.0,
        0.98,
        title,
        ha="left",
        va="top",
        fontsize=FONT_TITLE,
        fontproperties=font_properties(700),
        color=AESTHETICS["ink"],
    )
    ax.text(
        0.0,
        0.58,
        subtitle,
        ha="left",
        va="top",
        fontsize=FONT_SUBTITLE,
        fontproperties=font_properties(400),
        color=AESTHETICS["ink_muted"],
    )

    club_x = _fig_x_in_axes(logo_rect[0] + logo_rect[2] / 2, HEADER_RECT)
    player_x = _fig_x_in_axes(name_rect[0] + name_rect[2] / 2, HEADER_RECT)
    ax.text(
        club_x,
        0.10,
        "Club",
        ha="center",
        va="center",
        fontsize=FONT_HEADER,
        fontproperties=font_properties(600),
        color=AESTHETICS["ink_muted"],
    )
    ax.text(
        player_x,
        0.10,
        "Player",
        ha="center",
        va="center",
        fontsize=FONT_HEADER,
        fontproperties=font_properties(600),
        color=AESTHETICS["ink_muted"],
    )

AESTHETICS = {
    "bg": THEME_COLORS["paper"],
    "ink": THEME_COLORS["ink"],
    "ink_muted": THEME_COLORS["ink_muted"],
    "bundesliga_red": THEME_COLORS["accent"],
    "bundesliga_red_dark": THEME_COLORS["accent_dark"],
    "grid": THEME_COLORS["grid"],
    "bar_neutral": THEME_COLORS["bar_neutral"],
}

TEAM_LOGO_FILES: dict[str, str] = {
    "DFL-CLU-000007": "DFL-CLU-000007_Dortmund.svg",
    "DFL-CLU-00000C": "DFL-CLU-00000C_Hamburg.svg",
    "DFL-CLU-00000D": "DFL-CLU-00000D_Stuttgart.svg",
    "DFL-CLU-00000F": "DFL-CLU-00000F_Frankfurt.svg",
    "DFL-CLU-00000G": "DFL-CLU-00000G_Bayern.svg",
    "DFL-CLU-00000V": "DFL-CLU-00000V_Union_Berlin.svg",
}

ALL_METRIC_COLUMNS: dict[str, str] = METRIC_COLUMNS

_LOGO_CACHE: dict[str, Image.Image] = {}


def resolve_logo_dir() -> Path | None:
    for candidate in (
        WORKSPACE_ROOT / "logos",
        WORKSPACE_ROOT / "web" / "visualizer" / "logos",
        REPO_ROOT / "logos",
    ):
        if candidate.is_dir():
            return candidate
    return None


def _svg_viewbox_size(path: Path) -> tuple[float, float] | None:
    if path.suffix.lower() != ".svg":
        return None
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None
    match = re.search(r'viewBox\s*=\s*["\']\s*([^\s,"\']+)\s+([^\s,"\']+)\s+([^\s,"\']+)\s+([^\s,"\']+)', text)
    if match:
        width = float(match.group(3))
        height = float(match.group(4))
        if width > 0 and height > 0:
            return width, height
    width_match = re.search(r'\bwidth\s*=\s*["\']\s*([0-9.]+)', text)
    height_match = re.search(r'\bheight\s*=\s*["\']\s*([0-9.]+)', text)
    if width_match and height_match:
        width = float(width_match.group(1))
        height = float(height_match.group(1))
        if width > 0 and height > 0:
            return width, height
    return None


def _image_aspect(path: Path) -> float | None:
    try:
        with Image.open(path) as img:
            width, height = img.size
    except OSError:
        return None
    return width / height if height else None


def logo_path_for_team(team_id: str) -> Path | None:
    if not team_id or pd.isna(team_id):
        return None
    logo_dir = resolve_logo_dir()
    if not logo_dir:
        return None
    stem = TEAM_LOGO_FILES.get(str(team_id))
    if not stem:
        return None
    svg_path = logo_dir / stem
    png_path = logo_dir / stem.replace(".svg", ".png")
    if png_path.exists():
        svg_size = _svg_viewbox_size(svg_path) if svg_path.exists() else None
        png_aspect = _image_aspect(png_path)
        if svg_size is None or png_aspect is None:
            return png_path
        svg_aspect = svg_size[0] / svg_size[1]
        if math.isclose(png_aspect, svg_aspect, rel_tol=0.03):
            return png_path
    if svg_path.exists():
        return svg_path
    return None


def _target_svg_raster_size(path: Path) -> tuple[int, int] | None:
    size = _svg_viewbox_size(path)
    if size is None:
        return None
    width, height = size
    scale = LOGO_RASTER_MAX_PX / max(width, height)
    return max(1, round(width * scale)), max(1, round(height * scale))


def _repair_raster_aspect(png_path: Path, target_size: tuple[int, int]) -> None:
    expected_aspect = target_size[0] / target_size[1]
    with Image.open(png_path).convert("RGBA") as img:
        if img.height and math.isclose(img.width / img.height, expected_aspect, rel_tol=0.03):
            return
        if img.width >= img.height:
            fixed_size = (img.width, max(1, round(img.width / expected_aspect)))
        else:
            fixed_size = (max(1, round(img.height * expected_aspect)), img.height)
        img.resize(fixed_size, Image.Resampling.LANCZOS).save(png_path)


def _run_svg_converter(path: Path, out: Path, target_size: tuple[int, int]) -> bool:
    width, height = target_size
    commands: list[list[str]] = []
    if shutil.which("rsvg-convert"):
        commands.append(["rsvg-convert", "-w", str(width), "-h", str(height), "-o", str(out), str(path)])
    if shutil.which("inkscape"):
        commands.append(
            [
                "inkscape",
                str(path),
                "--export-type=png",
                f"--export-filename={out}",
                f"--export-width={width}",
                f"--export-height={height}",
            ]
        )
    if shutil.which("sips"):
        commands.append(["sips", "-s", "format", "png", str(path), "--out", str(out)])

    for command in commands:
        result = subprocess.run(command, check=False, capture_output=True, text=True)
        if result.returncode == 0 and out.exists():
            _repair_raster_aspect(out, target_size)
            return True
    return False


def _rasterize_logo(path: Path) -> Path:
    """Return a PNG path. Repair square Quick Look thumbs before PIL sees them."""
    if path.suffix.lower() == ".png":
        return path

    cache_dir = resolve_logo_dir()
    if cache_dir is None:
        return path
    target_size = _target_svg_raster_size(path)
    if target_size is None:
        return path
    cache = cache_dir / ".png_cache"
    cache.mkdir(parents=True, exist_ok=True)
    out = cache / f"{path.stem}_{target_size[0]}x{target_size[1]}.png"
    if out.exists() and out.stat().st_mtime >= path.stat().st_mtime:
        _repair_raster_aspect(out, target_size)
        return out

    if _run_svg_converter(path, out, target_size):
        return out

    subprocess.run(
        ["qlmanage", "-t", "-s", "512", "-o", str(cache), str(path)],
        check=False,
        capture_output=True,
    )
    generated = cache / f"{path.name}.png"
    if generated.exists():
        generated.replace(out)
        _repair_raster_aspect(out, target_size)
    if out.exists():
        return out

    legacy = cache / f"{path.stem}.png"
    if legacy.exists():
        _repair_raster_aspect(legacy, target_size)
        return legacy
    return path


def load_logo_image(team_id: str) -> Image.Image | None:
    key = str(team_id)
    if key in _LOGO_CACHE:
        return _LOGO_CACHE[key].copy()
    path = logo_path_for_team(key)
    if path is None:
        return None
    try:
        img = Image.open(_rasterize_logo(path)).convert("RGBA")
        _LOGO_CACHE[key] = img
        return img.copy()
    except OSError:
        return None


def short_player_name(name: str) -> str:
    parts = str(name).strip().split()
    if len(parts) >= 2:
        return f"{parts[0][0]}. {parts[-1]}"
    return str(name)


def load_leaderboard_shots(reference_dir: Path | None = None) -> pd.DataFrame:
    root = Path(reference_dir or DEFAULT_REFERENCE_DIR)
    df = merge_shot_tables(load_reference_tables())
    if "team_id" in df.columns:
        return df
    shots = pd.read_csv(root / "shots.csv")
    if "team_id" not in shots.columns:
        return df
    return df.merge(shots[["event_id", "team_id"]], on="event_id", how="left")


def player_metric_leaderboard(
    df: pd.DataFrame,
    metric_col: str,
    *,
    top_n: int = 15,
    min_shots: int = 2,
) -> pd.DataFrame:
    if metric_col not in df.columns:
        raise KeyError(f"Column {metric_col!r} not in dataframe")
    work = df.dropna(subset=[metric_col, "player_name"]).copy()
    if work.empty:
        return pd.DataFrame(
            columns=["player_name", "player_label", "team_name", "team_id", "score", "shots"]
        )
    grouped = (
        work.groupby(["player_name", "team_name", "team_id"], dropna=False)
        .agg(score=(metric_col, "mean"), shots=("event_id", "count"))
        .reset_index()
    )
    grouped = grouped[grouped["shots"] >= min_shots]
    grouped = grouped.sort_values("score", ascending=False).head(top_n)
    grouped["player_label"] = grouped["player_name"].map(short_player_name)
    grouped["score"] = grouped["score"].round(1)
    return grouped.reset_index(drop=True)


def _fit_logo(logo: Image.Image) -> Image.Image:
    """Resize keeping aspect ratio — never stretch."""
    max_w, max_h = _logo_stamp_limits()
    out = logo.copy()
    out.thumbnail((max_w, max_h), Image.Resampling.LANCZOS)
    return out


def _paste_logo(canvas: Image.Image, logo: Image.Image, center_x: float, center_y: float) -> None:
    stamp = _fit_logo(logo)
    x = int(round(center_x - stamp.width / 2))
    y = int(round(center_y - stamp.height / 2))
    canvas.paste(stamp, (x, y), stamp)


def _logo_anchor_pixels(
    fig: plt.Figure,
    ax_bar: plt.Axes,
    bars,
    *,
    logo_rect: list[float],
    canvas_size: tuple[int, int],
) -> tuple[float, list[float]]:
    """Map each bar centre to PNG pixels so logos line up with rows exactly."""
    fig.canvas.draw()
    canvas_w, canvas_h = canvas_size
    logo_cx_fig = logo_rect[0] + logo_rect[2] / 2
    logo_cx_px = fig.transFigure.transform((logo_cx_fig, 0.5))[0]

    row_centers_px: list[float] = []
    for bar in bars:
        y_center = bar.get_y() + bar.get_height() / 2
        _, py_display = ax_bar.transData.transform((0.0, y_center))
        row_centers_px.append(canvas_h - py_display)

    return logo_cx_px, row_centers_px


def _composite_logos(
    canvas: Image.Image,
    plot_df: pd.DataFrame,
    *,
    fig: plt.Figure,
    ax_bar: plt.Axes,
    bars,
    logo_rect: list[float],
) -> Image.Image:
    """Paste logos on bar row centres (matplotlib transform, not estimated fractions)."""
    logo_cx, row_centers = _logo_anchor_pixels(
        fig, ax_bar, bars, logo_rect=logo_rect, canvas_size=canvas.size
    )

    for row, row_center_px in zip(plot_df.itertuples(), row_centers):
        logo = load_logo_image(str(row.team_id))
        if logo is None:
            continue
        _paste_logo(canvas, logo, logo_cx, row_center_px)

    return canvas


def render_leaderboard_image(
    board: pd.DataFrame,
    *,
    title: str,
    subtitle: str = "Mean BSQ score · five-match Bundesliga sample (127 shots)",
    footnote: str = "Min. 2 shots in sample · higher is better",
) -> Image.Image:
    """Render full leaderboard as a PIL image (bars via mpl, logos via PIL paste)."""
    apply_matplotlib_font_settings()
    if board.empty:
        fig, ax = plt.subplots(figsize=(FIG_WIDTH_IN, 2), dpi=OUTPUT_DPI, facecolor=AESTHETICS["bg"])
        ax.axis("off")
        ax.text(0, 1, title, fontsize=16, fontproperties=font_properties(700), va="top")
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=OUTPUT_DPI, facecolor=AESTHETICS["bg"])
        plt.close(fig)
        buf.seek(0)
        return Image.open(buf).convert("RGBA")

    plot_df = board.sort_values("score", ascending=True).reset_index(drop=True)
    n = len(plot_df)
    y = np.arange(n, dtype=float)
    leader_idx = n - 1

    fig_h = _figure_height_inches(n)
    fig = plt.figure(figsize=(FIG_WIDTH_IN, fig_h), dpi=OUTPUT_DPI, facecolor=AESTHETICS["bg"])

    logo_rect = LOGO_RECT
    name_rect = NAME_RECT
    bar_rect = BAR_RECT

    _draw_header(fig, title=title, subtitle=subtitle, logo_rect=logo_rect, name_rect=name_rect)

    ax_bar = fig.add_axes(bar_rect)
    ax_name = fig.add_axes(name_rect, sharey=ax_bar)
    ax_name.set_xlim(0, 1)
    ax_name.axis("off")

    score_max = float(plot_df["score"].max())
    xmax = float(np.ceil(score_max * 1.15 / 5) * 5)
    xmax = max(xmax, score_max + 3, 20)

    bar_colors = [
        AESTHETICS["bundesliga_red"] if i == leader_idx else AESTHETICS["bar_neutral"]
        for i in range(n)
    ]

    bars = ax_bar.barh(
        y,
        plot_df["score"],
        height=BAR_HEIGHT,
        color=bar_colors,
        edgecolor=AESTHETICS["bundesliga_red_dark"],
        linewidth=0.45,
        align="center",
    )
    ax_bar.set_xlim(0, xmax)
    ax_bar.set_ylim(-0.5, n - 0.5)
    ax_bar.set_xlabel(
        "Mean BSQ score",
        fontsize=FONT_AXIS,
        fontproperties=font_properties(500),
        color=AESTHETICS["ink_muted"],
        labelpad=2,
    )
    ax_bar.tick_params(axis="x", colors=AESTHETICS["ink_muted"], labelsize=FONT_TICK)
    ax_bar.yaxis.set_visible(False)
    ax_bar.spines[["top", "right", "left"]].set_visible(False)
    ax_bar.spines["bottom"].set_color(AESTHETICS["grid"])
    ax_bar.grid(axis="x", color=AESTHETICS["grid"], linestyle=":", linewidth=0.7, alpha=0.85)
    ax_bar.set_axisbelow(True)

    for i, row in enumerate(plot_df.itertuples()):
        ax_name.text(
            0.0,
            float(i),
            row.player_label,
            ha="left",
            va="center",
            fontsize=FONT_PLAYER,
            fontproperties=font_properties(500),
            color=AESTHETICS["ink"],
        )

    for i, (bar, score) in enumerate(zip(bars, plot_df["score"])):
        is_leader = i == leader_idx
        ax_bar.text(
            bar.get_width() + xmax * 0.012,
            bar.get_y() + bar.get_height() / 2,
            f"{score:.1f}",
            va="center",
            ha="left",
            fontsize=FONT_VALUE,
            fontproperties=font_properties(700 if is_leader else 500),
            color=AESTHETICS["bundesliga_red"] if is_leader else AESTHETICS["ink"],
        )

    ax_bar.text(
        1.0,
        -0.11,
        footnote,
        transform=ax_bar.transAxes,
        ha="right",
        va="top",
        fontsize=FONT_FOOTNOTE,
        fontproperties=font_properties(400),
        color=AESTHETICS["ink_muted"],
    )

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=OUTPUT_DPI, facecolor=AESTHETICS["bg"], edgecolor="none")
    buf.seek(0)
    canvas = Image.open(buf).convert("RGBA")
    canvas = _composite_logos(
        canvas,
        plot_df,
        fig=fig,
        ax_bar=ax_bar,
        bars=bars,
        logo_rect=logo_rect,
    )
    plt.close(fig)
    return canvas


def leaderboard_png_bytes(
    board: pd.DataFrame,
    *,
    title: str,
    subtitle: str = "Mean BSQ score · five-match Bundesliga sample (127 shots)",
    footnote: str = "Min. 2 shots in sample · higher is better",
) -> bytes:
    img = render_leaderboard_image(
        board, title=title, subtitle=subtitle, footnote=footnote
    )
    out = io.BytesIO()
    img.save(out, format="PNG", optimize=False)
    return out.getvalue()


def display_leaderboard_image(img: Image.Image) -> None:
    """Show export-DPI PNG as image/png output (GitHub notebook viewer + VS Code)."""
    from aws_football.bsq_reports import display_png_bytes

    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False)
    display_png_bytes(buf.getvalue())


def save_leaderboard_image(
    img: Image.Image,
    path: str | Path,
    *,
    dpi: int | None = None,
) -> Path:
    """Write PNG; default dpi metadata matches render DPI for clean slides."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, format="PNG", dpi=(dpi or OUTPUT_DPI, dpi or OUTPUT_DPI))
    return out


def matplotlib_metric_leaderboard(
    board: pd.DataFrame,
    *,
    title: str,
    subtitle: str = "Mean BSQ score · five-match Bundesliga sample (127 shots)",
    footnote: str = "Min. 2 shots in sample · higher is better",
):
    """Compat: returns a minimal figure; prefer render_leaderboard_image / display."""
    img = render_leaderboard_image(board, title=title, subtitle=subtitle, footnote=footnote)
    fig, ax = plt.subplots(figsize=(FIG_WIDTH_IN, 2), dpi=OUTPUT_DPI)
    ax.imshow(img)
    ax.axis("off")
    return fig


plotly_metric_leaderboard = matplotlib_metric_leaderboard
plotly_dark_leaderboard = matplotlib_metric_leaderboard


def display_metric_leaderboards(
    df: pd.DataFrame,
    metrics: dict[str, str] | None = None,
    *,
    top_n: int = 15,
    min_shots: int = 2,
    export_dir: str | Path | None = None,
) -> None:
    from IPython.display import HTML, display

    metrics = metrics or ALL_METRIC_COLUMNS
    display(HTML(notebook_plot_style_html()))
    apply_matplotlib_font_settings()
    print(matplotlib_font_status())
    plt.rcParams.update(
        {
            "figure.facecolor": AESTHETICS["bg"],
            "axes.facecolor": AESTHETICS["bg"],
        }
    )
    for label, col in metrics.items():
        board = player_metric_leaderboard(df, col, top_n=top_n, min_shots=min_shots)
        if board.empty:
            continue
        leader = board.iloc[0]
        title = f"Who leads on {label}?"
        subtitle = (
            f"Top {len(board)} players · leader: {leader['player_name']} "
            f"({leader['score']:.1f} BSQ)"
        )
        img = render_leaderboard_image(board, title=title, subtitle=subtitle)
        display_leaderboard_image(img)
        if export_dir is not None:
            slug = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
            save_leaderboard_image(img, Path(export_dir) / f"{slug}.png")


def notebook_dark_style_html() -> str:
    return notebook_plot_style_html()
