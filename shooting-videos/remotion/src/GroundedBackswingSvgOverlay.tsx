/**
 * P3 backswing — flat SVG telestration (hip/shoulder axes + X-factor arc + plant ruler).
 * Replaces blobby 3D AnimatedCylinder / BodyAngleGauge on the skeleton.
 */
import React, {useMemo} from "react";
import {interpolate} from "remotion";
import {AngleArc, AxisLine, DistanceRule, FilterDefs, LeaderLine} from "./primitives";
import {projectScreen, type CameraState} from "./projection";
import {chipEntrance} from "./primitives/types";
import type {P3VisualMode} from "./groundedShotAnnotationPlan";
import * as THREE from "three";

type Vec3 = {x: number; y: number; z: number};
type Player = {name?: string; parts: Record<string, Vec3>};
type ShotFrame = {ball?: {position?: Vec3} | null; players?: Player[]};
type Clip = {
  shot: {player?: string};
  features: Record<string, string | number | null>;
};

const toThree = (p: Vec3) => new THREE.Vector3(p.x, p.z, -p.y);

const screenAngleDeg = (a: {x: number; y: number}, b: {x: number; y: number}) =>
  (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

const shortestSweep = (fromDeg: number, toDeg: number) => {
  let d = toDeg - fromDeg;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
};

export const GroundedBackswingSvgOverlay: React.FC<{
  clip: Clip;
  shotFrame: ShotFrame;
  localFrame: number;
  camera: CameraState;
  width: number;
  height: number;
  p3Mode: P3VisualMode;
}> = ({clip, shotFrame, localFrame, camera, width, height, p3Mode}) => {
  const plantFirst = p3Mode === "plant_base";
  const draw = interpolate(localFrame, [8, 28], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});
  const arcDraw = interpolate(
    localFrame,
    plantFirst ? [32, 52] : [22, 48],
    [0, 1],
    {extrapolateLeft: "clamp", extrapolateRight: "clamp"},
  );
  const plantDraw = interpolate(
    localFrame,
    plantFirst ? [14, 38] : [36, 62],
    [0, 1],
    {extrapolateLeft: "clamp", extrapolateRight: "clamp"},
  );
  const showArc = p3Mode !== "plant_base" || arcDraw > 0.2;
  const ent = chipEntrance(arcDraw);

  const screen = useMemo(() => {
    const shooter = (shotFrame.players || []).find((p) => p.name === clip.shot.player);
    if (!shooter) return null;
    const inferredFoot = String(clip.features.inferred_foot || "right");
    const plantKey = `${inferredFoot === "right" ? "left" : "right"}_toe`;
    const ball = shotFrame.ball?.position ? toThree(shotFrame.ball.position) : null;
    const plant = shooter.parts[plantKey] ? toThree(shooter.parts[plantKey]) : null;
    const lh = shooter.parts.left_hip ? toThree(shooter.parts.left_hip) : null;
    const rh = shooter.parts.right_hip ? toThree(shooter.parts.right_hip) : null;
    const ls = shooter.parts.left_shoulder ? toThree(shooter.parts.left_shoulder) : null;
    const rs = shooter.parts.right_shoulder ? toThree(shooter.parts.right_shoulder) : null;
    const pelvis = shooter.parts.pelvis ? toThree(shooter.parts.pelvis) : null;
    if (!lh || !rh || !ls || !rs || !pelvis) return null;

    const proj = (v: THREE.Vector3) => projectScreen(v, camera, width, height);
    const g = (v: THREE.Vector3) => new THREE.Vector3(v.x, 0.03, v.z);

    const leftHip = proj(lh);
    const rightHip = proj(rh);
    const leftShoulder = proj(ls);
    const rightShoulder = proj(rs);
    const vertex = proj(pelvis.clone().add(new THREE.Vector3(0, 0.55, 0)));
    const plantG = plant ? proj(g(plant)) : null;
    const ballG = ball ? proj(g(ball)) : null;

    if (!leftHip.visible || !rightHip.visible || !leftShoulder.visible || !rightShoulder.visible || !vertex.visible) {
      return null;
    }

    const hipAng = screenAngleDeg(leftHip, rightHip);
    const shoulderAng = screenAngleDeg(leftShoulder, rightShoulder);
    const sweep = shortestSweep(hipAng, shoulderAng);

    return {
      leftHip,
      rightHip,
      leftShoulder,
      rightShoulder,
      vertex,
      hipAng,
      sweep,
      plantG: plantG?.visible ? plantG : null,
      ballG: ballG?.visible ? ballG : null,
    };
  }, [clip.shot.player, shotFrame, camera, width, height]);

  if (!screen || draw < 0.02) return null;

  const peakSep = Number(clip.features.peak_shoulder_hip_separation_deg ?? 0);
  const plantDist = Number(clip.features.plant_foot_lateral_offset_m ?? clip.features.min_foot_ball_distance_m ?? 0);

  const chipX = screen.vertex.x + 72;
  const chipY = screen.vertex.y - 48;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{position: "absolute", inset: 0, pointerEvents: "none", zIndex: 4}}
    >
      <FilterDefs />
      <g opacity={draw}>
        <AxisLine
          progress={draw}
          start={screen.leftHip}
          end={screen.rightHip}
          label="hip axis"
          dashed
          polarity="neutral"
          scale="subtle"
          labelOffset={42}
          labelSide={-1}
        />
        <AxisLine
          progress={draw}
          start={screen.leftShoulder}
          end={screen.rightShoulder}
          label="shoulder axis"
          polarity="positive"
          scale="standard"
          labelOffset={38}
          labelSide={1}
        />
      </g>
      {showArc && arcDraw > 0.05 ? (
        <g opacity={plantFirst ? arcDraw * 0.55 : arcDraw}>
          <AngleArc
            progress={arcDraw}
            vertex={screen.vertex}
            startAngleDeg={screen.hipAng}
            sweepAngleDeg={screen.sweep}
            radius={plantFirst ? 62 : 78}
            value={peakSep.toFixed(1)}
            unit="°"
            label={p3Mode === "coil_weak_load" ? "peak coil" : "X-factor (peak)"}
            polarity={p3Mode === "coil_weak_load" ? "negative" : "positive"}
            scale={plantFirst ? "standard" : "hero"}
            filled
          />
          {ent.opacity > 0.1 && p3Mode !== "plant_base" ? (
            <g opacity={ent.opacity} transform={`translate(${chipX}, ${chipY}) scale(${ent.scale})`}>
              <rect
                x={p3Mode === "coil_weak_load" ? -72 : -58}
                y={-14}
                width={p3Mode === "coil_weak_load" ? 144 : 116}
                height={28}
                rx={5}
                fill="rgba(10,16,28,0.92)"
                stroke={p3Mode === "coil_weak_load" ? "rgba(255,138,138,0.55)" : "rgba(30,231,255,0.45)"}
              />
              <text
                x={0}
                y={5}
                textAnchor="middle"
                fontSize={13}
                fontWeight={600}
                fill={p3Mode === "coil_weak_load" ? "#ff8a8a" : "#1ee7ff"}
                fontFamily="ui-monospace, monospace"
              >
                {p3Mode === "coil_weak_load" ? `${peakSep.toFixed(1)}° · weak load` : `${peakSep.toFixed(1)}° coil`}
              </text>
            </g>
          ) : null}
          <LeaderLine
            progress={arcDraw}
            from={{x: chipX, y: chipY + 12}}
            to={{x: screen.vertex.x + 24, y: screen.vertex.y - 8}}
            polarity="positive"
          />
        </g>
      ) : null}
      {plantDraw > 0.05 && screen.plantG && screen.ballG ? (
        <g opacity={plantDraw}>
          <DistanceRule
            progress={plantDraw}
            start={screen.plantG}
            end={screen.ballG}
            value={Math.abs(plantDist).toFixed(2)}
            unit="m"
            label={plantFirst ? "plant base (hero)" : "plant base"}
            polarity={plantFirst ? "positive" : "neutral"}
            scale={plantFirst ? "hero" : "standard"}
            labelOffset={-20}
          />
        </g>
      ) : null}
    </svg>
  );
};
