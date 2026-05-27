from __future__ import annotations

import csv
import json
import math
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse
import xml.etree.ElementTree as ET


S3_MATCH_DATA_ROOT = (
    "s3://hackathon-data-652386518002/"
    "Challenge 2 \u2013 Unlock the Power of 3D Football Data/Match_Data"
)

PART_NAME_BY_ID = {
    1: "left_ear",
    2: "nose",
    3: "right_ear",
    4: "left_shoulder",
    5: "neck",
    6: "right_shoulder",
    7: "left_elbow",
    8: "right_elbow",
    9: "left_wrist",
    10: "right_wrist",
    11: "left_hip",
    12: "pelvis",
    13: "right_hip",
    14: "left_knee",
    15: "right_knee",
    16: "left_ankle",
    17: "right_ankle",
    18: "left_heel",
    19: "left_toe",
    20: "right_heel",
    21: "right_toe",
}

FOOT_PARTS = {
    "left_ankle",
    "left_heel",
    "left_toe",
    "right_ankle",
    "right_heel",
    "right_toe",
}

METRIC_PARTS = set(PART_NAME_BY_ID.values())
PAPER_TOUCH_THRESHOLD_M = 0.15
PAPER_TOUCH_SEPARATION_S = 0.25
PAPER_PRESSURE_ALPHA = 0.1


@dataclass(frozen=True)
class Vec3:
    x: float
    y: float
    z: float

    def xy(self) -> tuple[float, float]:
        return (self.x, self.y)


@dataclass(frozen=True)
class TeamInfo:
    team_id: str
    name: str
    role: str
    parquet_team: int


@dataclass(frozen=True)
class PlayerInfo:
    person_id: str
    team_id: str
    team_name: str
    team_role: str
    parquet_team: int
    shirt_number: int
    short_name: str
    playing_position: str | None
    is_goalkeeper: bool

    @property
    def parquet_key(self) -> tuple[int, int]:
        return (self.parquet_team, self.shirt_number)


@dataclass
class MatchContext:
    match_folder: str
    frame_rate: int
    phase_start_by_section: dict[str, int]
    phase_home_gk_left: dict[str, bool | None]
    pitch_length_m: float
    pitch_width_m: float
    players_by_id: dict[str, PlayerInfo] = field(default_factory=dict)
    teams_by_id: dict[str, TeamInfo] = field(default_factory=dict)


@dataclass(frozen=True)
class CarryEvent:
    event_id: str
    team_id: str
    player_id: str
    start_x: float
    start_y: float
    end_x: float
    end_y: float
    distance_m: float
    start_frame: int
    end_frame: int
    section: str

    @property
    def duration_frames_25hz(self) -> int:
        return self.end_frame - self.start_frame

    @property
    def duration_seconds(self) -> float:
        return self.duration_frames_25hz / 25.0


@dataclass(frozen=True)
class TackleEvent:
    event_id: str
    winner_team_id: str
    winner_player_id: str
    loser_team_id: str
    loser_player_id: str
    tackle_type: str | None
    frame: int
    section: str

    def involves(self, player_id: str) -> bool:
        return player_id in {self.winner_player_id, self.loser_player_id}

    def opponent_of(self, player_id: str) -> str | None:
        if player_id == self.winner_player_id:
            return self.loser_player_id
        if player_id == self.loser_player_id:
            return self.winner_player_id
        return None


@dataclass(frozen=True)
class ReceptionEvent:
    event_id: str
    team_id: str
    player_id: str
    frame: int
    section: str | None
    is_interception: bool


@dataclass(frozen=True)
class DribbleLabel:
    event_id: str
    evaluation: str
    dribbling_side: str | None
    dribbling_type: str | None
    winner_role: str | None
    loser_role: str | None
    winner_result: str | None
    loser_result: str | None
    possession_change: str | None

    @property
    def attacker_role_hint(self) -> str | None:
        if _same_token(self.winner_role, "withBallControl"):
            return "winner"
        if _same_token(self.loser_role, "withBallControl"):
            return "loser"
        if _same_token(self.evaluation, "successful"):
            return "winner"
        if _same_token(self.evaluation, "unsuccessful"):
            return "loser"
        return None


@dataclass(frozen=True)
class KpiEvents:
    carries: list[CarryEvent]
    tackles: list[TackleEvent]
    receptions: list[ReceptionEvent]


@dataclass(frozen=True)
class DribbleCandidate:
    event_id: str
    source: str
    outcome: str
    match_folder: str
    attacker_player_id: str
    defender_player_id: str
    attacker_name: str
    defender_name: str
    attacker_team_id: str
    defender_team_id: str
    attacker_parquet_key: tuple[int, int]
    defender_parquet_key: tuple[int, int]
    section: str
    start_kpi_frame: int
    end_kpi_frame: int
    start_skeleton_frame: int
    end_skeleton_frame: int
    start_xy: tuple[float, float]
    end_xy: tuple[float, float]
    distance_m: float
    dribbling_side: str | None
    window_type: str


@dataclass(frozen=True)
class SkeletonFrame:
    frame_number: int
    ball: Vec3 | None
    ball_velocity: Vec3 | None
    players: dict[tuple[int, int], dict[str, Vec3]]


def load_match_context(metadata_path: Path | str, match_folder: str) -> MatchContext:
    data = json.loads(Path(metadata_path).read_text())
    return MatchContext(
        match_folder=match_folder,
        frame_rate=int(data["FrameRate"]),
        phase_start_by_section={
            "firstHalf": int(data["Phase1StartFrame"]),
            "secondHalf": int(data["Phase2StartFrame"]),
        },
        phase_home_gk_left={
            "firstHalf": data.get("Phase1HomeGKLeft"),
            "secondHalf": data.get("Phase2HomeGKLeft"),
        },
        pitch_length_m=float(data.get("PitchLongSide", 10500)) / 100.0,
        pitch_width_m=float(data.get("PitchShortSide", 6800)) / 100.0,
    )


def kpi_to_skeleton_frame(context: MatchContext, synced_frame_id: int, section: str) -> int:
    normalized = _normalize_section(section)
    if normalized == "firstHalf":
        return context.phase_start_by_section["firstHalf"] + 2 * (int(synced_frame_id) - 10_000)
    if normalized == "secondHalf":
        return context.phase_start_by_section["secondHalf"] + 2 * (int(synced_frame_id) - 100_000)
    raise ValueError(f"Unsupported game section: {section!r}")


def parse_match_information_xml(xml_text: str) -> tuple[dict[str, PlayerInfo], dict[str, TeamInfo]]:
    root = ET.fromstring(xml_text)
    teams: dict[str, TeamInfo] = {}
    players: dict[str, PlayerInfo] = {}
    for team_el in root.iter("Team"):
        team_id = _required(team_el, "TeamId")
        role = team_el.get("Role", "").strip()
        parquet_team = _parquet_team_for_role(role)
        team = TeamInfo(
            team_id=team_id,
            name=team_el.get("TeamName") or team_el.get("ShortName") or team_id,
            role=role,
            parquet_team=parquet_team,
        )
        teams[team_id] = team
        for player_el in team_el.iter("Player"):
            person_id = _required(player_el, "PersonId")
            position = player_el.get("PlayingPosition")
            players[person_id] = PlayerInfo(
                person_id=person_id,
                team_id=team_id,
                team_name=team.name,
                team_role=role,
                parquet_team=parquet_team,
                shirt_number=int(player_el.get("ShirtNumber", "-1")),
                short_name=player_el.get("Shortname") or person_id,
                playing_position=position,
                is_goalkeeper=_is_goalkeeper_position(position),
            )
    return players, teams


def parse_kpi_xml(xml_text: str) -> KpiEvents:
    root = ET.fromstring(xml_text)
    carries: list[CarryEvent] = []
    tackles: list[TackleEvent] = []
    receptions: list[ReceptionEvent] = []
    for el in root.iter():
        if el.tag == "Carry" and _is_true(el.get("SyncSuccessful")):
            start_frame = _optional_int(el.get("SyncedFrameId"))
            end_frame = _optional_int(el.get("EndSyncedFrameId"))
            if start_frame is None or end_frame is None:
                continue
            carries.append(
                CarryEvent(
                    event_id=_required(el, "EventId"),
                    team_id=_required(el, "TeamId"),
                    player_id=_required(el, "PlayerId"),
                    start_x=_float_attr(el, "X-Position"),
                    start_y=_float_attr(el, "Y-Position"),
                    end_x=_float_attr(el, "X-EndPosition"),
                    end_y=_float_attr(el, "Y-EndPosition"),
                    distance_m=_float_attr(el, "Distance"),
                    start_frame=start_frame,
                    end_frame=end_frame,
                    section=_normalize_section(el.get("InGameSection") or el.get("GameSection") or "firstHalf"),
                )
            )
        elif el.tag == "TacklingGame" and _is_true(el.get("SyncSuccessful")):
            frame = _optional_int(el.get("SyncedFrameId"))
            if frame is None:
                continue
            tackles.append(
                TackleEvent(
                    event_id=_required(el, "EventId"),
                    winner_team_id=_required(el, "WinnerTeamId"),
                    winner_player_id=_required(el, "WinnerPlayerId"),
                    loser_team_id=_required(el, "LoserTeamId"),
                    loser_player_id=_required(el, "LoserPlayerId"),
                    tackle_type=el.get("Type"),
                    frame=frame,
                    section=_normalize_section(el.get("InGameSection") or el.get("GameSection") or "firstHalf"),
                )
            )
        elif el.tag == "Reception" and _is_true(el.get("SyncSuccessful")):
            frame = _optional_int(el.get("SyncedFrameId"))
            if frame is None:
                continue
            receptions.append(
                ReceptionEvent(
                    event_id=_required(el, "EventId"),
                    team_id=_required(el, "TeamId"),
                    player_id=_required(el, "PlayerId"),
                    frame=frame,
                    section=_normalize_section(el.get("InGameSection")) if el.get("InGameSection") else None,
                    is_interception=_is_true(el.get("IsInterception")),
                )
            )
    return KpiEvents(carries=carries, tackles=tackles, receptions=receptions)


def parse_raw_dribble_labels_xml(xml_text: str) -> dict[str, DribbleLabel]:
    root = ET.fromstring(xml_text)
    labels: dict[str, DribbleLabel] = {}
    for event_el in root.iter("Event"):
        event_id = event_el.get("EventId")
        if not event_id:
            continue
        for tackle_el in event_el:
            if tackle_el.tag != "TacklingGame" or not tackle_el.get("DribbleEvaluation"):
                continue
            labels[event_id] = DribbleLabel(
                event_id=event_id,
                evaluation=tackle_el.get("DribbleEvaluation", ""),
                dribbling_side=tackle_el.get("DribblingSide"),
                dribbling_type=tackle_el.get("DribblingType"),
                winner_role=tackle_el.get("WinnerRole"),
                loser_role=tackle_el.get("LoserRole"),
                winner_result=tackle_el.get("WinnerResult"),
                loser_result=tackle_el.get("LoserResult"),
                possession_change=tackle_el.get("PossessionChange"),
            )
    return labels


def build_dribble_candidates(
    context: MatchContext,
    players_by_id: dict[str, PlayerInfo],
    carries: list[CarryEvent],
    tackles: list[TackleEvent],
    dribble_labels: dict[str, DribbleLabel],
    *,
    max_candidates: int = 50,
    tackle_tolerance_frames: int = 2,
    min_duration_s: float = 2.0,
    max_duration_s: float = 10.0,
    min_distance_m: float = 2.0,
    max_distance_m: float = 50.0,
    require_forward_progress: bool = False,
) -> list[DribbleCandidate]:
    candidates: list[DribbleCandidate] = []
    tackles_by_id = {t.event_id: t for t in tackles}
    exact_tackle_ids: set[str] = set()

    for event_id, label in dribble_labels.items():
        tackle = tackles_by_id.get(event_id)
        if tackle is None:
            continue
        attacker_id, defender_id = _attacker_defender_from_label(tackle, label)
        carry = _nearest_carry_for_tackle(carries, attacker_id, tackle, tolerance_frames=8)
        candidate = _make_candidate(
            context,
            players_by_id,
            event_id=event_id,
            source="exact_tackle_dribble",
            outcome=label.evaluation,
            attacker_id=attacker_id,
            defender_id=defender_id,
            section=tackle.section,
            carry=carry,
            tackle=tackle,
            dribbling_side=label.dribbling_side,
        )
        if candidate is not None:
            candidates.append(candidate)
            exact_tackle_ids.add(event_id)
        if len(candidates) >= max_candidates:
            return candidates

    for carry in carries:
        if len(candidates) >= max_candidates:
            break
        attacker = players_by_id.get(carry.player_id)
        if attacker is None or attacker.is_goalkeeper:
            continue
        if not (min_duration_s <= carry.duration_seconds <= max_duration_s):
            continue
        if not (min_distance_m <= carry.distance_m <= max_distance_m):
            continue
        if require_forward_progress and not _is_forward_progress(context, attacker, carry):
            continue
        tackle = _nearest_tackle_for_carry(tackles, carry, tolerance_frames=tackle_tolerance_frames)
        if tackle is None or tackle.event_id in exact_tackle_ids:
            continue
        defender_id = tackle.opponent_of(carry.player_id)
        if defender_id is None:
            continue
        if carry.player_id == tackle.winner_player_id:
            outcome = "attacker_won_tackle"
        elif carry.player_id == tackle.loser_player_id:
            outcome = "attacker_lost_tackle"
        else:
            outcome = "attacker_near_tackle"
        candidate = _make_candidate(
            context,
            players_by_id,
            event_id=carry.event_id,
            source="weak_carry_to_tackle",
            outcome=outcome,
            attacker_id=carry.player_id,
            defender_id=defender_id,
            section=carry.section,
            carry=carry,
            tackle=tackle,
            dribbling_side=None,
        )
        if candidate is not None:
            candidates.append(candidate)
    return candidates


def flatten_skeleton_row(
    row: dict[str, Any],
    *,
    selected_players: set[tuple[int, int]] | None = None,
    selected_parts: set[str] | None = None,
) -> SkeletonFrame:
    ball_obj = row.get("ball") or {}
    ball = _vec_from_mapping(ball_obj, "position_x", "position_y", "position_z")
    ball_velocity = _vec_from_mapping(ball_obj, "velocity_x", "velocity_y", "velocity_z")
    players: dict[tuple[int, int], dict[str, Vec3]] = {}
    skeletons = row.get("skeletons") or []
    for skeleton in skeletons:
        team = _optional_int(_mapping_get(skeleton, "team"))
        jersey = _optional_int(_mapping_get(skeleton, "jersey_number"))
        if team is None or jersey is None:
            continue
        key = (team, jersey)
        if selected_players is not None and key not in selected_players:
            continue
        parts: dict[str, Vec3] = {}
        for part in _mapping_get(skeleton, "parts") or []:
            part_name = normalize_part_name(_mapping_get(part, "name"))
            if part_name is None:
                continue
            if selected_parts is not None and part_name not in selected_parts:
                continue
            point = _vec_from_mapping(part, "position_x", "position_y", "position_z")
            if point is not None:
                parts[part_name] = point
        if parts:
            players[key] = parts
    return SkeletonFrame(
        frame_number=int(row["frame_number"]),
        ball=ball,
        ball_velocity=ball_velocity,
        players=players,
    )


def read_s3_skeleton_window(
    s3_uri: str,
    start_frame: int,
    end_frame: int,
    *,
    profile: str = "hackathon",
    selected_players: set[tuple[int, int]] | None = None,
    selected_parts: set[str] | None = None,
    max_window_frames: int = 250,
    max_row_groups: int = 3,
    max_rows: int = 5000,
) -> list[SkeletonFrame]:
    try:
        import pyarrow.parquet as pq
    except ImportError as exc:
        raise RuntimeError("S3 parquet extraction requires pyarrow") from exc

    path = _s3fs_path(s3_uri)
    filesystem = _s3_filesystem(profile)
    parquet_file = pq.ParquetFile(path, filesystem=filesystem)
    frame_column_index = _frame_number_column_index(parquet_file.metadata)
    row_groups: list[int] = []
    for index in range(parquet_file.metadata.num_row_groups):
        stats = parquet_file.metadata.row_group(index).column(frame_column_index).statistics
        if stats is None:
            row_groups.append(index)
            continue
        if int(stats.max) >= start_frame and int(stats.min) <= end_frame:
            row_groups.append(index)
    if not row_groups:
        return []
    row_count = sum(parquet_file.metadata.row_group(index).num_rows for index in row_groups)
    validate_s3_window_request(
        start_frame,
        end_frame,
        row_group_count=len(row_groups),
        row_count=row_count,
        max_window_frames=max_window_frames,
        max_row_groups=max_row_groups,
        max_rows=max_rows,
    )
    table = parquet_file.read_row_groups(row_groups, columns=["frame_number", "ball", "skeletons"], use_threads=False)
    frames = [
        flatten_skeleton_row(row, selected_players=selected_players, selected_parts=selected_parts)
        for row in table.to_pylist()
        if start_frame <= int(row["frame_number"]) <= end_frame
    ]
    return _maybe_convert_centimeters(sorted(frames, key=lambda frame: frame.frame_number))


def compute_dribble_metrics(
    candidate: DribbleCandidate,
    frames: list[SkeletonFrame],
    *,
    touch_threshold_m: float = 0.35,
    frame_rate: int = 50,
) -> dict[str, Any]:
    frames = sorted(frames, key=lambda frame: frame.frame_number)
    attacker_key = candidate.attacker_parquet_key
    defender_key = candidate.defender_parquet_key
    duration_seconds = _window_duration_seconds(frames, frame_rate)

    ball_foot_distances: list[float] = []
    nearest_foot_sides: list[str | None] = []
    torso_leans: list[float] = []
    pelvis_heights: list[float] = []
    imbalances: list[float] = []
    stance_widths: list[float] = []
    left_knee_angles: list[float] = []
    right_knee_angles: list[float] = []
    gaze_ball_alignments: list[float] = []
    gaze_path_alignments: list[float] = []
    gaze_defender_alignments: list[float] = []
    gaze_angles: list[float] = []
    wrist_distances: list[float] = []
    arm_spread_ratios: list[float] = []
    arms_close_flags: list[float] = []
    left_elbow_angles: list[float] = []
    right_elbow_angles: list[float] = []
    hand_height_asymmetries: list[float] = []
    arm_path_alignments: list[float] = []
    attacker_defender_distances: list[float] = []
    nearest_opponent_distances: list[float] = []
    nearest_teammate_distances: list[float] = []
    opponents_within_2m: list[float] = []
    opponents_within_3m: list[float] = []
    opponents_within_5m: list[float] = []
    ball_shielding_flags: list[float] = []
    shoulder_hip_separations: list[float] = []
    hip_axis_to_defender: list[float] = []
    shoulder_axis_to_defender: list[float] = []
    defender_support_left_flags: list[float] = []
    attacker_defender_hip_axis_angles: list[float] = []

    path_vector = _normalize2((candidate.end_xy[0] - candidate.start_xy[0], candidate.end_xy[1] - candidate.start_xy[1]))
    if path_vector is None:
        path_vector = _path_from_frames(frames, attacker_key)

    for frame in frames:
        attacker = frame.players.get(attacker_key)
        defender = frame.players.get(defender_key)
        if not attacker:
            continue

        foot_distance, foot_side = _nearest_ball_foot_distance(frame.ball, attacker)
        if foot_distance is not None:
            ball_foot_distances.append(foot_distance)
            nearest_foot_sides.append(foot_side)

        pelvis = attacker.get("pelvis")
        neck = attacker.get("neck")
        if pelvis is not None:
            pelvis_heights.append(pelvis.z)
        if pelvis is not None and neck is not None:
            torso_leans.append(_angle_from_vertical(neck, pelvis))

        left_heel = attacker.get("left_heel")
        right_heel = attacker.get("right_heel")
        if pelvis is not None and left_heel is not None and right_heel is not None:
            foot_mid = Vec3((left_heel.x + right_heel.x) / 2.0, (left_heel.y + right_heel.y) / 2.0, 0.0)
            imbalances.append(_distance_xy(pelvis, foot_mid))
            stance_widths.append(_distance_xy(left_heel, right_heel))

        _append_joint_angle(left_knee_angles, attacker, "left_hip", "left_knee", "left_ankle")
        _append_joint_angle(right_knee_angles, attacker, "right_hip", "right_knee", "right_ankle")

        gaze = _head_direction(attacker)
        if gaze is not None:
            gaze_angles.append(math.atan2(gaze[1], gaze[0]))
            if path_vector is not None:
                gaze_path_alignments.append(_dot2(gaze, path_vector))
            head_anchor = attacker.get("nose") or attacker.get("neck") or pelvis
            if head_anchor is not None and frame.ball is not None:
                to_ball = _normalize2((frame.ball.x - head_anchor.x, frame.ball.y - head_anchor.y))
                if to_ball is not None:
                    gaze_ball_alignments.append(_dot2(gaze, to_ball))
            if defender and head_anchor is not None and defender.get("pelvis") is not None:
                defender_pelvis = defender["pelvis"]
                to_defender = _normalize2((defender_pelvis.x - head_anchor.x, defender_pelvis.y - head_anchor.y))
                if to_defender is not None:
                    gaze_defender_alignments.append(_dot2(gaze, to_defender))

        _append_arm_metrics(
            attacker,
            path_vector,
            wrist_distances,
            arm_spread_ratios,
            arms_close_flags,
            left_elbow_angles,
            right_elbow_angles,
            hand_height_asymmetries,
            arm_path_alignments,
        )

        if defender:
            _append_duel_metrics(
                frame,
                attacker_key,
                defender_key,
                attacker,
                defender,
                attacker_defender_distances,
                ball_shielding_flags,
                shoulder_hip_separations,
                hip_axis_to_defender,
                shoulder_axis_to_defender,
                defender_support_left_flags,
                attacker_defender_hip_axis_angles,
            )

        _append_spacing_metrics(
            frame,
            attacker_key,
            attacker,
            nearest_opponent_distances,
            nearest_teammate_distances,
            opponents_within_2m,
            opponents_within_3m,
            opponents_within_5m,
        )

    touch_separation = max(1, round(0.24 * frame_rate))
    if ball_foot_distances:
        touch_separation = min(touch_separation, max(1, len(ball_foot_distances) // 3))
    touch_indices = _touch_indices(ball_foot_distances, touch_threshold_m, min_separation_frames=touch_separation)
    left_touch_count = sum(1 for index in touch_indices if nearest_foot_sides[index] == "left")
    right_touch_count = sum(1 for index in touch_indices if nearest_foot_sides[index] == "right")
    total_touch_count = len(touch_indices)

    attacker_speeds = _player_speeds(frames, attacker_key, frame_rate)
    defender_speeds = _player_speeds(frames, defender_key, frame_rate)
    attacker_accels = _speed_deltas(attacker_speeds, frame_rate)
    defender_closing_speeds = _closing_speeds(attacker_defender_distances, frame_rate)
    direction_changes = _direction_change_count(frames, attacker_key)
    relative_speeds = [a - d for a, d in zip(attacker_speeds, defender_speeds)]
    paper_metrics = _paper_dribble_metrics(candidate, frames, frame_rate=frame_rate)

    metrics: dict[str, Any] = {
        "event_id": candidate.event_id,
        "source": candidate.source,
        "outcome": candidate.outcome,
        "match_folder": candidate.match_folder,
        "window_type": candidate.window_type,
        "dribbling_side": candidate.dribbling_side,
        "attacker_name": candidate.attacker_name,
        "defender_name": candidate.defender_name,
        "attacker_player_id": candidate.attacker_player_id,
        "defender_player_id": candidate.defender_player_id,
        "start_skeleton_frame": candidate.start_skeleton_frame,
        "end_skeleton_frame": candidate.end_skeleton_frame,
        "sampled_frame_count": len(frames),
        "duration_seconds": duration_seconds,
        "ball_foot_distance_min": _safe_min(ball_foot_distances),
        "ball_foot_distance_mean": _mean(ball_foot_distances),
        "ball_foot_distance_p90": _percentile(ball_foot_distances, 90),
        "ball_foot_distance_std": _std(ball_foot_distances),
        "touch_count": total_touch_count,
        "touch_frequency_per_s": total_touch_count / duration_seconds if duration_seconds > 0 else _nan(),
        "left_touch_count": left_touch_count,
        "right_touch_count": right_touch_count,
        "touch_asymmetry": abs(left_touch_count - right_touch_count) / max(1, total_touch_count),
        "ball_control_volatility": _std(ball_foot_distances),
        "torso_lean_mean_deg": _mean(torso_leans),
        "torso_lean_p90_deg": _percentile(torso_leans, 90),
        "torso_lean_max_deg": _safe_max(torso_leans),
        "pelvis_height_mean": _mean(pelvis_heights),
        "pelvis_height_min": _safe_min(pelvis_heights),
        "imbalance_mean": _mean(imbalances),
        "imbalance_p90": _percentile(imbalances, 90),
        "stance_width_mean": _mean(stance_widths),
        "stance_width_p90": _percentile(stance_widths, 90),
        "left_knee_flexion_mean_deg": _mean(left_knee_angles),
        "right_knee_flexion_mean_deg": _mean(right_knee_angles),
        "gaze_to_ball_alignment_mean": _mean(gaze_ball_alignments),
        "gaze_to_path_alignment_mean": _mean(gaze_path_alignments),
        "gaze_to_defender_alignment_mean": _mean(gaze_defender_alignments),
        "head_yaw_variability_deg": _angle_variability_deg(gaze_angles),
        "scan_proxy_count": _scan_proxy_count(gaze_angles),
        "wrist_distance_mean": _mean(wrist_distances),
        "wrist_distance_p90": _percentile(wrist_distances, 90),
        "arms_close_fraction": _mean(arms_close_flags),
        "arm_spread_ratio_mean": _mean(arm_spread_ratios),
        "left_elbow_angle_mean_deg": _mean(left_elbow_angles),
        "right_elbow_angle_mean_deg": _mean(right_elbow_angles),
        "hand_height_asymmetry_mean": _mean(hand_height_asymmetries),
        "arm_to_path_alignment_mean": _mean(arm_path_alignments),
        "ball_shielding_fraction": _mean(ball_shielding_flags),
        "attacker_defender_distance_start": attacker_defender_distances[0] if attacker_defender_distances else _nan(),
        "attacker_defender_distance_end": attacker_defender_distances[-1] if attacker_defender_distances else _nan(),
        "attacker_defender_distance_min": _safe_min(attacker_defender_distances),
        "attacker_defender_distance_mean": _mean(attacker_defender_distances),
        "separation_gain": (attacker_defender_distances[-1] - attacker_defender_distances[0]) if len(attacker_defender_distances) >= 2 else _nan(),
        "nearest_opponent_distance_mean": _mean(nearest_opponent_distances),
        "nearest_opponent_distance_min": _safe_min(nearest_opponent_distances),
        "opponents_within_2m_mean": _mean(opponents_within_2m),
        "opponents_within_3m_mean": _mean(opponents_within_3m),
        "opponents_within_5m_mean": _mean(opponents_within_5m),
        "nearest_teammate_distance_mean": _mean(nearest_teammate_distances),
        "defender_closing_speed_mean": _mean(defender_closing_speeds),
        "defender_closing_speed_max": _safe_max(defender_closing_speeds),
        "attacker_speed_mean": _mean(attacker_speeds),
        "attacker_speed_max": _safe_max(attacker_speeds),
        "defender_speed_mean": _mean(defender_speeds),
        "defender_speed_max": _safe_max(defender_speeds),
        "relative_speed_advantage_mean": _mean(relative_speeds),
        "relative_speed_advantage_max": _safe_max(relative_speeds),
        "attacker_acceleration_max": _safe_max(attacker_accels),
        "direction_change_count": direction_changes,
        "shoulder_hip_separation_mean_deg": _mean(shoulder_hip_separations),
        "shoulder_hip_separation_p90_deg": _percentile(shoulder_hip_separations, 90),
        "hip_axis_to_defender_mean_deg": _mean(hip_axis_to_defender),
        "shoulder_axis_to_defender_mean_deg": _mean(shoulder_axis_to_defender),
        "defender_support_leg_left_fraction": _mean(defender_support_left_flags),
        "attacker_passed_opposite_support_leg": _opposite_support_leg(candidate, defender_support_left_flags),
        "attacker_defender_hip_axis_angle_mean_deg": _mean(attacker_defender_hip_axis_angles),
    }
    metrics.update(paper_metrics)
    metrics.update(_technique_profile(metrics))
    return metrics


def candidate_to_row(candidate: DribbleCandidate) -> dict[str, Any]:
    return {
        "event_id": candidate.event_id,
        "source": candidate.source,
        "outcome": candidate.outcome,
        "match_folder": candidate.match_folder,
        "attacker_player_id": candidate.attacker_player_id,
        "attacker_name": candidate.attacker_name,
        "attacker_team_id": candidate.attacker_team_id,
        "attacker_parquet_team": candidate.attacker_parquet_key[0],
        "attacker_jersey": candidate.attacker_parquet_key[1],
        "defender_player_id": candidate.defender_player_id,
        "defender_name": candidate.defender_name,
        "defender_team_id": candidate.defender_team_id,
        "defender_parquet_team": candidate.defender_parquet_key[0],
        "defender_jersey": candidate.defender_parquet_key[1],
        "section": candidate.section,
        "start_kpi_frame": candidate.start_kpi_frame,
        "end_kpi_frame": candidate.end_kpi_frame,
        "start_skeleton_frame": candidate.start_skeleton_frame,
        "end_skeleton_frame": candidate.end_skeleton_frame,
        "start_x": candidate.start_xy[0],
        "start_y": candidate.start_xy[1],
        "end_x": candidate.end_xy[0],
        "end_y": candidate.end_xy[1],
        "distance_m": candidate.distance_m,
        "dribbling_side": candidate.dribbling_side,
        "window_type": candidate.window_type,
    }


def write_csv(path: Path | str, rows: list[dict[str, Any]], preferred_fields: list[str] | None = None) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fields: list[str] = []
    if preferred_fields:
        fields.extend(preferred_fields)
    for row in rows:
        for key in row:
            if key not in fields:
                fields.append(key)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: _csv_value(row.get(field)) for field in fields})


def compact_window_rows(candidate: DribbleCandidate, frames: list[SkeletonFrame]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for frame in frames:
        attacker = frame.players.get(candidate.attacker_parquet_key, {})
        defender = frame.players.get(candidate.defender_parquet_key, {})
        ball_foot_distance, _ = _nearest_ball_foot_distance(frame.ball, attacker)
        rows.append(
            {
                "event_id": candidate.event_id,
                "frame_number": frame.frame_number,
                "ball_x": frame.ball.x if frame.ball else None,
                "ball_y": frame.ball.y if frame.ball else None,
                "ball_z": frame.ball.z if frame.ball else None,
                "attacker_pelvis_x": attacker.get("pelvis").x if attacker.get("pelvis") else None,
                "attacker_pelvis_y": attacker.get("pelvis").y if attacker.get("pelvis") else None,
                "defender_pelvis_x": defender.get("pelvis").x if defender.get("pelvis") else None,
                "defender_pelvis_y": defender.get("pelvis").y if defender.get("pelvis") else None,
                "ball_foot_distance": ball_foot_distance,
            }
        )
    return rows


def extract_dribble_touch_rows(
    candidate: DribbleCandidate,
    frames: list[SkeletonFrame],
    *,
    touch_threshold_m: float = PAPER_TOUCH_THRESHOLD_M,
    frame_rate: int = 50,
) -> list[dict[str, Any]]:
    frames = sorted(frames, key=lambda frame: frame.frame_number)
    samples = _ball_foot_samples(candidate, frames)
    distances = [sample["distance"] for sample in samples]
    touch_indices = _touch_indices(
        distances,
        touch_threshold_m,
        min_separation_frames=max(1, round(PAPER_TOUCH_SEPARATION_S * frame_rate)),
    )
    rows: list[dict[str, Any]] = []
    path_vector = _normalize2((candidate.end_xy[0] - candidate.start_xy[0], candidate.end_xy[1] - candidate.start_xy[1]))
    if path_vector is None:
        path_vector = _path_from_frames(frames, candidate.attacker_parquet_key)
    for touch_number, sample_index in enumerate(touch_indices, start=1):
        sample = samples[sample_index]
        frame = sample["frame"]
        attacker = frame.players.get(candidate.attacker_parquet_key, {})
        defender = frame.players.get(candidate.defender_parquet_key, {})
        pelvis = attacker.get("pelvis")
        defender_pelvis = defender.get("pelvis")
        relative = _body_relative_xy(attacker, frame.ball, path_vector)
        rows.append(
            {
                "event_id": candidate.event_id,
                "match_folder": candidate.match_folder,
                "source": candidate.source,
                "outcome": candidate.outcome,
                "window_type": candidate.window_type,
                "touch_index": touch_number,
                "frame_number": frame.frame_number,
                "time_s": (frame.frame_number - frames[0].frame_number) / frame_rate if frames else 0.0,
                "foot_side": sample["side"],
                "foot_part": sample["part"],
                "ball_foot_distance_m": sample["distance"],
                "ball_relative_forward_m": relative[0] if relative else _nan(),
                "ball_relative_lateral_m": relative[1] if relative else _nan(),
                "ball_speed_before_m_s": _neighbor_ball_speed(samples, sample_index - 1, sample_index, frame_rate),
                "ball_speed_after_m_s": _neighbor_ball_speed(samples, sample_index, sample_index + 1, frame_rate),
                "attacker_speed_before_m_s": _neighbor_player_speed(samples, sample_index - 1, sample_index, candidate.attacker_parquet_key, frame_rate),
                "attacker_speed_after_m_s": _neighbor_player_speed(samples, sample_index, sample_index + 1, candidate.attacker_parquet_key, frame_rate),
                "defender_distance_m": _distance_xy(pelvis, defender_pelvis) if pelvis is not None and defender_pelvis is not None else _nan(),
                "pressure_score": _frame_pressure_score(frame, candidate.attacker_parquet_key, attacker),
                "torso_lean_deg": _paper_torso_lean(attacker),
                "com_imbalance_m": _com_imbalance(attacker),
                "defender_weighted_leg": _weighted_leg(defender),
                "attacker_pass_side": _attacker_side_relative_to_defender(attacker, defender),
            }
        )
    return rows


def extract_dribble_phase_rows(
    candidate: DribbleCandidate,
    frames: list[SkeletonFrame],
    *,
    touch_threshold_m: float = PAPER_TOUCH_THRESHOLD_M,
    frame_rate: int = 50,
) -> list[dict[str, Any]]:
    frames = sorted(frames, key=lambda frame: frame.frame_number)
    if not frames:
        return [
            _empty_phase_row(candidate, "approach"),
            _empty_phase_row(candidate, "control"),
            _empty_phase_row(candidate, "exit"),
        ]
    touches = extract_dribble_touch_rows(candidate, frames, touch_threshold_m=touch_threshold_m, frame_rate=frame_rate)
    first_touch = touches[0]["frame_number"] if touches else frames[0].frame_number
    last_touch = touches[-1]["frame_number"] if touches else frames[-1].frame_number
    phase_windows = [
        ("approach", [frame for frame in frames if frame.frame_number <= first_touch]),
        ("control", [frame for frame in frames if first_touch <= frame.frame_number <= last_touch]),
        ("exit", [frame for frame in frames if frame.frame_number >= last_touch]),
    ]
    return [_phase_summary_row(candidate, phase, phase_frames, frame_rate=frame_rate) for phase, phase_frames in phase_windows]


def write_jsonl(path: Path | str, rows: Iterable[dict[str, Any]]) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=True, allow_nan=False, default=_json_default) + "\n")


def default_s3_uri(match_folder: str) -> str:
    parquet_by_match = {
        "Bayern_Hamburg": "FCB-HSV.parquet",
        "Dortmund_Stuttgart": "BVB-VFB.parquet",
        "Frankfurt_Bayern": "SGE-FCB.parquet",
        "Frankfurt_Union": "SGE-FCU.parquet",
        "Union_Bayern": "FCU-FCB.parquet",
    }
    parquet_name = parquet_by_match.get(match_folder)
    if parquet_name is None:
        raise ValueError(f"No default parquet name configured for {match_folder!r}")
    return f"{S3_MATCH_DATA_ROOT}/{match_folder}/{parquet_name}"


def all_player_parquet_keys(players_by_id: dict[str, PlayerInfo]) -> set[tuple[int, int]]:
    return {
        player.parquet_key
        for player in players_by_id.values()
        if player.parquet_team in {0, 1} and player.shirt_number >= 0
    }


def validate_s3_window_request(
    start_frame: int,
    end_frame: int,
    *,
    row_group_count: int,
    row_count: int,
    max_window_frames: int = 250,
    max_row_groups: int = 3,
    max_rows: int = 5000,
) -> None:
    if end_frame < start_frame:
        raise ValueError(f"Invalid S3 window: end frame {end_frame} is before start frame {start_frame}")
    window_frames = end_frame - start_frame + 1
    if window_frames > max_window_frames:
        raise ValueError(f"S3 window spans {window_frames} frames, above limit {max_window_frames}")
    if row_group_count > max_row_groups:
        raise ValueError(f"S3 window touches {row_group_count} row groups, above limit {max_row_groups}")
    if row_count > max_rows:
        raise ValueError(f"S3 window would read {row_count} rows, above limit {max_rows}")


def render_derived_readme(
    *,
    candidate_count: int,
    metric_count: int,
    s3_mode: str,
    touch_count: int | None = None,
    phase_count: int | None = None,
) -> str:
    touch_line = f"- `touches.csv`: {touch_count} paper-style ball-contact primitive rows.\n" if touch_count is not None else ""
    phase_line = f"- `phases.csv`: {phase_count} approach/control/exit phase summary rows.\n" if phase_count is not None else ""
    return f"""# Dribble Pose Bayern Hamburg Derived Dataset

This directory is generated by `scripts/build_dribble_pose_metrics.py`.

Detailed findings live in `FINDINGS.md`.

Inputs are local XML/JSON plus optional tiny row-group reads from the Bayern/Hamburg S3 parquet. No full parquet or positional XML file is downloaded.

Rows:

- `events.csv`: {candidate_count} dribble candidates from exact raw labels and KPI carry-to-tackle proxies.
- `metrics.csv`: {metric_count} sampled skeleton windows with derived pose metrics.
{touch_line}{phase_line}

S3 mode: {s3_mode}

Key caveats:

- KPI carries are weak dribble proxies, not exact TAKE_ON labels.
- Head/gaze uses nose and ears as a proxy, not eye tracking.
- Arm and hand features are exploratory posture proxies.
- Paper-aligned normalized ball-foot distance uses a local nearest-opponent pressure proxy because the paper's exact pressure model is not available in this feed.
- Exact raw `DribbleEvaluation` labels are kept separate from weak carry proxies via the `source` column.
- The script reads only candidate-aligned frame windows from S3 parquet.
"""


def _make_candidate(
    context: MatchContext,
    players_by_id: dict[str, PlayerInfo],
    *,
    event_id: str,
    source: str,
    outcome: str,
    attacker_id: str,
    defender_id: str,
    section: str,
    carry: CarryEvent | None,
    tackle: TackleEvent,
    dribbling_side: str | None,
) -> DribbleCandidate | None:
    attacker = players_by_id.get(attacker_id)
    defender = players_by_id.get(defender_id)
    if attacker is None or defender is None or attacker.is_goalkeeper:
        return None
    if carry is not None:
        start_kpi = carry.start_frame
        end_kpi = carry.end_frame
        start_xy = (carry.start_x, carry.start_y)
        end_xy = (carry.end_x, carry.end_y)
        distance = carry.distance_m
        window_type = "carry_window"
    else:
        start_kpi = max(0, tackle.frame - 50)
        end_kpi = tackle.frame
        start_xy = (0.0, 0.0)
        end_xy = (0.0, 0.0)
        distance = 0.0
        window_type = "fallback_pretackle_window"
    start_skeleton = kpi_to_skeleton_frame(context, start_kpi, section)
    end_skeleton = kpi_to_skeleton_frame(context, end_kpi, section)
    if end_skeleton < start_skeleton:
        start_skeleton, end_skeleton = end_skeleton, start_skeleton
    return DribbleCandidate(
        event_id=event_id,
        source=source,
        outcome=outcome,
        match_folder=context.match_folder,
        attacker_player_id=attacker_id,
        defender_player_id=defender_id,
        attacker_name=attacker.short_name,
        defender_name=defender.short_name,
        attacker_team_id=attacker.team_id,
        defender_team_id=defender.team_id,
        attacker_parquet_key=attacker.parquet_key,
        defender_parquet_key=defender.parquet_key,
        section=_normalize_section(section),
        start_kpi_frame=start_kpi,
        end_kpi_frame=end_kpi,
        start_skeleton_frame=start_skeleton,
        end_skeleton_frame=end_skeleton,
        start_xy=start_xy,
        end_xy=end_xy,
        distance_m=distance,
        dribbling_side=dribbling_side,
        window_type=window_type,
    )


def _attacker_defender_from_label(tackle: TackleEvent, label: DribbleLabel) -> tuple[str, str]:
    if label.attacker_role_hint == "winner":
        return tackle.winner_player_id, tackle.loser_player_id
    if label.attacker_role_hint == "loser":
        return tackle.loser_player_id, tackle.winner_player_id
    return tackle.winner_player_id, tackle.loser_player_id


def _nearest_carry_for_tackle(
    carries: list[CarryEvent], player_id: str, tackle: TackleEvent, *, tolerance_frames: int
) -> CarryEvent | None:
    candidates = [
        carry
        for carry in carries
        if carry.player_id == player_id
        and carry.section == tackle.section
        and abs(carry.end_frame - tackle.frame) <= tolerance_frames
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda carry: abs(carry.end_frame - tackle.frame))


def _nearest_tackle_for_carry(tackles: list[TackleEvent], carry: CarryEvent, *, tolerance_frames: int) -> TackleEvent | None:
    candidates = [
        tackle
        for tackle in tackles
        if tackle.section == carry.section
        and tackle.involves(carry.player_id)
        and abs(tackle.frame - carry.end_frame) <= tolerance_frames
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda tackle: abs(tackle.frame - carry.end_frame))


def _is_forward_progress(context: MatchContext, player: PlayerInfo, carry: CarryEvent) -> bool:
    home_gk_left = context.phase_home_gk_left.get(carry.section)
    if home_gk_left is None:
        return True
    home_attacks_positive_x = bool(home_gk_left)
    player_is_home = player.team_role == "home"
    attacks_positive_x = home_attacks_positive_x if player_is_home else not home_attacks_positive_x
    delta_x = carry.end_x - carry.start_x
    return delta_x > 0 if attacks_positive_x else delta_x < 0


def normalize_part_name(raw: Any) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", errors="ignore")
    if isinstance(raw, int):
        return PART_NAME_BY_ID.get(raw)
    text = str(raw).strip()
    if text.isdigit():
        return PART_NAME_BY_ID.get(int(text))
    text = text.lower().replace(" ", "_").replace("-", "_")
    text = "_".join(part for part in text.split("_") if part)
    return text or None


def _append_arm_metrics(
    parts: dict[str, Vec3],
    path_vector: tuple[float, float] | None,
    wrist_distances: list[float],
    arm_spread_ratios: list[float],
    arms_close_flags: list[float],
    left_elbow_angles: list[float],
    right_elbow_angles: list[float],
    hand_height_asymmetries: list[float],
    arm_path_alignments: list[float],
) -> None:
    left_wrist = parts.get("left_wrist")
    right_wrist = parts.get("right_wrist")
    left_shoulder = parts.get("left_shoulder")
    right_shoulder = parts.get("right_shoulder")
    if left_wrist is not None and right_wrist is not None:
        wrist_distance = _distance(left_wrist, right_wrist)
        wrist_distances.append(wrist_distance)
        hand_height_asymmetries.append(abs(left_wrist.z - right_wrist.z))
        if left_shoulder is not None and right_shoulder is not None:
            shoulder_width = max(_distance(left_shoulder, right_shoulder), 1e-9)
            arm_spread_ratios.append(wrist_distance / shoulder_width)
            arms_close_flags.append(1.0 if wrist_distance <= 1.25 * shoulder_width else 0.0)
    _append_joint_angle(left_elbow_angles, parts, "left_shoulder", "left_elbow", "left_wrist")
    _append_joint_angle(right_elbow_angles, parts, "right_shoulder", "right_elbow", "right_wrist")
    if path_vector is not None:
        for shoulder_name, wrist_name in (("left_shoulder", "left_wrist"), ("right_shoulder", "right_wrist")):
            shoulder = parts.get(shoulder_name)
            wrist = parts.get(wrist_name)
            if shoulder is None or wrist is None:
                continue
            arm_vector = _normalize2((wrist.x - shoulder.x, wrist.y - shoulder.y))
            if arm_vector is not None:
                arm_path_alignments.append(abs(_dot2(arm_vector, path_vector)))


def _append_duel_metrics(
    frame: SkeletonFrame,
    attacker_key: tuple[int, int],
    defender_key: tuple[int, int],
    attacker: dict[str, Vec3],
    defender: dict[str, Vec3],
    attacker_defender_distances: list[float],
    ball_shielding_flags: list[float],
    shoulder_hip_separations: list[float],
    hip_axis_to_defender: list[float],
    shoulder_axis_to_defender: list[float],
    defender_support_left_flags: list[float],
    attacker_defender_hip_axis_angles: list[float],
) -> None:
    del attacker_key, defender_key
    attacker_pelvis = attacker.get("pelvis")
    defender_pelvis = defender.get("pelvis")
    if attacker_pelvis is not None and defender_pelvis is not None:
        attacker_defender_distances.append(_distance_xy(attacker_pelvis, defender_pelvis))
        if frame.ball is not None:
            to_defender = _normalize2((defender_pelvis.x - attacker_pelvis.x, defender_pelvis.y - attacker_pelvis.y))
            to_ball = _normalize2((frame.ball.x - attacker_pelvis.x, frame.ball.y - attacker_pelvis.y))
            if to_defender is not None and to_ball is not None:
                ball_shielding_flags.append(1.0 if _dot2(to_defender, to_ball) < 0.0 else 0.0)
        _append_axis_to_target(hip_axis_to_defender, attacker, "left_hip", "right_hip", attacker_pelvis, defender_pelvis)
        _append_axis_to_target(shoulder_axis_to_defender, attacker, "left_shoulder", "right_shoulder", attacker_pelvis, defender_pelvis)
    shoulder_axis = _axis(attacker, "left_shoulder", "right_shoulder")
    hip_axis = _axis(attacker, "left_hip", "right_hip")
    if shoulder_axis is not None and hip_axis is not None:
        shoulder_hip_separations.append(_angle_between2_deg(shoulder_axis, hip_axis))
    defender_left_heel = defender.get("left_heel")
    defender_right_heel = defender.get("right_heel")
    if defender_pelvis is not None and defender_left_heel is not None and defender_right_heel is not None:
        left_support = _distance(defender_pelvis, defender_left_heel)
        right_support = _distance(defender_pelvis, defender_right_heel)
        defender_support_left_flags.append(1.0 if left_support <= right_support else 0.0)
    defender_hip_axis = _axis(defender, "left_hip", "right_hip")
    if hip_axis is not None and defender_hip_axis is not None:
        attacker_defender_hip_axis_angles.append(_angle_between2_deg(hip_axis, defender_hip_axis))


def _append_spacing_metrics(
    frame: SkeletonFrame,
    attacker_key: tuple[int, int],
    attacker: dict[str, Vec3],
    nearest_opponent_distances: list[float],
    nearest_teammate_distances: list[float],
    opponents_within_2m: list[float],
    opponents_within_3m: list[float],
    opponents_within_5m: list[float],
) -> None:
    attacker_pelvis = attacker.get("pelvis")
    if attacker_pelvis is None:
        return
    opponent_distances: list[float] = []
    teammate_distances: list[float] = []
    for key, parts in frame.players.items():
        if key == attacker_key or key[0] not in {0, 1}:
            continue
        pelvis = parts.get("pelvis")
        if pelvis is None:
            continue
        distance = _distance_xy(attacker_pelvis, pelvis)
        if key[0] == attacker_key[0]:
            teammate_distances.append(distance)
        else:
            opponent_distances.append(distance)
    if opponent_distances:
        nearest_opponent_distances.append(min(opponent_distances))
        opponents_within_2m.append(float(sum(1 for distance in opponent_distances if distance <= 2.0)))
        opponents_within_3m.append(float(sum(1 for distance in opponent_distances if distance <= 3.0)))
        opponents_within_5m.append(float(sum(1 for distance in opponent_distances if distance <= 5.0)))
    if teammate_distances:
        nearest_teammate_distances.append(min(teammate_distances))


def _nearest_ball_foot_distance(ball: Vec3 | None, parts: dict[str, Vec3]) -> tuple[float | None, str | None]:
    if ball is None:
        return None, None
    best_distance: float | None = None
    best_side: str | None = None
    for part_name in FOOT_PARTS:
        point = parts.get(part_name)
        if point is None:
            continue
        distance = _distance(ball, point)
        if best_distance is None or distance < best_distance:
            best_distance = distance
            best_side = "left" if part_name.startswith("left") else "right"
    return best_distance, best_side


def _touch_indices(distances: list[float], threshold: float, *, min_separation_frames: int) -> list[int]:
    touches: list[int] = []
    for index, distance in enumerate(distances):
        if distance > threshold:
            continue
        left_ok = index == 0 or distance <= distances[index - 1]
        right_ok = index == len(distances) - 1 or distance <= distances[index + 1]
        if not (left_ok and right_ok):
            continue
        if touches and index - touches[-1] < min_separation_frames:
            if distance < distances[touches[-1]]:
                touches[-1] = index
            continue
        touches.append(index)
    return touches


def _player_speeds(frames: list[SkeletonFrame], player_key: tuple[int, int], frame_rate: int) -> list[float]:
    speeds: list[float] = []
    previous_frame: SkeletonFrame | None = None
    previous_pelvis: Vec3 | None = None
    for frame in frames:
        pelvis = frame.players.get(player_key, {}).get("pelvis")
        if pelvis is not None and previous_pelvis is not None and previous_frame is not None:
            dt = max((frame.frame_number - previous_frame.frame_number) / frame_rate, 1e-9)
            speeds.append(_distance_xy(pelvis, previous_pelvis) / dt)
        if pelvis is not None:
            previous_frame = frame
            previous_pelvis = pelvis
    return speeds


def _speed_deltas(speeds: list[float], frame_rate: int) -> list[float]:
    return [(speeds[index] - speeds[index - 1]) * frame_rate for index in range(1, len(speeds))]


def _closing_speeds(distances: list[float], frame_rate: int) -> list[float]:
    return [-(distances[index] - distances[index - 1]) * frame_rate for index in range(1, len(distances))]


def _direction_change_count(frames: list[SkeletonFrame], player_key: tuple[int, int], *, threshold_deg: float = 30.0) -> int:
    velocities: list[tuple[float, float]] = []
    previous_frame: SkeletonFrame | None = None
    previous_pelvis: Vec3 | None = None
    for frame in frames:
        pelvis = frame.players.get(player_key, {}).get("pelvis")
        if pelvis is not None and previous_pelvis is not None and previous_frame is not None:
            velocities.append((pelvis.x - previous_pelvis.x, pelvis.y - previous_pelvis.y))
        if pelvis is not None:
            previous_frame = frame
            previous_pelvis = pelvis
    count = 0
    for left, right in zip(velocities, velocities[1:]):
        if _angle_between2_deg(left, right) >= threshold_deg:
            count += 1
    return count


def _head_direction(parts: dict[str, Vec3]) -> tuple[float, float] | None:
    nose = parts.get("nose")
    left_ear = parts.get("left_ear")
    right_ear = parts.get("right_ear")
    if nose is not None and left_ear is not None and right_ear is not None:
        ear_mid = Vec3((left_ear.x + right_ear.x) / 2.0, (left_ear.y + right_ear.y) / 2.0, (left_ear.z + right_ear.z) / 2.0)
        return _normalize2((nose.x - ear_mid.x, nose.y - ear_mid.y))
    neck = parts.get("neck")
    if nose is not None and neck is not None:
        return _normalize2((nose.x - neck.x, nose.y - neck.y))
    return None


def _axis(parts: dict[str, Vec3], left_name: str, right_name: str) -> tuple[float, float] | None:
    left = parts.get(left_name)
    right = parts.get(right_name)
    if left is None or right is None:
        return None
    return _normalize2((right.x - left.x, right.y - left.y))


def _append_axis_to_target(
    output: list[float],
    parts: dict[str, Vec3],
    left_name: str,
    right_name: str,
    origin: Vec3,
    target: Vec3,
) -> None:
    axis = _axis(parts, left_name, right_name)
    to_target = _normalize2((target.x - origin.x, target.y - origin.y))
    if axis is not None and to_target is not None:
        output.append(_angle_between2_deg(axis, to_target))


def _append_joint_angle(output: list[float], parts: dict[str, Vec3], first_name: str, mid_name: str, last_name: str) -> None:
    first = parts.get(first_name)
    mid = parts.get(mid_name)
    last = parts.get(last_name)
    if first is not None and mid is not None and last is not None:
        output.append(_joint_angle_deg(first, mid, last))


def _opposite_support_leg(candidate: DribbleCandidate, defender_support_left_flags: list[float]) -> float:
    if not candidate.dribbling_side or not defender_support_left_flags:
        return _nan()
    if candidate.dribbling_side.lower() not in {"left", "right"}:
        return _nan()
    defender_left_fraction = _mean(defender_support_left_flags)
    defender_support_side = "left" if defender_left_fraction >= 0.5 else "right"
    return 1.0 if candidate.dribbling_side.lower() != defender_support_side else 0.0


def _paper_dribble_metrics(candidate: DribbleCandidate, frames: list[SkeletonFrame], *, frame_rate: int) -> dict[str, Any]:
    frames = sorted(frames, key=lambda frame: frame.frame_number)
    samples = _ball_foot_samples(candidate, frames)
    distances = [sample["distance"] for sample in samples]
    touch_indices = _touch_indices(
        distances,
        PAPER_TOUCH_THRESHOLD_M,
        min_separation_frames=max(1, round(PAPER_TOUCH_SEPARATION_S * frame_rate)),
    )
    pressure_scores: list[float] = []
    com_imbalances: list[float] = []
    com_heights: list[float] = []
    torso_leans: list[float] = []
    pass_opposite_values: list[float] = []
    stance_angles: list[float] = []
    for frame in frames:
        attacker = frame.players.get(candidate.attacker_parquet_key, {})
        defender = frame.players.get(candidate.defender_parquet_key, {})
        if not attacker:
            continue
        pressure_scores.append(_frame_pressure_score(frame, candidate.attacker_parquet_key, attacker))
        com = _center_of_mass(attacker)
        if com is not None:
            com_heights.append(com.z)
        com_imbalances.append(_com_imbalance(attacker))
        torso_leans.append(_paper_torso_lean(attacker))
        pass_opposite = _pass_side_vs_weighted_leg(attacker, defender)
        if not math.isnan(pass_opposite):
            pass_opposite_values.append(pass_opposite)
        stance_angle = _defender_stance_angle(attacker, defender)
        if not math.isnan(stance_angle):
            stance_angles.append(stance_angle)

    avg_ball_foot_distance = _mean(distances)
    avg_pressure = _mean(pressure_scores)
    if math.isnan(avg_ball_foot_distance):
        normalized_ball_foot_distance = _nan()
    else:
        pressure = avg_pressure if not math.isnan(avg_pressure) else 1.0
        normalized_ball_foot_distance = avg_ball_foot_distance * (max(pressure, 1e-9) ** PAPER_PRESSURE_ALPHA)

    closest = _closest_duel_frame(candidate, frames)
    closest_attacker = closest.players.get(candidate.attacker_parquet_key, {}) if closest is not None else {}
    closest_defender = closest.players.get(candidate.defender_parquet_key, {}) if closest is not None else {}
    stance_at_min_distance = _defender_stance_angle(closest_attacker, closest_defender)
    pass_opposite_at_min_distance = _pass_side_vs_weighted_leg(closest_attacker, closest_defender)
    defender_weighted_leg = _weighted_leg(closest_defender)
    attacker_pass_side = _attacker_side_relative_to_defender(closest_attacker, closest_defender)

    return {
        "paper_avg_ball_foot_distance": avg_ball_foot_distance,
        "paper_avg_pressure_score": avg_pressure,
        "paper_avg_normalized_ball_foot_distance": normalized_ball_foot_distance,
        "paper_ball_touch_count": len(touch_indices),
        "paper_ball_touch_frequency_per_s": len(touch_indices) / _window_duration_seconds(frames, frame_rate) if frames else _nan(),
        "paper_com_imbalance_mean": _mean(com_imbalances),
        "paper_com_height_mean": _mean(com_heights),
        "paper_torso_lean_p90_deg": _percentile(torso_leans, 90),
        "paper_torso_lean_mean_deg": _mean(torso_leans),
        "paper_pass_side_vs_weighted_leg": pass_opposite_at_min_distance,
        "paper_pass_side_vs_weighted_leg_mean": _mean(pass_opposite_values),
        "paper_defender_weighted_leg": defender_weighted_leg,
        "paper_attacker_pass_side": attacker_pass_side,
        "paper_defender_stance_angle_deg": stance_at_min_distance,
        "paper_defender_stance_angle_mean_deg": _mean(stance_angles),
        "paper_defender_stance_category": _stance_category(stance_at_min_distance),
        "paper_max_direction_change_deg": _max_direction_change_deg(frames, candidate.attacker_parquet_key),
        "paper_max_relative_speed_m_s": _safe_max(
            [a - d for a, d in zip(_player_speeds(frames, candidate.attacker_parquet_key, frame_rate), _player_speeds(frames, candidate.defender_parquet_key, frame_rate))]
        ),
    }


def _technique_profile(metrics: dict[str, Any]) -> dict[str, Any]:
    touch_frequency = _to_float(metrics.get("paper_ball_touch_frequency_per_s"))
    avg_distance = _to_float(metrics.get("paper_avg_ball_foot_distance"))
    attacker_speed_max = _to_float(metrics.get("attacker_speed_max"))
    torso_lean = _to_float(metrics.get("paper_torso_lean_p90_deg"))
    imbalance = _to_float(metrics.get("paper_com_imbalance_mean"))
    if touch_frequency is not None and avg_distance is not None and touch_frequency >= 1.5 and avg_distance <= 0.75:
        touch_style = "close_control"
    elif (touch_frequency is not None and touch_frequency <= 1.0) and (
        (attacker_speed_max is not None and attacker_speed_max >= 5.5) or (avg_distance is not None and avg_distance >= 1.0)
    ):
        touch_style = "push_and_run"
    else:
        touch_style = "mixed_control"

    if (torso_lean is not None and torso_lean >= 35.0) or (imbalance is not None and imbalance >= 0.45):
        balance_profile = "off_balance"
    elif (torso_lean is not None and torso_lean >= 20.0) or (imbalance is not None and imbalance >= 0.25):
        balance_profile = "leaning"
    else:
        balance_profile = "stable"

    return {
        "technique_touch_style": touch_style,
        "technique_balance_profile": balance_profile,
        "technique_defender_stance_profile": metrics.get("paper_defender_stance_category") or "",
    }


def _ball_foot_samples(candidate: DribbleCandidate, frames: list[SkeletonFrame]) -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    for frame in sorted(frames, key=lambda item: item.frame_number):
        attacker = frame.players.get(candidate.attacker_parquet_key, {})
        distance, side, part = _nearest_ball_foot_detail(frame.ball, attacker)
        if distance is None:
            continue
        samples.append({"frame": frame, "distance": distance, "side": side, "part": part})
    return samples


def _nearest_ball_foot_detail(ball: Vec3 | None, parts: dict[str, Vec3]) -> tuple[float | None, str | None, str | None]:
    if ball is None:
        return None, None, None
    best_distance: float | None = None
    best_side: str | None = None
    best_part: str | None = None
    for part_name in FOOT_PARTS:
        point = parts.get(part_name)
        if point is None:
            continue
        distance = _distance(ball, point)
        if best_distance is None or distance < best_distance:
            best_distance = distance
            best_side = "left" if part_name.startswith("left") else "right"
            best_part = part_name
    return best_distance, best_side, best_part


def _center_of_mass(parts: dict[str, Vec3]) -> Vec3 | None:
    weighted: list[tuple[float, Vec3]] = []

    def add_segment(weight: float, first: str, second: str, ratio: float = 0.5) -> None:
        left = parts.get(first)
        right = parts.get(second)
        if left is None or right is None:
            return
        weighted.append(
            (
                weight,
                Vec3(
                    (1.0 - ratio) * left.x + ratio * right.x,
                    (1.0 - ratio) * left.y + ratio * right.y,
                    (1.0 - ratio) * left.z + ratio * right.z,
                ),
            )
        )

    hip_mid = _hip_midpoint(parts)
    shoulder_mid = _shoulder_midpoint(parts)
    neck = parts.get("neck")
    nose = parts.get("nose")
    if hip_mid is not None and (neck is not None or shoulder_mid is not None):
        top = neck or shoulder_mid
        weighted.append((0.50, Vec3((hip_mid.x + top.x) / 2.0, (hip_mid.y + top.y) / 2.0, (hip_mid.z + top.z) / 2.0)))
    if neck is not None and nose is not None:
        weighted.append((0.08, Vec3((neck.x + nose.x) / 2.0, (neck.y + nose.y) / 2.0, (neck.z + nose.z) / 2.0)))
    add_segment(0.028, "left_shoulder", "left_elbow", 0.436)
    add_segment(0.028, "right_shoulder", "right_elbow", 0.436)
    add_segment(0.022, "left_elbow", "left_wrist", 0.682)
    add_segment(0.022, "right_elbow", "right_wrist", 0.682)
    add_segment(0.100, "left_hip", "left_knee", 0.433)
    add_segment(0.100, "right_hip", "right_knee", 0.433)
    add_segment(0.0465, "left_knee", "left_ankle", 0.433)
    add_segment(0.0465, "right_knee", "right_ankle", 0.433)
    add_segment(0.0145, "left_heel", "left_toe", 0.5)
    add_segment(0.0145, "right_heel", "right_toe", 0.5)
    if not weighted:
        return parts.get("pelvis")
    total = sum(weight for weight, _ in weighted)
    if total <= 0:
        return parts.get("pelvis")
    return Vec3(
        sum(weight * point.x for weight, point in weighted) / total,
        sum(weight * point.y for weight, point in weighted) / total,
        sum(weight * point.z for weight, point in weighted) / total,
    )


def _com_imbalance(parts: dict[str, Vec3]) -> float:
    com = _center_of_mass(parts)
    foot_midpoint = _foot_midpoint(parts)
    if com is None or foot_midpoint is None:
        return _nan()
    return _distance_xy(com, foot_midpoint)


def _paper_torso_lean(parts: dict[str, Vec3]) -> float:
    neck = parts.get("neck")
    hip_midpoint = _hip_midpoint(parts) or parts.get("pelvis")
    if neck is None or hip_midpoint is None:
        return _nan()
    return _angle_from_vertical(neck, hip_midpoint)


def _frame_pressure_score(frame: SkeletonFrame, attacker_key: tuple[int, int], attacker: dict[str, Vec3]) -> float:
    attacker_pelvis = attacker.get("pelvis")
    if attacker_pelvis is None:
        return 1.0
    pressure = 1.0
    for key, parts in frame.players.items():
        if key == attacker_key or key[0] == attacker_key[0] or key[0] not in {0, 1}:
            continue
        pelvis = parts.get("pelvis")
        if pelvis is None:
            continue
        pressure += math.exp(-_distance_xy(attacker_pelvis, pelvis) / 2.0)
    return pressure


def _pass_side_vs_weighted_leg(attacker: dict[str, Vec3], defender: dict[str, Vec3]) -> float:
    weighted_leg = _weighted_leg(defender)
    pass_side = _attacker_side_relative_to_defender(attacker, defender)
    if weighted_leg is None or pass_side is None:
        return _nan()
    return 1.0 if weighted_leg != pass_side else 0.0


def _weighted_leg(parts: dict[str, Vec3]) -> str | None:
    com = _center_of_mass(parts)
    left_heel = parts.get("left_heel")
    right_heel = parts.get("right_heel")
    if com is None or left_heel is None or right_heel is None:
        return None
    return "left" if _distance(com, left_heel) <= _distance(com, right_heel) else "right"


def _attacker_side_relative_to_defender(attacker: dict[str, Vec3], defender: dict[str, Vec3]) -> str | None:
    attacker_pelvis = attacker.get("pelvis")
    defender_pelvis = defender.get("pelvis")
    defender_axis = _axis(defender, "left_hip", "right_hip")
    if attacker_pelvis is None or defender_pelvis is None or defender_axis is None:
        return None
    to_attacker = (attacker_pelvis.x - defender_pelvis.x, attacker_pelvis.y - defender_pelvis.y)
    return "right" if _dot2(defender_axis, to_attacker) >= 0.0 else "left"


def _defender_stance_angle(attacker: dict[str, Vec3], defender: dict[str, Vec3]) -> float:
    attacker_axis = _axis(attacker, "left_hip", "right_hip")
    defender_axis = _axis(defender, "left_hip", "right_hip")
    if attacker_axis is None or defender_axis is None:
        return _nan()
    return _angle_between2_deg(attacker_axis, defender_axis)


def _stance_category(angle: float) -> str:
    if math.isnan(angle):
        return ""
    if angle < 120.0:
        return "side_on"
    if angle < 150.0:
        return "intermediate"
    return "squared_up"


def _closest_duel_frame(candidate: DribbleCandidate, frames: list[SkeletonFrame]) -> SkeletonFrame | None:
    best_frame: SkeletonFrame | None = None
    best_distance: float | None = None
    for frame in frames:
        attacker = frame.players.get(candidate.attacker_parquet_key, {})
        defender = frame.players.get(candidate.defender_parquet_key, {})
        attacker_pelvis = attacker.get("pelvis")
        defender_pelvis = defender.get("pelvis")
        if attacker_pelvis is None or defender_pelvis is None:
            continue
        distance = _distance_xy(attacker_pelvis, defender_pelvis)
        if best_distance is None or distance < best_distance:
            best_distance = distance
            best_frame = frame
    return best_frame


def _max_direction_change_deg(frames: list[SkeletonFrame], player_key: tuple[int, int]) -> float:
    velocities: list[tuple[float, float]] = []
    previous_frame: SkeletonFrame | None = None
    previous_pelvis: Vec3 | None = None
    for frame in frames:
        pelvis = frame.players.get(player_key, {}).get("pelvis")
        if pelvis is not None and previous_pelvis is not None and previous_frame is not None:
            velocities.append((pelvis.x - previous_pelvis.x, pelvis.y - previous_pelvis.y))
        if pelvis is not None:
            previous_frame = frame
            previous_pelvis = pelvis
    changes = [_angle_between2_deg(left, right) for left, right in zip(velocities, velocities[1:])]
    return _safe_max(changes)


def _body_relative_xy(
    parts: dict[str, Vec3],
    target: Vec3 | None,
    fallback_forward: tuple[float, float] | None,
) -> tuple[float, float] | None:
    pelvis = parts.get("pelvis")
    if pelvis is None or target is None:
        return None
    forward = _head_direction(parts) or fallback_forward
    if forward is None:
        return None
    lateral = (-forward[1], forward[0])
    vector = (target.x - pelvis.x, target.y - pelvis.y)
    return (_dot2(vector, forward), _dot2(vector, lateral))


def _neighbor_ball_speed(samples: list[dict[str, Any]], left_index: int, right_index: int, frame_rate: int) -> float:
    if left_index < 0 or right_index >= len(samples):
        return _nan()
    left = samples[left_index]["frame"]
    right = samples[right_index]["frame"]
    if left.ball is None or right.ball is None:
        return _nan()
    dt = max((right.frame_number - left.frame_number) / frame_rate, 1e-9)
    return _distance_xy(left.ball, right.ball) / dt


def _neighbor_player_speed(samples: list[dict[str, Any]], left_index: int, right_index: int, player_key: tuple[int, int], frame_rate: int) -> float:
    if left_index < 0 or right_index >= len(samples):
        return _nan()
    left = samples[left_index]["frame"]
    right = samples[right_index]["frame"]
    left_pelvis = left.players.get(player_key, {}).get("pelvis")
    right_pelvis = right.players.get(player_key, {}).get("pelvis")
    if left_pelvis is None or right_pelvis is None:
        return _nan()
    dt = max((right.frame_number - left.frame_number) / frame_rate, 1e-9)
    return _distance_xy(left_pelvis, right_pelvis) / dt


def _phase_summary_row(candidate: DribbleCandidate, phase: str, frames: list[SkeletonFrame], *, frame_rate: int) -> dict[str, Any]:
    if not frames:
        return _empty_phase_row(candidate, phase)
    distances: list[float] = []
    defender_distances: list[float] = []
    pressure_scores: list[float] = []
    torso_leans: list[float] = []
    com_imbalances: list[float] = []
    for frame in frames:
        attacker = frame.players.get(candidate.attacker_parquet_key, {})
        defender = frame.players.get(candidate.defender_parquet_key, {})
        distance, _ = _nearest_ball_foot_distance(frame.ball, attacker)
        if distance is not None:
            distances.append(distance)
        attacker_pelvis = attacker.get("pelvis")
        defender_pelvis = defender.get("pelvis")
        if attacker_pelvis is not None and defender_pelvis is not None:
            defender_distances.append(_distance_xy(attacker_pelvis, defender_pelvis))
        if attacker:
            pressure_scores.append(_frame_pressure_score(frame, candidate.attacker_parquet_key, attacker))
            torso_leans.append(_paper_torso_lean(attacker))
            com_imbalances.append(_com_imbalance(attacker))
    return {
        "event_id": candidate.event_id,
        "match_folder": candidate.match_folder,
        "source": candidate.source,
        "outcome": candidate.outcome,
        "window_type": candidate.window_type,
        "phase": phase,
        "start_frame": frames[0].frame_number,
        "end_frame": frames[-1].frame_number,
        "frame_count": len(frames),
        "duration_seconds": _window_duration_seconds(frames, frame_rate),
        "ball_foot_distance_mean": _mean(distances),
        "attacker_speed_mean": _mean(_player_speeds(frames, candidate.attacker_parquet_key, frame_rate)),
        "defender_distance_mean": _mean(defender_distances),
        "pressure_score_mean": _mean(pressure_scores),
        "torso_lean_mean_deg": _mean(torso_leans),
        "com_imbalance_mean": _mean(com_imbalances),
    }


def _empty_phase_row(candidate: DribbleCandidate, phase: str) -> dict[str, Any]:
    return {
        "event_id": candidate.event_id,
        "match_folder": candidate.match_folder,
        "source": candidate.source,
        "outcome": candidate.outcome,
        "window_type": candidate.window_type,
        "phase": phase,
        "start_frame": None,
        "end_frame": None,
        "frame_count": 0,
        "duration_seconds": 0.0,
        "ball_foot_distance_mean": _nan(),
        "attacker_speed_mean": _nan(),
        "defender_distance_mean": _nan(),
        "pressure_score_mean": _nan(),
        "torso_lean_mean_deg": _nan(),
        "com_imbalance_mean": _nan(),
    }


def _hip_midpoint(parts: dict[str, Vec3]) -> Vec3 | None:
    left = parts.get("left_hip")
    right = parts.get("right_hip")
    if left is None or right is None:
        return parts.get("pelvis")
    return Vec3((left.x + right.x) / 2.0, (left.y + right.y) / 2.0, (left.z + right.z) / 2.0)


def _shoulder_midpoint(parts: dict[str, Vec3]) -> Vec3 | None:
    left = parts.get("left_shoulder")
    right = parts.get("right_shoulder")
    if left is None or right is None:
        return None
    return Vec3((left.x + right.x) / 2.0, (left.y + right.y) / 2.0, (left.z + right.z) / 2.0)


def _foot_midpoint(parts: dict[str, Vec3]) -> Vec3 | None:
    left = parts.get("left_toe") or parts.get("left_heel") or parts.get("left_ankle")
    right = parts.get("right_toe") or parts.get("right_heel") or parts.get("right_ankle")
    if left is None or right is None:
        return None
    return Vec3((left.x + right.x) / 2.0, (left.y + right.y) / 2.0, (left.z + right.z) / 2.0)


def _path_from_frames(frames: list[SkeletonFrame], player_key: tuple[int, int]) -> tuple[float, float] | None:
    first: Vec3 | None = None
    last: Vec3 | None = None
    for frame in frames:
        pelvis = frame.players.get(player_key, {}).get("pelvis")
        if pelvis is None:
            continue
        first = first or pelvis
        last = pelvis
    if first is None or last is None:
        return None
    return _normalize2((last.x - first.x, last.y - first.y))


def _window_duration_seconds(frames: list[SkeletonFrame], frame_rate: int) -> float:
    if len(frames) < 2:
        return len(frames) / frame_rate if frames else 0.0
    return max((frames[-1].frame_number - frames[0].frame_number) / frame_rate, len(frames) / frame_rate)


def _angle_from_vertical(top: Vec3, bottom: Vec3) -> float:
    vector = Vec3(top.x - bottom.x, top.y - bottom.y, top.z - bottom.z)
    norm = _norm3(vector)
    if norm == 0:
        return _nan()
    return math.degrees(math.acos(_clamp(vector.z / norm, -1.0, 1.0)))


def _joint_angle_deg(first: Vec3, mid: Vec3, last: Vec3) -> float:
    a = (first.x - mid.x, first.y - mid.y, first.z - mid.z)
    b = (last.x - mid.x, last.y - mid.y, last.z - mid.z)
    norm_a = math.sqrt(sum(value * value for value in a))
    norm_b = math.sqrt(sum(value * value for value in b))
    if norm_a == 0 or norm_b == 0:
        return _nan()
    dot = sum(left * right for left, right in zip(a, b))
    return math.degrees(math.acos(_clamp(dot / (norm_a * norm_b), -1.0, 1.0)))


def _angle_between2_deg(left: tuple[float, float], right: tuple[float, float]) -> float:
    left_norm = _normalize2(left)
    right_norm = _normalize2(right)
    if left_norm is None or right_norm is None:
        return _nan()
    return math.degrees(math.acos(_clamp(_dot2(left_norm, right_norm), -1.0, 1.0)))


def _angle_variability_deg(angles: list[float]) -> float:
    if not angles:
        return _nan()
    mean_sin = sum(math.sin(angle) for angle in angles) / len(angles)
    mean_cos = sum(math.cos(angle) for angle in angles) / len(angles)
    resultant = math.sqrt(mean_sin * mean_sin + mean_cos * mean_cos)
    return math.degrees(math.sqrt(max(0.0, -2.0 * math.log(max(resultant, 1e-12)))))


def _scan_proxy_count(angles: list[float], *, threshold_deg: float = 25.0) -> int:
    count = 0
    for left, right in zip(angles, angles[1:]):
        delta = abs(math.atan2(math.sin(right - left), math.cos(right - left)))
        if math.degrees(delta) >= threshold_deg:
            count += 1
    return count


def _maybe_convert_centimeters(frames: list[SkeletonFrame]) -> list[SkeletonFrame]:
    sample_values: list[float] = []
    for frame in frames[:10]:
        if frame.ball is not None:
            sample_values.extend([abs(frame.ball.x), abs(frame.ball.y), abs(frame.ball.z)])
        for parts in frame.players.values():
            pelvis = parts.get("pelvis")
            if pelvis is not None:
                sample_values.extend([abs(pelvis.x), abs(pelvis.y), abs(pelvis.z)])
                break
    if not sample_values or max(sample_values) < 250.0:
        return frames
    return [_scale_frame(frame, 0.01) for frame in frames]


def _scale_frame(frame: SkeletonFrame, scale: float) -> SkeletonFrame:
    def scale_vec(vec: Vec3 | None) -> Vec3 | None:
        return Vec3(vec.x * scale, vec.y * scale, vec.z * scale) if vec is not None else None

    return SkeletonFrame(
        frame_number=frame.frame_number,
        ball=scale_vec(frame.ball),
        ball_velocity=scale_vec(frame.ball_velocity),
        players={key: {name: scale_vec(point) for name, point in parts.items() if scale_vec(point) is not None} for key, parts in frame.players.items()},
    )


def _frame_number_column_index(metadata: Any) -> int:
    for index in range(metadata.num_columns):
        if metadata.schema.column(index).path == "frame_number":
            return index
    raise RuntimeError("Parquet metadata does not expose frame_number statistics")


def _s3fs_path(s3_uri: str) -> str:
    parsed = urlparse(s3_uri)
    if parsed.scheme != "s3":
        raise ValueError(f"Expected s3:// URI, got {s3_uri!r}")
    return f"{parsed.netloc}{parsed.path}"


def _s3_filesystem(profile: str):
    try:
        import pyarrow.fs as pafs
    except ImportError as exc:
        raise RuntimeError("S3 parquet extraction requires pyarrow.fs") from exc

    credentials = _aws_export_credentials(profile)
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or "eu-central-1"
    if credentials:
        return pafs.S3FileSystem(
            access_key=credentials["AWS_ACCESS_KEY_ID"],
            secret_key=credentials["AWS_SECRET_ACCESS_KEY"],
            session_token=credentials.get("AWS_SESSION_TOKEN"),
            region=region,
        )
    return pafs.S3FileSystem(region=region)


def _aws_export_credentials(profile: str) -> dict[str, str]:
    if not profile:
        return {}
    try:
        result = subprocess.run(
            ["aws", "configure", "export-credentials", "--profile", profile, "--format", "env"],
            check=True,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return {}
    credentials: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if not line.startswith("export "):
            continue
        name_value = line.removeprefix("export ").split("=", 1)
        if len(name_value) == 2:
            credentials[name_value[0]] = name_value[1]
    required = {"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"}
    if not required.issubset(credentials):
        return {}
    return credentials


def _vec_from_mapping(mapping: Any, x_name: str, y_name: str, z_name: str) -> Vec3 | None:
    x = _optional_float(_mapping_get(mapping, x_name))
    y = _optional_float(_mapping_get(mapping, y_name))
    z = _optional_float(_mapping_get(mapping, z_name))
    if x is None or y is None or z is None:
        return None
    return Vec3(x, y, z)


def _mapping_get(mapping: Any, key: str) -> Any:
    if isinstance(mapping, dict):
        return mapping.get(key)
    return getattr(mapping, key, None)


def _parquet_team_for_role(role: str) -> int:
    normalized = role.strip().lower()
    if normalized == "home":
        return 1
    if normalized in {"guest", "away"}:
        return 0
    return -1


def _normalize_section(section: str | None) -> str:
    normalized = (section or "").strip()
    if normalized in {"firstHalf", "1", "first"}:
        return "firstHalf"
    if normalized in {"secondHalf", "2", "second"}:
        return "secondHalf"
    return normalized


def _is_goalkeeper_position(position: str | None) -> bool:
    return (position or "").strip().upper() in {"TW", "GK", "G"}


def _same_token(value: str | None, expected: str) -> bool:
    return (value or "").strip().lower() == expected.strip().lower()


def _is_true(value: str | None) -> bool:
    return (value or "").strip().lower() == "true"


def _required(element: ET.Element, attr: str) -> str:
    value = element.get(attr)
    if value is None:
        raise ValueError(f"Missing required XML attribute {attr!r} on <{element.tag}>")
    return value


def _float_attr(element: ET.Element, attr: str) -> float:
    value = _optional_float(element.get(attr))
    if value is None:
        raise ValueError(f"Missing required float XML attribute {attr!r} on <{element.tag}>")
    return value


def _optional_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_float(value: Any) -> float | None:
    parsed = _optional_float(value)
    if parsed is None or math.isnan(parsed):
        return None
    return parsed


def _distance(left: Vec3, right: Vec3) -> float:
    return math.sqrt((left.x - right.x) ** 2 + (left.y - right.y) ** 2 + (left.z - right.z) ** 2)


def _distance_xy(left: Vec3, right: Vec3) -> float:
    return math.hypot(left.x - right.x, left.y - right.y)


def _norm3(vec: Vec3) -> float:
    return math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z)


def _normalize2(vector: tuple[float, float]) -> tuple[float, float] | None:
    norm = math.hypot(vector[0], vector[1])
    if norm == 0:
        return None
    return (vector[0] / norm, vector[1] / norm)


def _dot2(left: tuple[float, float], right: tuple[float, float]) -> float:
    return left[0] * right[0] + left[1] * right[1]


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _mean(values: list[float]) -> float:
    clean = [value for value in values if not math.isnan(value)]
    return sum(clean) / len(clean) if clean else _nan()


def _safe_min(values: list[float]) -> float:
    clean = [value for value in values if not math.isnan(value)]
    return min(clean) if clean else _nan()


def _safe_max(values: list[float]) -> float:
    clean = [value for value in values if not math.isnan(value)]
    return max(clean) if clean else _nan()


def _std(values: list[float]) -> float:
    clean = [value for value in values if not math.isnan(value)]
    if not clean:
        return _nan()
    mean = sum(clean) / len(clean)
    return math.sqrt(sum((value - mean) ** 2 for value in clean) / len(clean))


def _percentile(values: list[float], percentile: float) -> float:
    clean = sorted(value for value in values if not math.isnan(value))
    if not clean:
        return _nan()
    if len(clean) == 1:
        return clean[0]
    rank = (percentile / 100.0) * (len(clean) - 1)
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return clean[int(rank)]
    fraction = rank - lower
    return clean[lower] * (1 - fraction) + clean[upper] * fraction


def _nan() -> float:
    return float("nan")


def _csv_value(value: Any) -> Any:
    if isinstance(value, float) and math.isnan(value):
        return ""
    return value


def _json_default(value: Any) -> Any:
    if isinstance(value, float) and math.isnan(value):
        return None
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")
