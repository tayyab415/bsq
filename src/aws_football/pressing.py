from __future__ import annotations

import math
import xml.etree.ElementTree as ET
from itertools import combinations
from dataclasses import dataclass
from typing import Any

from aws_football.dribble_pose import MatchContext, PlayerInfo, SkeletonFrame, Vec3


PRESSING_TRACKING_PARTS = {
    "pelvis",
    "neck",
    "nose",
    "left_ear",
    "right_ear",
    "left_shoulder",
    "right_shoulder",
    "left_hip",
    "right_hip",
}

PRESS_OUTCOME_SCORES = {
    "regain": 1.0,
    "second_ball_win": 0.85,
    "forced_clearance": 0.75,
    "out_of_play": 0.60,
    "forced_reset_or_recycle": 0.55,
    "harmless_reset": 0.35,
    "harmless_circulation": 0.25,
    "opponent_clean_escape": 0.0,
}

PRESS_ATTEMPT_THRESHOLD = 0.30

TRACKING_DETAIL_FIELDS = frozenset(
    {
        "tracking_sampled",
        "tracking_error",
        "tracking_window_start_frame",
        "tracking_window_end_frame",
        "tracking_frame_number",
        "short_options_count",
        "tracking_ball_carrier_pressure_score",
        "tracking_team_denial_score",
        "tracking_option_denial_score",
        "tracking_pressing_impact_score",
        "top_ball_presser_id",
        "top_ball_presser_name",
        "top_ball_presser_score",
        "top_option_denier_id",
        "top_option_denier_name",
        "top_option_denier_score",
        "top_pair_player_ids",
        "top_pair_player_names",
        "top_pair_pressure_score",
    }
)

TRACKING_INTERNAL_FIELDS = frozenset(
    {
        "player_marginal_credits",
        "pair_synergy_credits",
    }
)

TRACKING_SAMPLE_CONTEXT_FIELDS = [
    "match_folder",
    "event_id",
    "action_type",
    "possession_team_id",
    "possession_team_name",
    "pressing_team_id",
    "pressing_team_name",
    "ball_carrier_id",
    "ball_carrier_name",
    "receiver_id",
    "receiver_name",
    "frame",
    "section",
    "final_pressing_impact_score",
    "final_score_source",
    "tracking_required",
    "tracking_status",
    "press_state",
    "press_state_reason",
    "press_attempt",
    "press_attempt_score",
    "press_outcome",
    "press_outcome_reason",
    "outcome_event_id",
    "outcome_event_type",
    "outcome_team_id",
    "outcome_frame",
    "outcome_vertical_gain",
    "turnover_created",
    "long_ball_forced",
]


@dataclass(frozen=True)
class KpiPlayAction:
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
    evaluation: str | None
    is_pass: bool
    is_goal_kick: bool
    is_free_kick: bool
    is_throw_in: bool
    is_corner: bool
    is_kickoff: bool
    distance: float | None
    max_height: float | None
    pressure_on_player: float | None
    pressure_on_receiver: float | None
    distance_closest_defender: float | None
    num_defenders_passing_lane: int | None
    num_defenders_goal_side: int | None
    bypassed_defenders: int | None
    xp: float | None
    direction_of_play: str | None

    @property
    def ball_xy(self) -> tuple[float, float]:
        return (self.x, self.y)

    @property
    def receiver_xy(self) -> tuple[float, float] | None:
        if self.receiver_x is None or self.receiver_y is None:
            return None
        return (self.receiver_x, self.receiver_y)


@dataclass(frozen=True)
class PressingOpportunity:
    match_folder: str
    event_id: str
    action_type: str
    possession_team_id: str
    pressing_team_id: str
    ball_carrier_id: str
    receiver_id: str | None
    frame: int
    section: str
    window_start_frame: int
    window_end_frame: int
    ball_xy: tuple[float, float]
    receiver_xy: tuple[float, float] | None
    evaluation: str | None
    distance: float | None
    max_height: float | None
    pressure_on_player: float | None
    pressure_on_receiver: float | None
    distance_closest_defender: float | None
    num_defenders_passing_lane: int | None
    bypassed_defenders: int | None
    xp: float | None
    tracking_required: bool


@dataclass(frozen=True)
class KpiOutcomeEvent:
    event_id: str
    event_type: str
    team_id: str | None
    frame: int
    section: str
    x: float | None = None
    y: float | None = None
    evaluation: str | None = None
    distance: float | None = None
    max_height: float | None = None
    bypassed_defenders: int | None = None
    vertical_gain: float | None = None
    is_interception: bool = False
    is_defensive_clearance: bool = False


def parse_kpi_play_actions(xml_text: str) -> list[KpiPlayAction]:
    root = ET.fromstring(xml_text)
    actions: list[KpiPlayAction] = []
    for el in root.iter("Play"):
        if not _is_true(el.get("SyncSuccessful")):
            continue
        frame = _optional_int(el.get("SyncedFrameId"))
        x = _optional_float(el.get("X-Position"))
        y = _optional_float(el.get("Y-Position"))
        if frame is None or x is None or y is None:
            continue
        actions.append(
            KpiPlayAction(
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
                evaluation=el.get("Evaluation"),
                is_pass=_is_true(el.get("IsPass")),
                is_goal_kick=_is_true(el.get("IsGoalKick")),
                is_free_kick=_is_true(el.get("IsFreeKick")),
                is_throw_in=_is_true(el.get("IsThrowIn")),
                is_corner=_is_true(el.get("IsCorner")),
                is_kickoff=_is_true(el.get("IsKickOff")),
                distance=_optional_float(el.get("Distance")),
                max_height=_optional_float(el.get("MaxHeight")),
                pressure_on_player=_optional_float(el.get("PressureOnPlayer")),
                pressure_on_receiver=_optional_float(el.get("PressureOnReceiver")),
                distance_closest_defender=_optional_float(el.get("DistanceClosestDefenderToPlayer")),
                num_defenders_passing_lane=_optional_int(el.get("NumDefendersPassingLane")),
                num_defenders_goal_side=_optional_int(el.get("NumDefendersGoalSide")),
                bypassed_defenders=_optional_int(el.get("ByPassedDefenders")),
                xp=_optional_float(el.get("xP")),
                direction_of_play=el.get("DirectionOfPlay"),
            )
        )
    return actions


def parse_kpi_outcome_events(xml_text: str) -> list[KpiOutcomeEvent]:
    root = ET.fromstring(xml_text)
    events: list[KpiOutcomeEvent] = []
    for el in root.iter():
        if el.tag not in {"Play", "Reception", "Carry", "TacklingGame", "OtherBallAction"}:
            continue
        if not _is_true(el.get("SyncSuccessful")):
            continue
        frame = _optional_int(el.get("SyncedFrameId"))
        if frame is None:
            continue
        section = _normalize_section(el.get("InGameSection") or el.get("GameSection") or "firstHalf")
        if el.tag == "TacklingGame":
            events.append(
                KpiOutcomeEvent(
                    event_id=_required(el, "EventId"),
                    event_type="tackle",
                    team_id=el.get("WinnerTeamId"),
                    frame=frame,
                    section=section,
                    x=_optional_float(el.get("X-Position")),
                    y=_optional_float(el.get("Y-Position")),
                )
            )
        elif el.tag == "Carry":
            start_x = _optional_float(el.get("X-Position"))
            end_x = _optional_float(el.get("X-EndPosition"))
            events.append(
                KpiOutcomeEvent(
                    event_id=_required(el, "EventId"),
                    event_type="carry",
                    team_id=el.get("TeamId"),
                    frame=frame,
                    section=section,
                    x=start_x,
                    y=_optional_float(el.get("Y-Position")),
                    distance=_optional_float(el.get("Distance")),
                    vertical_gain=None if start_x is None or end_x is None else abs(end_x - start_x),
                )
            )
        else:
            events.append(
                KpiOutcomeEvent(
                    event_id=_required(el, "EventId"),
                    event_type=_outcome_event_type(el.tag),
                    team_id=el.get("TeamId"),
                    frame=frame,
                    section=section,
                    x=_optional_float(el.get("X-Position")),
                    y=_optional_float(el.get("Y-Position")),
                    evaluation=el.get("Evaluation"),
                    distance=_optional_float(el.get("Distance")),
                    max_height=_optional_float(el.get("MaxHeight")),
                    bypassed_defenders=_optional_int(el.get("ByPassedDefenders")),
                    is_interception=_is_true(el.get("IsInterception")),
                    is_defensive_clearance=_is_true(el.get("IsDefensiveClearance")),
                )
            )
    return sorted(events, key=lambda event: (event.section, event.frame, event.event_id))


def build_pressing_opportunities(
    context: MatchContext,
    actions: list[KpiPlayAction],
    *,
    pre_action_seconds: float = 2.0,
    post_action_seconds: float = 3.0,
    frame_rate_25hz: int = 25,
    include_goal_kicks: bool = True,
    include_restarts: bool = True,
) -> list[PressingOpportunity]:
    opportunities: list[PressingOpportunity] = []
    for action in actions:
        if action.is_corner or action.is_kickoff:
            continue
        if action.is_goal_kick and not include_goal_kicks:
            continue
        if (action.is_free_kick or action.is_throw_in) and not include_restarts:
            continue
        if not _is_own_half_action(context, action):
            continue
        pressing_team_id = _opponent_team_id(context, action.team_id)
        if pressing_team_id is None:
            continue
        tracking_required = _tracking_required_for_action(action)
        opportunities.append(
            PressingOpportunity(
                match_folder=context.match_folder,
                event_id=action.event_id,
                action_type=_action_type(action),
                possession_team_id=action.team_id,
                pressing_team_id=pressing_team_id,
                ball_carrier_id=action.player_id,
                receiver_id=action.receiver_id,
                frame=action.frame,
                section=action.section,
                window_start_frame=action.frame - int(round(pre_action_seconds * frame_rate_25hz)),
                window_end_frame=action.frame + int(round(post_action_seconds * frame_rate_25hz)),
                ball_xy=action.ball_xy,
                receiver_xy=action.receiver_xy,
                evaluation=action.evaluation,
                distance=action.distance,
                max_height=action.max_height,
                pressure_on_player=action.pressure_on_player,
                pressure_on_receiver=action.pressure_on_receiver,
                distance_closest_defender=action.distance_closest_defender,
                num_defenders_passing_lane=action.num_defenders_passing_lane,
                bypassed_defenders=action.bypassed_defenders,
                xp=action.xp,
                tracking_required=tracking_required,
            )
        )
    return opportunities


def compute_kpi_pressing_scores(opportunity: PressingOpportunity) -> dict[str, Any]:
    pressure_score = _ball_carrier_pressure_score(opportunity)
    receiver_score = _scaled_pressure(opportunity.pressure_on_receiver)
    lane_score = _passing_lane_score(opportunity.num_defenders_passing_lane)
    xpass_denial = None if opportunity.xp is None else _clamp01(1.0 - opportunity.xp)
    option_score = _weighted_mean(
        [
            (receiver_score, 0.40),
            (lane_score, 0.40),
            (xpass_denial, 0.20),
        ]
    )
    impact_score = _aggregate_impact_score(opportunity, pressure_score, option_score)
    return {
        "match_folder": opportunity.match_folder,
        "event_id": opportunity.event_id,
        "action_type": opportunity.action_type,
        "possession_team_id": opportunity.possession_team_id,
        "pressing_team_id": opportunity.pressing_team_id,
        "ball_carrier_id": opportunity.ball_carrier_id,
        "receiver_id": opportunity.receiver_id,
        "frame": opportunity.frame,
        "section": opportunity.section,
        "window_start_frame": opportunity.window_start_frame,
        "window_end_frame": opportunity.window_end_frame,
        "ball_x": opportunity.ball_xy[0],
        "ball_y": opportunity.ball_xy[1],
        "receiver_x": None if opportunity.receiver_xy is None else opportunity.receiver_xy[0],
        "receiver_y": None if opportunity.receiver_xy is None else opportunity.receiver_xy[1],
        "evaluation": opportunity.evaluation,
        "distance": opportunity.distance,
        "max_height": opportunity.max_height,
        "pressure_on_player": opportunity.pressure_on_player,
        "pressure_on_receiver": opportunity.pressure_on_receiver,
        "distance_closest_defender": opportunity.distance_closest_defender,
        "num_defenders_passing_lane": opportunity.num_defenders_passing_lane,
        "bypassed_defenders": opportunity.bypassed_defenders,
        "xp": opportunity.xp,
        "ball_carrier_pressure_score": pressure_score,
        "receiver_pressure_score": receiver_score,
        "passing_lane_denial_score": lane_score,
        "xpass_denial_score": xpass_denial,
        "option_denial_score": option_score,
        "pressing_impact_score": impact_score,
        "final_pressing_impact_score": impact_score,
        "final_score_source": "kpi" if impact_score is not None else "tracking_required",
        "tracking_required": opportunity.tracking_required,
    }


def compute_tracking_pressing_scores(
    context: MatchContext,
    opportunity: PressingOpportunity,
    frames: list[SkeletonFrame],
    *,
    frame_rate: int = 50,
    short_option_radius_m: float = 45.0,
) -> dict[str, Any]:
    frames = sorted(frames, key=lambda frame: frame.frame_number)
    if not frames:
        return _empty_tracking_scores()
    previous_frame = frames[-2] if len(frames) >= 2 else None
    current_frame = frames[-1]
    players_by_key = {player.parquet_key: player for player in context.players_by_id.values()}
    key_by_player_id = {player.person_id: player.parquet_key for player in context.players_by_id.values()}
    carrier_key = key_by_player_id.get(opportunity.ball_carrier_id)
    carrier_parts = current_frame.players.get(carrier_key, {}) if carrier_key is not None else {}
    carrier_position = carrier_parts.get("pelvis") or current_frame.ball or Vec3(opportunity.ball_xy[0], opportunity.ball_xy[1], 0.0)
    defender_keys = [
        key
        for key, player in players_by_key.items()
        if player.team_id == opportunity.pressing_team_id and key in current_frame.players
    ]
    possession_keys = [
        key
        for key, player in players_by_key.items()
        if player.team_id == opportunity.possession_team_id and key in current_frame.players and key != carrier_key
    ]

    per_defender: list[dict[str, Any]] = []
    for defender_key in defender_keys:
        player = players_by_key[defender_key]
        parts = current_frame.players.get(defender_key, {})
        previous_parts = previous_frame.players.get(defender_key, {}) if previous_frame else {}
        score = _tracking_pressure_to_target(parts, previous_parts, carrier_position, frame_rate=frame_rate)
        if score is None:
            continue
        per_defender.append({"key": defender_key, "player": player, "ball_pressure": score})

    short_options = _short_option_keys(
        possession_keys,
        current_frame,
        carrier_position,
        radius_m=short_option_radius_m,
    )
    option_scores_by_option = _option_scores_by_option(
        defender_keys,
        short_options,
        current_frame,
        previous_frame,
        carrier_position,
        frame_rate=frame_rate,
    )
    option_denier_scores = _max_option_denier_scores(option_scores_by_option)

    top_ball = max(per_defender, key=lambda row: row["ball_pressure"], default=None)
    ball_pressure = top_ball["ball_pressure"] if top_ball else None
    option_denial = _team_denial_from_option_scores(option_scores_by_option, defender_keys)
    player_marginal_credits = _player_marginal_credits(
        players_by_key,
        defender_keys,
        option_scores_by_option,
        option_denial,
    )
    pair_synergy_credits = _pair_synergy_credits(
        players_by_key,
        defender_keys,
        option_scores_by_option,
        option_denial,
    )
    tracking_impact = _weighted_mean([(ball_pressure, 0.50), (option_denial, 0.50)])
    pair_candidates = []
    defender_total_scores: dict[tuple[int, int], float] = {}
    for row in per_defender:
        defender_total_scores[row["key"]] = max(row["ball_pressure"], option_denier_scores.get(row["key"], 0.0))
    for key, score in option_denier_scores.items():
        defender_total_scores[key] = max(defender_total_scores.get(key, 0.0), score)
    for key, score in defender_total_scores.items():
        player = players_by_key[key]
        pair_candidates.append((key, player, score))
    pair_candidates.sort(key=lambda item: item[2], reverse=True)
    top_pair = pair_candidates[:2]
    pair_score = None
    if len(top_pair) == 1:
        pair_score = top_pair[0][2]
    elif len(top_pair) >= 2:
        pair_score = 1.0 - (1.0 - top_pair[0][2]) * (1.0 - top_pair[1][2])
    top_denier_key = max(option_denier_scores, key=option_denier_scores.get, default=None)
    top_denier = players_by_key.get(top_denier_key) if top_denier_key is not None else None
    top_denier_score = option_denier_scores.get(top_denier_key) if top_denier_key is not None else None
    return {
        "tracking_sampled": True,
        "tracking_frame_number": current_frame.frame_number,
        "short_options_count": len(short_options),
        "tracking_ball_carrier_pressure_score": ball_pressure,
        "tracking_team_denial_score": option_denial,
        "tracking_option_denial_score": option_denial,
        "tracking_pressing_impact_score": tracking_impact,
        "final_pressing_impact_score": tracking_impact,
        "final_score_source": "tracking" if tracking_impact is not None else "tracking_missing",
        "top_ball_presser_id": top_ball["player"].person_id if top_ball else None,
        "top_ball_presser_name": top_ball["player"].short_name if top_ball else None,
        "top_ball_presser_score": ball_pressure,
        "top_option_denier_id": top_denier.person_id if top_denier else None,
        "top_option_denier_name": top_denier.short_name if top_denier else None,
        "top_option_denier_score": top_denier_score,
        "top_pair_player_ids": ",".join(player.person_id for _, player, _ in top_pair),
        "top_pair_player_names": ",".join(player.short_name for _, player, _ in top_pair),
        "top_pair_pressure_score": pair_score,
        "player_marginal_credits": player_marginal_credits,
        "pair_synergy_credits": pair_synergy_credits,
    }


def build_pressing_score_rows(context: MatchContext, kpi_xml_text: str) -> list[dict[str, Any]]:
    actions = parse_kpi_play_actions(kpi_xml_text)
    opportunities = build_pressing_opportunities(context, actions)
    rows = []
    for opportunity in opportunities:
        row = compute_kpi_pressing_scores(opportunity)
        row.update(_annotation_fields(context, opportunity))
        rows.append(row)
    return rows


def classify_press_state(row: dict[str, Any]) -> dict[str, Any]:
    ball_pressure = _first_numeric(row, ["tracking_ball_carrier_pressure_score", "ball_carrier_pressure_score"])
    team_denial = _first_numeric(row, ["tracking_team_denial_score", "option_denial_score"])
    receiver_pressure = _first_numeric(row, ["receiver_pressure_score"])
    bypassed = _numeric_value(row.get("bypassed_defenders")) or 0.0
    distance = _numeric_value(row.get("distance")) or 0.0
    max_height = _numeric_value(row.get("max_height")) or 0.0
    evaluation = str(row.get("evaluation") or "").strip()
    attempt_score = max(value for value in [ball_pressure or 0.0, team_denial or 0.0, receiver_pressure or 0.0])
    press_attempt = attempt_score >= PRESS_ATTEMPT_THRESHOLD
    completed = evaluation == "successfullyCompleted"
    unsuccessful = evaluation in {"unsuccessful", "notSuccessfullyCompleted", "intercepted"}
    forced_direct = distance >= 30.0 or max_height >= 3.0
    valuable_escape = completed and bypassed >= 2.0
    if not press_attempt:
        state = "no_press_attempt"
        reason = "pressure_and_denial_below_attempt_threshold"
    elif valuable_escape and attempt_score >= 0.35:
        state = "broken_press"
        reason = "attempt_made_but_opponent_bypassed_multiple_defenders"
    elif attempt_score >= 0.35 and (forced_direct or unsuccessful or receiver_pressure is not None and receiver_pressure >= 0.35):
        state = "active_press"
        reason = "meaningful_pressure_or_denial_forced_direct_or_failed_action"
    elif (team_denial or 0.0) >= 0.30 and (ball_pressure or 0.0) < 0.35:
        state = "containment"
        reason = "options_restricted_without_strong_ball_carrier_pressure"
    elif attempt_score >= 0.35:
        state = "active_press"
        reason = "meaningful_pressure_or_denial"
    else:
        state = "containment"
        reason = "low_intensity_attempt_with_some_option_restriction"
    return {
        "press_state": state,
        "press_state_reason": reason,
        "press_attempt": press_attempt,
        "press_attempt_score": attempt_score,
    }


def annotate_press_states(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for row in rows:
        row.update(classify_press_state(row))
    return rows


def classify_press_outcome(
    row: dict[str, Any],
    outcome_events: list[KpiOutcomeEvent],
    *,
    horizon_frames: int = 250,
) -> dict[str, Any]:
    possession_team_id = row.get("possession_team_id")
    pressing_team_id = row.get("pressing_team_id")
    frame = int(row.get("frame") or 0)
    section = str(row.get("section") or "")
    future_events = [
        event
        for event in outcome_events
        if event.section == section
        and event.frame > frame
        and event.frame <= frame + horizon_frames
        and event.event_id != row.get("event_id")
    ]
    if not future_events:
        return _outcome_row("outcome_unknown", "no_synced_kpi_event_in_horizon")
    first = future_events[0]
    direct_play = (_numeric_value(row.get("distance")) or 0.0) >= 30.0 or (_numeric_value(row.get("max_height")) or 0.0) >= 3.0
    bypassed = _numeric_value(row.get("bypassed_defenders")) or 0.0
    first_pressing_event = next((event for event in future_events if event.team_id == pressing_team_id), None)
    first_possession_event = next((event for event in future_events if event.team_id == possession_team_id), None)
    clearance = next(
        (
            event
            for event in future_events
            if event.team_id == possession_team_id and event.is_defensive_clearance
        ),
        None,
    )
    if clearance is not None and (first_pressing_event is None or clearance.frame <= first_pressing_event.frame):
        return _outcome_row(
            "forced_clearance",
            "possession_team_next_action_is_defensive_clearance",
            event=clearance,
            turnover_created=False,
            long_ball_forced=direct_play,
        )
    if first_pressing_event is not None and (first_possession_event is None or first_pressing_event.frame <= first_possession_event.frame):
        if direct_play and first_pressing_event.event_type not in {"reception", "tackle"}:
            return _outcome_row(
                "second_ball_win",
                "pressing_team_controls_next_phase_after_direct_ball",
                event=first_pressing_event,
                turnover_created=True,
                long_ball_forced=True,
            )
        return _outcome_row(
            "regain",
            "pressing_team_has_next_control_event",
            event=first_pressing_event,
            turnover_created=True,
            long_ball_forced=direct_play,
        )
    if str(row.get("evaluation") or "") != "successfullyCompleted":
        return _outcome_row(
            "out_of_play",
            "unsuccessful_action_without_synced_pressing_team_control",
            event=first,
            turnover_created=False,
            long_ball_forced=direct_play,
        )
    if bypassed >= 2.0:
        return _outcome_row(
            "opponent_clean_escape",
            "completed_action_bypassed_multiple_defenders",
            event=first_possession_event or first,
            vertical_gain=_event_vertical_gain(first_possession_event),
            long_ball_forced=direct_play,
        )
    possession_vertical_gain = _event_vertical_gain(first_possession_event)
    if possession_vertical_gain is not None and possession_vertical_gain >= 12.0:
        return _outcome_row(
            "opponent_clean_escape",
            "possession_team_progressed_vertically_after_press",
            event=first_possession_event,
            vertical_gain=possession_vertical_gain,
            long_ball_forced=direct_play,
        )
    press_state = str(row.get("press_state") or classify_press_state(row)["press_state"])
    press_attempt_score = _numeric_value(row.get("press_attempt_score"))
    if press_attempt_score is None:
        press_attempt_score = _numeric_value(classify_press_state(row).get("press_attempt_score")) or 0.0
    if press_state in {"active_press", "containment"} or press_attempt_score >= PRESS_ATTEMPT_THRESHOLD:
        return _outcome_row(
            "forced_reset_or_recycle",
            "possession_team_recycled_under_pressure_without_major_progression",
            event=first_possession_event or first,
            vertical_gain=possession_vertical_gain,
            long_ball_forced=direct_play,
        )
    return _outcome_row(
        "harmless_circulation",
        "possession_team_kept_ball_without_major_progression_or_pressure",
        event=first_possession_event or first,
        vertical_gain=possession_vertical_gain,
        long_ball_forced=direct_play,
    )


def annotate_press_outcomes(
    rows: list[dict[str, Any]],
    outcome_events: list[KpiOutcomeEvent],
    *,
    horizon_frames: int = 250,
) -> list[dict[str, Any]]:
    for row in rows:
        row.update(classify_press_outcome(row, outcome_events, horizon_frames=horizon_frames))
    return rows


def compact_pressing_opportunity_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    compact_rows = []
    for row in rows:
        compact_row = {
            key: value
            for key, value in row.items()
            if key not in TRACKING_DETAIL_FIELDS and key not in TRACKING_INTERNAL_FIELDS
        }
        compact_row["tracking_status"] = _tracking_status(row)
        compact_rows.append(compact_row)
    return compact_rows


def tracking_sample_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    sample_rows = []
    for row in rows:
        if row.get("tracking_sampled") is not True and not _has_value(row.get("tracking_error")):
            continue
        sample_row = {field: row.get(field) for field in TRACKING_SAMPLE_CONTEXT_FIELDS if field != "tracking_status"}
        sample_row["tracking_status"] = _tracking_status(row)
        for field in TRACKING_DETAIL_FIELDS:
            sample_row[field] = row.get(field)
        sample_rows.append(sample_row)
    return sample_rows


def column_coverage_rows(file_name: str, rows: list[dict[str, Any]], fields: list[str]) -> list[dict[str, Any]]:
    row_count = len(rows)
    coverage_rows = []
    for field in fields:
        non_empty_count = sum(1 for row in rows if _has_value(row.get(field)))
        coverage_rows.append(
            {
                "file": file_name,
                "column": field,
                "column_group": _column_group(field),
                "row_count": row_count,
                "non_empty_count": non_empty_count,
                "empty_count": row_count - non_empty_count,
                "non_empty_fraction": None if row_count == 0 else non_empty_count / row_count,
                "note": _column_note(field),
            }
        )
    return coverage_rows


def build_player_pressing_credit_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    credits: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        if row.get("tracking_sampled") is not True:
            continue
        event_id = str(row.get("event_id") or "")
        team_id = str(row.get("pressing_team_id") or "")
        team_name = str(row.get("pressing_team_name") or team_id)
        _add_player_role_credit(
            credits,
            team_id=team_id,
            team_name=team_name,
            event_id=event_id,
            player_id=row.get("top_ball_presser_id"),
            player_name=row.get("top_ball_presser_name"),
            score=_numeric_value(row.get("top_ball_presser_score")),
            role="ball",
        )
        _add_player_role_credit(
            credits,
            team_id=team_id,
            team_name=team_name,
            event_id=event_id,
            player_id=row.get("top_option_denier_id"),
            player_name=row.get("top_option_denier_name"),
            score=_numeric_value(row.get("top_option_denier_score")),
            role="option",
        )
        pair_score = _numeric_value(row.get("top_pair_pressure_score"))
        pair_players = _pair_players(row)
        if pair_score is not None and pair_players:
            split_score = pair_score / len(pair_players)
            for player_id, player_name in pair_players:
                _add_player_role_credit(
                    credits,
                    team_id=team_id,
                    team_name=team_name,
                    event_id=event_id,
                    player_id=player_id,
                    player_name=player_name,
                    score=split_score,
                    role="pair",
                )
    credit_rows = []
    for row in credits.values():
        sampled_window_count = len(row.pop("_event_ids"))
        ball_sum = row.pop("_ball_sum")
        option_sum = row.pop("_option_sum")
        pair_sum = row.pop("_pair_sum")
        role_credit_sum = ball_sum + option_sum + pair_sum
        row.update(
            {
                "sampled_window_count": sampled_window_count,
                "ball_pressure_credit_sum": ball_sum,
                "ball_pressure_credit_mean": _safe_mean(ball_sum, row["ball_presser_count"]),
                "option_denial_credit_sum": option_sum,
                "option_denial_credit_mean": _safe_mean(option_sum, row["option_denier_count"]),
                "pair_pressure_credit_sum": pair_sum,
                "pair_pressure_credit_mean": _safe_mean(pair_sum, row["pair_member_count"]),
                "role_credit_sum": role_credit_sum,
                "role_credit_mean": _safe_mean(role_credit_sum, sampled_window_count),
            }
        )
        credit_rows.append(row)
    return sorted(credit_rows, key=lambda row: (-row["role_credit_sum"], row["player_name"], row["player_id"]))


def build_pair_pressing_credit_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    credits: dict[tuple[str, tuple[str, ...]], dict[str, Any]] = {}
    for row in rows:
        if row.get("tracking_sampled") is not True:
            continue
        pair_score = _numeric_value(row.get("top_pair_pressure_score"))
        pair_players = _pair_players(row)
        if pair_score is None or len(pair_players) == 0:
            continue
        team_id = str(row.get("pressing_team_id") or "")
        team_name = str(row.get("pressing_team_name") or team_id)
        names_by_id = {player_id: player_name for player_id, player_name in pair_players}
        pair_ids = tuple(sorted(player_id for player_id, _ in pair_players))
        key = (team_id, pair_ids)
        credit = credits.setdefault(
            key,
            {
                "pressing_team_id": team_id,
                "pressing_team_name": team_name,
                "pair_player_ids": ",".join(pair_ids),
                "pair_player_names": ",".join(names_by_id[player_id] for player_id in pair_ids),
                "sampled_window_count": 0,
                "pair_pressure_credit_sum": 0.0,
                "max_pair_pressure_score": None,
            },
        )
        credit["sampled_window_count"] += 1
        credit["pair_pressure_credit_sum"] += pair_score
        current_max = credit["max_pair_pressure_score"]
        credit["max_pair_pressure_score"] = pair_score if current_max is None else max(current_max, pair_score)
    credit_rows = []
    for row in credits.values():
        row["pair_pressure_credit_mean"] = _safe_mean(row["pair_pressure_credit_sum"], row["sampled_window_count"])
        credit_rows.append(row)
    return sorted(credit_rows, key=lambda row: (-row["pair_pressure_credit_sum"], row["pair_player_names"]))


def build_marginal_player_credit_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    marginal_rows = []
    for row in rows:
        if row.get("tracking_sampled") is not True:
            continue
        for credit in row.get("player_marginal_credits") or []:
            marginal_rows.append(
                {
                    "match_folder": row.get("match_folder"),
                    "event_id": row.get("event_id"),
                    "action_type": row.get("action_type"),
                    "pressing_team_id": row.get("pressing_team_id"),
                    "pressing_team_name": row.get("pressing_team_name"),
                    "player_id": credit.get("player_id"),
                    "player_name": credit.get("player_name"),
                    "team_denial_score": credit.get("team_denial_score"),
                    "denial_without_player": credit.get("denial_without_player"),
                    "player_marginal_credit": credit.get("player_marginal_credit"),
                }
            )
    return sorted(
        marginal_rows,
        key=lambda row: (
            str(row.get("match_folder") or ""),
            str(row.get("event_id") or ""),
            -float(row.get("player_marginal_credit") or 0.0),
            str(row.get("player_name") or ""),
        ),
    )


def build_marginal_pair_synergy_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    synergy_rows = []
    for row in rows:
        if row.get("tracking_sampled") is not True:
            continue
        for credit in row.get("pair_synergy_credits") or []:
            synergy_rows.append(
                {
                    "match_folder": row.get("match_folder"),
                    "event_id": row.get("event_id"),
                    "action_type": row.get("action_type"),
                    "pressing_team_id": row.get("pressing_team_id"),
                    "pressing_team_name": row.get("pressing_team_name"),
                    "player_i_id": credit.get("player_i_id"),
                    "player_i_name": credit.get("player_i_name"),
                    "player_j_id": credit.get("player_j_id"),
                    "player_j_name": credit.get("player_j_name"),
                    "pair_player_ids": credit.get("pair_player_ids"),
                    "pair_player_names": credit.get("pair_player_names"),
                    "team_denial_score": credit.get("team_denial_score"),
                    "denial_without_i": credit.get("denial_without_i"),
                    "denial_without_j": credit.get("denial_without_j"),
                    "denial_without_both": credit.get("denial_without_both"),
                    "pair_synergy_credit": credit.get("pair_synergy_credit"),
                }
            )
    return sorted(
        synergy_rows,
        key=lambda row: (
            str(row.get("match_folder") or ""),
            str(row.get("event_id") or ""),
            -float(row.get("pair_synergy_credit") or 0.0),
            str(row.get("pair_player_names") or ""),
        ),
    )


def press_outcome_score(outcome: str | None) -> float | None:
    if outcome is None:
        return None
    return PRESS_OUTCOME_SCORES.get(str(outcome))


def build_pressing_kpi_opportunity_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    kpi_rows = []
    for row in rows:
        attempt_score = _numeric_value(row.get("press_attempt_score"))
        impact_score = _score_value(row)
        outcome_score = press_outcome_score(row.get("press_outcome"))
        components = [
            (attempt_score, 0.25),
            (impact_score, 0.35),
            (outcome_score, 0.40),
        ]
        score = _weighted_mean(components)
        populated_weights = [weight for value, weight in components if value is not None]
        component_weight = sum(populated_weights)
        kpi_rows.append(
            {
                "match_folder": row.get("match_folder"),
                "event_id": row.get("event_id"),
                "action_type": row.get("action_type"),
                "possession_team_id": row.get("possession_team_id"),
                "possession_team_name": row.get("possession_team_name"),
                "pressing_team_id": row.get("pressing_team_id"),
                "pressing_team_name": row.get("pressing_team_name"),
                "frame": row.get("frame"),
                "section": row.get("section"),
                "press_state": row.get("press_state"),
                "press_outcome": row.get("press_outcome"),
                "press_attempt_score": attempt_score,
                "pressing_impact_component_score": impact_score,
                "press_outcome_score": outcome_score,
                "pressing_kpi_score": score,
                "score_component_count": len(populated_weights),
                "score_component_weight": component_weight,
                "kpi_score_source": _kpi_score_source(row, impact_score, score),
                "kpi_confidence": _kpi_confidence(row, component_weight, score),
                "tracking_required": bool(row.get("tracking_required")),
                "tracking_sampled": bool(row.get("tracking_sampled")),
                "tracking_status": _tracking_status(row),
                "final_score_source": row.get("final_score_source"),
                "turnover_created": row.get("turnover_created"),
                "long_ball_forced": row.get("long_ball_forced"),
            }
        )
    return kpi_rows


def build_pressing_kpi_team_rows(kpi_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in kpi_rows:
        team_id = str(row.get("pressing_team_id") or "")
        grouped.setdefault(team_id, []).append(row)
    team_rows = []
    for team_id, rows in grouped.items():
        team_name = next((row.get("pressing_team_name") for row in rows if row.get("pressing_team_name")), team_id)
        scored = [_numeric_value(row.get("pressing_kpi_score")) for row in rows]
        numeric_scores = [score for score in scored if score is not None]
        score_sum = sum(numeric_scores)
        team_rows.append(
            {
                "pressing_team_id": team_id,
                "pressing_team_name": team_name,
                "opportunity_count": len(rows),
                "scored_opportunity_count": len(numeric_scores),
                "pressing_kpi_sum": score_sum,
                "pressing_kpi_mean": _safe_mean(score_sum, len(numeric_scores)),
                "pressing_kpi_high_count": sum(1 for score in numeric_scores if score >= 0.6),
                "press_attempt_mean": _mean_key(rows, "press_attempt_score"),
                "pressing_impact_component_mean": _mean_key(rows, "pressing_impact_component_score"),
                "press_outcome_score_mean": _mean_key(rows, "press_outcome_score"),
                "tracking_required_count": sum(1 for row in rows if bool(row.get("tracking_required"))),
                "tracking_required_fraction": _mean_bool(rows, "tracking_required"),
                "tracking_sampled_count": sum(1 for row in rows if bool(row.get("tracking_sampled"))),
                "tracking_sampled_fraction": _mean_bool(rows, "tracking_sampled"),
                "regain_count": _count_value(rows, "press_outcome", "regain"),
                "second_ball_win_count": _count_value(rows, "press_outcome", "second_ball_win"),
                "forced_clearance_count": _count_value(rows, "press_outcome", "forced_clearance"),
                "out_of_play_count": _count_value(rows, "press_outcome", "out_of_play"),
                "forced_reset_or_recycle_count": _count_value(rows, "press_outcome", "forced_reset_or_recycle"),
                "harmless_reset_count": _count_value(rows, "press_outcome", "harmless_reset"),
                "harmless_circulation_count": _count_value(rows, "press_outcome", "harmless_circulation"),
                "clean_escape_count": _count_value(rows, "press_outcome", "opponent_clean_escape"),
                "active_press_count": _count_value(rows, "press_state", "active_press"),
                "containment_count": _count_value(rows, "press_state", "containment"),
                "broken_press_count": _count_value(rows, "press_state", "broken_press"),
                "no_press_attempt_count": _count_value(rows, "press_state", "no_press_attempt"),
            }
        )
    return sorted(
        team_rows,
        key=lambda row: (
            -(row["pressing_kpi_mean"] if row["pressing_kpi_mean"] is not None else -1.0),
            -row["opportunity_count"],
            str(row["pressing_team_name"]),
        ),
    )


def build_pressing_kpi_player_rows(marginal_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for row in marginal_rows:
        credit = _numeric_value(row.get("player_marginal_credit"))
        if credit is None or not _has_value(row.get("player_id")):
            continue
        team_id = str(row.get("pressing_team_id") or "")
        player_id = str(row.get("player_id"))
        aggregate = grouped.setdefault(
            (team_id, player_id),
            {
                "pressing_team_id": team_id,
                "pressing_team_name": str(row.get("pressing_team_name") or team_id),
                "player_id": player_id,
                "player_name": str(row.get("player_name") or player_id),
                "credit_row_count": 0,
                "marginal_credit_sum": 0.0,
                "positive_marginal_credit_sum": 0.0,
                "negative_marginal_credit_sum": 0.0,
                "max_marginal_credit": None,
                "min_marginal_credit": None,
                "_event_ids": set(),
            },
        )
        aggregate["credit_row_count"] += 1
        aggregate["marginal_credit_sum"] += credit
        if credit >= 0:
            aggregate["positive_marginal_credit_sum"] += credit
        else:
            aggregate["negative_marginal_credit_sum"] += credit
        aggregate["max_marginal_credit"] = _max_optional(aggregate["max_marginal_credit"], credit)
        aggregate["min_marginal_credit"] = _min_optional(aggregate["min_marginal_credit"], credit)
        if _has_value(row.get("event_id")):
            aggregate["_event_ids"].add(str(row.get("event_id")))
    player_rows = []
    for row in grouped.values():
        sampled_count = len(row.pop("_event_ids")) or row["credit_row_count"]
        row["sampled_opportunity_count"] = sampled_count
        row["marginal_credit_mean"] = _safe_mean(row["marginal_credit_sum"], sampled_count)
        player_rows.append(row)
    return sorted(
        player_rows,
        key=lambda row: (-row["marginal_credit_sum"], str(row["player_name"]), str(row["player_id"])),
    )


def build_pressing_kpi_pair_rows(marginal_pair_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for row in marginal_pair_rows:
        credit = _numeric_value(row.get("pair_synergy_credit"))
        if credit is None or not _has_value(row.get("pair_player_ids")):
            continue
        team_id = str(row.get("pressing_team_id") or "")
        pair_ids = str(row.get("pair_player_ids"))
        aggregate = grouped.setdefault(
            (team_id, pair_ids),
            {
                "pressing_team_id": team_id,
                "pressing_team_name": str(row.get("pressing_team_name") or team_id),
                "pair_player_ids": pair_ids,
                "pair_player_names": str(row.get("pair_player_names") or pair_ids),
                "credit_row_count": 0,
                "synergy_credit_sum": 0.0,
                "positive_synergy_sum": 0.0,
                "negative_synergy_sum": 0.0,
                "max_synergy_credit": None,
                "min_synergy_credit": None,
                "_event_ids": set(),
            },
        )
        aggregate["credit_row_count"] += 1
        aggregate["synergy_credit_sum"] += credit
        if credit >= 0:
            aggregate["positive_synergy_sum"] += credit
        else:
            aggregate["negative_synergy_sum"] += credit
        aggregate["max_synergy_credit"] = _max_optional(aggregate["max_synergy_credit"], credit)
        aggregate["min_synergy_credit"] = _min_optional(aggregate["min_synergy_credit"], credit)
        if _has_value(row.get("event_id")):
            aggregate["_event_ids"].add(str(row.get("event_id")))
    pair_rows = []
    for row in grouped.values():
        sampled_count = len(row.pop("_event_ids")) or row["credit_row_count"]
        row["sampled_opportunity_count"] = sampled_count
        row["synergy_credit_mean"] = _safe_mean(row["synergy_credit_sum"], sampled_count)
        pair_rows.append(row)
    return sorted(
        pair_rows,
        key=lambda row: (-row["synergy_credit_sum"], str(row["pair_player_names"]), str(row["pair_player_ids"])),
    )


def summarize_pressing_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        team_id = str(row.get("pressing_team_id") or "")
        grouped.setdefault(team_id, []).append(row)
    summary = []
    for team_id, team_rows in grouped.items():
        team_name = next((row.get("pressing_team_name") for row in team_rows if row.get("pressing_team_name")), team_id)
        summary.append(
            {
                "pressing_team_id": team_id,
                "pressing_team_name": team_name,
                "opportunity_count": len(team_rows),
                "scored_opportunity_count": _count_scores(team_rows),
                "tracking_required_count": sum(1 for row in team_rows if bool(row.get("tracking_required"))),
                "tracking_required_fraction": _mean_bool(team_rows, "tracking_required"),
                "pressing_impact_mean": _mean_score(team_rows),
                "ball_carrier_pressure_mean": _mean_key(team_rows, "ball_carrier_pressure_score"),
                "option_denial_mean": _mean_key(team_rows, "option_denial_score"),
                "high_impact_count": sum(
                    1
                    for row in team_rows
                    if _score_value(row) is not None and _score_value(row) >= 0.6
                ),
            }
        )
    return sorted(summary, key=lambda row: (-row["opportunity_count"], row["pressing_team_name"]))


def render_pressing_readme(
    *,
    opportunity_count: int,
    summary_count: int,
    match_scope: str,
    tracking_sample_count: int = 0,
    player_credit_count: int = 0,
    pair_credit_count: int = 0,
    marginal_player_count: int = 0,
    marginal_pair_count: int = 0,
    kpi_opportunity_count: int = 0,
    kpi_team_count: int = 0,
    kpi_player_count: int = 0,
    kpi_pair_count: int = 0,
    coverage_count: int = 0,
) -> str:
    return f"""# Build-Up Pressing First Metric

This directory is generated by `scripts/build_pressing_metrics.py`.

The first metric covers opponent-own-half build-up opportunities, including open-play deep passes and restarts such as goal kicks. It now exposes a final KPI layer over three transparent components:

- opportunity window selection: `t - 2s` to `t + 3s` around the KPI action frame.
- option denial and ball-carrier pressure from local KPI fields.
- final outcome pressure effect: regain, second-ball win, forced clearance, forced reset/recycle, harmless circulation, out of play, or clean escape.

Rows:

- `opportunities.csv`: {opportunity_count} compact opportunity/action row(s) for {match_scope}.
- `tracking_samples.csv`: {tracking_sample_count} tracking diagnostic row(s), including sampled windows or row-level S3 errors.
- `player_pressing_credits.csv`: {player_credit_count} individual credit row(s) from sampled tracking windows.
- `pair_pressing_credits.csv`: {pair_credit_count} pair credit row(s) from sampled tracking windows.
- `marginal_player_credits.csv`: {marginal_player_count} player row(s) using `team_denial - denial_without_player`.
- `marginal_pair_synergies.csv`: {marginal_pair_count} pair row(s) using inclusion-exclusion removal credit.
- `pressing_kpi_by_opportunity.csv`: {kpi_opportunity_count} final KPI row(s), combining attempt, impact, and outcome components.
- `pressing_kpi_by_team.csv`: {kpi_team_count} team rollup row(s) for the final build-up pressing KPI.
- `pressing_kpi_by_player.csv`: {kpi_player_count} individual marginal-credit rollup row(s).
- `pressing_kpi_by_pair.csv`: {kpi_pair_count} pair synergy rollup row(s).
- `summary_by_pressing_team.csv`: {summary_count} team summary row(s).
- `column_coverage.csv`: {coverage_count} row(s) explaining which output columns are populated.

Important caveat:

Goal kicks are kept in the dataset. Many goal-kick rows do not expose KPI ball-carrier pressure, `xP`, or passing-lane pressure, so they are flagged with `tracking_required=true` and `tracking_status=required_pending` until a tiny parquet window is sampled. Sparse tracking-only diagnostics live in `tracking_samples.csv` instead of widening the main opportunity table. `press_state` and `press_outcome` are transparent heuristic labels, not learned models.
"""


def _is_own_half_action(context: MatchContext, action: KpiPlayAction) -> bool:
    if action.direction_of_play:
        direction = action.direction_of_play.strip()
        if direction == "leftToRight":
            return action.x <= 0
        if direction == "rightToLeft":
            return action.x >= 0
    team = context.teams_by_id.get(action.team_id)
    if team is None:
        return False
    home_gk_left = context.phase_home_gk_left.get(action.section)
    if home_gk_left is None:
        return False
    team_gk_left = bool(home_gk_left) if team.role == "home" else not bool(home_gk_left)
    return action.x <= 0 if team_gk_left else action.x >= 0


def _annotation_fields(context: MatchContext, opportunity: PressingOpportunity) -> dict[str, Any]:
    possession_team = context.teams_by_id.get(opportunity.possession_team_id)
    pressing_team = context.teams_by_id.get(opportunity.pressing_team_id)
    carrier = context.players_by_id.get(opportunity.ball_carrier_id)
    receiver = context.players_by_id.get(opportunity.receiver_id or "")
    return {
        "possession_team_name": possession_team.name if possession_team else opportunity.possession_team_id,
        "pressing_team_name": pressing_team.name if pressing_team else opportunity.pressing_team_id,
        "ball_carrier_name": carrier.short_name if carrier else opportunity.ball_carrier_id,
        "receiver_name": receiver.short_name if receiver else opportunity.receiver_id,
    }


def _opponent_team_id(context: MatchContext, team_id: str) -> str | None:
    team_ids = [candidate for candidate in context.teams_by_id if candidate != team_id]
    if len(team_ids) != 1:
        return None
    return team_ids[0]


def _outcome_event_type(tag: str) -> str:
    return {
        "Play": "play",
        "Reception": "reception",
        "OtherBallAction": "other_ball_action",
    }.get(tag, tag)


def _outcome_row(
    outcome: str,
    reason: str,
    *,
    event: KpiOutcomeEvent | None = None,
    vertical_gain: float | None = None,
    turnover_created: bool = False,
    long_ball_forced: bool = False,
) -> dict[str, Any]:
    gain = vertical_gain if vertical_gain is not None else _event_vertical_gain(event)
    return {
        "press_outcome": outcome,
        "press_outcome_reason": reason,
        "outcome_event_id": None if event is None else event.event_id,
        "outcome_event_type": None if event is None else event.event_type,
        "outcome_team_id": None if event is None else event.team_id,
        "outcome_frame": None if event is None else event.frame,
        "outcome_vertical_gain": gain,
        "turnover_created": turnover_created,
        "long_ball_forced": long_ball_forced,
    }


def _event_vertical_gain(event: KpiOutcomeEvent | None) -> float | None:
    if event is None:
        return None
    return event.vertical_gain


def _action_type(action: KpiPlayAction) -> str:
    if action.is_goal_kick:
        return "goal_kick"
    if action.is_free_kick:
        return "free_kick"
    if action.is_throw_in:
        return "throw_in"
    if action.is_pass:
        return "open_play_pass"
    return "open_play_action"


def _tracking_required_for_action(action: KpiPlayAction) -> bool:
    if action.is_goal_kick:
        return action.pressure_on_player is None or action.num_defenders_passing_lane is None
    return action.pressure_on_player is None and action.distance_closest_defender is None


def _empty_tracking_scores(*, sampled: bool = False, frame_number: int | None = None) -> dict[str, Any]:
    return {
        "tracking_sampled": sampled,
        "tracking_frame_number": frame_number,
        "short_options_count": 0,
        "tracking_ball_carrier_pressure_score": None,
        "tracking_team_denial_score": None,
        "tracking_option_denial_score": None,
        "tracking_pressing_impact_score": None,
        "final_pressing_impact_score": None,
        "final_score_source": "tracking_missing",
        "top_ball_presser_id": None,
        "top_ball_presser_name": None,
        "top_ball_presser_score": None,
        "top_option_denier_id": None,
        "top_option_denier_name": None,
        "top_option_denier_score": None,
        "top_pair_player_ids": "",
        "top_pair_player_names": "",
        "top_pair_pressure_score": None,
        "player_marginal_credits": [],
        "pair_synergy_credits": [],
    }


def _option_scores_by_option(
    defender_keys: list[tuple[int, int]],
    short_options: list[tuple[int, int]],
    current_frame: SkeletonFrame,
    previous_frame: SkeletonFrame | None,
    carrier_position: Vec3,
    *,
    frame_rate: int,
) -> dict[tuple[int, int], dict[tuple[int, int], float]]:
    scores_by_option: dict[tuple[int, int], dict[tuple[int, int], float]] = {}
    for option_key in short_options:
        option_parts = current_frame.players.get(option_key, {})
        option_position = option_parts.get("pelvis")
        if option_position is None:
            continue
        scores_by_defender: dict[tuple[int, int], float] = {}
        for defender_key in defender_keys:
            defender_parts = current_frame.players.get(defender_key, {})
            previous_parts = previous_frame.players.get(defender_key, {}) if previous_frame else {}
            receiver_pressure = _tracking_pressure_to_target(
                defender_parts,
                previous_parts,
                option_position,
                frame_rate=frame_rate,
            )
            lane_score = _lane_block_score(defender_parts.get("pelvis"), carrier_position, option_position)
            defender_option_score = _weighted_mean([(receiver_pressure, 0.55), (lane_score, 0.45)])
            if defender_option_score is not None:
                scores_by_defender[defender_key] = defender_option_score
        if scores_by_defender:
            scores_by_option[option_key] = scores_by_defender
    return scores_by_option


def _max_option_denier_scores(
    option_scores_by_option: dict[tuple[int, int], dict[tuple[int, int], float]],
) -> dict[tuple[int, int], float]:
    option_denier_scores: dict[tuple[int, int], float] = {}
    for scores_by_defender in option_scores_by_option.values():
        for defender_key, score in scores_by_defender.items():
            option_denier_scores[defender_key] = max(option_denier_scores.get(defender_key, 0.0), score)
    return option_denier_scores


def _team_denial_from_option_scores(
    option_scores_by_option: dict[tuple[int, int], dict[tuple[int, int], float]],
    active_defender_keys: list[tuple[int, int]] | set[tuple[int, int]],
) -> float | None:
    if not option_scores_by_option:
        return None
    active_keys = set(active_defender_keys)
    option_scores = []
    for scores_by_defender in option_scores_by_option.values():
        active_scores = [score for key, score in scores_by_defender.items() if key in active_keys]
        option_scores.append(max(active_scores) if active_scores else 0.0)
    return sum(option_scores) / len(option_scores)


def _player_marginal_credits(
    players_by_key: dict[tuple[int, int], PlayerInfo],
    defender_keys: list[tuple[int, int]],
    option_scores_by_option: dict[tuple[int, int], dict[tuple[int, int], float]],
    team_denial: float | None,
) -> list[dict[str, Any]]:
    if team_denial is None:
        return []
    defender_set = set(defender_keys)
    rows = []
    for defender_key in defender_keys:
        player = players_by_key[defender_key]
        denial_without_player = _team_denial_from_option_scores(
            option_scores_by_option,
            defender_set - {defender_key},
        )
        denial_without_player = 0.0 if denial_without_player is None else denial_without_player
        rows.append(
            {
                "player_id": player.person_id,
                "player_name": player.short_name,
                "team_denial_score": team_denial,
                "denial_without_player": denial_without_player,
                "player_marginal_credit": team_denial - denial_without_player,
            }
        )
    return sorted(rows, key=lambda row: (-row["player_marginal_credit"], row["player_name"], row["player_id"]))


def _pair_synergy_credits(
    players_by_key: dict[tuple[int, int], PlayerInfo],
    defender_keys: list[tuple[int, int]],
    option_scores_by_option: dict[tuple[int, int], dict[tuple[int, int], float]],
    team_denial: float | None,
) -> list[dict[str, Any]]:
    if team_denial is None:
        return []
    defender_set = set(defender_keys)
    rows = []
    for key_i, key_j in combinations(defender_keys, 2):
        player_i = players_by_key[key_i]
        player_j = players_by_key[key_j]
        denial_without_i = _team_denial_from_option_scores(option_scores_by_option, defender_set - {key_i}) or 0.0
        denial_without_j = _team_denial_from_option_scores(option_scores_by_option, defender_set - {key_j}) or 0.0
        denial_without_both = _team_denial_from_option_scores(
            option_scores_by_option,
            defender_set - {key_i, key_j},
        )
        denial_without_both = 0.0 if denial_without_both is None else denial_without_both
        pair_synergy = team_denial - denial_without_i - denial_without_j + denial_without_both
        rows.append(
            {
                "player_i_id": player_i.person_id,
                "player_i_name": player_i.short_name,
                "player_j_id": player_j.person_id,
                "player_j_name": player_j.short_name,
                "pair_player_ids": f"{player_i.person_id},{player_j.person_id}",
                "pair_player_names": f"{player_i.short_name},{player_j.short_name}",
                "team_denial_score": team_denial,
                "denial_without_i": denial_without_i,
                "denial_without_j": denial_without_j,
                "denial_without_both": denial_without_both,
                "pair_synergy_credit": pair_synergy,
            }
        )
    return sorted(rows, key=lambda row: (-row["pair_synergy_credit"], row["pair_player_names"]))


def _short_option_keys(
    possession_keys: list[tuple[int, int]],
    frame: SkeletonFrame,
    carrier_position: Vec3,
    *,
    radius_m: float,
) -> list[tuple[int, int]]:
    options = []
    for key in possession_keys:
        parts = frame.players.get(key, {})
        pelvis = parts.get("pelvis")
        if pelvis is None:
            continue
        if _distance_xy(pelvis, carrier_position) <= radius_m:
            options.append(key)
    return options


def _tracking_pressure_to_target(
    defender_parts: dict[str, Vec3],
    previous_defender_parts: dict[str, Vec3],
    target: Vec3,
    *,
    frame_rate: int,
) -> float | None:
    defender_position = defender_parts.get("pelvis")
    if defender_position is None:
        return None
    distance = _distance_xy(defender_position, target)
    proximity = math.exp(-distance / 5.0)
    previous_position = previous_defender_parts.get("pelvis")
    closing_score = None
    if previous_position is not None:
        previous_distance = _distance_xy(previous_position, target)
        closing_speed = (previous_distance - distance) * frame_rate
        closing_score = _clamp01((closing_speed + 1.0) / 8.0)
    orientation = _orientation_to_target(defender_parts, target)
    return _weighted_mean([(proximity, 0.70), (closing_score, 0.20), (orientation, 0.10)])


def _orientation_to_target(parts: dict[str, Vec3], target: Vec3) -> float | None:
    anchor = parts.get("neck") or parts.get("pelvis")
    nose = parts.get("nose")
    if anchor is None or nose is None:
        return None
    head_vector = _normalize2((nose.x - anchor.x, nose.y - anchor.y))
    target_vector = _normalize2((target.x - anchor.x, target.y - anchor.y))
    if head_vector is None or target_vector is None:
        return None
    return _clamp01((_dot2(head_vector, target_vector) + 1.0) / 2.0)


def _lane_block_score(defender_position: Vec3 | None, origin: Vec3, target: Vec3) -> float | None:
    if defender_position is None:
        return None
    segment = (target.x - origin.x, target.y - origin.y)
    length_sq = segment[0] * segment[0] + segment[1] * segment[1]
    if length_sq == 0:
        return None
    defender_vector = (defender_position.x - origin.x, defender_position.y - origin.y)
    projection = (defender_vector[0] * segment[0] + defender_vector[1] * segment[1]) / length_sq
    clamped = max(0.0, min(1.0, projection))
    closest = Vec3(origin.x + segment[0] * clamped, origin.y + segment[1] * clamped, 0.0)
    distance = _distance_xy(defender_position, closest)
    lane_presence = math.exp(-distance / 3.0)
    between_bonus = 1.0 if 0.0 <= projection <= 1.0 else 0.5
    return _clamp01(lane_presence * between_bonus)


def _ball_carrier_pressure_score(opportunity: PressingOpportunity) -> float | None:
    pressure_score = _scaled_pressure(opportunity.pressure_on_player)
    if pressure_score is not None:
        return pressure_score
    if opportunity.distance_closest_defender is None:
        return None
    return math.exp(-max(0.0, opportunity.distance_closest_defender) / 3.0)


def _aggregate_impact_score(
    opportunity: PressingOpportunity,
    pressure_score: float | None,
    option_score: float | None,
) -> float | None:
    if opportunity.tracking_required and opportunity.action_type in {"goal_kick", "free_kick", "throw_in"}:
        return None
    return _weighted_mean(
        [
            (pressure_score, 0.50),
            (option_score, 0.50),
        ]
    )


def _scaled_pressure(value: float | None) -> float | None:
    if value is None:
        return None
    return _clamp01(value / 2.0)


def _passing_lane_score(value: int | None) -> float | None:
    if value is None:
        return None
    return _clamp01(1.0 - math.exp(-max(0, value) / 3.0))


def _weighted_mean(components: list[tuple[float | None, float]]) -> float | None:
    total = 0.0
    weight_total = 0.0
    for value, weight in components:
        if value is None:
            continue
        total += value * weight
        weight_total += weight
    if weight_total == 0.0:
        return None
    return total / weight_total


def _mean_key(rows: list[dict[str, Any]], key: str) -> float | None:
    values = [float(row[key]) for row in rows if _is_number(row.get(key))]
    if not values:
        return None
    return sum(values) / len(values)


def _mean_score(rows: list[dict[str, Any]]) -> float | None:
    values = [_score_value(row) for row in rows]
    numeric = [value for value in values if value is not None]
    if not numeric:
        return None
    return sum(numeric) / len(numeric)


def _score_value(row: dict[str, Any]) -> float | None:
    for key in ("final_pressing_impact_score", "pressing_impact_score"):
        value = row.get(key)
        if _is_number(value):
            return float(value)
    return None


def _mean_bool(rows: list[dict[str, Any]], key: str) -> float | None:
    if not rows:
        return None
    return sum(1.0 for row in rows if bool(row.get(key))) / len(rows)


def _count_numeric(rows: list[dict[str, Any]], key: str) -> int:
    return sum(1 for row in rows if _is_number(row.get(key)))


def _count_scores(rows: list[dict[str, Any]]) -> int:
    return sum(1 for row in rows if _score_value(row) is not None)


def _count_value(rows: list[dict[str, Any]], key: str, value: str) -> int:
    return sum(1 for row in rows if row.get(key) == value)


def _kpi_score_source(row: dict[str, Any], impact_score: float | None, score: float | None) -> str | None:
    source = row.get("final_score_source")
    if _has_value(source) and (impact_score is not None or str(source) == "tracking_required"):
        return str(source)
    if impact_score is not None:
        if _numeric_value(row.get("final_pressing_impact_score")) is not None:
            return "tracking"
        return "kpi"
    if score is not None:
        return "partial"
    return None


def _kpi_confidence(row: dict[str, Any], component_weight: float, score: float | None) -> float | None:
    if score is None:
        return None
    coverage = _clamp01(component_weight)
    if row.get("tracking_sampled") is True:
        return coverage
    if _has_value(row.get("tracking_error")):
        return min(coverage, 0.35)
    if bool(row.get("tracking_required")):
        return min(coverage, 0.45)
    return min(coverage, 0.70)


def _max_optional(current: float | None, candidate: float) -> float:
    return candidate if current is None else max(current, candidate)


def _min_optional(current: float | None, candidate: float) -> float:
    return candidate if current is None else min(current, candidate)


def _add_player_role_credit(
    credits: dict[tuple[str, str], dict[str, Any]],
    *,
    team_id: str,
    team_name: str,
    event_id: str,
    player_id: Any,
    player_name: Any,
    score: float | None,
    role: str,
) -> None:
    if not _has_value(player_id) or score is None:
        return
    player_id = str(player_id)
    credit = credits.setdefault(
        (team_id, player_id),
        {
            "pressing_team_id": team_id,
            "pressing_team_name": team_name,
            "player_id": player_id,
            "player_name": str(player_name or player_id),
            "ball_presser_count": 0,
            "option_denier_count": 0,
            "pair_member_count": 0,
            "_event_ids": set(),
            "_ball_sum": 0.0,
            "_option_sum": 0.0,
            "_pair_sum": 0.0,
        },
    )
    credit["_event_ids"].add(event_id)
    if role == "ball":
        credit["ball_presser_count"] += 1
        credit["_ball_sum"] += score
    elif role == "option":
        credit["option_denier_count"] += 1
        credit["_option_sum"] += score
    elif role == "pair":
        credit["pair_member_count"] += 1
        credit["_pair_sum"] += score


def _pair_players(row: dict[str, Any]) -> list[tuple[str, str]]:
    raw_ids = str(row.get("top_pair_player_ids") or "")
    raw_names = str(row.get("top_pair_player_names") or "")
    ids = [value for value in raw_ids.split(",") if value]
    names = [value for value in raw_names.split(",") if value]
    players = []
    for index, player_id in enumerate(ids):
        player_name = names[index] if index < len(names) else player_id
        players.append((player_id, player_name))
    return players


def _safe_mean(total: float, count: int) -> float | None:
    if count == 0:
        return None
    return total / count


def _numeric_value(value: Any) -> float | None:
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


def _first_numeric(row: dict[str, Any], keys: list[str]) -> float | None:
    for key in keys:
        value = _numeric_value(row.get(key))
        if value is not None:
            return value
    return None


def _tracking_status(row: dict[str, Any]) -> str:
    if _has_value(row.get("tracking_error")):
        return "error"
    if row.get("tracking_sampled") is True:
        return "sampled"
    if bool(row.get("tracking_required")):
        return "required_pending"
    return "not_required"


def _has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value != ""
    return True


def _column_group(field: str) -> str:
    if field.startswith("tracking") or field.startswith("top_") or field == "short_options_count":
        return "tracking_sample"
    if "score" in field or field.endswith("_source") or field == "tracking_status":
        return "metric"
    if field in {
        "pressure_on_player",
        "pressure_on_receiver",
        "distance_closest_defender",
        "num_defenders_passing_lane",
        "bypassed_defenders",
        "xp",
        "evaluation",
        "distance",
        "max_height",
    }:
        return "kpi_xml"
    if field.endswith("_x") or field.endswith("_y") or field in {"ball_x", "ball_y", "receiver_x", "receiver_y"}:
        return "geometry"
    if field.endswith("_id") or field.endswith("_name") or field in {"match_folder", "action_type", "section"}:
        return "identity"
    if field.endswith("_frame") or field in {"frame", "window_start_frame", "window_end_frame"}:
        return "time_window"
    return "other"


def _column_note(field: str) -> str:
    if field in TRACKING_DETAIL_FIELDS:
        return "Only populated in tracking_samples.csv for windows sampled from parquet."
    if _column_group(field) == "kpi_xml":
        return "Blank when the KPI XML does not expose this field for the action type."
    if field == "final_pressing_impact_score":
        return "Uses tracking score when sampled, otherwise the KPI score when available."
    if field == "tracking_status":
        return "sampled, required_pending, error, or not_required."
    return ""


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _distance_xy(a: Vec3, b: Vec3) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def _normalize2(vector: tuple[float, float]) -> tuple[float, float] | None:
    length = math.hypot(vector[0], vector[1])
    if length == 0:
        return None
    return (vector[0] / length, vector[1] / length)


def _dot2(a: tuple[float, float], b: tuple[float, float]) -> float:
    return a[0] * b[0] + a[1] * b[1]


def _required(el: ET.Element, attr: str) -> str:
    value = el.get(attr)
    if value is None:
        raise ValueError(f"Missing required attribute {attr}")
    return value


def _optional_float(value: str | None) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _optional_int(value: str | None) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def _is_true(value: str | None) -> bool:
    return str(value).strip().lower() in {"true", "1", "yes", "successfullycompleted"}


def _normalize_section(value: str) -> str:
    if value in {"firstHalf", "1", "first"}:
        return "firstHalf"
    if value in {"secondHalf", "2", "second"}:
        return "secondHalf"
    return value


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))
