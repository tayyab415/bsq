#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
SRC = REPO_ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from aws_football.visualizer import ShootingReviewService  # noqa: E402

DEFAULT_REVIEW_DIR = REPO_ROOT / "metrics-calculation" / "outputs" / "all_matches"
DEFAULT_OUT = REPO_ROOT / "shooting-videos" / "remotion" / "public" / "explainer-pair.json"
EXPLAINABLE_FAMILIES = {"open_play", "carry_self_created", "dead_ball", "long_range", "oneV", "cutback"}


def select_default_pair(review_dir: Path) -> list[dict[str, str]]:
    scores = _read_csv_by_key(review_dir / "scores_v1.csv")
    shots = _read_csv_by_key(review_dir / "shots.csv")
    features = _read_csv_by_key(review_dir / "features.csv")
    candidates: list[dict[str, str]] = []

    for key, score_row in scores.items():
        family = score_row.get("family", "")
        mechanics = _float(score_row.get("technique_mechanics_score"))
        if family not in EXPLAINABLE_FAMILIES or math.isnan(mechanics):
            continue
        row = dict(score_row)
        row.update({f"shot_{name}": value for name, value in shots.get(key, {}).items()})
        row.update({f"feature_{name}": value for name, value in features.get(key, {}).items()})
        candidates.append(row)

    if len(candidates) < 2:
        raise ValueError(f"Need at least two explainable scored rows in {review_dir}")

    strong = max(candidates, key=lambda row: _float(row.get("technique_mechanics_score")))
    weak = min(
        (row for row in candidates if _key(row) != _key(strong)),
        key=lambda row: (
            _float(row.get("technique_mechanics_score")),
            _float(row.get("P3_score")),
            _float(row.get("P4_score")),
        ),
    )
    return [
        strong | {"explainer_role": "standout"},
        weak | {"explainer_role": "constraint"},
    ]


def build_feature_story(score_row: dict[str, str], feature_row: dict[str, str]) -> dict[str, Any]:
    mechanics = _float(score_row.get("technique_mechanics_score"))
    p3 = _float(score_row.get("P3_score"))
    p4 = _float(score_row.get("P4_score"))
    p5 = _float(score_row.get("P5_score"))
    strike = _float(score_row.get("strike_quality_score"))
    separation = _float(feature_row.get("peak_shoulder_hip_separation_deg"))
    peak_frame = feature_row.get("peak_shoulder_hip_frame") or ""
    foot_velocity = _float(feature_row.get("foot_peak_velocity_at_contact"))
    ratio = _float(feature_row.get("ball_to_foot_speed_ratio"))

    if mechanics >= 80 and p3 >= 70 and p4 >= 70:
        summary = "Standout mechanics: clean backswing, contact, and follow-through."
        tone = "standout"
    elif p3 < 60:
        summary = "Backswing constraint: the body shape did not preload the strike cleanly."
        tone = "constraint"
    elif p4 < 60:
        summary = "Contact constraint: the setup did not convert cleanly through the ball."
        tone = "constraint"
    elif p5 < 45:
        summary = "Follow-through constraint: the strike lost continuity after contact."
        tone = "constraint"
    else:
        summary = "Mixed mechanics: one phase limited the overall technique read."
        tone = "mixed"

    return {
        "summary": summary,
        "tone": tone,
        "callouts": [
            {
                "label": "Hip-shoulder interval",
                "value": _format_number(separation, " deg"),
                "detail": f"Peak rotational separation before contact{f' at frame {peak_frame}' if peak_frame else ''}.",
            },
            {
                "label": "Backswing phase",
                "value": _format_number(p3, prefix="P3 "),
                "detail": "Approach-to-backswing body organization.",
            },
            {
                "label": "Foot speed into contact",
                "value": _format_number(foot_velocity, " m/s"),
                "detail": "Kicking-foot velocity around the contact interval.",
            },
            {
                "label": "Ball-to-foot transfer",
                "value": _format_number(ratio, "x"),
                "detail": "Initial ball speed relative to foot speed.",
            },
            {
                "label": "Technique mechanics",
                "value": _format_number(mechanics),
                "detail": f"P4 contact {_format_number(p4)} / P5 follow-through {_format_number(p5)} / strike {_format_number(strike)}.",
            },
        ],
    }


def export_single_clip(
    *,
    match_folder: str,
    event_id: str,
    review_dir: Path,
    data_root: Path,
    output_path: Path,
    aws_profile: str,
    role: str = "standout",
) -> dict[str, Any]:
    service = ShootingReviewService(data_root=data_root, review_dir=review_dir, aws_profile=aws_profile)
    features = _read_csv_by_key(review_dir / "features.csv")
    scores = _read_csv_by_key(review_dir / "scores_v1.csv")
    key = (match_folder, event_id)
    shot_payload = service.shot_payload(match_folder, event_id)
    frame_window = shot_payload["frameWindow"]
    chunk = service.chunk_payload(
        match_folder,
        int(frame_window["start"]),
        int(frame_window["end"]),
        stride=1,
    )
    feature_row = features.get(key, {})
    score_row = scores.get(key, {})
    clip = {
        "role": role,
        "matchFolder": match_folder,
        "eventId": event_id,
        "shot": shot_payload["shot"],
        "score": shot_payload["score"],
        "modules": shot_payload.get("modules", {}),
        "features": feature_row,
        "frameRoles": shot_payload["frameRoles"],
        "frameWindow": frame_window,
        "story": build_feature_story(score_row, feature_row),
        "frames": chunk.get("frames", []),
    }
    payload = {
        "source": "shooting1_v3_all_matches",
        "reviewDir": str(review_dir),
        "template": "grounded-a4",
        "clips": [clip],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    return payload


def export_explainer_pair(
    *,
    review_dir: Path,
    data_root: Path,
    output_path: Path,
    aws_profile: str,
) -> dict[str, Any]:
    selected = select_default_pair(review_dir)
    service = ShootingReviewService(data_root=data_root, review_dir=review_dir, aws_profile=aws_profile)
    features = _read_csv_by_key(review_dir / "features.csv")
    payload = {
        "source": "shooting1_v3_all_matches",
        "reviewDir": str(review_dir),
        "clips": [],
    }

    for row in selected:
        match_folder = row["match_folder"]
        event_id = row["event_id"]
        key = (match_folder, event_id)
        shot_payload = service.shot_payload(match_folder, event_id)
        frame_window = shot_payload["frameWindow"]
        chunk = service.chunk_payload(
            match_folder,
            int(frame_window["start"]),
            int(frame_window["end"]),
            stride=1,
        )
        feature_row = features.get(key, {})
        payload["clips"].append(
            {
                "role": row["explainer_role"],
                "matchFolder": match_folder,
                "eventId": event_id,
                "shot": shot_payload["shot"],
                "score": shot_payload["score"],
                "modules": shot_payload.get("modules", {}),
                "features": feature_row,
                "frameRoles": shot_payload["frameRoles"],
                "frameWindow": frame_window,
                "story": build_feature_story(shot_payload["score"], feature_row),
                "frames": chunk.get("frames", []),
            }
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description="Export tiny Remotion shot windows for metric explainer videos.")
    parser.add_argument("--review-dir", type=Path, default=DEFAULT_REVIEW_DIR)
    parser.add_argument(
        "--data-root",
        type=Path,
        default=Path(os.environ["HACKATHON_DATA_ROOT"]) / "Match_Data"
        if os.environ.get("HACKATHON_DATA_ROOT")
        else REPO_ROOT / "data-small" / "Match_Data",
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--aws-profile", default="hackathon")
    parser.add_argument("--match-folder", help="Single-shot export: match folder name")
    parser.add_argument("--event-id", help="Single-shot export: event id")
    parser.add_argument("--role", default="standout", choices=("standout", "constraint", "mixed"))
    args = parser.parse_args()

    if args.match_folder and args.event_id:
        payload = export_single_clip(
            match_folder=args.match_folder,
            event_id=args.event_id,
            review_dir=args.review_dir,
            data_root=args.data_root,
            output_path=args.output,
            aws_profile=args.aws_profile,
            role=args.role,
        )
    else:
        payload = export_explainer_pair(
            review_dir=args.review_dir,
            data_root=args.data_root,
            output_path=args.output,
            aws_profile=args.aws_profile,
        )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "clips": [
                    {
                        "role": clip["role"],
                        "matchFolder": clip["matchFolder"],
                        "eventId": clip["eventId"],
                        "player": clip["shot"].get("player"),
                        "frames": len(clip["frames"]),
                        "summary": clip["story"]["summary"],
                    }
                    for clip in payload["clips"]
                ],
            },
            ensure_ascii=False,
        )
    )
    return 0


def _read_csv_by_key(path: Path) -> dict[tuple[str, str], dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return {(row["match_folder"], row["event_id"]): row for row in csv.DictReader(handle)}


def _float(value: str | None) -> float:
    if value is None or value == "":
        return math.nan
    try:
        return float(value)
    except ValueError:
        return math.nan


def _format_number(value: float, suffix: str = "", *, prefix: str = "") -> str:
    if math.isnan(value):
        return "-"
    return f"{prefix}{value:.1f}{suffix}"


def _key(row: dict[str, str]) -> tuple[str, str]:
    return row["match_folder"], row["event_id"]


if __name__ == "__main__":
    raise SystemExit(main())
