# Data policy (hackathon rules)

## What GitHub may contain

**Only source code and documentation:**

- Python / TypeScript / shell scripts
- Notebooks (code cells only — no embedded match rows)
- Config templates (`configs/matches.yaml` lists folder **names**, not data files)
- Optional **synthetic** fixtures under `metrics-calculation/fixtures/` (fake rows for CI)
- Small **Remotion props** (scores, frame indices) if they contain **no** skeleton coordinates copied from the official feed
- **`metrics-calculation/reference_outputs/`** — committed **derived** BSQ tables (127-shot rollout) for notebook reproducibility without AWS
- **Executed Jupyter notebooks** with embedded tables/plots (same derived metrics, not raw feeds)

## What must never be in GitHub

The challenge PDF states: **do not upload any hackathon data to the repository.**

That includes **all** of the following, even “small” files:

| Forbidden | Examples |
|-----------|----------|
| Parquet | `*.parquet`, skeleton/ball columns |
| Positional XML | `Positions_*.xml` |
| Event / KPI / match XML | `kpi_data_*.xml`, `Events_*.xml`, `MatchInformations_*.xml` |
| Metadata JSON | `*_metadata.json` |
| Local mirrors | `data-small/`, `Match_Data/`, any copy of the five-match bundle |
| Bulk derived tables | Full `scores_v1.csv` / `features.csv` for real matches (row-level outputs) |
| Credentials | `aws-hackathon.env`, API keys, session tokens |

If something came from the official S3 bucket or the distributed bundle, **keep it out of git**.

## Where data lives instead

```text
Your machine (OUTSIDE the clone)          AWS (hackathon account)
─────────────────────────────────         ─────────────────────────
$HACKATHON_DATA_ROOT/Match_Data/    +     s3://hackathon-data-…/Challenge 2…/
  (XML + metadata only, optional)           (*.parquet, full match prefix)
```

Set an absolute path **outside** the repository:

```bash
export HACKATHON_DATA_ROOT="$HOME/bundesliga-challenge2-data"
# e.g. $HACKATHON_DATA_ROOT/Match_Data/Bayern_Hamburg/kpi_data_….xml
```

Skeleton parquet is read **from S3 at runtime** (row-group pruning), not vendored in the repo.

## How reviewers “reproduce” without data in git

1. Clone this repo (code only).
2. Use **their** hackathon AWS access (ISB user guide) — same bucket you used.
3. Point `HACKATHON_DATA_ROOT` at XML/metadata they hold **locally outside the repo** (or sync from S3 per organizer instructions — still not committed).
4. Run `./scripts/reproduce.sh` → writes to `metrics-calculation/outputs/` (gitignored).

Reproduction means **re-running your pipeline on the official data they already have access to**, not downloading data from your GitHub.

## What goes in the submission zip (separate from GitHub)

| File | Data? |
|------|--------|
| `github_link.txt` | Link only |
| `presentation_video.mp4` | Demo visuals OK (no raw dataset file) |
| `executive_summary.pdf` | Charts/screenshots OK |
| `prfaq.pdf` | Optional narrative |

Still **no** full dataset in the zip — keep it small.

## Smoke tests without real data

```bash
./scripts/reproduce.sh --no-s3
```

Uses pipeline logic only; tracking windows are empty. For CI, add tiny **synthetic** fixtures (see `metrics-calculation/fixtures/README.md`).
