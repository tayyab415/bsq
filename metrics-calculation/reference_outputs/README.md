# shooting1

Unified shooting metric derived outputs. The builder parses local metadata, match information, KPI shots, and raw shot labels, then samples bounded event-aligned parquet windows from S3 unless `--no-s3` is set.

Outputs: `players.csv`, `shots.csv`, `tracking_samples.csv`, `contact_candidates.csv`, `features.csv`, `scores_v1.csv`, `scores_v1.parquet`, `router_audit.csv`, `review_rows.csv`, `review_deck.html`, and `validation_report.md`.
