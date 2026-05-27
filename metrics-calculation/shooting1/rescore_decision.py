from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

from aws_football.dribble_pose import PlayerInfo, SkeletonFrame, Vec3, load_match_context, parse_match_information_xml

from .metric import ShotEvent, compute_component_scores, compute_module_scores, confidence_q, parse_kpi_shots_xml, parse_raw_shot_xml, resolve_shot_family, score_components
from .pass_options import compute_decision_context


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Rescore decision-quality columns from existing tracking_samples.csv")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    args = parser.parse_args(argv)

    shots = _read_csv(args.output_dir / "shots.csv")
    features = _read_csv(args.output_dir / "features.csv")
    scores = _read_csv(args.output_dir / "scores_v1.csv")
    samples = _read_csv(args.output_dir / "tracking_samples.csv")
    frames_by_event = _frames_from_samples(samples)

    features_by_event = {row["event_id"]: row for row in features}
    scores_by_event = {row["event_id"]: row for row in scores}
    players_by_match = _players_by_match(args.data_root, shots)

    updated = 0
    for shot_row in shots:
        event_id = shot_row["event_id"]
        if event_id not in features_by_event or event_id not in scores_by_event:
            continue
        frames = frames_by_event.get(event_id, [])
        if not frames:
            continue
        match_folder = shot_row["match_folder"]
        players = players_by_match.get(match_folder, {})
        shot = _shot_from_row(shot_row, players)
        decision_context = compute_decision_context(shot, frames, players)
        if not decision_context:
            continue
        feature_row = features_by_event[event_id]
        components = {key: _safe_float(feature_row.get(key)) for key in ("D", "T", "B", "C", "V") if key in feature_row}
        components = {key: value for key, value in components.items() if value is not None and not math.isnan(value)}
        q = confidence_q(feature_row)
        router = {
            "shot_value": decision_context.get("shot_value"),
            "best_pass_option_value": decision_context.get("best_pass_option_value"),
            "better_pass_available": decision_context.get("better_pass_available"),
        }
        family = shot_row.get("family") or feature_row.get("family") or resolve_shot_family(shot, router)
        modules = compute_module_scores(shot.with_updates(family=family), feature_row, components, q=q, router=router)
        feature_row.update(decision_context)
        feature_row.update(
            {
                "decision_quality_score": modules.get("decision_quality_score"),
                "decision_quality_q": modules.get("decision_quality_q"),
                "decision_quality_band": modules.get("decision_quality_band"),
            }
        )
        score_row = scores_by_event[event_id]
        score_row.update(decision_context)
        score_row.update(
            {
                "decision_quality_score": modules.get("decision_quality_score"),
                "decision_quality_q": modules.get("decision_quality_q"),
                "decision_quality_band": modules.get("decision_quality_band"),
            }
        )
        updated += 1

    _write_csv(args.output_dir / "features.csv", list(features_by_event.values()))
    _write_csv(args.output_dir / "scores_v1.csv", list(scores_by_event.values()))
    print(json.dumps({"updated": updated, "output_dir": str(args.output_dir)}, indent=2))
    return 0


def _frames_from_samples(rows: list[dict[str, Any]]) -> dict[str, list[SkeletonFrame]]:
    grouped: dict[str, dict[int, dict[tuple[int, int], dict[str, Vec3]]]] = defaultdict(dict)
    ball_by_event_frame: dict[str, dict[int, Vec3]] = defaultdict(dict)
    for row in rows:
        event_id = row["event_id"]
        frame_number = int(float(row["frame_number"]))
        ball_x = _safe_float(row.get("ball_x"))
        ball_y = _safe_float(row.get("ball_y"))
        ball_z = _safe_float(row.get("ball_z"))
        pelvis_x = _safe_float(row.get("pelvis_x"))
        pelvis_y = _safe_float(row.get("pelvis_y"))
        if ball_x is not None and ball_y is not None:
            ball_by_event_frame[event_id][frame_number] = Vec3(ball_x, ball_y, ball_z or 0.0)
        if pelvis_x is None or pelvis_y is None:
            continue
        jersey = int(float(row.get("jersey_number") or row.get("shirt_number") or -1))
        team = int(float(row.get("team") or row.get("parquet_team") or -1))
        grouped[event_id].setdefault(frame_number, {})[(team, jersey)] = {"pelvis": Vec3(pelvis_x, pelvis_y, 0.0)}
    frames_by_event: dict[str, list[SkeletonFrame]] = {}
    for event_id, frames in grouped.items():
        built: list[SkeletonFrame] = []
        for frame_number in sorted(frames):
            built.append(
                SkeletonFrame(
                    frame_number=frame_number,
                    ball=ball_by_event_frame[event_id].get(frame_number),
                    ball_velocity=None,
                    players=frames[frame_number],
                )
            )
        frames_by_event[event_id] = built
    return frames_by_event


def _players_by_match(data_root: Path, shots: list[dict[str, Any]]) -> dict[str, dict[str, PlayerInfo]]:
    matches = sorted({row["match_folder"] for row in shots})
    out: dict[str, dict[str, PlayerInfo]] = {}
    for match_folder in matches:
        match_dir = data_root / match_folder
        match_info = next(match_dir.glob("MatchInformations_*.xml"))
        players, _teams = parse_match_information_xml(match_info.read_text())
        out[match_folder] = players
    return out


def _shot_from_row(row: dict[str, Any], players: dict[str, PlayerInfo]) -> ShotEvent:
    player = players.get(row["player_id"])
    parquet_key = None
    if player is not None:
        parquet_key = player.parquet_key
    elif row.get("parquet_key"):
        parquet_key = tuple(json.loads(row["parquet_key"].replace("(", "[").replace(")", "]")))
    return ShotEvent(
        event_id=row["event_id"],
        match_folder=row["match_folder"],
        team_id=row["team_id"],
        player_id=row["player_id"],
        section=row.get("section") or row.get("game_section") or "firstHalf",
        synced_frame_id=int(float(row["synced_frame_id"])),
        skeleton_frame=int(float(row["skeleton_frame"])),
        x=float(row["x"]),
        y=float(row["y"]),
        distance_to_goal=float(row.get("distance_to_goal") or 0.0),
        angle_to_goal=float(row.get("angle_to_goal") or 0.0),
        pressure=float(row.get("pressure") or 0.0),
        xg=float(row.get("xg") or row.get("xG") or 0.0),
        shot_result=row.get("shot_result"),
        player_parquet_key=parquet_key,
    )


def _read_csv(path: Path) -> list[dict[str, Any]]:
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    fieldnames: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for key in row:
            if key not in seen:
                seen.add(key)
                fieldnames.append(key)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _safe_float(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        number = float(value)
        if math.isnan(number):
            return None
        return number
    except (TypeError, ValueError):
        return None


if __name__ == "__main__":
    raise SystemExit(main())
