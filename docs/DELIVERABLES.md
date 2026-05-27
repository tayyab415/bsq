# Hackathon deliverables (Challenge 2 PDF)

Source: *Challenge 2 — Unlock the Power of 3D Football Data* (Bundesliga AWS World Sports Innovation Cup 2026).

## Required zip contents (`TeamName.zip`)

| # | Item | Repo / action |
|---|------|----------------|
| i | **`github_link.txt`** | URL to this repo. Include source (`.py`, `.ipynb`, scripts) + **README with reproduction steps**. **Do not upload hackathon data.** If private, invite **MoellerO**. → [`submission/github_link.txt.example`](../submission/github_link.txt.example) |
| ii | **`presentation_video.mp4`** | ≤ **3 minutes**, **&lt;720p**. Demo of visualizer, a rendered shooting clip, or KPI walkthrough. → record from `visualizer/` or `shooting-videos/outputs/` |
| iii | **`executive_summary.pdf`** | ≤ **5 slides**: problem, KPI (BSQ), method (3D skeleton + phases), main outputs (tables + one video still), impact. Not stored in git (build in PowerPoint/Google Slides). |
| iv | *(Optional)* **`prfaq.pdf`** | Press-release style: what you built, why it matters for fans/coaches. |

## What the GitHub repo must prove (without shipping data)

The PDF requires reviewers to **execute your code and reproduce results**, but also says **do not upload hackathon data** to the repository. Those fit together like this:

1. **Runnable pipeline** — `scripts/reproduce.sh` + README; reviewers use **their** AWS + XML path outside the repo (`HACKATHON_DATA_ROOT`).
2. **Method transparency** — phase windows (P1–P6), KPI→parquet frame mapping, weights in `shooting1/metric.py` (code in git).
3. **Engagement artifact** — visualizer + Remotion **source** in git; demo **video** in the zip, not raw feeds.

Row-level CSV outputs are written locally (`metrics-calculation/outputs/`, gitignored). Summarize outcomes in `executive_summary.pdf`, not as committed data files.

See [`DATA_POLICY.md`](DATA_POLICY.md).

## Challenge goals (for executive summary)

From the brief, judges care that you:

1. **Invent KPIs** beyond classical event data — here: multi-phase **BSQ** (decision, technique, ball strike, context, value).
2. **Engage fans or coaches** — Remotion explainers + interactive 3D review.
3. **Benchmark / adapt** — biomechanics and xG-style decision layers documented in `docs/METHOD.md` (add when ready).

## Submission logistics

- Upload zip via the **file request link** in the PDF (Box).
- Resubmits: `TeamName_v2.zip`, avoid many versions.
- Questions: Discord (link in PDF).

## Checklist before upload

- [ ] `github_link.txt` points to tagged release or `main` with working README
- [ ] README reproduction verified on a clean venv
- [ ] **No hackathon data** in git (XML, JSON, parquet, positions, or full score tables)
- [ ] No credentials in git history
- [ ] `presentation_video.mp4` under 3 min and 720p
- [ ] `executive_summary.pdf` ≤ 5 slides with **screenshots of main outputs**
- [ ] Zip total size kept small (videos + pdf only; no data)
