#!/usr/bin/env python3
"""Execute player profile notebooks 03–04 and export HTML previews."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
NB_DIR = REPO / "metrics-calculation" / "notebooks"
OUT_HTML = REPO / "derived" / "notebook_html"

NOTEBOOKS = [
    "03_player_profile_harry_kane.ipynb",
    "04_player_profile_michael_olise.ipynb",
    "06_player_profile_serhou_guirassy.ipynb",
]

STAMP_CELL = """\
# Run stamp — you should see this text below after selecting kernel BSQ Hackathon (.venv)
from datetime import datetime, timezone
import plotly.io as pio
from aws_football.bsq_reports import use_bsq_notebook_plotly

renderer = use_bsq_notebook_plotly()
print("=" * 60)
print("PLAYER PROFILE NOTEBOOK")
print("Executed:", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
print("Plotly renderer:", renderer)
print("If charts below are empty: Kernel -> BSQ Hackathon (.venv), then Reload from Disk")
print("=" * 60)
"""


def ensure_stamp_cell(path: Path) -> None:
    nb = json.loads(path.read_text(encoding="utf-8"))
    first_code = next((c for c in nb["cells"] if c["cell_type"] == "code"), None)
    if first_code and "PLAYER PROFILE NOTEBOOK" in "".join(first_code.get("source", [])):
        return
    stamp = {
        "cell_type": "code",
        "metadata": {},
        "source": [line + "\n" for line in STAMP_CELL.splitlines()],
        "outputs": [],
        "execution_count": None,
    }
    # Insert after markdown title cell
    insert_at = 1 if nb["cells"] and nb["cells"][0]["cell_type"] == "markdown" else 0
    nb["cells"].insert(insert_at, stamp)
    path.write_text(json.dumps(nb, indent=1), encoding="utf-8")


def clear_outputs(path: Path) -> None:
    nb = json.loads(path.read_text(encoding="utf-8"))
    for cell in nb["cells"]:
        if cell["cell_type"] == "code":
            cell["outputs"] = []
            cell["execution_count"] = None
    path.write_text(json.dumps(nb, indent=1), encoding="utf-8")


def main() -> int:
    OUT_HTML.mkdir(parents=True, exist_ok=True)
    for name in NOTEBOOKS:
        path = NB_DIR / name
        print(f"prepare {name}...")
        ensure_stamp_cell(path)
        clear_outputs(path)
        print(f"execute {name}...")
        subprocess.run(
            [
                sys.executable,
                "-m",
                "jupyter",
                "execute",
                "--inplace",
                "--ExecutePreprocessor.kernel_name=bsq-hackathon",
                "--ExecutePreprocessor.timeout=600",
                str(path),
            ],
            cwd=NB_DIR,
            check=True,
        )
        html_out = OUT_HTML / name.replace(".ipynb", ".html")
        print(f"export {html_out.name}...")
        subprocess.run(
            [
                sys.executable,
                "-m",
                "jupyter",
                "nbconvert",
                "--to",
                "html",
                str(path),
                "--output",
                html_out.name,
                "--output-dir",
                str(OUT_HTML),
            ],
            check=True,
        )
    print("done ->", OUT_HTML)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
