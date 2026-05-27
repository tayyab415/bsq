/**
 * Primitive registry — maps v3 CSV `primary_annotation` / `secondary_annotation`
 * values to React component identifiers. The phase composer will read CSV rows,
 * look up the primitive name here, and instantiate the matching component with
 * resolved anchor + value props.
 *
 * Q13: this registry IS the skill substrate. Adding a new primitive = adding
 * a row here + a component file; no edits to switch statements anywhere.
 */

import {
  AngleArc,
  AxisLine,
  ContextBadge,
  DefenderGhost,
  DistanceRule,
  GhostSkeleton,
  HeightArrow,
  ImpactShockwave,
  KeeperSpotlightCylinder,
  LaneZone,
  PathTrail,
  PhaseHeader,
  PlayerSpotlight,
  PoseSticker,
  PressureWedgeCorridor,
  PressureZone,
  RangeRing,
  ResultBadge,
  ScoreDial,
  ShotCard,
  TargetLane,
  TrajectoryArc,
  VelocityArrow,
  VerdictSlate,
  ZoneRing,
} from "../primitives";

export type PrimitiveName =
  | "distance_ruler"
  | "angle_arc"
  | "axis_line"
  | "velocity_arrow"
  | "path_trail"
  | "zone_ring"
  | "pressure_zone"
  | "lane_zone"
  | "target_lane"
  | "player_spotlight"
  | "pose_sticker"
  | "ghost_skeleton"
  | "context_badge"
  | "result_badge"
  | "score_dial"
  | "phase_header"
  | "shot_card"
  | "verdict_slate"
  | "range_ring"
  | "height_arrow"
  | "trajectory_arc"
  | "impact_shockwave"
  | "keeper_spotlight"
  | "pressure_wedge"
  | "defender_ghost";

export const primitiveRegistry = {
  distance_ruler: DistanceRule,
  angle_arc: AngleArc,
  axis_line: AxisLine,
  velocity_arrow: VelocityArrow,
  path_trail: PathTrail,
  zone_ring: ZoneRing,
  pressure_zone: PressureZone,
  lane_zone: LaneZone,
  target_lane: TargetLane,
  player_spotlight: PlayerSpotlight,
  pose_sticker: PoseSticker,
  ghost_skeleton: GhostSkeleton,
  context_badge: ContextBadge,
  result_badge: ResultBadge,
  score_dial: ScoreDial,
  phase_header: PhaseHeader,
  shot_card: ShotCard,
  verdict_slate: VerdictSlate,
  range_ring: RangeRing,
  height_arrow: HeightArrow,
  trajectory_arc: TrajectoryArc,
  impact_shockwave: ImpactShockwave,
  keeper_spotlight: KeeperSpotlightCylinder,
  pressure_wedge: PressureWedgeCorridor,
  defender_ghost: DefenderGhost,
} as const;

export type PrimitiveComponent = (typeof primitiveRegistry)[PrimitiveName];
