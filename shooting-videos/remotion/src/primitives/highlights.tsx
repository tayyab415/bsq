import React from "react";
import {palette, polarityHex, stroke as strokeTokens, type, typeScale} from "../style/tokens";
import {
  clamp01,
  easeOutQuart,
  type PrimitiveBase,
  type ScreenPoint,
} from "./types";

/* -------------------------------------------------------------------------- */
/* PlayerSpotlight — ring + leader line + label, anchored on a joint          */
/* -------------------------------------------------------------------------- */

export type PlayerSpotlightProps = PrimitiveBase & {
  joint: ScreenPoint;
  /** Label position offset from the joint. */
  labelAt: ScreenPoint;
  label: string;
  /** Optional secondary line under the label. */
  sub?: string;
  uid: string;
};

export const PlayerSpotlight: React.FC<PlayerSpotlightProps> = ({
  progress,
  joint,
  labelAt,
  label,
  sub,
  polarity = "positive",
  scale = "standard",
  uid,
}) => {
  const color = polarityHex(polarity);
  const t = easeOutQuart(progress);
  const ringR = (scale === "hero" ? 22 : 16) * t;
  const innerR = (scale === "hero" ? 6 : 4) * t;
  const lineProgress = Math.max(0, t - 0.25) / 0.75;
  const labelOpacity = clamp01((progress - 0.55) * 2.5);

  // leader line from joint toward labelAt
  const dx = labelAt.x - joint.x;
  const dy = labelAt.y - joint.y;
  const cx = joint.x + dx * lineProgress;
  const cy = joint.y + dy * lineProgress;

  const w = Math.max(label.length, sub?.length ?? 0) * 8 + 28;

  return (
    <g>
      <circle cx={joint.x} cy={joint.y} r={ringR + 4} fill="none" stroke={color} strokeWidth={1.5} strokeOpacity={0.35} />
      <circle cx={joint.x} cy={joint.y} r={ringR} fill="none" stroke={color} strokeWidth={2} strokeOpacity={0.85} />
      <circle cx={joint.x} cy={joint.y} r={innerR} fill={color} fillOpacity={0.95} />
      {lineProgress > 0.05 ? (
        <line x1={joint.x} y1={joint.y} x2={cx} y2={cy} stroke={color} strokeWidth={1.5} strokeOpacity={0.6} strokeLinecap="round" />
      ) : null}
      {labelOpacity > 0 ? (
        <g transform={`translate(${labelAt.x}, ${labelAt.y})`} opacity={labelOpacity}>
          <rect x={-w / 2} y={-22} width={w} height={sub ? 46 : 28} rx={5} fill={palette.canvas.panelStrong} stroke={palette.canvas.panelBorder} strokeWidth={1} />
          <text
            x={0}
            y={-3}
            textAnchor="middle"
            fontFamily={type.sans}
            fontSize={typeScale.label}
            fontWeight={600}
            fill={palette.text.ink}
          >
            {label}
          </text>
          {sub ? (
            <text x={0} y={17} textAnchor="middle" fontFamily={type.mono} fontSize={typeScale.numericSmall} fill={color}>
              {sub}
            </text>
          ) : null}
        </g>
      ) : null}
    </g>
  );
};

/* -------------------------------------------------------------------------- */
/* PoseSticker — labeled silhouette callout (e.g., trunk lean / ankle shape)  */
/* Anchored to a joint with a leader line + a square outline.                 */
/* -------------------------------------------------------------------------- */

export type PoseStickerProps = PrimitiveBase & {
  anchor: ScreenPoint;
  /** Where the sticker box sits (its center). */
  stickerAt: ScreenPoint;
  /** Pre-drawn icon path (already an SVG path string) sized for a 40x40 box. */
  iconPath?: string;
  title: string;
  detail?: string;
};

export const PoseSticker: React.FC<PoseStickerProps> = ({
  progress,
  anchor,
  stickerAt,
  iconPath,
  title,
  detail,
  polarity = "neutral",
}) => {
  const color = polarityHex(polarity);
  const t = easeOutQuart(progress);
  const opacity = t;
  const w = Math.max(title.length, detail?.length ?? 0) * 8 + 60;
  const h = detail ? 56 : 36;

  return (
    <g opacity={opacity}>
      <line x1={anchor.x} y1={anchor.y} x2={stickerAt.x} y2={stickerAt.y} stroke={color} strokeWidth={1.25} strokeOpacity={0.55} strokeDasharray="4 3" />
      <circle cx={anchor.x} cy={anchor.y} r={4} fill={color} opacity={0.9} />
      <g transform={`translate(${stickerAt.x - w / 2}, ${stickerAt.y - h / 2})`}>
        <rect x={0} y={0} width={w} height={h} rx={6} fill={palette.canvas.panelStrong} stroke={color} strokeWidth={1.25} strokeOpacity={0.7} />
        {iconPath ? (
          <g transform={`translate(8, ${(h - 28) / 2})`}>
            <path d={iconPath} fill={color} fillOpacity={0.85} />
          </g>
        ) : null}
        <text
          x={iconPath ? 42 : 14}
          y={detail ? 22 : 23}
          fontFamily={type.sans}
          fontSize={typeScale.label}
          fontWeight={600}
          fill={palette.text.ink}
        >
          {title}
        </text>
        {detail ? (
          <text
            x={iconPath ? 42 : 14}
            y={42}
            fontFamily={type.mono}
            fontSize={typeScale.numericSmall}
            fill={color}
          >
            {detail}
          </text>
        ) : null}
      </g>
    </g>
  );
};

/* -------------------------------------------------------------------------- */
/* GhostSkeleton — second skeleton drawn at low opacity from a different frame
 * For the swatch, we accept two joint-position sets and draw both as line art.
 * -------------------------------------------------------------------------- */

export type SkeletonJoints = Record<string, ScreenPoint>;

const BODY_LINES: ReadonlyArray<[string, string]> = [
  ["neck", "pelvis"],
  ["neck", "left_shoulder"],
  ["neck", "right_shoulder"],
  ["left_shoulder", "left_elbow"],
  ["left_elbow", "left_wrist"],
  ["right_shoulder", "right_elbow"],
  ["right_elbow", "right_wrist"],
  ["pelvis", "left_hip"],
  ["pelvis", "right_hip"],
  ["left_hip", "left_knee"],
  ["left_knee", "left_ankle"],
  ["left_ankle", "left_toe"],
  ["right_hip", "right_knee"],
  ["right_knee", "right_ankle"],
  ["right_ankle", "right_toe"],
  ["nose", "neck"],
];

export type GhostSkeletonProps = PrimitiveBase & {
  /** Live (foreground) pose. */
  live: SkeletonJoints;
  /** Ghost (background) pose — drawn at low opacity. */
  ghost: SkeletonJoints;
  /** Label describing what the ghost represents (e.g., "peak coil frame"). */
  ghostLabel?: string;
  /** Where to render the ghost label (defaults near ghost.neck). */
  ghostLabelAt?: ScreenPoint;
};

const drawSkel = (j: SkeletonJoints, color: string, opacity: number, sw: number, key: string) => {
  const lines: React.ReactNode[] = [];
  BODY_LINES.forEach(([a, b], i) => {
    const pa = j[a];
    const pb = j[b];
    if (!pa || !pb) return;
    lines.push(
      <line key={`${key}-l-${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={color} strokeWidth={sw} strokeOpacity={opacity} strokeLinecap="round" />,
    );
  });
  const dots: React.ReactNode[] = [];
  Object.entries(j).forEach(([name, p], i) => {
    dots.push(<circle key={`${key}-d-${name}-${i}`} cx={p.x} cy={p.y} r={sw} fill={color} opacity={opacity} />);
  });
  return (
    <g>
      {lines}
      {dots}
    </g>
  );
};

export const GhostSkeleton: React.FC<GhostSkeletonProps> = ({
  progress,
  live,
  ghost,
  ghostLabel,
  ghostLabelAt,
  scale = "standard",
}) => {
  const t = easeOutQuart(progress);
  const ghostOpacity = 0.32 * t;
  const sw = scale === "hero" ? 3 : 2;

  const labelAt = ghostLabelAt ?? (ghost["neck"] ?? ghost["pelvis"] ?? {x: 0, y: 0});

  return (
    <g>
      {drawSkel(ghost, palette.accent.violet, ghostOpacity, sw, "ghost")}
      {drawSkel(live, palette.subject.bone, 0.92, sw, "live")}
      {ghostLabel && t > 0.45 ? (
        <g transform={`translate(${labelAt.x}, ${labelAt.y - 32})`} opacity={clamp01((t - 0.45) * 2)}>
          <rect x={-((ghostLabel.length * 7) / 2 + 10)} y={-13} width={ghostLabel.length * 7 + 20} height={22} rx={4} fill={palette.canvas.panel} stroke={palette.accent.violet} strokeOpacity={0.6} strokeWidth={1} />
          <text x={0} y={3} textAnchor="middle" fontFamily={type.sans} fontSize={typeScale.labelSmall} fill={palette.accent.violet}>
            {ghostLabel}
          </text>
        </g>
      ) : null}
    </g>
  );
};
