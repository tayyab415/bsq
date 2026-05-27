/**
 * AGY-derived contact choreography for PhaseMechanicsGroundedA4.
 * Snappier phase pacing + P4 freeze/orbit + sequential 2D SVG overlays.
 */
import {Easing, interpolate} from "remotion";
import * as THREE from "three";
import {motion as motionTokens} from "./style/tokens";
import {easeOutOvershoot} from "./primitives/types";
import type {CameraState} from "./projection";

/** Cross-fade camera at phase boundaries (frames @ 30 fps). */
export const PHASE_BLEND_FRAMES = 15;

export type CoachPhaseId = "context" | "approach" | "backswing" | "contact" | "follow" | "output";

/** Per-phase frame budgets @ 30 fps (expanded explainer; see groundedExpandedTimeline). */
import {
  COACH_PHASE_FRAME_COUNTS,
  GROUNDED_EXPANDED_TOTAL_FRAMES,
  PRE_ROLL_FRAMES,
  POST_ROLL_FRAMES,
  contactPhaseBeats,
  expandedPhaseForFrame,
  p4AnnotationWindows,
} from "./groundedExpandedTimeline";

export {COACH_PHASE_FRAME_COUNTS};

export {
  GROUNDED_EXPANDED_TOTAL_FRAMES as GROUNDED_A4_TOTAL_FRAMES,
  expandedPhaseForFrame,
  expandedPhaseForFrame as groundedExpandedPhaseForFrame,
  contactPhaseBeats,
  p4AnnotationWindows,
  PRE_ROLL_FRAMES,
  POST_ROLL_FRAMES,
};
export type {ExpandedPhaseState, SegmentId, ContactPhaseBeats, P4AnnotationWindows} from "./groundedExpandedTimeline";

export const COACH_PHASE_IDS: CoachPhaseId[] = [
  "context",
  "approach",
  "backswing",
  "contact",
  "follow",
  "output",
];

export type CoachPhaseState = {
  id: CoachPhaseId;
  localFrame: number;
  index: number;
  absoluteFrame: number;
  phaseFrames: number;
};

/** Map absolute frame → P1–P6 coach phase (skips PRE/POST bookends). */
export function coachPhaseForFrame(frame: number): CoachPhaseState {
  const expanded = expandedPhaseForFrame(frame);
  if (expanded.coachPhase) {
    const coachIndex = COACH_PHASE_IDS.indexOf(expanded.coachPhase);
    return {
      id: expanded.coachPhase,
      localFrame: expanded.localFrame,
      index: coachIndex,
      absoluteFrame: expanded.absoluteFrame,
      phaseFrames: expanded.phaseFrames,
    };
  }
  if (expanded.id === "pre") {
    return {
      id: "context",
      localFrame: 0,
      index: 0,
      absoluteFrame: expanded.absoluteFrame,
      phaseFrames: COACH_PHASE_FRAME_COUNTS.context,
    };
  }
  return {
    id: "output",
    localFrame: COACH_PHASE_FRAME_COUNTS.output - 1,
    index: COACH_PHASE_IDS.length - 1,
    absoluteFrame: expanded.absoluteFrame,
    phaseFrames: COACH_PHASE_FRAME_COUNTS.output,
  };
}

/** Normalized 0..1 progress within the current phase (cubic ease-out). */
export function coachPhaseProgress(localFrame: number, phaseFrames: number): number {
  return interpolate(localFrame, [0, Math.max(1, phaseFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
}

/** Linear data scrub progress (no ease) for source frame interpolation. */
export function coachPhaseDataProgress(localFrame: number, phaseFrames: number): number {
  return interpolate(localFrame, [0, Math.max(1, phaseFrames - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/* ---- P4 contact sub-beats (scaled to contact phase length) ---- */

const P4_BEATS = () => contactPhaseBeats(COACH_PHASE_FRAME_COUNTS.contact);
const P4_WINS = () => p4AnnotationWindows(P4_BEATS());

export const P4_RUNUP_FRAMES = P4_BEATS().runupFrames;
export const P4_IMPACT_FRAME = P4_BEATS().impactFrame;
export const P4_FREEZE_FRAMES = P4_BEATS().freezeFrames;
export const P4_FREEZE_END = P4_BEATS().freezeEndFrame;
export const P4_FOLLOW_END = P4_BEATS().phaseEndFrame;

export function isContactFreeze(localFrame: number): boolean {
  const b = P4_BEATS();
  return localFrame >= b.impactFrame && localFrame < b.freezeEndFrame;
}

export function contactFreezeOrbitT(localFrame: number): number {
  if (!isContactFreeze(localFrame)) return 0;
  const b = P4_BEATS();
  const t = (localFrame - b.impactFrame) / b.freezeFrames;
  return Easing.inOut(Easing.quad)(Math.min(1, Math.max(0, t)));
}

/** Sequential annotation windows inside P4 freeze (localFrame). */
export function getP4Ann() {
  return P4_WINS();
}

/** @deprecated use getP4Ann() — kept for call sites that read static keys */
export const P4_ANN = new Proxy({} as ReturnType<typeof p4AnnotationWindows>, {
  get(_t, prop: string) {
    const ann = P4_WINS();
    return ann[prop as keyof typeof ann];
  },
});

export function annotationProgress(
  localFrame: number,
  drawIn: number,
  holdEnd: number,
): {progress: number; opacity: number} {
  const drawOn = motionTokens.drawOnFrames;
  const fadeOut = motionTokens.fadeOutFrames + 6;
  if (localFrame < drawIn) return {progress: 0, opacity: 0};
  const rawT = Math.min(1, Math.max(0, (localFrame - drawIn) / drawOn));
  const drawT = easeOutOvershoot(rawT);
  let opacity = 1;
  if (localFrame > holdEnd) {
    opacity = Math.max(0, 1 - (localFrame - holdEnd) / fadeOut);
  }
  return {progress: drawT, opacity};
}

export function lerpCameraState(a: CameraState, b: CameraState, t: number): CameraState {
  const u = Math.max(0, Math.min(1, t));
  return {
    position: a.position.clone().lerp(b.position, u),
    target: a.target.clone().lerp(b.target, u),
    fov: a.fov + (b.fov - a.fov) * u,
  };
}

/** Blend from previous phase end camera during the first PHASE_BLEND_FRAMES. */
export function blendFromPreviousPhaseCamera(
  phaseIndex: number,
  localFrame: number,
  previous: CameraState,
  current: CameraState,
): CameraState {
  if (phaseIndex <= 0 || localFrame >= PHASE_BLEND_FRAMES) return current;
  const t = interpolate(localFrame, [0, PHASE_BLEND_FRAMES], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  return lerpCameraState(previous, current, t);
}

/**
 * P4 camera: run-up → freeze orbit (~95°) → slow pull-back.
 */
export function groundedContactCamera(
  localFrame: number,
  contactTarget: THREE.Vector3,
  liveTarget: THREE.Vector3,
): CameraState {
  const ANGLE_RUNUP_END = -0.58;
  const ANGLE_ORBIT_END = 1.02;
  const ANGLE_FOLLOW_END = 1.32;

  if (localFrame < P4_IMPACT_FRAME) {
    const t = localFrame / Math.max(1, P4_IMPACT_FRAME);
    const eased = Easing.out(Easing.cubic)(t);
    const target = liveTarget.clone().lerp(contactTarget, eased * 0.85);
    const angle = interpolate(eased, [0, 1], [-0.92, ANGLE_RUNUP_END]);
    const radius = interpolate(eased, [0, 1], [5.8, 3.6]);
    const height = interpolate(eased, [0, 1], [2.35, 1.45]);
    const fov = interpolate(eased, [0, 1], [34, 27]);
    return polarCam(target, angle, radius, height, fov);
  }

  if (localFrame < P4_FREEZE_END) {
    const orbitT = contactFreezeOrbitT(localFrame);
    const target = contactTarget.clone();
    const angle = interpolate(orbitT, [0, 1], [ANGLE_RUNUP_END, ANGLE_ORBIT_END]);
    const radius = interpolate(orbitT, [0, 1], [3.6, 2.85]);
    const height = interpolate(orbitT, [0, 1], [1.45, 1.12]);
    const fov = interpolate(orbitT, [0, 1], [27, 24]);
    return polarCam(target, angle, radius, height, fov);
  }

  const t = (localFrame - P4_FREEZE_END) / Math.max(1, P4_FOLLOW_END - P4_FREEZE_END);
  const eased = Easing.inOut(Easing.cubic)(t);
  const target = contactTarget.clone().lerp(liveTarget, 0.2);
  const angle = interpolate(eased, [0, 1], [ANGLE_ORBIT_END, ANGLE_FOLLOW_END]);
  const radius = interpolate(eased, [0, 1], [2.85, 4.2]);
  const height = interpolate(eased, [0, 1], [1.12, 1.75]);
  const fov = interpolate(eased, [0, 1], [24, 29]);
  return polarCam(target, angle, radius, height, fov);
}

function polarCam(
  target: THREE.Vector3,
  angle: number,
  radius: number,
  height: number,
  fov: number,
): CameraState {
  return {
    position: new THREE.Vector3(
      target.x + Math.cos(angle) * radius,
      target.y + height,
      target.z + Math.sin(angle) * radius,
    ),
    target: target.clone(),
    fov,
  };
}

export function impactFlashOpacity(localFrame: number): number {
  if (localFrame < P4_IMPACT_FRAME || localFrame > P4_IMPACT_FRAME + 8) return 0;
  return interpolate(
    localFrame,
    [P4_IMPACT_FRAME, P4_IMPACT_FRAME + 1, P4_IMPACT_FRAME + 8],
    [0, 0.85, 0],
    {extrapolateLeft: "clamp", extrapolateRight: "clamp"},
  );
}
