/**
 * Projected 3D-style metric billboard (Statsbomb xG float chip pattern).
 */
import React, {useMemo} from "react";
import {chipEntrance} from "./primitives/types";
import {projectScreen, type CameraState} from "./projection";
import {isContactFreeze, P4_IMPACT_FRAME} from "./groundedContactChoreography";
import type {FloatingChipSpec} from "./groundedShotAnnotationPlan";
import * as THREE from "three";

type Vec3 = {x: number; y: number; z: number};
type Player = {name?: string; parts: Record<string, Vec3>};
type ShotFrame = {players?: Player[]};
type Clip = {
  shot: {player?: string};
  features: Record<string, string | number | null>;
  score: Record<string, string | number | null>;
};

const toThree = (p: Vec3) => new THREE.Vector3(p.x, p.z, -p.y);

export const GroundedFloatingMetricOverlay: React.FC<{
  clip: Clip;
  contactFrame: ShotFrame;
  phaseId: string;
  localFrame: number;
  camera: CameraState;
  width: number;
  height: number;
  chip?: FloatingChipSpec;
}> = ({clip, contactFrame, phaseId, localFrame, camera, width, height, chip}) => {
  const screen = useMemo(() => {
    const shooter = (contactFrame.players || []).find((p) => p.name === clip.shot.player);
    if (!shooter?.parts.pelvis) return null;
    const pelvis = toThree(shooter.parts.pelvis);
    const chest = shooter.parts.neck
      ? toThree(shooter.parts.neck)
      : pelvis.clone().add(new THREE.Vector3(0, 0.55, 0));
    const anchor = chest.clone().lerp(pelvis, 0.35).add(new THREE.Vector3(0, 0.35, 0));
    const labelAt = anchor.clone().add(new THREE.Vector3(0.55, 0.85, -0.35));
    const joint = projectScreen(anchor, camera, width, height);
    const label = projectScreen(labelAt, camera, width, height);
    if (!joint.visible || !label.visible) return null;
    return {joint, label};
  }, [clip.shot.player, contactFrame, camera, width, height]);

  if (!screen) return null;

  if (!chip) return null;

  const title = chip.title;
  const value = chip.value;
  const sub = chip.sub ?? "";
  let drawStart = 8;
  let holdEnd = 52;

  if (phaseId === "context") {
    drawStart = 14;
    holdEnd = 54;
  } else if (phaseId === "contact" && isContactFreeze(localFrame)) {
    drawStart = P4_IMPACT_FRAME + 4;
    holdEnd = P4_IMPACT_FRAME + 68;
  } else if (phaseId === "output") {
    drawStart = 10;
    holdEnd = 52;
  } else {
    return null;
  }

  const raw = Math.min(1, Math.max(0, (localFrame - drawStart) / 14));
  const ent = chipEntrance(raw);
  if (ent.opacity < 0.02) return null;

  const fade =
    localFrame > holdEnd ? Math.max(0, 1 - (localFrame - holdEnd) / 12) : 1;
  const opacity = ent.opacity * fade;

  return (
    <div
      style={{
        position: "absolute",
        left: screen.label.x,
        top: screen.label.y,
        transform: `translate(-50%, calc(-50% + ${ent.translateY}px)) scale(${ent.scale})`,
        opacity,
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <svg
        style={{
          position: "absolute",
          left: screen.joint.x - screen.label.x,
          top: screen.joint.y - screen.label.y,
          width: Math.abs(screen.label.x - screen.joint.x) + 40,
          height: Math.abs(screen.label.y - screen.joint.y) + 40,
          overflow: "visible",
        }}
      >
        <line
          x1={screen.joint.x - screen.label.x + 20}
          y1={screen.joint.y - screen.label.y + 20}
          x2={20}
          y2={20}
          stroke="rgba(30, 231, 255, 0.55)"
          strokeWidth={1.25}
          strokeDasharray="4 3"
        />
      </svg>
      <div
        style={{
          background: "rgba(10, 16, 28, 0.92)",
          border: "1px solid rgba(30, 231, 255, 0.45)",
          borderRadius: 6,
          padding: "10px 16px",
          boxShadow: "0 0 28px rgba(30, 231, 255, 0.22)",
          textAlign: "center",
          minWidth: 108,
        }}
      >
        <div style={{fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(232, 240, 248, 0.65)"}}>
          {title}
        </div>
        <div style={{fontSize: 28, fontWeight: 700, fontFamily: "ui-monospace, monospace", color: "#1ee7ff", lineHeight: 1.1}}>
          {value}
        </div>
        {sub ? (
          <div style={{fontSize: 11, color: "rgba(232, 240, 248, 0.5)", marginTop: 2}}>{sub}</div>
        ) : null}
      </div>
    </div>
  );
};
