import React from "react";
import {palette, polarityHex, stroke as strokeTokens, type, typeScale} from "../style/tokens";
import {
  clamp01,
  easeOutQuart,
  type PrimitiveBase,
  type ScreenPoint,
} from "./types";

/* -------------------------------------------------------------------------- */
/* ZoneRing — a circular ground ring centered at an anchor                    */
/* -------------------------------------------------------------------------- */

export type ZoneRingProps = PrimitiveBase & {
  center: ScreenPoint;
  /** Final radius (px). */
  radius: number;
  /** Optional ellipse y-radius (for perspective). Defaults to radius * 0.35. */
  radiusY?: number;
  label?: string;
};

export const ZoneRing: React.FC<ZoneRingProps> = ({
  progress,
  center,
  radius,
  radiusY,
  label,
  polarity = "neutral",
  scale = "standard",
}) => {
  const color = polarityHex(polarity);
  const sw = scale === "hero" ? strokeTokens.ringHero : strokeTokens.ringStandard;
  const t = easeOutQuart(progress);
  const ry = (radiusY ?? radius * 0.35) * t;
  const rx = radius * t;

  return (
    <g>
      <ellipse
        cx={center.x}
        cy={center.y}
        rx={rx}
        ry={ry}
        fill={color}
        fillOpacity={0.10}
        stroke={color}
        strokeWidth={sw}
        strokeOpacity={0.85}
      />
      {label && t > 0.6 ? (
        <text
          x={center.x}
          y={center.y - ry - 10}
          textAnchor="middle"
          fontFamily={type.sans}
          fontSize={typeScale.labelSmall}
          fill={palette.text.inkSoft}
          opacity={clamp01((t - 0.6) * 2.5)}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
};

/* -------------------------------------------------------------------------- */
/* PressureZone — expanding red disc + ring on the pitch, with defender capture
 * Defenders inside the current radius get a pulse ring + count chip ticks.
 * -------------------------------------------------------------------------- */

export type PressureDefender = {
  position: ScreenPoint;
  /** Distance from center in metres (used for capture sort order). */
  distance: number;
};

export type PressureZoneProps = PrimitiveBase & {
  center: ScreenPoint;
  /** Final radius in px. */
  finalRadius: number;
  /** Final ellipse y-radius (perspective). Defaults to finalRadius * 0.42. */
  finalRadiusY?: number;
  /** Defenders to capture as the ring expands (already in screen coords). */
  defenders: PressureDefender[];
  /** Pressure scalar value (e.g. 0.95). */
  pressureValue?: number;
  /** Unique id for gradient defs. */
  uid: string;
};

export const PressureZone: React.FC<PressureZoneProps> = ({
  progress,
  center,
  finalRadius,
  finalRadiusY,
  defenders,
  pressureValue,
  uid,
}) => {
  const t = easeOutQuart(progress);
  const rx = finalRadius * t;
  const ry = (finalRadiusY ?? finalRadius * 0.42) * t;

  // Sort defenders by distance (closest first); a defender is "captured" once
  // the ring reaches its distance.
  const sorted = [...defenders].sort((a, b) => a.distance - b.distance);
  const maxDistance = sorted.length > 0 ? sorted[sorted.length - 1].distance : 1;
  const captured = sorted.filter((d) => {
    // capture if ring radius >= defender distance (scaled to px)
    const captureT = d.distance / maxDistance;
    return t >= captureT;
  });
  const capturedCount = captured.length;

  const gradId = `pressureFill-${uid}`;
  const ringColor = palette.accent.coral;

  return (
    <g>
      <defs>
        <radialGradient id={gradId} cx={center.x} cy={center.y} r={Math.max(rx, ry)} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={ringColor} stopOpacity="0.22" />
          <stop offset="60%" stopColor={ringColor} stopOpacity="0.10" />
          <stop offset="100%" stopColor={ringColor} stopOpacity="0.02" />
        </radialGradient>
      </defs>
      <ellipse
        cx={center.x}
        cy={center.y}
        rx={rx}
        ry={ry}
        fill={`url(#${gradId})`}
      />
      <ellipse
        cx={center.x}
        cy={center.y}
        rx={rx}
        ry={ry}
        fill="none"
        stroke={ringColor}
        strokeWidth={2}
        strokeOpacity={0.85}
      />

      {/* Captured defenders: pulse ring + number chip */}
      {captured.map((d, i) => {
        const number = i + 1;
        return (
          <g key={`def-${i}`}>
            <circle
              cx={d.position.x}
              cy={d.position.y}
              r={10}
              fill="none"
              stroke={palette.accent.primary}
              strokeWidth={2}
              opacity={0.95}
            />
            <circle
              cx={d.position.x}
              cy={d.position.y}
              r={4}
              fill={palette.accent.primary}
              opacity={0.9}
            />
            <g transform={`translate(${d.position.x + 14}, ${d.position.y - 16})`}>
              <circle cx={0} cy={0} r={11} fill={palette.canvas.panel} stroke={palette.canvas.panelBorder} strokeWidth={1} />
              <text
                x={0}
                y={4}
                textAnchor="middle"
                fontFamily={type.mono}
                fontSize={13}
                fill={palette.text.ink}
                style={{fontVariantNumeric: "tabular-nums"}}
              >
                {number}
              </text>
            </g>
          </g>
        );
      })}

      {/* Count + value chip — sits below the zone so it never clips on narrow panels */}
      {t > 0.4 ? (
        <g
          transform={`translate(${center.x - 90}, ${center.y + ry + 14})`}
          opacity={clamp01((t - 0.4) * 2)}
        >
          <rect x={0} y={0} width={180} height={50} rx={6} fill={palette.canvas.panelStrong} stroke={ringColor} strokeOpacity={0.55} strokeWidth={1} />
          <text
            x={14}
            y={20}
            fontFamily={type.sans}
            fontSize={typeScale.eyebrow}
            fill={palette.text.inkMuted}
            letterSpacing="1.3px"
          >
            PRESSURE
          </text>
          <text
            x={14}
            y={42}
            fontFamily={type.mono}
            fontSize={18}
            fill={ringColor}
            style={{fontVariantNumeric: "tabular-nums"}}
          >
            {pressureValue !== undefined ? pressureValue.toFixed(2) : "—"} · {capturedCount} def.
          </text>
        </g>
      ) : null}
    </g>
  );
};

/* -------------------------------------------------------------------------- */
/* LaneZone — wedge from a vertex (shooter) to two endpoint rays (goalposts). */
/* -------------------------------------------------------------------------- */

export type LaneZoneProps = PrimitiveBase & {
  vertex: ScreenPoint;
  leftPoint: ScreenPoint;
  rightPoint: ScreenPoint;
  /** Unique id for fill gradient. */
  uid: string;
  label?: string;
};

export const LaneZone: React.FC<LaneZoneProps> = ({
  progress,
  vertex,
  leftPoint,
  rightPoint,
  label,
  polarity = "neutral",
  uid,
}) => {
  const t = easeOutQuart(progress);
  // Sweep from the bisector outward to both edges.
  const midX = (leftPoint.x + rightPoint.x) / 2;
  const midY = (leftPoint.y + rightPoint.y) / 2;
  const lx = midX + (leftPoint.x - midX) * t;
  const ly = midY + (leftPoint.y - midY) * t;
  const rx = midX + (rightPoint.x - midX) * t;
  const ry = midY + (rightPoint.y - midY) * t;

  const color = polarityHex(polarity);
  const gradId = `laneFill-${uid}`;
  const wedgePath = `M ${vertex.x} ${vertex.y} L ${lx} ${ly} L ${rx} ${ry} Z`;

  return (
    <g>
      <defs>
        <linearGradient id={gradId} x1={vertex.x} y1={vertex.y} x2={midX} y2={midY} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={color} stopOpacity="0.05" />
          <stop offset="100%" stopColor={color} stopOpacity="0.22" />
        </linearGradient>
      </defs>
      <path d={wedgePath} fill={`url(#${gradId})`} />
      <line x1={vertex.x} y1={vertex.y} x2={lx} y2={ly} stroke={color} strokeWidth={2} strokeOpacity={0.85} strokeLinecap="round" />
      <line x1={vertex.x} y1={vertex.y} x2={rx} y2={ry} stroke={color} strokeWidth={2} strokeOpacity={0.85} strokeLinecap="round" />
      {label && t > 0.55 ? (
        <text
          x={midX * t + vertex.x * (1 - t)}
          y={midY * t + vertex.y * (1 - t)}
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
/* TargetLane — rectangular corridor along a shot direction                   */
/* -------------------------------------------------------------------------- */

export type TargetLaneProps = PrimitiveBase & {
  start: ScreenPoint;
  end: ScreenPoint;
  /** Corridor width in px. */
  width: number;
  uid: string;
  label?: string;
};

export const TargetLane: React.FC<TargetLaneProps> = ({
  progress,
  start,
  end,
  width,
  label,
  polarity = "neutral",
  uid,
}) => {
  const t = easeOutQuart(progress);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const ang = Math.atan2(dy, dx);
  const px = -Math.sin(ang);
  const py = Math.cos(ang);
  const half = width / 2;
  const endX = start.x + dx * t;
  const endY = start.y + dy * t;

  const s1 = {x: start.x + px * half, y: start.y + py * half};
  const s2 = {x: start.x - px * half, y: start.y - py * half};
  const e1 = {x: endX + px * half, y: endY + py * half};
  const e2 = {x: endX - px * half, y: endY - py * half};
  const corridorPath = `M ${s1.x} ${s1.y} L ${e1.x} ${e1.y} L ${e2.x} ${e2.y} L ${s2.x} ${s2.y} Z`;

  const color = polarityHex(polarity);
  const gradId = `corridor-${uid}`;

  return (
    <g>
      <defs>
        <linearGradient id={gradId} x1={start.x} y1={start.y} x2={endX} y2={endY} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={color} stopOpacity="0.03" />
          <stop offset="100%" stopColor={color} stopOpacity="0.20" />
        </linearGradient>
      </defs>
      <path d={corridorPath} fill={`url(#${gradId})`} />
      <line x1={s1.x} y1={s1.y} x2={e1.x} y2={e1.y} stroke={color} strokeWidth={1.5} strokeOpacity={0.7} strokeDasharray="6 4" />
      <line x1={s2.x} y1={s2.y} x2={e2.x} y2={e2.y} stroke={color} strokeWidth={1.5} strokeOpacity={0.7} strokeDasharray="6 4" />
      {label && t > 0.5 ? (
        <text
          x={(start.x + endX) / 2}
          y={(start.y + endY) / 2 - half - 8}
          textAnchor="middle"
          fontFamily={type.sans}
          fontSize={typeScale.labelSmall}
          fill={palette.text.inkSoft}
          opacity={clamp01((t - 0.5) * 2.5)}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
};
