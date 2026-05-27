# Bundesliga 3D Football — Shooting BSQ (Hackathon Submission Repo)

Reproducible **shooting Body-Strike Quality (BSQ)** metrics, an interactive **3D visualizer**, and **Remotion explainer videos** built on Bundesliga skeletal parquet + KPI event data.

This repository is the GitHub deliverable referenced in `submission/github_link.txt`.

**Hackathon rule:** the official match dataset must **not** be uploaded to GitHub (no XML, JSON metadata, parquet, positions files, or row-level score exports). This repo contains **code only**. Reviewers with hackathon AWS access re-run the pipeline against the same S3 bucket and keep local XML/metadata **outside** the clone (`HACKATHON_DATA_ROOT`). See [`docs/DATA_POLICY.md`](docs/DATA_POLICY.md).

## Repository layout

| Path | Purpose |
|------|---------|
| [`metrics-calculation/`](metrics-calculation/) | **Notebooks** (formulation + results) + Python pipeline (`shooting1/`) |
| [`metrics-calculation/notebooks/`](metrics-calculation/notebooks/) | Primary judge path — executed outputs, no AWS required |
| [`visualizer/`](visualizer/) | Browser 3D skeleton viewer + local API for shot review |
| [`shooting-videos/`](shooting-videos/) | Remotion compositions and render scripts for telestration clips |
| [`src/aws_football/`](src/aws_football/) | Shared S3 parquet access, frame alignment, match parsing |
| [`configs/`](configs/) | Match list, AWS profile template (no secrets) |
| [`docs/`](docs/) | Reproduction guide + hackathon deliverables checklist |
| [`submission/`](submission/) | Zip submission templates (`github_link.txt`, etc.) |
| [`scripts/reproduce.sh`](scripts/reproduce.sh) | One-command metric reproduction |

## Quick start (judges — no AWS)

Open the executed notebooks (formulation, computation, five-match results, player speedometers):

```bash
pip install -e ".[notebooks]"
jupyter lab metrics-calculation/notebooks/
```

Start with `00_methodology_and_formulation.ipynb` → `02_five_match_league_dashboard.ipynb` → `03_player_profile_harry_kane.ipynb`.

Reference tables live in `metrics-calculation/reference_outputs/` (derived BSQ scores, not raw tracking).

## Quick start (re-run pipeline — AWS required)

```bash
pip install -e ".[metrics,notebooks]"
export HACKATHON_DATA_ROOT="$HOME/bundesliga-challenge2-data"  # outside repo
export AWS_PROFILE=hackathon
./scripts/reproduce.sh
./scripts/export_reference_outputs.sh
```

See [`docs/REPRODUCTION.md`](docs/REPRODUCTION.md) and [`docs/FORMULATION.md`](docs/FORMULATION.md).

## Quick start (visualizer)

```bash
./visualizer/scripts/serve.sh
# Open http://127.0.0.1:8765/visualizer/shooting.html
```

Requires metric outputs (or paths configured in the server) and AWS credentials for live parquet chunks.

## Quick start (videos)

```bash
cd shooting-videos/remotion
npm ci
npm run render:template-a   # after shot JSON bundles are exported
```

See [`shooting-videos/README.md`](shooting-videos/README.md).

## What is *not* in this repo

Per hackathon rules — **nothing from the challenge dataset**:

- No `Match_Data/`, `data-small/`, parquet, positional XML, KPI/events XML, or metadata JSON
- No full `scores_v1.csv` / `features.csv` from real matches (regenerate locally)
- Parquet is read from **S3 at runtime**; XML/metadata from **`$HACKATHON_DATA_ROOT`** (outside the clone)

[`docs/DATA_POLICY.md`](docs/DATA_POLICY.md) · [`docs/REPRODUCTION.md`](docs/REPRODUCTION.md)

## Migrating code from the dev workspace

This scaffold was created from the parent `aws/` workspace. To sync implementation files before push:

```bash
./scripts/sync_from_workspace.sh /path/to/aws
```

See [`MIGRATION.md`](MIGRATION.md) for the file manifest.

## Citation / data

Bundesliga Challenge 2 — *Unlock the Power of 3D Football Data*, AWS World Sports Innovation Cup 2026. Skeleton schema: `Documentation_SkeletonData` (21 body parts, 50 Hz parquet).

## License

Hackathon submission — adjust before public release if required by your institution.
