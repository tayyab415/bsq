from __future__ import annotations

import argparse
import csv
import json
import math
from pathlib import Path
from typing import Any

from aws_football.dribble_pose import PlayerInfo, parse_match_information_xml

from .metric import ShotEvent, compute_component_scores, compute_module_scores, confidence_q, resolve_shot_family
from .pass_options import compute_decision_context, index_kpi_pass_candidates


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fast decision-quality rescore from KPI + existing feature rows")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=True)
    args = parser.parse_args(argv)

    shots = _read_csv(args.output_dir / "shots.csv")
    features = _read_csv(args.output_dir / "features.csv")
    scores = _read_csv(args.output_dir / "scores_v1.csv")
    features_by_event = {row["event_id"]: row for row in features}
    scores_by_event = {row["event_id"]: row for row in scores}

    kpi_by_match: dict[str, list] = {}
    players_by_match: dict[str, dict[str, PlayerInfo]] = {}
    for match_folder in sorted({row["match_folder"] for row in shots}):
        match_dir = args.data_root / match_folder
        kpi_path = next(match_dir.glob("kpi_data_*.xml"))
        kpi_by_match[match_folder] = index_kpi_pass_candidates(kpi_path.read_text())
        match_info = next(match_dir.glob("MatchInformations_*.xml"))
        players, _ = parse_match_information_xml(match_info.read_text())
        players_by_match[match_folder] = players

    updated = 0
    for shot_row in shots:
        event_id = shot_row["event_id"]
        if event_id not in features_by_event:
            continue
        feature_row = features_by_event[event_id]
        score_row = scores_by_event[event_id]
        shot = _shot_from_row(shot_row)
        players = players_by_match[shot.match_folder]
        decision_context = compute_decision_context(
            shot,
            [],
            players,
            kpi_passes=kpi_by_match[shot.match_folder],
        )
        if not decision_context:
            continue
        components = {
            key: _safe_float(feature_row.get(key))
            for key in ("D", "T", "B", "C", "V")
            if key in feature_row
        }
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


def _shot_from_row(row: dict[str, Any]) -> ShotEvent:
    return ShotEvent(
        event_id=row["event_id"],
        match_folder=row["match_folder"],
        team_id=row["team_id"],
        player_id=row["player_id"],
        section=row.get("section") or "firstHalf",
        synced_frame_id=int(float(row["synced_frame_id"])),
        skeleton_frame=int(float(row["skeleton_frame"])),
        x=float(row["x"]),
        y=float(row["y"]),
        distance_to_goal=float(row.get("distance_to_goal") or 0.0),
        angle_to_goal=float(row.get("angle_to_goal") or 0.0),
        pressure=float(row.get("pressure") or 0.0),
        xg=float(row.get("xg") or row.get("xG") or row.get("XG") or 0.0),
        shot_result=row.get("shot_result"),
        player_parquet_key=None,
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
