# Reproducibility audit

Last checked: 2026-05-24 (local machine, `final-repo`).

## What “reproduce” means for this project

Judges clone **code only**, set `HACKATHON_DATA_ROOT` to official XML/metadata **outside** the repo, use hackathon **AWS** for parquet, then run `./scripts/reproduce.sh` to regenerate `metrics-calculation/outputs/all_matches/`.

## Tests run

| Test | Result | Notes |
|------|--------|--------|
| Fresh venv + `pip install -e ".[metrics]"` | **PASS** | Needs `pip install --upgrade pip` first on older pip |
| `./scripts/reproduce.sh` without `HACKATHON_DATA_ROOT` | **PASS** | Clear error, exit 1 |
| Parse all 5 matches / 127 shots (`shots.csv`) | **PASS** | Matches dev workspace `derived/shooting1_v3_all_matches/shots.csv` line count |
| Determinism: two `--no-s3` runs, same flags | **PASS** | `scores_v1.csv` and `features.csv` byte-identical |
| Git does not track outputs/data | **PASS** | `outputs/`, XML, parquet patterns in `.gitignore` |
| Full S3 run (127 scored, real tracking) | **NOT RUN HERE** | AWS SSO token expired during audit |
| Visualizer serves + loads a shot | **NOT RUN** | Needs metrics + valid AWS for chunks |
| Remotion `render:template-a` | **NOT RUN** | Needs `npm ci` + export bundles |

## Smoke vs full reproduction

| Mode | Command | What it proves |
|------|---------|----------------|
| **Smoke** | `./scripts/reproduce.sh --no-s3 --max-windows-per-match N` | XML parsing, routing, scoring code path; **no skeleton tracking** |
| **Full** | `./scripts/reproduce.sh` | Same + S3 parquet windows; scores **will differ** from `--no-s3` |

Reference numbers for a **full** successful run (dev workspace, May 2026):

```text
matches: 5
shots parsed: 127
windows scored: 127
windows with real frames: 127
S3/read errors: 0
```

After refresh AWS credentials, confirm your run matches `validation_report.md` in the output dir.

## Script fixes found during audit

- `reproduce.sh` / `run_all_matches.sh`: fixed `set -u` failures when no extra CLI args (empty arrays).
- Dependency pins: `s3fs`/`fsspec` upper bound for older pip resolvers.

## Reviewer checklist

```bash
git clone <your-repo> && cd <repo>
python3.11 -m venv .venv && source .venv/bin/activate
pip install --upgrade pip && pip install -e ".[metrics]"
export HACKATHON_DATA_ROOT="/path/outside/repo"   # …/Match_Data/…
export AWS_PROFILE=hackathon AWS_REGION=eu-central-1
aws sts get-caller-identity
./scripts/reproduce.sh
test -f metrics-calculation/outputs/all_matches/scores_v1.csv
grep "Windows scored: 127" metrics-calculation/outputs/all_matches/validation_report.md
```

## Gaps to close before submission

1. Run **full** `./scripts/reproduce.sh` once with live AWS and archive `validation_report.md` stats in the executive summary (not the CSVs in git).
2. Optionally add `scripts/verify_install.sh` to CI (smoke only).
3. Document exact `HACKATHON_DATA_ROOT` layout in README if organizers use a non-obvious folder name.
