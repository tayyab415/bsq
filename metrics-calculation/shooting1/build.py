from __future__ import annotations

import argparse
import html
import json
import math
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET

import pandas as pd

from aws_football.bsq_reports import add_finishing_execution_index
from aws_football.dribble_pose import (
    PlayerInfo,
    SkeletonFrame,
    Vec3,
    all_player_parquet_keys,
    default_s3_uri,
    load_match_context,
    parse_match_information_xml,
    write_csv,
)
from aws_football.positional_xml import load_positional_snapshots, resolve_positional_xml_path

from .pass_options import compute_decision_context, index_kpi_pass_candidates

from .extract import BatchReadStats, BatchWindowResult, read_s3_skeleton_windows_batch
from .metric import (
    COMPONENT_SUBSCORES,
    CONTACT_CANDIDATE_FIELDS,
    MODULE_SCORE_COLUMNS,
    PHASE_OFFSETS,
    SHOOTING_PARTS,
    ShotEvent,
    classify_shot_family,
    compute_contact_candidates,
    compute_component_scores,
    compute_module_scores,
    compute_phase_windows,
    compute_tracking_features,
    confidence_q,
    phase_window_columns,
    parse_kpi_shots_xml,
    parse_raw_shot_xml,
    resolve_shot_family,
    score_components,
    tracking_sample_rows,
)


REVIEW_SEED_EVENT_IDS = (
    "18902400000744",
    "18902400001555",
    "18902400001163",
    "18902400000172",
    "18902400000451",
    "18902400000444",
    "18902400001294",
    "18902400001042",
    "18902400000599",
    "18902400000508",
)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    match_folders = _match_folders(args)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    player_rows: list[dict[str, Any]] = []
    shot_rows: list[dict[str, Any]] = []
    feature_rows: list[dict[str, Any]] = []
    score_rows: list[dict[str, Any]] = []
    sample_rows: list[dict[str, Any]] = []
    contact_candidate_rows: list[dict[str, Any]] = []
    router_audit_rows: list[dict[str, Any]] = []
    errors: list[str] = []
    batch_stats: list[BatchReadStats] = []

    for match_folder in match_folders:
        match_dir = args.data_root / match_folder
        metadata_path = _single(match_dir.glob("**/*metadata.json"), "metadata JSON")
        match_info_path = _single(match_dir.glob("MatchInformations_*.xml"), "match information XML")
        kpi_path = _single(match_dir.glob("kpi_data_*.xml"), "KPI XML")
        raw_path = _single(match_dir.glob("Events_*.xml"), "raw events XML")
        context = load_match_context(metadata_path, match_folder)
        players, teams = parse_match_information_xml(match_info_path.read_text())
        context.players_by_id = players
        context.teams_by_id = teams
        player_rows.extend(_player_rows(match_folder, players))
        kpi_xml = kpi_path.read_text()
        kpi_passes = index_kpi_pass_candidates(kpi_xml)
        raw = parse_raw_shot_xml(raw_path.read_text())
        shots = _enrich_players(parse_kpi_shots_xml(kpi_xml, raw, context=context), players)
        shot_rows.extend(_shot_rows(shots))
        match_router_rows = _router_audit_rows(kpi_xml, shots)
        router_audit_rows.extend(match_router_rows)
        router_by_event = {row["event_id"]: row for row in match_router_rows}
        s3_uri = args.s3_uri or default_s3_uri(match_folder)
        sampled_shots = shots[: args.max_windows_per_match]
        batch_result = _empty_batch_result(sampled_shots)
        if not args.no_s3 and sampled_shots:
            try:
                batch_result = read_s3_skeleton_windows_batch(
                    s3_uri,
                    sampled_shots,
                    profile=args.aws_profile,
                    selected_players=_shot_player_keys(sampled_shots) if args.shot_player_windows else all_player_parquet_keys(players),
                    selected_parts=SHOOTING_PARTS,
                    pre_frames=args.pre_frames,
                    post_frames=args.post_frames,
                    max_window_frames=args.pre_frames + args.post_frames + 1,
                )
            except Exception as exc:
                message = f"{match_folder}: {exc}"
                errors.append(message)
                batch_result = BatchWindowResult(
                    frames_by_event={shot.event_id: [] for shot in sampled_shots},
                    errors_by_event={shot.event_id: message for shot in sampled_shots},
                    stats=BatchReadStats(
                        windows_attempted=len(sampled_shots),
                        windows_with_frames=0,
                        row_groups_selected=0,
                        row_groups_read=0,
                        s3_errors=len(sampled_shots),
                    ),
                )
        batch_stats.append(batch_result.stats)
        positional_snapshots: dict[int, Any] = {}
        positional_error: str | None = None
        if args.use_positional_xml and not args.no_s3 and not args.shot_player_windows and sampled_shots:
            positional_source = resolve_positional_xml_path(
                match_dir,
                match_folder,
                s3_uri=args.positional_s3_uri,
            )
            if positional_source is not None:
                frame_ids = {shot.synced_frame_id for shot in sampled_shots}
                try:
                    positional_snapshots = load_positional_snapshots(
                        positional_source,
                        frame_ids,
                        aws_profile=args.aws_profile,
                    )
                except Exception as exc:
                    positional_error = f"{match_folder}: positional XML read failed: {exc}"
                    errors.append(positional_error)
        for shot in sampled_shots:
            frames = batch_result.frames_by_event.get(shot.event_id, [])
            error = batch_result.errors_by_event.get(shot.event_id)
            if error:
                errors.append(f"{match_folder}/{shot.event_id}: {error}")
            s3_status = "fallback_no_s3" if args.no_s3 else ("tracking" if frames else "fallback_empty")
            contact_candidates = compute_contact_candidates(shot, frames, limit=5)
            contact_candidate_rows.extend(contact_candidates)
            features = compute_tracking_features(shot, frames)
            positional_snapshot = None if args.shot_player_windows else positional_snapshots.get(shot.synced_frame_id)
            decision_context = (
                {}
                if args.shot_player_windows
                else compute_decision_context(
                    shot,
                    frames,
                    players,
                    positional_snapshot=positional_snapshot,
                    kpi_passes=kpi_passes,
                )
            )
            features.update(decision_context)
            components = compute_component_scores(shot, features)
            q = confidence_q(features)
            router = dict(router_by_event.get(shot.event_id, {}))
            if "shot_value" in decision_context:
                router["shot_value"] = decision_context.get("shot_value")
            if "best_pass_option_value" in decision_context:
                router["best_pass_option_value"] = decision_context.get("best_pass_option_value")
            if "better_pass_available" in decision_context:
                router["better_pass_available"] = decision_context.get("better_pass_available")
            family = resolve_shot_family(shot.with_updates(ball_height_m=_safe_float(features.get("ball_z_at_contact"))), router)
            shot_enriched = shot.with_updates(family=family)
            scored = score_components(family, components, q=q, pressure=_pressure01(shot.pressure), keeper_opt=_keeper_opt(shot))
            phases = compute_phase_windows(
                _safe_int(features.get("contact_frame")) or _safe_int(features.get("physics_exit_frame")) or shot.skeleton_frame,
                min_frame=frames[0].frame_number if frames else None,
                max_frame=frames[-1].frame_number if frames else None,
            )
            phase_cols = phase_window_columns(phases)
            modules = compute_module_scores(shot_enriched, features, components, q=q, router=router)
            feature_rows.append(
                {
                    "event_id": shot.event_id,
                    "match_folder": match_folder,
                    "family": family,
                    **features,
                    **components,
                    **modules,
                    **phase_cols,
                    "Q": q,
                    "s3_status": s3_status,
                    "s3_error": error,
                }
            )
            score_row = {
                "event_id": shot.event_id,
                "match_folder": match_folder,
                "family": family,
                **components,
                "Q": q,
                "contact_frame": features.get("contact_frame"),
                "biomech_frame": features.get("biomech_frame"),
                "physics_exit_frame": features.get("physics_exit_frame"),
                "shot_direction_x": features.get("shot_direction_x"),
                "shot_direction_y": features.get("shot_direction_y"),
                "ball_z_at_contact": features.get("ball_z_at_contact"),
                "ball_exit_speed_m_s": features.get("ball_exit_speed_m_s"),
                "launch_angle_deg": features.get("launch_angle_deg"),
                "position_delta_jump_m_s": features.get("position_delta_jump_m_s"),
                "parquet_velocity_jump_m_s": features.get("parquet_velocity_jump_m_s"),
                "parquet_exit_speed_m_s": features.get("parquet_exit_speed_m_s"),
                "foot_velocity_into_ball_m_s": features.get("foot_velocity_into_ball_m_s"),
                "foot_speed_m_s": features.get("foot_speed_m_s"),
                "ball_to_foot_speed_ratio": features.get("ball_to_foot_speed_ratio"),
                "shot_value": features.get("shot_value"),
                "best_pass_option_value": features.get("best_pass_option_value"),
                "best_pass_option_player_id": features.get("best_pass_option_player_id"),
                "best_pass_option_distance_m": features.get("best_pass_option_distance_m"),
                "best_pass_option_lane_score": features.get("best_pass_option_lane_score"),
                "best_pass_option_pressure_score": features.get("best_pass_option_pressure_score"),
                "best_pass_pitch_control": features.get("best_pass_pitch_control"),
                "shot_pitch_control": features.get("shot_pitch_control"),
                "pass_value_margin": features.get("pass_value_margin"),
                "decision_context_source": features.get("decision_context_source"),
                "better_pass_available": features.get("better_pass_available"),
                "approach_speed_m_s": features.get("approach_speed_m_s"),
                "approach_angle_deg": features.get("approach_angle_deg"),
                "prep_ball_forward_m": features.get("prep_ball_forward_m"),
                "prep_ball_lateral_m": features.get("prep_ball_lateral_m"),
                "initial_ball_velocity_x_m_s": features.get("initial_ball_velocity_x_m_s"),
                "initial_ball_velocity_y_m_s": features.get("initial_ball_velocity_y_m_s"),
                "initial_ball_velocity_z_m_s": features.get("initial_ball_velocity_z_m_s"),
                "initial_ball_speed_m_s": features.get("initial_ball_speed_m_s"),
                "goal_plane_y_m": features.get("goal_plane_y_m"),
                "goal_plane_z_m": features.get("goal_plane_z_m"),
                "blocked_flight_flag": features.get("blocked_flight_flag"),
                **modules,
                **phase_cols,
                **scored,
                "xG": shot.xg,
                "shot_result": shot.shot_result,
            }
            score_rows.append(score_row)
            if not args.skip_tracking_samples:
                sample_rows.extend(tracking_sample_rows(shot, frames))

    review_rows = [] if args.skip_review_artifacts else _build_review_rows(shot_rows, score_rows, contact_candidate_rows)
    score_rows = add_finishing_execution_index(pd.DataFrame(score_rows)).to_dict(orient="records")
    write_csv(args.output_dir / "players.csv", player_rows)
    write_csv(args.output_dir / "shots.csv", shot_rows)
    if not args.skip_tracking_samples:
        write_csv(args.output_dir / "tracking_samples.csv", sample_rows)
    write_csv(args.output_dir / "contact_candidates.csv", [_contact_candidate_output(row) for row in contact_candidate_rows], preferred_fields=list(CONTACT_CANDIDATE_FIELDS))
    write_csv(args.output_dir / "features.csv", feature_rows)
    write_csv(args.output_dir / "scores_v1.csv", score_rows, preferred_fields=_score_preferred_fields())
    write_csv(args.output_dir / "router_audit.csv", router_audit_rows)
    write_csv(args.output_dir / "review_rows.csv", review_rows)
    if not args.skip_review_artifacts:
        _write_parquet(args.output_dir / "scores_v1.parquet", score_rows)
    _write_report(args.output_dir / "validation_report.md", match_folders, shot_rows, feature_rows, contact_candidate_rows, errors, batch_stats)
    if not args.skip_review_artifacts:
        _write_review_deck(args.output_dir / "review_deck.html", review_rows)
    _write_readme(args.output_dir)
    print(json.dumps({"matches": len(match_folders), "shots": len(shot_rows), "scored": len(score_rows), "errors": len(errors), "output_dir": str(args.output_dir)}, indent=2))
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build unified shooting metric outputs.")
    parser.add_argument("--match-folder", default="all")
    parser.add_argument("--data-root", type=Path, default=Path("data-small/Match_Data"))
    parser.add_argument("--output-dir", type=Path, default=Path("derived/shooting1"))
    parser.add_argument("--s3-uri", default=None)
    parser.add_argument("--aws-profile", default="hackathon")
    parser.add_argument("--max-windows-per-match", "--max-windows", dest="max_windows_per_match", type=int, default=50)
    parser.add_argument("--pre-frames", type=int, default=125)
    parser.add_argument("--post-frames", type=int, default=75)
    parser.add_argument("--no-s3", action="store_true")
    parser.add_argument(
        "--use-positional-xml",
        action="store_true",
        help="Stream Positions_*.xml from S3/local for 25 Hz pass routing (slow; default uses skeleton pitch control).",
    )
    parser.add_argument(
        "--positional-s3-uri",
        default=None,
        help="Override positional XML location (local path or s3:// URI).",
    )
    parser.add_argument("--shot-player-windows", action="store_true", help="Extract only shooter windows; faster for biomechanical calibration but leaves decision context null.")
    parser.add_argument(
        "--skip-tracking-samples",
        action="store_true",
        help="Do not emit tracking_samples.csv (faster full rebuild).",
    )
    parser.add_argument(
        "--skip-review-artifacts",
        action="store_true",
        help="Skip review_deck.html and scores_v1.parquet writes.",
    )
    return parser.parse_args(argv)


def _match_folders(args: argparse.Namespace) -> list[str]:
    if args.match_folder != "all":
        return [args.match_folder]
    return sorted(path.name for path in args.data_root.iterdir() if path.is_dir())


def _enrich_players(shots: list[ShotEvent], players: dict[str, Any]) -> list[ShotEvent]:
    enriched = []
    for shot in shots:
        player = players.get(shot.player_id)
        enriched.append(
            shot.with_updates(
                player_name=getattr(player, "short_name", None),
                team_name=getattr(player, "team_name", None),
                player_parquet_key=getattr(player, "parquet_key", None),
            )
        )
    return enriched


def _player_rows(match_folder: str, players: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "match_folder": match_folder,
            "player_id": p.person_id,
            "team_id": p.team_id,
            "team_name": p.team_name,
            "shirt_number": p.shirt_number,
            "parquet_team": p.parquet_team,
            "short_name": p.short_name,
            "playing_position": p.playing_position,
            "is_goalkeeper": p.is_goalkeeper,
        }
        for p in players.values()
    ]


def _shot_rows(shots: list[ShotEvent]) -> list[dict[str, Any]]:
    fields = ShotEvent.__dataclass_fields__.keys()
    return [{field: getattr(shot, field) for field in fields if field != "player_parquet_key"} | {"parquet_key": shot.player_parquet_key} for shot in shots]


def _pressure01(value: float) -> float:
    return max(0.0, min(1.0, value / 3.0))


def _keeper_opt(shot: ShotEvent) -> float:
    if shot.keeper_distance_to_goal is None:
        return 0.5
    return max(0.0, min(1.0, 1.0 - shot.keeper_distance_to_goal / 8.0))


def _safe_float(value: Any) -> float | None:
    try:
        if value is None or math.isnan(float(value)):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int | None:
    try:
        if value is None or value == "" or math.isnan(float(value)):
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _score_preferred_fields() -> list[str]:
    # PHASE_SCORE_COLUMNS contains Px_score/Px_q (already in MODULE_SCORE_COLUMNS)
    # plus the phase window start/end/available fields.  Extract only the window
    # fields to avoid tripling every phase score column.
    phase_window_fields = [
        field
        for phase in PHASE_OFFSETS
        for field in (f"phase_{phase}_start", f"phase_{phase}_end", f"phase_{phase}_available")
    ]
    candidates = [
        "event_id",
        "match_folder",
        "family",
        "D",
        "T",
        "B",
        "C",
        "V",
        *COMPONENT_SUBSCORES,
        "Q",
        *MODULE_SCORE_COLUMNS,
        "finishing_execution_index",
        "legacy_Q",
        "goal_plane_y_m",
        "goal_plane_z_m",
        "blocked_flight_flag",
        "initial_ball_speed_m_s",
        "initial_goal_alignment_score",
        "goal_plane_lateral_score",
        "goal_plane_vertical_score",
        "trajectory_flatness_score",
        "technique_P2",
        "technique_P3",
        "technique_P4",
        "technique_P4_mech",
        "technique_P4_strike",
        "technique_P5",
        *phase_window_fields,
        "contact_frame",
        "biomech_frame",
        "physics_exit_frame",
        "shot_direction_x",
        "shot_direction_y",
        "ball_z_at_contact",
        "ball_exit_speed_m_s",
        "launch_angle_deg",
        "position_delta_jump_m_s",
        "parquet_velocity_jump_m_s",
        "parquet_exit_speed_m_s",
        "foot_velocity_into_ball_m_s",
        "foot_speed_m_s",
        "foot_velocity_into_ball_score",
        "foot_peak_velocity_at_contact",
        "foot_peak_velocity_score",
        "knee_peak_angular_velocity_dps",
        "knee_peak_angular_velocity_score",
        "non_kicking_arm_abduction_deg",
        "non_kicking_arm_abduction_score",
        "proximal_distal_sequencing_score",
        "plant_knee_lateral_track_stdev_m",
        "ball_to_foot_speed_ratio",
        "ball_to_foot_speed_ratio_score",
        "shot_value",
        "best_pass_option_value",
        "best_pass_option_player_id",
        "best_pass_option_distance_m",
        "best_pass_option_lane_score",
        "best_pass_option_pressure_score",
        "best_pass_pitch_control",
        "shot_pitch_control",
        "pass_value_margin",
        "decision_context_source",
        "better_pass_available",
        "additive_score",
        "bottleneck_score",
        "gate_score",
        "ear_score",
        "weakest_constraint",
        "R_exec",
        "bio_execution",
        "xG",
        "shot_result",
    ]
    # Deduplicate while preserving first-occurrence order.
    seen: set[str] = set()
    result = []
    for field in candidates:
        if field not in seen:
            seen.add(field)
            result.append(field)
    return result


def _decision_context_fields(shot: ShotEvent, frames: list[SkeletonFrame], players: dict[str, PlayerInfo]) -> dict[str, Any]:
    """Backward-compatible wrapper used by unit tests."""
    return compute_decision_context(shot, frames, players)


def _shot_player_keys(shots: list[ShotEvent]) -> set[tuple[int, int]]:
    return {shot.player_parquet_key for shot in shots if shot.player_parquet_key is not None}


def _empty_batch_result(shots: list[ShotEvent]) -> BatchWindowResult:
    return BatchWindowResult(
        frames_by_event={shot.event_id: [] for shot in shots},
        errors_by_event={},
        stats=BatchReadStats(
            windows_attempted=len(shots),
            windows_with_frames=0,
            row_groups_selected=0,
            row_groups_read=0,
            s3_errors=0,
        ),
    )


def _router_audit_rows(kpi_xml: str, shots: list[ShotEvent]) -> list[dict[str, Any]]:
    shots_by_id = {shot.event_id: shot for shot in shots}
    rows: list[dict[str, Any]] = []
    last_play: ET.Element | None = None
    last_reception: ET.Element | None = None
    last_carry: ET.Element | None = None
    last_synced_event: tuple[str, ET.Element] | None = None
    root = ET.fromstring(kpi_xml)
    for el in root.iter():
        if el.tag == "Play":
            last_play = el
            last_synced_event = ("Play", el)
            continue
        if el.tag == "Reception":
            last_reception = el
            last_synced_event = ("Reception", el)
            continue
        if el.tag == "Carry":
            last_carry = el
            last_synced_event = ("Carry", el)
            continue
        if el.tag != "ShotAtGoal" or el.get("EventId") not in shots_by_id:
            continue
        shot = shots_by_id[el.get("EventId")]
        previous_event_type, previous_event = last_synced_event if last_synced_event is not None else (None, None)
        previous_synced = _element_int(previous_event, "SyncedFrameId")
        reception_synced = _element_int(last_reception, "SyncedFrameId")
        carry_end_synced = _element_int(last_carry, "EndSyncedFrameId")
        shot_synced = _element_int(el, "SyncedFrameId")
        reception_receiver = last_reception.get("PlayerId") if last_reception is not None else None
        play_receiver = last_play.get("ReceiverId") if last_play is not None else None
        receiver_is_shooter = (reception_receiver == shot.player_id) if reception_receiver is not None else (play_receiver == shot.player_id)
        router_row = {
            "event_id": shot.event_id,
            "match_folder": shot.match_folder,
            "previous_event_type": previous_event_type,
            "previous_event_id": previous_event.get("EventId") if previous_event is not None else None,
            "previous_synced_frame_id": previous_synced,
            "time_from_previous_event_s": _kpi_frame_seconds(shot_synced, previous_synced),
            "previous_play_id": last_play.get("EventId") if last_play is not None else None,
            "previous_play_type": _previous_play_type(last_play),
            "previous_is_cross": _lower_bool_attr(last_play, "IsCross"),
            "previous_passer_id": last_play.get("PlayerId") if last_play is not None else None,
            "previous_receiver_id": play_receiver,
            "previous_receiver_is_shooter": receiver_is_shooter,
            "reception_id": last_reception.get("EventId") if last_reception is not None else None,
            "reception_receiver_id": reception_receiver,
            "reception_synced_frame_id": reception_synced,
            "time_from_reception_s": _kpi_frame_seconds(shot_synced, reception_synced),
            "reception_pressure": _element_float(last_reception, "PressureOnReceiver", "PressureOnPlayer", "Pressure"),
            "previous_start_x": last_play.get("X-Position") if last_play is not None else None,
            "previous_start_y": last_play.get("Y-Position") if last_play is not None else None,
            "previous_end_x": last_play.get("X-PositionReceiver") if last_play is not None else None,
            "previous_end_y": last_play.get("Y-PositionReceiver") if last_play is not None else None,
            "previous_carry_id": last_carry.get("EventId") if last_carry is not None else None,
            "previous_carry_player_id": last_carry.get("PlayerId") if last_carry is not None else None,
            "previous_carry_distance_m": _element_float(last_carry, "Distance"),
            "previous_carry_start_x": last_carry.get("X-Position") if last_carry is not None else None,
            "previous_carry_start_y": last_carry.get("Y-Position") if last_carry is not None else None,
            "previous_carry_end_x": last_carry.get("X-EndPosition") if last_carry is not None else None,
            "previous_carry_end_y": last_carry.get("Y-EndPosition") if last_carry is not None else None,
            "previous_carry_end_synced_frame_id": carry_end_synced,
            "time_from_previous_carry_end_s": _kpi_frame_seconds(shot_synced, carry_end_synced),
        }
        family = resolve_shot_family(shot, router_row)
        router_row["family"] = family
        router_row["router_reason"] = _router_audit_reason(shot, family, last_play)
        rows.append(
            router_row
        )
    return rows


def _element_int(el: ET.Element | None, name: str) -> int | None:
    if el is None or el.get(name) in (None, ""):
        return None
    try:
        return int(str(el.get(name)))
    except ValueError:
        return None


def _element_float(el: ET.Element | None, *names: str) -> float | None:
    if el is None:
        return None
    for name in names:
        value = el.get(name)
        if value in (None, ""):
            continue
        try:
            return float(value)
        except ValueError:
            continue
    return None


def _kpi_frame_seconds(later: int | None, earlier: int | None) -> float | None:
    if later is None or earlier is None or later < earlier:
        return None
    return (later - earlier) / 25.0


def _previous_play_type(play: ET.Element | None) -> str | None:
    if play is None:
        return None
    if str(play.get("IsPass")).lower() == "true":
        return "pass"
    if str(play.get("IsFreeKick")).lower() == "true":
        return "free_kick"
    if str(play.get("IsCorner")).lower() == "true":
        return "corner"
    if str(play.get("IsThrowIn")).lower() == "true":
        return "throw_in"
    return "play"


def _lower_bool_attr(el: ET.Element | None, name: str) -> str | None:
    if el is None or el.get(name) is None:
        return None
    return str(el.get(name)).lower()


def _router_audit_reason(shot: ShotEvent, family: str, play: ET.Element | None) -> str:
    if play is None:
        return "no_prior_play"
    reasons = []
    if str(play.get("IsCross")).lower() == "true":
        reasons.append("previous_cross")
    if play.get("ReceiverId") == shot.player_id:
        reasons.append("previous_receiver_is_shooter")
    if family == "cutback":
        reasons.append("router_cutback")
    return "|".join(reasons) if reasons else "previous_play_context"


def _contact_candidate_output(row: dict[str, Any]) -> dict[str, Any]:
    return {field: row.get(field) for field in CONTACT_CANDIDATE_FIELDS}


def _build_review_rows(
    shot_rows: list[dict[str, Any]],
    score_rows: list[dict[str, Any]],
    contact_candidate_rows: list[dict[str, Any]],
    *,
    limit: int = 20,
) -> list[dict[str, Any]]:
    shots_by_key = {(str(row.get("match_folder")), str(row.get("event_id"))): row for row in shot_rows}
    candidates_by_key: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in contact_candidate_rows:
        key = (str(row.get("match_folder")), str(row.get("event_id")))
        candidates_by_key.setdefault(key, []).append(row)

    ordered_scores = _review_order(score_rows)
    rows = []
    for score in ordered_scores[:limit]:
        key = (str(score.get("match_folder")), str(score.get("event_id")))
        shot = shots_by_key.get(key, {})
        candidates = sorted(candidates_by_key.get(key, []), key=lambda row: int(row.get("candidate_rank") or 999))
        evidence_for = "metric" if candidates else "mapping"
        row = {
            "event_id": score.get("event_id"),
            "match_folder": score.get("match_folder"),
            "player": shot.get("player_name") or shot.get("player") or shot.get("player_id"),
            "team": shot.get("team_name") or shot.get("team") or shot.get("team_id"),
            "family": score.get("family"),
            "result": score.get("shot_result") or shot.get("shot_result"),
            "evidence_for": evidence_for,
            "xG": score.get("xG", shot.get("xg")),
            "D": score.get("D"),
            "T": score.get("T"),
            "B": score.get("B"),
            "C": score.get("C"),
            "V": score.get("V"),
            "Q": score.get("Q"),
            "additive_score": score.get("additive_score"),
            "bottleneck_score": score.get("bottleneck_score"),
            "gate_score": score.get("gate_score"),
            "ear_score": score.get("ear_score"),
            "weakest_constraint": score.get("weakest_constraint"),
            "technique_score": score.get("technique_score"),
            "technique_q": score.get("technique_q"),
            "technique_mechanics_score": score.get("technique_mechanics_score"),
            "technique_mechanics_q": score.get("technique_mechanics_q"),
            "technique_mechanics_band": score.get("technique_mechanics_band"),
            "positioning_score": score.get("positioning_score"),
            "positioning_q": score.get("positioning_q"),
            "shot_geometry_score": score.get("shot_geometry_score"),
            "shot_geometry_q": score.get("shot_geometry_q"),
            "receiving_pressure_score": score.get("receiving_pressure_score"),
            "receiving_pressure_q": score.get("receiving_pressure_q"),
            "arrival_receiving_score": score.get("arrival_receiving_score"),
            "arrival_receiving_q": score.get("arrival_receiving_q"),
            "placement_score": score.get("placement_score"),
            "placement_q": score.get("placement_q"),
            "strike_output_score": score.get("strike_output_score"),
            "strike_output_q": score.get("strike_output_q"),
            "strike_quality_score": score.get("strike_quality_score"),
            "strike_quality_q": score.get("strike_quality_q"),
            "strike_quality_band": score.get("strike_quality_band"),
            "decision_quality_score": score.get("decision_quality_score"),
            "decision_quality_q": score.get("decision_quality_q"),
            "decision_quality_band": score.get("decision_quality_band"),
            "carry_progression_score": score.get("carry_progression_score"),
            "carry_progression_q": score.get("carry_progression_q"),
            "carry_progression_band": score.get("carry_progression_band"),
            "top3_contact_candidates": _top_contact_candidates_text(candidates, limit=3),
            "manual_verdict": "",
            "manual_notes": "",
        }
        for col in COMPONENT_SUBSCORES:
            row[col] = score.get(col)
        rows.append(row)
    return rows


def _review_order(score_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_event = {str(row.get("event_id")): row for row in score_rows}
    ordered = [by_event[event_id] for event_id in REVIEW_SEED_EVENT_IDS if event_id in by_event]
    used = {str(row.get("event_id")) for row in ordered}
    ordered.extend(row for row in score_rows if str(row.get("event_id")) not in used)
    return ordered


def _top_contact_candidates_text(candidates: list[dict[str, Any]], *, limit: int) -> str:
    chunks = []
    for row in candidates[:limit]:
        chunks.append(
            " ".join(
                [
                    f"rank={row.get('candidate_rank')}",
                    f"frame={row.get('candidate_frame')}",
                    f"off={row.get('frame_offset')}",
                    f"part={row.get('nearest_part')}",
                    f"foot={row.get('inferred_foot')}",
                    f"dist={_fmt(row.get('foot_ball_distance_m'))}",
                    f"jump={_fmt(row.get('velocity_jump_m_s'))}",
                    f"cost={_fmt(row.get('total_contact_cost'))}",
                    f"by={row.get('selected_by') or 'cost'}" if row.get("candidate_rank") == 1 else "",
                ]
            ).strip()
        )
    return "; ".join(chunks)


def _fmt(value: Any) -> str:
    try:
        return f"{float(value):.3f}"
    except (TypeError, ValueError):
        return ""


def _write_parquet(path: Path, rows: list[dict[str, Any]]) -> None:
    try:
        import pandas as pd

        pd.DataFrame(rows).to_parquet(path, index=False)
    except Exception:
        path.write_text("parquet unavailable; see scores_v1.csv\n")


def _write_report(
    path: Path,
    matches: list[str],
    shots: list[dict[str, Any]],
    features: list[dict[str, Any]],
    contact_candidates: list[dict[str, Any]],
    errors: list[str],
    batch_stats: list[BatchReadStats],
) -> None:
    windows_attempted = sum(stat.windows_attempted for stat in batch_stats)
    windows_with_frames = sum(stat.windows_with_frames for stat in batch_stats)
    row_groups_selected = sum(stat.row_groups_selected for stat in batch_stats)
    row_groups_read = sum(stat.row_groups_read for stat in batch_stats)
    s3_errors = len(errors)
    avg_q = sum(float(row.get("Q") or 0.0) for row in features) / len(features) if features else 0.0
    avg_contact = sum(float(row.get("q_contact") or 0.0) for row in features) / len(features) if features else 0.0
    avg_sync = sum(float(row.get("q_sync") or 0.0) for row in features) / len(features) if features else 0.0
    avg_anchor = sum(float(row.get("q_anchor") or 0.0) for row in features) / len(features) if features else 0.0
    avg_candidate = sum(float(row.get("q_candidate") or 0.0) for row in features) / len(features) if features else 0.0
    fallback_rows = sum(1 for row in features if str(row.get("s3_status", "")).startswith("fallback"))
    path.write_text(
        "\n".join(
            [
                "# Shooting1 validation report",
                "",
                f"- Matches parsed: {len(matches)}",
                f"- Shots parsed: {len(shots)}",
                f"- Windows attempted: {windows_attempted}",
                f"- Windows scored: {len(features)}",
                f"- Windows with real frames: {windows_with_frames}",
                f"- Row groups selected: {row_groups_selected}",
                f"- Row groups read: {row_groups_read}",
                f"- S3/read errors: {s3_errors}",
                f"- Contact candidate rows emitted: {len(contact_candidates)}",
                f"- Average Q: {avg_q:.3f}",
                f"- Average q_contact: {avg_contact:.3f}",
                f"- Average q_sync: {avg_sync:.3f}",
                f"- Average q_anchor: {avg_anchor:.3f}",
                f"- Average q_candidate: {avg_candidate:.3f}",
                f"- Fallback rows: {fallback_rows}",
                "",
                "xG is emitted as an audit column only and is not used in D/T/B/C/V/Q scoring.",
            ]
            + (["", "## Errors"] + [f"- {error}" for error in errors[:50]] if errors else [])
        )
        + "\n"
    )


def _write_review_deck(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text(
        """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Shooting1 Review Deck</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #17202a; background: #f7f8fa; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    .meta { margin: 0 0 24px; color: #566573; }
    table { border-collapse: collapse; width: 100%; background: white; font-size: 13px; }
    th, td { border: 1px solid #d5d8dc; padding: 8px; vertical-align: top; }
    th { background: #eaecee; text-align: left; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
  </style>
</head>
<body>
  <h1>Shooting1 Review Deck</h1>
  <p class="meta">Compact analyst review queue generated from <code>review_rows.csv</code>.</p>
  <table>
    <thead>
      <tr>
        <th>Event</th><th>Player</th><th>Family</th><th>Q</th><th>Scores</th><th>Contact Candidates</th><th>Evidence</th><th>Manual Verdict</th>
      </tr>
    </thead>
    <tbody>
"""
        + "\n".join(_review_deck_row(row) for row in rows)
        + """
    </tbody>
  </table>
</body>
</html>
"""
    )


def _review_deck_row(row: dict[str, Any]) -> str:
    scores = " / ".join(
        f"{label}:{_fmt(row.get(label))}"
        for label in ("D", "T", "B", "C", "V")
    )
    return (
        "      <tr>"
        f"<td>{html.escape(str(row.get('event_id') or ''))}</td>"
        f"<td>{html.escape(str(row.get('player') or row.get('player_name') or ''))}<br>{html.escape(str(row.get('team') or row.get('team_name') or ''))}</td>"
        f"<td>{html.escape(str(row.get('family') or ''))}<br>weakest: {html.escape(str(row.get('weakest_constraint') or ''))}</td>"
        f"<td class=\"num\">{_fmt(row.get('Q'))}</td>"
        f"<td>{html.escape(scores)}</td>"
        f"<td>{html.escape(str(row.get('top3_contact_candidates') or ''))}</td>"
        f"<td>{html.escape(str(row.get('evidence_for') or ''))}</td>"
        f"<td>{html.escape(str(row.get('manual_verdict') or ''))}</td>"
        "</tr>"
    )


def _write_readme(path: Path) -> None:
    (path / "README.md").write_text(
        "# shooting1\n\n"
        "Unified shooting metric derived outputs. The builder parses local metadata, match information, KPI shots, "
        "and raw shot labels, then samples bounded event-aligned parquet windows from S3 unless `--no-s3` is set.\n\n"
        "Outputs: `players.csv`, `shots.csv`, `tracking_samples.csv`, `contact_candidates.csv`, `features.csv`, "
        "`scores_v1.csv`, `scores_v1.parquet`, `router_audit.csv`, `review_rows.csv`, `review_deck.html`, "
        "and `validation_report.md`.\n"
    )


def _single(paths, label: str) -> Path:
    matches = sorted(paths)
    if not matches:
        raise FileNotFoundError(f"Could not find {label}")
    return matches[0]


if __name__ == "__main__":
    raise SystemExit(main())
