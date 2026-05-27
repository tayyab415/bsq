import React from "react";
import {bandHex, palette, polarityHex, type, typeScale} from "../style/tokens";
import {clamp01, easeOutQuart, type PrimitiveBase} from "./types";

/* -------------------------------------------------------------------------- */
/* ContextBadge — small chip with eyebrow + value, used for context info       */
/* -------------------------------------------------------------------------- */

export type ContextBadgeProps = PrimitiveBase & {
  /** Top-left corner of the chip. */
  at: {x: number; y: number};
  eyebrow: string;
  value: string;
  /** Optional sub-line (e.g., unit). */
  sub?: string;
  width?: number;
};

export const ContextBadge: React.FC<ContextBadgeProps> = ({
  progress,
  at,
  eyebrow,
  value,
  sub,
  width = 230,
  polarity = "neutral",
}) => {
  const color = polarityHex(polarity);
  const t = easeOutQuart(progress);
  const opacity = t;
  const yShift = (1 - t) * 6;
  const height = sub ? 76 : 58;

  return (
    <g transform={`translate(${at.x}, ${at.y + yShift})`} opacity={opacity}>
      <rect x={0} y={0} width={width} height={height} rx={6} fill={palette.canvas.panelStrong} stroke={palette.canvas.panelBorder} strokeWidth={1} />
      <rect x={0} y={0} width={3} height={height} rx={1.5} fill={color} />
      <text x={14} y={20} fontFamily={type.sans} fontSize={typeScale.eyebrow} fill={palette.text.inkMuted} letterSpacing="1.3px">
        {eyebrow.toUpperCase()}
      </text>
      <text x={14} y={42} fontFamily={type.mono} fontSize={22} fill={color} style={{fontVariantNumeric: "tabular-nums"}}>
        {value}
      </text>
      {sub ? (
        <text x={14} y={62} fontFamily={type.sans} fontSize={typeScale.labelSmall} fill={palette.text.inkSoft}>
          {sub}
        </text>
      ) : null}
    </g>
  );
};

/* -------------------------------------------------------------------------- */
/* ResultBadge — large outcome chip (goal, blocked, saved, on-target, ...)    */
/* -------------------------------------------------------------------------- */

export type ResultBadgeProps = PrimitiveBase & {
  at: {x: number; y: number};
  label: string;
  outcome: string;
  band?: "good" | "ok" | "bad";
  width?: number;
};

export const ResultBadge: React.FC<ResultBadgeProps> = ({
  progress,
  at,
  label,
  outcome,
  band = "ok",
  width = 260,
}) => {
  const color = bandHex(band);
  const t = easeOutQuart(progress);
  const opacity = t;
  const yShift = (1 - t) * 8;

  return (
    <g transform={`translate(${at.x}, ${at.y + yShift})`} opacity={opacity}>
      <rect x={0} y={0} width={width} height={66} rx={8} fill={palette.canvas.panelStrong} stroke={color} strokeOpacity={0.7} strokeWidth={1.25} />
      <text x={16} y={22} fontFamily={type.sans} fontSize={typeScale.eyebrow} fill={palette.text.inkMuted} letterSpacing="1.3px">
        {label.toUpperCase()}
      </text>
      <text x={16} y={50} fontFamily={type.sans} fontSize={26} fontWeight={600} fill={color}>
        {outcome}
      </text>
    </g>
  );
};

/* -------------------------------------------------------------------------- */
/* ScoreDial — radial gauge 0..1 with good/ok/bad band                        */
/* -------------------------------------------------------------------------- */

export type ScoreDialProps = PrimitiveBase & {
  at: {x: number; y: number};
  /** Value 0..1. */
  value: number;
  /** Optional band override; otherwise derived from value. */
  band?: "good" | "ok" | "bad";
  label: string;
  /** Numeric overlay (e.g., "0.78"). */
  numericText?: string;
  size?: number;
};

export const ScoreDial: React.FC<ScoreDialProps> = ({
  progress,
  at,
  value,
  band,
  label,
  numericText,
  size = 140,
}) => {
  const v = clamp01(value);
  const derivedBand: "good" | "ok" | "bad" = band ?? (v >= 0.7 ? "good" : v >= 0.45 ? "ok" : "bad");
  const color = bandHex(derivedBand);
  const t = easeOutQuart(progress);

  const cx = size / 2;
  const cy = size / 2 + 8;
  const radius = size * 0.36;
  const startAngle = Math.PI * 0.75;
  const endAngle = Math.PI * 2.25;
  const totalSweep = endAngle - startAngle;
  const filledSweep = totalSweep * v * t;
  const filledEnd = startAngle + filledSweep;

  const polar = (a: number, r: number) => ({x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r});
  const trackStart = polar(startAngle, radius);
  const trackEnd = polar(endAngle, radius);
  const filledP0 = trackStart;
  const filledP1 = polar(filledEnd, radius);

  const largeArcTrack = totalSweep > Math.PI ? 1 : 0;
  const largeArcFilled = filledSweep > Math.PI ? 1 : 0;

  const trackPath = `M ${trackStart.x} ${trackStart.y} A ${radius} ${radius} 0 ${largeArcTrack} 1 ${trackEnd.x} ${trackEnd.y}`;
  const filledPath = filledSweep > 0.01
    ? `M ${filledP0.x} ${filledP0.y} A ${radius} ${radius} 0 ${largeArcFilled} 1 ${filledP1.x} ${filledP1.y}`
    : null;

  return (
    <g transform={`translate(${at.x}, ${at.y})`}>
      <rect x={0} y={0} width={size} height={size + 28} rx={10} fill={palette.canvas.panelStrong} stroke={palette.canvas.panelBorder} strokeWidth={1} />
      <text x={cx} y={20} textAnchor="middle" fontFamily={type.sans} fontSize={typeScale.eyebrow} fill={palette.text.inkMuted} letterSpacing="1.3px">
        {label.toUpperCase()}
      </text>
      <path d={trackPath} stroke={palette.text.inkFaint} strokeWidth={9} fill="none" strokeLinecap="round" />
      {filledPath ? (
        <path d={filledPath} stroke={color} strokeWidth={9} fill="none" strokeLinecap="round" />
      ) : null}
      <text
        x={cx}
        y={cy + 8}
        textAnchor="middle"
        fontFamily={type.mono}
        fontSize={28}
        fill={color}
        style={{fontVariantNumeric: "tabular-nums"}}
      >
        {numericText ?? v.toFixed(2)}
      </text>
      <text
        x={cx}
        y={size + 18}
        textAnchor="middle"
        fontFamily={type.sans}
        fontSize={typeScale.labelSmall}
        fill={palette.text.inkSoft}
      >
        {derivedBand.toUpperCase()}
      </text>
    </g>
  );
};
