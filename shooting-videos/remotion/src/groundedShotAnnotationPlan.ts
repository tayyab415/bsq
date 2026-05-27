/**
 * Per-shot telestration plan — maps v3 annotation library + BSQ subscores
 * to the hero metrics shown in each phase (not the same stickers every time).
 *
 * Reference: derived/shooting_feature_phase_annotation_scale_v3.csv
 *            shooting-remotion/out/library-swatch.png
 */
import {numberValue} from "./annotationLogic";
import type {CoachPhaseId} from "./groundedContactChoreography";

export type {CoachPhaseId};

export type P3VisualMode = "peak_coil" | "plant_base" | "coil_weak_load";
export type P4FreezeMetric = "shockwave" | "gap" | "height" | "foot_speed" | "transfer_ratio" | "ball_speed_jump";

export type PhaseSticker = {
  label: string;
  value: string;
  color: string;
  x: number;
  y: number;
};

export type FloatingChipSpec = {
  title: string;
  value: string;
  sub?: string;
};

export type PhasePlan = {
  kicker: string;
  title: string;
  text: string;
  stickers: PhaseSticker[];
  floatingChip?: FloatingChipSpec;
};

export type GroundedShotPlan = {
  shotLabel: string;
  role: "standout" | "constraint";
  weakestPhase: CoachPhaseId;
  strongestPhase: CoachPhaseId;
  phases: Record<CoachPhaseId, PhasePlan>;
  p3Mode: P3VisualMode;
  p4FreezeMetrics: P4FreezeMetric[];
  p1ShowDistanceArcs: boolean;
  p2ShowTrunkLean: boolean;
};

type ClipLike = {
  role?: string;
  shot: {player?: string};
  score: Record<string, string | number | null>;
  features: Record<string, string | number | null>;
};

const PHASE_KEYS: CoachPhaseId[] = ["context", "approach", "backswing", "contact", "follow", "output"];

const phaseScore = (clip: ClipLike, phase: CoachPhaseId): number =>
  numberValue(
    clip.score[
      {
        context: "P1_score",
        approach: "P2_score",
        backswing: "P3_score",
        contact: "P4_score",
        follow: "P5_score",
        output: "P6_score",
      }[phase]
    ],
  );

const sub = (clip: ClipLike, key: string): number => numberValue(clip.score[key] ?? clip.features[key]);

const fmtDeg = (v: number) => (Number.isNaN(v) ? "—" : `${v.toFixed(1)}°`);
const fmtM = (v: number) => (Number.isNaN(v) ? "—" : `${Math.abs(v).toFixed(2)} m`);
const fmtVel = (v: number) => (Number.isNaN(v) ? "—" : `${v.toFixed(1)} m/s`);
const fmtPct = (v: number) => (Number.isNaN(v) ? "—" : `${Math.round(v * 100)}%`);
const fmtRatio = (v: number) => (Number.isNaN(v) ? "—" : `${v.toFixed(2)}×`);

const weakestAndStrongest = (clip: ClipLike): {weakest: CoachPhaseId; strongest: CoachPhaseId} => {
  let weakest: CoachPhaseId = "context";
  let strongest: CoachPhaseId = "context";
  let min = Infinity;
  let max = -Infinity;
  for (const p of PHASE_KEYS) {
    const s = phaseScore(clip, p);
    if (Number.isNaN(s)) continue;
    if (s < min) {
      min = s;
      weakest = p;
    }
    if (s > max) {
      max = s;
      strongest = p;
    }
  }
  return {weakest, strongest};
};

/** P3: coil vs plant base vs high coil / weak load phase */
const resolveP3Mode = (clip: ClipLike): P3VisualMode => {
  const p3 = phaseScore(clip, "backswing");
  const plantFwdScore = sub(clip, "C_plant_forward");
  const coil = sub(clip, "B_shoulder_hip");
  const peakSep = numberValue(clip.features.peak_shoulder_hip_separation_deg);
  if (p3 < 58 && peakSep > 20) return "coil_weak_load";
  if (plantFwdScore < 0.5) return "plant_base";
  if (coil > 0.55 && p3 > 72) return "peak_coil";
  if (p3 < 60) return "coil_weak_load";
  return "peak_coil";
};

const resolveP4Metrics = (clip: ClipLike): P4FreezeMetric[] => {
  const gap = numberValue(clip.features.min_foot_ball_distance_m);
  const p4 = phaseScore(clip, "contact");
  const transfer = sub(clip, "T");
  const contactAnkle = sub(clip, "C_contact_near_ankle");
  const ballZ = numberValue(clip.features.ball_z_at_contact ?? 0.2);
  const metrics: P4FreezeMetric[] = ["shockwave", "gap"];

  if (ballZ < 0.35) metrics.push("height");
  if (p4 > 75 && transfer > 0.85) metrics.push("transfer_ratio");
  else if (contactAnkle < 0.55 || gap > 0.2) metrics.push("foot_speed");
  else metrics.push("foot_speed", "transfer_ratio");

  if (numberValue(clip.features.position_delta_jump_m_s) > 8) {
    metrics.push("ball_speed_jump");
  }
  return [...new Set(metrics)];
};

export function buildGroundedShotPlan(clip: ClipLike): GroundedShotPlan {
  const {weakest, strongest} = weakestAndStrongest(clip);
  const role = clip.role === "constraint" ? "constraint" : "standout";
  const player = clip.shot.player || "Shooter";

  const p1 = phaseScore(clip, "context");
  const p2 = phaseScore(clip, "approach");
  const p3 = phaseScore(clip, "backswing");
  const p4 = phaseScore(clip, "contact");
  const p5 = phaseScore(clip, "follow");
  const p6 = phaseScore(clip, "output");

  const dDist = sub(clip, "D_distance");
  const dPress = sub(clip, "D_pressure");
  const dAngle = sub(clip, "D_angle");
  const peakSep = numberValue(clip.features.peak_shoulder_hip_separation_deg);
  const plantLat = numberValue(clip.features.plant_foot_lateral_offset_m);
  const plantFwd = numberValue(clip.features.plant_foot_forward_offset_m);
  const gap = numberValue(clip.features.min_foot_ball_distance_m);
  const footVel = numberValue(clip.features.foot_velocity_into_ball_m_s ?? clip.features.foot_peak_velocity_at_contact);
  const ratio = numberValue(clip.features.ball_to_foot_speed_ratio);
  const exit = numberValue(clip.features.ball_exit_speed_m_s);
  const launch = numberValue(clip.features.launch_angle_deg);
  const approachSpd = numberValue(clip.features.approach_speed_m_s);
  const approachAng = numberValue(clip.features.approach_angle_deg);
  const trunkLean = numberValue(clip.features.trunk_lean_approach_deg);
  const com = numberValue(clip.features.com_continuation_score);
  const shotVal = numberValue(clip.features.shot_value);
  const angleGoal = numberValue(clip.features.angle_to_goal_deg ?? clip.features.initial_goal_alignment_deg);

  const p3Mode = resolveP3Mode(clip);
  const p1Far = dDist < 0.25;
  const p1HighPressure = dPress > 0.85;

  const context: PhasePlan = {
    kicker: "P1 · shot picture",
    title: p1Far
      ? "Long-range attempt — context before mechanics"
      : p1HighPressure
        ? "Tight lane and pressure before the strike"
        : "Shooting angle and lane before the zoom",
    text: p1Far
      ? "Range rings and shot value frame the difficulty: little room for error from this distance."
      : p1HighPressure
        ? "Lane wedge and pressure read explain why this strike had to be shaped under congestion."
        : "Approach angle and target lane set up what the later phases must solve.",
    stickers: [
      {
        label: p1Far ? "distance" : "pressure",
        value: p1Far ? fmtPct(dDist) : fmtPct(dPress),
        color: "#1ee7ff",
        x: 880,
        y: 455,
      },
      {
        label: "shoot angle",
        value: fmtDeg(angleGoal),
        color: "#75d2ff",
        x: 1060,
        y: 620,
      },
    ],
    floatingChip: {
      title: p1Far ? "shot value" : "pressure",
      value: p1Far ? (Number.isFinite(shotVal) ? shotVal.toFixed(2) : "—") : fmtPct(dPress),
      sub: p1Far ? "model est." : "in lane",
    },
  };

  const approach: PhasePlan = {
    kicker: "P2 · approach runway",
    title:
      p2 < 65
        ? "Run-up speed and angle — setup was the limiter"
        : trunkLean > 12
          ? "Forward trunk lean drives the foot into the runway"
          : "Measured run-up path into the strike window",
    text:
      plantFwd < 0.4
        ? "Foot trail plus prep offset show the ball sat too far ahead before the load phase."
        : "Purple runway and cyan shot lane compare approach speed and shooting angle.",
    stickers: [
      {label: "speed", value: fmtVel(approachSpd), color: "#b66dff", x: 500, y: 725},
      {
        label: plantFwd < 0.45 ? "prep fwd" : "angle",
        value: plantFwd < 0.45 ? fmtM(plantFwd) : fmtDeg(approachAng),
        color: "#1ee7ff",
        x: 810,
        y: 590,
      },
    ],
  };

  const backswing: PhasePlan = {
    kicker: "P3 · backswing",
    title:
      p3Mode === "plant_base"
        ? "Plant base width — brace before coil"
        : p3Mode === "coil_weak_load"
          ? "Peak coil without a clean load phase"
          : "Hip–shoulder separation in the load window",
    text:
      p3Mode === "plant_base"
        ? "Ground plant-to-ball ruler is the hero; coil stays secondary because forward base was tight."
        : p3Mode === "coil_weak_load"
          ? "Arc shows peak X-factor, but phase score says that rotation did not convert into a strong load."
          : "Thin axes and planar arc match the scored peak coil; plant ruler anchors the base.",
    stickers: [
      {
        label: p3Mode === "plant_base" ? "plant" : "coil",
        value: p3Mode === "plant_base" ? fmtM(plantLat) : fmtDeg(peakSep),
        color: p3Mode === "coil_weak_load" ? "#ff8a8a" : "#1ee7ff",
        x: 1120,
        y: 420,
      },
    ],
  };

  const contact: PhasePlan = {
    kicker: "P4 · contact transfer",
    title:
      p4 < 60
        ? "Contact gap and foot speed — transfer broke down"
        : gap < 0.12
          ? "Tight gap freeze — clean foot-to-ball transfer"
          : "Freeze and read gap, foot speed, and transfer ratio",
    text:
      p4 < 60
        ? "Sequential rulers show spacing and foot speed; weak contact subscore drives the story."
        : "Impact shockwave then gap and velocity; transfer ratio when phase score supports it.",
    stickers: [
      {label: "gap", value: fmtM(gap), color: "#1ee7ff", x: 830, y: 680},
      {label: "foot speed", value: fmtVel(footVel), color: "#b66dff", x: 500, y: 445},
      ...(p4 > 78 ? [{label: "transfer", value: fmtRatio(ratio), color: "#75d2ff", x: 1180, y: 535}] : []),
    ],
    floatingChip:
      p4 > 75
        ? {title: "transfer", value: fmtPct(sub(clip, "T")), sub: "at contact"}
        : {title: "contact", value: fmtPct(sub(clip, "C_contact_near_ankle")), sub: "near ankle"},
  };

  const follow: PhasePlan = {
    kicker: "P5 · follow-through",
    title: p5 < 45 ? "COM stall after contact" : "Continuation after the strike",
    text:
      p5 < 45
        ? "Pelvis and foot trails expose a broken continuation — the chain stopped at contact."
        : "Trails show whether momentum carried past the frozen contact frame.",
    stickers: [
      {
        label: "COM",
        value: Number.isNaN(com) ? "—" : `${Math.round(com * 100)}%`,
        color: p5 < 45 ? "#ff8a8a" : "#1ee7ff",
        x: 545,
        y: 640,
      },
    ],
  };

  const output: PhasePlan = {
    kicker: "P6 · ball output",
    title: strongest === "output" ? "Exit speed and launch — outcome hero" : "Ball flight audit",
    text:
      p6 < 55
        ? "Trajectory and exit speed explain why mechanics did not become a dangerous outcome."
        : "Parabolic path and exit speed close the loop on whether the chain produced carry.",
    stickers: [
      {label: "exit", value: fmtVel(exit), color: "#75d2ff", x: 1120, y: 480},
      {label: "launch", value: fmtDeg(launch), color: "#1ee7ff", x: 930, y: 355},
    ],
    floatingChip:
      strongest === "output" || p6 < 58
        ? {title: "exit speed", value: fmtVel(exit), sub: p6 < 58 ? "outcome limit" : "ball out"}
        : undefined,
  };

  return {
    shotLabel: player,
    role,
    weakestPhase: weakest,
    strongestPhase: strongest,
    phases: {context, approach, backswing, contact, follow, output},
    p3Mode,
    p4FreezeMetrics: resolveP4Metrics(clip),
    p1ShowDistanceArcs: p1Far,
    p2ShowTrunkLean: trunkLean > 10 && p2 < 70,
  };
}
