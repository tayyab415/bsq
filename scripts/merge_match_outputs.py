#!/usr/bin/env python3
"""Merge per-match shooting1 outputs into one reference folder."""
from __future__ import annotations

import argparse
import csv
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inputs", nargs="+", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    tables = ["players.csv", "shots.csv", "features.csv", "scores_v1.csv", "contact_candidates.csv", "router_audit.csv"]
    for table in tables:
        rows: list[dict[str, str]] = []
        for input_dir in args.inputs:
            path = input_dir / table
            if not path.exists():
                continue
            with path.open(newline="") as handle:
                rows.extend(csv.DictReader(handle))
        if not rows:
            continue
        fieldnames: list[str] = []
        seen: set[str] = set()
        for row in rows:
            for key in row:
                if key not in seen:
                    seen.add(key)
                    fieldnames.append(key)
        with (args.output_dir / table).open("w", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)
        print(f"Wrote {table}: {len(rows)} rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
