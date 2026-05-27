import React from "react";
import {palette, polarityHex, stroke as strokeTokens, type, typeScale, shadow} from "../style/tokens";
import {
  clamp01,
  easeOutQuart,
  lerp,
  type LabelProps,
  type PrimitiveBase,
  type ScreenPoint,
} from "./types";

/* -------------------------------------------------------------------------- */
/* VelocityArrow — telestration ribbon arrow with gradient + soft glow        */
/* -------------------------------------------------------------------------- */

export type VelocityArrowProps = PrimitiveBase & LabelProps & {
  start: ScreenPoint;
  end: ScreenPoint;
  /** Draw the ribbon thicker at head (broadcast feel). */
  ribbon?: boolean;
  /** Unique id needed for SVG defs (gradient + filter scoping). */
  uid: string;
};

export const VelocityArrow: React.FC<VelocityArrowProps> = ({
  progress,
  start,
  end,
  value,
  unit = "m/s",
  label,
  polarity = "positive",
  scale = "hero",
  ribbon = true,
  uid,
}) => {
  const color = polarityHex(polarity);
  // Slimmer than before — head ~3x shaft width per Statsbomb broadcast style (AGY).
  const sw = scale === "hero" ? 5 : scale === "subtle" ? 2.2 : 3.5;

  const t = easeOutQuart(progress);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const ang = Math.atan2(dy, dx);
  const len = Math.hypot(dx, dy) * t;
  const cx = start.x + Math.cos(ang) * len;
  const cy = start.y + Math.sin(ang) * len;

  // Arrowhead geometry — sharper, smaller, head full-width ≈ 3x shaft full-width.
  const headLen = scale === "hero" ? 18 : scale === "subtle" ? 10 : 14;
  const headWidth = scale === "hero" ? 12 : scale === "subtle" ? 7 : 9;
  const baseX = cx - Math.cos(ang) * headLen;
  const baseY = cy - Math.sin(ang) * headLen;
  const px = -Math.sin(ang);
  const py = Math.cos(ang);
  const h1 = {x: baseX + px * headWidth, y: baseY + py * headWidth};
  const h2 = {x: baseX - px * headWidth, y: baseY - py * headWidth};
  const headPath = `M ${cx} ${cy} L ${h1.x} ${h1.y} L ${h2.x} ${h2.y} Z`;

  // Ribbon shaft (tapered) drawn as quad: thinner at start, thicker near head
  const shaftStart = 1.5;
  const shaftEnd = ribbon ? sw * 0.85 : sw * 0.6;
  const s1 = {x: start.x + px * shaftStart, y: start.y + py * shaftStart};
  const s2 = {x: start.x - px * shaftStart, y: start.y - py * shaftStart};
  const e1 = {x: baseX + px * shaftEnd, y: baseY + py * shaftEnd};
  const e2 = {x: baseX - px * shaftEnd, y: baseY - py * shaftEnd};
  const ribbonPath = `M ${s1.x} ${s1.y} L ${e1.x} ${e1.y} L ${e2.x} ${e2.y} L ${s2.x} ${s2.y} Z`;

  const gradId = `velGrad-${uid}`;
  const labelOpacity = clamp01((progress - 0.6) * 2.5);
  const valueText = [value, unit].filter(Boolean).join(" ");
  const labelX = lerp(start.x, cx, 0.55) + px * 24;
  const labelY = lerp(start.y, cy, 0.55) + py * 24;

  return (
    <g>
      <defs>
        <linearGradient id={gradId} x1={start.x} y1={start.y} x2={cx} y2={cy} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="60%" stopColor={color} stopOpacity="0.85" />
          <stop offset="100%" stopColor={color} stopOpacity="1.0" />
        </linearGradient>
      </defs>
      {t > 0.02 ? (
        <>
          <path d={ribbonPath} fill={`url(#${gradId})`} filter="url(#dropShadowSubtle)" />
          <path d={headPath} fill={color} filter="url(#dropShadowSubtle)" />
        </>
      ) : null}
      {valueText && labelOpacity > 0 ? (
        <g opacity={labelOpacity} transform={`translate(${labelX}, ${labelY})`}>
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
          x={labelX}
          y={labelY + 24}
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
/* PathTrail — fading polyline of past N positions (foot/pelvis/ball)         */
/* -------------------------------------------------------------------------- */

export type PathTrailProps = PrimitiveBase & {
  points: ScreenPoint[];
  /** Unique id for gradient defs. */
  uid: string;
  /** Mark the head of the trail with a dot. */
  showHead?: boolean;
};

export const PathTrail: React.FC<PathTrailProps> = ({
  progress,
  points,
  polarity = "positive",
  scale = "standard",
  showHead = true,
  uid,
}) => {
  if (points.length < 2) return null;
  const color = polarityHex(polarity);
  const sw = scale === "hero" ? strokeTokens.hero : scale === "subtle" ? strokeTokens.subtle : strokeTokens.standard;

  const t = easeOutQuart(progress);
  const visibleCount = Math.max(2, Math.floor(points.length * t));
  const visiblePoints = points.slice(0, visibleCount);

  const path = visiblePoints
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");

  const gradId = `pathGrad-${uid}`;

  return (
    <g>
      <defs>
        <linearGradient id={gradId} x1={points[0].x} y1={points[0].y} x2={points[points.length - 1].x} y2={points[points.length - 1].y} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={color} stopOpacity="0.0" />
          <stop offset="30%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.95" />
        </linearGradient>
      </defs>
      <path
        d={path}
        stroke={`url(#${gradId})`}
        strokeWidth={sw}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#dropShadowSubtle)"
      />
      {showHead && visiblePoints.length > 0 ? (
        <circle
          cx={visiblePoints[visiblePoints.length - 1].x}
          cy={visiblePoints[visiblePoints.length - 1].y}
          r={sw + 1.5}
          fill={color}
          opacity={0.95}
        />
      ) : null}
    </g>
  );
};
