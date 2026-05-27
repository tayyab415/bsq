from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, BinaryIO, Iterable
from urllib.parse import urlparse

from aws_football.dribble_pose import S3_MATCH_DATA_ROOT, Vec3


POSITIONAL_XML_BY_MATCH = {
    "Bayern_Hamburg": "Positions_Bayern_Hamburg.xml",
    "Dortmund_Stuttgart": "Positions_Dortmund_Stuttgart.xml",
    "Frankfurt_Bayern": "Positions_Frankfurt_Bayern.xml",
    "Frankfurt_Union": "Positions_Frankfurt_Union.xml",
    "Union_Bayern": "Positions_Union_Bayern.xml",
}


@dataclass(frozen=True)
class PositionalPlayerFrame:
    person_id: str
    team_id: str
    section: str
    frame_number: int
    x: float
    y: float
    speed_m_s: float | None = None
    velocity_x: float | None = None
    velocity_y: float | None = None


@dataclass
class PositionalFrameSnapshot:
    frame_number: int
    players: dict[str, PositionalPlayerFrame] = field(default_factory=dict)
    ball: Vec3 | None = None


def default_positional_s3_uri(match_folder: str) -> str | None:
    filename = POSITIONAL_XML_BY_MATCH.get(match_folder)
    if filename is None:
        return None
    return f"{S3_MATCH_DATA_ROOT}/{match_folder}/{filename}"


def resolve_positional_xml_path(
    match_dir: Path,
    match_folder: str,
    *,
    s3_uri: str | None = None,
) -> str | Path | None:
    if s3_uri:
        return s3_uri
    local = sorted(match_dir.glob("Positions_*.xml"))
    if local:
        return local[0]
    return default_positional_s3_uri(match_folder)


def load_positional_snapshots(
    source: str | Path,
    frame_numbers: Iterable[int],
    *,
    aws_profile: str | None = "hackathon",
    include_velocity_from_prior_frame: bool = True,
) -> dict[int, PositionalFrameSnapshot]:
    targets = {int(frame) for frame in frame_numbers if frame is not None}
    if not targets:
        return {}
    if include_velocity_from_prior_frame:
        targets |= {frame - 1 for frame in targets}
    raw_frames: dict[int, dict[str, PositionalPlayerFrame]] = {}
    for player_frame in iter_positional_player_frames(source, targets, aws_profile=aws_profile):
        raw_frames.setdefault(player_frame.frame_number, {})[player_frame.person_id] = player_frame
    snapshots: dict[int, PositionalFrameSnapshot] = {}
    for frame_number, players in raw_frames.items():
        snapshots[frame_number] = PositionalFrameSnapshot(frame_number=frame_number, players=dict(players))
    if include_velocity_from_prior_frame:
        _attach_velocities(snapshots)
    return {frame: snapshots[frame] for frame in frame_numbers if frame in snapshots}


def iter_positional_player_frames(
    source: str | Path,
    target_frames: set[int],
    *,
    aws_profile: str | None = "hackathon",
) -> Iterable[PositionalPlayerFrame]:
    if not target_frames:
        return
    min_frame = min(target_frames)
    max_frame = max(target_frames)
    with _open_xml_stream(source, aws_profile=aws_profile) as handle:
        context: dict[str, Any] = {"person_id": None, "team_id": None, "section": None}
        skip_frameset = False
        for event, elem in ET.iterparse(handle, events=("start", "end")):
            if event == "start" and elem.tag == "FrameSet":
                context = {
                    "person_id": elem.get("PersonId"),
                    "team_id": elem.get("TeamId"),
                    "section": elem.get("GameSection") or elem.get("InGameSection"),
                }
                skip_frameset = False
            elif event == "end" and elem.tag == "Frame":
                if skip_frameset:
                    elem.clear()
                    continue
                person_id = context.get("person_id")
                team_id = context.get("team_id")
                frame_number = _optional_int(elem.get("N"))
                if frame_number is not None and frame_number > max_frame:
                    skip_frameset = True
                    elem.clear()
                    continue
                if (
                    person_id
                    and team_id
                    and frame_number is not None
                    and min_frame <= frame_number <= max_frame
                    and frame_number in target_frames
                ):
                    x = _optional_float(elem.get("X"))
                    y = _optional_float(elem.get("Y"))
                    if x is not None and y is not None:
                        yield PositionalPlayerFrame(
                            person_id=person_id,
                            team_id=team_id,
                            section=str(context.get("section") or ""),
                            frame_number=frame_number,
                            x=x,
                            y=y,
                            speed_m_s=_optional_float(elem.get("S")),
                        )
                elem.clear()
            elif event == "end" and elem.tag == "FrameSet":
                elem.clear()


def _attach_velocities(snapshots: dict[int, PositionalFrameSnapshot], *, hz: float = 25.0) -> None:
    dt = 1.0 / hz
    for frame_number, snapshot in snapshots.items():
        prior = snapshots.get(frame_number - 1)
        if prior is None:
            continue
        for person_id, player in snapshot.players.items():
            previous = prior.players.get(person_id)
            if previous is None:
                continue
            vx = (player.x - previous.x) / dt
            vy = (player.y - previous.y) / dt
            snapshot.players[person_id] = PositionalPlayerFrame(
                person_id=player.person_id,
                team_id=player.team_id,
                section=player.section,
                frame_number=player.frame_number,
                x=player.x,
                y=player.y,
                speed_m_s=player.speed_m_s,
                velocity_x=vx,
                velocity_y=vy,
            )


def _open_xml_stream(source: str | Path, *, aws_profile: str | None) -> BinaryIO:
    if isinstance(source, Path):
        return source.open("rb")
    source_text = str(source)
    parsed = urlparse(source_text)
    if parsed.scheme in {"s3", "https", "http"}:
        try:
            import s3fs
        except ImportError as exc:
            raise RuntimeError("Reading positional XML from S3 requires s3fs") from exc
        fs = s3fs.S3FileSystem(profile=aws_profile or None)
        return fs.open(source_text, "rb")
    return Path(source_text).open("rb")


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
