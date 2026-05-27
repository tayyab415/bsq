# aws_football

Shared library for S3 parquet access, KPI→skeleton frame mapping, and match XML parsing.

Sync from workspace:

```bash
cp /path/to/aws/src/aws_football/*.py ./src/aws_football/
```

Modules:

| File | Role |
|------|------|
| `dribble_pose.py` | `SkeletonFrame`, S3 window reads, `kpi_to_skeleton_frame` |
| `visualizer.py` | Server-side helpers for visualizer API |
| `pressing.py`, `berta_pressing.py` | Optional; omit from minimal shooting repo if unused |

Install via `pip install -e ".[metrics]"` at repo root.
