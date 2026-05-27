"""Combine per-match shooting1 outputs into a single multi-match review deck.

Stratifies the 20-shot review queue across the five shot families and across
outcome buckets (goal / saved or blocked / wide), so the manual football
eye-test can detect failure clusters by archetype rather than getting flooded
with one match's most common case.
"""
from __future__ import annotations

import argparse
import csv
import html
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from shooting1.metric import COMPONENT_SUBSCORES, CONTACT_CANDIDATE_FIELDS


FAMILY_ORDER = ("oneV", "cutback", "long_range", "volley", "dead_ball")
OUTCOME_BUCKETS = {
    "goal": {"successfulShot"},
    "on_target": {"savedShot"},
    "off_target": {"shotWide", "blockedShot", "missedShot"},
}


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    per_match = sorted(args.input_dirs, key=lambda p: p.name)
    scores: list[dict[str, Any]] = []
    shots: list[dict[str, Any]] = []
    candidates: list[dict[str, Any]] = []
    router: list[dict[str, Any]] = []
    reports: list[dict[str, str]] = []
    for match_dir in per_match:
        scores.extend(_read(match_dir / "scores_v1.csv"))
        shots.extend(_read(match_dir / "shots.csv"))
        candidates.extend(_read(match_dir / "contact_candidates.csv"))
        router.extend(_read(match_dir / "router_audit.csv"))
        reports.append({"match_dir": match_dir.name, "report": _read_text(match_dir / "validation_report.md")})

    _write_csv(args.output_dir / "scores_v1.csv", scores)
    _write_csv(args.output_dir / "shots.csv", shots)
    _write_csv(args.output_dir / "contact_candidates.csv", candidates, fields=list(CONTACT_CANDIDATE_FIELDS))
    _write_csv(args.output_dir / "router_audit.csv", router)

    review_rows = _build_stratified_review(shots, scores, candidates, limit=args.deck_size)
    _write_csv(args.output_dir / "review_rows.csv", review_rows)
    _write_review_deck(args.output_dir / "review_deck.html", review_rows, reports)
    _write_combined_report(args.output_dir / "validation_report.md", reports, scores, review_rows)

    print(json.dumps({
        "matches": len(per_match),
        "shots": len(scores),
        "candidates": len(candidates),
        "review_rows": len(review_rows),
        "output_dir": str(args.output_dir),
    }, indent=2))
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Combine per-match shooting1 outputs into a unified review deck.")
    parser.add_argument("--input-dirs", nargs="+", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--deck-size", type=int, default=20)
    return parser.parse_args(argv)


def _read(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open() as f:
        return list(csv.DictReader(f))


def _read_text(path: Path) -> str:
    return path.read_text() if path.exists() else ""


def _write_csv(path: Path, rows: list[dict[str, Any]], *, fields: list[str] | None = None) -> None:
    if not rows:
        path.write_text("")
        return
    if fields is None:
        fields = sorted({key for row in rows for key in row.keys()})
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _build_stratified_review(
    shot_rows: list[dict[str, Any]],
    score_rows: list[dict[str, Any]],
    candidate_rows: list[dict[str, Any]],
    *,
    limit: int,
) -> list[dict[str, Any]]:
    shots_by_key = {(row.get("match_folder"), row.get("event_id")): row for row in shot_rows}
    candidates_by_key: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in candidate_rows:
        candidates_by_key[(row.get("match_folder"), row.get("event_id"))].append(row)

    enriched = []
    for score in score_rows:
        key = (score.get("match_folder"), score.get("event_id"))
        shot = shots_by_key.get(key, {})
        cands = sorted(
            candidates_by_key.get(key, []),
            key=lambda r: int(r.get("candidate_rank") or 999),
        )
        enriched.append({
            "score": score,
            "shot": shot,
            "candidates": cands,
            "family": score.get("family"),
            "outcome": _outcome_bucket(score.get("shot_result")),
        })

    # Stratified pick: at least 2 per family, 4 max per family, balance outcomes
    picked: list[dict[str, Any]] = []
    used = set()

    def _pick(predicate, max_n: int) -> int:
        added = 0
        for item in enriched:
            if added >= max_n:
                break
            key = (item["score"].get("match_folder"), item["score"].get("event_id"))
            if key in used:
                continue
            if predicate(item):
                picked.append(item)
                used.add(key)
                added += 1
        return added

    # Anchor diversity quotas
    for family in FAMILY_ORDER:
        for outcome in ("goal", "on_target", "off_target"):
            _pick(lambda it, f=family, o=outcome: it["family"] == f and it["outcome"] == o, max_n=1)

    # Fill to the requested deck size, preferring shots with extreme EAR or Q signals
    if len(picked) < limit:
        def _interest(item):
            score = item["score"]
            ear = _num(score.get("ear_score"))
            q = _num(score.get("Q"))
            return abs(ear - 50) + (1.0 - q) * 30
        remaining = [
            item for item in enriched
            if (item["score"].get("match_folder"), item["score"].get("event_id")) not in used
        ]
        remaining.sort(key=_interest, reverse=True)
        for item in remaining:
            if len(picked) >= limit:
                break
            picked.append(item)
            used.add((item["score"].get("match_folder"), item["score"].get("event_id")))

    return [_render_row(item) for item in picked[:limit]]


def _render_row(item: dict[str, Any]) -> dict[str, Any]:
    score = item["score"]
    shot = item["shot"]
    candidates = item["candidates"]
    evidence_for = "metric" if candidates else "mapping"
    row = {
        "event_id": score.get("event_id"),
        "match_folder": score.get("match_folder"),
        "player": shot.get("player_name") or shot.get("player_id"),
        "team": shot.get("team_name") or shot.get("team_id"),
        "family": score.get("family"),
        "result": score.get("shot_result"),
        "evidence_for": evidence_for,
        "xG": score.get("xG"),
        "D": score.get("D"),
        "T": score.get("T"),
        "B": score.get("B"),
        "C": score.get("C"),
        "V": score.get("V"),
        "Q": score.get("Q"),
        "additive_score": score.get("additive_score"),
        "bottleneck_score": score.get("bottleneck_score"),
        "gate_score": score.get("gate_score"),
        "ear_score": score.get("ear_score"),
        "weakest_constraint": score.get("weakest_constraint"),
        "top3_contact_candidates": _top_candidates_text(candidates, limit=3),
        "selected_by": (candidates[0].get("selected_by") if candidates else ""),
        "manual_verdict": "",
        "manual_notes": "",
    }
    for col in COMPONENT_SUBSCORES:
        row[col] = score.get(col)
    return row


def _top_candidates_text(candidates: list[dict[str, Any]], *, limit: int) -> str:
    chunks = []
    for row in candidates[:limit]:
        chunks.append(
            " ".join(
                [
                    f"rank={row.get('candidate_rank')}",
                    f"frame={row.get('candidate_frame')}",
                    f"off={row.get('frame_offset')}",
                    f"part={row.get('nearest_part')}",
                    f"foot={row.get('inferred_foot')}",
                    f"dist={_fmt(row.get('foot_ball_distance_m'))}",
                    f"jump={_fmt(row.get('velocity_jump_m_s'))}",
                    f"cost={_fmt(row.get('total_contact_cost'))}",
                ]
            )
        )
    return "; ".join(chunks)


def _outcome_bucket(result: str | None) -> str:
    if result in OUTCOME_BUCKETS["goal"]:
        return "goal"
    if result in OUTCOME_BUCKETS["on_target"]:
        return "on_target"
    return "off_target"


def _write_review_deck(path: Path, rows: list[dict[str, Any]], reports: list[dict[str, str]]) -> None:
    family_counts = defaultdict(int)
    for row in rows:
        family_counts[row.get("family")] += 1

    summary = " &middot; ".join(f"{family}: {family_counts[family]}" for family in FAMILY_ORDER if family_counts[family])
    body = "\n".join(_deck_row(row) for row in rows)
    path.write_text(
        f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\">
  <title>Shooting1 Review Deck (multi-match)</title>
  <style>
    body {{ font-family: -apple-system, Arial, sans-serif; margin: 28px; color: #17202a; background: #f7f8fa; }}
    h1 {{ margin: 0 0 4px; font-size: 24px; }}
    .meta {{ margin: 0 0 18px; color: #566573; font-size: 13px; }}
    table {{ border-collapse: collapse; width: 100%; background: white; font-size: 12.5px; }}
    th, td {{ border: 1px solid #d5d8dc; padding: 6px 8px; vertical-align: top; }}
    th {{ background: #2c3e50; color: #fff; text-align: left; font-weight: 600; }}
    td.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
    .fam {{ display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; color: #fff; }}
    .fam-oneV {{ background: #3498db; }}
    .fam-cutback {{ background: #9b59b6; }}
    .fam-long_range {{ background: #e67e22; }}
    .fam-volley {{ background: #16a085; }}
    .fam-dead_ball {{ background: #7f8c8d; }}
    .sel-decisive_jump {{ background: #f1c40f; color: #000; padding: 1px 4px; border-radius: 3px; font-size: 10px; }}
    .sel-cost {{ background: #ecf0f1; color: #34495e; padding: 1px 4px; border-radius: 3px; font-size: 10px; }}
    .res-successfulShot {{ color: #27ae60; font-weight: 600; }}
    .res-savedShot {{ color: #2980b9; }}
    .res-shotWide, .res-blockedShot {{ color: #c0392b; }}
    .q-low {{ background: #fadbd8; }}
    .candidates {{ font-family: SF Mono, Menlo, monospace; font-size: 11px; color: #34495e; }}
  </style>
</head>
<body>
  <h1>Shooting1 Multi-Match Review Deck</h1>
  <p class=\"meta\">{len(rows)} shots stratified across families &middot; {summary}</p>
  <table>
    <thead>
      <tr>
        <th>Event</th>
        <th>Match</th>
        <th>Player</th>
        <th>Family</th>
        <th>Result</th>
        <th>Q</th>
        <th>EAR</th>
        <th>Add</th>
        <th>Weakest</th>
        <th>Contact (top 3)</th>
        <th>Verdict</th>
      </tr>
    </thead>
    <tbody>
{body}
    </tbody>
  </table>
</body>
</html>
"""
    )


def _deck_row(row: dict[str, Any]) -> str:
    q = _num(row.get("Q"))
    selected_by = row.get("selected_by") or "cost"
    q_class = " class=\"q-low\"" if q < 0.40 else ""
    result_class = f"res-{html.escape(str(row.get('result') or ''))}"
    family_class = f"fam-{html.escape(str(row.get('family') or ''))}"
    return (
        f"      <tr{q_class}>"
        f"<td>{html.escape(str(row.get('event_id') or ''))}<br><span class=\"sel-{html.escape(selected_by)}\">{html.escape(selected_by)}</span></td>"
        f"<td>{html.escape(str(row.get('match_folder') or ''))}</td>"
        f"<td>{html.escape(str(row.get('player') or ''))}<br><small>{html.escape(str(row.get('team') or ''))}</small></td>"
        f"<td><span class=\"fam {family_class}\">{html.escape(str(row.get('family') or ''))}</span></td>"
        f"<td class=\"{result_class}\">{html.escape(str(row.get('result') or ''))}</td>"
        f"<td class=\"num\">{_fmt(q)}</td>"
        f"<td class=\"num\">{_fmt(row.get('ear_score'))}</td>"
        f"<td class=\"num\">{_fmt(row.get('additive_score'))}</td>"
        f"<td>{html.escape(str(row.get('weakest_constraint') or ''))}</td>"
        f"<td class=\"candidates\">{html.escape(str(row.get('top3_contact_candidates') or ''))}</td>"
        f"<td>{html.escape(str(row.get('manual_verdict') or ''))}</td>"
        "</tr>"
    )


def _write_combined_report(path: Path, reports: list[dict[str, str]], scores: list[dict[str, Any]], review_rows: list[dict[str, Any]]) -> None:
    avg_q = sum(_num(r.get("Q")) for r in scores) / len(scores) if scores else 0.0
    zero_q = sum(1 for r in scores if _num(r.get("Q")) == 0.0)
    decisive_jump_picks = sum(1 for r in review_rows if r.get("selected_by") == "decisive_jump")
    family_dist = defaultdict(int)
    for r in scores:
        family_dist[r.get("family")] += 1

    lines = [
        "# Shooting1 multi-match validation report",
        "",
        f"- Total shots scored: {len(scores)}",
        f"- Zero-Q shots (genuine no-information): {zero_q}",
        f"- Average Q: {avg_q:.3f}",
        f"- Review-deck rows: {len(review_rows)}",
        f"- Review rows resolved by decisive-jump override: {decisive_jump_picks}",
        "",
        "## Family distribution across all matches",
    ]
    for family in FAMILY_ORDER:
        lines.append(f"- {family}: {family_dist[family]}")
    lines.append("")
    lines.append("## Per-match validation reports")
    for item in reports:
        lines.append("")
        lines.append(f"### {item['match_dir']}")
        lines.append("")
        lines.append(item["report"].strip())
    path.write_text("\n".join(lines) + "\n")


def _num(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _fmt(value: Any) -> str:
    try:
        return f"{float(value):.2f}"
    except (TypeError, ValueError):
        return ""


if __name__ == "__main__":
    raise SystemExit(main())
