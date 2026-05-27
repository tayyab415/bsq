"""3D shot flight maps — Plotly + StatsBomb-style smooth arcs (Plain English reference)."""

from __future__ import annotations

from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Literal

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.figure import Figure
from mpl_toolkits.mplot3d import Axes3D  # noqa: F401
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

REPO_ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_ROOT = REPO_ROOT.parent

REF = {
    "sky": "#0e111a",
    "plot": "#131722",
    "pitch": "#2f8f45",
    "line": "#ffffff",
    "goal": "#ffffff",
    "net": "#c8d0d8",
    "shot": "#C4050E",
    "shot_glow": "#8B0000",
    "start_dot": "#C4050E",
    "endpoint": "#C4050E",
}

PITCH_LENGTH = 105.0
PITCH_WIDTH = 68.0
GOAL_X_LEFT = -PITCH_LENGTH / 2
GOAL_X_RIGHT = PITCH_LENGTH / 2
GOAL_WIDTH = 7.32
GOAL_HEIGHT = 2.44
VIEW_DEPTH = 25.0
VIEW_HALF_WIDTH = 22.0
PENALTY_DEPTH = 16.5
SIX_YARD_DEPTH = 5.5
PENALTY_HALF_WIDTH = 20.16
SIX_HALF_WIDTH = 9.16
# Ryan Joseph / StatsBomb Streamlit 3D viz — sideline elevation over attacking third
STATS_BOMB_CAMERA = dict(eye=dict(x=0.0, y=3.0, z=0.7))
# Right-goal panel: same sideline elevation, viewed from opposite touchline
PLOTLY_CAMERA_RIGHT = dict(eye=dict(x=0.0, y=-3.0, z=0.7))

DEFAULT_REFERENCE_DIR = REPO_ROOT / "metrics-calculation" / "reference_outputs"


@dataclass(frozen=True)
class ShotTrajectory:
    event_id: int
    player_name: str
    shot_result: str
    x: np.ndarray
    y: np.ndarray
    z: np.ndarray
    goal_x: float
    body_part: str = ""
    match_folder: str = ""


def resolve_tracking_samples_path() -> Path | None:
    for candidate in (
        WORKSPACE_ROOT / "derived/shooting1_v3_all_matches/tracking_samples.csv",
        WORKSPACE_ROOT / "derived/shooting1_v3_bayern_hamburg/tracking_samples.csv",
        REPO_ROOT / "metrics-calculation/reference_outputs/tracking_samples.csv",
    ):
        if candidate.is_file():
            return candidate
    return None


def to_plot_coords(x: np.ndarray, y: np.ndarray, z: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Tracking pitch coords for matplotlib (x length, y width, z height)."""
    return np.asarray(x, dtype=float), np.asarray(y, dtype=float), np.asarray(z, dtype=float)


def to_three_coords(x: np.ndarray, y: np.ndarray, z: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Visualizer / Three.js mapping: length -> x, width -> y (flipped), height -> z."""
    return np.asarray(x, dtype=float), -np.asarray(y, dtype=float), np.asarray(z, dtype=float)


def _mirror_to_left_goal(traj: ShotTrajectory) -> ShotTrajectory:
    """Legacy opt-in reflection for callers that explicitly request it."""
    if traj.goal_x >= 0:
        return replace(traj, x=-traj.x, y=-traj.y, goal_x=GOAL_X_LEFT)
    return traj


def _smooth(values: np.ndarray) -> np.ndarray:
    if len(values) < 5:
        return values
    kernel = np.array([1.0, 2.0, 3.0, 2.0, 1.0], dtype=float)
    kernel /= kernel.sum()
    padded = np.pad(values, (2, 2), mode="edge")
    return np.convolve(padded, kernel, mode="valid")


def _resample_trajectory(traj: ShotTrajectory, *, max_points: int = 15) -> ShotTrajectory:
    """Resample by path length so 50 Hz tracking jitter reads as clean arcs."""
    n = len(traj.x)
    if n <= max_points:
        x = _smooth(np.asarray(traj.x, dtype=float))
        y = _smooth(np.asarray(traj.y, dtype=float))
        z = np.maximum(_smooth(np.asarray(traj.z, dtype=float)), 0.0)
        return replace(traj, x=x, y=y, z=z)

    pts = np.column_stack([traj.x, traj.y, np.maximum(traj.z, 0.0)])
    deltas = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    dist = np.concatenate([[0.0], np.cumsum(deltas)])
    if dist[-1] <= 0:
        idx = np.linspace(0, n - 1, max_points, dtype=int)
        x, y, z = traj.x[idx], traj.y[idx], np.maximum(traj.z[idx], 0.0)
    else:
        target = np.linspace(0.0, dist[-1], max_points)
        x = np.interp(target, dist, traj.x)
        y = np.interp(target, dist, traj.y)
        z = np.maximum(np.interp(target, dist, traj.z), 0.0)
    x[0], y[0], z[0] = traj.x[0], traj.y[0], max(float(traj.z[0]), 0.0)
    x[-1], y[-1], z[-1] = traj.x[-1], traj.y[-1], max(float(traj.z[-1]), 0.0)
    return replace(traj, x=_smooth(x), y=_smooth(y), z=np.maximum(_smooth(z), 0.0))


def _clip_at_goal_plane(traj: ShotTrajectory) -> ShotTrajectory:
    """Trim tracking at the first goal-plane crossing, interpolating the endpoint."""
    gx = traj.goal_x
    toward_or_past = traj.x <= gx if gx < 0 else traj.x >= gx
    crossings = np.where(toward_or_past)[0]
    if len(crossings) == 0:
        return traj
    first = int(crossings[0])
    if first == 0:
        return replace(traj, x=traj.x[:1], y=traj.y[:1], z=np.maximum(traj.z[:1], 0.0))

    prev = first - 1
    dx = traj.x[first] - traj.x[prev]
    ratio = 0.0 if abs(dx) < 1e-9 else (gx - traj.x[prev]) / dx
    ratio = float(np.clip(ratio, 0.0, 1.0))
    y_goal = traj.y[prev] + ratio * (traj.y[first] - traj.y[prev])
    z_goal = traj.z[prev] + ratio * (traj.z[first] - traj.z[prev])
    return replace(
        traj,
        x=np.concatenate([traj.x[:first], np.array([gx])]),
        y=np.concatenate([traj.y[:first], np.array([y_goal])]),
        z=np.concatenate([traj.z[:first], np.array([max(float(z_goal), 0.0)])]),
    )


def _clip_to_camera_window(traj: ShotTrajectory, *, goal_x: float) -> ShotTrajectory:
    if goal_x < 0:
        x_min, x_max = goal_x - 1.5, goal_x + VIEW_DEPTH
    else:
        x_min, x_max = goal_x - VIEW_DEPTH, goal_x + 1.5
    keep = (
        (traj.x >= x_min)
        & (traj.x <= x_max)
        & (traj.y >= -VIEW_HALF_WIDTH)
        & (traj.y <= VIEW_HALF_WIDTH)
    )
    if np.count_nonzero(keep) < 2:
        empty = np.array([], dtype=float)
        return replace(traj, x=empty, y=empty, z=empty)
    return replace(traj, x=traj.x[keep], y=traj.y[keep], z=traj.z[keep])


def filter_trajectories_by_goal(
    trajectories: list[ShotTrajectory],
    *,
    goal: str = "dominant",
) -> tuple[list[ShotTrajectory], float]:
    """Keep one attacking end so arcs are not mirrored into a hairball. goal: left|right|dominant|all."""
    if goal == "all":
        return trajectories, GOAL_X_LEFT
    target = GOAL_X_LEFT if goal == "left" else GOAL_X_RIGHT if goal == "right" else None
    if target is None:
        left_n = sum(1 for t in trajectories if t.goal_x < 0)
        target = GOAL_X_LEFT if left_n >= len(trajectories) - left_n else GOAL_X_RIGHT
    kept = [t for t in trajectories if t.goal_x == target]
    return kept, target


def _body_part_from_row(row: Any) -> str:
    bp = str(getattr(row, "body_part_name", "") or "")
    if bp:
        return bp
    foot = str(getattr(row, "shot_foot", "") or "")
    shot_type = str(getattr(row, "type_of_shot", "") or "")
    return foot or shot_type


def _goal_x_for_shot(shot_x: float) -> float:
    if abs(shot_x - GOAL_X_LEFT) <= abs(shot_x - GOAL_X_RIGHT):
        return GOAL_X_LEFT
    return GOAL_X_RIGHT


def load_player_shot_trajectories(
    player_name: str,
    *,
    team_name: str | None = None,
    tracking_path: Path | str | None = None,
    shots: pd.DataFrame | None = None,
    features: pd.DataFrame | None = None,
    max_flight_frames: int = 75,
) -> list[ShotTrajectory]:
    """All post-contact trajectories for one player across matches in the sample."""
    tracking_path = Path(tracking_path) if tracking_path else resolve_tracking_samples_path()
    if tracking_path is None or not tracking_path.is_file():
        raise FileNotFoundError("tracking_samples.csv not found.")

    shots = shots if shots is not None else pd.read_csv(DEFAULT_REFERENCE_DIR / "shots.csv")
    features = features if features is not None else pd.read_csv(
        DEFAULT_REFERENCE_DIR / "features.csv", usecols=["event_id", "contact_frame"]
    )
    mask = shots["player_name"].astype(str).str.strip().eq(player_name.strip())
    if team_name:
        mask &= shots["team_name"].astype(str).str.contains(team_name, case=False, na=False)
    player_shots = shots[mask].copy()
    if player_shots.empty:
        raise ValueError(f"No shots for player {player_name!r}")

    track = pd.read_csv(tracking_path)
    track = track[track["event_id"].isin(player_shots["event_id"])]
    contact = features.set_index("event_id")["contact_frame"]

    trajectories: list[ShotTrajectory] = []
    for row in player_shots.itertuples():
        eid = int(row.event_id)
        frames = track[track["event_id"] == eid].sort_values("frame_number")
        if frames.empty or eid not in contact.index or pd.isna(contact.loc[eid]):
            continue
        cf = int(contact.loc[eid])
        flight = frames[frames["frame_number"] >= cf].head(max_flight_frames).copy()
        flight = flight.dropna(subset=["ball_x", "ball_y", "ball_z"])
        if len(flight) < 2:
            continue
        goal_x = _goal_x_for_shot(float(row.x))
        trajectories.append(
            ShotTrajectory(
                event_id=eid,
                player_name=str(row.player_name),
                shot_result=str(row.shot_result),
                x=flight["ball_x"].to_numpy(dtype=float),
                y=flight["ball_y"].to_numpy(dtype=float),
                z=flight["ball_z"].to_numpy(dtype=float),
                goal_x=goal_x,
                body_part=_body_part_from_row(row),
                match_folder=str(row.match_folder),
            )
        )
    if not trajectories:
        raise ValueError(f"No tracking trajectories for {player_name!r}")
    return trajectories


def load_shot_trajectories(
    *,
    match_folder: str,
    team_name: str,
    tracking_path: Path | str | None = None,
    shots: pd.DataFrame | None = None,
    features: pd.DataFrame | None = None,
    max_flight_frames: int = 75,
) -> list[ShotTrajectory]:
    tracking_path = Path(tracking_path) if tracking_path else resolve_tracking_samples_path()
    if tracking_path is None or not tracking_path.is_file():
        raise FileNotFoundError(
            "tracking_samples.csv not found. Run shooting1 build or point to derived/shooting1_v3_all_matches/."
        )

    shots = shots if shots is not None else pd.read_csv(DEFAULT_REFERENCE_DIR / "shots.csv")
    features = features if features is not None else pd.read_csv(
        DEFAULT_REFERENCE_DIR / "features.csv", usecols=["event_id", "contact_frame"]
    )
    team_mask = shots["team_name"].astype(str).str.contains(team_name, case=False, na=False)
    match_shots = shots[(shots["match_folder"] == match_folder) & team_mask].copy()
    if match_shots.empty:
        raise ValueError(f"No shots for {team_name!r} in {match_folder!r}")

    track = pd.read_csv(tracking_path)
    track = track[track["event_id"].isin(match_shots["event_id"])]
    contact = features.set_index("event_id")["contact_frame"]

    trajectories: list[ShotTrajectory] = []
    for row in match_shots.itertuples():
        eid = int(row.event_id)
        frames = track[track["event_id"] == eid].sort_values("frame_number")
        if frames.empty or eid not in contact.index or pd.isna(contact.loc[eid]):
            continue
        cf = int(contact.loc[eid])
        flight = frames[frames["frame_number"] >= cf].head(max_flight_frames).copy()
        flight = flight.dropna(subset=["ball_x", "ball_y", "ball_z"])
        if len(flight) < 2:
            continue
        goal_x = _goal_x_for_shot(float(row.x))
        trajectories.append(
            ShotTrajectory(
                event_id=eid,
                player_name=str(row.player_name),
                shot_result=str(row.shot_result),
                x=flight["ball_x"].to_numpy(dtype=float),
                y=flight["ball_y"].to_numpy(dtype=float),
                z=flight["ball_z"].to_numpy(dtype=float),
                goal_x=goal_x,
                body_part=_body_part_from_row(row),
                match_folder=str(row.match_folder),
            )
        )
    return trajectories


def _format_match_label(match_folder: str) -> str:
    return match_folder.replace("_", " vs ") if match_folder else "Match"


def _line_loop(ax: Axes3D, pts: list[tuple[float, float, float]], *, alpha: float = 0.85, lw: float = 1.0) -> None:
    xs, ys, zs = zip(*pts)
    ax.plot(xs, ys, zs, color=REF["line"], linewidth=lw, alpha=alpha, zorder=2)


def _draw_pitch_strip(ax: Axes3D, *, goal_x: float, depth: float = VIEW_DEPTH) -> None:
    """Flat green shooting lane + goal line only."""
    if goal_x < 0:
        x0, x1 = goal_x, goal_x + depth
    else:
        x0, x1 = goal_x - depth, goal_x
    y0, y1 = -VIEW_HALF_WIDTH, VIEW_HALF_WIDTH
    z0 = -0.04

    turf = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)]
    ax.add_collection3d(
        Poly3DCollection([turf], facecolors=REF["pitch"], edgecolors=REF["pitch"], alpha=0.72, linewidths=0)
    )
    _line_loop(ax, [(goal_x, y0, z0), (goal_x, y1, z0)], lw=1.4, alpha=0.9)


def _draw_goal(ax: Axes3D, goal_x: float) -> None:
    y0, y1 = -GOAL_WIDTH / 2, GOAL_WIDTH / 2
    lw = 3.0
    # Posts + crossbar
    for y in (y0, y1):
        ax.plot([goal_x, goal_x], [y, y], [0, GOAL_HEIGHT], color=REF["goal"], linewidth=lw, zorder=8)
    ax.plot([goal_x, goal_x], [y0, y1], [GOAL_HEIGHT, GOAL_HEIGHT], color=REF["goal"], linewidth=lw, zorder=8)
    ax.plot([goal_x, goal_x], [y0, y1], [0, 0], color=REF["goal"], linewidth=lw, zorder=8)
    # Net grid
    for z in np.linspace(0.25, GOAL_HEIGHT, 6):
        ax.plot([goal_x, goal_x], [y0, y1], [z, z], color=REF["net"], linewidth=0.5, alpha=0.55, zorder=7)
    for y in np.linspace(y0, y1, 9):
        ax.plot([goal_x, goal_x], [y, y], [0, GOAL_HEIGHT], color=REF["net"], linewidth=0.5, alpha=0.55, zorder=7)
    # Ground goal line
    net_depth = -1.5 if goal_x < 0 else 1.5
    ax.plot([goal_x, goal_x + net_depth], [y0, y0], [0, 0], color=REF["net"], linewidth=0.8, alpha=0.45, linestyle="--", zorder=3)
    ax.plot([goal_x, goal_x + net_depth], [y1, y1], [0, 0], color=REF["net"], linewidth=0.8, alpha=0.45, linestyle="--", zorder=3)
    ax.plot([goal_x + net_depth, goal_x + net_depth], [y0, y1], [0, 0], color=REF["net"], linewidth=0.8, alpha=0.45, linestyle="--", zorder=3)


def _field_to_goal_view(
    ax: Axes3D,
    *,
    goal_x: float,
    elev: float | None = None,
    azim: float | None = None,
) -> None:
    """Low pitch view with the goal mouth centered and facing the viewer."""
    depth = VIEW_DEPTH
    if goal_x < 0:
        ax.set_xlim(goal_x - 1.5, goal_x + depth)
        ax.view_init(elev=24 if elev is None else elev, azim=-10 if azim is None else azim)
    else:
        ax.set_xlim(goal_x - depth, goal_x + 1.5)
        ax.view_init(elev=24 if elev is None else elev, azim=170 if azim is None else azim)
    ax.set_ylim(-VIEW_HALF_WIDTH, VIEW_HALF_WIDTH)
    ax.set_zlim(0, 3.4)
    try:
        ax.set_box_aspect((1.45, 1.0, 0.42))
    except Exception:
        pass


def _style_cinematic(ax: Axes3D) -> None:
    ax.set_facecolor(REF["plot"])
    ax.set_axis_off()
    for axis in (ax.xaxis, ax.yaxis, ax.zaxis):
        axis.pane.fill = False
        axis.pane.set_edgecolor(REF["sky"])
    ax.grid(False)


def _prepare_for_plot(
    trajectories: list[ShotTrajectory],
    *,
    mirror_to_one_goal: bool,
    goal_filter: str,
    max_points_per_shot: int,
) -> tuple[list[ShotTrajectory], float]:
    if mirror_to_one_goal:
        trajectories = [_mirror_to_left_goal(t) for t in trajectories]
        goal_x = GOAL_X_LEFT
    else:
        trajectories, goal_x = filter_trajectories_by_goal(trajectories, goal=goal_filter)
        if not trajectories:
            raise ValueError(f"No trajectories for goal_filter={goal_filter!r}")

    prepared = [
        _clip_to_camera_window(
            _resample_trajectory(_clip_at_goal_plane(t), max_points=max_points_per_shot),
            goal_x=goal_x,
        )
        for t in trajectories
    ]
    prepared = [t for t in prepared if len(t.x) >= 2]
    if not prepared:
        raise ValueError(f"No drawable trajectories for goal_filter={goal_filter!r}")
    prepared.sort(key=lambda t: float(np.nanmean(t.x)), reverse=goal_x < 0)
    return prepared, goal_x


def _shift_to_goal_origin(traj: ShotTrajectory, *, goal_x: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Goal plane at x=0; pitch extends in +x (left goal) or -x (right goal)."""
    px, py, pz = to_plot_coords(traj.x, traj.y, traj.z)
    if goal_x < 0:
        return px - goal_x, py, np.maximum(pz, 0.0)
    return goal_x - px, py, np.maximum(pz, 0.0)


def _kickoff_height(traj: ShotTrajectory) -> float:
    """StatsBomb article: headers start ~2.25 m; open-play shots from turf."""
    bp = (traj.body_part or "").lower()
    if "head" in bp or "header" in bp:
        return 2.25
    return max(0.05, float(traj.z[0]))


def generate_smooth_shot_curve(
    x_start: float,
    x_end: float,
    y_start: float,
    y_end: float,
    z_start: float,
    z_end: float,
    *,
    num: int = 80,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Parabolic shot arc (StatsBomb Streamlit 3D shot map)."""
    t = np.linspace(0.0, 1.0, num)
    x_curve = (1.0 - t) * x_start + t * x_end
    y_curve = (1.0 - t) * y_start + t * y_end
    z_curve = z_start + (z_end - z_start) * t * (2.0 - t)
    return x_curve, y_curve, z_curve


def _plotly_line3d(
    fig: Any,
    xs: list[float] | np.ndarray,
    ys: list[float] | np.ndarray,
    zs: list[float] | np.ndarray,
    *,
    color: str,
    width: float,
    opacity: float = 1.0,
    row: int | None = None,
    col: int | None = None,
) -> None:
    import plotly.graph_objects as go

    kwargs: dict[str, int] = {}
    if row is not None and col is not None:
        kwargs = {"row": row, "col": col}
    fig.add_trace(
        go.Scatter3d(
            x=xs,
            y=ys,
            z=zs,
            mode="lines",
            line=dict(color=color, width=width),
            opacity=opacity,
            showlegend=False,
            hoverinfo="skip",
        ),
        **kwargs,
    )


def _add_statsbomb_attack_pitch(
    fig: Any, *, depth: float = VIEW_DEPTH, row: int | None = None, col: int | None = None
) -> None:
    """White pitch markings on z=0 (attacking third, goal at x=0)."""
    import plotly.graph_objects as go

    yc = 0.0
    y_pen = PENALTY_HALF_WIDTH
    y_six = SIX_HALF_WIDTH
    y0, y1 = -VIEW_HALF_WIDTH, VIEW_HALF_WIDTH

    if row is None and col is None:
        x = np.linspace(0.0, depth, 24)
        y = np.linspace(y0, y1, 14)
        xx, yy = np.meshgrid(x, y)
        zz = np.zeros_like(xx)
        fig.add_trace(
            go.Surface(
                x=xx,
                y=yy,
                z=zz,
                colorscale=[[0.0, REF["pitch"]], [1.0, REF["pitch"]]],
                showscale=False,
                opacity=0.98,
                lighting=dict(ambient=0.92, diffuse=0.25, specular=0.02, roughness=0.9),
                hoverinfo="skip",
            )
        )

    # Goal line + side lines of visible strip
    rc = dict(row=row, col=col) if row is not None and col is not None else {}
    _plotly_line3d(fig, [0, depth], [yc - VIEW_HALF_WIDTH] * 2, [0, 0], color=REF["line"], width=5, **rc)
    _plotly_line3d(fig, [0, depth], [yc + VIEW_HALF_WIDTH] * 2, [0, 0], color=REF["line"], width=5, **rc)
    _plotly_line3d(fig, [depth, depth], [yc - VIEW_HALF_WIDTH, yc + VIEW_HALF_WIDTH], [0, 0], color=REF["line"], width=5, **rc)

    # Penalty area
    _plotly_line3d(
        fig,
        [0, PENALTY_DEPTH, PENALTY_DEPTH, 0, 0],
        [yc - y_pen, yc - y_pen, yc + y_pen, yc + y_pen, yc - y_pen],
        [0] * 5,
        color=REF["line"],
        width=4,
        **rc,
    )
    # Six-yard box
    _plotly_line3d(
        fig,
        [0, SIX_YARD_DEPTH, SIX_YARD_DEPTH, 0, 0],
        [yc - y_six, yc - y_six, yc + y_six, yc + y_six, yc - y_six],
        [0] * 5,
        color=REF["line"],
        width=4,
        **rc,
    )
    # Penalty spot
    _plotly_line3d(fig, [11.0], [yc], [0], color=REF["line"], width=6, **rc)


def _add_statsbomb_goal(fig: Any, *, row: int | None = None, col: int | None = None) -> None:
    """Goal frame + net at x=0 (StatsBomb draw_goals style, single end)."""
    y0, y1 = -GOAL_WIDTH / 2, GOAL_WIDTH / 2
    gh = GOAL_HEIGHT
    gx = 0.0
    white = REF["goal"]
    net = REF["net"]

    rc = dict(row=row, col=col) if row is not None and col is not None else {}
    for y in (y0, y1):
        _plotly_line3d(fig, [gx, gx], [y, y], [0, gh], color=white, width=10, **rc)
    _plotly_line3d(fig, [gx, gx], [y0, y1], [gh, gh], color=white, width=10, **rc)
    _plotly_line3d(fig, [gx, gx], [y0, y1], [0, 0], color=white, width=10, **rc)
    for z in np.linspace(0.3, gh, 5):
        _plotly_line3d(fig, [gx, gx], [y0, y1], [z, z], color=net, width=2, opacity=0.6, **rc)
    for y in np.linspace(y0, y1, 8):
        _plotly_line3d(fig, [gx, gx], [y, y], [0, gh], color=net, width=2, opacity=0.6, **rc)


def plot_3d_shot_map_plotly(
    trajectories: list[ShotTrajectory],
    *,
    title: str = "",
    subtitle: str = "",
    highlight_event_id: int | None = None,
    mirror_to_one_goal: bool = False,
    goal_filter: str = "dominant",
    max_points_per_shot: int = 15,
    background_alpha: float = 0.55,
    width: int = 1000,
    height: int = 800,
) -> Any:
    """StatsBomb-style Plotly 3D shot map (smooth parabolic arcs + green pitch plane)."""
    import plotly.graph_objects as go

    if not trajectories:
        raise ValueError("No trajectories to plot")

    prepared, goal_x = _prepare_for_plot(
        trajectories,
        mirror_to_one_goal=mirror_to_one_goal,
        goal_filter=goal_filter,
        max_points_per_shot=max_points_per_shot,
    )

    fig = go.Figure()
    _add_statsbomb_attack_pitch(fig, depth=VIEW_DEPTH)
    _add_statsbomb_goal(fig)

    for traj in prepared:
        sx, sy, sz = _shift_to_goal_origin(traj, goal_x=goal_x)
        x0, y0, z0 = float(sx[0]), float(sy[0]), _kickoff_height(traj)
        x1, y1, z1 = float(sx[-1]), float(sy[-1]), float(sz[-1])
        is_hi = highlight_event_id is not None and traj.event_id == highlight_event_id
        lw = 6 if is_hi else 4
        alpha = 0.95 if is_hi else background_alpha
        if z1 <= 0.05:
            _plotly_line3d(fig, [x0, x1], [y0, y1], [0, 0], color=REF["shot"], width=lw, opacity=alpha)
        else:
            xc, yc, zc = generate_smooth_shot_curve(x0, x1, y0, y1, z0, z1)
            _plotly_line3d(fig, xc, yc, zc, color=REF["shot"], width=lw, opacity=alpha)
        fig.add_trace(
            go.Scatter3d(
                x=[x0],
                y=[y0],
                z=[z0],
                mode="markers",
                marker=dict(size=5 if is_hi else 3, color=REF["start_dot"], symbol="cross"),
                opacity=0.9,
                showlegend=False,
                hoverinfo="skip",
            )
        )
        fig.add_trace(
            go.Scatter3d(
                x=[x1],
                y=[y1],
                z=[max(z1, 0.05)],
                mode="markers",
                marker=dict(size=8 if is_hi else 5, color=REF["endpoint"]),
                opacity=0.95 if is_hi else 0.65,
                showlegend=False,
                hoverinfo="skip",
            )
        )

    pad = 3.0
    fig.update_layout(
        title=dict(text=title, x=0.5, font=dict(color="#e8ecef", size=16)) if title else None,
        paper_bgcolor=REF["sky"],
        width=width,
        height=height,
        margin=dict(l=20, r=20, t=36 if title else 20, b=48 if subtitle else 20),
        showlegend=False,
        scene=dict(
            xaxis=dict(
                range=[-pad, VIEW_DEPTH + pad],
                title="",
                showgrid=False,
                showline=False,
                showticklabels=False,
                zeroline=False,
            ),
            yaxis=dict(
                range=[-VIEW_HALF_WIDTH - pad, VIEW_HALF_WIDTH + pad],
                title="",
                showgrid=False,
                showline=False,
                showticklabels=False,
                zeroline=False,
            ),
            zaxis=dict(
                range=[0, 4.5],
                title="",
                showgrid=False,
                showline=False,
                showticklabels=False,
                zeroline=False,
                showbackground=True,
                backgroundcolor=REF["pitch"],
            ),
            aspectmode="data",
            camera=STATS_BOMB_CAMERA,
        ),
        annotations=[
            dict(
                text=subtitle,
                xref="paper",
                yref="paper",
                x=0.5,
                y=-0.02,
                showarrow=False,
                font=dict(color="#82868c", size=11),
            )
        ]
        if subtitle
        else [],
    )
    return fig


def plot_3d_shot_map_by_goal(
    trajectories: list[ShotTrajectory],
    *,
    title: str = "",
    highlight_event_id: int | None = None,
    width: int = 1800,
    height: int = 800,
) -> Any:
    """Side-by-side 3D maps when shots attack both ends (e.g. player across matches)."""
    from plotly.subplots import make_subplots

    left = [t for t in trajectories if t.goal_x < 0]
    right = [t for t in trajectories if t.goal_x >= 0]
    panels: list[tuple[str, list[ShotTrajectory], float]] = []
    if left:
        panels.append(("Left goal", left, GOAL_X_LEFT))
    if right:
        panels.append(("Right goal", right, GOAL_X_RIGHT))
    if not panels:
        raise ValueError("No trajectories to plot")

    fig = make_subplots(
        rows=1,
        cols=len(panels),
        specs=[[{"type": "scene"}] * len(panels)],
        subplot_titles=[p[0] for p in panels],
        horizontal_spacing=0.04,
    )

    for col, (label, trajs, goal_x) in enumerate(panels, start=1):
        prepared = [
            _clip_to_camera_window(
                _resample_trajectory(_clip_at_goal_plane(t), max_points=15),
                goal_x=goal_x,
            )
            for t in trajs
        ]
        prepared = [t for t in prepared if len(t.x) >= 2]
        _add_statsbomb_attack_pitch(fig, depth=VIEW_DEPTH, row=1, col=col)
        _add_statsbomb_goal(fig, row=1, col=col)

        import plotly.graph_objects as go

        for traj in prepared:
            sx, sy, sz = _shift_to_goal_origin(traj, goal_x=goal_x)
            x0, y0, z0 = float(sx[0]), float(sy[0]), _kickoff_height(traj)
            x1, y1, z1 = float(sx[-1]), float(sy[-1]), float(sz[-1])
            is_hi = highlight_event_id is not None and traj.event_id == highlight_event_id
            lw, alpha = (6, 0.95) if is_hi else (4, 0.55)
            if z1 <= 0.05:
                xc, yc_, zc = [x0, x1], [y0, y1], [0, 0]
            else:
                xc, yc_, zc = generate_smooth_shot_curve(x0, x1, y0, y1, z0, z1)
            fig.add_trace(
                go.Scatter3d(x=xc, y=yc_, z=zc, mode="lines", line=dict(color=REF["shot"], width=lw), opacity=alpha, hoverinfo="skip"),
                row=1,
                col=col,
            )
            fig.add_trace(
                go.Scatter3d(x=[x0], y=[y0], z=[z0], mode="markers", marker=dict(size=4, color=REF["start_dot"], symbol="cross"), hoverinfo="skip"),
                row=1,
                col=col,
            )
            fig.add_trace(
                go.Scatter3d(x=[x1], y=[y1], z=[max(z1, 0.05)], mode="markers", marker=dict(size=7, color=REF["endpoint"]), hoverinfo="skip"),
                row=1,
                col=col,
            )

        pad = 3.0
        scene_key = "scene" if col == 1 else f"scene{col}"
        fig.update_layout(
            **{
                scene_key: dict(
                    xaxis=dict(range=[-pad, VIEW_DEPTH + pad], visible=False),
                    yaxis=dict(range=[-VIEW_HALF_WIDTH - pad, VIEW_HALF_WIDTH + pad], visible=False),
                    zaxis=dict(range=[0, 4.5], visible=False, showbackground=True, backgroundcolor=REF["pitch"]),
                    aspectmode="data",
                    camera=STATS_BOMB_CAMERA if goal_x < 0 else PLOTLY_CAMERA_RIGHT,
                    bgcolor=REF["sky"],
                )
            }
        )

    fig.update_layout(
        title=dict(text=title, x=0.5, font=dict(color="#e8ecef", size=16)) if title else None,
        paper_bgcolor=REF["sky"],
        width=width,
        height=height,
        margin=dict(l=10, r=10, t=48 if title else 36, b=20),
        showlegend=False,
    )
    return fig


def plot_3d_shot_map_by_match(
    trajectories: list[ShotTrajectory],
    *,
    title: str = "",
    highlight_event_id: int | None = None,
    width_per_panel: int = 620,
    height: int = 800,
) -> Any:
    """One 3D panel per match (e.g. Kane: Hamburg, Frankfurt, Union)."""
    from plotly.subplots import make_subplots
    import plotly.graph_objects as go

    by_match: dict[str, list[ShotTrajectory]] = {}
    for traj in trajectories:
        key = traj.match_folder or "unknown"
        by_match.setdefault(key, []).append(traj)
    if not by_match:
        raise ValueError("No trajectories to plot")

    panels = sorted(by_match.items(), key=lambda item: item[0])
    fig = make_subplots(
        rows=1,
        cols=len(panels),
        specs=[[{"type": "scene"}] * len(panels)],
        subplot_titles=[f"{_format_match_label(m)} ({len(ts)} shot{'s' if len(ts) != 1 else ''})" for m, ts in panels],
        horizontal_spacing=0.03,
    )

    for col, (match_folder, trajs) in enumerate(panels, start=1):
        _, goal_x = filter_trajectories_by_goal(trajs, goal="dominant")
        prepared = [
            _clip_to_camera_window(
                _resample_trajectory(_clip_at_goal_plane(t), max_points=15),
                goal_x=goal_x,
            )
            for t in trajs
        ]
        prepared = [t for t in prepared if len(t.x) >= 2]
        _add_statsbomb_attack_pitch(fig, depth=VIEW_DEPTH, row=1, col=col)
        _add_statsbomb_goal(fig, row=1, col=col)

        for traj in prepared:
            sx, sy, sz = _shift_to_goal_origin(traj, goal_x=goal_x)
            x0, y0, z0 = float(sx[0]), float(sy[0]), _kickoff_height(traj)
            x1, y1, z1 = float(sx[-1]), float(sy[-1]), float(sz[-1])
            is_hi = highlight_event_id is not None and traj.event_id == highlight_event_id
            lw, alpha = (6, 0.95) if is_hi else (4, 0.55)
            if z1 <= 0.05:
                xc, yc_, zc = [x0, x1], [y0, y1], [0, 0]
            else:
                xc, yc_, zc = generate_smooth_shot_curve(x0, x1, y0, y1, z0, z1)
            fig.add_trace(
                go.Scatter3d(x=xc, y=yc_, z=zc, mode="lines", line=dict(color=REF["shot"], width=lw), opacity=alpha, hoverinfo="skip"),
                row=1,
                col=col,
            )
            fig.add_trace(
                go.Scatter3d(x=[x0], y=[y0], z=[z0], mode="markers", marker=dict(size=4, color=REF["start_dot"], symbol="cross"), hoverinfo="skip"),
                row=1,
                col=col,
            )
            fig.add_trace(
                go.Scatter3d(x=[x1], y=[y1], z=[max(z1, 0.05)], mode="markers", marker=dict(size=7, color=REF["endpoint"]), hoverinfo="skip"),
                row=1,
                col=col,
            )

        pad = 3.0
        scene_key = "scene" if col == 1 else f"scene{col}"
        fig.update_layout(
            **{
                scene_key: dict(
                    xaxis=dict(range=[-pad, VIEW_DEPTH + pad], visible=False),
                    yaxis=dict(range=[-VIEW_HALF_WIDTH - pad, VIEW_HALF_WIDTH + pad], visible=False),
                    zaxis=dict(range=[0, 4.5], visible=False, showbackground=True, backgroundcolor=REF["pitch"]),
                    aspectmode="data",
                    camera=STATS_BOMB_CAMERA if goal_x < 0 else PLOTLY_CAMERA_RIGHT,
                    bgcolor=REF["sky"],
                )
            }
        )

    fig.update_layout(
        title=dict(text=title, x=0.5, font=dict(color="#e8ecef", size=16)) if title else None,
        paper_bgcolor=REF["sky"],
        width=width_per_panel * len(panels),
        height=height,
        margin=dict(l=10, r=10, t=48 if title else 36, b=20),
        showlegend=False,
    )
    return fig


def plot_3d_shot_map(
    trajectories: list[ShotTrajectory],
    *,
    title: str = "",
    subtitle: str = "",
    highlight_event_id: int | None = None,
    figsize: tuple[float, float] = (10.0, 8.0),
    mirror_to_one_goal: bool = False,
    goal_filter: str = "dominant",
    max_points_per_shot: int = 15,
    background_alpha: float = 0.28,
    camera_elev: float | None = None,
    camera_azim: float | None = None,
    engine: Literal["plotly", "matplotlib"] = "plotly",
) -> Figure | Any:
    """Cinematic 3D shot map. Default engine is Plotly (stable reference camera)."""
    if engine == "plotly":
        return plot_3d_shot_map_plotly(
            trajectories,
            title=title,
            subtitle=subtitle,
            highlight_event_id=highlight_event_id,
            mirror_to_one_goal=mirror_to_one_goal,
            goal_filter=goal_filter,
            max_points_per_shot=max_points_per_shot,
            background_alpha=background_alpha,
            width=int(figsize[0] * 100),
            height=int(figsize[1] * 100),
        )

    if not trajectories:
        raise ValueError("No trajectories to plot")

    prepared, goal_x = _prepare_for_plot(
        trajectories,
        mirror_to_one_goal=mirror_to_one_goal,
        goal_filter=goal_filter,
        max_points_per_shot=max_points_per_shot,
    )

    fig = plt.figure(figsize=figsize, dpi=160)
    fig.patch.set_facecolor(REF["sky"])
    ax = fig.add_subplot(111, projection="3d")
    ax.set_facecolor(REF["sky"])

    _draw_pitch_strip(ax, goal_x=goal_x)
    _draw_goal(ax, goal_x)
    _style_cinematic(ax)

    for traj in prepared:
        px, py, pz = to_plot_coords(traj.x, traj.y, traj.z)
        is_hi = highlight_event_id is not None and traj.event_id == highlight_event_id
        lw = 2.0 if is_hi else 0.95
        alpha = 0.95 if is_hi else background_alpha
        ax.plot(px, py, pz, color=REF["shot"], linewidth=lw, alpha=alpha, zorder=4)
        ax.scatter(
            [px[0]],
            [py[0]],
            [pz[0]],
            color=REF["start_dot"],
            s=20 if is_hi else 10,
            depthshade=False,
            alpha=0.9 if is_hi else 0.45,
            edgecolors="none",
            zorder=5,
        )
        ax.scatter(
            [px[-1]],
            [py[-1]],
            [min(2.7, float(pz[-1]))],
            color=REF["endpoint"],
            s=70 if is_hi else 28,
            depthshade=False,
            alpha=0.95 if is_hi else 0.45,
            edgecolors="none",
            zorder=6,
        )

    _field_to_goal_view(ax, goal_x=goal_x, elev=camera_elev, azim=camera_azim)

    if title:
        fig.suptitle(title, color="#e8ecef", fontsize=14, fontweight=600, x=0.5, y=0.98)
    if subtitle:
        fig.text(0.5, 0.02, subtitle, color="#82868c", fontsize=9, ha="center")

    fig.subplots_adjust(left=0, right=1, top=0.96 if title else 1, bottom=0.04)
    return fig


def write_shot_map_html(fig: Any, path: Path | str, *, width: int = 1000, height: int = 800) -> Path:
    """Save an interactive Plotly shot map (orbit / zoom like the StatsBomb Streamlit app)."""
    if not hasattr(fig, "write_html"):
        raise TypeError("write_shot_map_html requires a Plotly Figure from plot_3d_shot_map()")
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.update_layout(width=width, height=height)
    fig.write_html(
        str(out),
        include_plotlyjs="cdn",
        full_html=True,
        config={
            "displayModeBar": True,
            "scrollZoom": True,
            "displaylogo": False,
            "modeBarButtonsToRemove": ["select2d", "lasso2d"],
        },
    )
    return out.resolve()


def display_shot_map_interactive(fig: Any, *, html_path: Path | str | None = None, iframe_height: int = 820) -> Path | None:
    """Show orbit-capable Plotly view in Jupyter (IFrame) and optionally save HTML."""
    if not hasattr(fig, "add_trace"):
        raise TypeError("display_shot_map_interactive requires a Plotly Figure")

    from IPython.display import IFrame, display

    saved: Path | None = None
    if html_path is not None:
        saved = write_shot_map_html(fig, html_path)
        display(IFrame(src=str(saved), width="100%", height=iframe_height))
    else:
        try:
            fig.show()
        except Exception:
            import tempfile

            tmp = Path(tempfile.gettempdir()) / "bsq_shot_map_preview.html"
            saved = write_shot_map_html(fig, tmp)
            display(IFrame(src=str(saved), width="100%", height=iframe_height))
    return saved


def display_matplotlib_figure(fig: Figure | Any, *, dpi: int = 160) -> None:
    """Embed static PNG in the notebook (Plotly via Kaleido, or matplotlib)."""
    if hasattr(fig, "add_trace"):
        from aws_football.bsq_reports import display_plotly_figure

        display_plotly_figure(fig, scale=max(2, dpi // 80))
        return

    import io

    from IPython.display import Image, display

    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=dpi, facecolor=fig.get_facecolor(), bbox_inches="tight", pad_inches=0.08)
    plt.close(fig)
    display(Image(buf.getvalue()))
