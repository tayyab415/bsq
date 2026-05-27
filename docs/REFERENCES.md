# Research & citations used in BSQ formulation

Bundesliga 3D skeleton feed (21 landmarks, 50 Hz) is documented in the hackathon `Documentation_SkeletonData` materials.

## Biomechanics & shooting posture

| Source | Use in BSQ |
|--------|------------|
| Huang et al., *Scientific Programming* (2021) — shooting posture norm via deep learning | Phase windows P3–P4; trunk/limb posture scoring rationale |
| JSSM kicking kinematics reviews (`shooting-docs/jssm-06-154-2.pdf`) | Support-leg stability, proximal-to-distal sequencing |
| Bioengineering open-access kicking papers (`shooting-docs/bioengineering-09-00333.pdf`) | Contact timing, foot speed into ball |
| Workspace note `shooting-docs/Investigating Ball-Striking Shooting.html` | Strike quality decomposition |

## Analytics & decision context

| Source | Use in BSQ |
|--------|------------|
| Feasibility: pass orientation (`papers/reports/pass_orientation_feasibility.md`) | Orientation / lane language for P1 |
| Feasibility: space creation (`papers/reports/space_creation_feasibility.md`) | Off-ball context framing |
| KPI / xG fields in official XML | P1 decision module; xG as audit only (not in Q) |

## Implementation papers in workspace (`papers/`)

- VAEP / action valuation feasibility — future work, not shipped in v1 BSQ  
- Counterpressing / pressing modules — separate from shooting BSQ  

## How to cite in notebooks

```text
@article{huang2021shootingposture,
  title={Football Players' Shooting Posture Norm Based on Deep Learning},
  journal={Scientific Programming},
  year={2021}
}
```

Add full BibTeX from your reference manager before publication; paths above point to files in the dev workspace `shooting-docs/` and `papers/` folders (not committed as raw data).
