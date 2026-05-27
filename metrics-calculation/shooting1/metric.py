from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from dataclasses import dataclass, replace
from typing import Any

from aws_football.dribble_pose import SkeletonFrame, Vec3, kpi_to_skeleton_frame


FAMILY_WEIGHTS: dict[str, dict[str, float]] = {
    "oneV": {"D": 0.42, "T": 0.20, "B": 0.20, "C": 0.13, "V": 0.05},
    "open_play": {"D": 0.24, "T": 0.16, "B": 0.25, "C": 0.25, "V": 0.10},
    "cutback": {"D": 0.40, "T": 0.35, "B": 0.10, "C": 0.10, "V": 0.05},
    "long_range": {"D": 0.08, "T": 0.07, "B": 0.45, "C": 0.25, "V": 0.15},
    "volley": {"D": 0.15, "T": 0.15, "B": 0.20, "C": 0.40, "V": 0.10},
    "header": {"D": 0.18, "T": 0.12, "B": 0.30, "C": 0.30, "V": 0.10},
    "dead_ball": {"D": 0.05, "T": 0.10, "B": 0.30, "C": 0.40, "V": 0.15},
    "carry_self_created": {"D": 0.12, "T": 0.12, "B": 0.34, "C": 0.28, "V": 0.14},
}
P1_FAMILY_WEIGHTS: dict[str, dict[str, float]] = {
    "oneV": {"distance": 0.16, "angle": 0.14, "pressure": 0.16, "lane": 0.12, "keeper": 0.16, "previous": 0.08, "receiver": 0.08, "time": 0.06, "height": 0.02, "context": 0.02},
    "open_play": {"distance": 0.14, "angle": 0.14, "pressure": 0.18, "lane": 0.16, "keeper": 0.10, "previous": 0.08, "receiver": 0.06, "time": 0.06, "height": 0.02, "context": 0.06},
    "cutback": {"distance": 0.10, "angle": 0.12, "pressure": 0.18, "lane": 0.15, "keeper": 0.10, "previous": 0.13, "receiver": 0.12, "time": 0.08, "height": 0.01, "context": 0.01},
    "long_range": {"distance": 0.08, "angle": 0.10, "pressure": 0.22, "lane": 0.20, "keeper": 0.16, "previous": 0.04, "receiver": 0.02, "time": 0.04, "height": 0.02, "context": 0.12},
    "volley": {"distance": 0.10, "angle": 0.10, "pressure": 0.12, "lane": 0.12, "keeper": 0.10, "previous": 0.16, "receiver": 0.10, "time": 0.10, "height": 0.08, "context": 0.02},
    "header": {"distance": 0.12, "angle": 0.12, "pressure": 0.12, "lane": 0.12, "keeper": 0.10, "previous": 0.16, "receiver": 0.08, "time": 0.06, "height": 0.10, "context": 0.02},
    "dead_ball": {"distance": 0.18, "angle": 0.16, "pressure": 0.04, "lane": 0.12, "keeper": 0.18, "previous": 0.08, "receiver": 0.00, "time": 0.00, "height": 0.04, "context": 0.20},
    "carry_self_created": {"distance": 0.08, "angle": 0.10, "pressure": 0.18, "lane": 0.16, "keeper": 0.12, "previous": 0.12, "receiver": 0.02, "time": 0.04, "height": 0.02, "context": 0.16},
}
P2_FAMILY_WEIGHTS: dict[str, dict[str, float]] = {
    "oneV": {"speed": 0.12, "angle": 0.10, "prep": 0.12, "convergence": 0.20, "trunk": 0.10, "stride": 0.06, "timing": 0.20, "readiness": 0.10},
    "open_play": {"speed": 0.14, "angle": 0.14, "prep": 0.14, "convergence": 0.16, "trunk": 0.12, "stride": 0.06, "timing": 0.14, "readiness": 0.10},
    "cutback": {"speed": 0.10, "angle": 0.08, "prep": 0.14, "convergence": 0.20, "trunk": 0.10, "stride": 0.04, "timing": 0.22, "readiness": 0.12},
    "long_range": {"speed": 0.18, "angle": 0.18, "prep": 0.22, "convergence": 0.08, "trunk": 0.12, "stride": 0.10, "timing": 0.05, "readiness": 0.07},
    "volley": {"speed": 0.05, "angle": 0.05, "prep": 0.05, "convergence": 0.20, "trunk": 0.15, "stride": 0.00, "timing": 0.20, "readiness": 0.30},
    "header": {"speed": 0.06, "angle": 0.06, "prep": 0.04, "convergence": 0.16, "trunk": 0.24, "stride": 0.00, "timing": 0.20, "readiness": 0.24},
    "dead_ball": {"speed": 0.15, "angle": 0.20, "prep": 0.20, "convergence": 0.05, "trunk": 0.15, "stride": 0.10, "timing": 0.00, "readiness": 0.15},
    "carry_self_created": {"speed": 0.20, "angle": 0.12, "prep": 0.12, "convergence": 0.14, "trunk": 0.16, "stride": 0.08, "timing": 0.06, "readiness": 0.12},
}
TECHNIQUE_PHASE_WEIGHTS: dict[str, dict[str, float]] = {
    "oneV": {"P2": 0.15, "P3": 0.25, "P4": 0.40, "P5": 0.20},
    "open_play": {"P2": 0.15, "P3": 0.30, "P4": 0.40, "P5": 0.15},
    "cutback": {"P2": 0.18, "P3": 0.22, "P4": 0.40, "P5": 0.20},
    "long_range": {"P2": 0.20, "P3": 0.30, "P4": 0.35, "P5": 0.15},
    "volley": {"P2": 0.20, "P3": 0.20, "P4": 0.40, "P5": 0.20},
    "header": {"P2": 0.18, "P3": 0.30, "P4": 0.34, "P5": 0.18},
    "dead_ball": {"P2": 0.18, "P3": 0.28, "P4": 0.36, "P5": 0.18},
    "carry_self_created": {"P2": 0.18, "P3": 0.32, "P4": 0.30, "P5": 0.20},
}
P3_V3_COMPONENT_WEIGHTS: dict[str, dict[str, float]] = {
    "default": {"com": 0.25, "shoulder": 0.20, "knee": 0.20, "knee_peak": 0.15, "arm": 0.10, "foot_peak": 0.10},
    "cutback": {"com": 0.35, "shoulder": 0.10, "knee": 0.20, "knee_peak": 0.15, "arm": 0.10, "foot_peak": 0.10},
    "volley": {"com": 0.25, "shoulder": 0.10, "knee": 0.15, "knee_peak": 0.10, "arm": 0.15, "foot_peak": 0.25},
    "carry_self_created": {"com": 0.30, "shoulder": 0.14, "knee": 0.20, "knee_peak": 0.18, "arm": 0.10, "foot_peak": 0.08},
}
TECHNIQUE_MECHANICS_V3_WEIGHTS = {"P2": 0.15, "P3": 0.30, "P4_mech": 0.35, "P5": 0.20}
P6_FAMILY_WEIGHTS: dict[str, dict[str, float]] = {
    "oneV": {"align": 0.22, "lateral": 0.28, "vertical": 0.18, "speed": 0.15, "launch": 0.12, "flatness": 0.05, "outcome": 0.00},
    "open_play": {"align": 0.22, "lateral": 0.28, "vertical": 0.18, "speed": 0.15, "launch": 0.12, "flatness": 0.05, "outcome": 0.00},
    "cutback": {"align": 0.24, "lateral": 0.28, "vertical": 0.18, "speed": 0.14, "launch": 0.08, "flatness": 0.08, "outcome": 0.00},
    "long_range": {"align": 0.15, "lateral": 0.22, "vertical": 0.16, "speed": 0.27, "launch": 0.12, "flatness": 0.08, "outcome": 0.00},
    "volley": {"align": 0.17, "lateral": 0.24, "vertical": 0.17, "speed": 0.20, "launch": 0.17, "flatness": 0.05, "outcome": 0.00},
    "header": {"align": 0.18, "lateral": 0.28, "vertical": 0.22, "speed": 0.14, "launch": 0.13, "flatness": 0.05, "outcome": 0.00},
    "dead_ball": {"align": 0.16, "lateral": 0.27, "vertical": 0.20, "speed": 0.15, "launch": 0.12, "flatness": 0.10, "outcome": 0.00},
    "carry_self_created": {"align": 0.17, "lateral": 0.24, "vertical": 0.16, "speed": 0.25, "launch": 0.10, "flatness": 0.08, "outcome": 0.00},
}
COMPONENTS = ("D", "T", "B", "C", "V")
SHOOTING_PARTS = {
    "pelvis",
    "neck",
    "nose",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
    "left_heel",
    "right_heel",
    "left_toe",
    "right_toe",
}
CONFIDENCE_WEIGHTS = {
    "q_contact": 2.0,
    "q_sync": 2.0,
    "q_anchor": 1.0,
    "q_candidate": 1.0,
    "q_foot": 1.0,
    "q_occlusion": 1.0,
}
# Ball position-delta jump (m/s, frame-over-frame) above which contact is
# treated as physically certain. The parquet ball.velocity_* columns can lag
# visible ball displacement by ~2 frames, so contact timing is keyed from
# frame-to-frame ball position deltas and parquet velocity is kept as audit.
DECISIVE_POSITION_DELTA_JUMP_M_S = 15.0
BALL_RADIUS_M = 0.11
COMPONENT_SUBSCORES = (
    "D_distance",
    "D_angle",
    "D_pressure",
    "D_lane",
    "D_keeper_proxy",
    "B_shoulder_hip",
    "B_torso_lean",
    "B_knee_stability",
    "C_contact_near_ankle",
    "C_plant_forward",
    "C_plant_lateral",
    "C_foot_path_stability",
    "V_exit_speed",
    "V_launch_angle",
)
MODULE_SCORE_COLUMNS = (
    "technique_score",
    "technique_q",
    "technique_mechanics_score",
    "technique_mechanics_q",
    "technique_mechanics_band",
    "positioning_score",
    "positioning_q",
    "shot_geometry_score",
    "shot_geometry_q",
    "receiving_pressure_score",
    "receiving_pressure_q",
    "arrival_receiving_score",
    "arrival_receiving_q",
    "approach_prep_score",
    "approach_prep_q",
    "placement_score",
    "placement_q",
    "strike_output_score",
    "strike_output_q",
    "strike_quality_score",
    "strike_quality_q",
    "strike_quality_band",
    "decision_quality_score",
    "decision_quality_q",
    "decision_quality_band",
    "carry_progression_score",
    "carry_progression_q",
    "carry_progression_band",
    "P1_score",
    "P1_q",
    "P2_score",
    "P2_q",
    "P3_score",
    "P3_q",
    "P4_score",
    "P4_q",
    "P4_mech_score",
    "P4_mech_q",
    "P4_strike_score",
    "P4_strike_q",
    "P5_score",
    "P5_q",
    "P6_score",
    "P6_q",
)
PHASE_OFFSETS = {
    "P1": (-125, -51, "context"),
    "P2": (-50, -14, "approach"),
    "P3": (-13, -2, "backswing_loading"),
    "P4": (-2, 2, "impact"),
    "P5": (2, 25, "follow_through"),
    "P6": (25, 75, "ball_flight_outcome"),
}
PHASE_SCORE_COLUMNS = tuple(
    field
    for phase in PHASE_OFFSETS
    for field in (f"{phase}_score", f"{phase}_q")
) + tuple(
    field
    for phase in PHASE_OFFSETS
    for field in (f"phase_{phase}_start", f"phase_{phase}_end", f"phase_{phase}_available")
)
MODULE_FEATURE_DECLARATIONS: tuple[dict[str, str], ...] = (
    {"feature": "shoulder_hip_score", "module": "technique", "phase": "P3", "frame_role": "biomech", "reducer": "mean"},
    {"feature": "knee_stability_score", "module": "technique", "phase": "P3", "frame_role": "biomech", "reducer": "mean"},
    {"feature": "knee_peak_angular_velocity_score", "module": "technique", "phase": "P3", "frame_role": "loading", "reducer": "peak"},
    {"feature": "non_kicking_arm_abduction_score", "module": "technique", "phase": "P3", "frame_role": "loading", "reducer": "peak"},
    {"feature": "foot_peak_velocity_score", "module": "technique", "phase": "P4", "frame_role": "contact", "reducer": "peak"},
    {"feature": "contact_near_ankle_score", "module": "technique", "phase": "P4", "frame_role": "visual_contact", "reducer": "peak"},
    {"feature": "foot_velocity_into_ball_score", "module": "technique", "phase": "P4", "frame_role": "contact", "reducer": "peak"},
    {"feature": "foot_path_stability", "module": "technique", "phase": "P4", "frame_role": "contact", "reducer": "mean"},
    {"feature": "proximal_distal_sequencing_score", "module": "technique", "phase": "P4", "frame_role": "contact", "reducer": "peak"},
    {"feature": "com_continuation_score", "module": "technique", "phase": "P5", "frame_role": "follow_through", "reducer": "mean"},
    {"feature": "post_impact_balance_score", "module": "technique", "phase": "P5", "frame_role": "follow_through", "reducer": "mean"},
    {"feature": "distance_score", "module": "positioning", "phase": "P1", "frame_role": "event", "reducer": "first"},
    {"feature": "angle_score", "module": "positioning", "phase": "P1", "frame_role": "event", "reducer": "first"},
    {"feature": "pressure_score", "module": "positioning", "phase": "P1", "frame_role": "event", "reducer": "first"},
    {"feature": "defenders_lane_score", "module": "positioning", "phase": "P1", "frame_role": "event", "reducer": "first"},
    {"feature": "keeper_proxy_score", "module": "positioning", "phase": "P1", "frame_role": "event", "reducer": "first"},
    {"feature": "previous_event_type_score", "module": "receiving_pressure", "phase": "P1", "frame_role": "event_context", "reducer": "last"},
    {"feature": "receiver_is_shooter_score", "module": "receiving_pressure", "phase": "P1", "frame_role": "event_context", "reducer": "last"},
    {"feature": "time_to_shot_score", "module": "receiving_pressure", "phase": "P2", "frame_role": "event_context", "reducer": "last"},
    {"feature": "reception_pressure_score", "module": "receiving_pressure", "phase": "P2", "frame_role": "event_context", "reducer": "last"},
    {"feature": "initial_goal_alignment_score", "module": "placement", "phase": "P6", "frame_role": "physics_exit", "reducer": "first"},
    {"feature": "kpi_outcome_score", "module": "placement", "phase": "P6", "frame_role": "event", "reducer": "last"},
    {"feature": "exit_speed_score", "module": "strike_output", "phase": "P6", "frame_role": "physics_exit", "reducer": "peak"},
    {"feature": "launch_angle_score", "module": "strike_output", "phase": "P6", "frame_role": "physics_exit", "reducer": "first"},
    {"feature": "position_delta_jump_score", "module": "strike_output", "phase": "P4", "frame_role": "contact", "reducer": "peak"},
    {"feature": "trajectory_flatness_score", "module": "strike_output", "phase": "P6", "frame_role": "physics_exit", "reducer": "mean"},
)
CONTACT_CANDIDATE_FIELDS = (
    "event_id",
    "match_folder",
    "candidate_rank",
    "candidate_frame",
    "frame_offset",
    "inferred_foot",
    "nearest_part",
    "foot_ball_distance_m",
    "ball_speed_m_s",
    "previous_ball_speed_m_s",
    "velocity_jump_m_s",
    "position_delta_speed_m_s",
    "previous_position_delta_speed_m_s",
    "position_delta_jump_m_s",
    "parquet_ball_speed_m_s",
    "previous_parquet_ball_speed_m_s",
    "parquet_velocity_jump_m_s",
    "distance_cost",
    "anchor_cost",
    "jump_credit",
    "total_contact_cost",
    "top1_top2_cost_gap",
    "selected",
    "selected_by",
)

@dataclass(frozen=True)
class RawShotInfo:
    event_id: str
    type_of_shot: str | None = None
    extended_type_of_shot: str | None = None
    taker_ball_control: str | None = None
    outcome_tag: str | None = None
    assist_action: str | None = None
    build_up: str | None = None
    shot_foot: str | None = None


@dataclass(frozen=True)
class ShotEvent:
    event_id: str
    match_folder: str
    team_id: str
    player_id: str
    section: str
    synced_frame_id: int
    skeleton_frame: int
    x: float
    y: float
    distance_to_goal: float
    angle_to_goal: float
    pressure: float
    xg: float
    shot_result: str | None
    is_penalty: bool = False
    is_free_kick: bool = False
    is_corner: bool = False
    num_defenders_in_lane: int | None = None
    keeper_distance_to_goal: float | None = None
    keeper_x: float | None = None
    keeper_y: float | None = None
    type_of_shot: str | None = None
    extended_type_of_shot: str | None = None
    taker_ball_control: str | None = None
    outcome_tag: str | None = None
    assist_action: str | None = None
    build_up: str | None = None
    shot_foot: str | None = None
    player_name: str | None = None
    team_name: str | None = None
    player_parquet_key: tuple[int, int] | None = None
    ball_height_m: float | None = None
    family: str | None = None

    def with_updates(self, **kwargs: Any) -> "ShotEvent":
        return replace(self, **kwargs)


def parse_raw_shot_xml(xml_text: str) -> dict[str, RawShotInfo]:
    root = ET.fromstring(xml_text)
    rows: dict[str, RawShotInfo] = {}
    for event_el in root.iter("Event"):
        event_id = event_el.get("EventId")
        if not event_id:
            continue
        shot_el = next((child for child in event_el.iter("ShotAtGoal")), None)
        if shot_el is None:
            continue
        outcome_tag = next((child.tag for child in shot_el if child.tag != "Play"), None)
        type_of_shot = shot_el.get("TypeOfShot")
        rows[event_id] = RawShotInfo(
            event_id=event_id,
            type_of_shot=type_of_shot,
            extended_type_of_shot=shot_el.get("ExtendedTypeOfShot"),
            taker_ball_control=shot_el.get("TakerBallControl"),
            outcome_tag=outcome_tag,
            assist_action=shot_el.get("AssistAction"),
            build_up=shot_el.get("BuildUp"),
            shot_foot=_foot_from_text(type_of_shot),
        )
    return rows


def parse_kpi_shots_xml(xml_text: str, raw_by_event: dict[str, RawShotInfo] | None = None, *, context=None) -> list[ShotEvent]:
    root = ET.fromstring(xml_text)
    shots: list[ShotEvent] = []
    for el in root.iter("ShotAtGoal"):
        if not _is_true(el.get("SyncSuccessful")):
            continue
        synced = _optional_int(el.get("SyncedFrameId"))
        if synced is None:
            continue
        section = _normalize_section(el.get("InGameSection") or el.get("GameSection"))
        skeleton_frame = kpi_to_skeleton_frame(context, synced, section) if context is not None else synced
        event_id = _required(el, "EventId")
        raw = (raw_by_event or {}).get(event_id, RawShotInfo(event_id))
        shot = ShotEvent(
            event_id=event_id,
            match_folder=getattr(context, "match_folder", ""),
            team_id=_required(el, "TeamId"),
            player_id=_required(el, "PlayerId"),
            section=section,
            synced_frame_id=synced,
            skeleton_frame=skeleton_frame,
            x=_float_attr(el, "X-Position"),
            y=_float_attr(el, "Y-Position"),
            distance_to_goal=_float_attr(el, "DistanceToGoal", default=_distance_to_goal_from_xy(_float_attr(el, "X-Position"), _float_attr(el, "Y-Position"))),
            angle_to_goal=_float_attr(el, "AngleToGoal", default=0.0),
            pressure=_float_attr(el, "PressureOnPlayer", default=_float_attr(el, "Pressure", default=0.0)),
            xg=_float_attr(el, "xG", default=0.0),
            shot_result=el.get("ShotResult"),
            is_penalty=_is_true(el.get("IsPenalty")),
            is_free_kick=_is_true(el.get("IsFreeKick")),
            is_corner=_is_true(el.get("IsCorner")),
            num_defenders_in_lane=_optional_int(el.get("NumDefendersInShotLane")),
            keeper_distance_to_goal=_optional_float(el.get("DistanceGoalkeeperToGoal")),
            keeper_x=_optional_float(el.get("X-PositionGoalkeeper")),
            keeper_y=_optional_float(el.get("Y-PositionGoalkeeper")),
            type_of_shot=raw.type_of_shot,
            extended_type_of_shot=raw.extended_type_of_shot,
            taker_ball_control=raw.taker_ball_control,
            outcome_tag=raw.outcome_tag,
            assist_action=raw.assist_action,
            build_up=raw.build_up,
            shot_foot=raw.shot_foot,
        )
        shots.append(shot.with_updates(family=classify_shot_family(shot)))
    return shots


def classify_shot_family(shot: ShotEvent) -> str:
    text = " ".join(
        value or ""
        for value in [shot.type_of_shot, shot.extended_type_of_shot, shot.taker_ball_control, shot.assist_action, shot.build_up]
    ).lower()
    if shot.is_penalty or shot.is_free_kick or shot.is_corner or "setpiece" in text or "free" in text or "penalty" in text:
        return "dead_ball"
    if "header" in text or "head" in text:
        return "header"
    if "volley" in text or (shot.ball_height_m is not None and shot.ball_height_m > 0.4):
        return "volley"
    if shot.distance_to_goal > 22:
        return "long_range"
    if "cutback" in text or ("cross" in text and abs(shot.y) > 12):
        return "cutback"
    if _is_real_one_v_one(shot):
        return "oneV"
    return "open_play"


def resolve_shot_family(shot: ShotEvent, router: dict[str, Any] | None = None) -> str:
    router = router or {}
    previous = str(router.get("previous_event_type") or router.get("previous_play_type") or "").lower()
    carry_player = router.get("previous_carry_player_id")
    carry_distance = _num(router.get("previous_carry_distance_m"), math.nan)
    carry_gap = _num(router.get("time_from_previous_carry_end_s"), math.nan)
    if (
        "carry" in previous
        and (carry_player is None or carry_player == shot.player_id)
        and (math.isnan(carry_distance) or carry_distance >= 3.0)
        and (math.isnan(carry_gap) or carry_gap <= 4.0)
    ):
        return "carry_self_created"
    if shot.family in P1_FAMILY_WEIGHTS:
        return shot.family
    return classify_shot_family(shot)


def _is_real_one_v_one(shot: ShotEvent) -> bool:
    if shot.distance_to_goal > 18 and shot.angle_to_goal < 25:
        return False
    if shot.num_defenders_in_lane is None or shot.num_defenders_in_lane > 0:
        return False
    if shot.keeper_distance_to_goal is not None and shot.keeper_distance_to_goal < 0.5:
        return False
    return shot.distance_to_goal <= 18 and shot.angle_to_goal >= 20


def lin_high(value: float, lo: float, hi: float) -> float:
    try:
        value = float(value)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(value) or hi == lo:
        return 0.0
    return _clamp((value - lo) / (hi - lo))


def lin_low(value: float, best: float, worst: float) -> float:
    try:
        value = float(value)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(value) or worst == best:
        return 0.0
    return _clamp(1.0 - (value - best) / (worst - best))


def soft_band(value: float, lo: float, hi: float, margin_lo: float, margin_hi: float) -> float:
    try:
        value = float(value)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(value):
        return 0.0
    if lo <= value <= hi:
        return 1.0
    if value < lo:
        return _clamp(1.0 - (lo - value) / margin_lo) if margin_lo > 0 else 0.0
    return _clamp(1.0 - (value - hi) / margin_hi) if margin_hi > 0 else 0.0


def _score_or_nan(value: float, scorer: Any) -> float:
    value = _num(value, math.nan)
    return scorer(value) if not math.isnan(value) else math.nan


def _knee_peak_angular_velocity_score(dps: float) -> float:
    return _score_or_nan(dps, lambda value: lin_high(value, 800.0, 1600.0))


def _knee_peak_dps_score(dps: float) -> float:
    return _knee_peak_angular_velocity_score(dps)


def _foot_peak_velocity_score(m_s: float) -> float:
    # CALIBRATION: provisional, derived from Bayern_Hamburg n=30. The 50 Hz
    # skeleton feed under-samples the true lab foot-speed peak, so the field
    # tracking score saturates at 20 m/s rather than the lab-style 22 m/s.
    return _score_or_nan(m_s, lambda value: lin_high(value, 10.0, 20.0))


def _non_kicking_arm_abduction_score(deg: float) -> float:
    return _score_or_nan(deg, lambda value: soft_band(value, 90.0, 160.0, 30.0, 20.0))


def _arm_abduction_score(deg: float) -> float:
    return _non_kicking_arm_abduction_score(deg)


def angle_error_deg(a: float, b: float) -> float:
    return abs(((float(a) - float(b) + 180.0) % 360.0) - 180.0)


def weighted_mean_available(items: list[tuple[float, float, bool]] | tuple[tuple[float, float, bool], ...], neutral: float = 0.5) -> float:
    clean = []
    for score, weight, available in items:
        if not available or weight <= 0:
            continue
        try:
            value = float(score)
        except (TypeError, ValueError):
            continue
        if math.isnan(value):
            continue
        clean.append((_clamp(value), float(weight)))
    if not clean:
        return neutral
    total_weight = sum(weight for _score, weight in clean)
    return sum(score * weight for score, weight in clean) / total_weight if total_weight else neutral


def compute_tracking_features(shot: ShotEvent, frames: list[SkeletonFrame], *, frame_rate: int = 50) -> dict[str, Any]:
    frames = sorted(frames, key=lambda f: f.frame_number)
    player_key = shot.player_parquet_key
    if not frames or player_key is None:
        return _empty_tracking_features(shot)
    candidates = compute_contact_candidates(shot, frames, limit=None, frame_rate=frame_rate)
    if not candidates:
        return _empty_tracking_features(shot)
    contact = candidates[0]
    contact_index = int(contact["frame_index"])
    contact_frame = frames[contact_index]
    physics_exit = _physics_exit_candidate(candidates, contact_index)
    physics_exit_index = int(physics_exit["frame_index"])
    physics_exit_frame = frames[physics_exit_index]
    # The IMPACT frame (selected via decisive jump or cost) is where the ball
    # gets struck. At 50 Hz the kicking foot has often already swung 0.6-1.0 m
    # past the ball by the first post-impact frame. Body-mechanics features
    # (contact-near-ankle, plant offsets, knee/torso geometry) should be read
    # at the moment the foot was closest to the ball within +/- 3 frames of
    # impact, otherwise we underrate every shot that registered a clean
    # velocity jump.
    biomech_index = _biomech_frame_index(candidates, contact_index)
    biomech = candidates[next(i for i, row in enumerate(candidates) if row["frame_index"] == biomech_index)]
    biomech_frame = frames[biomech_index]
    biomech_player = biomech_frame.players.get(player_key, {})
    biomech_ball = biomech_frame.ball
    foot = biomech["inferred_foot"] or contact["inferred_foot"]
    plant = "left" if foot == "right" else "right"
    plant_ankle = biomech_player.get(f"{plant}_ankle") if plant else None
    exit_speed = float(physics_exit["position_delta_speed_m_s"])
    parquet_exit_speed = _max_after_speed(frames, contact_index, horizon=3)
    biomech_min_dist = float(biomech["min_foot_ball_distance_m"])
    approach = _approach_features(shot, frames, contact_index, frame_rate=frame_rate)
    flight = _flight_features(shot, frames, contact_index, physics_exit_index, frame_rate=frame_rate)
    foot_kinematics = _foot_kinematic_features(frames, player_key, foot, contact_index, physics_exit_index, exit_speed, frame_rate=frame_rate)
    biomech_shoulder_hip = _axis_separation(biomech_player)
    peak_shoulder_hip, peak_frame, peak_offset = _peak_shoulder_hip_separation(frames, player_key, contact_frame.frame_number)
    shoulder_hip = peak_shoulder_hip if not math.isnan(peak_shoulder_hip) else biomech_shoulder_hip
    follow_through = _follow_through_features(frames, player_key, foot, contact_frame.frame_number, physics_exit_index, frame_rate=frame_rate)
    shot_unit = _shot_direction_unit(shot, frames, contact_index, physics_exit_index, biomech_ball, frame_rate=frame_rate)
    stability = _plant_stability_features(frames, player_key, plant, contact_frame.frame_number, shot_unit=shot_unit)
    ankle = _ankle_rigidity_features(frames, player_key, foot, contact_index)
    sequencing = _proximal_distal_features(frames, player_key, foot, contact_frame.frame_number, frame_rate=frame_rate)
    arm = _non_kicking_arm_abduction(frames, player_key, foot, contact_frame.frame_number)
    header = _header_features(frames, player_key, contact_index, frame_rate=frame_rate)
    return {
        "contact_frame": contact_frame.frame_number,
        "contact_frame_offset": contact_frame.frame_number - shot.skeleton_frame,
        "physics_exit_frame": physics_exit_frame.frame_number,
        "physics_exit_frame_offset": physics_exit_frame.frame_number - shot.skeleton_frame,
        "biomech_frame": biomech_frame.frame_number,
        "biomech_frame_offset": biomech_frame.frame_number - shot.skeleton_frame,
        "inferred_foot": foot,
        "plant_foot": plant,
        "shot_direction_x": shot_unit[0] if shot_unit is not None else math.nan,
        "shot_direction_y": shot_unit[1] if shot_unit is not None else math.nan,
        "min_foot_ball_distance_m": biomech_min_dist,
        "ball_z_at_contact": biomech_ball.z if biomech_ball else math.nan,
        "ball_exit_speed_m_s": exit_speed,
        "launch_angle_deg": _position_delta_launch_angle(frames, physics_exit_index, frame_rate=frame_rate),
        "position_delta_speed_m_s": contact["position_delta_speed_m_s"],
        "previous_position_delta_speed_m_s": contact["previous_position_delta_speed_m_s"],
        "position_delta_jump_m_s": contact["position_delta_jump_m_s"],
        "parquet_ball_speed_m_s": contact["parquet_ball_speed_m_s"],
        "previous_parquet_ball_speed_m_s": contact["previous_parquet_ball_speed_m_s"],
        "parquet_velocity_jump_m_s": contact["parquet_velocity_jump_m_s"],
        "parquet_exit_speed_m_s": parquet_exit_speed,
        "contact_near_ankle_score": _contact_near_score(biomech_min_dist),
        "plant_foot_forward_offset_m": (plant_ankle.x - biomech_ball.x) if plant_ankle and biomech_ball else math.nan,
        "plant_foot_lateral_offset_m": (plant_ankle.y - biomech_ball.y) if plant_ankle and biomech_ball else math.nan,
        "foot_path_stability": _foot_path_stability(frames, player_key, foot, contact_index),
        "shoulder_hip_separation_deg": shoulder_hip,
        "biomech_shoulder_hip_separation_deg": biomech_shoulder_hip,
        "peak_shoulder_hip_separation_deg": peak_shoulder_hip,
        "peak_shoulder_hip_frame": peak_frame,
        "peak_shoulder_hip_frame_offset": peak_offset,
        "torso_lean_deg": _torso_lean(biomech_player),
        # q_contact uses the biomech frame's foot proximity so that a clean
        # 50 Hz follow-through does not falsely zero out body confidence.
        "q_contact": biomech["q_contact"],
        "q_foot": biomech["q_foot"],
        # q_sync now represents match/half KPI->parquet mapping confidence,
        # NOT frame anchoring (that is q_anchor's job).
        "q_sync": _sync_confidence(shot, has_tracking=True),
        "q_anchor": contact["q_anchor"],
        "q_candidate": contact["q_candidate"],
        "q_occlusion": _clamp(len(biomech_player) / 15.0),
        **approach,
        **flight,
        **foot_kinematics,
        **follow_through,
        **stability,
        "knee_stability_score": _num(stability.get("knee_stability_score"), _knee_stability(biomech_player, foot)),
        **ankle,
        **sequencing,
        "knee_peak_angular_velocity_score": _knee_peak_angular_velocity_score(sequencing.get("knee_peak_angular_velocity_dps")),
        "foot_peak_velocity_score": _foot_peak_velocity_score(sequencing.get("foot_peak_velocity_at_contact")),
        "non_kicking_arm_abduction_score": _non_kicking_arm_abduction_score(arm.get("non_kicking_arm_abduction_deg")),
        **arm,
        **header,
    }


def _biomech_frame_index(candidates: list[dict[str, Any]], impact_index: int, *, radius: int = 3) -> int:
    """Within +/- radius frames of the impact frame, return the index of the
    frame where the kicking foot was closest to the ball. Falls back to the
    impact frame itself if no candidate sits inside the radius."""
    pool = [row for row in candidates if abs(int(row["frame_index"]) - impact_index) <= radius]
    if not pool:
        return impact_index
    best = min(pool, key=lambda row: row["min_foot_ball_distance_m"])
    return int(best["frame_index"])


def _physics_exit_candidate(candidates: list[dict[str, Any]], contact_index: int, *, horizon: int = 3) -> dict[str, Any]:
    pool = [row for row in candidates if contact_index <= int(row["frame_index"]) <= contact_index + horizon]
    if not pool:
        return candidates[0]
    return max(pool, key=lambda row: float(row.get("position_delta_speed_m_s") or 0.0))


def _approach_features(shot: ShotEvent, frames: list[SkeletonFrame], contact_index: int, *, frame_rate: int) -> dict[str, Any]:
    player_key = shot.player_parquet_key
    if player_key is None:
        return _empty_approach_features()
    impact = frames[contact_index].frame_number
    p2_start = impact + PHASE_OFFSETS["P2"][0]
    p2_end = impact + PHASE_OFFSETS["P2"][1]
    p2 = [frame for frame in frames if p2_start <= frame.frame_number <= p2_end and frame.players.get(player_key)]
    if not p2:
        return _empty_approach_features()

    pelvis_points = [(frame, frame.players.get(player_key, {}).get("pelvis")) for frame in p2]
    pelvis_points = [(frame, point) for frame, point in pelvis_points if point is not None]
    ball_points = [(frame, frame.ball) for frame in p2 if frame.ball is not None]
    speeds = []
    for (prev_frame, prev_point), (frame, point) in zip(pelvis_points, pelvis_points[1:]):
        dt_frames = max(1, frame.frame_number - prev_frame.frame_number)
        speeds.append(_distance(point, prev_point) * frame_rate / dt_frames)
    approach_speed = _median(speeds)

    approach_angle = math.nan
    if len(pelvis_points) >= 2:
        start = pelvis_points[0][1]
        end = pelvis_points[-1][1]
        move = (end.x - start.x, end.y - start.y)
        ref_ball = ball_points[-1][1] if ball_points else frames[contact_index].ball
        if ref_ball is not None:
            target = _goal_vector_from_point(shot, ref_ball)
            approach_angle = angle_error_deg(math.degrees(math.atan2(move[1], move[0])), math.degrees(math.atan2(target[1], target[0])))

    prep_frame = _nearest_frame(frames, impact - 14)
    prep_player = prep_frame.players.get(player_key, {}) if prep_frame else {}
    prep_pelvis = prep_player.get("pelvis")
    prep_ball = prep_frame.ball if prep_frame else None
    prep_forward = math.nan
    prep_lateral = math.nan
    if prep_pelvis is not None and prep_ball is not None:
        target = _normalize2(_goal_vector_from_point(shot, prep_ball))
        lateral = (-target[1], target[0])
        ball_from_pelvis = (prep_ball.x - prep_pelvis.x, prep_ball.y - prep_pelvis.y)
        prep_forward = _dot2(ball_from_pelvis, target)
        prep_lateral = _dot2(ball_from_pelvis, lateral)

    convergence = math.nan
    if len(pelvis_points) >= 2 and len(ball_points) >= 2:
        start_dist = _distance_xy(pelvis_points[0][1], ball_points[0][1])
        end_dist = _distance_xy(pelvis_points[-1][1], ball_points[-1][1])
        convergence = 0.5 * lin_high(start_dist - end_dist, 0.2, 2.0) + 0.5 * soft_band(end_dist, 0.35, 1.8, 0.3, 1.0)

    trunk_values = []
    readiness_values = []
    for frame in p2:
        player = frame.players.get(player_key, {})
        lean = _torso_lean(player)
        if not math.isnan(lean):
            trunk_values.append(lean)
        if frame.ball is not None:
            ready = _body_ball_readiness(player, frame.ball, shot)
            if not math.isnan(ready):
                readiness_values.append(ready)
    trunk_lean = _median(trunk_values)
    readiness = _median(readiness_values)
    stride = math.nan
    if len(speeds) >= 3:
        mean_speed = sum(speeds) / len(speeds)
        stride = 0.5 if mean_speed <= 0 else _clamp(1.0 - (_std(speeds) / mean_speed) / 0.6)

    return {
        "p2_frame_count": len(p2),
        "approach_speed_m_s": approach_speed,
        "approach_angle_deg": approach_angle,
        "prep_ball_forward_m": prep_forward,
        "prep_ball_lateral_m": prep_lateral,
        "ball_shooter_convergence_score": convergence,
        "trunk_lean_approach_deg": trunk_lean,
        "stride_smoothness_score": stride,
        "body_ball_readiness_score": readiness,
    }


def _flight_features(shot: ShotEvent, frames: list[SkeletonFrame], contact_index: int, physics_exit_index: int, *, frame_rate: int) -> dict[str, Any]:
    velocities: list[Vec3] = []
    for index in range(contact_index + 1, min(len(frames), contact_index + 6)):
        velocity = _position_delta_velocity(frames, index, frame_rate=frame_rate)
        if velocity is not None:
            velocities.append(velocity)
    if not velocities:
        velocity = _position_delta_velocity(frames, physics_exit_index, frame_rate=frame_rate)
        if velocity is not None:
            velocities.append(velocity)
    if velocities:
        v0 = Vec3(_median([v.x for v in velocities]), _median([v.y for v in velocities]), _median([v.z for v in velocities]))
        speed = _vec_norm(v0)
        launch_angle = math.degrees(math.atan2(v0.z, math.hypot(v0.x, v0.y)))
    else:
        v0 = None
        speed = math.nan
        launch_angle = math.nan

    p0 = frames[physics_exit_index].ball or frames[contact_index].ball
    goal_y = math.nan
    goal_z = math.nan
    alignment_deg = math.nan
    if v0 is not None and p0 is not None:
        target = _goal_vector_from_point(shot, p0)
        alignment_deg = angle_error_deg(math.degrees(math.atan2(v0.y, v0.x)), math.degrees(math.atan2(target[1], target[0])))
        goal_x = _goal_x(shot)
        if (goal_x - p0.x) * v0.x > 0:
            t_goal = (goal_x - p0.x) / v0.x
            goal_y = p0.y + v0.y * t_goal
            goal_z = p0.z + v0.z * t_goal - 0.5 * 9.81 * t_goal * t_goal

    flight_ball_frames = [frame for frame in frames[contact_index + 1 : min(len(frames), contact_index + 76)] if frame.ball is not None]
    flatness = _trajectory_flatness(flight_ball_frames)
    blocked = _blocked_flight(flight_ball_frames, frame_rate=frame_rate)
    family = shot.family if shot.family in P6_FAMILY_WEIGHTS else classify_shot_family(shot)
    alignment_score = math.exp(-0.5 * (alignment_deg / 18.0) ** 2) if not math.isnan(alignment_deg) else math.nan
    return {
        "initial_ball_velocity_x_m_s": v0.x if v0 else math.nan,
        "initial_ball_velocity_y_m_s": v0.y if v0 else math.nan,
        "initial_ball_velocity_z_m_s": v0.z if v0 else math.nan,
        "initial_ball_speed_m_s": speed,
        "initial_goal_alignment_deg": alignment_deg,
        "initial_goal_alignment_score": alignment_score,
        "goal_plane_y_m": goal_y,
        "goal_plane_z_m": goal_z,
        "goal_plane_lateral_score": _goal_lateral_score(goal_y),
        "goal_plane_vertical_score": _goal_vertical_score(family, goal_z),
        "trajectory_flatness_score": flatness,
        "blocked_flight_flag": blocked,
        "p6_flight_frame_count": len(flight_ball_frames),
    }


def _shot_direction_unit(
    shot: ShotEvent,
    frames: list[SkeletonFrame],
    contact_index: int,
    physics_exit_index: int,
    fallback_point: Vec3 | None,
    *,
    frame_rate: int,
) -> tuple[float, float] | None:
    for index in (physics_exit_index, contact_index):
        velocity = _position_delta_velocity(frames, index, frame_rate=frame_rate)
        if velocity is not None and math.hypot(velocity.x, velocity.y) > 1e-6:
            return _normalize2((velocity.x, velocity.y))
        if 0 <= index < len(frames):
            parquet_velocity = frames[index].ball_velocity
            if parquet_velocity is not None and math.hypot(parquet_velocity.x, parquet_velocity.y) > 1e-6:
                return _normalize2((parquet_velocity.x, parquet_velocity.y))
    if fallback_point is not None:
        return _normalize2(_goal_vector_from_point(shot, fallback_point))
    return None


def _foot_kinematic_features(
    frames: list[SkeletonFrame],
    player_key: tuple[int, int],
    foot: str | None,
    contact_index: int,
    physics_exit_index: int,
    exit_speed: float,
    *,
    frame_rate: int,
) -> dict[str, Any]:
    if foot is None or contact_index <= 0 or contact_index >= len(frames):
        return _empty_foot_kinematic_features()
    part_name = f"{foot}_ankle"
    current = frames[contact_index].players.get(player_key, {}).get(part_name)
    previous = frames[contact_index - 1].players.get(player_key, {}).get(part_name)
    if current is None or previous is None:
        return _empty_foot_kinematic_features()
    dt_frames = max(1, frames[contact_index].frame_number - frames[contact_index - 1].frame_number)
    foot_velocity = Vec3(
        (current.x - previous.x) * frame_rate / dt_frames,
        (current.y - previous.y) * frame_rate / dt_frames,
        (current.z - previous.z) * frame_rate / dt_frames,
    )
    ball_velocity = _position_delta_velocity(frames, physics_exit_index, frame_rate=frame_rate)
    if ball_velocity is None:
        ball_velocity = _position_delta_velocity(frames, contact_index, frame_rate=frame_rate)
    ball_direction = _normalize3(ball_velocity)
    foot_speed = _vec_norm(foot_velocity)
    into_ball = max(0.0, _dot3(foot_velocity, ball_direction)) if ball_direction is not None else math.nan
    ratio = exit_speed / foot_speed if foot_speed > 0 else math.nan
    return {
        "foot_velocity_into_ball_m_s": into_ball,
        "foot_speed_m_s": foot_speed,
        "foot_velocity_into_ball_score": lin_high(into_ball, 2.0, 12.0) if not math.isnan(into_ball) else math.nan,
        "ball_to_foot_speed_ratio": ratio,
        "ball_to_foot_speed_ratio_score": _ball_to_foot_ratio_score(ratio, foot_speed=foot_speed),
    }


def compute_component_scores(shot: ShotEvent, features: dict[str, Any]) -> dict[str, float]:
    detail = {
        "D_distance": _linear_low_good(shot.distance_to_goal, 6, 28),
        "D_angle": _linear_high_good(shot.angle_to_goal, 5, 45),
        "D_lane": _linear_low_good(float(shot.num_defenders_in_lane or 0), 0, 5),
        "D_pressure": _linear_low_good(shot.pressure, 0, 3),
        "D_keeper_proxy": _linear_high_good(float(shot.keeper_distance_to_goal or 0), 0, 8),
        "T_sync": _linear_low_good(abs(_num(features.get("contact_frame_offset"), 0.0)), 0, 20),
        "T_foot_path": _linear_high_good(_num(features.get("foot_path_stability"), 0.5), 0, 1),
        "T_torso": _torso_extreme_score(_num(features.get("torso_lean_deg"), 10.0)),
        "B_shoulder_hip": _linear_high_good(_num(features.get("shoulder_hip_separation_deg"), 0.0), 0, 45),
        "B_torso_lean": _torso_extreme_score(_num(features.get("torso_lean_deg"), 20.0)),
        "B_knee_stability": _num(features.get("knee_stability_score"), 0.5),
        "C_contact_near_ankle": _num(features.get("contact_near_ankle_score"), 0.3),
        "C_plant_forward": _linear_low_good(abs(_num(features.get("plant_foot_forward_offset_m"), 0.2)), 0, 0.8),
        "C_plant_lateral": _linear_low_good(abs(_num(features.get("plant_foot_lateral_offset_m"), 0.2)), 0, 0.8),
        "C_foot_path_stability": _num(features.get("foot_path_stability"), 0.5),
        "V_exit_speed": _linear_high_good(_num(features.get("ball_exit_speed_m_s"), 0.0), 8, 28),
        "V_launch_angle": _linear_low_good(abs(_num(features.get("launch_angle_deg"), 10.0)), 0, 35),
    }
    detail["D_keeper"] = detail["D_keeper_proxy"]
    detail["B_torso"] = detail["B_torso_lean"]
    detail["B_knee"] = detail["B_knee_stability"]
    detail["C_foot_path"] = detail["C_foot_path_stability"]
    return {
        "D": _mean_score(detail["D_distance"], detail["D_angle"], detail["D_lane"], detail["D_pressure"], detail["D_keeper_proxy"]),
        "T": _mean_score(detail["T_sync"], detail["T_foot_path"], detail["T_torso"]),
        "B": _mean_score(detail["B_shoulder_hip"], detail["B_torso_lean"], detail["B_knee_stability"]),
        "C": _mean_score(detail["C_contact_near_ankle"], detail["C_plant_forward"], detail["C_plant_lateral"], detail["C_foot_path_stability"]),
        "V": _mean_score(detail["V_exit_speed"], detail["V_launch_angle"]),
        **detail,
    }


def score_components(family: str, components: dict[str, float], *, q: float, pressure: float = 0.0, keeper_opt: float = 0.0) -> dict[str, float | str]:
    weights = FAMILY_WEIGHTS[family]
    s = {k: _clamp(float(components.get(k, 0.0))) for k in COMPONENTS}
    q = _clamp(q)
    add = sum(weights[k] * s[k] for k in COMPONENTS)
    bot = sum(weights[k] * max(0.05, s[k]) ** -4 for k in COMPONENTS) ** (-1 / 4)
    gate = math.prod(max(0.05, s[k]) ** weights[k] for k in COMPONENTS)
    weakest = min(COMPONENTS, key=lambda k: s[k])
    r_exec = _clamp(0.25 + 0.30 * (1 - s["D"]) + 0.20 * pressure + 0.15 * keeper_opt + (0.10 if family == "long_range" else 0.0), 0.20, 0.90)
    bio = 0.45 * s["B"] + 0.35 * s["C"] + 0.20 * s["V"]
    return {
        "additive_score": 100 * q * add,
        "bottleneck_score": 100 * q * bot,
        "gate_score": 100 * q * gate,
        "ear_score": 50 + 45 * math.tanh((bio - r_exec) / 0.25),
        "weakest_constraint": weakest,
        "R_exec": r_exec,
        "bio_execution": bio,
    }


def compute_phase_windows(
    impact_frame: int | None,
    *,
    min_frame: int | None = None,
    max_frame: int | None = None,
) -> dict[str, dict[str, Any]]:
    if impact_frame is None:
        return {
            phase: {"start": None, "end": None, "available": False, "frame_role": role}
            for phase, (_start_offset, _end_offset, role) in PHASE_OFFSETS.items()
        }
    windows: dict[str, dict[str, Any]] = {}
    for phase, (start_offset, end_offset, role) in PHASE_OFFSETS.items():
        start = int(impact_frame) + start_offset
        end = int(impact_frame) + end_offset
        if min_frame is not None:
            start = max(start, int(min_frame))
        if max_frame is not None:
            end = min(end, int(max_frame))
        windows[phase] = {
            "start": start,
            "end": end,
            "available": start <= end,
            "frame_role": role,
        }
    return windows


def phase_window_columns(phases: dict[str, dict[str, Any]]) -> dict[str, Any]:
    rows: dict[str, Any] = {}
    for phase in PHASE_OFFSETS:
        window = phases.get(phase, {})
        rows[f"phase_{phase}_start"] = window.get("start")
        rows[f"phase_{phase}_end"] = window.get("end")
        rows[f"phase_{phase}_available"] = bool(window.get("available"))
    return rows


def reduce_phase_values(values: list[float] | tuple[float, ...], reducer: str, *, static_flags: list[bool] | tuple[bool, ...] | None = None) -> float:
    paired = []
    for index, value in enumerate(values):
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if math.isnan(number):
            continue
        is_static = bool(static_flags[index]) if static_flags is not None and index < len(static_flags) else False
        paired.append((number, is_static))
    if not paired:
        return math.nan
    clean = [value for value, _is_static in paired]
    if reducer == "mean":
        return sum(clean) / len(clean)
    if reducer == "median":
        ordered = sorted(clean)
        mid = len(ordered) // 2
        return ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2
    if reducer == "min":
        return min(clean)
    if reducer == "max":
        return max(clean)
    if reducer == "first":
        return clean[0]
    if reducer == "last":
        return clean[-1]
    if reducer == "peak":
        return max(clean, key=lambda value: abs(value))
    if reducer == "first_static_plant":
        for value, is_static in paired:
            if is_static:
                return value
        return clean[0]
    raise ValueError(f"Unknown reducer: {reducer}")


def _score_p1(shot: ShotEvent, features: dict[str, Any], router: dict[str, Any], family: str) -> dict[str, Any]:
    distance = lin_low(shot.distance_to_goal, 6, 30)
    angle = lin_high(shot.angle_to_goal, 5, 45)
    pressure = lin_low(shot.pressure, 0, 3)
    lane_available = shot.num_defenders_in_lane is not None
    lane = lin_low(float(shot.num_defenders_in_lane), 0, 5) if lane_available else 0.5
    keeper, keeper_q = _keeper_context_score(shot)
    previous_type = router.get("previous_event_type") or router.get("previous_play_type")
    previous = _previous_event_type_score(previous_type)
    receiver_available = router.get("previous_receiver_is_shooter") is not None or router.get("previous_receiver_id") is not None
    receiver = _receiver_score(router, shot)
    time_value = router.get("time_from_reception_s") if router.get("time_from_reception_s") is not None else router.get("time_from_previous_event_s")
    time_score = _time_score(family, _num(time_value, math.nan))
    ball_height = _num(features.get("ball_z_at_contact"), _num(shot.ball_height_m, math.nan))
    height_available = not math.isnan(ball_height)
    height = _ball_height_score(family, ball_height) if height_available else 0.5
    context = _family_context_affordance(family, shot, router, ball_height if height_available else None)
    weights = P1_FAMILY_WEIGHTS[family]
    items = [
        (distance, weights["distance"], True),
        (angle, weights["angle"], True),
        (pressure, weights["pressure"], True),
        (lane, weights["lane"], True),
        (keeper, weights["keeper"], True),
        (previous, weights["previous"], previous_type is not None),
        (receiver, weights["receiver"], receiver_available),
        (time_score, weights["time"], time_value is not None or family == "dead_ball"),
        (height, weights["height"], True),
        (context, weights["context"], True),
    ]
    q_items = [
        (0.9, weights["distance"], True),
        (0.9, weights["angle"], True),
        (0.8, weights["pressure"], True),
        (0.8 if lane_available else 0.2, weights["lane"], True),
        (keeper_q, weights["keeper"], True),
        (0.75 if previous_type is not None else 0.25, weights["previous"], weights["previous"] > 0),
        (0.75 if receiver_available else 0.25, weights["receiver"], weights["receiver"] > 0),
        (0.75 if time_value is not None else (0.7 if family == "dead_ball" else 0.2), weights["time"], weights["time"] > 0),
        (_quality_mean(features.get("q_contact"), features.get("q_sync"), default=0.1) if height_available else 0.1, weights["height"], True),
        (0.5, weights["context"], True),
    ]
    return {
        "distance_context_score": distance,
        "angle_context_score": angle,
        "pressure_context_score": pressure,
        "defenders_lane_score": lane,
        "defenders_lane_q": 0.8 if lane_available else 0.2,
        "keeper_proxy_score": keeper,
        "keeper_proxy_q": keeper_q,
        "previous_event_type_score": previous,
        "receiver_is_shooter_score": receiver,
        "time_to_shot_context_score": time_score,
        "ball_height_context_score": height,
        "family_context_affordance_score": context,
        "P1_score": 100 * weighted_mean_available(items),
        "P1_q": weighted_mean_available(q_items, neutral=0.0),
    }


def _score_p2(features: dict[str, Any], router: dict[str, Any], family: str) -> dict[str, Any]:
    speed = _num(features.get("approach_speed_m_s"), math.nan)
    angle = _num(features.get("approach_angle_deg"), math.nan)
    forward = _num(features.get("prep_ball_forward_m"), math.nan)
    lateral = _num(features.get("prep_ball_lateral_m"), math.nan)
    convergence = _num(features.get("ball_shooter_convergence_score"), math.nan)
    trunk = _num(features.get("trunk_lean_approach_deg"), math.nan)
    stride = _num(features.get("stride_smoothness_score"), math.nan)
    readiness = _num(features.get("body_ball_readiness_score"), math.nan)
    time_value = router.get("time_from_reception_s") if router.get("time_from_reception_s") is not None else router.get("time_from_previous_event_s")
    timing = _optional_score(features.get("touch_timing_score"))
    if timing is None:
        timing = _time_score(family, _num(time_value, math.nan))

    speed_score = _approach_speed_score(family, speed) if not math.isnan(speed) else 0.5
    angle_score = _approach_angle_score(family, angle) if not math.isnan(angle) else 0.5
    prep_score = _prep_touch_offset_score(family, forward, lateral) if not math.isnan(forward) and not math.isnan(lateral) else 0.5
    trunk_score = _trunk_approach_score(family, trunk) if not math.isnan(trunk) else 0.5
    stride_score = _clamp(stride) if not math.isnan(stride) else 0.5
    readiness_score = _clamp(readiness) if not math.isnan(readiness) else 0.5
    convergence_score = _clamp(convergence) if not math.isnan(convergence) else 0.5
    weights = P2_FAMILY_WEIGHTS[family]
    has_skeleton = any(not math.isnan(value) for value in (speed, angle, forward, lateral, convergence, trunk, stride, readiness))
    items = [
        (speed_score, weights["speed"], not math.isnan(speed)),
        (angle_score, weights["angle"], not math.isnan(angle)),
        (prep_score, weights["prep"], not math.isnan(forward) and not math.isnan(lateral)),
        (convergence_score, weights["convergence"], not math.isnan(convergence)),
        (trunk_score, weights["trunk"], not math.isnan(trunk)),
        (stride_score, weights["stride"], not math.isnan(stride)),
        (timing, weights["timing"], timing is not None and weights["timing"] > 0),
        (readiness_score, weights["readiness"], not math.isnan(readiness)),
    ]
    skeleton_q = _quality_mean(features.get("q_sync"), features.get("q_anchor"), features.get("q_occlusion"), default=0.0)
    if has_skeleton and skeleton_q == 0.0:
        skeleton_q = 0.5
    timing_q = 0.75 if time_value is not None or features.get("touch_timing_score") is not None else (0.7 if family == "dead_ball" else 0.0)
    q_items = [
        (skeleton_q, weights["speed"], not math.isnan(speed)),
        (skeleton_q, weights["angle"], not math.isnan(angle)),
        (skeleton_q, weights["prep"], not math.isnan(forward) and not math.isnan(lateral)),
        (skeleton_q, weights["convergence"], not math.isnan(convergence)),
        (skeleton_q, weights["trunk"], not math.isnan(trunk)),
        (min(skeleton_q, 0.4), weights["stride"], not math.isnan(stride)),
        (timing_q, weights["timing"], timing is not None and weights["timing"] > 0),
        (min(skeleton_q, 0.4), weights["readiness"], not math.isnan(readiness)),
    ]
    p2_q = weighted_mean_available(q_items, neutral=0.0)
    if not has_skeleton:
        p2_q = min(p2_q, 0.25)
    return {
        "approach_speed_score": speed_score,
        "approach_angle_score": angle_score,
        "prep_touch_offset_score": prep_score,
        "touch_timing_score": timing,
        "trunk_lean_approach_score": trunk_score,
        "P2_score": 100 * weighted_mean_available(items),
        "P2_q": p2_q,
    }


def _score_p3_p4_p5(features: dict[str, Any], components: dict[str, float], *, q: float, family: str) -> dict[str, Any]:
    plant_forward = _plant_forward_score(_num(features.get("plant_foot_forward_offset_m"), math.nan))
    if "plant_forward_score" in features:
        plant_forward = _num(features.get("plant_forward_score"), plant_forward)
    elif "C_plant_forward" in components and math.isnan(_num(features.get("plant_foot_forward_offset_m"), math.nan)):
        plant_forward = _num(components.get("C_plant_forward"), math.nan)
    plant_lateral = _plant_lateral_score(_num(features.get("plant_foot_lateral_offset_m"), math.nan))
    if "plant_lateral_score" in features:
        plant_lateral = _num(features.get("plant_lateral_score"), plant_lateral)
    elif "C_plant_lateral" in components and math.isnan(_num(features.get("plant_foot_lateral_offset_m"), math.nan)):
        plant_lateral = _num(components.get("C_plant_lateral"), math.nan)
    shoulder_angle = _num(features.get("shoulder_hip_separation_deg"), math.nan)
    shoulder = _shoulder_hip_family_score(family, shoulder_angle) if not math.isnan(shoulder_angle) else _component_or_feature(components, features, "B_shoulder_hip", "shoulder_hip_score", math.nan)
    knee = _component_or_feature(components, features, "B_knee_stability", "knee_stability_score", math.nan)
    com_over_plant = _num(features.get("com_over_plant_foot_score"), math.nan)
    knee_peak = _num(features.get("knee_peak_angular_velocity_score"), math.nan)
    if math.isnan(knee_peak):
        knee_peak = _knee_peak_angular_velocity_score(features.get("knee_peak_angular_velocity_dps"))
    arm_abduction = _num(features.get("non_kicking_arm_abduction_score"), math.nan)
    if math.isnan(arm_abduction):
        arm_abduction = _non_kicking_arm_abduction_score(features.get("non_kicking_arm_abduction_deg"))
    foot_peak = _num(features.get("foot_peak_velocity_score"), math.nan)
    if math.isnan(foot_peak):
        foot_peak = _foot_peak_velocity_score(features.get("foot_peak_velocity_at_contact"))
    if family == "header":
        trunk = lin_high(_num(features.get("trunk_extension_to_flexion_delta_dps"), math.nan), 100.0, 500.0)
        height = soft_band(_num(features.get("forehead_contact_height_m"), math.nan), 1.3, 2.6, 0.3, 0.4)
        p3 = weighted_mean_available(
            [
                (trunk, 0.45, not math.isnan(trunk)),
                (height, 0.25, not math.isnan(height)),
                (knee, 0.15, not math.isnan(knee)),
                (com_over_plant, 0.15, not math.isnan(com_over_plant)),
            ]
        )
    else:
        p3_weights = P3_V3_COMPONENT_WEIGHTS.get(family, P3_V3_COMPONENT_WEIGHTS["default"])
        p3 = weighted_mean_available(
            [
                (com_over_plant, p3_weights["com"], not math.isnan(com_over_plant)),
                (shoulder, p3_weights["shoulder"], not math.isnan(shoulder)),
                (knee, p3_weights["knee"], not math.isnan(knee)),
                (knee_peak, p3_weights["knee_peak"], not math.isnan(knee_peak)),
                (arm_abduction, p3_weights["arm"], not math.isnan(arm_abduction)),
                (foot_peak, p3_weights["foot_peak"], not math.isnan(foot_peak)),
            ]
        )

    contact_near = _component_or_feature(components, features, "C_contact_near_ankle", "contact_near_ankle_score", math.nan)
    foot_velocity = _component_or_feature(components, features, "V_exit_speed", "foot_velocity_into_ball_score", math.nan)
    jump_score = lin_high(_num(features.get("position_delta_jump_m_s"), math.nan), 6.0, 28.0)
    if math.isnan(_num(features.get("position_delta_jump_m_s"), math.nan)):
        jump_score = math.nan
    ratio = _num(features.get("ball_to_foot_speed_ratio"), math.nan)
    ratio_score = _ball_to_foot_ratio_score(ratio, family=family, foot_speed=_num(features.get("foot_speed_m_s"), math.nan))
    foot_path = _component_or_feature(components, features, "C_foot_path_stability", "foot_path_stability", math.nan)
    ankle_rigidity = _num(features.get("ankle_rigidity_score"), math.nan)
    sequence = _num(features.get("proximal_distal_sequencing_score"), math.nan)
    header_contact = _num(features.get("header_contact_score"), math.nan)
    if family == "header":
        header_trunk = lin_high(_num(features.get("trunk_extension_to_flexion_delta_dps"), math.nan), 100.0, 500.0)
        header_height = soft_band(_num(features.get("forehead_contact_height_m"), math.nan), 1.3, 2.6, 0.3, 0.4)
        contact_near = header_contact
        foot_velocity = math.nan
        ratio_score = math.nan
        ankle_rigidity = math.nan
        foot_path = math.nan
        sequence = math.nan
        foot_peak = math.nan
        p4_mech = weighted_mean_available(
            [
                (contact_near, 0.45, not math.isnan(contact_near)),
                (header_trunk, 0.30, not math.isnan(header_trunk)),
                (header_height, 0.25, not math.isnan(header_height)),
            ]
        )
    else:
        p4_mech = weighted_mean_available(
            [
                (contact_near, 0.20, not math.isnan(contact_near)),
                (foot_velocity, 0.20, not math.isnan(foot_velocity)),
                (ankle_rigidity, 0.15, not math.isnan(ankle_rigidity)),
                (foot_path, 0.15, not math.isnan(foot_path)),
                (sequence, 0.15, not math.isnan(sequence)),
                (foot_peak, 0.15, not math.isnan(foot_peak)),
            ]
        )
    p4_strike = math.nan if family == "header" else weighted_mean_available(
        [
            (jump_score, 0.40, not math.isnan(jump_score)),
            (ratio_score, 0.35, not math.isnan(ratio_score)),
            (foot_velocity, 0.25, not math.isnan(foot_velocity)),
        ]
    )
    p4 = weighted_mean_available(
        [
            (p4_mech, 0.50, not math.isnan(p4_mech)),
            (p4_strike, 0.50, not math.isnan(p4_strike)),
        ]
    )

    com = _num(features.get("com_continuation_score"), math.nan)
    balance = _num(features.get("post_impact_balance_score"), math.nan)
    p5 = weighted_mean_available(
        [
            (com, 0.50, not math.isnan(com)),
            (balance, 0.50, not math.isnan(balance)),
        ]
    )
    tracking_q = _quality_mean(features.get("q_contact"), features.get("q_foot"), features.get("q_occlusion"), features.get("q_anchor"), default=q if components else 0.0)
    p3_q = tracking_q if any(not math.isnan(v) for v in (com_over_plant, shoulder, knee, knee_peak, arm_abduction, foot_peak)) else 0.0
    if family == "header":
        p4_q = _quality_mean(features.get("q_sync"), features.get("q_anchor"), features.get("q_occlusion"), features.get("q_candidate"), default=q if components else 0.0)
    else:
        p4_q = _quality_mean(features.get("q_contact"), features.get("q_foot"), features.get("q_candidate"), features.get("q_anchor"), default=q if components else 0.0)
    has_p5 = any(not math.isnan(v) for v in (com, balance))
    p5_q = _quality_mean(features.get("q_sync"), features.get("q_anchor"), features.get("q_occlusion"), default=q) if has_p5 else 0.0
    has_tracking_confidence = any(_num(features.get(key), 0.0) > 0.0 for key in ("q_contact", "q_sync", "q_anchor", "q_candidate", "q_occlusion"))
    if not has_tracking_confidence:
        p3_q = 0.0
        p4_q = 0.0
        p5_q = 0.0
    p4_mech_q = p4_q if not math.isnan(p4_mech) else 0.0
    p4_strike_q = p4_q if not math.isnan(p4_strike) else 0.0
    return {
        "plant_forward_score": plant_forward,
        "plant_lateral_score": plant_lateral,
        "shoulder_hip_score": shoulder,
        "com_over_plant_foot_score": com_over_plant,
        "knee_peak_angular_velocity_score": knee_peak,
        "non_kicking_arm_abduction_score": arm_abduction,
        "foot_peak_velocity_score": foot_peak,
        "ankle_rigidity_score": ankle_rigidity,
        "foot_velocity_into_ball_score": foot_velocity,
        "position_delta_jump_score": jump_score,
        "ball_to_foot_speed_ratio_score": ratio_score,
        "P3_score": 100 * p3,
        "P3_q": _clamp(p3_q),
        "P4_score": 100 * p4,
        "P4_q": _clamp(p4_q),
        "P4_mech_score": 100 * p4_mech,
        "P4_mech_q": _clamp(p4_mech_q),
        "P4_strike_score": 100 * p4_strike if not math.isnan(p4_strike) else math.nan,
        "P4_strike_q": _clamp(p4_strike_q),
        "P5_score": 100 * p5,
        "P5_q": _clamp(p5_q),
        "technique_P3": p3,
        "technique_P4": p4,
        "technique_P4_mech": p4_mech,
        "technique_P4_strike": p4_strike,
        "technique_P5": p5,
    }


def _score_p6(shot: ShotEvent, features: dict[str, Any], family: str) -> dict[str, Any]:
    speed = _num(features.get("initial_ball_speed_m_s"), _num(features.get("ball_exit_speed_m_s"), math.nan))
    launch = _num(features.get("launch_angle_deg"), math.nan)
    if math.isnan(launch):
        vx = _num(features.get("initial_ball_velocity_x_m_s"), math.nan)
        vy = _num(features.get("initial_ball_velocity_y_m_s"), math.nan)
        vz = _num(features.get("initial_ball_velocity_z_m_s"), math.nan)
        if not any(math.isnan(v) for v in (vx, vy, vz)):
            launch = math.degrees(math.atan2(vz, math.hypot(vx, vy)))
    align_deg = _num(features.get("initial_goal_alignment_deg"), math.nan)
    align = math.exp(-0.5 * (align_deg / 18.0) ** 2) if not math.isnan(align_deg) else math.nan
    lateral = _goal_lateral_score(_num(features.get("goal_plane_y_m"), math.nan))
    vertical = _goal_vertical_score(family, _num(features.get("goal_plane_z_m"), math.nan))
    speed_score = _exit_speed_score(family, speed) if not math.isnan(speed) else math.nan
    launch_score = _launch_score(family, launch) if not math.isnan(launch) else math.nan
    flatness = _optional_score(features.get("trajectory_flatness_score"))
    outcome = _shot_outcome_score(shot.shot_result or shot.outcome_tag)
    weights = P6_FAMILY_WEIGHTS[family]
    items = [
        (align, weights["align"], not math.isnan(align)),
        (lateral, weights["lateral"], not math.isnan(lateral)),
        (vertical, weights["vertical"], not math.isnan(vertical)),
        (speed_score, weights["speed"], not math.isnan(speed_score)),
        (launch_score, weights["launch"], not math.isnan(launch_score)),
        (flatness if flatness is not None else math.nan, weights["flatness"], flatness is not None),
        (outcome, min(weights["outcome"], 0.10), bool(shot.shot_result or shot.outcome_tag)),
    ]
    flight_count = _num(features.get("p6_flight_frame_count"), 0.0)
    projection_available = not math.isnan(_num(features.get("goal_plane_y_m"), math.nan)) and not math.isnan(_num(features.get("goal_plane_z_m"), math.nan))
    initial_q = _quality_mean(features.get("q_contact"), features.get("q_sync"), features.get("q_anchor"), features.get("q_candidate"), default=0.0) if not math.isnan(speed) else 0.0
    projection_q = 0.85 if projection_available else 0.0
    valid_ratio = _clamp(flight_count / 10.0)
    p6_q = weighted_mean_available(
        [
            (initial_q, 0.35, not math.isnan(speed)),
            (projection_q, 0.35, projection_available),
            (valid_ratio, 0.20, flight_count > 0),
            (0.2, 0.10, bool(shot.shot_result or shot.outcome_tag)),
        ],
        neutral=0.0,
    )
    blocked = _truthy(features.get("blocked_flight_flag"))
    if blocked:
        p6_q = min(p6_q, 0.45)
    if not projection_available and math.isnan(speed):
        p6_q = min(0.20 if shot.shot_result or shot.outcome_tag else 0.0, p6_q if p6_q else 0.20)
    return {
        "initial_goal_alignment_score": align if not math.isnan(align) else math.nan,
        "exit_speed_score": speed_score if not math.isnan(speed_score) else math.nan,
        "launch_angle_score": launch_score if not math.isnan(launch_score) else math.nan,
        "goal_plane_lateral_score": lateral if not math.isnan(lateral) else math.nan,
        "goal_plane_vertical_score": vertical if not math.isnan(vertical) else math.nan,
        "kpi_outcome_weak_score": outcome,
        "initial_velocity_q": initial_q,
        "projection_q": projection_q,
        "valid_p6_ball_ratio": valid_ratio,
        "outcome_q": 0.2 if shot.shot_result or shot.outcome_tag else 0.0,
        "P6_score": 100 * weighted_mean_available(items),
        "P6_q": _clamp(p6_q),
    }


def _decision_quality(shot: ShotEvent, router: dict[str, Any], p1: dict[str, Any]) -> tuple[float | None, float]:
    shot_value = _num(
        router.get("shot_value")
        if router.get("shot_value") is not None
        else router.get("current_shot_value"),
        math.nan,
    )
    if math.isnan(shot_value):
        shot_value = _num(shot.xg, math.nan)
    pass_value = _num(
        router.get("best_pass_option_value")
        if router.get("best_pass_option_value") is not None
        else router.get("best_teammate_option_value"),
        math.nan,
    )
    has_pass_evidence = not math.isnan(pass_value)
    has_shot_evidence = not math.isnan(shot_value)
    if not has_pass_evidence or not has_shot_evidence:
        return None, 0.0

    value_margin = shot_value - pass_value
    value_score = lin_high(value_margin, -0.25, 0.15)
    better_pass = router.get("better_pass_available")
    if better_pass is None:
        better_pass_penalty = 1.0 if value_margin >= 0 else 0.35
        decision_q = 0.75
    else:
        better_pass_penalty = 0.35 if _truthy(better_pass) and value_margin < 0 else 1.0
        decision_q = 0.85
    context_score = weighted_mean_available(
        [
            (p1["angle_context_score"], 0.30, True),
            (p1["pressure_context_score"], 0.25, True),
            (p1["defenders_lane_score"], 0.25, True),
            (p1["keeper_proxy_score"], 0.20, True),
        ]
    )
    score = weighted_mean_available(
        [
            (value_score, 0.70, True),
            (context_score, 0.20, True),
            (better_pass_penalty, 0.10, True),
        ]
    )
    return 100 * score, decision_q


def _carry_progression(router: dict[str, Any], family: str) -> tuple[float | None, float]:
    if family != "carry_self_created":
        return None, 0.0
    distance = _num(router.get("previous_carry_distance_m"), math.nan)
    if math.isnan(distance):
        return None, 0.0
    start_x = _num(router.get("previous_carry_start_x"), math.nan)
    end_x = _num(router.get("previous_carry_end_x"), math.nan)
    gap = _num(router.get("time_from_previous_carry_end_s"), math.nan)
    distance_score = soft_band(distance, 4.0, 14.0, 2.0, 8.0)
    gain_score = lin_high(abs(end_x - start_x), 2.0, 16.0) if not math.isnan(start_x) and not math.isnan(end_x) else 0.5
    continuation_score = lin_low(gap, 0.0, 3.0) if not math.isnan(gap) else 0.5
    score = weighted_mean_available(
        [
            (distance_score, 0.50, True),
            (gain_score, 0.30, not math.isnan(start_x) and not math.isnan(end_x)),
            (continuation_score, 0.20, not math.isnan(gap)),
        ]
    )
    q = weighted_mean_available(
        [
            (0.85, 0.50, True),
            (0.75, 0.30, not math.isnan(start_x) and not math.isnan(end_x)),
            (0.75, 0.20, not math.isnan(gap)),
        ],
        neutral=0.0,
    )
    return 100 * score, q


def compute_module_scores(
    shot: ShotEvent,
    features: dict[str, Any],
    components: dict[str, float],
    *,
    q: float,
    router: dict[str, Any] | None = None,
) -> dict[str, Any]:
    router = router or {}
    family = resolve_shot_family(shot, router)
    p1 = _score_p1(shot, features, router, family)
    p2 = _score_p2(features, router, family)
    p345 = _score_p3_p4_p5(features, components, q=q, family=family)
    p6 = _score_p6(shot, features, family)
    p3 = p345["technique_P3"]
    p4 = p345["technique_P4"]
    p4_mech = p345["technique_P4_mech"]
    p4_strike = p345["technique_P4_strike"]
    p5 = p345["technique_P5"]
    p2_fraction = p2["P2_score"] / 100.0
    technique_weights = TECHNIQUE_PHASE_WEIGHTS[family]
    technique = weighted_mean_available(
        [
            (p2_fraction, technique_weights["P2"], p2["P2_q"] > 0),
            (p345["P3_score"] / 100.0, technique_weights["P3"], p345["P3_q"] > 0),
            (p345["P4_score"] / 100.0, technique_weights["P4"], p345["P4_q"] > 0),
            (p345["P5_score"] / 100.0, technique_weights["P5"], p345["P5_q"] > 0),
        ]
    )
    technique_q = weighted_mean_available(
        [
            (p2["P2_q"], technique_weights["P2"], p2["P2_q"] > 0),
            (p345["P3_q"], technique_weights["P3"], p345["P3_q"] > 0),
            (p345["P4_q"], technique_weights["P4"], p345["P4_q"] > 0),
            (p345["P5_q"], technique_weights["P5"], p345["P5_q"] > 0),
        ],
        neutral=0.0,
    )
    technique_mechanics = weighted_mean_available(
        [
            (p2_fraction, TECHNIQUE_MECHANICS_V3_WEIGHTS["P2"], p2["P2_q"] > 0),
            (p345["P3_score"] / 100.0, TECHNIQUE_MECHANICS_V3_WEIGHTS["P3"], p345["P3_q"] > 0),
            (p4_mech, TECHNIQUE_MECHANICS_V3_WEIGHTS["P4_mech"], p345["P4_mech_q"] > 0),
            (p345["P5_score"] / 100.0, TECHNIQUE_MECHANICS_V3_WEIGHTS["P5"], p345["P5_q"] > 0),
        ]
    )
    technique_mechanics_q = weighted_mean_available(
        [
            (p2["P2_q"], TECHNIQUE_MECHANICS_V3_WEIGHTS["P2"], p2["P2_q"] > 0),
            (p345["P3_q"], TECHNIQUE_MECHANICS_V3_WEIGHTS["P3"], p345["P3_q"] > 0),
            (p345["P4_mech_q"], TECHNIQUE_MECHANICS_V3_WEIGHTS["P4_mech"], p345["P4_mech_q"] > 0),
            (p345["P5_q"], TECHNIQUE_MECHANICS_V3_WEIGHTS["P5"], p345["P5_q"] > 0),
        ],
        neutral=0.0,
    )

    positioning = weighted_mean_available(
        [
            (p1["distance_context_score"], 0.22, True),
            (p1["angle_context_score"], 0.20, True),
            (p1["pressure_context_score"], 0.20, True),
            (p1["defenders_lane_score"], 0.18, True),
            (p1["keeper_proxy_score"], 0.15, True),
            (p1["ball_height_context_score"], 0.05, True),
        ]
    )
    positioning_q = p1["P1_q"]
    receiving = weighted_mean_available(
        [
            (p1["previous_event_type_score"], 0.25, (router.get("previous_event_type") or router.get("previous_play_type")) is not None),
            (p1["receiver_is_shooter_score"], 0.25, router.get("previous_receiver_is_shooter") is not None or router.get("previous_receiver_id") is not None),
            (p1["time_to_shot_context_score"], 0.30, router.get("time_from_reception_s") is not None or router.get("time_from_previous_event_s") is not None or family == "dead_ball"),
            (p1["pressure_context_score"], 0.20, True),
        ]
    )
    receiving_q = weighted_mean_available(
        [
            (0.75, 0.25, (router.get("previous_event_type") or router.get("previous_play_type")) is not None),
            (0.75, 0.25, router.get("previous_receiver_is_shooter") is not None or router.get("previous_receiver_id") is not None),
            (0.75 if router.get("time_from_reception_s") is not None or router.get("time_from_previous_event_s") is not None else 0.2, 0.30, True),
            (0.8, 0.20, True),
        ],
        neutral=0.0,
    )

    placement = weighted_mean_available(
        [
            (p6["initial_goal_alignment_score"], 0.25, not math.isnan(_num(p6["initial_goal_alignment_score"], math.nan))),
            (p6["goal_plane_lateral_score"], 0.35, not math.isnan(_num(p6["goal_plane_lateral_score"], math.nan))),
            (p6["goal_plane_vertical_score"], 0.25, not math.isnan(_num(p6["goal_plane_vertical_score"], math.nan))),
            (_optional_score(features.get("trajectory_flatness_score")) or math.nan, 0.15, _optional_score(features.get("trajectory_flatness_score")) is not None),
        ]
    )
    placement_q = weighted_mean_available(
        [
            (p6["initial_velocity_q"], 0.35, p6["initial_velocity_q"] > 0),
            (p6["projection_q"], 0.35, p6["projection_q"] > 0),
            (p6["valid_p6_ball_ratio"], 0.30, p6["valid_p6_ball_ratio"] > 0),
        ],
        neutral=0.0,
    )

    flatness_score = _optional_score(features.get("trajectory_flatness_score"))
    strike_output = weighted_mean_available(
        [
            (p345["P4_score"] / 100.0, 0.35, p345["P4_q"] > 0),
            (p6["exit_speed_score"], 0.30, not math.isnan(_num(p6["exit_speed_score"], math.nan))),
            (p6["launch_angle_score"], 0.20, not math.isnan(_num(p6["launch_angle_score"], math.nan))),
            (flatness_score if flatness_score is not None else math.nan, 0.15, flatness_score is not None),
        ]
    )
    strike_output_q = weighted_mean_available(
        [
            (p345["P4_q"], 0.45, p345["P4_q"] > 0),
            (p6["P6_q"], 0.55, p6["P6_q"] > 0),
        ],
        neutral=0.0,
    )
    strike_quality = weighted_mean_available(
        [
            (p4_strike, 0.50, p345["P4_strike_q"] > 0 and not math.isnan(_num(p4_strike, math.nan))),
            (p6["P6_score"] / 100.0, 0.50, p6["P6_q"] >= 0.4),
        ]
    )
    strike_quality_q = weighted_mean_available(
        [
            (p345["P4_strike_q"], 0.50, p345["P4_strike_q"] > 0 and not math.isnan(_num(p4_strike, math.nan))),
            (p6["P6_q"], 0.50, p6["P6_q"] >= 0.4),
        ],
        neutral=0.0,
    )
    decision_quality, decision_quality_q = _decision_quality(shot, router, p1)
    carry_progression, carry_progression_q = _carry_progression(router, family)
    mechanics_gate_q = max(q, technique_mechanics_q) if family == "header" else q
    technique_mechanics_v2, technique_mechanics_band = _v2_confidence_score(100 * technique_mechanics, mechanics_gate_q)
    strike_quality_v2, strike_quality_band = _v2_confidence_score(100 * strike_quality, q)
    decision_quality_v2, decision_quality_band = _v2_confidence_score(
        decision_quality if decision_quality is not None else math.nan,
        decision_quality_q,
    )
    carry_progression_v2, carry_progression_band = _v2_confidence_score(
        carry_progression if carry_progression is not None else math.nan,
        carry_progression_q,
    )

    return {
        **p1,
        **p2,
        **p345,
        **p6,
        "family": family,
        "technique_score": 100 * technique,
        "technique_q": _clamp(technique_q),
        "technique_mechanics_score": technique_mechanics_v2,
        "technique_mechanics_q": _clamp(technique_mechanics_q),
        "technique_mechanics_band": technique_mechanics_band,
        "technique_P2": p2_fraction if p2["P2_q"] > 0 else math.nan,
        "positioning_score": 100 * positioning,
        "positioning_q": positioning_q,
        "shot_geometry_score": 100 * positioning,
        "shot_geometry_q": positioning_q,
        "receiving_pressure_score": 100 * receiving,
        "receiving_pressure_q": receiving_q,
        "arrival_receiving_score": 100 * receiving,
        "arrival_receiving_q": receiving_q,
        "approach_prep_score": p2["P2_score"],
        "approach_prep_q": p2["P2_q"],
        "placement_score": 100 * placement,
        "placement_q": placement_q,
        "strike_output_score": 100 * strike_output,
        "strike_output_q": _clamp(strike_output_q),
        "strike_quality_score": strike_quality_v2,
        "strike_quality_q": _clamp(strike_quality_q),
        "strike_quality_band": strike_quality_band,
        "decision_quality_score": decision_quality_v2,
        "decision_quality_q": _clamp(decision_quality_q),
        "decision_quality_band": decision_quality_band,
        "carry_progression_score": carry_progression_v2,
        "carry_progression_q": _clamp(carry_progression_q),
        "carry_progression_band": carry_progression_band,
        "legacy_Q": q,
    }


def tracking_sample_rows(shot: ShotEvent, frames: list[SkeletonFrame]) -> list[dict[str, Any]]:
    rows = []
    for frame in frames:
        player = frame.players.get(shot.player_parquet_key, {}) if shot.player_parquet_key else {}
        rows.append(
            {
                "event_id": shot.event_id,
                "match_folder": shot.match_folder,
                "frame_number": frame.frame_number,
                "ball_x": frame.ball.x if frame.ball else None,
                "ball_y": frame.ball.y if frame.ball else None,
                "ball_z": frame.ball.z if frame.ball else None,
                "pelvis_x": player.get("pelvis").x if player.get("pelvis") else None,
                "pelvis_y": player.get("pelvis").y if player.get("pelvis") else None,
            }
        )
    return rows


def compute_contact_candidates(shot: ShotEvent, frames: list[SkeletonFrame], *, limit: int | None = 5, frame_rate: int = 50) -> list[dict[str, Any]]:
    frames = sorted(frames, key=lambda f: f.frame_number)
    player_key = shot.player_parquet_key
    if not frames or player_key is None:
        return []

    candidates: list[dict[str, Any]] = []
    for index, frame in enumerate(frames):
        player = frame.players.get(player_key, {})
        if not frame.ball or not player:
            continue
        nearest = _nearest_foot(frame.ball, player)
        if nearest is None:
            continue
        distance, part, side = nearest
        position_delta_velocity = _position_delta_velocity(frames, index, frame_rate=frame_rate)
        previous_position_delta_velocity = _position_delta_velocity(frames, index - 1, frame_rate=frame_rate) if index > 1 else position_delta_velocity
        position_delta_speed = _vec_norm(position_delta_velocity)
        previous_position_delta_speed = _vec_norm(previous_position_delta_velocity)
        position_delta_jump = max(0.0, position_delta_speed - previous_position_delta_speed)
        parquet_speed = _vec_norm(frame.ball_velocity)
        previous_parquet_speed = _vec_norm(frames[index - 1].ball_velocity) if index > 0 else parquet_speed
        parquet_jump = max(0.0, parquet_speed - previous_parquet_speed)
        offset = frame.frame_number - shot.skeleton_frame
        distance_cost = distance
        anchor_cost = 0.12 * abs(offset)
        jump_credit = min(0.20, 0.02 * position_delta_jump)
        total_cost = distance_cost + anchor_cost - jump_credit
        candidates.append(
            {
                "event_id": shot.event_id,
                "match_folder": shot.match_folder,
                "frame_index": index,
                "candidate_frame": frame.frame_number,
                "frame_offset": offset,
                "inferred_foot": side,
                "nearest_part": part,
                "min_foot_ball_distance_m": distance,
                "foot_ball_distance_m": distance,
                # Primary physics signal: frame-to-frame ball position delta.
                "ball_speed_m_s": position_delta_speed,
                "prev_ball_speed_m_s": previous_position_delta_speed,
                "previous_ball_speed_m_s": previous_position_delta_speed,
                "ball_speed_jump_m_s": position_delta_jump,
                "velocity_jump_m_s": position_delta_jump,
                "position_delta_speed_m_s": position_delta_speed,
                "previous_position_delta_speed_m_s": previous_position_delta_speed,
                "position_delta_jump_m_s": position_delta_jump,
                # Audit-only physics signal: parquet-provided velocity column.
                "parquet_ball_speed_m_s": parquet_speed,
                "previous_parquet_ball_speed_m_s": previous_parquet_speed,
                "parquet_velocity_jump_m_s": parquet_jump,
                "_position_delta_velocity": position_delta_velocity,
                "distance_cost": distance_cost,
                "anchor_cost": anchor_cost,
                "jump_credit": jump_credit,
                "total_contact_cost": total_cost,
                "selected_by": "cost",
            }
        )

    candidates.sort(key=lambda row: (row["total_contact_cost"], abs(row["frame_offset"]), row["min_foot_ball_distance_m"]))
    if not candidates:
        return []
    # Decisive-jump override: if any candidate has a position-delta jump >= 15
    # m/s within the window, that frame is contact (physics > foot proximity).
    # The parquet velocity column can lag by ~2 frames, so it is deliberately
    # not used as the primary contact trigger.
    decisive = [row for row in candidates if row["position_delta_jump_m_s"] >= DECISIVE_POSITION_DELTA_JUMP_M_S]
    if decisive:
        winner = min(decisive, key=lambda row: row["candidate_frame"])
        winner["selected_by"] = "position_delta_jump"
        candidates = [winner] + [row for row in candidates if row is not winner]
    top_gap = candidates[1]["total_contact_cost"] - candidates[0]["total_contact_cost"] if len(candidates) > 1 else 1.0
    selected_cost = candidates[0]["total_contact_cost"]
    for rank, row in enumerate(candidates, start=1):
        row["candidate_rank"] = rank
        row["selected"] = rank == 1
        row["top1_top2_cost_gap"] = top_gap
        # q_contact uses the original 0.6 m linear ramp (preserves v1
        # calibration for the foot-near case) but floors at 0.05 so a far foot
        # never collapses the entire shot to Q=0 via the geomean. Real headers,
        # 50 Hz follow-through aliasing, and skeleton noise routinely produce
        # foot-ball distances >= 0.6 m at the detected contact frame, and the
        # original hard zero was erasing 27% of Bayern shots.
        row["q_contact"] = max(0.05, _clamp(1.0 - row["min_foot_ball_distance_m"] / 0.6)) * (0.75 + 0.25 * _clamp(row["position_delta_jump_m_s"] / 8.0))
        row["q_foot"] = 0.9 if row["min_foot_ball_distance_m"] < 0.35 and row["inferred_foot"] in {"left", "right"} else 0.45
        row["q_sync"] = _clamp(1.0 - abs(row["frame_offset"]) / 25.0)
        row["q_anchor"] = _clamp(1.0 - abs(row["frame_offset"]) / 10.0)
        row["q_candidate"] = _clamp(0.50 + max(0.0, row["total_contact_cost"] - selected_cost) + max(0.0, top_gap) / 0.25)
    rows = candidates if limit is None else candidates[:limit]
    return rows


def _v2_confidence_score(score: float, q: float) -> tuple[float | None, str]:
    if q < 0.4 or math.isnan(_num(score, math.nan)):
        return None, "insufficient_confidence"
    return score, "ok"


def confidence_q(features: dict[str, Any]) -> float:
    total_weight = 0.0
    weighted_logs = 0.0
    for key, weight in CONFIDENCE_WEIGHTS.items():
        value = _clamp(_num(features.get(key), 0.0))
        if value <= 0.0:
            return 0.0
        total_weight += weight
        weighted_logs += weight * math.log(value)
    return math.exp(weighted_logs / total_weight) if total_weight else 0.0


def _candidate_confidence(candidates: list[dict[str, Any]]) -> float:
    if len(candidates) < 2:
        return 0.60
    gap = float(candidates[0].get("top1_top2_cost_gap") or 0.0)
    return _clamp((gap - 0.01) / 0.12)


def _sync_confidence(shot: ShotEvent, *, has_tracking: bool) -> float:
    if not has_tracking:
        return 0.0
    if shot.match_folder == "Bayern_Hamburg":
        return 1.0
    return 0.65


def _empty_tracking_features(shot: ShotEvent) -> dict[str, Any]:
    return {
        "contact_frame": None,
        "contact_frame_offset": None,
        "physics_exit_frame": None,
        "physics_exit_frame_offset": None,
        "biomech_frame": None,
        "biomech_frame_offset": None,
        "inferred_foot": shot.shot_foot,
        "plant_foot": None,
        "shot_direction_x": math.nan,
        "shot_direction_y": math.nan,
        "min_foot_ball_distance_m": math.nan,
        "ball_z_at_contact": math.nan,
        "ball_exit_speed_m_s": math.nan,
        "launch_angle_deg": math.nan,
        "position_delta_speed_m_s": math.nan,
        "previous_position_delta_speed_m_s": math.nan,
        "position_delta_jump_m_s": math.nan,
        "parquet_ball_speed_m_s": math.nan,
        "previous_parquet_ball_speed_m_s": math.nan,
        "parquet_velocity_jump_m_s": math.nan,
        "parquet_exit_speed_m_s": math.nan,
        "contact_near_ankle_score": 0.0,
        "plant_foot_forward_offset_m": math.nan,
        "plant_foot_lateral_offset_m": math.nan,
        "foot_path_stability": 0.0,
        "shoulder_hip_separation_deg": math.nan,
        "biomech_shoulder_hip_separation_deg": math.nan,
        "peak_shoulder_hip_separation_deg": math.nan,
        "peak_shoulder_hip_frame": None,
        "peak_shoulder_hip_frame_offset": None,
        "torso_lean_deg": math.nan,
        "knee_stability_score": 0.0,
        "plant_knee_valgus_stdev_m": math.nan,
        "plant_knee_lateral_track_stdev_m": math.nan,
        "com_over_plant_foot_score": math.nan,
        "ankle_toe_angle_delta_deg": math.nan,
        "ankle_rigidity_score": math.nan,
        "hip_peak_angular_velocity_dps": math.nan,
        "shoulder_peak_angular_velocity_dps": math.nan,
        "knee_peak_angular_velocity_dps": math.nan,
        "knee_peak_angular_velocity_score": math.nan,
        "foot_peak_velocity_at_contact": math.nan,
        "foot_peak_velocity_score": math.nan,
        "proximal_distal_sequencing_score": math.nan,
        "non_kicking_arm_abduction_deg": math.nan,
        "non_kicking_arm_abduction_score": math.nan,
        "trunk_extension_to_flexion_delta_dps": math.nan,
        "forehead_contact_height_m": math.nan,
        "head_ball_proximity_at_impact_m": math.nan,
        "header_contact_score": math.nan,
        "q_contact": 0.0,
        "q_foot": 0.3 if shot.shot_foot else 0.0,
        "q_sync": 0.0,
        "q_anchor": 0.0,
        "q_candidate": 0.0,
        "q_occlusion": 0.0,
        **_empty_approach_features(),
        **_empty_flight_features(),
        **_empty_foot_kinematic_features(),
        **_empty_follow_through_features(),
    }


def _nearest_foot(ball: Vec3, player: dict[str, Vec3]) -> tuple[float, str, str] | None:
    best = None
    for part in ("left_ankle", "left_heel", "left_toe", "right_ankle", "right_heel", "right_toe"):
        point = player.get(part)
        if point is None:
            continue
        side = "left" if part.startswith("left") else "right"
        dist = _distance(ball, point)
        adjusted = dist + (0.0 if part.endswith("_ankle") else 0.08)
        if best is None or adjusted < best[3]:
            best = (dist, part, side, adjusted)
    return None if best is None else (best[0], best[1], best[2])


def _max_after_speed(frames: list[SkeletonFrame], index: int, horizon: int) -> float:
    return max((_vec_norm(frame.ball_velocity) for frame in frames[index : index + horizon + 1] if frame.ball_velocity), default=math.nan)


def _position_delta_velocity(frames: list[SkeletonFrame], index: int, *, frame_rate: int) -> Vec3 | None:
    if index <= 0 or index >= len(frames):
        return None
    current = frames[index].ball
    previous = frames[index - 1].ball
    if current is None or previous is None:
        return None
    return Vec3(
        (current.x - previous.x) * frame_rate,
        (current.y - previous.y) * frame_rate,
        (current.z - previous.z) * frame_rate,
    )


def _launch_angle(frames: list[SkeletonFrame], index: int) -> float:
    velocity = frames[index].ball_velocity
    if velocity is None:
        return math.nan
    xy = math.hypot(velocity.x, velocity.y)
    return math.degrees(math.atan2(velocity.z, xy))


def _position_delta_launch_angle(frames: list[SkeletonFrame], index: int, *, frame_rate: int) -> float:
    velocity = _position_delta_velocity(frames, index, frame_rate=frame_rate)
    if velocity is None:
        return _launch_angle(frames, index)
    xy = math.hypot(velocity.x, velocity.y)
    return math.degrees(math.atan2(velocity.z, xy))


def _foot_path_stability(frames: list[SkeletonFrame], player_key: tuple[int, int], foot: str | None, index: int) -> float:
    if foot is None:
        return 0.0
    pts = []
    for frame in frames[max(0, index - 2) : index + 1]:
        point = frame.players.get(player_key, {}).get(f"{foot}_ankle")
        if point:
            pts.append(point)
    if len(pts) < 2:
        return 0.5
    step_lengths = [_distance(pts[i - 1], pts[i]) for i in range(1, len(pts))]
    return _clamp(1.0 - _std(step_lengths) / 0.25)


def _peak_shoulder_hip_separation(frames: list[SkeletonFrame], player_key: tuple[int, int], contact_frame: int) -> tuple[float, int | None, int | None]:
    start = contact_frame + PHASE_OFFSETS["P3"][0]
    end = contact_frame + PHASE_OFFSETS["P3"][1]
    best_value = math.nan
    best_frame: int | None = None
    for frame in frames:
        if frame.frame_number < start or frame.frame_number > end:
            continue
        value = _axis_separation(frame.players.get(player_key, {}))
        if math.isnan(value):
            continue
        if math.isnan(best_value) or value > best_value:
            best_value = value
            best_frame = frame.frame_number
    return best_value, best_frame, (best_frame - contact_frame if best_frame is not None else None)


def _plant_stability_features(
    frames: list[SkeletonFrame],
    player_key: tuple[int, int],
    plant: str | None,
    contact_frame: int,
    *,
    shot_unit: tuple[float, float] | None = None,
) -> dict[str, Any]:
    if plant not in {"left", "right"}:
        return {
            "plant_knee_valgus_stdev_m": math.nan,
            "plant_knee_lateral_track_stdev_m": math.nan,
            "knee_stability_score": math.nan,
            "com_over_plant_foot_score": math.nan,
        }
    start = contact_frame + PHASE_OFFSETS["P3"][0]
    end = contact_frame + PHASE_OFFSETS["P5"][1]
    legacy_deviations = []
    lateral_deviations = []
    com_distances = []
    if shot_unit is None:
        shot_unit = (1.0, 0.0)
    shot_perp = (-shot_unit[1], shot_unit[0])
    for frame in frames:
        if frame.frame_number < start or frame.frame_number > end:
            continue
        player = frame.players.get(player_key, {})
        hip = player.get(f"{plant}_hip")
        knee = player.get(f"{plant}_knee")
        ankle = player.get(f"{plant}_ankle")
        pelvis = player.get("pelvis")
        if hip and knee and ankle:
            legacy_deviations.append(_point_line_distance(knee, hip, ankle))
            projection = _project_point_on_line(knee, hip, ankle)
            lateral_deviations.append(_dot2((knee.x - projection.x, knee.y - projection.y), shot_perp))
        if pelvis and ankle:
            com_distances.append(math.hypot(pelvis.x - ankle.x, pelvis.y - ankle.y))
    legacy_stdev = _std(legacy_deviations) if len(legacy_deviations) >= 2 else math.nan
    lateral_stdev = _std(lateral_deviations) if len(lateral_deviations) >= 2 else math.nan
    mean_com_distance = sum(com_distances) / len(com_distances) if com_distances else math.nan
    return {
        "plant_knee_valgus_stdev_m": legacy_stdev,
        "plant_knee_lateral_track_stdev_m": lateral_stdev,
        # CALIBRATION: provisional, derived from Bayern_Hamburg n=30.
        "knee_stability_score": lin_low(lateral_stdev, 0.06, 0.16) if not math.isnan(lateral_stdev) else math.nan,
        "com_over_plant_foot_score": lin_low(mean_com_distance, 0.15, 0.85) if not math.isnan(mean_com_distance) else math.nan,
    }


def _project_point_on_line(point: Vec3, start: Vec3, end: Vec3) -> Vec3:
    line = Vec3(end.x - start.x, end.y - start.y, end.z - start.z)
    denom = _dot3(line, line)
    if denom <= 0:
        return start
    t = _clamp(_dot3(Vec3(point.x - start.x, point.y - start.y, point.z - start.z), line) / denom)
    return Vec3(start.x + t * line.x, start.y + t * line.y, start.z + t * line.z)


def _point_line_distance(point: Vec3, start: Vec3, end: Vec3) -> float:
    line = Vec3(end.x - start.x, end.y - start.y, end.z - start.z)
    rel = Vec3(point.x - start.x, point.y - start.y, point.z - start.z)
    denom = _vec_norm(line)
    if denom <= 0:
        return _vec_norm(rel)
    cross = Vec3(
        rel.y * line.z - rel.z * line.y,
        rel.z * line.x - rel.x * line.z,
        rel.x * line.y - rel.y * line.x,
    )
    return _vec_norm(cross) / denom


def _ankle_rigidity_features(frames: list[SkeletonFrame], player_key: tuple[int, int], foot: str | None, contact_index: int) -> dict[str, Any]:
    if foot not in {"left", "right"}:
        return {"ankle_toe_angle_delta_deg": math.nan, "ankle_rigidity_score": math.nan}
    before = max(0, contact_index - 1)
    after = min(len(frames) - 1, contact_index + 1)
    angle_before = _ankle_toe_angle(frames[before].players.get(player_key, {}), foot)
    angle_after = _ankle_toe_angle(frames[after].players.get(player_key, {}), foot)
    delta = angle_error_deg(angle_after, angle_before) if not math.isnan(angle_before) and not math.isnan(angle_after) else math.nan
    return {
        "ankle_toe_angle_delta_deg": delta,
        "ankle_rigidity_score": lin_low(delta, 5.0, 30.0) if not math.isnan(delta) else math.nan,
    }


def _ankle_toe_angle(player: dict[str, Vec3], foot: str) -> float:
    ankle = player.get(f"{foot}_ankle")
    toe = player.get(f"{foot}_toe")
    if not ankle or not toe:
        return math.nan
    return math.degrees(math.atan2(toe.y - ankle.y, toe.x - ankle.x))


def _proximal_distal_features(
    frames: list[SkeletonFrame],
    player_key: tuple[int, int],
    foot: str | None,
    contact_frame: int,
    *,
    frame_rate: int,
) -> dict[str, Any]:
    start = contact_frame + PHASE_OFFSETS["P3"][0]
    end = contact_frame + PHASE_OFFSETS["P4"][1]
    window = [frame for frame in frames if start <= frame.frame_number <= end]
    hip_series = [(frame.frame_number, _axis_angle(frame.players.get(player_key, {}), "hip")) for frame in window]
    shoulder_series = [(frame.frame_number, _axis_angle(frame.players.get(player_key, {}), "shoulder")) for frame in window]
    knee_series = [(frame.frame_number, _joint_angle_series(frame.players.get(player_key, {}), foot, "knee")) for frame in window]
    foot_series = [(frame.frame_number, _foot_speed_at_frame(frames, index, player_key, foot, frame_rate=frame_rate)) for index, frame in enumerate(frames) if start <= frame.frame_number <= end]
    hip_peak, hip_frame = _peak_derivative_abs(hip_series, frame_rate=frame_rate)
    shoulder_peak, shoulder_frame = _peak_derivative_abs(shoulder_series, frame_rate=frame_rate)
    knee_peak, knee_frame = _peak_derivative_abs(knee_series, frame_rate=frame_rate)
    foot_peak, foot_frame = _peak_value(foot_series)
    ordered = [
        hip_frame is not None and shoulder_frame is not None and hip_frame <= shoulder_frame,
        shoulder_frame is not None and knee_frame is not None and shoulder_frame <= knee_frame,
        knee_frame is not None and foot_frame is not None and knee_frame <= foot_frame,
    ]
    available = [value for value in ordered if value is not None]
    sequence_score = sum(1.0 for value in available if value) / len(available) if available else math.nan
    return {
        "hip_peak_angular_velocity_dps": hip_peak,
        "shoulder_peak_angular_velocity_dps": shoulder_peak,
        "knee_peak_angular_velocity_dps": knee_peak,
        "foot_peak_velocity_at_contact": foot_peak,
        "proximal_distal_sequencing_score": sequence_score,
    }


def _axis_angle(player: dict[str, Vec3], axis: str) -> float:
    if axis == "hip":
        left, right = player.get("left_hip"), player.get("right_hip")
    else:
        left, right = player.get("left_shoulder"), player.get("right_shoulder")
    if not left or not right:
        return math.nan
    return math.degrees(math.atan2(right.y - left.y, right.x - left.x))


def _joint_angle_series(player: dict[str, Vec3], foot: str | None, joint: str) -> float:
    if foot not in {"left", "right"} or joint != "knee":
        return math.nan
    hip, knee, ankle = (player.get(f"{foot}_{name}") for name in ("hip", "knee", "ankle"))
    if not hip or not knee or not ankle:
        return math.nan
    return _joint_angle(hip, knee, ankle)


def _foot_speed_at_frame(frames: list[SkeletonFrame], index: int, player_key: tuple[int, int], foot: str | None, *, frame_rate: int) -> float:
    if foot not in {"left", "right"} or index <= 0:
        return math.nan
    current = frames[index].players.get(player_key, {}).get(f"{foot}_ankle")
    previous = frames[index - 1].players.get(player_key, {}).get(f"{foot}_ankle")
    if not current or not previous:
        return math.nan
    dt_frames = max(1, frames[index].frame_number - frames[index - 1].frame_number)
    return _distance(current, previous) * frame_rate / dt_frames


def _peak_derivative_abs(series: list[tuple[int, float]], *, frame_rate: int) -> tuple[float, int | None]:
    clean = [(frame, value) for frame, value in series if not math.isnan(value)]
    if len(clean) < 2:
        return math.nan, None
    peaks = []
    for (prev_frame, prev_value), (frame, value) in zip(clean, clean[1:]):
        dt_frames = max(1, frame - prev_frame)
        velocity = abs(angle_error_deg(value, prev_value)) * frame_rate / dt_frames
        peaks.append((velocity, frame))
    if not peaks:
        return math.nan, None
    velocity, frame = max(peaks, key=lambda item: item[0])
    return velocity, frame


def _peak_value(series: list[tuple[float | int, float]]) -> tuple[float, int | None]:
    clean = [(float(value), int(frame)) for frame, value in series if not math.isnan(float(value))]
    if not clean:
        return math.nan, None
    value, frame = max(clean, key=lambda item: item[0])
    return value, frame


def _non_kicking_arm_abduction(frames: list[SkeletonFrame], player_key: tuple[int, int], foot: str | None, contact_frame: int) -> dict[str, Any]:
    side = "left" if foot == "right" else "right" if foot == "left" else None
    if side is None:
        return {"non_kicking_arm_abduction_deg": math.nan}
    start = contact_frame + PHASE_OFFSETS["P3"][0]
    end = contact_frame + PHASE_OFFSETS["P4"][1]
    values = []
    for frame in frames:
        if frame.frame_number < start or frame.frame_number > end:
            continue
        player = frame.players.get(player_key, {})
        shoulder = player.get(f"{side}_shoulder")
        wrist = player.get(f"{side}_wrist") or player.get(f"{side}_elbow")
        neck = player.get("neck")
        if shoulder and wrist and neck:
            arm = Vec3(wrist.x - shoulder.x, wrist.y - shoulder.y, wrist.z - shoulder.z)
            torso = Vec3(neck.x - shoulder.x, neck.y - shoulder.y, neck.z - shoulder.z)
            denom = _vec_norm(arm) * _vec_norm(torso)
            if denom > 0:
                values.append(math.degrees(math.acos(_clamp(_dot3(arm, torso) / denom, -1, 1))))
    return {"non_kicking_arm_abduction_deg": max(values) if values else math.nan}


def _header_features(frames: list[SkeletonFrame], player_key: tuple[int, int], contact_index: int, *, frame_rate: int) -> dict[str, Any]:
    if not (0 <= contact_index < len(frames)):
        return _empty_header_features()
    contact = frames[contact_index]
    player = contact.players.get(player_key, {})
    ball = contact.ball
    head_points = [player.get(name) for name in ("nose", "left_ear", "right_ear")]
    head_points = [point for point in head_points if point is not None]
    proximity = min((_distance(point, ball) for point in head_points), default=math.nan) if ball else math.nan
    height = max((point.z for point in head_points), default=math.nan)
    trunk_values = []
    for index in range(max(0, contact_index - 3), min(len(frames), contact_index + 4)):
        trunk_values.append((frames[index].frame_number, _torso_lean(frames[index].players.get(player_key, {}))))
    trunk_delta, _frame = _peak_derivative_abs(trunk_values, frame_rate=frame_rate)
    return {
        "trunk_extension_to_flexion_delta_dps": trunk_delta,
        "forehead_contact_height_m": height,
        "head_ball_proximity_at_impact_m": proximity,
        "header_contact_score": _contact_near_score(proximity),
    }


def _empty_header_features() -> dict[str, Any]:
    return {
        "trunk_extension_to_flexion_delta_dps": math.nan,
        "forehead_contact_height_m": math.nan,
        "head_ball_proximity_at_impact_m": math.nan,
        "header_contact_score": math.nan,
    }


def _follow_through_features(
    frames: list[SkeletonFrame],
    player_key: tuple[int, int],
    foot: str | None,
    contact_frame: int,
    physics_exit_index: int,
    *,
    frame_rate: int,
) -> dict[str, Any]:
    ball_velocity = _position_delta_velocity(frames, physics_exit_index, frame_rate=frame_rate)
    if ball_velocity is None:
        ball_velocity = frames[physics_exit_index].ball_velocity if 0 <= physics_exit_index < len(frames) else None
    ball_direction = _normalize3(ball_velocity)
    p5_start = contact_frame + PHASE_OFFSETS["P5"][0]
    p5_end = contact_frame + PHASE_OFFSETS["P5"][1]
    window = [frame for frame in frames if p5_start <= frame.frame_number <= p5_end]
    if len(window) < 2 or ball_direction is None:
        return _empty_follow_through_features()

    first_player = window[0].players.get(player_key, {})
    last_player = window[-1].players.get(player_key, {})
    pelvis_start, pelvis_end = first_player.get("pelvis"), last_player.get("pelvis")
    com_score = _alignment_score(_vec_between(pelvis_start, pelvis_end), ball_direction)

    foot_score = math.nan
    if foot:
        foot_start = first_player.get(f"{foot}_ankle")
        foot_end = last_player.get(f"{foot}_ankle")
        foot_score = _alignment_score(_vec_between(foot_start, foot_end), ball_direction)

    balance_parts = []
    leans = [_torso_lean(frame.players.get(player_key, {})) for frame in window]
    leans = [lean for lean in leans if not math.isnan(lean)]
    if len(leans) >= 2:
        balance_parts.append(lin_low(_std(leans), 0.0, 12.0))
    if pelvis_start and pelvis_end:
        balance_parts.append(lin_low(max(0.0, pelvis_start.z - pelvis_end.z), 0.0, 0.35))
    balance_score = sum(balance_parts) / len(balance_parts) if balance_parts else math.nan

    return {
        "com_continuation_score": com_score,
        "follow_through_path_score": foot_score,
        "post_impact_balance_score": balance_score,
    }


def _empty_follow_through_features() -> dict[str, Any]:
    return {
        "com_continuation_score": math.nan,
        "follow_through_path_score": math.nan,
        "post_impact_balance_score": math.nan,
    }


def _vec_between(start: Vec3 | None, end: Vec3 | None) -> Vec3 | None:
    if start is None or end is None:
        return None
    return Vec3(end.x - start.x, end.y - start.y, end.z - start.z)


def _alignment_score(vector: Vec3 | None, direction: Vec3 | None) -> float:
    unit = _normalize3(vector)
    if unit is None or direction is None:
        return math.nan
    return lin_high(_dot3(unit, direction), 0.2, 0.9)


def _axis_separation(player: dict[str, Vec3]) -> float:
    ls, rs, lh, rh = (player.get(k) for k in ("left_shoulder", "right_shoulder", "left_hip", "right_hip"))
    if not all((ls, rs, lh, rh)):
        return math.nan
    return abs(_angle2((rs.x - ls.x, rs.y - ls.y), (rh.x - lh.x, rh.y - lh.y)))


def _torso_lean(player: dict[str, Vec3]) -> float:
    pelvis, neck = player.get("pelvis"), player.get("neck")
    if not pelvis or not neck:
        return math.nan
    horiz = math.hypot(neck.x - pelvis.x, neck.y - pelvis.y)
    return math.degrees(math.atan2(horiz, abs(neck.z - pelvis.z)))


def _knee_stability(player: dict[str, Vec3], foot: str | None) -> float:
    if foot is None:
        return 0.0
    hip, knee, ankle = (player.get(f"{foot}_{joint}") for joint in ("hip", "knee", "ankle"))
    if not hip or not knee or not ankle:
        return 0.5
    return _linear_high_good(_joint_angle(hip, knee, ankle), 90, 170)


def _joint_angle(a: Vec3, b: Vec3, c: Vec3) -> float:
    ba = (a.x - b.x, a.y - b.y, a.z - b.z)
    bc = (c.x - b.x, c.y - b.y, c.z - b.z)
    denom = _norm3(ba) * _norm3(bc)
    if denom == 0:
        return math.nan
    return math.degrees(math.acos(_clamp(sum(x * y for x, y in zip(ba, bc)) / denom, -1, 1)))


def _angle2(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.degrees(math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]))


def _score_exp(value: float | None, sigma: float) -> float:
    if value is None or math.isnan(value):
        return 0.0
    return math.exp(-max(0.0, value) / sigma)


def _contact_near_score(distance_m: float | None) -> float:
    if distance_m is None or math.isnan(distance_m):
        return 0.0
    return _score_exp(max(0.0, distance_m - BALL_RADIUS_M), 0.18)


def _distance(a: Vec3, b: Vec3) -> float:
    return math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)


def _vec_norm(v: Vec3 | None) -> float:
    return math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) if v else 0.0


def _norm3(v: tuple[float, float, float]) -> float:
    return math.sqrt(sum(x * x for x in v))


def _dot3(a: Vec3, b: Vec3) -> float:
    return a.x * b.x + a.y * b.y + a.z * b.z


def _normalize3(v: Vec3 | None) -> Vec3 | None:
    norm = _vec_norm(v)
    if v is None or norm <= 0:
        return None
    return Vec3(v.x / norm, v.y / norm, v.z / norm)


def _std(values: list[float]) -> float:
    if not values:
        return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((v - mean) ** 2 for v in values) / len(values))


def _mean_score(*values: float) -> float:
    clean = [_clamp(v) for v in values if not math.isnan(float(v))]
    return sum(clean) / len(clean) if clean else 0.0


def _component_or_feature(components: dict[str, float], features: dict[str, Any], component_key: str, feature_key: str, default: float) -> float:
    if feature_key in features:
        return _num(features.get(feature_key), default)
    return _num(components.get(component_key), default)


def _quality_mean(*values: Any, default: float = 0.0) -> float:
    clean = []
    for value in values:
        try:
            number = float(value)
        except (TypeError, ValueError):
            continue
        if not math.isnan(number):
            clean.append(_clamp(number))
    if not clean:
        return _clamp(default)
    return sum(clean) / len(clean)


def _availability_quality(values: list[Any]) -> float:
    if not values:
        return 0.0
    available = 0
    for value in values:
        if value is None or value == "":
            continue
        try:
            if math.isnan(float(value)):
                continue
        except (TypeError, ValueError):
            pass
        available += 1
    return available / len(values)


def _finite(value: Any) -> bool:
    try:
        return not math.isnan(float(value))
    except (TypeError, ValueError):
        return False


def _median(values: list[float]) -> float:
    clean = [float(value) for value in values if _finite(value)]
    if not clean:
        return math.nan
    ordered = sorted(clean)
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2


def _distance_xy(a: Vec3, b: Vec3) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def _goal_x(shot: ShotEvent) -> float:
    return 52.5 if shot.x >= 0 else -52.5


def _goal_vector_from_point(shot: ShotEvent, point: Vec3) -> tuple[float, float]:
    return (_goal_x(shot) - point.x, -point.y)


def _normalize2(v: tuple[float, float]) -> tuple[float, float]:
    norm = math.hypot(v[0], v[1])
    if norm == 0:
        return (1.0, 0.0)
    return (v[0] / norm, v[1] / norm)


def _dot2(a: tuple[float, float], b: tuple[float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1]


def _nearest_frame(frames: list[SkeletonFrame], frame_number: int) -> SkeletonFrame | None:
    if not frames:
        return None
    return min(frames, key=lambda frame: abs(frame.frame_number - frame_number))


def _body_ball_readiness(player: dict[str, Vec3], ball: Vec3, shot: ShotEvent) -> float:
    nose, neck = player.get("nose"), player.get("neck")
    if nose and neck:
        facing = (nose.x - neck.x, nose.y - neck.y)
    else:
        left, right = player.get("left_shoulder"), player.get("right_shoulder")
        if not left or not right:
            return math.nan
        axis = (right.x - left.x, right.y - left.y)
        facing = (axis[1], -axis[0])
    origin = neck or player.get("pelvis")
    if origin is None:
        return math.nan
    facing_angle = math.degrees(math.atan2(facing[1], facing[0]))
    to_ball = math.degrees(math.atan2(ball.y - origin.y, ball.x - origin.x))
    to_goal = math.degrees(math.atan2(-origin.y, _goal_x(shot) - origin.x))
    return 0.5 * math.exp(-0.5 * (angle_error_deg(facing_angle, to_ball) / 45.0) ** 2) + 0.5 * math.exp(-0.5 * (angle_error_deg(facing_angle, to_goal) / 60.0) ** 2)


def _trajectory_flatness(frames: list[SkeletonFrame]) -> float:
    points = [frame.ball for frame in frames[:25] if frame.ball is not None]
    if len(points) < 10:
        return math.nan
    start, end = points[0], points[-1]
    path = _distance(start, end)
    if path <= 0:
        return math.nan
    vx, vy, vz = end.x - start.x, end.y - start.y, end.z - start.z
    denom = math.sqrt(vx * vx + vy * vy + vz * vz)
    max_error = 0.0
    for point in points[1:-1]:
        wx, wy, wz = point.x - start.x, point.y - start.y, point.z - start.z
        cross = math.sqrt(
            (wy * vz - wz * vy) ** 2
            + (wz * vx - wx * vz) ** 2
            + (wx * vy - wy * vx) ** 2
        )
        max_error = max(max_error, cross / denom)
    return lin_low(max_error / path, 0.02, 0.18)


def _blocked_flight(frames: list[SkeletonFrame], *, frame_rate: int) -> bool:
    if len(frames) < 10:
        return True
    velocities = []
    for previous, current in zip(frames, frames[1:]):
        if previous.ball is None or current.ball is None:
            continue
        dt = max(1, current.frame_number - previous.frame_number)
        velocities.append(Vec3((current.ball.x - previous.ball.x) * frame_rate / dt, (current.ball.y - previous.ball.y) * frame_rate / dt, (current.ball.z - previous.ball.z) * frame_rate / dt))
    if len(velocities) < 4:
        return True
    first_speed = _vec_norm(velocities[0])
    if first_speed > 0 and min(_vec_norm(v) for v in velocities[: min(10, len(velocities))]) < 0.5 * first_speed:
        return True
    first_angle = math.degrees(math.atan2(velocities[0].y, velocities[0].x))
    for velocity in velocities[1 : min(10, len(velocities))]:
        if _vec_norm(velocity) > 0 and angle_error_deg(first_angle, math.degrees(math.atan2(velocity.y, velocity.x))) > 35:
            return True
    return False


def _empty_approach_features() -> dict[str, Any]:
    return {
        "p2_frame_count": 0,
        "approach_speed_m_s": math.nan,
        "approach_angle_deg": math.nan,
        "prep_ball_forward_m": math.nan,
        "prep_ball_lateral_m": math.nan,
        "ball_shooter_convergence_score": math.nan,
        "trunk_lean_approach_deg": math.nan,
        "stride_smoothness_score": math.nan,
        "body_ball_readiness_score": math.nan,
    }


def _empty_flight_features() -> dict[str, Any]:
    return {
        "initial_ball_velocity_x_m_s": math.nan,
        "initial_ball_velocity_y_m_s": math.nan,
        "initial_ball_velocity_z_m_s": math.nan,
        "initial_ball_speed_m_s": math.nan,
        "initial_goal_alignment_deg": math.nan,
        "initial_goal_alignment_score": math.nan,
        "goal_plane_y_m": math.nan,
        "goal_plane_z_m": math.nan,
        "goal_plane_lateral_score": math.nan,
        "goal_plane_vertical_score": math.nan,
        "trajectory_flatness_score": math.nan,
        "blocked_flight_flag": False,
        "p6_flight_frame_count": 0,
    }


def _empty_foot_kinematic_features() -> dict[str, Any]:
    return {
        "foot_velocity_into_ball_m_s": math.nan,
        "foot_speed_m_s": math.nan,
        "foot_velocity_into_ball_score": math.nan,
        "ball_to_foot_speed_ratio": math.nan,
        "ball_to_foot_speed_ratio_score": math.nan,
    }


def _keeper_context_score(shot: ShotEvent) -> tuple[float, float]:
    distance_score = lin_high(float(shot.keeper_distance_to_goal), 1.0, 7.0) if shot.keeper_distance_to_goal is not None else math.nan
    perp_score = math.nan
    if shot.keeper_x is not None and shot.keeper_y is not None:
        sx, sy = shot.x, shot.y
        gx, gy = _goal_x(shot), 0.0
        dx, dy = gx - sx, gy - sy
        denom = math.hypot(dx, dy)
        if denom > 0:
            perp = abs(dy * shot.keeper_x - dx * shot.keeper_y + gx * sy - gy * sx) / denom
            perp_score = lin_high(perp, 0.3, 2.0)
    scores = [score for score in (distance_score, perp_score) if not math.isnan(score)]
    if scores:
        return max(scores), 0.55
    return 0.5, 0.2


def _receiver_score(router: dict[str, Any], shot: ShotEvent) -> float:
    if _truthy(router.get("previous_receiver_is_shooter")) or router.get("previous_receiver_id") == shot.player_id:
        return 1.0
    previous_type = str(router.get("previous_event_type") or router.get("previous_play_type") or "").lower()
    if previous_type in {"carry", "dribble"}:
        return 0.55
    if router.get("previous_receiver_is_shooter") is None and router.get("previous_receiver_id") is None:
        return 0.25
    return 0.25


def _time_score(family: str, value: float) -> float:
    if family == "dead_ball":
        return 0.7
    if math.isnan(value):
        return 0.5
    if family in {"oneV", "cutback", "volley"}:
        return lin_low(value, 0.0, 1.5)
    return soft_band(value, 0.4, 4.0, 0.4, 3.0)


def _ball_height_score(family: str, value: float) -> float:
    if math.isnan(value):
        return 0.5
    if family == "volley":
        return lin_high(value, 0.35, 1.2)
    return soft_band(value, 0.0, 0.35, 0.05, 0.45)


def _family_context_affordance(family: str, shot: ShotEvent, router: dict[str, Any], ball_height: float | None) -> float:
    previous = str(router.get("previous_event_type") or router.get("previous_play_type") or "").lower()
    quick = _time_score(family, _num(router.get("time_from_reception_s"), _num(router.get("time_from_previous_event_s"), math.nan)))
    if family == "oneV":
        return weighted_mean_available([(lin_low(shot.distance_to_goal, 6, 20), 0.5, True), (quick, 0.5, True)])
    if family == "cutback":
        return 1.0 if "cross" in previous or _truthy(router.get("previous_is_cross")) else 0.6
    if family == "volley":
        height = lin_high(ball_height or math.nan, 0.35, 1.2) if ball_height is not None else 0.5
        return weighted_mean_available([(height, 0.6, True), (1.0 if "cross" in previous else 0.5, 0.4, True)])
    if family == "dead_ball":
        text = " ".join(str(value or "").lower() for value in (shot.type_of_shot, shot.extended_type_of_shot, previous))
        return 1.0 if any(word in text for word in ("free", "penalty", "corner", "restart")) or shot.is_free_kick or shot.is_penalty or shot.is_corner else 0.7
    return weighted_mean_available([(lin_low(shot.pressure, 0, 3), 0.6, True), (lin_low(shot.distance_to_goal, 20, 38), 0.4, True)])


def _approach_speed_score(family: str, speed: float) -> float:
    if family in {"long_range", "dead_ball"}:
        return soft_band(speed, 2.5, 6.5, 1.5, 2.5)
    if family == "volley":
        return soft_band(speed, 0.3, 4.0, 0.3, 2.0)
    return soft_band(speed, 1.0, 4.5, 1.0, 2.0)


def _approach_angle_score(family: str, angle: float) -> float:
    if family in {"long_range", "dead_ball"}:
        return soft_band(angle, 25.0, 45.0, 15.0, 25.0)
    if family == "volley":
        return soft_band(angle, 0.0, 60.0, 5.0, 35.0)
    return soft_band(angle, 0.0, 35.0, 5.0, 30.0)


def _prep_touch_offset_score(family: str, forward: float, lateral: float) -> float:
    if family in {"long_range", "dead_ball"}:
        forward_score = soft_band(forward, 0.9, 1.4, 0.5, 0.7)
    elif family == "volley":
        forward_score = soft_band(forward, 0.1, 1.6, 0.4, 1.0)
    else:
        forward_score = soft_band(forward, 0.2, 1.1, 0.4, 0.8)
    lateral_score = soft_band(abs(lateral), 0.1, 0.8, 0.1, 0.5)
    return _mean_score(forward_score, lateral_score)


def _trunk_approach_score(family: str, lean: float) -> float:
    if family == "volley":
        return soft_band(lean, 0.0, 35.0, 5.0, 25.0)
    return soft_band(lean, 5.0, 25.0, 5.0, 20.0)


def _shoulder_hip_family_score(family: str, value: float) -> float:
    if math.isnan(value):
        return math.nan
    if family == "cutback":
        return lin_low(max(0.0, value - 5.0), 0.0, 20.0)
    if family == "carry_self_created":
        return soft_band(value, 10.0, 25.0, 8.0, 15.0)
    if family in {"long_range", "dead_ball"}:
        return soft_band(value, 30.0, 45.0, 20.0, 15.0)
    if family == "volley":
        return soft_band(value, 15.0, 30.0, 15.0, 20.0)
    if family == "header":
        return math.nan
    return soft_band(value, 10.0, 35.0, 10.0, 15.0)


def _torso_extreme_score(lean: float) -> float:
    if math.isnan(lean):
        return math.nan
    return lin_low(max(0.0, abs(lean) - 35.0), 0.0, 25.0)


def _plant_forward_score(value: float) -> float:
    if math.isnan(value):
        return math.nan
    return soft_band(-value, 0.05, 0.10, 0.20, 0.25)


def _plant_lateral_score(value: float) -> float:
    if math.isnan(value):
        return math.nan
    return soft_band(abs(value), 0.05, 0.28, 0.10, 0.25)


def _ball_to_foot_ratio_score(value: float, *, family: str | None = None, foot_speed: float | None = None) -> float:
    if foot_speed is not None and not math.isnan(float(foot_speed)) and float(foot_speed) < 2.0:
        return math.nan
    if math.isnan(value):
        return math.nan
    if value > 8.0:
        return math.nan
    bands = {
        "oneV": (1.6, 2.4, 0.4, 0.8),
        "open_play": (1.6, 2.4, 0.4, 0.8),
        "cutback": (1.6, 2.4, 0.4, 0.8),
        "carry_self_created": (1.6, 2.4, 0.4, 0.8),
        "long_range": (1.8, 3.0, 0.4, 0.8),
        "dead_ball": (1.8, 3.0, 0.4, 0.8),
        "volley": (1.5, 2.4, 0.4, 0.6),
    }
    lo, hi, margin_lo, margin_hi = bands.get(family or "", (1.05, 1.65, 0.35, 0.5))
    return soft_band(value, lo, hi, margin_lo, margin_hi)


def _exit_speed_score(family: str, speed: float) -> float:
    if family == "oneV":
        return lin_high(speed, 8, 22)
    if family == "cutback":
        return lin_high(speed, 8, 24)
    if family == "long_range":
        return lin_high(speed, 14, 30)
    if family == "volley":
        return lin_high(speed, 10, 28)
    return lin_high(speed, 12, 30)


def _launch_score(family: str, angle: float) -> float:
    if family in {"oneV", "cutback"}:
        return soft_band(angle, -3, 12, 6, 15)
    if family == "long_range":
        return soft_band(angle, 0, 18, 8, 18)
    if family == "volley":
        return soft_band(angle, -5, 28, 8, 20)
    return soft_band(angle, 0, 25, 8, 20)


def _goal_lateral_score(value: float) -> float:
    if math.isnan(value):
        return math.nan
    inside = soft_band(value, -3.66, 3.66, 1.2, 1.2)
    corner_bonus = 0.5 + 0.5 * min(abs(value), 3.66) / 3.66
    return inside * corner_bonus


def _goal_vertical_score(family: str, value: float) -> float:
    if math.isnan(value):
        return math.nan
    if family in {"long_range", "dead_ball"}:
        return soft_band(value, 0.15, 2.25, 0.4, 0.5)
    if family == "volley":
        return soft_band(value, 0.05, 2.35, 0.5, 0.5)
    return soft_band(value, 0.05, 1.6, 0.35, 0.8)


def _optional_score(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        number = float(value)
        if math.isnan(number):
            return None
        return _clamp(number)
    except (TypeError, ValueError):
        return None


def _previous_event_type_score(value: Any) -> float:
    text = str(value or "").lower()
    if text in {"reception", "pass"}:
        return 1.0
    if "cross" in text or "cutback" in text:
        return 0.9
    if text in {"play", "carry"}:
        return 0.7
    if text:
        return 0.45
    return 0.25


def _shot_outcome_score(value: Any) -> float:
    text = str(value or "").lower()
    if "goal" in text or "successful" in text:
        return 0.9
    if "saved" in text or "post" in text or "woodwork" in text:
        return 0.6
    if "blocked" in text:
        return 0.35
    if "miss" in text or "wide" in text or "off" in text:
        return 0.2
    return 0.35


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).lower() in {"true", "1", "yes", "y"}


def _num(value: Any, default: float) -> float:
    try:
        if value is None or math.isnan(float(value)):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _linear_low_good(value: float, best: float, worst: float) -> float:
    return _clamp(1.0 - (value - best) / (worst - best))


def _linear_high_good(value: float, worst: float, best: float) -> float:
    return _clamp((value - worst) / (best - worst))


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    if math.isnan(float(value)):
        return low
    return max(low, min(high, value))


def _foot_from_text(text: str | None) -> str | None:
    text = (text or "").lower()
    if "left" in text:
        return "left"
    if "right" in text:
        return "right"
    return None




def _required(el: ET.Element, name: str) -> str:
    value = el.get(name)
    if value is None:
        raise ValueError(f"Missing required attribute {name}")
    return value


def _float_attr(el: ET.Element, name: str, *, default: float | None = None) -> float:
    value = el.get(name)
    if value is None:
        if default is None:
            raise ValueError(f"Missing required float attribute {name}")
        return default
    return float(value)


def _optional_float(value: str | None) -> float | None:
    return float(value) if value not in (None, "") else None


def _optional_int(value: str | None) -> int | None:
    return int(value) if value not in (None, "") else None


def _distance_to_goal_from_xy(x: float, y: float) -> float:
    goal_x = 52.5 if x >= 0 else -52.5
    return math.hypot(goal_x - x, y)


def _is_true(value: str | None) -> bool:
    return str(value).lower() == "true"


def _normalize_section(value: str | None) -> str:
    text = (value or "firstHalf").lower()
    return "secondHalf" if "second" in text or text in {"2", "second"} else "firstHalf"
