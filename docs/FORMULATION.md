# BSQ formulation — Body-Strike Quality for shooting

## Product story (three layers)

1. **Formulation & research** — what we measure, why, and citations (`notebooks/00_*`, this doc).
2. **Computation** — how 3D skeleton + KPI events become scores (`notebooks/01_*`, `shooting1/metric.py`).
3. **Evidence** — five-match results + player dashboards (`notebooks/02_*`, `03_*`, Plotly speedometers).

Judges can read executed notebooks **without AWS SSO**; optional cells re-run the pipeline when credentials are available.

## Macro structure: modules and phases

### Five constraint modules (additive / bottleneck / gate)

| Code | Module | Question |
|------|--------|----------|
| **D** | Decision quality | Was the shot choice reasonable vs best teammate pass option (pitch-control proxy + xG margin)? |
| **T** | Technique (legacy composite) | Posture + contact quality from skeleton |
| **B** | Ball strike / biomechanics | Shoulder–hip separation, trunk, knee stability |
| **C** | Contact / plant | Ankle–ball proximity, plant foot, foot path into ball |
| **V** | Value / physics exit | Exit speed, launch angle, launch alignment |

Family-specific weights combine **D, T, B, C, V** into `additive_score`, `bottleneck_score`, and `gate_score` (see `FAMILY_WEIGHTS` in `metric.py`).

### Six temporal phases (50 Hz skeleton windows)

| Phase | Window (frames rel. contact) | Biomechanical focus |
|-------|-------------------------------|---------------------|
| **P1** | −125 … −51 | Context: distance, angle, pressure, lane, keeper |
| **P2** | −50 … −14 | Approach: speed, prep touches, reception pressure |
| **P3** | −13 … −2 | Backswing / coil: COM, shoulder–hip, knee, arm, foot speed peak |
| **P4** | −2 … +2 | Impact: contact ankle, plant, foot into ball, sequencing |
| **P5** | +2 … +25 | Follow-through: COM continuation, balance |
| **P6** | +25 … +75 | Outcome: goal alignment, exit speed, launch, flatness |

Phase scores roll into **module scores**:

- **Shot geometry** ← P1  
- **Receiving pressure** ← P1–P2  
- **Arrival / receiving** ← P2  
- **Approach / prep** ← P2  
- **Technique mechanics** ← P2–P5 (family weights on P2,P3,P4,P5)  
- **Strike quality** ← P4 mechanics + strike split  
- **Placement** ← P6 alignment + KPI outcome  
- **Strike output** ← P4 jump + P6 physics  

### P3 backswing components (v3)

| Component | Feature | Meaning |
|-----------|---------|---------|
| COM | `com_over_plant_foot_score` | Center of mass over plant |
| Shoulder | `shoulder_hip_score` | Hip–shoulder separation (X-factor) |
| Knee | `knee_stability_score` | Support-leg stability |
| Knee peak | `knee_peak_angular_velocity_score` | Loading angular velocity |
| Arm | `non_kicking_arm_abduction_score` | Non-kicking arm counter-balance |
| Foot peak | `foot_peak_velocity_score` | Striking foot speed before contact |

### P4 impact / strike split

- **P4_mech** — contact geometry, plant, sequencing  
- **P4_strike** — foot speed into ball, path stability (headers gate strike)  
- Combined into **P4_score** then **strike_quality_score**

### Finishing execution index (post-strike sub-metric)

Explains **xG overperformance** using only near-strike execution signals (not decision quality or chance quality):

```text
finishing_execution_index = mean percentile rank across cohort of:
  strike_quality_score
  goal_plane_lateral_score
  ball_exit_speed_m_s
  ball_to_foot_speed_ratio_score
```

Percentiles are computed on the active shot table (e.g. 127-shot reference cohort). Implemented in `aws_football.bsq_reports.add_finishing_execution_index` and applied in `shooting1/build.py` before `scores_v1.csv` is written.

### P5 follow-through

- `com_continuation_score`, `follow_through_path_score` (v3: shot-aligned lateral path), `post_impact_balance_score`

### Confidence

`Q` and per-module `*_q` down-weight low tracking quality (sync, contact anchor, candidate rank).

## Decision quality pass routing (beta pitch control)

`decision_quality_score` compares **shot xG** to the best **teammate pass option** at the shot frame.

1. **Default (`skeleton_pitch_control`)** — all outfield players from the same 50 Hz skeleton window; Spearman-style logistic pitch control at the receiver location (velocity from finite differences), plus lane openness and distance bands. Implemented in `src/aws_football/pitch_control.py` and `metrics-calculation/shooting1/pass_options.py`.
2. **Optional (`--use-positional-xml`)** — same model on DFL **25 Hz** `Positions_*.xml` (S3 stream; slower).
3. **Fallback** — if team tracking is incomplete, no decision fields are emitted for that shot.

Audit columns: `shot_pitch_control`, `best_pass_pitch_control`, `pass_value_margin`, `decision_context_source`.

## Data fusion

- **KPI XML** — event labels, xG, pressure, synced frames  
- **Parquet skeleton (50 Hz)** — 21 body parts + ball; S3 row-group reads  
- **Positions XML (25 Hz, optional)** — full-team pitch coordinates for pass routing  
- **Frame map** — `skeleton_frame = PhaseStart + 2 × (SyncedFrameId − phase_base)`

## Implementation map

| Artifact | Location |
|----------|----------|
| Feature engineering | `metrics-calculation/shooting1/metric.py` |
| Batch builder | `metrics-calculation/shooting1/build.py` |
| S3 windows | `metrics-calculation/shooting1/extract.py` |
| Narrative + plots | `metrics-calculation/notebooks/` |
| Reference tables (derived) | `metrics-calculation/reference_outputs/` |

See [`REFERENCES.md`](REFERENCES.md) for papers and biomechanics sources.
