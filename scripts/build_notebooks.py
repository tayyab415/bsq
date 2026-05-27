#!/usr/bin/env python3
"""Generate BSQ formulation notebooks (run from final-repo root)."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NB = ROOT / "metrics-calculation" / "notebooks"


def nb(cells: list[dict]) -> dict:
    return {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
            "language_info": {"name": "python", "version": "3.11.0"},
        },
        "cells": cells,
    }


def md(source: str) -> dict:
    return {"cell_type": "markdown", "metadata": {}, "source": source.splitlines(keepends=True)}


def code(source: str) -> dict:
    return {
        "cell_type": "code",
        "metadata": {},
        "source": source.splitlines(keepends=True),
        "outputs": [],
        "execution_count": None,
    }


def write(name: str, cells: list[dict]) -> None:
    path = NB / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(nb(cells), indent=1), encoding="utf-8")
    print("wrote", path)


def main() -> None:
    write(
        "00_methodology_and_formulation.ipynb",
        [
            md(
                "# BSQ methodology & formulation\n\n"
                "**Body-Strike Quality (BSQ)** scores every shot from Bundesliga **3D skeleton** (50 Hz, 21 parts) "
                "fused with **KPI events**.\n\n"
                "This notebook is the **research layer**: phases P1–P6, modules, and citations. "
                "Computation is in `01_pipeline_computation.ipynb`; league and player visuals in `02` and `03`.\n\n"
                "Judges can read this repo **without AWS SSO** — reference outputs are bundled under "
                "`metrics-calculation/reference_outputs/` (derived scores only, no raw parquet)."
            ),
            md(
                "## 1. Six phases (relative to contact frame)\n\n"
                "| Phase | Frames (50 Hz) | Focus |\n"
                "|-------|----------------|--------|\n"
                "| P1 | −125 … −51 | Context: distance, angle, pressure, defenders, keeper |\n"
                "| P2 | −50 … −14 | Approach & reception: speed, prep, timing |\n"
                "| P3 | −13 … −2 | **Backswing / coil**: hip–shoulder separation, knee load, foot speed |\n"
                "| P4 | −2 … +2 | **Impact**: contact ankle, plant foot, foot into ball |\n"
                "| P5 | +2 … +25 | **Follow-through**: balance, COM continuation |\n"
                "| P6 | +25 … +75 | **Outcome**: goal alignment, exit speed, launch |\n\n"
                "Defined in `shooting1/metric.py` as `PHASE_OFFSETS`."
            ),
            md(
                "## 2. Module scores (what coaches see)\n\n"
                "| Module | Built from | Example features |\n"
                "|--------|------------|------------------|\n"
                "| Decision quality | P1 + pass options | pressure, lane, xG audit |\n"
                "| Shot geometry | P1 | distance, angle |\n"
                "| Arrival / receiving | P2 | reception pressure |\n"
                "| Approach / prep | P2 | approach speed, prep touches |\n"
                "| **Technique mechanics** | P2–P5 | shoulder–hip, knee, contact, follow-through |\n"
                "| **Strike quality** | P4 mech + strike | foot speed, plant, sequencing |\n"
                "| **Placement** | P6 | goal alignment, KPI outcome |\n"
                "| **Strike output** | P4 + P6 | exit speed, launch, trajectory |\n"
                "| **Finishing execution index** | Post-strike cohort percentiles | strike quality, goal-plane lateral, exit speed, ball-to-foot ratio |\n\n"
                "Full mapping: `MODULE_FEATURE_DECLARATIONS` in `metric.py`."
            ),
            md(
                "## 3. P3 backswing (coil) formulation\n\n"
                "Hip–shoulder separation (X-factor) is computed in the **horizontal pitch plane** from skeleton "
                "pelvis and shoulder bearings (`_axis_separation` in `metric.py`). Peak separation in the P3 window "
                "feeds `shoulder_hip_score` alongside COM, knee stability, knee peak velocity, arm abduction, "
                "and striking-foot speed peak.\n\n"
                "Family-specific weights (`P3_V3_COMPONENT_WEIGHTS`) up-weight COM for cutbacks, foot peak for volleys."
            ),
            md(
                "## 4. Research citations\n\n"
                "See `docs/REFERENCES.md` and `docs/FORMULATION.md` in the repository.\n\n"
                "- Shooting posture norms (Huang et al., 2021)\n"
                "- Kicking kinematics / sequencing (JSSM, bioengineering kicking literature in `shooting-docs/`)\n"
                "- Pass orientation & space-creation feasibility reports for decision context\n\n"
                "Official data: Bundesliga Challenge 2 skeleton parquet + KPI XML (access via hackathon AWS, not stored in git)."
            ),
        ],
    )

    write(
        "01_pipeline_computation.ipynb",
        [
            md(
                "# How we compute BSQ in Python\n\n"
                "This notebook shows the **implementation path**:\n"
                "1. Load KPI + metadata from `HACKATHON_DATA_ROOT` (outside repo)\n"
                "2. Read parquet skeleton windows from **S3** (optional — skip for smoke)\n"
                "3. Engineer features → module scores → phase scores\n\n"
                "**Default for judges:** use committed `reference_outputs/` (already run on all five matches). "
                "Re-run cells in section 4 only if you have hackathon AWS credentials."
            ),
            code(
                "from pathlib import Path\n"
                "import json\n"
                "import pandas as pd\n\n"
                "REPO = Path('../..').resolve()  # final-repo root\n"
                "REF = REPO / 'metrics-calculation' / 'reference_outputs'\n"
                "scores = pd.read_csv(REF / 'scores_v1.csv')\n"
                "shots = pd.read_csv(REF / 'shots.csv')\n"
                "meta = [c for c in ['event_id','player_name','family','shot_result','xg'] if c in shots.columns]\n"
                "df = scores.merge(shots[meta], on='event_id', how='left')\n"
                "print(f'Reference rollout: {len(df)} shots, {df[\"match_folder\"].nunique()} matches')\n"
                "print((REF / 'validation_report.md').read_text())"
            ),
            md("## Feature declaration sample (from code)"),
            code(
                "from shooting1.metric import MODULE_FEATURE_DECLARATIONS, PHASE_OFFSETS, MODULE_SCORE_COLUMNS\n"
                "import pandas as pd\n"
                "pd.DataFrame(MODULE_FEATURE_DECLARATIONS).head(12)"
            ),
            code("pd.DataFrame([{'phase': k, 'start': v[0], 'end': v[1], 'label': v[2]} for k,v in PHASE_OFFSETS.items()])"),
            md(
                "## Optional: re-run full pipeline (requires AWS + local XML)\n\n"
                "Uncomment and set `HACKATHON_DATA_ROOT` to your machine path."
            ),
            code(
                "# import os, subprocess\n"
                "# os.environ['HACKATHON_DATA_ROOT'] = '/path/outside/repo/data-small'\n"
                "# os.environ['AWS_PROFILE'] = 'hackathon'\n"
                "# !{REPO}/scripts/reproduce.sh\n"
                "# scores_live = pd.read_csv(REPO / 'metrics-calculation/outputs/all_matches/scores_v1.csv')"
            ),
            md("## Module column inventory"),
            code("list(MODULE_SCORE_COLUMNS)"),
        ],
    )

    write(
        "02_five_match_league_dashboard.ipynb",
        [
            md(
                "# Five-match BSQ results\n\n"
                "Aggregated **127 shots** across Bayern matches in the hackathon sample. "
                "Tables below load from `reference_outputs/` (full v3 S3 run)."
            ),
            code(
                "from pathlib import Path\n"
                "import pandas as pd\n"
                "from aws_football.bsq_reports import merge_shot_tables, league_match_summary, MODULE_COLUMNS, PHASE_COLUMNS, INDEX_COLUMNS\n\n"
                "REPO = Path('../..').resolve()\n"
                "df = merge_shot_tables()\n"
                "summary = league_match_summary(df)\n"
                "summary"
            ),
            code(
                "module_cols = [c for c in MODULE_COLUMNS.values() if c in df.columns]\n"
                "index_cols = [c for c in INDEX_COLUMNS.values() if c in df.columns]\n"
                "df[[*module_cols, *index_cols]].describe().round(1)"
            ),
            code(
                "from aws_football.bsq_reports import plotly_league_modules_bar, display_plotly_figure, use_bsq_notebook_plotly\n"
                "use_bsq_notebook_plotly()\n"
                "melt = summary.melt(id_vars=['match_folder','shots'], value_vars=module_cols, var_name='module', value_name='score')\n"
                "display_plotly_figure(plotly_league_modules_bar(melt))\n"
            ),
            code(
                "from aws_football.bsq_reports import plotly_phase_profile, display_plotly_figure\n"
                "phase_cols = list(PHASE_COLUMNS.values())\n"
                "pm = summary.melt(id_vars='match_folder', value_vars=phase_cols, var_name='phase', value_name='score')\n"
                "display_plotly_figure(plotly_phase_profile(pm))\n"
            ),
        ],
    )

    write(
        "03_player_profile_harry_kane.ipynb",
        [
            md(
                "# Player profile — Harry Kane\n\n"
                "Example **player-centric** view across all shots in the five-match sample. "
                "Speedometer gauges (Plotly) summarize mean module and phase scores."
            ),
            code(
                "from pathlib import Path\n"
                "import pandas as pd\n"
                "from aws_football.bsq_reports import merge_shot_tables, player_summary, display_plotly_player_dashboard, display_plotly_speedometer, display_plotly_phase_speedometer, display_player_speedometers, FINISHING_EXECUTION_INDEX_COL\n\n"
                "PLAYER = 'Harry Kane'\n"
                "df = merge_shot_tables()\n"
                "kane = df[df.player_name == PLAYER].copy()\n"
                "kane[['match_folder','family','shot_result','finishing_execution_index','technique_mechanics_score','placement_score','strike_quality_score','P3_score','P4_score','P5_score']]"
            ),
            code(
                "means = player_summary(df, PLAYER)\n"
                "show = [FINISHING_EXECUTION_INDEX_COL,'technique_mechanics_score','placement_score','strike_quality_score','approach_prep_score','arrival_receiving_score','P3_score','P4_score','P5_score']\n"
                "pd.DataFrame({'metric': show, 'mean_score': [round(means[c],1) for c in show]})"
            ),
            code("display_plotly_player_dashboard(means, PLAYER)"),
            code(
                "display_plotly_speedometer('Technique mechanics', means['technique_mechanics_score'])"
            ),
            code(
                "display_plotly_speedometer('Shot placement', means['placement_score'])"
            ),
            code(
                "display_plotly_speedometer('Strike quality', means['strike_quality_score'])"
            ),
            code(
                "display_plotly_speedometer('Finishing execution index', means['finishing_execution_index'])"
            ),
            md("### Highest mean scores (≥ 60)\n\nSpeedometers for modules/phases with shot-averages at least 60."),
            code("highlights = display_player_speedometers(means, min_score=60)\nhighlights"),
            md(
                "### Interpretation (sample)\n\n"
                "Across **6 shots** in this dataset, Kane averages ~**61** technique mechanics, ~**49** placement, "
                "~**70** strike quality (see executed table above). **Finishing execution index** averages post-strike "
                "execution percentiles (strike quality, goal-plane lateral, exit speed, ball-to-foot ratio) — use it "
                "to explain xG overperformance, not decision or chance quality."
            ),
        ],
    )

    write(
        "04_player_profile_michael_olise.ipynb",
        [
            md(
                "# Player profile — Michael Olise\n\n"
                "**Player-centric** BSQ view with **Finishing execution index** (post-strike execution percentiles)."
            ),
            code(
                "from pathlib import Path\n"
                "from IPython.display import HTML, display\n"
                "import pandas as pd\n"
                "from aws_football.bsq_reports import (\n"
                "    merge_shot_tables,\n"
                "    player_summary,\n"
                "    display_plotly_player_dashboard,\n"
                "    display_plotly_speedometer,\n"
                "    display_plotly_phase_speedometer,\n"
                "    display_player_speedometers,\n"
                "    notebook_plot_style_html,\n"
                "    BACKSWING_PHASE_LABEL,\n"
                "    FOLLOW_THROUGH_PHASE_LABEL,\n"
                "    FINISHING_EXECUTION_INDEX_COL,\n"
                ")\n\n"
                "display(HTML(notebook_plot_style_html()))\n"
                "PLAYER = 'Michael Olise'\n"
                "df = merge_shot_tables()\n"
                "olise = df[df.player_name == PLAYER].copy()\n"
                "olise[['match_folder','family','shot_result', FINISHING_EXECUTION_INDEX_COL,'technique_mechanics_score','placement_score','strike_quality_score','P3_score','P4_score','P5_score']]"
            ),
            code(
                "means = player_summary(df, PLAYER)\n"
                "show = [FINISHING_EXECUTION_INDEX_COL,'technique_mechanics_score','placement_score','strike_quality_score','P3_score','P4_score','P5_score']\n"
                "pd.DataFrame({'metric': show, 'mean_score': [round(means[c],1) for c in show]})"
            ),
            code("display_plotly_player_dashboard(means, PLAYER)"),
            code("display_plotly_speedometer('Finishing execution index', means['finishing_execution_index'])"),
            md("### Highest mean scores (≥ 60)\n\nEvery BSQ metric with shot-average at least 60."),
            code("highlights = display_player_speedometers(means, min_score=60)\nhighlights"),
            code(
                "display_plotly_phase_speedometer(means, BACKSWING_PHASE_LABEL)\n"
                "display_plotly_phase_speedometer(means, FOLLOW_THROUGH_PHASE_LABEL)"
            ),
        ],
    )

    write(
        "06_player_profile_serhou_guirassy.ipynb",
        [
            md(
                "# Player profile — Serhou Guirassy\n\n"
                "**Player-centric** BSQ view for Borussia Dortmund (Dortmund vs Stuttgart). "
                "Only **2 shots** in the five-match sample — interpret means with that small-n caveat. "
                "**Finishing execution index** ranks highly in the cohort (see leaderboard notebook)."
            ),
            code(
                "from datetime import datetime, timezone\n"
                "import plotly.io as pio\n"
                "from aws_football.bsq_reports import use_bsq_notebook_plotly\n\n"
                "renderer = use_bsq_notebook_plotly()\n"
                "print('=' * 60)\n"
                "print('PLAYER PROFILE NOTEBOOK')\n"
                "print('Executed:', datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC'))\n"
                "print('Plotly renderer:', renderer)\n"
                "print('If charts below are empty: Kernel -> BSQ Hackathon (.venv), then Reload from Disk')\n"
                "print('=' * 60)\n"
            ),
            code(
                "from IPython.display import HTML, display\n"
                "import pandas as pd\n"
                "from aws_football.bsq_reports import (\n"
                "    merge_shot_tables,\n"
                "    player_summary,\n"
                "    display_plotly_player_dashboard,\n"
                "    display_plotly_speedometer,\n"
                "    display_plotly_phase_speedometer,\n"
                "    display_player_speedometers,\n"
                "    notebook_plot_style_html,\n"
                "    BACKSWING_PHASE_LABEL,\n"
                "    FOLLOW_THROUGH_PHASE_LABEL,\n"
                "    FINISHING_EXECUTION_INDEX_COL,\n"
                ")\n\n"
                "display(HTML(notebook_plot_style_html()))\n"
                "PLAYER = 'Serhou Guirassy'\n"
                "df = merge_shot_tables()\n"
                "guirassy = df[df.player_name == PLAYER].copy()\n"
                "guirassy[['match_folder','family','shot_result', FINISHING_EXECUTION_INDEX_COL,'technique_mechanics_score','placement_score','strike_quality_score','P3_score','P4_score','P5_score']]"
            ),
            code(
                "means = player_summary(df, PLAYER)\n"
                "show = [FINISHING_EXECUTION_INDEX_COL,'technique_mechanics_score','placement_score','strike_quality_score','P3_score','P4_score','P5_score']\n"
                "pd.DataFrame({'metric': show, 'mean_score': [round(means[c],1) for c in show]})"
            ),
            code("display_plotly_player_dashboard(means, PLAYER, n_shots=len(guirassy))"),
            code("display_plotly_speedometer('Finishing execution index', means['finishing_execution_index'])"),
            code("highlights = display_player_speedometers(means, min_score=55, top_n=10)\nhighlights"),
            code(
                "display_plotly_phase_speedometer(means, BACKSWING_PHASE_LABEL)\n"
                "display_plotly_phase_speedometer(means, FOLLOW_THROUGH_PHASE_LABEL)"
            ),
            md(
                "### Interpretation (sample)\n\n"
                "Across **2 shots** (header wide, open-play saved), Guirassy's **finishing execution index** "
                "averages in the upper cohort (~**79**). Technique mechanics reflect the header only; placement "
                "splits header vs open-play geometry. Use with the shot table above — not as a full-season rating."
            ),
        ],
    )


if __name__ == "__main__":
    main()
