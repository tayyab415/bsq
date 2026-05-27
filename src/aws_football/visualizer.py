from __future__ import annotations

import math
import csv
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from aws_football.dribble_pose import (
    METRIC_PARTS,
    PlayerInfo,
    SkeletonFrame,
    TeamInfo,
    Vec3,
    all_player_parquet_keys,
    default_s3_uri,
    kpi_to_skeleton_frame,
    load_match_context,
    parse_match_information_xml,
    read_s3_skeleton_window,
)
from shooting1.metric import MODULE_FEATURE_DECLARATIONS, PHASE_OFFSETS


DEFAULT_MATCH_FOLDER = "Bayern_Hamburg"
DEFAULT_DATA_ROOT = Path("data-small/Match_Data")
DEFAULT_DERIVED_ROOT = Path("metrics-calculation/outputs")
DEFAULT_SHOOTING_REVIEW_DIR = DEFAULT_DERIVED_ROOT / "all_matches"
DEFAULT_AWS_PROFILE = "hackathon"
MAX_API_WINDOW_FRAMES = 250
SHOOTING_API_WINDOW_FRAMES = 160

BODY_CONNECTIONS: tuple[tuple[str, str], ...] = (
    ("left_ear", "nose"),
    ("right_ear", "nose"),
    ("nose", "neck"),
    ("neck", "left_shoulder"),
    ("neck", "right_shoulder"),
    ("left_shoulder", "left_elbow"),
    ("left_elbow", "left_wrist"),
    ("right_shoulder", "right_elbow"),
    ("right_elbow", "right_wrist"),
    ("neck", "pelvis"),
    ("left_shoulder", "left_hip"),
    ("right_shoulder", "right_hip"),
    ("left_hip", "pelvis"),
    ("right_hip", "pelvis"),
    ("left_hip", "left_knee"),
    ("left_knee", "left_ankle"),
    ("left_ankle", "left_heel"),
    ("left_ankle", "left_toe"),
    ("left_heel", "left_toe"),
    ("right_hip", "right_knee"),
    ("right_knee", "right_ankle"),
    ("right_ankle", "right_heel"),
    ("right_ankle", "right_toe"),
    ("right_heel", "right_toe"),
)

KPI_EVENT_TAGS = {
    "Play",
    "Reception",
    "Carry",
    "TeamPossession",
    "ShotAtGoal",
    "TacklingGame",
    "Foul",
    "OtherBallAction",
}

INTERESTING_ATTRS = (
    "EventId",
    "GameTime",
    "InGameSection",
    "GameSection",
    "SyncedFrameId",
    "EndSyncedFrameId",
    "TeamId",
    "PlayerId",
    "ReceiverId",
    "WinnerPlayerId",
    "LoserPlayerId",
    "WinnerTeamId",
    "LoserTeamId",
    "FoulerPlayerId",
    "FouledPlayerId",
    "X-Position",
    "Y-Position",
    "X-EndPosition",
    "Y-EndPosition",
    "X-PositionReceiver",
    "Y-PositionReceiver",
    "PressureOnPlayer",
    "PressureOnReceiver",
    "Distance",
    "DistanceToGoal",
    "AngleToGoal",
    "DistanceClosestDefenderToPlayer",
    "NumDefendersPassingLane",
    "NumDefendersInShotLane",
    "NumDefendingPlayersInBox",
    "NumAttackingPlayersInBox",
    "ByPassedDefenders",
    "xP",
    "xG",
    "Evaluation",
    "ShotResult",
    "Type",
    "IsPass",
    "IsCross",
    "IsInterception",
    "IsFoul",
)


@dataclass
class VisualizerService:
    data_root: Path = DEFAULT_DATA_ROOT
    match_folder: str = DEFAULT_MATCH_FOLDER
    aws_profile: str = DEFAULT_AWS_PROFILE
    context: Any | None = None
    players_by_id: dict[str, PlayerInfo] = field(default_factory=dict)
    teams_by_id: dict[str, TeamInfo] = field(default_factory=dict)
    players_by_key: dict[tuple[int, int], PlayerInfo] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)
    frame_cache: dict[int, dict[str, Any]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.match_folder = validate_visualizer_match(self.match_folder)
        self.data_root = Path(self.data_root)
        self._load_local_files()

    def match_payload(self) -> dict[str, Any]:
        assert self.context is not None
        event_counts = Counter(event["type"] for event in self.events)
        event_frames = [int(event["skeletonFrame"]) for event in self.events if event.get("skeletonFrame") is not None]
        return {
            "matchFolder": self.match_folder,
            "teams": [_team_payload(team) for team in self.teams_by_id.values()],
            "players": [_player_payload(player) for player in self.players_by_id.values()],
            "pitch": {"length": self.context.pitch_length_m, "width": self.context.pitch_width_m},
            "frameRate": self.context.frame_rate,
            "phases": {
                "firstHalf": {
                    "startFrame": self.context.phase_start_by_section["firstHalf"],
                    "kpiBase": 10_000,
                },
                "secondHalf": {
                    "startFrame": self.context.phase_start_by_section["secondHalf"],
                    "kpiBase": 100_000,
                },
            },
            "frameRange": {
                "start": min(event_frames) if event_frames else self.context.phase_start_by_section["firstHalf"],
                "end": max(event_frames) if event_frames else self.default_frame(),
            },
            "defaultFrame": self.default_frame(),
            "bodyConnections": [{"from": left, "to": right} for left, right in BODY_CONNECTIONS],
            "eventCounts": dict(sorted(event_counts.items())),
            "dataPolicy": {
                "scope": "one-match",
                "match": DEFAULT_MATCH_FOLDER,
                "fullDownloads": False,
                "maxApiWindowFrames": MAX_API_WINDOW_FRAMES,
            },
        }

    def default_frame(self) -> int:
        for event in self.events:
            if event["type"] == "ShotAtGoal" and event.get("skeletonFrame") is not None:
                return int(event["skeletonFrame"])
        assert self.context is not None
        return int(self.context.phase_start_by_section["firstHalf"])

    def events_payload(self, start_frame: int, end_frame: int) -> dict[str, Any]:
        validate_visualizer_window(start_frame, end_frame, max_frames=20_000)
        events = [
            event
            for event in self.events
            if event.get("skeletonFrame") is not None and start_frame <= int(event["skeletonFrame"]) <= end_frame
        ]
        return {"matchFolder": self.match_folder, "startFrame": start_frame, "endFrame": end_frame, "events": events}

    def event_payload(self, event_id: str) -> dict[str, Any]:
        normalized_id = event_id.strip()
        for event in self.events:
            if event.get("eventId") == normalized_id:
                return {
                    "matchFolder": self.match_folder,
                    "event": event,
                    "frame": event.get("skeletonFrame"),
                }
        raise ValueError(f"Unknown event id: {event_id}")

    def frame_payload(self, frame_number: int) -> dict[str, Any]:
        if frame_number in self.frame_cache:
            return {"matchFolder": self.match_folder, "frame": self.frame_cache[frame_number], "cache": "hit"}
        start_frame = max(_min_phase_start(self), frame_number - 1)
        frames = self._read_frames(start_frame, frame_number)
        if not frames:
            return {"matchFolder": self.match_folder, "frame": None, "cache": "miss", "error": "No skeleton frame found"}
        previous: SkeletonFrame | None = frames[-2] if len(frames) > 1 else None
        current = frames[-1]
        normalized = normalize_frame(
            current,
            players_by_key=self.players_by_key,
            previous_frame=previous,
            frame_rate=self.context.frame_rate,
        )
        normalized["events"] = self.events_payload(current.frame_number - 25, current.frame_number + 25)["events"]
        self.frame_cache[current.frame_number] = normalized
        return {"matchFolder": self.match_folder, "frame": normalized, "cache": "miss"}

    def chunk_payload(self, start_frame: int, end_frame: int, *, stride: int = 2) -> dict[str, Any]:
        validate_visualizer_window(start_frame, end_frame, max_frames=MAX_API_WINDOW_FRAMES)
        stride = max(1, int(stride))
        frames = self._read_frames(start_frame, end_frame)
        payload_frames: list[dict[str, Any]] = []
        previous: SkeletonFrame | None = None
        for frame in frames:
            if (frame.frame_number - start_frame) % stride != 0:
                previous = frame
                continue
            normalized = normalize_frame(frame, players_by_key=self.players_by_key, previous_frame=previous, frame_rate=self.context.frame_rate)
            normalized["events"] = self.events_payload(frame.frame_number - 25, frame.frame_number + 25)["events"]
            self.frame_cache[frame.frame_number] = normalized
            payload_frames.append(normalized)
            previous = frame
        return {
            "matchFolder": self.match_folder,
            "startFrame": start_frame,
            "endFrame": end_frame,
            "stride": stride,
            "frames": payload_frames,
        }

    def position_payload(self, frame_number: int) -> dict[str, Any]:
        return {
            "matchFolder": self.match_folder,
            "frameNumber": frame_number,
            "available": False,
            "message": "Positional XML layer is optional in the first app; skeleton parquet and KPI data remain available.",
        }

    def _load_local_files(self) -> None:
        match_dir = self.data_root / self.match_folder
        metadata_path = _single(match_dir.glob("**/*metadata.json"), "metadata JSON")
        match_info_path = _single(match_dir.glob("MatchInformations_*.xml"), "match information XML")
        kpi_path = _single(match_dir.glob("kpi_data_*.xml"), "KPI XML")
        raw_path = _single(match_dir.glob("Events_*.xml"), "raw events XML")

        self.context = load_match_context(metadata_path, self.match_folder)
        self.players_by_id, self.teams_by_id = parse_match_information_xml(match_info_path.read_text())
        self.context.players_by_id = self.players_by_id
        self.context.teams_by_id = self.teams_by_id
        self.players_by_key = {player.parquet_key: player for player in self.players_by_id.values()}
        self.events = parse_visualizer_events(
            self.context,
            self.players_by_id,
            self.teams_by_id,
            kpi_path.read_text(),
            raw_path.read_text(),
        )

    def _read_frames(self, start_frame: int, end_frame: int) -> list[SkeletonFrame]:
        validate_visualizer_window(start_frame, end_frame, max_frames=MAX_API_WINDOW_FRAMES)
        return read_s3_skeleton_window(
            default_s3_uri(self.match_folder),
            start_frame,
            end_frame,
            profile=self.aws_profile,
            selected_players=all_player_parquet_keys(self.players_by_id),
            selected_parts=METRIC_PARTS,
            max_window_frames=MAX_API_WINDOW_FRAMES,
        )


@dataclass
class ShootingReviewService:
    data_root: Path = DEFAULT_DATA_ROOT
    review_dir: Path = DEFAULT_SHOOTING_REVIEW_DIR
    derived_root: Path = DEFAULT_DERIVED_ROOT
    aws_profile: str = DEFAULT_AWS_PROFILE
    scores: list[dict[str, str]] = field(default_factory=list)
    shots: list[dict[str, str]] = field(default_factory=list)
    candidates: list[dict[str, str]] = field(default_factory=list)
    routers: list[dict[str, str]] = field(default_factory=list)
    features: list[dict[str, str]] = field(default_factory=list)
    frame_cache: dict[tuple[str, int], dict[str, Any]] = field(default_factory=dict)
    match_cache: dict[str, dict[str, Any]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.data_root = Path(self.data_root)
        self.review_dir = Path(self.review_dir)
        self.derived_root = Path(self.derived_root)
        self._load_review_outputs()

    def summary_payload(self) -> dict[str, Any]:
        cards = []
        for score in self.scores:
            key = _row_key(score)
            shot = self._shot_by_key().get(key, {})
            rank1 = self._candidates_by_key().get(key, [{}])[0]
            cards.append(
                {
                    "eventId": score.get("event_id"),
                    "matchFolder": score.get("match_folder"),
                    "player": shot.get("player_name") or shot.get("player_id"),
                    "team": shot.get("team_name") or shot.get("team_id"),
                    "family": score.get("family"),
                    "result": score.get("shot_result"),
                    "Q": _optional_float(score.get("Q")),
                    "additive": _optional_float(score.get("additive_score")),
                    "ear": _optional_float(score.get("ear_score")),
                    "weakest": score.get("weakest_constraint"),
                    "techniqueMechanics": _optional_float(score.get("technique_mechanics_score")),
                    "techniqueMechanicsBand": score.get("technique_mechanics_band") or None,
                    "strikeQuality": _optional_float(score.get("strike_quality_score")),
                    "strikeQualityBand": score.get("strike_quality_band") or None,
                    "selectedBy": rank1.get("selected_by") or "",
                    "contactFrame": _optional_int(rank1.get("candidate_frame")),
                }
            )
        return {
            "shotCount": len(cards),
            "familyCounts": dict(Counter(card["family"] for card in cards)),
            "shots": cards,
        }

    def shot_payload(self, match_folder: str, event_id: str) -> dict[str, Any]:
        key = (match_folder, event_id)
        shot = self._shot_by_key().get(key)
        score = self._score_by_key().get(key)
        if shot is None or score is None:
            raise ValueError(f"Unknown shooting event {match_folder}/{event_id}")
        candidates = self._candidates_by_key().get(key, [])
        features = self._feature_by_key().get(key, {})
        router = self._router_by_key().get(key, {})
        contact = _optional_int(features.get("contact_frame")) or _optional_int(candidates[0].get("candidate_frame") if candidates else None)
        physics_exit = _optional_int(features.get("physics_exit_frame")) or contact
        biomech = _optional_int(features.get("biomech_frame"))
        anchor = _optional_int(shot.get("skeleton_frame")) or contact
        center = contact or anchor or 0
        rank1 = candidates[0] if candidates else {}
        visual_contact = biomech or contact
        interval_frames = [frame for frame in (visual_contact, contact, physics_exit) if frame is not None]
        return {
            "shot": {
                "eventId": event_id,
                "matchFolder": match_folder,
                "player": shot.get("player_name") or shot.get("player_id"),
                "team": shot.get("team_name") or shot.get("team_id"),
                "section": shot.get("section"),
                "anchorFrame": anchor,
                "syncedFrameId": _optional_int(shot.get("synced_frame_id")),
            },
            "score": score,
            "legacy": _legacy_score_payload(score),
            "modules": _module_payload(score),
            "phases": _phase_payload(score),
            "phaseScores": _phase_score_payload(score),
            "flight": _flight_payload(score, features),
            "featureDeclarations": list(MODULE_FEATURE_DECLARATIONS),
            "features": features,
            "candidates": candidates,
            "router": router,
            "frameRoles": {
                "anchorFrame": anchor,
                "contactFrame": contact,
                "physicsExitFrame": physics_exit,
                "visualContactFrame": visual_contact,
                "biomechFrame": biomech,
                "strikeIntervalStart": min(interval_frames) if interval_frames else None,
                "strikeIntervalEnd": max(interval_frames) if interval_frames else None,
                "selectionSignal": _selection_signal(rank1.get("selected_by")),
                "nearestPartAtExit": rank1.get("nearest_part") or None,
            },
            "frameWindow": {
                "start": center - 50,
                "end": center + 30,
                "impact": physics_exit,
                "contact": contact,
                "physicsExit": physics_exit,
                "biomech": biomech,
            },
        }

    def frame_payload(self, match_folder: str, frame_number: int) -> dict[str, Any]:
        key = (match_folder, frame_number)
        if key in self.frame_cache:
            return {"matchFolder": match_folder, "frame": self.frame_cache[key], "cache": "hit"}
        context = self._match_context(match_folder)
        frames = self._read_frames(match_folder, frame_number - 1, frame_number)
        if not frames:
            return {"matchFolder": match_folder, "frame": None, "cache": "miss", "error": "No skeleton frame found"}
        previous = frames[-2] if len(frames) > 1 else None
        current = frames[-1]
        normalized = normalize_frame(
            current,
            players_by_key=context["players_by_key"],
            previous_frame=previous,
            frame_rate=context["context"].frame_rate,
        )
        self.frame_cache[key] = normalized
        return {"matchFolder": match_folder, "frame": normalized, "cache": "miss"}

    def chunk_payload(self, match_folder: str, start_frame: int, end_frame: int, *, stride: int = 2) -> dict[str, Any]:
        validate_visualizer_window(start_frame, end_frame, max_frames=SHOOTING_API_WINDOW_FRAMES)
        context = self._match_context(match_folder)
        frames = self._read_frames(match_folder, start_frame, end_frame)
        payload_frames: list[dict[str, Any]] = []
        previous: SkeletonFrame | None = None
        for frame in frames:
            if (frame.frame_number - start_frame) % max(1, stride) != 0:
                previous = frame
                continue
            normalized = normalize_frame(frame, players_by_key=context["players_by_key"], previous_frame=previous, frame_rate=context["context"].frame_rate)
            self.frame_cache[(match_folder, frame.frame_number)] = normalized
            payload_frames.append(normalized)
            previous = frame
        return {"matchFolder": match_folder, "startFrame": start_frame, "endFrame": end_frame, "stride": stride, "frames": payload_frames}

    def _load_review_outputs(self) -> None:
        self.scores = _read_csv(self.review_dir / "scores_v1.csv")
        self.shots = _read_csv(self.review_dir / "shots.csv")
        self.candidates = _read_csv(self.review_dir / "contact_candidates.csv")
        self.routers = _read_csv(self.review_dir / "router_audit.csv")
        self.features = []
        review_features = self.review_dir / "features.csv"
        if review_features.exists():
            self.features.extend(_read_csv(review_features))
            return
        feature_paths = sorted(self.derived_root.glob("shooting1_*_s3_v5/features.csv"))
        if not feature_paths:
            feature_paths = sorted(self.derived_root.glob("shooting1_*_s3_v4/features.csv"))
        for path in feature_paths:
            self.features.extend(_read_csv(path))

    def _score_by_key(self) -> dict[tuple[str, str], dict[str, str]]:
        return {_row_key(row): row for row in self.scores}

    def _shot_by_key(self) -> dict[tuple[str, str], dict[str, str]]:
        return {_row_key(row): row for row in self.shots}

    def _feature_by_key(self) -> dict[tuple[str, str], dict[str, str]]:
        return {_row_key(row): row for row in self.features}

    def _router_by_key(self) -> dict[tuple[str, str], dict[str, str]]:
        return {_row_key(row): row for row in self.routers}

    def _candidates_by_key(self) -> dict[tuple[str, str], list[dict[str, str]]]:
        grouped: dict[tuple[str, str], list[dict[str, str]]] = {}
        for row in self.candidates:
            grouped.setdefault(_row_key(row), []).append(row)
        for rows in grouped.values():
            rows.sort(key=lambda row: _optional_int(row.get("candidate_rank")) or 999)
        return grouped

    def _match_context(self, match_folder: str) -> dict[str, Any]:
        if match_folder in self.match_cache:
            return self.match_cache[match_folder]
        match_dir = self.data_root / match_folder
        metadata_path = _single(match_dir.glob("**/*metadata.json"), "metadata JSON")
        match_info_path = _single(match_dir.glob("MatchInformations_*.xml"), "match information XML")
        context = load_match_context(metadata_path, match_folder)
        players_by_id, teams_by_id = parse_match_information_xml(match_info_path.read_text())
        context.players_by_id = players_by_id
        context.teams_by_id = teams_by_id
        payload = {
            "context": context,
            "players_by_id": players_by_id,
            "teams_by_id": teams_by_id,
            "players_by_key": {player.parquet_key: player for player in players_by_id.values()},
        }
        self.match_cache[match_folder] = payload
        return payload

    def _read_frames(self, match_folder: str, start_frame: int, end_frame: int) -> list[SkeletonFrame]:
        validate_visualizer_window(start_frame, end_frame, max_frames=SHOOTING_API_WINDOW_FRAMES)
        context = self._match_context(match_folder)
        return read_s3_skeleton_window(
            default_s3_uri(match_folder),
            start_frame,
            end_frame,
            profile=self.aws_profile,
            selected_players=all_player_parquet_keys(context["players_by_id"]),
            selected_parts=METRIC_PARTS,
            max_window_frames=SHOOTING_API_WINDOW_FRAMES,
        )


def validate_visualizer_match(match_folder: str) -> str:
    if match_folder != DEFAULT_MATCH_FOLDER:
        raise ValueError(f"Visualizer is scoped to {DEFAULT_MATCH_FOLDER}; got {match_folder!r}")
    return match_folder


def validate_visualizer_window(start_frame: int, end_frame: int, *, max_frames: int = MAX_API_WINDOW_FRAMES) -> None:
    if end_frame < start_frame:
        raise ValueError(f"Invalid frame window: {end_frame} is before {start_frame}")
    frame_count = end_frame - start_frame + 1
    if frame_count > max_frames:
        raise ValueError(f"Frame window spans {frame_count} frames, above limit {max_frames}")


def normalize_frame(
    frame: SkeletonFrame,
    *,
    players_by_key: dict[tuple[int, int], PlayerInfo],
    previous_frame: SkeletonFrame | None,
    frame_rate: int = 50,
) -> dict[str, Any]:
    players: list[dict[str, Any]] = []
    for key, parts in sorted(frame.players.items(), key=lambda item: (item[0][0], item[0][1])):
        player = players_by_key.get(key)
        previous_parts = previous_frame.players.get(key, {}) if previous_frame else {}
        players.append(
            {
                "teamCode": key[0],
                "jerseyNumber": key[1],
                "personId": player.person_id if player else None,
                "name": player.short_name if player else _fallback_name(key),
                "teamId": player.team_id if player else None,
                "teamName": player.team_name if player else _team_name_for_code(key[0]),
                "teamRole": player.team_role if player else None,
                "playingPosition": player.playing_position if player else None,
                "isGoalkeeper": player.is_goalkeeper if player else False,
                "parts": {name: _vec_payload(point) for name, point in sorted(parts.items())},
                "pelvisSpeed": _pelvis_speed(parts, previous_parts, frame, previous_frame, frame_rate),
                "headDirection": _direction_payload(_head_direction(parts)),
                "shoulderAxis": _direction_payload(_axis(parts, "left_shoulder", "right_shoulder")),
                "hipAxis": _direction_payload(_axis(parts, "left_hip", "right_hip")),
                "nearestBallDistance": _nearest_ball_distance(frame.ball, parts),
            }
        )
    return {
        "frameNumber": frame.frame_number,
        "ball": None
        if frame.ball is None
        else {
            "position": _vec_payload(frame.ball),
            "velocity": _vec_payload(frame.ball_velocity) if frame.ball_velocity else None,
        },
        "players": players,
    }


def parse_visualizer_events(
    context: Any,
    players_by_id: dict[str, PlayerInfo],
    teams_by_id: dict[str, TeamInfo],
    kpi_xml_text: str,
    raw_xml_text: str,
) -> list[dict[str, Any]]:
    del raw_xml_text
    root = ET.fromstring(kpi_xml_text)
    events: list[dict[str, Any]] = []
    for el in root.iter():
        if el.tag not in KPI_EVENT_TAGS or el.get("SyncSuccessful") not in {"true", "True", "1"}:
            continue
        synced_frame = _optional_int(el.get("SyncedFrameId"))
        section = _normalize_section(el.get("InGameSection") or el.get("GameSection"))
        if synced_frame is None or section is None:
            continue
        try:
            skeleton_frame = kpi_to_skeleton_frame(context, synced_frame, section)
        except ValueError:
            skeleton_frame = None
        player_id = _primary_player_id(el)
        team_id = _primary_team_id(el)
        player = players_by_id.get(player_id or "")
        team = teams_by_id.get(team_id or "")
        events.append(
            {
                "eventId": el.get("EventId"),
                "type": el.tag,
                "section": section,
                "kpiFrame": synced_frame,
                "skeletonFrame": skeleton_frame,
                "gameTime": el.get("GameTime"),
                "teamId": team_id,
                "teamName": team.name if team else None,
                "playerId": player_id,
                "playerName": player.short_name if player else None,
                "x": _optional_float(el.get("X-Position")),
                "y": _optional_float(el.get("Y-Position")),
                "attributes": {attr: el.get(attr) for attr in INTERESTING_ATTRS if el.get(attr) is not None},
            }
        )
    return sorted(events, key=lambda event: (event.get("skeletonFrame") is None, event.get("skeletonFrame") or 0))


def _single(paths: Any, label: str) -> Path:
    matches = sorted(paths)
    if not matches:
        raise FileNotFoundError(f"Could not find {label}")
    return matches[0]


def _read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def _row_key(row: dict[str, str]) -> tuple[str, str]:
    return (row.get("match_folder") or "", row.get("event_id") or "")


def _legacy_score_payload(score: dict[str, str]) -> dict[str, Any]:
    return {
        "D": _optional_float(score.get("D")),
        "T": _optional_float(score.get("T")),
        "B": _optional_float(score.get("B")),
        "C": _optional_float(score.get("C")),
        "V": _optional_float(score.get("V")),
        "Q": _optional_float(score.get("Q")),
        "additive_score": _optional_float(score.get("additive_score")),
        "ear_score": _optional_float(score.get("ear_score")),
        "weakest_constraint": score.get("weakest_constraint") or None,
    }


def _module_payload(score: dict[str, str]) -> dict[str, dict[str, Any]]:
    labels = {
        "technique": "Technique",
        "technique_mechanics": "Technique Mechanics",
        "positioning": "Shot Geometry",
        "shot_geometry": "Shot Geometry",
        "receiving_pressure": "Arrival / Receiving",
        "arrival_receiving": "Arrival / Receiving",
        "approach_prep": "Approach Prep",
        "placement": "Placement",
        "strike_output": "Strike Output",
        "strike_quality": "Strike Quality",
        "P4_mech": "P4 Mechanics",
        "P4_strike": "P4 Strike",
        "decision_quality": "Decision Quality",
        "carry_progression": "Carry Progression",
    }
    return {
        key: {
            "label": label,
            "score": _optional_float(score.get(f"{key}_score")),
            "q": _optional_float(score.get(f"{key}_q")),
            "band": score.get(f"{key}_band") or None,
        }
        for key, label in labels.items()
    }


def _phase_payload(score: dict[str, str]) -> dict[str, dict[str, Any]]:
    phases: dict[str, dict[str, Any]] = {}
    for phase in PHASE_OFFSETS:
        start = _optional_int(score.get(f"phase_{phase}_start"))
        end = _optional_int(score.get(f"phase_{phase}_end"))
        available_value = str(score.get(f"phase_{phase}_available") or "").lower()
        phases[phase] = {
            "start": start,
            "end": end,
            "available": available_value in {"true", "1", "yes"} if available_value else start is not None and end is not None,
        }
    return phases


def _phase_score_payload(score: dict[str, str]) -> dict[str, dict[str, Any]]:
    return {
        phase: {
            "score": _optional_float(score.get(f"{phase}_score")),
            "q": _optional_float(score.get(f"{phase}_q")),
        }
        for phase in PHASE_OFFSETS
    }


def _flight_payload(score: dict[str, str], features: dict[str, str]) -> dict[str, Any]:
    def value(key: str) -> str | None:
        return score.get(key) if score.get(key) not in (None, "") else features.get(key)

    blocked = str(value("blocked_flight_flag") or "").lower()
    return {
        "initialVelocity": {
            "x": _optional_float(value("initial_ball_velocity_x_m_s")),
            "y": _optional_float(value("initial_ball_velocity_y_m_s")),
            "z": _optional_float(value("initial_ball_velocity_z_m_s")),
            "speed": _optional_float(value("initial_ball_speed_m_s")),
        },
        "goalPlane": {
            "y": _optional_float(value("goal_plane_y_m")),
            "z": _optional_float(value("goal_plane_z_m")),
        },
        "blockedFlight": blocked in {"true", "1", "yes"},
    }


def _selection_signal(selected_by: str | None) -> str:
    if selected_by == "position_delta_jump":
        return "position_delta_jump"
    if selected_by == "decisive_jump":
        return "ball_velocity_jump"
    if selected_by:
        return selected_by
    return "contact_cost"


def _min_phase_start(service: VisualizerService) -> int:
    assert service.context is not None
    return min(service.context.phase_start_by_section.values())


def _player_payload(player: PlayerInfo) -> dict[str, Any]:
    return {
        "personId": player.person_id,
        "teamId": player.team_id,
        "teamName": player.team_name,
        "teamRole": player.team_role,
        "teamCode": player.parquet_team,
        "jerseyNumber": player.shirt_number,
        "name": player.short_name,
        "playingPosition": player.playing_position,
        "isGoalkeeper": player.is_goalkeeper,
    }


def _team_payload(team: TeamInfo) -> dict[str, Any]:
    return {"teamId": team.team_id, "name": team.name, "role": team.role, "teamCode": team.parquet_team}


def _vec_payload(vec: Vec3) -> dict[str, float]:
    return {"x": float(vec.x), "y": float(vec.y), "z": float(vec.z)}


def _direction_payload(direction: tuple[float, float] | None) -> dict[str, float] | None:
    if direction is None:
        return None
    return {"x": float(direction[0]), "y": float(direction[1])}


def _fallback_name(key: tuple[int, int]) -> str:
    if key[0] == 3:
        return f"Referee {key[1]}"
    return f"Team {key[0]} #{key[1]}"


def _team_name_for_code(team_code: int) -> str | None:
    if team_code == 1:
        return "Home"
    if team_code == 0:
        return "Away"
    if team_code == 3:
        return "Referee"
    return None


def _pelvis_speed(
    parts: dict[str, Vec3],
    previous_parts: dict[str, Vec3],
    frame: SkeletonFrame,
    previous_frame: SkeletonFrame | None,
    frame_rate: int,
) -> float | None:
    pelvis = parts.get("pelvis")
    previous_pelvis = previous_parts.get("pelvis")
    if pelvis is None or previous_pelvis is None or previous_frame is None:
        return None
    dt = max((frame.frame_number - previous_frame.frame_number) / frame_rate, 1e-9)
    return math.hypot(pelvis.x - previous_pelvis.x, pelvis.y - previous_pelvis.y) / dt


def _head_direction(parts: dict[str, Vec3]) -> tuple[float, float] | None:
    nose = parts.get("nose")
    left_ear = parts.get("left_ear")
    right_ear = parts.get("right_ear")
    if nose is not None and left_ear is not None and right_ear is not None:
        ear_mid = Vec3((left_ear.x + right_ear.x) / 2.0, (left_ear.y + right_ear.y) / 2.0, 0.0)
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


def _normalize2(vector: tuple[float, float]) -> tuple[float, float] | None:
    norm = math.hypot(vector[0], vector[1])
    if norm == 0:
        return None
    return (vector[0] / norm, vector[1] / norm)


def _nearest_ball_distance(ball: Vec3 | None, parts: dict[str, Vec3]) -> float | None:
    if ball is None:
        return None
    distances = [math.sqrt((ball.x - point.x) ** 2 + (ball.y - point.y) ** 2 + (ball.z - point.z) ** 2) for point in parts.values()]
    return min(distances) if distances else None


def _primary_player_id(el: ET.Element) -> str | None:
    for attr in ("PlayerId", "ReceiverId", "WinnerPlayerId", "LoserPlayerId", "FoulerPlayerId", "FouledPlayerId"):
        value = el.get(attr)
        if value:
            return value
    return None


def _primary_team_id(el: ET.Element) -> str | None:
    for attr in ("TeamId", "WinnerTeamId", "LoserTeamId", "FoulerTeamId", "FouledTeamId"):
        value = el.get(attr)
        if value:
            return value
    return None


def _optional_int(value: str | None) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _optional_float(value: str | None) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _normalize_section(section: str | None) -> str | None:
    if section in {"firstHalf", "1", "first"}:
        return "firstHalf"
    if section in {"secondHalf", "2", "second"}:
        return "secondHalf"
    return section
