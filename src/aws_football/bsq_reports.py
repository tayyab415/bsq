"""Load BSQ reference outputs and build Plotly dashboards (no S3 required)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from aws_football.bsq_theme import BSQ_COLORS, BSQ_FONT, PROFILE_HIGHLIGHT_METRICS

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REFERENCE_DIR = REPO_ROOT / "metrics-calculation" / "reference_outputs"

MODULE_COLUMNS: dict[str, str] = {
    "Decision quality": "decision_quality_score",
    "Shot geometry": "shot_geometry_score",
    "Arrival / receiving": "arrival_receiving_score",
    "Approach / prep": "approach_prep_score",
    "Technique mechanics": "technique_mechanics_score",
    "Strike quality": "strike_quality_score",
    "Placement": "placement_score",
    "Strike output": "strike_output_score",
}

PHASE_COLUMNS: dict[str, str] = {
    "P1 Context": "P1_score",
    "P2 Approach": "P2_score",
    "P3 Backswing / coil": "P3_score",
    "P4 Impact": "P4_score",
    "P5 Follow-through": "P5_score",
    "P6 Outcome": "P6_score",
}

# Post / near-strike execution only — explains xG overperformance (not decision or chance quality).
FINISHING_EXECUTION_COMPONENT_COLUMNS: tuple[str, ...] = (
    "strike_quality_score",
    "goal_plane_lateral_score",
    "ball_exit_speed_m_s",
    "ball_to_foot_speed_ratio_score",
)

FINISHING_EXECUTION_INDEX_COL = "finishing_execution_index"

INDEX_COLUMNS: dict[str, str] = {
    "Finishing execution index": FINISHING_EXECUTION_INDEX_COL,
}

# All scored dimensions for profiles, leaderboards, and league tables.
METRIC_COLUMNS: dict[str, str] = {**MODULE_COLUMNS, **INDEX_COLUMNS, **PHASE_COLUMNS}

BACKSWING_PHASE_LABEL = "P3 Backswing / coil"
FOLLOW_THROUGH_PHASE_LABEL = "P5 Follow-through"

# Player profile bar chart thresholds (shot means on 0–100 BSQ scale).
PROFILE_BAR_HIGH_SCORE = 65.0
PROFILE_BAR_LOW_SCORE = 40.0

# Shown on profile bars when a module/phase mean is missing (suppressed score or tiny sample).
PROFILE_NA_BAR_LABEL = "N/A"
PROFILE_NA_REASON = "low confidence / small sample"


def use_bsq_plot_theme() -> None:
    """Register default Plotly template for all charts in this session."""
    import plotly.io as pio

    pio.templates["bsq_red"] = _build_plotly_template()
    pio.templates.default = "bsq_red"


def use_bsq_notebook_plotly() -> None:
    """Pick a Plotly renderer that works in VS Code / Cursor notebooks."""
    import plotly.io as pio

    use_bsq_plot_theme()
    for renderer in ("vscode", "plotly_mimetype+notebook", "notebook_connected", "iframe"):
        if renderer in pio.renderers:
            pio.renderers.default = renderer
            return renderer
    return pio.renderers.default


def display_png_bytes(png: bytes) -> None:
    """Show a PNG using the standard Jupyter image/png mime (GitHub + VS Code render this reliably)."""
    from IPython.display import Image, display

    display(Image(png))


def display_plotly_figure(fig, *, scale: int = 2) -> None:
    """Rasterize Plotly to PNG and store as image/png output (not HTML data-URIs)."""
    import plotly.io as pio

    width = int(fig.layout.width or 760)
    height = int(fig.layout.height or 420)
    png = pio.to_image(fig, format="png", width=width, height=height, scale=scale)
    display_png_bytes(png)


def _font(size: int, *, weight: int = 400, color: str | None = None) -> dict[str, Any]:
    return {
        "family": BSQ_FONT,
        "size": size,
        "color": color or BSQ_COLORS["ink"],
    }


def _build_plotly_template():
    import plotly.graph_objects as go
    import plotly.io as pio

    base_name = "plotly_white" if "plotly_white" in pio.templates else "plotly"
    template = pio.templates[base_name].to_plotly_json()
    layout = template.setdefault("layout", {})
    layout.update(
        {
            "font": _font(13, weight=400),
            "paper_bgcolor": BSQ_COLORS["paper"],
            "plot_bgcolor": BSQ_COLORS["plot"],
            "colorway": BSQ_COLORS["line_sequence"],
            "margin": {"l": 56, "r": 32, "t": 72, "b": 48},
        }
    )
    return go.layout.Template(template)


def apply_bsq_theme(fig, *, title: str | None = None, height: int | None = None) -> Any:
    """Apply BSQ presentation styling to any Plotly figure."""
    layout: dict[str, Any] = {
        "font": _font(13),
        "paper_bgcolor": BSQ_COLORS["paper"],
        "plot_bgcolor": BSQ_COLORS["plot"],
        "margin": dict(l=56, r=32, t=72 if title else 48, b=48),
    }
    if title:
        layout["title"] = {
            "text": f"<b>{title}</b>",
            "font": _font(20, weight=600, color=BSQ_COLORS["ink_title"]),
            "x": 0.02,
            "xanchor": "left",
        }
    if height is not None:
        layout["height"] = height
    fig.update_layout(**layout)
    fig.update_xaxes(
        showgrid=True,
        gridcolor=BSQ_COLORS["grid"],
        gridwidth=1,
        griddash="dot",
        zeroline=False,
        linecolor=BSQ_COLORS["border"],
        tickfont=_font(12, weight=400, color=BSQ_COLORS["ink_muted"]),
        title_font=_font(13, weight=600, color=BSQ_COLORS["ink"]),
    )
    fig.update_yaxes(
        showgrid=False,
        zeroline=False,
        linecolor=BSQ_COLORS["border"],
        tickfont=_font(12, weight=500, color=BSQ_COLORS["ink"]),
        title_font=_font(13, weight=600, color=BSQ_COLORS["ink"]),
    )
    return fig


def _gauge_spec() -> dict[str, Any]:
    """Single speedometer track (used only for one-off highlight gauges)."""
    return {
        "axis": {
            "range": [0, 100],
            "tickmode": "array",
            "tickvals": [0, 25, 50, 75, 100],
            "tickwidth": 1,
            "tickcolor": BSQ_COLORS["ink_muted"],
            "tickfont": _font(11, weight=400, color=BSQ_COLORS["ink_muted"]),
        },
        "bar": {"color": BSQ_COLORS["gauge_bar"], "thickness": 0.22},
        "bgcolor": BSQ_COLORS["plot"],
        "borderwidth": 0,
        "bordercolor": BSQ_COLORS["border"],
        "steps": [{"range": [0, 100], "color": BSQ_COLORS["gauge_track"]}],
    }


def load_reference_tables(reference_dir: Path | None = None) -> dict[str, pd.DataFrame]:
    root = Path(reference_dir or DEFAULT_REFERENCE_DIR)
    return {
        "scores": pd.read_csv(root / "scores_v1.csv"),
        "shots": pd.read_csv(root / "shots.csv"),
        "features": pd.read_csv(root / "features.csv"),
    }


def add_finishing_execution_index(df: pd.DataFrame) -> pd.DataFrame:
    """Cohort percentile mean of post-strike execution signals (0–100 scale)."""
    out = df.copy()
    cols = [c for c in FINISHING_EXECUTION_COMPONENT_COLUMNS if c in out.columns]
    if not cols:
        out[FINISHING_EXECUTION_INDEX_COL] = pd.NA
        return out
    pct_frames = [
        out[col].rank(pct=True, method="average", na_option="keep") * 100.0 for col in cols
    ]
    out[FINISHING_EXECUTION_INDEX_COL] = pd.concat(pct_frames, axis=1).mean(axis=1, skipna=True)
    return out


def merge_shot_tables(tables: dict[str, pd.DataFrame] | None = None) -> pd.DataFrame:
    tables = tables or load_reference_tables()
    shot_cols = [
        "event_id",
        "match_folder",
        "player_name",
        "team_name",
        "team_id",
        "shot_result",
        "family",
        "xg",
    ]
    scores = tables["scores"]
    shots = tables["shots"]
    extra = [c for c in shot_cols if c in shots.columns and c not in scores.columns and c != "event_id"]
    use_cols = ["event_id", *extra]
    if not extra:
        use_cols = ["event_id", *[c for c in ("player_name", "team_name", "shot_result", "xg") if c in shots.columns]]
    merged = scores.merge(shots[use_cols], on="event_id", how="left")
    return add_finishing_execution_index(merged)


def player_summary(df: pd.DataFrame, player_name: str) -> pd.Series:
    sub = df[df["player_name"] == player_name]
    if sub.empty:
        raise ValueError(f"No shots for player {player_name!r}")
    numeric = sub.select_dtypes(include="number")
    return numeric.mean(numeric_only=True)


def league_match_summary(df: pd.DataFrame) -> pd.DataFrame:
    agg: dict[str, Any] = {"event_id": "count"}
    for col in MODULE_COLUMNS.values():
        if col in df.columns:
            agg[col] = "mean"
    if FINISHING_EXECUTION_INDEX_COL in df.columns:
        agg[FINISHING_EXECUTION_INDEX_COL] = "mean"
    for col in PHASE_COLUMNS.values():
        if col in df.columns:
            agg[col] = "mean"
    out = df.groupby("match_folder", as_index=False).agg(agg)
    out = out.rename(columns={"event_id": "shots"})
    return out


def plotly_speedometer(
    title: str,
    value: float,
    *,
    min_val: float = 0,
    max_val: float = 100,
    suffix: str = "",
):
    """Single gauge indicator (0–100 BSQ scale)."""
    import plotly.graph_objects as go

    v = float(value)
    if pd.isna(v):
        v = 0.0
    gauge = _gauge_spec()
    gauge["axis"]["range"] = [min_val, max_val]
    fig = go.Figure(
        go.Indicator(
            mode="gauge+number",
            value=v,
            number={
                "suffix": suffix,
                "font": _font(32, weight=700, color=BSQ_COLORS["accent"]),
            },
            title={
                "text": f"<span style='font-weight:600'>{title}</span>",
                "font": _font(14, weight=500, color=BSQ_COLORS["ink_muted"]),
            },
            gauge=gauge,
        )
    )
    fig.update_layout(
        height=300,
        width=420,
        margin=dict(l=32, r=32, t=64, b=20),
        paper_bgcolor=BSQ_COLORS["paper"],
        font=_font(13),
    )
    return fig


def plotly_phase_speedometer(player_means: pd.Series, phase_label: str):
    """Single speedometer for one shot phase (e.g. backswing or follow-through)."""
    col = PHASE_COLUMNS.get(phase_label)
    if col is None:
        raise KeyError(f"Unknown phase {phase_label!r}; choose from {list(PHASE_COLUMNS)}")
    if col not in player_means.index or pd.isna(player_means[col]):
        return plotly_speedometer(f"{phase_label} (no data)", 0.0)
    return plotly_speedometer(phase_label, float(player_means[col]))


def _score_column_label(col: str) -> str:
    for label, mapped in METRIC_COLUMNS.items():
        if mapped == col:
            return label
    if col == FINISHING_EXECUTION_INDEX_COL:
        return "Finishing execution index"
    aliases = {
        "ear_score": "EAR",
        "carry_progression_score": "Carry progression",
        "receiving_pressure_score": "Receiving pressure",
        "technique_score": "Technique (aggregate)",
        "P4_mech_score": "P4 mechanics",
        "P4_strike_score": "P4 strike",
    }
    if col in aliases:
        return aliases[col]
    return col.removesuffix("_score").replace("_", " ").title()


def _is_bsq_percentile_column(col: str, value: float) -> bool:
    if col == FINISHING_EXECUTION_INDEX_COL or col.endswith("_score"):
        return 0.0 <= value <= 100.0
    return False


def _all_player_metric_scores(player_means: pd.Series) -> list[tuple[str, float]]:
    """Every BSQ 0–100 score column present in the player's shot means."""
    pairs: list[tuple[str, float]] = []
    for col in player_means.index:
        raw = player_means[col]
        if pd.isna(raw):
            continue
        score = float(raw)
        if not _is_bsq_percentile_column(col, score):
            continue
        pairs.append((_score_column_label(col), score))
    return pairs


def _player_metric_scores(player_means: pd.Series) -> list[tuple[str, float]]:
    pairs: list[tuple[str, float]] = []
    for label, col in METRIC_COLUMNS.items():
        if col in player_means.index and pd.notna(player_means[col]):
            pairs.append((label, float(player_means[col])))
    return pairs


def player_speedometer_highlights(
    player_means: pd.Series,
    *,
    min_score: float = 55.0,
    top_n: int | None = None,
) -> list[tuple[str, float]]:
    """Shot-mean scores at or above ``min_score`` (all matching metrics unless ``top_n`` set)."""
    pairs = [(label, score) for label, score in _all_player_metric_scores(player_means) if score >= min_score]
    pairs.sort(key=lambda item: item[1], reverse=True)
    if top_n is not None:
        return pairs[:top_n]
    return pairs


def display_player_speedometers(
    player_means: pd.Series,
    *,
    min_score: float = 55.0,
    top_n: int | None = None,
) -> list[tuple[str, float]]:
    """Render speedometers for every metric mean at or above ``min_score``."""
    highlights = player_speedometer_highlights(player_means, min_score=min_score, top_n=top_n)
    if not highlights:
        display_plotly_speedometer("No metrics above threshold", 0.0)
        return highlights
    for label, value in highlights:
        display_plotly_speedometer(label, value)
    return highlights


def display_plotly_speedometer(
    title: str,
    value: float,
    *,
    min_val: float = 0,
    max_val: float = 100,
    suffix: str = "",
) -> None:
    display_plotly_figure(plotly_speedometer(title, value, min_val=min_val, max_val=max_val, suffix=suffix))


def display_plotly_phase_speedometer(player_means: pd.Series, phase_label: str) -> None:
    display_plotly_figure(plotly_phase_speedometer(player_means, phase_label))


def display_plotly_player_dashboard(
    player_means: pd.Series,
    player_name: str,
    *,
    n_shots: int | None = None,
) -> None:
    display_plotly_figure(plotly_player_dashboard(player_means, player_name, n_shots=n_shots))


def _metric_group(col: str) -> str:
    if col in MODULE_COLUMNS.values():
        return "Module"
    if col in INDEX_COLUMNS.values():
        return "Execution index"
    return "Phase"


def player_profile_frame(player_means: pd.Series) -> pd.DataFrame:
    """All profile metrics; missing means get score 0 and an N/A label for charts."""
    rows: list[dict[str, Any]] = []
    for label, col in METRIC_COLUMNS.items():
        if col not in player_means.index:
            continue
        value = player_means[col]
        available = pd.notna(value)
        rows.append(
            {
                "metric": label,
                "score": float(value) if available else 0.0,
                "group": _metric_group(col),
                "available": available,
                "bar_label": f"{float(value):.1f}" if available else PROFILE_NA_BAR_LABEL,
                "bar_note": "" if available else PROFILE_NA_REASON,
            }
        )
    if not rows:
        return pd.DataFrame()
    order = list(MODULE_COLUMNS.keys()) + list(INDEX_COLUMNS.keys()) + list(PHASE_COLUMNS.keys())
    profile = pd.DataFrame(rows)
    profile["metric"] = pd.Categorical(profile["metric"], categories=order, ordered=True)
    return profile.sort_values("metric")


def _profile_bar_color(*, score: float, available: bool) -> str:
    if not available:
        return str(BSQ_COLORS["na_fill"])
    if score >= PROFILE_BAR_HIGH_SCORE:
        return str(BSQ_COLORS["bar_highlight"])
    if score < PROFILE_BAR_LOW_SCORE:
        return str(BSQ_COLORS["bar_warning"])
    return str(BSQ_COLORS["bar_neutral"])


def _profile_bar_label_html(score: float, bar_label: str, *, available: bool, bar_note: str) -> str:
    if not available:
        return f"{bar_label}<br><sup>{bar_note}</sup>"
    if score >= PROFILE_BAR_HIGH_SCORE:
        return f"<span style='color:{BSQ_COLORS['accent']}'><b>{bar_label}</b></span>"
    if score < PROFILE_BAR_LOW_SCORE:
        return f"<span style='color:#9A7B00'><b>{bar_label}</b></span>"
    return str(bar_label)


def plotly_player_dashboard(
    player_means: pd.Series,
    player_name: str,
    *,
    n_shots: int | None = None,
):
    """Horizontal profile — grey track; red bars ≥65, yellow bars <40, black otherwise."""
    import plotly.graph_objects as go

    profile = player_profile_frame(player_means)
    if profile.empty:
        raise ValueError(f"No scored metrics for {player_name!r}")

    metrics = [str(m) for m in profile["metric"].tolist()]
    scores = profile["score"].tolist()
    colors = [
        _profile_bar_color(score=float(s), available=bool(a))
        for s, a in zip(scores, profile["available"])
    ]
    labels = [
        _profile_bar_label_html(
            float(row.score),
            str(row.bar_label),
            available=bool(row.available),
            bar_note=str(row.bar_note),
        )
        for row in profile.itertuples()
    ]

    subtitle = "five-match sample"
    if n_shots is not None and n_shots <= 4:
        subtitle = f"{subtitle} · {n_shots} shots"

    fig = go.Figure()
    fig.add_trace(
        go.Bar(
            y=metrics,
            x=[100.0] * len(metrics),
            orientation="h",
            marker=dict(color=str(BSQ_COLORS["bar_track"]), line=dict(width=0)),
            hoverinfo="skip",
            showlegend=False,
        )
    )
    fig.add_trace(
        go.Bar(
            y=metrics,
            x=scores,
            orientation="h",
            marker=dict(color=colors, line=dict(width=0)),
            text=labels,
            textposition="outside",
            textfont=_font(11, weight=600, color=BSQ_COLORS["ink"]),
            cliponaxis=False,
            hovertemplate="%{y}<br>BSQ %{x:.1f}<extra></extra>",
            showlegend=False,
        )
    )
    fig.update_layout(barmode="overlay", bargap=0.38)
    fig = apply_bsq_theme(
        fig,
        title=f"{player_name} — BSQ profile ({subtitle})",
        height=max(520, 30 * len(profile) + 140),
    )
    fig.update_layout(
        width=760,
        showlegend=False,
        margin=dict(l=168, r=88, t=88, b=48),
        xaxis=dict(range=[0, 108], dtick=20, title="BSQ score"),
        yaxis=dict(title="", categoryorder="array", categoryarray=metrics),
    )
    return fig


def plotly_league_modules_bar(melt: pd.DataFrame, *, title: str = "Mean module scores by match"):
    """Grouped bar chart for league module comparison."""
    import plotly.express as px

    modules = melt["module"].unique().tolist()
    seq = BSQ_COLORS["bar_sequence"]
    color_map = {
        module: seq[i % len(seq)] if isinstance(seq, list) else str(BSQ_COLORS["bar_neutral"])
        for i, module in enumerate(modules)
    }
    fig = px.bar(
        melt,
        x="match_folder",
        y="score",
        color="module",
        barmode="group",
        color_discrete_map=color_map,
        category_orders={"module": list(MODULE_COLUMNS.keys())},
    )
    fig.update_traces(
        marker_line_color=BSQ_COLORS["ink"],
        marker_line_width=0.4,
        opacity=0.88,
    )
    return apply_bsq_theme(fig, title=title, height=480).update_layout(
        yaxis_range=[0, 100],
        xaxis_title="Match",
        yaxis_title="BSQ score",
        bargap=0.18,
        bargroupgap=0.06,
        legend_title_text="Module",
    )


def plotly_phase_profile(pm: pd.DataFrame, *, title: str = "Phase profile by match"):
    """Line chart for P1–P6 means across matches."""
    import plotly.express as px

    matches = pm["match_folder"].unique().tolist()
    seq = BSQ_COLORS["line_sequence"]
    color_map: dict[str, str] = {}
    for i, match in enumerate(matches):
        if isinstance(seq, list):
            color_map[match] = str(seq[min(i, len(seq) - 1)])
        else:
            color_map[match] = str(BSQ_COLORS["bar_neutral"])
    if matches:
        color_map[matches[-1]] = str(BSQ_COLORS["accent"])
    fig = px.line(
        pm,
        x="phase",
        y="score",
        color="match_folder",
        markers=True,
        color_discrete_map=color_map,
        category_orders={"phase": list(PHASE_COLUMNS.keys())},
    )
    fig.update_traces(
        line=dict(width=2.4),
        marker=dict(size=8, line=dict(width=1, color=BSQ_COLORS["plot"])),
    )
    return apply_bsq_theme(fig, title=title, height=440).update_layout(
        yaxis_range=[0, 100],
        xaxis_title="Phase",
        yaxis_title="BSQ score",
        legend_title_text="Match",
    )


def notebook_plot_style_html() -> str:
    """Inject Google Sans Flex for Plotly + notebook headings."""
    return f"""
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Google+Sans+Flex:opsz,wght@8..144,300;8..144,400;8..144,500;8..144,600;8..144;700&display=swap" rel="stylesheet">
<style>
  :root {{
    --bsq-ink: {BSQ_COLORS['ink']};
    --bsq-accent: {BSQ_COLORS['accent']};
  }}
  body, .jp-RenderedHTMLCommon {{
    font-family: {BSQ_FONT};
    font-weight: 400;
    color: var(--bsq-ink);
  }}
  h1, h2, h3, h4 {{ font-weight: 600; color: var(--bsq-ink); }}
  h1 {{ font-size: 1.75rem; font-weight: 700; }}
  p, li {{ font-weight: 400; color: {BSQ_COLORS['ink_muted']}; }}
</style>
"""
