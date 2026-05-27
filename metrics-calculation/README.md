# Metrics calculation (BSQ metrics)

Python package that turns **KPI shot events + S3 parquet skeleton windows** into reproducible score tables.

## Layout

```text
metrics-calculation/
  shooting1/          # metric.py, build.py, extract.py (sync from workspace)
  scripts/            # thin wrappers around shooting1.build
  notebooks/          # optional exploration / judge-facing walkthrough
  outputs/            # generated CSVs (gitignored)
  fixtures/           # tiny sample rows for --no-s3 tests (optional)
```

## Run

From repo root:

```bash
./scripts/reproduce.sh
# or
./metrics-calculation/scripts/run_all_matches.sh
```

Single match:

```bash
./metrics-calculation/scripts/run_single_match.sh Bayern_Hamburg
```

## Core modules

| Module | Role |
|--------|------|
| `shooting1/build.py` | CLI orchestrator, multi-match rollout |
| `shooting1/metric.py` | Feature engineering + BSQ scoring |
| `shooting1/extract.py` | S3 parquet window batch reader |
| `src/aws_football/dribble_pose.py` | Frame alignment, skeleton types |

## Verify install

```bash
pip install --upgrade pip
pip install -e ".[metrics]"
export HACKATHON_DATA_ROOT="/path/outside/repo/to/data-small"   # contains Match_Data/
./scripts/reproduce.sh --no-s3 --max-windows-per-match 2        # smoke (~10 shots)
./scripts/reproduce.sh                                            # full S3 run
```

## Version

**Shooting v3** — phase mechanics, family-specific weights.
