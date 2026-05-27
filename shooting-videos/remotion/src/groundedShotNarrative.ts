/**
 * Shot-specific explanation copy → subtitle cues + bookend slates.
 * Drives @remotion/captions (no TTS until audio is confirmed).
 */
import {numberValue} from "./annotationLogic";
import type {CoachPhaseId} from "./groundedContactChoreography";
import {
  EXPANDED_PHASE_FRAME_COUNTS,
  GROUNDED_FPS,
  segmentStartFrame,
  type SegmentId,
} from "./groundedExpandedTimeline";
import type {GroundedShotPlan} from "./groundedShotAnnotationPlan";
import type {PhaseContribution} from "./primitives/chrome";

export type SubtitleCue = {
  startFrame: number;
  endFrame: number;
  text: string;
};

export type ShotCardNarrative = {
  player: string;
  jersey?: string | number;
  team: string;
  match: string;
  matchSub?: string;
  family: string;
  foot?: string;
  pressure?: string;
  xg?: string;
  shotValue?: string;
  outcome?: string;
};

export type VerdictNarrative = {
  bsq: number;
  band: "good" | "ok" | "bad";
  technique: number;
  techniqueBand: "good" | "ok" | "bad";
  positioning: number;
  positioningBand: "good" | "ok" | "bad";
  phases: PhaseContribution[];
  scoreline: string;
  scorelineSub?: string;
};

export type GroundedShotNarrative = {
  cues: SubtitleCue[];
  shotCard: ShotCardNarrative;
  verdict: VerdictNarrative;
};

type ClipLike = {
  role?: string;
  matchFolder: string;
  eventId: string;
  shot: {player?: string; team?: string; section?: string};
  score: Record<string, string | number | null>;
  features: Record<string, string | number | null>;
};

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

const scoreBand = (v: number): "good" | "ok" | "bad" => {
  if (Number.isNaN(v)) return "ok";
  if (v >= 75) return "good";
  if (v >= 55) return "ok";
  return "bad";
};

const comExplanation = (clip: ClipLike): string => {
  const com = numberValue(clip.features.com_continuation_score);
  if (Number.isNaN(com)) return "Continuation after contact could not be scored.";
  if (com <= 0.05) return "Pelvis moves against the ball line after contact — the chain stalls.";
  if (com < 0.35) return "Weak center-of-mass continuation through the shot line.";
  if (com < 0.65) return "Moderate continuation — some energy carries past impact.";
  return "Strong continuation — pelvis keeps driving with the ball.";
};

const phaseBeats = (segment: CoachPhaseId) => {
  const frames = EXPANDED_PHASE_FRAME_COUNTS[segment];
  const start = segmentStartFrame(segment);
  const q = (from: number, to: number) => ({
    startFrame: start + Math.round(frames * from),
    endFrame: start + Math.round(frames * to),
  });
  return {
    establish: q(0.04, 0.22),
    hero: q(0.2, 0.52),
    evidence: q(0.48, 0.78),
    implication: q(0.74, 0.96),
  };
};

const pushCue = (cues: SubtitleCue[], slot: {startFrame: number; endFrame: number}, text: string) => {
  if (!text.trim()) return;
  cues.push({
    startFrame: slot.startFrame,
    endFrame: Math.max(slot.startFrame + GROUNDED_FPS * 2, slot.endFrame),
    text: text.trim(),
  });
};

export function buildGroundedShotNarrative(clip: ClipLike, plan: GroundedShotPlan): GroundedShotNarrative {
  const cues: SubtitleCue[] = [];
  const player = clip.shot.player || "Shooter";
  const team = clip.shot.team || "Team";
  const match = clip.matchFolder.replace(/_/g, " ");
  const xg = numberValue(clip.features.shot_value ?? clip.score.xG);
  const press = sub(clip, "D_pressure");
  const dist = sub(clip, "D_distance");
  const bsq = numberValue(clip.score.technique_score ?? clip.score.BSQ);
  const tech = numberValue(clip.score.technique_score);
  const pos = numberValue(clip.score.positioning_score);

  const p1 = phaseBeats("context");
  pushCue(
    cues,
    p1.establish,
    plan.p1ShowDistanceArcs
      ? `${player} — long-range attempt before the mechanics zoom.`
      : `${player} — tight lane and pressure before the strike.`,
  );
  pushCue(
    cues,
    p1.hero,
    plan.p1ShowDistanceArcs
      ? `Shot value ${Number.isFinite(xg) ? xg.toFixed(2) : "low"} — little room for error from distance.`
      : `Pressure ${Math.round(press * 100)}% in lane — the strike must be shaped under congestion.`,
  );
  pushCue(cues, p1.evidence, plan.phases.context.text);
  pushCue(
    cues,
    p1.implication,
    `P1 scores ${Math.round(phaseScore(clip, "context"))} — ${plan.p1ShowDistanceArcs ? "context distance is the story." : "lane and pressure set the degree of difficulty."}`,
  );

  const p2 = phaseBeats("approach");
  pushCue(cues, p2.establish, plan.phases.approach.title);
  pushCue(cues, p2.hero, plan.phases.approach.text);
  pushCue(
    cues,
    p2.evidence,
    `Run-up ${numberValue(clip.features.approach_speed_m_s).toFixed(1)} m/s · approach angle ${numberValue(clip.features.approach_angle_deg).toFixed(0)}°.`,
  );
  pushCue(
    cues,
    p2.implication,
    `P2 ${Math.round(phaseScore(clip, "approach"))} — ${plan.p2ShowTrunkLean ? "trunk lean and prep offset drive the runway." : "speed and angle must set up the load phase."}`,
  );

  const p3 = phaseBeats("backswing");
  pushCue(cues, p3.establish, plan.phases.backswing.title);
  pushCue(cues, p3.hero, plan.phases.backswing.text);
  if (plan.p3Mode === "plant_base") {
    pushCue(
      cues,
      p3.evidence,
      `Plant base ${Math.abs(numberValue(clip.features.plant_foot_forward_offset_m)).toFixed(2)} m — forward brace is the hero, not peak coil.`,
    );
  } else if (plan.p3Mode === "coil_weak_load") {
    pushCue(
      cues,
      p3.evidence,
      `Peak coil ${numberValue(clip.features.peak_shoulder_hip_separation_deg).toFixed(1)}° — but the load phase score stays low.`,
    );
  } else {
    pushCue(
      cues,
      p3.evidence,
      `Peak hip–shoulder separation ${numberValue(clip.features.peak_shoulder_hip_separation_deg).toFixed(1)}° in the load window.`,
    );
  }
  pushCue(
    cues,
    p3.implication,
    `P3 ${Math.round(phaseScore(clip, "backswing"))} — ${plan.p3Mode === "coil_weak_load" ? "rotation did not convert into a strong load." : "coil and plant base set up contact."}`,
  );

  const p4 = phaseBeats("contact");
  pushCue(cues, p4.establish, plan.phases.contact.title);
  pushCue(cues, p4.hero, "Freeze on impact — read gap, foot speed, and transfer in sequence.");
  pushCue(
    cues,
    p4.evidence,
    `Gap ${numberValue(clip.features.min_foot_ball_distance_m).toFixed(2)} m · foot ${numberValue(clip.features.foot_peak_velocity_at_contact ?? clip.features.foot_velocity_into_ball_m_s).toFixed(1)} m/s · transfer ${Math.round(sub(clip, "T") * 100)}%.`,
  );
  pushCue(cues, p4.implication, plan.phases.contact.text);

  const p5 = phaseBeats("follow");
  pushCue(cues, p5.establish, plan.phases.follow.title);
  pushCue(cues, p5.hero, comExplanation(clip));
  pushCue(cues, p5.evidence, `COM continuation ${Math.round(numberValue(clip.features.com_continuation_score) * 100)}% · P5 phase ${Math.round(phaseScore(clip, "follow"))}.`);
  pushCue(cues, p5.implication, plan.phases.follow.text);

  const p6 = phaseBeats("output");
  pushCue(cues, p6.establish, plan.phases.output.title);
  pushCue(
    cues,
    p6.hero,
    `Exit ${numberValue(clip.features.ball_exit_speed_m_s).toFixed(1)} m/s at ${numberValue(clip.features.launch_angle_deg).toFixed(1)}° launch.`,
  );
  pushCue(cues, p6.evidence, plan.phases.output.text);
  pushCue(
    cues,
    p6.implication,
    `P6 ${Math.round(phaseScore(clip, "output"))} — ${plan.strongestPhase === "output" ? "ball flight carries the verdict." : "outcome reflects earlier mechanical limits."}`,
  );

  const phaseContribs: PhaseContribution[] = (
    ["context", "approach", "backswing", "contact", "follow", "output"] as CoachPhaseId[]
  ).map((id, i) => ({
    code: `P${i + 1}`,
    name: id === "context" ? "Context" : id.charAt(0).toUpperCase() + id.slice(1),
    weight: {context: 0.1, approach: 0.2, backswing: 0.2, contact: 0.3, follow: 0.1, output: 0.1}[id],
    score: phaseScore(clip, id),
    band: scoreBand(phaseScore(clip, id)),
  }));

  return {
    cues,
    shotCard: {
      player,
      team,
      match,
      matchSub: `${clip.shot.section?.replace(/([A-Z])/g, " $1") || "Match"} · Event ${clip.eventId}`,
      family: String(clip.features.family || clip.score.family || "open play").replace(/_/g, " "),
      foot: `${clip.features.inferred_foot || "right"} · plant ${clip.features.plant_foot || "left"}`,
      pressure: Number.isFinite(press) ? `${Math.round(press * 100)}% in lane` : undefined,
      xg: Number.isFinite(xg) ? xg.toFixed(2) : undefined,
      shotValue: Number.isFinite(xg) ? xg.toFixed(2) : undefined,
      outcome: String(clip.score.shot_result || clip.features.shot_result || "shot").replace(/_/g, " "),
    },
    verdict: {
      bsq: Number.isFinite(bsq) ? bsq : numberValue(clip.score.technique_score),
      band: scoreBand(Number.isFinite(bsq) ? bsq : tech),
      technique: tech,
      techniqueBand: scoreBand(tech),
      positioning: pos,
      positioningBand: scoreBand(pos),
      phases: phaseContribs,
      scoreline: `${player} · ${match}`,
      scorelineSub: plan.role === "constraint" ? "Constraint shot — mechanics limit outcome" : "Standout mechanics phase",
    },
  };
}
