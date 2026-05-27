# Method sketch (BSQ shooting metric)

*Fill in before submission; placeholders align with implemented v3 pipeline.*

## Data sources

- **KPI XML** — shot events, synced frames, pressure, xG, passer context.
- **Parquet skeleton (50 Hz)** — 21 body parts + ball; S3 row-group pruning by `frame_number`.
- **Metadata JSON** — phase start frames for KPI→skeleton alignment.

Frame mapping (validate per match):

```text
skeleton_frame = PhaseStart + 2 * (KPI_SyncedFrameId - phase_base)
```

## KPI structure

**BSQ** combines five modules (weights vary by shot family):

| Module | Code | Phases |
|--------|------|--------|
| Decision quality | D | P1 |
| Approach / timing | T | P2 |
| Technique mechanics | B | P3–P5 |
| Ball strike | C | P4 |
| Shot value context | V | P1 + outcome |

Implementation: `metrics-calculation/shooting1/metric.py` (after workspace sync).

## Outputs for judges

- Ranked shots per match (`scores_v1.csv`)
- Phase-feature breakdown (`features.csv`)
- Optional: Remotion clip per hero shot explaining top phase drivers

## References

- Workspace feasibility reports: pass orientation, dribble pose, space creation (sibling research; not all shipped in v1 repo).
