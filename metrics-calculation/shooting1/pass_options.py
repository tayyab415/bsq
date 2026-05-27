from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Any

from aws_football.dribble_pose import PlayerInfo, SkeletonFrame, Vec3
from aws_football.pitch_control import PitchPlayer, pass_option_value, shot_control_value
from aws_football.positional_xml import PositionalFrameSnapshot

from .metric import ShotEvent


@dataclass(frozen=True)
class KpiPassCandidate:
    event_id: str
    player_id: str
    receiver_id: str
    synced_frame_id: int
    passer_x: float
    passer_y: float
    receiver_x: float
    receiver_y: float
    xp: float
    team_id: str


def index_kpi_pass_candidates(kpi_xml: str) -> list[KpiPassCandidate]:
    root = ET.fromstring(kpi_xml)
    rows: list[KpiPassCandidate] = []
    for el in root.iter("Play"):
        if el.get("IsPass") not in {"true", "True", "1"}:
            continue
        synced = _optional_int(el.get("SyncedFrameId"))
        xp = _optional_float(el.get("xP"))
        receiver_id = el.get("ReceiverId")
        player_id = el.get("PlayerId")
        team_id = el.get("TeamId")
        if synced is None or xp is None or not receiver_id or not player_id or not team_id:
            continue
        passer_x = _optional_float(el.get("X-Position"))
        passer_y = _optional_float(el.get("Y-Position"))
        receiver_x = _optional_float(el.get("X-PositionReceiver"))
        receiver_y = _optional_float(el.get("Y-PositionReceiver"))
        if passer_x is None or passer_y is None or receiver_x is None or receiver_y is None:
            continue
        rows.append(
            KpiPassCandidate(
                event_id=el.get("EventId") or "",
                player_id=player_id,
                receiver_id=receiver_id,
                synced_frame_id=synced,
                passer_x=passer_x,
                passer_y=passer_y,
                receiver_x=receiver_x,
                receiver_y=receiver_y,
                xp=xp,
                team_id=team_id,
            )
        )
    return rows


def compute_decision_context(
    shot: ShotEvent,
    frames: list[SkeletonFrame],
    players: dict[str, PlayerInfo],
    *,
    positional_snapshot: PositionalFrameSnapshot | None = None,
    kpi_passes: list[KpiPassCandidate] | None = None,
) -> dict[str, Any]:
    if positional_snapshot is not None:
        fields = _decision_context_from_positional(shot, frames, players, positional_snapshot)
        if fields:
            fields["decision_context_source"] = "positional_pitch_control"
            return fields
    fields = _decision_context_from_skeleton_pitch_control(shot, frames, players)
    if fields:
        fields["decision_context_source"] = "skeleton_pitch_control"
        kpi_fields = _decision_context_from_kpi_passes(shot, kpi_passes or [])
        if kpi_fields:
            fields = _merge_decision_fields(fields, kpi_fields)
        return fields
    kpi_fields = _decision_context_from_kpi_passes(shot, kpi_passes or [])
    if kpi_fields:
        kpi_fields["decision_context_source"] = "kpi_xp_passes"
        return kpi_fields
    return {}


def _merge_decision_fields(primary: dict[str, Any], kpi: dict[str, Any]) -> dict[str, Any]:
    merged = dict(primary)
    kpi_value = _safe_float(kpi.get("best_pass_option_value"))
    primary_value = _safe_float(primary.get("best_pass_option_value"))
    if kpi_value is not None and (primary_value is None or kpi_value > primary_value):
        for key in (
            "best_pass_option_player_id",
            "best_pass_option_value",
            "best_pass_option_distance_m",
            "pass_value_margin",
            "better_pass_available",
        ):
            if key in kpi:
                merged[key] = kpi[key]
        merged["decision_context_source"] = "skeleton_pitch_control+kpi_xp"
    return merged


def _decision_context_from_kpi_passes(shot: ShotEvent, passes: list[KpiPassCandidate]) -> dict[str, Any]:
    if not passes:
        return {}
    shot_value = _safe_float(shot.xg)
    if shot_value is None:
        shot_value = 0.0
    window = 125
    best: dict[str, Any] | None = None
    for candidate in passes:
        if candidate.team_id != shot.team_id:
            continue
        if abs(candidate.synced_frame_id - shot.synced_frame_id) > window:
            continue
        if candidate.receiver_id == shot.player_id:
            continue
        pass_distance = math.hypot(candidate.receiver_x - shot.x, candidate.receiver_y - shot.y)
        if pass_distance < 3.0 or pass_distance > 30.0:
            continue
        passer_distance = math.hypot(candidate.passer_x - shot.x, candidate.passer_y - shot.y)
        if passer_distance > 28.0:
            continue
        time_decay = max(0.35, 1.0 - abs(candidate.synced_frame_id - shot.synced_frame_id) / window)
        option_value = float(candidate.xp) * time_decay
        option = {
            "best_pass_option_player_id": candidate.receiver_id,
            "best_pass_option_value": option_value,
            "best_pass_option_distance_m": pass_distance,
            "best_pass_option_lane_score": None,
            "best_pass_option_pressure_score": None,
        }
        if best is None or option_value > float(best["best_pass_option_value"]):
            best = option
    if best is None:
        return {}
    margin = float(best["best_pass_option_value"]) - float(shot_value)
    return {
        "shot_value": shot_value,
        **best,
        "pass_value_margin": margin,
        "better_pass_available": margin > 0.04,
    }


def _decision_context_from_positional(
    shot: ShotEvent,
    frames: list[SkeletonFrame],
    players: dict[str, PlayerInfo],
    snapshot: PositionalFrameSnapshot,
) -> dict[str, Any]:
    shooter = players.get(shot.player_id)
    if shooter is None:
        return {}
    shooter_positional = snapshot.players.get(shot.player_id)
    if shooter_positional is None:
        return {}
    shooter_xy = (shooter_positional.x, shooter_positional.y)
    ball_xy = _ball_xy(shot, frames, shooter_xy)
    target_goal_x = _target_goal_x(shot, Vec3(shooter_xy[0], shooter_xy[1], 0.0))

    attacking: list[PitchPlayer] = []
    defending: list[PitchPlayer] = []
    teammate_positions: dict[str, tuple[float, float]] = {}
    for person_id, positional_player in snapshot.players.items():
        player = players.get(person_id)
        if player is None:
            continue
        pitch_player = PitchPlayer(
            person_id=person_id,
            team_id=player.team_id,
            position=Vec3(positional_player.x, positional_player.y, 0.0),
            velocity_x=float(positional_player.velocity_x or 0.0),
            velocity_y=float(positional_player.velocity_y or 0.0),
            speed_m_s=float(positional_player.speed_m_s or 0.0),
        )
        if player.team_id == shooter.team_id:
            attacking.append(pitch_player)
            teammate_positions[person_id] = (positional_player.x, positional_player.y)
        else:
            defending.append(pitch_player)

    if len(attacking) < 2 or not defending:
        return {}

    opponent_positions = [player.position for player in defending]
    shot_value = _safe_float(shot.xg)
    if shot_value is None:
        shot_value = 0.45 * _field_shot_option_value(Vec3(*shooter_xy, 0.0), opponent_positions, target_goal_x)
    shot_pc = shot_control_value(
        shooter_xy=shooter_xy,
        attacking=attacking,
        defending=defending,
        ball_xy=ball_xy,
    )

    best: dict[str, Any] | None = None
    for person_id, receiver_xy in teammate_positions.items():
        player = players.get(person_id)
        if player is None or person_id == shot.player_id or player.is_goalkeeper:
            continue
        pass_distance = math.hypot(receiver_xy[0] - shooter_xy[0], receiver_xy[1] - shooter_xy[1])
        if pass_distance < 3.0 or pass_distance > 25.0:
            continue
        lane_score = _pass_lane_score(Vec3(*shooter_xy, 0.0), Vec3(*receiver_xy, 0.0), opponent_positions)
        pressure_score = _nearest_pressure_score(Vec3(*receiver_xy, 0.0), opponent_positions)
        option_value, receiver_pc = pass_option_value(
            receiver_xy=receiver_xy,
            shooter_xy=shooter_xy,
            attacking=attacking,
            defending=defending,
            ball_xy=ball_xy,
            target_goal_x=target_goal_x,
            lane_score=lane_score,
            pass_distance_m=pass_distance,
        )
        option = {
            "best_pass_option_player_id": person_id,
            "best_pass_option_value": option_value,
            "best_pass_option_distance_m": pass_distance,
            "best_pass_option_lane_score": lane_score,
            "best_pass_option_pressure_score": pressure_score,
            "best_pass_pitch_control": receiver_pc,
        }
        if best is None or option_value > float(best["best_pass_option_value"]):
            best = option

    if best is None:
        return {
            "shot_value": shot_value,
            "shot_pitch_control": shot_pc,
            "better_pass_available": False,
            "pass_value_margin": 0.0,
        }
    margin = float(best["best_pass_option_value"]) - float(shot_value)
    return {
        "shot_value": shot_value,
        "shot_pitch_control": shot_pc,
        **best,
        "pass_value_margin": margin,
        "better_pass_available": margin > 0.04,
    }


def _decision_context_from_skeleton_pitch_control(
    shot: ShotEvent,
    frames: list[SkeletonFrame],
    players: dict[str, PlayerInfo],
) -> dict[str, Any]:
    if not frames or shot.player_parquet_key is None:
        return {}
    players_by_key = {player.parquet_key: player for player in players.values()}
    shooter = players_by_key.get(shot.player_parquet_key)
    if shooter is None:
        return {}
    frame = min(frames, key=lambda candidate: abs(candidate.frame_number - shot.skeleton_frame))
    prior = min(
        (candidate for candidate in frames if candidate.frame_number < frame.frame_number),
        key=lambda candidate: candidate.frame_number,
        default=None,
    )
    shooter_pos = _player_position(frame, shot.player_parquet_key)
    if shooter_pos is None:
        return {}
    shooter_xy = (shooter_pos.x, shooter_pos.y)
    ball_xy = _ball_xy(shot, frames, shooter_xy)
    target_goal_x = _target_goal_x(shot, shooter_pos)

    attacking: list[PitchPlayer] = []
    defending: list[PitchPlayer] = []
    teammate_positions: dict[str, tuple[float, float]] = {}
    for key, parts in frame.players.items():
        player = players_by_key.get(key)
        pos = _body_position(parts)
        if player is None or pos is None:
            continue
        prior_parts = prior.players.get(key) if prior is not None else None
        prior_pos = _body_position(prior_parts) if prior_parts else None
        vx, vy, speed = _estimate_velocity(pos, prior_pos)
        pitch_player = PitchPlayer(
            person_id=player.person_id,
            team_id=player.team_id,
            position=pos,
            velocity_x=vx,
            velocity_y=vy,
            speed_m_s=speed,
        )
        if player.team_id == shooter.team_id:
            attacking.append(pitch_player)
            teammate_positions[player.person_id] = (pos.x, pos.y)
        else:
            defending.append(pitch_player)

    if len(attacking) < 2 or not defending:
        return {}

    opponent_positions = [player.position for player in defending]
    shot_value = _safe_float(shot.xg)
    if shot_value is None:
        shot_value = 0.45 * _field_shot_option_value(shooter_pos, opponent_positions, target_goal_x)
    shot_pc = shot_control_value(
        shooter_xy=shooter_xy,
        attacking=attacking,
        defending=defending,
        ball_xy=ball_xy,
    )

    best: dict[str, Any] | None = None
    for person_id, receiver_xy in teammate_positions.items():
        player = players.get(person_id)
        if player is None or person_id == shot.player_id or player.is_goalkeeper:
            continue
        pass_distance = math.hypot(receiver_xy[0] - shooter_xy[0], receiver_xy[1] - shooter_xy[1])
        if pass_distance < 3.0 or pass_distance > 25.0:
            continue
        lane_score = _pass_lane_score(shooter_pos, Vec3(receiver_xy[0], receiver_xy[1], 0.0), opponent_positions)
        pressure_score = _nearest_pressure_score(Vec3(receiver_xy[0], receiver_xy[1], 0.0), opponent_positions)
        option_value, receiver_pc = pass_option_value(
            receiver_xy=receiver_xy,
            shooter_xy=shooter_xy,
            attacking=attacking,
            defending=defending,
            ball_xy=ball_xy,
            target_goal_x=target_goal_x,
            lane_score=lane_score,
            pass_distance_m=pass_distance,
        )
        option = {
            "best_pass_option_player_id": person_id,
            "best_pass_option_value": option_value,
            "best_pass_option_distance_m": pass_distance,
            "best_pass_option_lane_score": lane_score,
            "best_pass_option_pressure_score": pressure_score,
            "best_pass_pitch_control": receiver_pc,
        }
        if best is None or option_value > float(best["best_pass_option_value"]):
            best = option

    if best is None:
        return {
            "shot_value": shot_value,
            "shot_pitch_control": shot_pc,
            "better_pass_available": False,
            "pass_value_margin": 0.0,
        }
    margin = float(best["best_pass_option_value"]) - float(shot_value)
    return {
        "shot_value": shot_value,
        "shot_pitch_control": shot_pc,
        **best,
        "pass_value_margin": margin,
        "better_pass_available": margin > 0.04,
    }


def _estimate_velocity(
    current: Vec3,
    previous: Vec3 | None,
    *,
    hz: float = 50.0,
) -> tuple[float, float, float]:
    if previous is None:
        return 0.0, 0.0, 0.0
    dt = 1.0 / hz
    vx = (current.x - previous.x) / dt
    vy = (current.y - previous.y) / dt
    return vx, vy, math.hypot(vx, vy)


def _ball_xy(shot: ShotEvent, frames: list[SkeletonFrame], fallback: tuple[float, float]) -> tuple[float, float]:
    if frames:
        frame = min(frames, key=lambda candidate: abs(candidate.frame_number - shot.skeleton_frame))
        if frame.ball is not None:
            return (frame.ball.x, frame.ball.y)
    if shot.x is not None and shot.y is not None:
        return (float(shot.x), float(shot.y))
    return fallback


def _player_position(frame: SkeletonFrame, key: tuple[int, int]) -> Vec3 | None:
    parts = frame.players.get(key)
    return _body_position(parts) if parts is not None else None


def _body_position(parts: dict[str, Vec3]) -> Vec3 | None:
    return parts.get("pelvis") or parts.get("neck") or parts.get("nose")


def _target_goal_x(shot: ShotEvent, shooter_pos: Vec3) -> float:
    reference_x = _safe_float(shot.x)
    if reference_x is None:
        reference_x = shooter_pos.x
    return 52.5 if reference_x >= 0 else -52.5


def _field_shot_option_value(pos: Vec3, opponents: list[Vec3], target_goal_x: float) -> float:
    distance = abs(target_goal_x - pos.x)
    angle = math.degrees(2.0 * math.atan2(3.66, max(distance, 1.0)))
    centrality = max(0.0, 1.0 - abs(pos.y) / 34.0)
    return max(
        0.0,
        min(
            1.0,
            0.42 * _linear_low(distance, 6.0, 32.0)
            + 0.28 * _linear_high(angle, 8.0, 42.0)
            + 0.20 * _nearest_pressure_score(pos, opponents)
            + 0.10 * centrality,
        ),
    )


def _pass_lane_score(start: Vec3, end: Vec3, opponents: list[Vec3]) -> float:
    blockers = 0
    for opponent in opponents:
        projection = _segment_projection_fraction(start, end, opponent)
        if projection <= 0.0 or projection >= 1.0:
            continue
        if _point_segment_distance(start, end, opponent) < 1.75:
            blockers += 1
    return _linear_low(float(blockers), 0.0, 3.0)


def _nearest_pressure_score(pos: Vec3, opponents: list[Vec3]) -> float:
    if not opponents:
        return 0.5
    nearest = min(_xy_distance(pos, opponent) for opponent in opponents)
    return _linear_high(nearest, 1.0, 5.0)


def soft_pass_distance_score(distance: float) -> float:
    if distance < 3.0 or distance > 25.0:
        return 0.0
    if 6.0 <= distance <= 16.0:
        return 1.0
    if distance < 6.0:
        return _linear_high(distance, 3.0, 6.0)
    return _linear_low(distance, 16.0, 25.0)


def _segment_projection_fraction(start: Vec3, end: Vec3, point: Vec3) -> float:
    dx = end.x - start.x
    dy = end.y - start.y
    denom = dx * dx + dy * dy
    if denom <= 1e-9:
        return 0.0
    return ((point.x - start.x) * dx + (point.y - start.y) * dy) / denom


def _point_segment_distance(start: Vec3, end: Vec3, point: Vec3) -> float:
    t = max(0.0, min(1.0, _segment_projection_fraction(start, end, point)))
    closest = Vec3(start.x + t * (end.x - start.x), start.y + t * (end.y - start.y), 0.0)
    return _xy_distance(closest, point)


def _xy_distance(a: Vec3, b: Vec3) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def _linear_low(value: float, best: float, worst: float) -> float:
    if worst == best:
        return 0.0
    return max(0.0, min(1.0, 1.0 - (value - best) / (worst - best)))


def _linear_high(value: float, worst: float, best: float) -> float:
    if best == worst:
        return 0.0
    return max(0.0, min(1.0, (value - worst) / (best - worst)))


def _optional_int(value: Any) -> int | None:
    try:
        if value in (None, ""):
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _optional_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_float(value: Any) -> float | None:
    try:
        if value is None or math.isnan(float(value)):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None
