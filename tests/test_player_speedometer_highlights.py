import unittest

from aws_football.bsq_reports import (
    PROFILE_BAR_HIGH_SCORE,
    PROFILE_BAR_LOW_SCORE,
    _profile_bar_color,
    merge_shot_tables,
    player_speedometer_highlights,
    player_summary,
)
from aws_football.bsq_theme import BSQ_COLORS


class PlayerSpeedometerHighlightsTests(unittest.TestCase):
    def test_min_score_60_includes_all_bsq_columns_for_olise(self):
        df = merge_shot_tables()
        means = player_summary(df, "Michael Olise")
        highlights = player_speedometer_highlights(means, min_score=60)
        labels = {label for label, _ in highlights}
        self.assertIn("Placement", labels)
        self.assertIn("P4 mechanics", labels)
        self.assertGreaterEqual(len(highlights), 12)

    def test_no_top_n_cap_by_default(self):
        df = merge_shot_tables()
        means = player_summary(df, "Harry Kane")
        capped = player_speedometer_highlights(means, min_score=60, top_n=5)
        all_high = player_speedometer_highlights(means, min_score=60)
        self.assertGreater(len(all_high), len(capped))

    def test_profile_bar_color_thresholds(self):
        self.assertEqual(_profile_bar_color(score=70, available=True), BSQ_COLORS["bar_highlight"])
        self.assertEqual(_profile_bar_color(score=30, available=True), BSQ_COLORS["bar_warning"])
        self.assertEqual(_profile_bar_color(score=50, available=True), BSQ_COLORS["bar_neutral"])
        self.assertEqual(_profile_bar_color(score=PROFILE_BAR_HIGH_SCORE, available=True), BSQ_COLORS["bar_highlight"])
        self.assertEqual(
            _profile_bar_color(score=PROFILE_BAR_LOW_SCORE - 0.1, available=True),
            BSQ_COLORS["bar_warning"],
        )


if __name__ == "__main__":
    unittest.main()
