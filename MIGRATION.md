# Migrating implementation from the dev workspace

The `final-repo/` tree is the **push target**. Source of truth during development may still live in the parent `aws/` folder. Run the sync script once before tagging a release:

```bash
./scripts/sync_from_workspace.sh /Users/tayyabkhan/Downloads/aws
```

## Files to copy

| Source (workspace) | Destination (final-repo) |
|--------------------|---------------------------|
| `shooting1/*.py` | `metrics-calculation/shooting1/` |
| `src/aws_football/*.py` | `src/aws_football/` |
| `web/visualizer/*` | `visualizer/web/` |
| `scripts/serve_visualizer.py` | `visualizer/scripts/serve_visualizer.py` |
| `shooting-remotion/` (no `node_modules`, no `out/`) | `shooting-videos/remotion/` |
| `scripts/export_template_a.sh`, `render_template_a.sh` | `shooting-videos/scripts/` |
| `derived/shooting_feature_phase_annotation_scale_v3.csv` | `shooting-videos/data/` (annotation scale only) |
| `configs/aws.env.example` | already in repo; merge if changed |

## Do not copy (hackathon rule — no data in GitHub)

- `data-small/`, `Match_Data/`, any XML/JSON/parquet from the challenge
- `derived/shooting1_v3_*` or any real-match `scores_v1.csv` / `features.csv`
- `shooting-remotion/node_modules/`, `shooting-remotion/out/`
- AWS credentials, `aws-hackathon.env`

Keep `HACKATHON_DATA_ROOT` on your machine **outside** the `final-repo` clone.

## After sync

1. `pip install -e ".[metrics]"`
2. `./scripts/reproduce.sh --no-s3` (smoke) then full S3 run
3. `cd shooting-videos/remotion && npm ci`
