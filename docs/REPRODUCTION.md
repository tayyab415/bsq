# Reproducing BSQ metrics

Reproduction is **code + official hackathon AWS data**. This repository does not ship match files.

## 1. Environment

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e ".[metrics]"
```

Audit log: [`REPRODUCIBILITY_AUDIT.md`](REPRODUCIBILITY_AUDIT.md)

AWS (ISB user guide — reviewers use the same hackathon account model):

```bash
export AWS_PROFILE=hackathon
export AWS_REGION=eu-central-1
aws sts get-caller-identity
```

## 2. Data outside the repo (required for a real run)

**Do not copy data into this repository.** Set a path **outside** the clone:

```bash
export HACKATHON_DATA_ROOT="$HOME/bundesliga-challenge2-data"
```

Expected layout (from the distributed bundle or your own sync into that folder):

```text
$HACKATHON_DATA_ROOT/Match_Data/
  Bayern_Hamburg/
    *_metadata.json
    MatchInformations_*.xml
    kpi_data_*.xml
    Events_*.xml
```

Parquet skeleton files stay on **S3**; the builder reads them with credentials (see `src/aws_football/dribble_pose.py` after sync).

Match folder names: [`configs/matches.yaml`](../configs/matches.yaml).

## 3. Run pipeline

```bash
./scripts/reproduce.sh
```

Requires `HACKATHON_DATA_ROOT` to be set. Outputs go to `metrics-calculation/outputs/` (gitignored).

### Options

| Flag / env | Effect |
|------------|--------|
| `--no-s3` | No parquet reads; validates XML parsing + scoring path only |
| `--match-folder Bayern_Hamburg` | Single match (pass-through to builder) |
| `HACKATHON_DATA_ROOT` | **Required** for real runs; must be outside repo |

## 4. Expected outputs (local only, not in git)

| File | Description |
|------|-------------|
| `shots.csv` | Shot events + family labels |
| `features.csv` | Per-shot features |
| `scores_v1.csv` | BSQ components + module scores |
| `validation_report.md` | Run summary |

Reference rollout (dev machine, official data): **127 shots**, **5 matches**, **0 S3 read errors** with valid credentials. Document summary stats in `executive_summary.pdf`, not full CSVs in GitHub.

## 5. Visualizer + videos

Same rule: run against `HACKATHON_DATA_ROOT` + S3; do not commit inputs or full outputs. Demo MP4 for the zip is built locally and uploaded to Box, not pushed as dataset.

## 6. Troubleshooting

| Issue | Fix |
|-------|-----|
| `HACKATHON_DATA_ROOT is not set` | Export path outside repo (see above) |
| `ExpiredToken` | Refresh hackathon AWS credentials |
| Empty tracking | Drop `--no-s3`; check S3 URI in metadata |
| Accidentally committed data | Remove from history before push; see `docs/DATA_POLICY.md` |
