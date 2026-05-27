import React from "react";
import {palette, polarityHex, stroke as strokeTokens, type, typeScale, shadow} from "../style/tokens";
import {
  clamp01,
  easeOutOvershoot,
  easeOutQuart,
  lerp,
  type LabelProps,
  type PrimitiveBase,
  type ScreenPoint,
} from "./types";

/* -------------------------------------------------------------------------- */
/* DistanceRule — line A→B with tick marks + numeric label at midpoint        */
/* -------------------------------------------------------------------------- */

export type DistanceRuleProps = PrimitiveBase & LabelProps & {
  start: ScreenPoint;
  end: ScreenPoint;
  /** If true, animate with overshoot snap-back (CSV: draw_on_overshoot). */
  overshoot?: boolean;
  /** Optional perpendicular offset for the label (px). */
  labelOffset?: number;
};

export const DistanceRule: React.FC<DistanceRuleProps> = ({
  progress,
  start,
  end,
  value,
  unit = "m",
  label,
  polarity = "neutral",
  scale = "standard",
  overshoot = false,
  labelOffset = 14,
}) => {
  const color = polarityHex(polarity);
  const sw = scale === "hero" ? strokeTokens.hero : scale === "subtle" ? strokeTokens.subtle : strokeTokens.standard;

  const t = overshoot ? easeOutOvershoot(progress) : easeOutQuart(progress);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);

  const drawn = Math.min(1, Math.max(0, t));
  const curX = start.x + dx * drawn;
  const curY = start.y + dy * drawn;

  // perpendicular unit vector for tick marks + label offset
  const px = -Math.sin(ang);
  const py = Math.cos(ang);
  const tickHalf = scale === "hero" ? 8 : scale === "subtle" ? 4 : 6;

  // Label sits at midpoint, offset perpendicular
  const mx = lerp(start.x, end.x, 0.5) + px * labelOffset;
  const my = lerp(start.y, end.y, 0.5) + py * labelOffset;

  const labelOpacity = clamp01((progress - 0.5) * 2);
  const valueText = [value, unit].filter(Boolean).join(" ");

  return (
    <g>
      <line
        x1={start.x}
        y1={start.y}
        x2={curX}
        y2={curY}
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        opacity={0.95}
        filter="url(#dropShadowSubtle)"
      />
      <line
        x1={start.x - px * tickHalf}
        y1={start.y - py * tickHalf}
        x2={start.x + px * tickHalf}
        y2={start.y + py * tickHalf}
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        opacity={drawn > 0.05 ? 0.95 : 0}
      />
      <line
        x1={curX - px * tickHalf}
        y1={curY - py * tickHalf}
        x2={curX + px * tickHalf}
        y2={curY + py * tickHalf}
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        opacity={drawn > 0.95 ? 0.95 : 0}
      />
      {valueText && labelOpacity > 0 ? (
        <g opacity={labelOpacity} transform={`translate(${mx}, ${my})`}>
          <rect
            x={-((valueText.length * 7) + 14)}
            y={-13}
            width={(valueText.length * 8) + 28}
            height={26}
            rx={4}
            fill={palette.canvas.panel}
            stroke={palette.canvas.panelBorder}
            strokeWidth={1}
            style={{filter: "drop-shadow(" + shadow.callout + ")"}}
          />
          <text
            x={0}
            y={5}
            textAnchor="middle"
            fontFamily={type.mono}
            fontSize={typeScale.numericStandard}
            fill={color}
            style={{fontVariantNumeric: "tabular-nums"}}
          >
            {valueText}
          </text>
        </g>
      ) : null}
      {label && labelOpacity > 0.3 ? (
        <text
          x={mx}
          y={my + 24}
          textAnchor="middle"
          fontFamily={type.sans}
          fontSize={typeScale.labelSmall}
          fill={palette.text.inkSoft}
          letterSpacing="0.3px"
          opacity={labelOpacity}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
};

/* -------------------------------------------------------------------------- */
/* AngleArc — two rays + filled wedge + degree label                          */
/* -------------------------------------------------------------------------- */

export type AngleArcProps = PrimitiveBase & LabelProps & {
  vertex: ScreenPoint;
  startAngleDeg: number;
  sweepAngleDeg: number;
  radius?: number;
  /** Draw filled wedge (true) or just the arc line + rays (false). */
  filled?: boolean;
};

export const AngleArc: React.FC<AngleArcProps> = ({
  progress,
  vertex,
  startAngleDeg,
  sweepAngleDeg,
  radius = 90,
  value,
  unit = "deg",
  label,
  polarity = "neutral",
  scale = "standard",
  filled = true,
}) => {
  const color = polarityHex(polarity);
  const sw = scale === "hero" ? strokeTokens.hero : scale === "subtle" ? strokeTokens.subtle : strokeTokens.standard;

  const t = easeOutQuart(progress);
  const drawnSweep = sweepAngleDeg * t;
  const a0 = (startAngleDeg * Math.PI) / 180;
  const a1 = ((startAngleDeg + drawnSweep) * Math.PI) / 180;

  const p0 = {x: vertex.x + Math.cos(a0) * radius, y: vertex.y + Math.sin(a0) * radius};
  const p1 = {x: vertex.x + Math.cos(a1) * radius, y: vertex.y + Math.sin(a1) * radius};
  const largeArc = drawnSweep > 180 ? 1 : 0;

  const wedgePath = `M ${vertex.x} ${vertex.y} L ${p0.x} ${p0.y} A ${radius} ${radius} 0 ${largeArc} 1 ${p1.x} ${p1.y} Z`;
  const arcPath = `M ${p0.x} ${p0.y} A ${radius} ${radius} 0 ${largeArc} 1 ${p1.x} ${p1.y}`;

  // Label sits at bisector, slightly outside the arc
  const aBis = (startAngleDeg + drawnSweep * 0.5) * Math.PI / 180;
  const lr = radius + (scale === "hero" ? 28 : 22);
  const lx = vertex.x + Math.cos(aBis) * lr;
  const ly = vertex.y + Math.sin(aBis) * lr;

  const labelOpacity = clamp01((progress - 0.55) * 2.5);
  const valueText = [value, unit === "deg" ? "°" : unit].filter(Boolean).join("");

  return (
    <g>
      {filled ? (
        <path d={wedgePath} fill={color} fillOpacity={0.16 * t} />
      ) : null}
      <line
        x1={vertex.x}
        y1={vertex.y}
        x2={vertex.x + Math.cos(a0) * radius}
        y2={vertex.y + Math.sin(a0) * radius}
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        opacity={0.95}
      />
      <line
        x1={vertex.x}
        y1={vertex.y}
        x2={p1.x}
        y2={p1.y}
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        opacity={0.95}
      />
      {drawnSweep > 1 ? (
        <path d={arcPath} stroke={color} strokeWidth={sw} fill="none" strokeLinecap="round" opacity={0.95} />
      ) : null}
      {valueText && labelOpacity > 0 ? (
        <g opacity={labelOpacity} transform={`translate(${lx}, ${ly})`}>
          <rect
            x={-((valueText.length * 7) + 12)}
            y={-13}
            width={(valueText.length * 8) + 24}
            height={26}
            rx={4}
            fill={palette.canvas.panel}
            stroke={palette.canvas.panelBorder}
            strokeWidth={1}
          />
          <text
            x={0}
            y={5}
            textAnchor="middle"
            fontFamily={type.mono}
            fontSize={typeScale.numericStandard}
            fill={color}
            style={{fontVariantNumeric: "tabular-nums"}}
          >
            {valueText}
          </text>
        </g>
      ) : null}
      {label && labelOpacity > 0.3 ? (
        <text
          x={lx}
          y={ly + 24}
          textAnchor="middle"
          fontFamily={type.sans}
          fontSize={typeScale.labelSmall}
          fill={palette.text.inkSoft}
          opacity={labelOpacity}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
};

/* -------------------------------------------------------------------------- */
/* AxisLine — body-axis line (e.g., hip line, shoulder line, torso axis)      */
/* -------------------------------------------------------------------------- */

export type AxisLineProps = PrimitiveBase & {
  start: ScreenPoint;
  end: ScreenPoint;
  /** Hex color override. Defaults to polarity color. */
  color?: string;
  label?: string;
  /** Render with dashed stroke (e.g. reference axis). */
  dashed?: boolean;
  /** Perpendicular distance to push the label off the line (px). Default 32. */
  labelOffset?: number;
  /** Which side of the line the label sits on (+1 or -1). Default +1. */
  labelSide?: 1 | -1;
  /** Where along the line the label is anchored. Default 'mid'. */
  labelAnchor?: "start" | "mid" | "end";
};

export const AxisLine: React.FC<AxisLineProps> = ({
  progress,
  start,
  end,
  color,
  polarity = "neutral",
  scale = "standard",
  label,
  dashed = false,
  labelOffset = 32,
  labelSide = 1,
  labelAnchor = "mid",
}) => {
  const c = color || polarityHex(polarity);
  const sw = scale === "hero" ? strokeTokens.hero : scale === "subtle" ? strokeTokens.subtle : strokeTokens.standard;

  const t = easeOutQuart(progress);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const curX = start.x + dx * t;
  const curY = start.y + dy * t;

  const labelOpacity = clamp01((progress - 0.5) * 2);
  const ang = Math.atan2(dy, dx);
  const px = -Math.sin(ang) * labelSide;
  const py = Math.cos(ang) * labelSide;
  // along-line anchor: 0 = start, 0.5 = mid, 1 = end
  const af = labelAnchor === "start" ? 0 : labelAnchor === "end" ? 1 : 0.5;
  const baseX = start.x + (curX - start.x) * af;
  const baseY = start.y + (curY - start.y) * af;
  // for end-anchor we also push a tad outward along the line so the chip clears the dot
  const alongPush = labelAnchor === "mid" ? 0 : (labelAnchor === "end" ? 14 : -14);
  const lx = baseX + Math.cos(ang) * alongPush + px * labelOffset;
  const ly = baseY + Math.sin(ang) * alongPush + py * labelOffset;

  // Pre-compute label box geometry so we can draw a backdrop chip.
  const labelText = label ?? "";
  const labelW = labelText ? labelText.length * 7 + 18 : 0;
  const labelH = 22;

  return (
    <g>
      <line
        x1={start.x}
        y1={start.y}
        x2={curX}
        y2={curY}
        stroke={c}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={dashed ? "6 4" : undefined}
        opacity={0.92}
      />
      <circle cx={start.x} cy={start.y} r={sw + 1} fill={c} opacity={0.9} />
      <circle cx={curX} cy={curY} r={sw + 1} fill={c} opacity={t > 0.92 ? 0.9 : 0} />
      {labelText && labelOpacity > 0 ? (
        <g transform={`translate(${lx}, ${ly})`} opacity={labelOpacity}>
          <rect
            x={-labelW / 2}
            y={-labelH / 2}
            width={labelW}
            height={labelH}
            rx={4}
            fill={palette.canvas.panel}
            stroke={c}
            strokeOpacity={0.45}
            strokeWidth={1}
          />
          <text
            x={0}
            y={4}
            textAnchor="middle"
            fontFamily={type.sans}
            fontSize={typeScale.labelSmall}
            fill={c}
          >
            {labelText}
          </text>
        </g>
      ) : null}
    </g>
  );
};
