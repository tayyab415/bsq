"""Bundesliga slide / contact-sheet tokens — see repo `aesthetics.md`."""

from __future__ import annotations

# Canonical palette (contact-sheet-13 / aesthetics.md)
BSQ_COLORS: dict[str, str | list[str]] = {
    "paper": "#FFFFFF",
    "plot": "#FFFFFF",
    "ink": "#111111",
    "ink_title": "#171717",
    "ink_muted": "#666666",
    "accent": "#C4050E",
    "accent_bright": "#C4050E",
    "accent_dark": "#900000",
    "border": "#D9D9D9",
    "grid": "#D9D9D9",
    "wash": "#F2F2F2",
    "bar_neutral": "#111111",
    "bar_track": "#F2F2F2",
    "bar_secondary": "#D9D9D9",
    "bar_highlight": "#C4050E",
    "bar_warning": "#E6B800",
    "na_fill": "#E8E8E8",
    "gauge_track": "#F2F2F2",
    "gauge_bar": "#C4050E",
    # Neutral-first sequences — red is reserved for highlights only.
    "line_sequence": ["#111111", "#666666", "#999999", "#C4050E", "#900000"],
    "bar_sequence": ["#111111", "#666666", "#999999", "#C4050E"],
}

BSQ_FONT = "Google Sans Flex, Google Sans, system-ui, sans-serif"

# Profile bars rendered in Bundesliga red (key takeaway metrics).
PROFILE_HIGHLIGHT_METRICS: frozenset[str] = frozenset({"Finishing execution index"})
