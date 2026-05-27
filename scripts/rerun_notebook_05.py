#!/usr/bin/env python3
"""Clear notebook 05 outputs and re-execute from scratch."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
NOTEBOOK = REPO / "metrics-calculation" / "notebooks" / "05_metric_leaderboards.ipynb"


def clear_outputs(nb: dict) -> None:
    for cell in nb["cells"]:
        if cell["cell_type"] != "code":
            cell.pop("outputs", None)
            cell.pop("execution_count", None)
            continue
        cell["outputs"] = []
        cell["execution_count"] = None
        if "metadata" in cell and "execution" in cell["metadata"]:
            cell["metadata"].pop("execution", None)


def main() -> int:
    nb = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    clear_outputs(nb)
    NOTEBOOK.write_text(json.dumps(nb, indent=1), encoding="utf-8")
    print(f"Cleared outputs in {NOTEBOOK.name}")

    cmd = [
        sys.executable,
        "-m",
        "jupyter",
        "execute",
        "--inplace",
        str(NOTEBOOK),
    ]
    print("Running:", " ".join(cmd))
    subprocess.run(cmd, cwd=REPO, check=True)

    nb = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    executed = sum(1 for c in nb["cells"] if c.get("execution_count"))
    print(f"Done {datetime.now(timezone.utc).isoformat()} — {executed} code cells executed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
