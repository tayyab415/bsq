/**
 * Expanded Grounded A4 timeline (~102 s @ 30 fps): PRE shot card → P1–P6 → POST verdict.
 */
import type {CoachPhaseId} from "./groundedContactChoreography";

export const GROUNDED_FPS = 30;
export const PRE_ROLL_FRAMES = 180;
export const POST_ROLL_FRAMES = 180;

export const EXPANDED_PHASE_FRAME_COUNTS: Record<CoachPhaseId, number> = {
  context: 420,
  approach: 360,
  backswing: 540,
  contact: 600,
  follow: 360,
  output: 420,
};

/** Alias used across grounded A4 code. */
export const COACH_PHASE_FRAME_COUNTS = EXPANDED_PHASE_FRAME_COUNTS;

export type BookendSegmentId = "pre" | "post";
export type SegmentId = BookendSegmentId | CoachPhaseId;

export const SEGMENT_ORDER: SegmentId[] = [
  "pre",
  "context",
  "approach",
  "backswing",
  "contact",
  "follow",
  "output",
  "post",
];

export type ExpandedPhaseState = {
  id: SegmentId;
  localFrame: number;
  index: number;
  absoluteFrame: number;
  phaseFrames: number;
  /** Coach phase when id is P1–P6; null on bookends. */
  coachPhase: CoachPhaseId | null;
};

const segmentFrameCount = (id: SegmentId): number => {
  if (id === "pre") return PRE_ROLL_FRAMES;
  if (id === "post") return POST_ROLL_FRAMES;
  return EXPANDED_PHASE_FRAME_COUNTS[id];
};

const SEGMENT_STARTS: number[] = (() => {
  const starts: number[] = [];
  let acc = 0;
  for (const id of SEGMENT_ORDER) {
    starts.push(acc);
    acc += segmentFrameCount(id);
  }
  return starts;
})();

export const GROUNDED_EXPANDED_TOTAL_FRAMES = SEGMENT_STARTS[SEGMENT_STARTS.length - 1] + segmentFrameCount("post");

export const segmentStartFrame = (id: SegmentId): number => SEGMENT_STARTS[SEGMENT_ORDER.indexOf(id)];

export function expandedPhaseForFrame(frame: number): ExpandedPhaseState {
  const absoluteFrame =
    ((frame % GROUNDED_EXPANDED_TOTAL_FRAMES) + GROUNDED_EXPANDED_TOTAL_FRAMES) % GROUNDED_EXPANDED_TOTAL_FRAMES;
  let index = 0;
  for (let i = SEGMENT_ORDER.length - 1; i >= 0; i--) {
    if (absoluteFrame >= SEGMENT_STARTS[i]) {
      index = i;
      break;
    }
  }
  const id = SEGMENT_ORDER[index];
  const coachPhase = id === "pre" || id === "post" ? null : id;
  return {
    id,
    localFrame: absoluteFrame - SEGMENT_STARTS[index],
    index,
    absoluteFrame,
    phaseFrames: segmentFrameCount(id),
    coachPhase,
  };
}

/** P4 run-up / freeze / pullback inside the contact segment. */
export type ContactPhaseBeats = {
  runupFrames: number;
  impactFrame: number;
  freezeFrames: number;
  freezeEndFrame: number;
  phaseEndFrame: number;
};

export function contactPhaseBeats(contactPhaseFrames: number = EXPANDED_PHASE_FRAME_COUNTS.contact): ContactPhaseBeats {
  const runupFrames = Math.max(48, Math.round(contactPhaseFrames * 0.1));
  const freezeFrames = Math.max(120, Math.round(contactPhaseFrames * 0.28));
  const impactFrame = runupFrames;
  const freezeEndFrame = impactFrame + freezeFrames;
  return {
    runupFrames,
    impactFrame,
    freezeFrames,
    freezeEndFrame,
    phaseEndFrame: contactPhaseFrames,
  };
}

export type P4AnnotationWindows = {
  shockDraw: number;
  shockEnd: number;
  gapDraw: number;
  gapEnd: number;
  heightDraw: number;
  heightEnd: number;
  velocityDraw: number;
  velocityEnd: number;
};

export function p4AnnotationWindows(beats: ContactPhaseBeats): P4AnnotationWindows {
  const {impactFrame, freezeEndFrame} = beats;
  const span = freezeEndFrame - impactFrame;
  return {
    shockDraw: impactFrame,
    shockEnd: impactFrame + Math.round(span * 0.1),
    gapDraw: impactFrame + Math.round(span * 0.04),
    gapEnd: impactFrame + Math.round(span * 0.42),
    heightDraw: impactFrame + Math.round(span * 0.14),
    heightEnd: impactFrame + Math.round(span * 0.55),
    velocityDraw: impactFrame + Math.round(span * 0.28),
    velocityEnd: freezeEndFrame - 4,
  };
}
