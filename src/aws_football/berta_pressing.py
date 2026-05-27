from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any

from aws_football.dribble_pose import MatchContext, PlayerInfo, SkeletonFrame, Vec3


PAPER_TRACKING_PARTS = {"pelvis"}
PRESSURE_DISTANCE_THRESHOLD_M = 3.0
PRESSURE_HULL_OVERLAP_THRESHOLD = 0.50
PENALTY_AREA_DEPTH_M = 16.5
PENALTY_AREA_HALF_WIDTH_M = 20.16


@dataclass(frozen=True)
class BertaPlay:
    event_id: str
    team_id: str
    player_id: str
    receiver_id: str | None
    frame: int
    section: str
    x: float
    y: float
    receiver_x: float | None
    receiver_y: float | None
    x_direction: float | None
    y_direction: float | None
    distance: float | None
    evaluation: str | None
    is_pass: bool
    is_goal_kick: bool
    is_free_kick: bool
    is_throw_in: bool
    is_corner: bool
    is_kickoff: bool
    pressure_on_player: float | None
    distance_closest_defender: float | None
    num_defenders_goal_side: int | None
    xp: float | None
    play_num_in_possession: int | None


@dataclass(frozen=True)
class BertaShot:
    event_id: str
    team_id: str
    player_id: str | None
    frame: int
    section: str
    x: float
    y: float
    xg: float
    shot_result: str | None


@dataclass(frozen=True)
class BertaCoordinateEvent:
    event_id: str
    event_type: str
    team_id: str | None
    player_id: str | None
    frame: int | None
    section: str | None
    x: float | None
    y: float | None
    end_x: float | None = None
    end_y: float | None = None
    receiver_x: float | None = None
    receiver_y: float | None = None


@dataclass(frozen=True)
class BertaPossession:
    event_id: str
    team_id: str
    frame: int
    end_frame: int
    section: str
    x: float
    y: float
    end_x: float | None
    end_y: float | None
    sum_xg_ind: float | None
    vertical_gain_overall: float | None
    event_ids: list[str]


@dataclass(frozen=True)
class BertaKpiData:
    plays: list[BertaPlay]
    shots: list[BertaShot]
    possessions: list[BertaPossession]
    events_by_id: dict[str, BertaCoordinateEvent]


def parse_berta_kpi_xml(xml_text: str) -> BertaKpiData:
    root = ET.fromstring(xml_text)
    plays: list[BertaPlay] = []
    shots: list[BertaShot] = []
    possessions: list[BertaPossession] = []
    events_by_id: dict[str, BertaCoordinateEvent] = {}

    for el in root.iter():
        if el.tag == "Play" and _is_true(el.get("SyncSuccessful")):
            frame = _optional_int(el.get("SyncedFrameId"))
            x = _optional_float(el.get("X-Position"))
            y = _optional_float(el.get("Y-Position"))
            if frame is None or x is None or y is None:
                continue
            play = BertaPlay(
                event_id=_required(el, "EventId"),
                team_id=_required(el, "TeamId"),
                player_id=_required(el, "PlayerId"),
                receiver_id=el.get("ReceiverId"),
                frame=frame,
                section=_normalize_section(el.get("InGameSection") or el.get("GameSection") or "firstHalf"),
                x=x,
                y=y,
                receiver_x=_optional_float(el.get("X-PositionReceiver")),
                receiver_y=_optional_float(el.get("Y-PositionReceiver")),
                x_direction=_optional_float(el.get("X-Direction")),
                y_direction=_optional_float(el.get("Y-Direction")),
                distance=_optional_float(el.get("Distance")),
                evaluation=el.get("Evaluation"),
                is_pass=_is_true(el.get("IsPass")),
                is_goal_kick=_is_true(el.get("IsGoalKick")),
                is_free_kick=_is_true(el.get("IsFreeKick")),
                is_throw_in=_is_true(el.get("IsThrowIn")),
                is_corner=_is_true(el.get("IsCorner")),
                is_kickoff=_is_true(el.get("IsKickOff")),
                pressure_on_player=_optional_float(el.get("PressureOnPlayer")),
                distance_closest_defender=_optional_float(el.get("DistanceClosestDefenderToPlayer")),
                num_defenders_goal_side=_optional_int(el.get("NumDefendersGoalSide")),
                xp=_optional_float(el.get("xP")),
                play_num_in_possession=_optional_int(el.get("PlayNumInPossession")),
            )
            plays.append(play)
            events_by_id[play.event_id] = BertaCoordinateEvent(
                event_id=play.event_id,
                event_type="play",
                team_id=play.team_id,
                player_id=play.player_id,
                frame=play.frame,
                section=play.section,
                x=play.x,
                y=play.y,
                receiver_x=play.receiver_x,
                receiver_y=play.receiver_y,
            )
        elif el.tag == "ShotAtGoal" and _is_true(el.get("SyncSuccessful")):
            frame = _optional_int(el.get("SyncedFrameId"))
            x = _optional_float(el.get("X-Position"))
            y = _optional_float(el.get("Y-Position"))
            xg = _optional_float(el.get("xG"))
            if frame is None or x is None or y is None or xg is None:
                continue
            shot = BertaShot(
                event_id=_required(el, "EventId"),
                team_id=_required(el, "TeamId"),
                player_id=el.get("PlayerId"),
                frame=frame,
                section=_normalize_section(el.get("InGameSection") or el.get("GameSection") or "firstHalf"),
                x=x,
                y=y,
                xg=xg,
                shot_result=el.get("ShotResult"),
            )
            shots.append(shot)
            events_by_id[shot.event_id] = BertaCoordinateEvent(
                event_id=shot.event_id,
                event_type="shot",
                team_id=shot.team_id,
                player_id=shot.player_id,
                frame=shot.frame,
                section=shot.section,
                x=shot.x,
                y=shot.y,
            )
        elif el.tag == "Carry" and _is_true(el.get("SyncSuccessful")):
            frame = _optional_int(el.get("SyncedFrameId"))
            x = _optional_float(el.get("X-Position"))
            y = _optional_float(el.get("Y-Position"))
            if frame is None or x is None or y is None:
                continue
            event_id = _required(el, "EventId")
            events_by_id[event_id] = BertaCoordinateEvent(
                event_id=event_id,
                event_type="carry",
                team_id=el.get("TeamId"),
                player_id=el.get("PlayerId"),
                frame=frame,
                section=_normalize_section(el.get("InGameSection") or el.get("GameSection") or "firstHalf"),
                x=x,
                y=y,
                end_x=_optional_float(el.get("X-EndPosition")),
                end_y=_optional_float(el.get("Y-EndPosition")),
            )
        elif el.tag == "Reception" and _is_true(el.get("SyncSuccessful")):
            frame = _optional_int(el.get("SyncedFrameId"))
            x = _optional_float(el.get("X-Position"))
            y = _optional_float(el.get("Y-Position"))
            if frame is None or x is None or y is None:
                continue
            event_id = _required(el, "EventId")
            events_by_id[event_id] = BertaCoordinateEvent(
                event_id=event_id,
                event_type="reception",
                team_id=el.get("TeamId"),
                player_id=el.get("PlayerId"),
                frame=frame,
                section=_normalize_section(el.get("InGameSection") or el.get("GameSection") or "firstHalf"),
                x=x,
                y=y,
            )
        elif el.tag == "TeamPossession" and _is_true(el.get("SyncSuccessful")):
            frame = _optional_int(el.get("SyncedFrameId"))
            end_frame = _optional_int(el.get("EndSyncedFrameId"))
            x = _optional_float(el.get("X-Position"))
            y = _optional_float(el.get("Y-Position"))
            if frame is None or end_frame is None or x is None or y is None:
                continue
            event_ids = [child.get("EventId") for child in el.iter("PossessionEvent") if child.get("EventId")]
            team_id = el.get("TeamId") or _team_id_from_events(event_ids, events_by_id)
            if team_id is None:
                continue
            possessions.append(
                BertaPossession(
                    event_id=_required(el, "EventId"),
                    team_id=team_id,
                    frame=frame,
                    end_frame=end_frame,
                    section=_normalize_section(el.get("InGameSection") or el.get("GameSection") or "firstHalf"),
                    x=x,
                    y=y,
                    end_x=_optional_float(el.get("X-EndPosition")),
                    end_y=_optional_float(el.get("Y-EndPosition")),
                    sum_xg_ind=_optional_float(el.get("SumXGInd")),
                    vertical_gain_overall=_optional_float(el.get("VerticalGainOverall")),
                    event_ids=event_ids,
                )
            )

    return BertaKpiData(
        plays=sorted(plays, key=lambda item: (item.section, item.frame, item.event_id)),
        shots=sorted(shots, key=lambda item: (item.section, item.frame, item.event_id)),
        possessions=sorted(possessions, key=lambda item: (item.section, item.frame, item.event_id)),
        events_by_id=events_by_id,
    )


def build_defensive_passing_rows(
    context: MatchContext,
    players_by_id: dict[str, PlayerInfo],
    data: BertaKpiData,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    plays_by_id = {play.event_id: play for play in data.plays}
    for possession in data.possessions:
        if not _possession_starts_with_goalkeeper(possession, players_by_id, data):
            continue
        possession_plays = [plays_by_id[event_id] for event_id in possession.event_ids if event_id in plays_by_id]
        for play in possession_plays:
            player = players_by_id.get(play.player_id)
            if player is None or not play.is_pass:
                continue
            if not _is_back_build_actor(player):
                continue
            if not _is_defensive_or_middle_third(context, play.team_id, play.section, play.x):
                continue
            forward_delta, lateral_delta = _oriented_pass_deltas(context, play)
            team = context.teams_by_id.get(play.team_id)
            rows.append(
                {
                    "match_folder": context.match_folder,
                    "possession_id": possession.event_id,
                    "event_id": play.event_id,
                    "team_id": play.team_id,
                    "team_name": team.name if team else play.team_id,
                    "player_id": play.player_id,
                    "player_name": player.short_name,
                    "playing_position": player.playing_position,
                    "player_role_group": "goalkeeper" if player.is_goalkeeper else "defensive_midfield_player",
                    "is_goalkeeper_pass": player.is_goalkeeper,
                    "section": play.section,
                    "frame": play.frame,
                    "x": play.x,
                    "y": play.y,
                    "receiver_x": play.receiver_x,
                    "receiver_y": play.receiver_y,
                    "evaluation": play.evaluation,
                    "completed": _is_completed(play.evaluation),
                    "forward_delta": forward_delta,
                    "lateral_delta": lateral_delta,
                    "pass_length": abs(forward_delta) if forward_delta is not None else play.distance,
                    "pass_width": abs(lateral_delta) if lateral_delta is not None else None,
                    "pressure_on_player": play.pressure_on_player,
                    "distance_closest_defender": play.distance_closest_defender,
                    "under_pressure": _pass_under_pressure(play),
                    "source_scope": "goalkeeper_start_possession_defensive_midfield_actor",
                }
            )
    return rows


def summarize_defensive_passing_style(
    context: MatchContext,
    rows: list[dict[str, Any]],
    *,
    game_count: int = 1,
) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(str(row["team_id"]), []).append(row)

    summaries = []
    for team_id, team_rows in grouped.items():
        outfield_rows = [row for row in team_rows if not bool(row.get("is_goalkeeper_pass"))]
        goalkeeper_rows = [row for row in team_rows if bool(row.get("is_goalkeeper_pass"))]
        pressure_rows = [row for row in outfield_rows if bool(row.get("under_pressure"))]
        team = context.teams_by_id.get(team_id)
        summaries.append(
            {
                "match_folder": context.match_folder,
                "team_id": team_id,
                "team_name": team.name if team else team_id,
                "game_count": game_count,
                "qualifying_goalkeeper_start_possessions": len({row["possession_id"] for row in team_rows}),
                "total_passes_per_game": _per_game(len(outfield_rows), game_count),
                "successful_passes": sum(1 for row in outfield_rows if bool(row.get("completed"))),
                "success_rate": _mean_bool(outfield_rows, "completed"),
                "goalkeeper_passes_per_game": _per_game(len(goalkeeper_rows), game_count),
                "passes_under_pressure_per_game": _per_game(len(pressure_rows), game_count),
                "success_rate_under_pressure": _mean_bool(pressure_rows, "completed"),
                "average_pass_length": _mean_key(outfield_rows, "pass_length"),
                "average_pass_width": _mean_key(outfield_rows, "pass_width"),
                "paper_metric_scope_note": (
                    "StatsBomb tactical zones 1-16 are approximated with DFL playing-position "
                    "codes plus defensive/middle-third event location."
                ),
            }
        )
    return sorted(summaries, key=lambda row: row["team_name"])


def build_possession_pressure_rows(
    context: MatchContext,
    players_by_id: dict[str, PlayerInfo],
    data: BertaKpiData,
) -> list[dict[str, Any]]:
    plays_by_id = {play.event_id: play for play in data.plays}
    shots_by_id = {shot.event_id: shot for shot in data.shots}
    rows: list[dict[str, Any]] = []
    for possession in data.possessions:
        if not _is_structured_defensive_field_possession(context, possession, plays_by_id):
            continue
        possession_plays = [plays_by_id[event_id] for event_id in possession.event_ids if event_id in plays_by_id]
        possession_shots = [shots_by_id[event_id] for event_id in possession.event_ids if event_id in shots_by_id]
        distances = [play.distance_closest_defender for play in possession_plays if play.distance_closest_defender is not None]
        goal_side_counts = [play.num_defenders_goal_side for play in possession_plays if play.num_defenders_goal_side is not None]
        pressure_values = [play.pressure_on_player for play in possession_plays if play.pressure_on_player is not None]
        first_play = min(possession_plays, key=lambda play: (play.frame, play.event_id)) if possession_plays else None
        first_player = players_by_id.get(first_play.player_id) if first_play is not None else None
        xg = possession.sum_xg_ind if possession.sum_xg_ind is not None else sum(shot.xg for shot in possession_shots)
        max_xp = _safe_max([play.xp for play in possession_plays if play.xp is not None])
        obv_proxy = _obv_proxy(max_xp, xg)
        distance_to_nearest = _safe_min(distances)
        hull_overlap = None
        under_pressure = _under_pressure(distance_to_nearest, hull_overlap, _mean(pressure_values))
        team = context.teams_by_id.get(possession.team_id)
        rows.append(
            {
                "match_folder": context.match_folder,
                "possession_id": possession.event_id,
                "team_id": possession.team_id,
                "team_name": team.name if team else possession.team_id,
                "section": possession.section,
                "period": _period_name(possession.section),
                "start_frame": possession.frame,
                "end_frame": possession.end_frame,
                "start_x": possession.x,
                "start_y": possession.y,
                "end_x": possession.end_x,
                "end_y": possession.end_y,
                "event_count": len(possession.event_ids),
                "play_count": len(possession_plays),
                "shot_count": len(possession_shots),
                "first_actor_id": None if first_play is None else first_play.player_id,
                "first_actor_name": None if first_player is None else first_player.short_name,
                "starts_in_defensive_field": True,
                "counterattack_filter": "proxy_structured_buildup_no_kickoff_or_corner_start",
                "goal_opportunity": _has_goal_opportunity(context, possession.team_id, possession.section, data, possession),
                "xg": xg,
                "max_xp": max_xp,
                "obv_proxy": obv_proxy,
                "obv_source_note": "StatsBomb OBV is not present in KPI XML; proxy=min(1, max possession xP + possession xG).",
                "distance_to_nearest_defender": distance_to_nearest,
                "num_defenders_goal_side_mean": _mean(goal_side_counts),
                "sum_distance_to_nearest_defenders": None,
                "overlap_convex_hull": hull_overlap,
                "pressure_on_ball_mean": _mean(pressure_values),
                "under_pressure": under_pressure,
                "pressure_threshold_note": "pressure if nearest defender < 3m or convex-hull overlap > 50%; pressure score is fallback only.",
                "tracking_sampled": False,
            }
        )
    return rows


def compute_spatial_pressure_metrics(
    context: MatchContext,
    players_by_id: dict[str, PlayerInfo],
    frame: SkeletonFrame,
    *,
    possession_team_id: str,
    ball_carrier_id: str | None = None,
) -> dict[str, Any]:
    del context
    players_by_key = {player.parquet_key: player for player in players_by_id.values()}
    possession_points: list[tuple[float, float]] = []
    defender_points: list[tuple[float, float]] = []
    ball_carrier_point: tuple[float, float] | None = None
    for key, parts in frame.players.items():
        player = players_by_key.get(key)
        pelvis = parts.get("pelvis")
        if player is None or pelvis is None:
            continue
        point = (pelvis.x, pelvis.y)
        if player.team_id == possession_team_id:
            possession_points.append(point)
            if ball_carrier_id is not None and player.person_id == ball_carrier_id:
                ball_carrier_point = point
        else:
            defender_points.append(point)

    nearest_distances = [
        _nearest_distance(point, defender_points)
        for point in possession_points
        if _nearest_distance(point, defender_points) is not None
    ]
    ball_carrier_nearest = _nearest_distance(ball_carrier_point, defender_points) if ball_carrier_point is not None else _safe_min(nearest_distances)
    overlap = _convex_hull_overlap_ratio(possession_points, defender_points)
    return {
        "tracking_sampled": True,
        "tracking_frame_number": frame.frame_number,
        "tracking_attacker_count": len(possession_points),
        "tracking_defender_count": len(defender_points),
        "tracking_ball_carrier_nearest_defender_distance": ball_carrier_nearest,
        "sum_teammate_nearest_defender_distance": sum(nearest_distances) if nearest_distances else None,
        "sum_distance_to_nearest_defenders": sum(nearest_distances) if nearest_distances else None,
        "overlap_convex_hull": overlap,
    }


def apply_spatial_metrics_to_possession_row(row: dict[str, Any], metrics: dict[str, Any]) -> None:
    row.update(metrics)
    row["distance_to_nearest_defender"] = _first_number(
        metrics.get("tracking_ball_carrier_nearest_defender_distance"),
        row.get("distance_to_nearest_defender"),
    )
    row["under_pressure"] = _under_pressure(
        _to_float(row.get("distance_to_nearest_defender")),
        _to_float(row.get("overlap_convex_hull")),
        _to_float(row.get("pressure_on_ball_mean")),
    )


def summarize_pressure_by_condition(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped = {
        "pressure": [row for row in rows if bool(row.get("under_pressure"))],
        "no_pressure": [row for row in rows if not bool(row.get("under_pressure"))],
    }
    summary = []
    for condition, condition_rows in grouped.items():
        if not condition_rows:
            continue
        summary.append(
            {
                "condition": condition,
                "possession_count": len(condition_rows),
                "goal_opportunity_count": sum(1 for row in condition_rows if bool(row.get("goal_opportunity"))),
                "goal_opportunity_rate": _mean_bool(condition_rows, "goal_opportunity"),
                "xg_per_possession": _mean_key(condition_rows, "xg"),
                "xg_per_possession_x100": _multiply(_mean_key(condition_rows, "xg"), 100.0),
                "obv_proxy_per_possession": _mean_key(condition_rows, "obv_proxy"),
                "obv_proxy_per_possession_x100": _multiply(_mean_key(condition_rows, "obv_proxy"), 100.0),
                "distance_to_nearest_defender_mean": _mean_key(condition_rows, "distance_to_nearest_defender"),
                "overlap_convex_hull_mean": _mean_key(condition_rows, "overlap_convex_hull"),
            }
        )
    order = {"pressure": 0, "no_pressure": 1}
    return sorted(summary, key=lambda row: order[row["condition"]])


def summarize_pressure_by_team(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault(str(row.get("team_id") or ""), []).append(row)
    summaries = []
    for team_id, team_rows in grouped.items():
        team_name = next((row.get("team_name") for row in team_rows if row.get("team_name")), team_id)
        pressure_rows = [row for row in team_rows if bool(row.get("under_pressure"))]
        no_pressure_rows = [row for row in team_rows if not bool(row.get("under_pressure"))]
        summaries.append(
            {
                "team_id": team_id,
                "team_name": team_name,
                "possession_count": len(team_rows),
                "pressure_possession_count": len(pressure_rows),
                "pressure_possession_rate": _mean_bool(team_rows, "under_pressure"),
                "goal_opportunity_rate": _mean_bool(team_rows, "goal_opportunity"),
                "goal_opportunity_rate_pressure": _mean_bool(pressure_rows, "goal_opportunity"),
                "goal_opportunity_rate_no_pressure": _mean_bool(no_pressure_rows, "goal_opportunity"),
                "xg_per_possession": _mean_key(team_rows, "xg"),
                "xg_per_possession_pressure": _mean_key(pressure_rows, "xg"),
                "xg_per_possession_no_pressure": _mean_key(no_pressure_rows, "xg"),
                "obv_proxy_per_possession": _mean_key(team_rows, "obv_proxy"),
                "obv_proxy_per_possession_pressure": _mean_key(pressure_rows, "obv_proxy"),
                "obv_proxy_per_possession_no_pressure": _mean_key(no_pressure_rows, "obv_proxy"),
            }
        )
    return sorted(summaries, key=lambda row: row["team_name"])


def build_period_model_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in rows:
        grouped.setdefault((str(row.get("team_id") or ""), str(row.get("period") or "")), []).append(row)
    model_rows = []
    for (team_id, period), period_rows in grouped.items():
        team_name = next((row.get("team_name") for row in period_rows if row.get("team_name")), team_id)
        model_rows.append(
            {
                "team_id": team_id,
                "team_name": team_name,
                "period": period,
                "possession_count": len(period_rows),
                "obv_proxy_mean": _mean_key(period_rows, "obv_proxy"),
                "goal_opportunity_rate": _mean_bool(period_rows, "goal_opportunity"),
                "xg_per_possession": _mean_key(period_rows, "xg"),
                "distance_to_nearest_defender_mean": _mean_key(period_rows, "distance_to_nearest_defender"),
                "num_defenders_goal_side_mean": _mean_key(period_rows, "num_defenders_goal_side_mean"),
                "sum_distance_to_nearest_defenders_mean": _mean_key(period_rows, "sum_distance_to_nearest_defenders"),
                "overlap_convex_hull_mean": _mean_key(period_rows, "overlap_convex_hull"),
                "under_pressure_rate": _mean_bool(period_rows, "under_pressure"),
                "cluster": "",
                "ranking_difference": "",
                "home_game": "",
                "spectators": "",
                "paper_model_note": "One-match model design table; season rankings/clusters are unavailable for this two-team sample.",
            }
        )
    return sorted(model_rows, key=lambda row: (row["team_name"], row["period"]))


def render_berta_readme(
    *,
    match_folder: str,
    passing_rows: int,
    passing_summary_rows: int,
    possession_rows: int,
    tracking_sample_rows: int,
    pressure_summary_rows: int,
    team_summary_rows: int,
    period_model_rows: int,
) -> str:
    return f"""# Berta 2024 Pressing And Defensive Solidity Metrics

This directory is generated by `scripts/build_berta_metrics.py` for `{match_folder}`.

The implementation follows the paper `papers/Research-Paper-2024-Berta.docx.pdf` for a one-game AWS sample:

- defensive build-up passing style for goalkeeper-start possessions.
- possession-level pressure, goal opportunity, xG, and a value proxy.
- optional skeleton-frame spatial pressure samples for the paper's 360-style sum-of-nearest-defender-distance and convex-hull-overlap metrics.
- period-level rows shaped like the paper's regression input.

Rows:

- `defensive_passing_events.csv`: {passing_rows} qualifying pass event row(s).
- `defensive_passing_summary.csv`: {passing_summary_rows} team passing-style row(s).
- `possession_pressure.csv`: {possession_rows} structured defensive-field possession row(s).
- `tracking_pressure_samples.csv`: {tracking_sample_rows} sampled S3 skeleton pressure row(s).
- `pressure_summary_by_condition.csv`: {pressure_summary_rows} pressure/no-pressure comparison row(s).
- `pressure_summary_by_team.csv`: {team_summary_rows} team comparison row(s).
- `period_model_rows.csv`: {period_model_rows} half-level model-design row(s).

Caveats:

- The paper's StatsBomb `under_pressure` pass flag is approximated with KPI `PressureOnPlayer` and nearest-defender distance.
- The paper's StatsBomb 360 frame is approximated with one S3 parquet skeleton frame per sampled possession.
- StatsBomb OBV is not present in this dataset, so `obv_proxy = min(1, max possession xP + possession xG)`.
- StatsBomb tactical zones 1-16 are approximated with DFL player position codes and defensive/middle-third event locations.
- No full parquet or positional XML file is downloaded.
"""


def _possession_starts_with_goalkeeper(
    possession: BertaPossession,
    players_by_id: dict[str, PlayerInfo],
    data: BertaKpiData,
) -> bool:
    event = _first_possession_event(possession, data)
    if event is None or event.player_id is None:
        return False
    player = players_by_id.get(event.player_id)
    return bool(player and player.is_goalkeeper)


def _team_id_from_events(event_ids: list[str], events_by_id: dict[str, BertaCoordinateEvent]) -> str | None:
    for event_id in event_ids:
        event = events_by_id.get(event_id)
        if event is not None and event.team_id:
            return event.team_id
    return None


def _first_possession_event(possession: BertaPossession, data: BertaKpiData) -> BertaCoordinateEvent | None:
    events = [data.events_by_id[event_id] for event_id in possession.event_ids if event_id in data.events_by_id]
    if not events:
        return None
    return min(events, key=lambda event: (event.frame if event.frame is not None else 10**12, event.event_id))


def _is_structured_defensive_field_possession(
    context: MatchContext,
    possession: BertaPossession,
    plays_by_id: dict[str, BertaPlay],
) -> bool:
    if not _is_own_half(context, possession.team_id, possession.section, possession.x):
        return False
    possession_plays = [plays_by_id[event_id] for event_id in possession.event_ids if event_id in plays_by_id]
    if not possession_plays:
        return False
    first_play = min(possession_plays, key=lambda play: (play.frame, play.event_id))
    if first_play.is_kickoff or first_play.is_corner:
        return False
    return True


def _is_back_build_actor(player: PlayerInfo) -> bool:
    if player.is_goalkeeper:
        return True
    position = (player.playing_position or "").upper()
    if not position:
        return False
    if position.startswith(("IV", "LV", "RV", "DM", "ZM", "DR", "DL")):
        return True
    return position in {"M", "D", "LM", "RM"}


def _is_defensive_or_middle_third(context: MatchContext, team_id: str, section: str, x: float) -> bool:
    attacking_positive = _attacks_positive_x(context, team_id, section)
    final_third_edge = context.pitch_length_m / 2.0 - context.pitch_length_m / 3.0
    return x <= final_third_edge if attacking_positive else x >= -final_third_edge


def _is_own_half(context: MatchContext, team_id: str, section: str, x: float) -> bool:
    attacking_positive = _attacks_positive_x(context, team_id, section)
    return x <= 0 if attacking_positive else x >= 0


def _attacks_positive_x(context: MatchContext, team_id: str, section: str) -> bool:
    team = context.teams_by_id.get(team_id)
    if team is None:
        return True
    home_gk_left = context.phase_home_gk_left.get(section)
    if home_gk_left is None:
        return True
    if team.role == "home":
        return bool(home_gk_left)
    return not bool(home_gk_left)


def _oriented_pass_deltas(context: MatchContext, play: BertaPlay) -> tuple[float | None, float | None]:
    dx = play.x_direction
    dy = play.y_direction
    if dx is None and play.receiver_x is not None:
        dx = play.receiver_x - play.x
    if dy is None and play.receiver_y is not None:
        dy = play.receiver_y - play.y
    if dx is None:
        return None, dy
    forward = dx if _attacks_positive_x(context, play.team_id, play.section) else -dx
    return forward, dy


def _has_goal_opportunity(
    context: MatchContext,
    team_id: str,
    section: str,
    data: BertaKpiData,
    possession: BertaPossession,
) -> bool:
    for event_id in possession.event_ids:
        event = data.events_by_id.get(event_id)
        if event is None:
            continue
        for point in _event_points(event):
            if _point_in_opponent_penalty_area(context, team_id, section, point[0], point[1]):
                return True
    return False


def _event_points(event: BertaCoordinateEvent) -> list[tuple[float, float]]:
    points = []
    for x, y in [(event.x, event.y), (event.end_x, event.end_y), (event.receiver_x, event.receiver_y)]:
        if x is not None and y is not None:
            points.append((x, y))
    return points


def _point_in_opponent_penalty_area(context: MatchContext, team_id: str, section: str, x: float, y: float) -> bool:
    attacking_positive = _attacks_positive_x(context, team_id, section)
    penalty_edge = context.pitch_length_m / 2.0 - PENALTY_AREA_DEPTH_M
    in_x = x >= penalty_edge if attacking_positive else x <= -penalty_edge
    return in_x and abs(y) <= PENALTY_AREA_HALF_WIDTH_M


def _pass_under_pressure(play: BertaPlay) -> bool:
    if play.pressure_on_player is not None and play.pressure_on_player > 0:
        return True
    return play.distance_closest_defender is not None and play.distance_closest_defender < PRESSURE_DISTANCE_THRESHOLD_M


def _under_pressure(
    nearest_defender_distance: float | None,
    overlap_convex_hull: float | None,
    pressure_on_ball_mean: float | None,
) -> bool:
    if nearest_defender_distance is not None and nearest_defender_distance < PRESSURE_DISTANCE_THRESHOLD_M:
        return True
    if overlap_convex_hull is not None and overlap_convex_hull > PRESSURE_HULL_OVERLAP_THRESHOLD:
        return True
    return bool(pressure_on_ball_mean is not None and pressure_on_ball_mean >= 0.50)


def _obv_proxy(max_xp: float | None, xg: float | None) -> float | None:
    values = [value for value in [max_xp, xg] if value is not None]
    if not values:
        return None
    return min(1.0, (max_xp or 0.0) + (xg or 0.0))


def _convex_hull_overlap_ratio(
    possession_points: list[tuple[float, float]],
    defender_points: list[tuple[float, float]],
) -> float | None:
    attacking_hull = _convex_hull(possession_points)
    defending_hull = _convex_hull(defender_points)
    attacking_area = _polygon_area(attacking_hull)
    if len(attacking_hull) < 3 or len(defending_hull) < 3 or attacking_area <= 0:
        return None
    clipped = _clip_polygon(attacking_hull, defending_hull)
    intersection_area = _polygon_area(clipped)
    return max(0.0, min(1.0, intersection_area / attacking_area))


def _convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    unique = sorted(set(points))
    if len(unique) <= 1:
        return unique

    def cross(o: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower: list[tuple[float, float]] = []
    for point in unique:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    upper: list[tuple[float, float]] = []
    for point in reversed(unique):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return lower[:-1] + upper[:-1]


def _clip_polygon(subject: list[tuple[float, float]], clip: list[tuple[float, float]]) -> list[tuple[float, float]]:
    output = subject[:]
    if not output:
        return []
    clip_area_sign = 1.0 if _signed_polygon_area(clip) >= 0 else -1.0
    for index, edge_start in enumerate(clip):
        edge_end = clip[(index + 1) % len(clip)]
        input_list = output
        output = []
        if not input_list:
            break
        previous = input_list[-1]
        for current in input_list:
            current_inside = _inside_half_plane(current, edge_start, edge_end, clip_area_sign)
            previous_inside = _inside_half_plane(previous, edge_start, edge_end, clip_area_sign)
            if current_inside:
                if not previous_inside:
                    output.append(_line_intersection(previous, current, edge_start, edge_end))
                output.append(current)
            elif previous_inside:
                output.append(_line_intersection(previous, current, edge_start, edge_end))
            previous = current
    return output


def _inside_half_plane(
    point: tuple[float, float],
    edge_start: tuple[float, float],
    edge_end: tuple[float, float],
    clip_area_sign: float,
) -> bool:
    cross = (edge_end[0] - edge_start[0]) * (point[1] - edge_start[1]) - (edge_end[1] - edge_start[1]) * (point[0] - edge_start[0])
    return cross * clip_area_sign >= -1e-9


def _line_intersection(
    p1: tuple[float, float],
    p2: tuple[float, float],
    q1: tuple[float, float],
    q2: tuple[float, float],
) -> tuple[float, float]:
    x1, y1 = p1
    x2, y2 = p2
    x3, y3 = q1
    x4, y4 = q2
    denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if abs(denominator) < 1e-12:
        return p2
    px = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / denominator
    py = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / denominator
    return (px, py)


def _polygon_area(points: list[tuple[float, float]]) -> float:
    return abs(_signed_polygon_area(points))


def _signed_polygon_area(points: list[tuple[float, float]]) -> float:
    if len(points) < 3:
        return 0.0
    total = 0.0
    for index, point in enumerate(points):
        nxt = points[(index + 1) % len(points)]
        total += point[0] * nxt[1] - nxt[0] * point[1]
    return total / 2.0


def _nearest_distance(point: tuple[float, float] | None, targets: list[tuple[float, float]]) -> float | None:
    if point is None or not targets:
        return None
    return min(math.hypot(point[0] - target[0], point[1] - target[1]) for target in targets)


def _period_name(section: str) -> str:
    if section == "firstHalf":
        return "first_half"
    if section == "secondHalf":
        return "second_half"
    return section


def _is_completed(evaluation: str | None) -> bool:
    return str(evaluation or "").strip() == "successfullyCompleted"


def _per_game(value: int | float, game_count: int) -> float | int:
    if game_count == 1:
        return value
    return value / game_count if game_count else 0.0


def _mean(values: list[float | int | None]) -> float | None:
    numeric = [float(value) for value in values if _is_number(value)]
    if not numeric:
        return None
    return sum(numeric) / len(numeric)


def _mean_key(rows: list[dict[str, Any]], key: str) -> float | None:
    return _mean([row.get(key) for row in rows])


def _mean_bool(rows: list[dict[str, Any]], key: str) -> float | None:
    if not rows:
        return None
    return sum(1.0 for row in rows if bool(row.get(key))) / len(rows)


def _safe_min(values: list[float | None]) -> float | None:
    numeric = [float(value) for value in values if _is_number(value)]
    return min(numeric) if numeric else None


def _safe_max(values: list[float | None]) -> float | None:
    numeric = [float(value) for value in values if _is_number(value)]
    return max(numeric) if numeric else None


def _multiply(value: float | None, factor: float) -> float | None:
    return None if value is None else value * factor


def _first_number(*values: Any) -> float | None:
    for value in values:
        parsed = _to_float(value)
        if parsed is not None:
            return parsed
    return None


def _to_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    if isinstance(value, str) and value:
        try:
            parsed = float(value)
        except ValueError:
            return None
        if math.isfinite(parsed):
            return parsed
    return None


def _is_number(value: Any) -> bool:
    return _to_float(value) is not None


def _required(el: ET.Element, attr: str) -> str:
    value = el.get(attr)
    if value is None:
        raise ValueError(f"Missing required attribute {attr}")
    return value


def _optional_float(value: str | None) -> float | None:
    return _to_float(value)


def _optional_int(value: str | None) -> int | None:
    parsed = _to_float(value)
    return None if parsed is None else int(parsed)


def _is_true(value: str | None) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes", "successfullycompleted"}


def _normalize_section(value: str) -> str:
    if value in {"firstHalf", "1", "first"}:
        return "firstHalf"
    if value in {"secondHalf", "2", "second"}:
        return "secondHalf"
    return value
