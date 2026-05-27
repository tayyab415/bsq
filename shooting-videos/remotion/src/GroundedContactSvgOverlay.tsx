/**
 * 2D SVG telestration for P4 contact — projected anchors, sequential AGY staging.
 */
import React, {useMemo} from "react";
import {
  AngleArc,
  DistanceRule,
  FilterDefs,
  GroundAnchorDot,
  HeightArrow,
  ImpactShockwave,
  LeaderLine,
  VelocityArrow,
} from "./primitives";
import {projectScreen, type CameraState} from "./projection";
import {
  annotationProgress,
  isContactFreeze,
  P4_ANN,
  P4_IMPACT_FRAME,
} from "./groundedContactChoreography";
import type {P4FreezeMetric} from "./groundedShotAnnotationPlan";
import * as THREE from "three";

type Vec3 = {x: number; y: number; z: number};
type Player = {name?: string; teamCode?: number; jerseyNumber?: string | number; parts: Record<string, Vec3>};
type ShotFrame = {ball?: {position?: Vec3} | null; players?: Player[]};
type Clip = {
  shot: {player?: string};
  features: Record<string, string | number | null>;
  frames: ShotFrame[];
};

const toThree = (p: Vec3) => new THREE.Vector3(p.x, p.z, -p.y);

const labelOffsetFromMid = (
  start: {x: number; y: number},
  end: {x: number; y: number},
  px: number,
): {x: number; y: number} => {
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const ang = Math.atan2(end.y - start.y, end.x - start.x);
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  return {x: mx + nx * px, y: my + ny * px};
};

export const GroundedContactSvgOverlay: React.FC<{
  clip: Clip;
  contactFrame: ShotFrame;
  localFrame: number;
  camera: CameraState;
  width: number;
  height: number;
  freezeMetrics: P4FreezeMetric[];
}> = ({clip, contactFrame, localFrame, camera, width, height, freezeMetrics}) => {
  const show = (m: P4FreezeMetric) => freezeMetrics.includes(m);
  const inferredFoot = String(clip.features.inferred_foot || "right");
  const plantKey = `${inferredFoot === "right" ? "left" : "right"}_toe`;
  const strikeKey = `${inferredFoot}_toe`;
  const ankleKey = `${inferredFoot}_ankle`;

  const screen = useMemo(() => {
    const shooter = (contactFrame.players || []).find((p) => p.name === clip.shot.player);
    if (!shooter) return null;
    const ball = contactFrame.ball?.position ? toThree(contactFrame.ball.position) : null;
    const plant = shooter.parts[plantKey] ? toThree(shooter.parts[plantKey]) : null;
    const strike = shooter.parts[strikeKey] ? toThree(shooter.parts[strikeKey]) : null;
    const ankle = shooter.parts[ankleKey] ? toThree(shooter.parts[ankleKey]) : null;
    const pelvis = shooter.parts.pelvis ? toThree(shooter.parts.pelvis) : null;
    const neck = shooter.parts.neck ? toThree(shooter.parts.neck) : null;
    const groundUnder = (pt: THREE.Vector3) => new THREE.Vector3(pt.x, 0.02, pt.z);
    const proj = (v: THREE.Vector3 | null) => (v ? projectScreen(v, camera, width, height) : null);

    const ballGroundPt = ball ? groundUnder(ball) : null;
    return {
      ball: proj(ball),
      ballGround: ballGroundPt ? proj(ballGroundPt) : null,
      plant: proj(plant ? groundUnder(plant) : null),
      strike: proj(strike),
      ankle: proj(ankle),
      pelvis: proj(pelvis),
      neck: proj(neck),
    };
  }, [clip.shot.player, contactFrame, camera, width, height, plantKey, strikeKey, ankleKey]);

  if (!isContactFreeze(localFrame) || !screen) return null;

  const gap = annotationProgress(localFrame, P4_ANN.gapDraw, P4_ANN.gapEnd);
  const heightAnn = annotationProgress(localFrame, P4_ANN.heightDraw, P4_ANN.heightEnd);
  const shock = annotationProgress(localFrame, P4_ANN.shockDraw, P4_ANN.shockEnd);
  const vel = annotationProgress(localFrame, P4_ANN.velocityDraw, P4_ANN.velocityEnd);
  const distPlantBall = Number(
    clip.features.plant_to_ball_xy_m ?? clip.features.min_foot_ball_distance_m ?? 0.42,
  );
  const ballHeight = Number(clip.features.ball_z_at_contact ?? 0.18);
  const footSpeed = Number(clip.features.foot_peak_velocity_at_contact ?? clip.features.foot_velocity_into_ball_m_s ?? 18);

  const gapMid =
    screen.plant && screen.ball
      ? labelOffsetFromMid(screen.plant, screen.ball, -32)
      : null;
  const gapAnchor =
    screen.plant && screen.ball
      ? {x: (screen.plant.x + screen.ball.x) / 2, y: (screen.plant.y + screen.ball.y) / 2}
      : null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{position: "absolute", inset: 0, pointerEvents: "none", zIndex: 4}}
    >
      <FilterDefs />
      {show("shockwave") && shock.opacity > 0 && screen.ball ? (
        <g opacity={shock.opacity}>
          <ImpactShockwave
            progress={shock.progress}
            center={screen.ball}
            maxRadius={95}
            polarity="positive"
            scale="hero"
          />
        </g>
      ) : null}
      {show("gap") && gap.opacity > 0 && screen.plant && screen.ball ? (
        <g opacity={gap.opacity}>
          {gapAnchor ? <GroundAnchorDot point={gapAnchor} progress={gap.progress} polarity="positive" /> : null}
          <DistanceRule
            progress={gap.progress}
            start={screen.plant}
            end={screen.ball}
            value={distPlantBall.toFixed(2)}
            unit="m"
            label="plant → ball"
            polarity="positive"
            scale="hero"
            overshoot
            labelOffset={-28}
          />
          {gapMid && gapAnchor ? (
            <LeaderLine progress={gap.progress} from={gapMid} to={gapAnchor} polarity="positive" />
          ) : null}
        </g>
      ) : null}
      {show("height") && heightAnn.opacity > 0 && screen.ball && screen.ballGround ? (
        <g opacity={heightAnn.opacity}>
          <GroundAnchorDot point={screen.ballGround} progress={heightAnn.progress} polarity="neutral" />
          <HeightArrow
            progress={heightAnn.progress}
            top={screen.ball}
            bottom={screen.ballGround}
            value={ballHeight.toFixed(2)}
            unit="m"
            label="ball height"
            chipSide="center"
            polarity="neutral"
            scale="hero"
          />
        </g>
      ) : null}
      {(show("foot_speed") || show("ball_speed_jump")) && vel.opacity > 0 && screen.ankle && screen.strike ? (
        <g opacity={vel.opacity}>
          <VelocityArrow
            progress={vel.progress}
            uid="gnd-vel"
            start={screen.ankle}
            end={screen.strike}
            value={footSpeed.toFixed(1)}
            unit="m/s"
            label={show("ball_speed_jump") ? "foot at contact" : "strike foot"}
            polarity="positive"
            scale="hero"
          />
        </g>
      ) : null}
      {show("gap") && gap.opacity > 0.5 && screen.pelvis && screen.neck ? (
        <g opacity={gap.opacity * 0.9}>
          <AngleArc
            progress={Math.min(1, gap.progress)}
            vertex={screen.pelvis}
            startAngleDeg={-90}
            sweepAngleDeg={12}
            radius={72}
            value="12"
            unit="deg"
            polarity="positive"
            scale="standard"
            filled
          />
        </g>
      ) : null}
    </svg>
  );
};
