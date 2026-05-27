/**
 * AGY comparison primitives — motion/technique vocabulary from the reference
 * video, rendered in our cyan/green/coral identity (not Statsbomb orange).
 *
 *  • ImpactShockwave — P4 contact expanding ground ring
 *  • KeeperSpotlightCylinder — GK base ring + vertical column (2D swatch)
 *  • PressureWedgeCorridor — shooting lane wedge ball → posts
 *  • DefenderGhost — outline ghost → solid defender capture
 */
import React from "react";
import {palette, polarityHex, type, typeScale} from "../style/tokens";
import {bloomForAccent, bloomForPolarity} from "./filters";
import {clamp01, easeOutQuart, type PrimitiveBase, type ScreenPoint} from "./types";

/* -------------------------------------------------------------------------- */
/* ImpactShockwave — expanding ring at foot-ball contact (P4)                 */
/* -------------------------------------------------------------------------- */

export type ImpactShockwaveProps = PrimitiveBase & {
  center: ScreenPoint;
  /** Max ellipse radius X (px). */
  maxRadius?: number;
  /** Perspective Y squash. Default 0.35. */
  perspectiveY?: number;
  /** Number of ripple rings. Default 2. */
  rings?: number;
  uid?: string;
};

export const ImpactShockwave: React.FC<ImpactShockwaveProps> = ({
  progress,
  center,
  maxRadius = 88,
  perspectiveY = 0.35,
  rings = 2,
  polarity = "positive",
  scale = "hero",
}) => {
  const color = polarityHex(polarity);
  const bloom = bloomForPolarity(polarity, true);
  const sw = scale === "hero" ? 2.5 : 1.8;
  const t = easeOutQuart(progress);

  return (
    <g>
      {Array.from({length: rings}).map((_, i) => {
        const stagger = i * 0.18;
        const ringT = clamp01((t - stagger) / (1 - stagger));
        if (ringT < 0.01) return null;
        const rx = maxRadius * ringT * (1 - i * 0.12);
        const ry = rx * perspectiveY;
        const strokeOpacity = (1 - ringT) * (0.95 - i * 0.2);
        return (
          <ellipse
            key={i}
            cx={center.x}
            cy={center.y}
            rx={rx}
            ry={ry}
            fill="none"
            stroke={color}
            strokeWidth={sw}
            strokeOpacity={strokeOpacity}
            filter={bloom}
          />
        );
      })}
      {/* impact flash at center */}
      {t > 0.05 && t < 0.85 ? (
        <circle
          cx={center.x}
          cy={center.y}
          r={scale === "hero" ? 6 : 4}
          fill={color}
          opacity={(1 - t) * 0.9}
          filter={bloom}
        />
      ) : null}
    </g>
  );
};

/* -------------------------------------------------------------------------- */
/* KeeperSpotlightCylinder — GK turf ring + vertical column (2D swatch)         */
/* -------------------------------------------------------------------------- */

export type KeeperSpotlightCylinderProps = PrimitiveBase & {
  /** Ground contact point (keeper feet). */
  base: ScreenPoint;
  /** Column height in px (screen space). */
  columnHeight?: number;
  /** Base ring radius X. */
  baseRadius?: number;
  label?: string;
  sub?: string;
  uid?: string;
};

export const KeeperSpotlightCylinder: React.FC<KeeperSpotlightCylinderProps> = ({
  progress,
  base,
  columnHeight = 140,
  baseRadius = 28,
  label = "GK",
  sub,
  polarity = "neutral",
  scale = "hero",
  uid = "gk",
}) => {
  const color = palette.subject.keeperAccent;
  const bloom = bloomForAccent("violet", false);
  const ringT = easeOutQuart(clamp01(progress / 0.45));
  const colT = easeOutQuart(clamp01((progress - 0.2) / 0.55));
  const labelT = clamp01((progress - 0.5) * 2.5);
  const gradId = `gkCol-${uid}`;
  const topY = base.y - columnHeight * colT;

  return (
    <g>
      <defs>
        <linearGradient id={gradId} x1={base.x} y1={base.y} x2={base.x} y2={topY} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={color} stopOpacity="0.55" />
          <stop offset="70%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* base ring */}
      <ellipse
        cx={base.x}
        cy={base.y}
        rx={baseRadius * ringT}
        ry={(baseRadius * 0.38) * ringT}
        fill={color}
        fillOpacity={0.22}
        stroke={color}
        strokeWidth={scale === "hero" ? 2.5 : 2}
        strokeOpacity={0.9}
        filter={bloom}
      />
      {/* column */}
      {colT > 0.02 ? (
        <rect
          x={base.x - baseRadius * 0.55}
          y={topY}
          width={baseRadius * 1.1}
          height={base.y - topY}
          fill={`url(#${gradId})`}
          stroke={color}
          strokeWidth={1}
          strokeOpacity={0.35}
          rx={4}
        />
      ) : null}
      {label && labelT > 0 ? (
        <g transform={`translate(${base.x}, ${topY - 18})`} opacity={labelT}>
          <rect x={-52} y={-14} width={104} height={28} rx={4} fill={palette.canvas.chipBackdrop} stroke={color} strokeOpacity={0.5} strokeWidth={1} />
          <text x={0} y={5} textAnchor="middle" fontFamily={type.sans} fontSize={typeScale.labelSmall} fill={color} fontWeight={600}>
            {label}
          </text>
          {sub ? (
            <text x={0} y={22} textAnchor="middle" fontFamily={type.mono} fontSize={typeScale.eyebrow} fill={palette.text.inkSoft}>
              {sub}
            </text>
          ) : null}
        </g>
      ) : null}
    </g>
  );
};

/* -------------------------------------------------------------------------- */
/* PressureWedgeCorridor — shaded lane from ball to goal mouth (P1/P4)        */
/* -------------------------------------------------------------------------- */

export type PressureWedgeCorridorProps = PrimitiveBase & {
  vertex: ScreenPoint;
  goalLeft: ScreenPoint;
  goalRight: ScreenPoint;
  label?: string;
  uid?: string;
};

export const PressureWedgeCorridor: React.FC<PressureWedgeCorridorProps> = ({
  progress,
  vertex,
  goalLeft,
  goalRight,
  label,
  polarity = "negative",
  uid = "pw",
}) => {
  const color = polarityHex(polarity);
  const bloom = bloomForPolarity(polarity, true);
  const t = easeOutQuart(progress);
  const lx = vertex.x + (goalLeft.x - vertex.x) * t;
  const ly = vertex.y + (goalLeft.y - vertex.y) * t;
  const rx = vertex.x + (goalRight.x - vertex.x) * t;
  const ry = vertex.y + (goalRight.y - vertex.y) * t;
  const gradId = `pwedge-${uid}`;
  const wedgePath = `M ${vertex.x} ${vertex.y} L ${lx} ${ly} L ${rx} ${ry} Z`;
  const midX = (lx + rx) / 2;
  const midY = (ly + ry) / 2;

  return (
    <g>
      <defs>
        <radialGradient id={gradId} cx={vertex.x} cy={vertex.y} r={Math.hypot(goalLeft.x - vertex.x, goalLeft.y - vertex.y)} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={color} stopOpacity="0.08" />
          <stop offset="55%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0.06" />
        </radialGradient>
      </defs>
      <path d={wedgePath} fill={`url(#${gradId})`} filter={bloom} />
      <line x1={vertex.x} y1={vertex.y} x2={lx} y2={ly} stroke={color} strokeWidth={2} strokeOpacity={0.85 * t} strokeLinecap="round" />
      <line x1={vertex.x} y1={vertex.y} x2={rx} y2={ry} stroke={color} strokeWidth={2} strokeOpacity={0.85 * t} strokeLinecap="round" />
      {label && t > 0.55 ? (
        <text
          x={midX}
          y={midY - 12}
          textAnchor="middle"
          fontFamily={type.sans}
          fontSize={typeScale.labelSmall}
          fill={palette.text.inkSoft}
          opacity={clamp01((t - 0.55) * 2.5)}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
};

/* -------------------------------------------------------------------------- */
/* DefenderGhost — cyan outline → solid model (reference defender transition)   */
/* -------------------------------------------------------------------------- */

export type DefenderGhostJoint = {
  position: ScreenPoint;
  jersey?: string | number;
};

export type DefenderGhostProps = PrimitiveBase & {
  defenders: DefenderGhostJoint[];
  /** 0 = full ghost outline, 1 = solidified. */
  solidify?: number;
};

const drawDefenderStick = (
  cx: number,
  cy: number,
  scale: number,
  mode: "ghost" | "solid",
  jersey?: string | number,
  opacity = 1,
) => {
  const s = scale;
  const joints: ScreenPoint[] = [
    {x: cx, y: cy - 70 * s},
    {x: cx - 8 * s, y: cy - 55 * s},
    {x: cx + 10 * s, y: cy - 52 * s},
    {x: cx, y: cy - 38 * s},
    {x: cx - 14 * s, y: cy - 18 * s},
    {x: cx + 12 * s, y: cy - 15 * s},
    {x: cx - 6 * s, y: cy + 8 * s},
    {x: cx + 8 * s, y: cy + 12 * s},
  ];
  const lines: [number, number][] = [
    [0, 2], [2, 3], [3, 4], [3, 5], [3, 6], [6, 7],
  ];
  const ghostColor = palette.accent.primary;
  const solidFill = "rgba(28, 30, 34, 0.88)";
  const solidStroke = palette.text.inkMuted;

  return (
    <g opacity={opacity}>
      {mode === "solid" ? (
        <ellipse cx={cx} cy={cy + 14 * s} rx={14 * s} ry={5 * s} fill="rgba(0,0,0,0.35)" />
      ) : null}
      {lines.map(([a, b], i) => (
        <line
          key={i}
          x1={joints[a].x}
          y1={joints[a].y}
          x2={joints[b].x}
          y2={joints[b].y}
          stroke={mode === "ghost" ? ghostColor : solidStroke}
          strokeWidth={mode === "ghost" ? 2 : 2.5}
          strokeOpacity={mode === "ghost" ? 0.75 : 0.9}
          strokeDasharray={mode === "ghost" ? "4 3" : undefined}
        />
      ))}
      {joints.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={mode === "ghost" ? 2.5 : 3}
          fill={mode === "ghost" ? "none" : solidFill}
          stroke={mode === "ghost" ? ghostColor : solidStroke}
          strokeWidth={1.5}
        />
      ))}
      {mode === "solid" && jersey !== undefined ? (
        <text x={cx} y={cy - 78 * s} textAnchor="middle" fontFamily={type.mono} fontSize={14} fill={palette.team.homeStripe} fontWeight={700}>
          {jersey}
        </text>
      ) : null}
    </g>
  );
};

export const DefenderGhost: React.FC<DefenderGhostProps> = ({
  progress,
  defenders,
  solidify: solidifyProp,
}) => {
  const t = easeOutQuart(progress);
  const solidify = solidifyProp ?? t;

  return (
    <g>
      {defenders.map((d, i) => {
        const ghostOp = 1 - solidify;
        const solidOp = solidify;
        return (
          <g key={i}>
            {ghostOp > 0.05
              ? drawDefenderStick(d.position.x, d.position.y, 0.9, "ghost", d.jersey, ghostOp)
              : null}
            {solidOp > 0.05
              ? drawDefenderStick(d.position.x, d.position.y, 0.9, "solid", d.jersey, solidOp)
              : null}
          </g>
        );
      })}
    </g>
  );
};
