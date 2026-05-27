/**
 * P1 context — range rings (far shots) or pressure wedge (tight lane).
 */
import React, {useMemo} from "react";
import {interpolate} from "remotion";
import {FilterDefs, PressureWedgeCorridor, RangeRing} from "./primitives";
import {projectScreen, type CameraState} from "./projection";
import type {GroundedShotPlan} from "./groundedShotAnnotationPlan";
import * as THREE from "three";

type Vec3 = {x: number; y: number; z: number};
type Clip = {
  features: Record<string, string | number | null>;
};
type ShotFrame = {ball?: {position?: Vec3} | null};

const toThree = (p: Vec3) => new THREE.Vector3(p.x, p.z, -p.y);

const shotDir = (clip: Clip) => {
  const x = Number(clip.features.shot_direction_x ?? 1);
  const y = Number(clip.features.shot_direction_y ?? 0);
  const v = new THREE.Vector3(x, 0, -y);
  return v.length() > 0.001 ? v.normalize() : new THREE.Vector3(1, 0, 0);
};

export const GroundedContextSvgOverlay: React.FC<{
  clip: Clip;
  shotFrame: ShotFrame;
  localFrame: number;
  camera: CameraState;
  width: number;
  height: number;
  plan: GroundedShotPlan;
}> = ({clip, shotFrame, localFrame, camera, width, height, plan}) => {
  const draw = interpolate(localFrame, [10, 42], [0, 1], {extrapolateLeft: "clamp", extrapolateRight: "clamp"});

  const screen = useMemo(() => {
    const ball = shotFrame.ball?.position ? toThree(shotFrame.ball.position) : null;
    if (!ball) return null;
    const g = new THREE.Vector3(ball.x, 0.04, ball.z);
    const ballS = projectScreen(g, camera, width, height);
    if (!ballS.visible) return null;

    const dir = shotDir(clip);
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const goalDist = 22;
    const mouth = 3.7;
    const gc = g.clone().add(dir.clone().multiplyScalar(goalDist));
    const gl = gc.clone().add(side.clone().multiplyScalar(mouth));
    const gr = gc.clone().add(side.clone().multiplyScalar(-mouth));
    const goalMid = projectScreen(gc, camera, width, height);
    const goalLeft = projectScreen(gl, camera, width, height);
    const goalRight = projectScreen(gr, camera, width, height);
    if (!goalMid.visible) return null;

    return {ball: ballS, goalMid, goalLeft, goalRight};
  }, [clip, shotFrame, camera, width, height]);

  if (!screen || draw < 0.02) return null;

  const distM = Number(clip.features.distance_to_goal_m ?? 18);
  const press = Number(clip.features.pressure_in_lane ?? clip.features.D_pressure ?? 0.85);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{position: "absolute", inset: 0, pointerEvents: "none", zIndex: 4}}
    >
      <FilterDefs />
      {plan.p1ShowDistanceArcs ? (
        <RangeRing
          progress={draw}
          center={screen.goalMid}
          radii={[52, 88, 124]}
          labels={["6", "12", "18"]}
          startAngleDeg={-155}
          sweepAngleDeg={130}
          perspectiveY={0.28}
          polarity="neutral"
          scale="hero"
        />
      ) : (
        <PressureWedgeCorridor
          progress={draw}
          vertex={screen.ball}
          goalLeft={screen.goalLeft}
          goalRight={screen.goalRight}
          label={press > 0.8 ? "blocked lane" : "shooting lane"}
          polarity="negative"
          uid="p1-wedge"
        />
      )}
      {plan.p1ShowDistanceArcs ? (
        <text
          x={screen.ball.x + 12}
          y={screen.ball.y - 18}
          fill="#1ee7ff"
          fontSize={13}
          fontWeight={600}
          fontFamily="ui-monospace, monospace"
          opacity={draw}
        >
          {Number.isFinite(distM) ? `${distM.toFixed(0)} m to goal` : "long range"}
        </text>
      ) : null}
    </svg>
  );
};
