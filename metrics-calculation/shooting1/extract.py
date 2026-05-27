from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Any

from aws_football.dribble_pose import (
    SkeletonFrame,
    _frame_number_column_index,
    _maybe_convert_centimeters,
    _s3_filesystem,
    _s3fs_path,
    flatten_skeleton_row,
    validate_s3_window_request,
)

from .metric import ShotEvent


@dataclass(frozen=True)
class RowGroupFrameRange:
    index: int
    min_frame: int | None
    max_frame: int | None
    row_count: int


@dataclass(frozen=True)
class PlannedShotWindow:
    event_id: str
    start_frame: int
    end_frame: int
    row_groups: tuple[int, ...]
    row_count: int


@dataclass(frozen=True)
class WindowPlan:
    windows_by_event: dict[str, PlannedShotWindow]
    selected_row_groups: tuple[int, ...]


@dataclass(frozen=True)
class BatchReadStats:
    windows_attempted: int
    windows_with_frames: int
    row_groups_selected: int
    row_groups_read: int
    s3_errors: int = 0


@dataclass(frozen=True)
class BatchWindowResult:
    frames_by_event: dict[str, list[SkeletonFrame]]
    errors_by_event: dict[str, str]
    stats: BatchReadStats


def build_row_group_index(parquet_file: Any) -> list[RowGroupFrameRange]:
    frame_column_index = _frame_number_column_index(parquet_file.metadata)
    row_groups: list[RowGroupFrameRange] = []
    for index in range(parquet_file.metadata.num_row_groups):
        row_group = parquet_file.metadata.row_group(index)
        stats = row_group.column(frame_column_index).statistics
        min_frame = int(stats.min) if stats is not None else None
        max_frame = int(stats.max) if stats is not None else None
        row_groups.append(RowGroupFrameRange(index, min_frame, max_frame, int(row_group.num_rows)))
    return row_groups


def plan_shot_windows(
    shots: list[ShotEvent],
    row_groups: list[RowGroupFrameRange],
    *,
    pre_frames: int,
    post_frames: int,
    max_window_frames: int = 250,
    max_row_groups_per_window: int = 3,
    max_rows_per_window: int = 5000,
) -> WindowPlan:
    windows: dict[str, PlannedShotWindow] = {}
    selected: set[int] = set()
    for shot in shots:
        start_frame = shot.skeleton_frame - pre_frames
        end_frame = shot.skeleton_frame + post_frames
        overlapping = tuple(
            row_group.index
            for row_group in row_groups
            if _overlaps(row_group.min_frame, row_group.max_frame, start_frame, end_frame)
        )
        row_count = sum(row_group.row_count for row_group in row_groups if row_group.index in overlapping)
        validate_s3_window_request(
            start_frame,
            end_frame,
            row_group_count=len(overlapping),
            row_count=row_count,
            max_window_frames=max_window_frames,
            max_row_groups=max_row_groups_per_window,
            max_rows=max_rows_per_window,
        )
        windows[shot.event_id] = PlannedShotWindow(shot.event_id, start_frame, end_frame, overlapping, row_count)
        selected.update(overlapping)
    return WindowPlan(windows, tuple(sorted(selected)))


def read_s3_skeleton_windows_batch(
    s3_uri: str,
    shots: list[ShotEvent],
    *,
    profile: str = "hackathon",
    selected_players: set[tuple[int, int]] | None = None,
    selected_parts: set[str] | None = None,
    pre_frames: int = 125,
    post_frames: int = 75,
    max_window_frames: int = 250,
    max_row_groups_per_window: int = 3,
    max_rows_per_window: int = 5000,
    retries: int = 2,
) -> BatchWindowResult:
    parquet_file = _with_retries(lambda: _open_s3_parquet(s3_uri, profile), retries=retries)
    row_groups = build_row_group_index(parquet_file)
    plan = plan_shot_windows(
        shots,
        row_groups,
        pre_frames=pre_frames,
        post_frames=post_frames,
        max_window_frames=max_window_frames,
        max_row_groups_per_window=max_row_groups_per_window,
        max_rows_per_window=max_rows_per_window,
    )
    frames_by_event = {shot.event_id: [] for shot in shots}
    errors_by_event: dict[str, str] = {}
    if not plan.selected_row_groups:
        return BatchWindowResult(
            frames_by_event,
            errors_by_event,
            BatchReadStats(len(shots), 0, 0, 0, 0),
        )

    needed_ranges_by_group = _needed_ranges_by_group(plan)
    events_by_group = _events_by_group(plan)
    frames_by_number: dict[int, SkeletonFrame] = {}
    errors_by_event: dict[str, str] = {}
    row_groups_read = 0
    for row_group_index in plan.selected_row_groups:
        try:
            table = _with_retries(
                lambda index=row_group_index: parquet_file.read_row_groups(
                    (index,),
                    columns=["frame_number", "ball", "skeletons"],
                    use_threads=False,
                ),
                retries=retries,
            )
        except Exception as exc:
            for event_id in events_by_group.get(row_group_index, ()):
                errors_by_event[event_id] = str(exc)
            continue
        row_groups_read += 1
        table = _filter_table_to_ranges(table, needed_ranges_by_group.get(row_group_index, ()))
        for frame in _maybe_convert_centimeters(
            [
                flatten_skeleton_row(row, selected_players=selected_players, selected_parts=selected_parts)
                for row in table.to_pylist()
            ]
        ):
            frames_by_number[frame.frame_number] = frame
    for event_id, window in plan.windows_by_event.items():
        frames_by_event[event_id] = [
            frames_by_number[frame_number]
            for frame_number in range(window.start_frame, window.end_frame + 1)
            if frame_number in frames_by_number
        ]
    windows_with_frames = sum(1 for frames in frames_by_event.values() if frames)
    return BatchWindowResult(
        frames_by_event,
        errors_by_event,
        BatchReadStats(
            windows_attempted=len(shots),
            windows_with_frames=windows_with_frames,
            row_groups_selected=len(plan.selected_row_groups),
            row_groups_read=row_groups_read,
            s3_errors=len(errors_by_event),
        ),
    )


def _open_s3_parquet(s3_uri: str, profile: str):
    try:
        import pyarrow.parquet as pq
    except ImportError as exc:
        raise RuntimeError("S3 parquet extraction requires pyarrow") from exc

    return pq.ParquetFile(_s3fs_path(s3_uri), filesystem=_s3_filesystem(profile))


def _needed_ranges_by_group(plan: WindowPlan) -> dict[int, tuple[tuple[int, int], ...]]:
    ranges: dict[int, list[tuple[int, int]]] = {}
    for window in plan.windows_by_event.values():
        for row_group in window.row_groups:
            ranges.setdefault(row_group, []).append((window.start_frame, window.end_frame))
    return {row_group: _merge_ranges(values) for row_group, values in ranges.items()}


def _events_by_group(plan: WindowPlan) -> dict[int, tuple[str, ...]]:
    events: dict[int, list[str]] = {}
    for event_id, window in plan.windows_by_event.items():
        for row_group in window.row_groups:
            events.setdefault(row_group, []).append(event_id)
    return {row_group: tuple(event_ids) for row_group, event_ids in events.items()}


def _merge_ranges(ranges: list[tuple[int, int]]) -> tuple[tuple[int, int], ...]:
    merged: list[list[int]] = []
    for start, end in sorted(ranges):
        if not merged or start > merged[-1][1] + 1:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    return tuple((start, end) for start, end in merged)


def _filter_table_to_ranges(table: Any, ranges: tuple[tuple[int, int], ...]):
    if not ranges or not hasattr(table, "filter"):
        return table
    try:
        import pyarrow.compute as pc
    except ImportError:
        return table

    frame_numbers = table["frame_number"]
    mask = None
    for start_frame, end_frame in ranges:
        range_mask = pc.and_(pc.greater_equal(frame_numbers, start_frame), pc.less_equal(frame_numbers, end_frame))
        mask = range_mask if mask is None else pc.or_(mask, range_mask)
    return table.filter(mask) if mask is not None else table


def _with_retries(call, *, retries: int):
    last_exc = None
    for attempt in range(retries + 1):
        try:
            return call()
        except Exception as exc:
            last_exc = exc
            if attempt >= retries:
                break
            time.sleep(1.5 * (attempt + 1))
    raise last_exc


def _overlaps(min_frame: int | None, max_frame: int | None, start_frame: int, end_frame: int) -> bool:
    if min_frame is None or max_frame is None:
        return True
    return max_frame >= start_frame and min_frame <= end_frame
