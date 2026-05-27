#!/usr/bin/env python3
"""Execute BSQ notebooks and save outputs for VS Code / Cursor."""

from __future__ import annotations

import sys
from pathlib import Path

import nbformat
from nbconvert.preprocessors import ExecutePreprocessor
from nbformat.validator import normalize

REPO = Path(__file__).resolve().parents[1]
NB_DIR = REPO / "metrics-calculation" / "notebooks"

NOTEBOOKS = [
    "01_pipeline_computation.ipynb",
    "02_five_match_league_dashboard.ipynb",
    "03_player_profile_harry_kane.ipynb",
    "04_player_profile_michael_olise.ipynb",
    "06_player_profile_serhou_guirassy.ipynb",
    "05_metric_leaderboards.ipynb",
]


def execute_notebook(path: Path, *, timeout: int = 600) -> None:
    nb = nbformat.read(path, as_version=4)
    normalize(nb)
    if not any(c.cell_type == "code" for c in nb.cells):
        nbformat.write(nb, path)
        print(f"  skip (no code): {path.name}")
        return
    ep = ExecutePreprocessor(timeout=timeout, kernel_name="python3")
    # Notebook cells use Path('../..') relative to the notebooks folder.
    ep.preprocess(nb, {"metadata": {"path": str(NB_DIR)}})
    normalize(nb)
    nbformat.write(nb, path)
    code = [c for c in nb.cells if c.cell_type == "code"]
    with_out = sum(1 for c in code if c.outputs)
    print(f"  ok {path.name}: {with_out}/{len(code)} cells with outputs")


def main() -> int:
    if str(REPO) not in sys.path:
        sys.path.insert(0, str(REPO))
    for name in NOTEBOOKS:
        path = NB_DIR / name
        if not path.is_file():
            print(f"  missing: {name}")
            continue
        print(f"executing {name}...")
        execute_notebook(path, timeout=900 if name.startswith("05") else 600)
    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
