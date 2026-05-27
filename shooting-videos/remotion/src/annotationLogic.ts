export type ExplainerRole = "standout" | "constraint";
export type FeatureRecord = Record<string, string | number | null | undefined>;

export type AnnotationVisual =
  | "distance-line"
  | "ground-distance"
  | "angle-arc"
  | "path-trace"
  | "trajectory";

export type AnnotationAnchor =
  | "strikeFoot"
  | "plantFoot"
  | "ball"
  | "leftShoulder"
  | "rightShoulder"
  | "leftHip"
  | "rightHip";

export type AnnotationBeat = {
  id: string;
  family: string;
  phase: string;
  visual: AnnotationVisual;
  anchors: AnnotationAnchor[];
  label: string;
  headline: string;
  implication: string;
};

export const numberValue = (value: string | number | null | undefined): number => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : Number.NaN;
};

export const formatMetricDistance = (value: string | number | null | undefined): string => {
  const parsed = numberValue(value);
  return Number.isNaN(parsed) ? "-" : `${Math.abs(parsed).toFixed(2)}m`;
};

const formatDegrees = (value: string | number | null | undefined): string => {
  const parsed = numberValue(value);
  return Number.isNaN(parsed) ? "-" : `${parsed.toFixed(1)} deg`;
};

const formatVelocity = (value: string | number | null | undefined): string => {
  const parsed = numberValue(value);
  return Number.isNaN(parsed) ? "-" : `${parsed.toFixed(1)} m/s`;
};

export const phaseBeatId = (phase: string): string => {
  if (phase === "contact hold") return "contact-gap";
  if (phase === "mechanics breakdown") return "hip-shoulder";
  if (phase === "release path") return "ball-path";
  return "foot-path";
};

export const buildAnnotationBeats = ({
  role,
  score,
  features,
}: {
  role: ExplainerRole;
  score: FeatureRecord;
  features: FeatureRecord;
}): AnnotationBeat[] => {
  const contactGap = formatMetricDistance(features.min_foot_ball_distance_m);
  const plantBase = formatMetricDistance(features.plant_foot_lateral_offset_m);
  const hipShoulder = formatDegrees(
    features.peak_shoulder_hip_separation_deg ?? features.shoulder_hip_separation_deg,
  );
  const footSpeed = formatVelocity(features.foot_velocity_into_ball_m_s ?? features.foot_speed_m_s);
  const ballSpeed = formatVelocity(features.ball_exit_speed_m_s ?? features.initial_ball_speed_m_s);
  const isConstraint = role === "constraint";

  return [
    {
      id: "contact-gap",
      family: "contact geometry",
      phase: "contact hold",
      visual: "distance-line",
      anchors: ["strikeFoot", "ball"],
      label: `${contactGap} contact gap`,
      headline: "Foot-to-ball spacing controls strike efficiency.",
      implication: isConstraint
        ? "A larger gap turns swing speed into correction and mishit risk instead of clean ball transfer."
        : "A compact gap keeps the strike connected so force transfers into ball speed and direction.",
    },
    {
      id: "plant-base",
      family: "plant and brace",
      phase: "contact hold",
      visual: "ground-distance",
      anchors: ["plantFoot", "ball"],
      label: `${plantBase} plant base`,
      headline: "Plant distance sets the brace for rotation.",
      implication: isConstraint
        ? "If the base is too wide or unstable, the body spends energy staying balanced instead of releasing through the ball."
        : "A stable plant gives the hips a post to rotate around, improving balance and transfer.",
    },
    {
      id: "hip-shoulder",
      family: "rotation",
      phase: "mechanics breakdown",
      visual: "angle-arc",
      anchors: ["leftShoulder", "rightShoulder", "leftHip", "rightHip"],
      label: `${hipShoulder} hip-shoulder`,
      headline: "Hip-shoulder separation stores rotational energy.",
      implication: isConstraint
        ? "Separation only helps if backswing, plant, and timing let it unwind cleanly through contact."
        : "The interval shows torque storage: hips lead, shoulders delay, then the foot releases through the ball.",
    },
    {
      id: "foot-path",
      family: "strike path",
      phase: "approach to contact",
      visual: "path-trace",
      anchors: ["strikeFoot"],
      label: `${footSpeed} foot speed`,
      headline: "The swing path decides how repeatable the contact is.",
      implication: isConstraint
        ? "A less organized path can still be fast, but it makes timing and contact quality harder to repeat."
        : "A clean swing path lets the foot accelerate late and arrive square through the ball.",
    },
    {
      id: "ball-path",
      family: "output",
      phase: "release path",
      visual: "trajectory",
      anchors: ["ball"],
      label: `${ballSpeed} ball output`,
      headline: "The ball path reveals whether mechanics became shot output.",
      implication: isConstraint
        ? "The output path shows how much of the chain survived contact into placement and carry."
        : "A connected follow-through keeps the output path aligned with the intended release.",
    },
  ];
};
