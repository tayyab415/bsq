# BSQ notebooks (primary reproducibility path)

| Notebook | Audience | Needs AWS? |
|----------|----------|------------|
| `00_methodology_and_formulation.ipynb` | Formulation, P1–P6, modules, citations | No |
| `01_pipeline_computation.ipynb` | How Python computes features (`metric.py`) | No (optional re-run cell) |
| `02_five_match_league_dashboard.ipynb` | Five-match tables + Plotly bars | No |
| `03_player_profile_harry_kane.ipynb` | Player speedometers (Harry Kane) | No |
| `04_player_profile_michael_olise.ipynb` | Player speedometers (Michael Olise) | No |
| `06_player_profile_serhou_guirassy.ipynb` | Player speedometers (Serhou Guirassy) | No |
| `07_bayern_3d_shot_map_bayern_hamburg.ipynb` | 3D shot map (PNG + interactive HTML in `outputs/shot_map_bayern_hamburg.html`) | No (needs `derived/.../tracking_samples.csv`) |
| `08_harry_kane_3d_shot_map.ipynb` | Harry Kane — all 6 shots across 3 matches (by match + combined + by goal) | No (needs `derived/shooting1_v3_all_matches/tracking_samples.csv`) |

## Run locally

```bash
pip install -e ".[metrics,notebooks]"
cd metrics-calculation/notebooks
jupyter lab
```

## Re-execute all (embed outputs for git)

```bash
python ../../scripts/build_notebooks.py
cd metrics-calculation/notebooks
jupyter nbconvert --to notebook --execute --inplace *.ipynb
```

## Regenerate reference tables

```bash
export HACKATHON_DATA_ROOT=/path/outside/repo
./scripts/reproduce.sh
cp metrics-calculation/outputs/all_matches/{scores_v1,shots,features}.csv \
   metrics-calculation/reference_outputs/
```
