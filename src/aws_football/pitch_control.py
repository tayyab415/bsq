from __future__ import annotations

import math
from dataclasses import dataclass

from aws_football.dribble_pose import Vec3


@dataclass(frozen=True)
class PitchPlayer:
    person_id: str
    team_id: str
    position: Vec3
    velocity_x: float = 0.0
    velocity_y: float = 0.0
    speed_m_s: float = 0.0


def logistic_pitch_control(
    point: tuple[float, float],
    attacking: list[PitchPlayer],
    defending: list[PitchPlayer],
    ball_xy: tuple[float, float],
    *,
    sigma_base: float = 0.72,
) -> float:
    """Beta Spearman-style pitch control: logistic(sum att influence - sum def influence)."""
    attack = sum(_player_influence(player, point, ball_xy, sigma_base=sigma_base) for player in attacking)
    defense = sum(_player_influence(player, point, ball_xy, sigma_base=sigma_base) for player in defending)
    return 1.0 / (1.0 + math.exp(-(attack - defense)))


def pass_option_value(
    *,
    receiver_xy: tuple[float, float],
    shooter_xy: tuple[float, float],
    attacking: list[PitchPlayer],
    defending: list[PitchPlayer],
    ball_xy: tuple[float, float],
    target_goal_x: float,
    lane_score: float,
    pass_distance_m: float,
) -> tuple[float, float]:
    """Return (option_value, pitch_control_at_receiver)."""
    receiver_point = receiver_xy
    hypothetical_ball = receiver_xy
    pc = logistic_pitch_control(receiver_point, attacking, defending, hypothetical_ball)
    goal_threat = _field_shot_option_value(
        Vec3(receiver_xy[0], receiver_xy[1], 0.0),
        [Vec3(op.position.x, op.position.y, 0.0) for op in defending],
        target_goal_x,
    )
    distance_score = _soft_pass_distance_score(pass_distance_m)
    option_value = 0.40 * pc + 0.35 * goal_threat + 0.15 * lane_score + 0.10 * distance_score
    return option_value, pc


def shot_control_value(
    *,
    shooter_xy: tuple[float, float],
    attacking: list[PitchPlayer],
    defending: list[PitchPlayer],
    ball_xy: tuple[float, float],
) -> float:
    return logistic_pitch_control(shooter_xy, attacking, defending, ball_xy)


def _player_influence(
    player: PitchPlayer,
    point: tuple[float, float],
    ball_xy: tuple[float, float],
    *,
    sigma_base: float,
) -> float:
    px, py = player.position.x, player.position.y
    bx, by = ball_xy
    dist_ball = math.hypot(px - bx, py - by)
    radius = max(4.0, min(10.0, 4.0 + 0.35 * dist_ball))
    speed = player.speed_m_s if player.speed_m_s > 0 else math.hypot(player.velocity_x, player.velocity_y)
    speed_ratio = min(speed / 13.0, 1.0)
    direction = _unit_vector(player.velocity_x, player.velocity_y, fallback=(point[0] - px, point[1] - py))
    mu_x = px + 0.5 * direction[0] * speed_ratio
    mu_y = py + 0.5 * direction[1] * speed_ratio
    dx = point[0] - mu_x
    dy = point[1] - mu_y
    along = abs(direction[0]) + abs(direction[1])
    sigma_x = sigma_base * radius * (1.35 if along > 0 else 1.0)
    sigma_y = sigma_base * radius * 0.75
    if abs(direction[0]) > 1e-6 or abs(direction[1]) > 1e-6:
        cos_t, sin_t = direction[0], direction[1]
        local_x = cos_t * dx + sin_t * dy
        local_y = -sin_t * dx + cos_t * dy
    else:
        local_x, local_y = dx, dy
    exponent = -0.5 * ((local_x / max(sigma_x, 1e-6)) ** 2 + (local_y / max(sigma_y, 1e-6)) ** 2)
    peak = math.exp(exponent)
    center = math.exp(-0.5 * ((px - mu_x) ** 2 + (py - mu_y) ** 2) / max((sigma_base * radius) ** 2, 1e-6))
    return peak / max(center, 1e-6)


def _field_shot_option_value(pos: Vec3, opponents: list[Vec3], target_goal_x: float) -> float:
    distance = abs(target_goal_x - pos.x)
    angle = math.degrees(2.0 * math.atan2(3.66, max(distance, 1.0)))
    centrality = max(0.0, 1.0 - abs(pos.y) / 34.0)
    return max(
        0.0,
        min(
            1.0,
            0.42 * _linear_low(distance, 6.0, 32.0)
            + 0.28 * _linear_high(angle, 8.0, 42.0)
            + 0.20 * _nearest_pressure_score(pos, opponents)
            + 0.10 * centrality,
        ),
    )


def _nearest_pressure_score(pos: Vec3, opponents: list[Vec3]) -> float:
    if not opponents:
        return 0.5
    nearest = min(math.hypot(pos.x - opponent.x, pos.y - opponent.y) for opponent in opponents)
    return _linear_high(nearest, 1.0, 5.0)


def _soft_pass_distance_score(distance: float) -> float:
    if distance < 3.0 or distance > 25.0:
        return 0.0
    if 6.0 <= distance <= 16.0:
        return 1.0
    if distance < 6.0:
        return _linear_high(distance, 3.0, 6.0)
    return _linear_low(distance, 16.0, 25.0)


def _linear_low(value: float, best: float, worst: float) -> float:
    if worst == best:
        return 0.0
    return max(0.0, min(1.0, 1.0 - (value - best) / (worst - best)))


def _linear_high(value: float, worst: float, best: float) -> float:
    if best == worst:
        return 0.0
    return max(0.0, min(1.0, (value - worst) / (best - worst)))


def _unit_vector(vx: float, vy: float, *, fallback: tuple[float, float]) -> tuple[float, float]:
    norm = math.hypot(vx, vy)
    if norm > 1e-6:
        return (vx / norm, vy / norm)
    fx, fy = fallback
    fnorm = math.hypot(fx, fy)
    if fnorm <= 1e-6:
        return (1.0, 0.0)
    return (fx / fnorm, fy / fnorm)
