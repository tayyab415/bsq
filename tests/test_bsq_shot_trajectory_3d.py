import unittest

import matplotlib
import pandas as pd
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

matplotlib.use("Agg")

from aws_football.bsq_shot_trajectory_3d import (
    GOAL_X_LEFT,
    GOAL_X_RIGHT,
    filter_trajectories_by_goal,
    load_shot_trajectories,
    plot_3d_shot_map,
    resolve_tracking_samples_path,
)


class ShotTrajectory3DTests(unittest.TestCase):
    def test_load_shot_trajectories_preserves_raw_post_contact_ball_coordinates(self):
        tracking_path = resolve_tracking_samples_path()
        trajectories = load_shot_trajectories(
            match_folder="Bayern_Hamburg",
            team_name="Bayern",
            tracking_path=tracking_path,
        )

        by_event = {trajectory.event_id: trajectory for trajectory in trajectories}
        trajectory = by_event[18902400000023]

        tracking = pd.read_csv(tracking_path)
        features = pd.read_csv(
            "metrics-calculation/reference_outputs/features.csv",
            usecols=["event_id", "contact_frame"],
        )
        contact_frame = int(features.set_index("event_id").loc[trajectory.event_id, "contact_frame"])
        raw = (
            tracking[
                (tracking["event_id"] == trajectory.event_id)
                & (tracking["frame_number"] >= contact_frame)
            ]
            .sort_values("frame_number")
            .iloc[0]
        )

        self.assertEqual(trajectory.x[0], raw["ball_x"])
        self.assertEqual(trajectory.y[0], raw["ball_y"])
        self.assertEqual(trajectory.z[0], raw["ball_z"])

    def test_dominant_goal_filter_keeps_left_goal_without_mirroring(self):
        trajectories = load_shot_trajectories(
            match_folder="Bayern_Hamburg",
            team_name="Bayern",
            tracking_path=resolve_tracking_samples_path(),
        )

        shown, goal_x = filter_trajectories_by_goal(trajectories, goal="dominant")

        self.assertEqual(goal_x, GOAL_X_LEFT)
        self.assertEqual(len(shown), 13)
        self.assertEqual(sum(trajectory.goal_x == GOAL_X_RIGHT for trajectory in trajectories), 8)
        self.assertTrue(all(trajectory.goal_x == GOAL_X_LEFT for trajectory in shown))

    def test_plot_3d_shot_map_defaults_to_cinematic_left_goal_camera(self):
        trajectories = load_shot_trajectories(
            match_folder="Bayern_Hamburg",
            team_name="Bayern",
            tracking_path=resolve_tracking_samples_path(),
        )

        fig = plot_3d_shot_map(trajectories, goal_filter="dominant")
        ax = fig.axes[0]
        pitch_surfaces = [
            collection for collection in ax.collections if isinstance(collection, Poly3DCollection)
        ]

        self.assertEqual(ax.elev, 24)
        self.assertEqual(ax.azim, -10)
        self.assertEqual(len([line for line in ax.lines if line.get_color() == "#C4050E"]), 13)
        self.assertTrue(pitch_surfaces)
        self.assertLessEqual(pitch_surfaces[0].get_alpha(), 0.72)


if __name__ == "__main__":
    unittest.main()
