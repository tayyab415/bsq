/**
 * Telestration vocabulary derived from the AGY video analysis
 * (see derived/agy-video-analysis-report.md). The *motion + shape* language
 * comes from the reference video; the *color identity* is ours (cyan-primary,
 * polarity-driven good/ok/bad), not Statsbomb orange.
 *
 *  • RangeRing — concentric ground-plane arcs (distance contours from a target).
 *  • HeightArrow — vertical double-headed arrow with limit bars + value chip.
 *  • TrajectoryArc — glowing parabolic shot trajectory line.
 *
 * Bloom filter ids must be present in <defs> of the surrounding SVG (call
 * <FilterDefs /> once at the top of the composition).
 */
import React from "react";
import {palette, polarityHex, type, typeScale} from "../style/tokens";
import {bloomForPolarity} from "./filters";
import {clamp01, easeOutQuart, type PrimitiveBase, type ScreenPoint} from "./types";

/* -------------------------------------------------------------------------- */
/* RangeRing — concentric distance arcs                                        */
/* -------------------------------------------------------------------------- */
/**
 * Concentric semi-arcs centered on a target point (typically the goal-mouth
 * midpoint). Each radius gets one arc, fading the further from center.
 *
 * Anim: arcs draw on outward (innermost first, outermost last) with a slight
 * stagger so the rings "expand" together like a sonar ping.
 */
export type RangeRingProps = PrimitiveBase & {
  /** Anchor point (e.g. goal-mouth midpoint screen position). */
  center: ScreenPoint;
  /** Pixel radii of each concentric arc, in order from inner to outer. */
  radii: number[];
  /** Optional text labels matched 1:1 with `radii` (drawn near each arc tip). */
  labels?: string[];
  /** Half-arc start angle in degrees (default -180 = half-circle facing up). */
  startAngleDeg?: number;
  /** Half-arc sweep in degrees (default 180 = full semicircle). */
  sweepAngleDeg?: number;
  /** Vertical squash for ground perspective (0..1, 1 = circle). Default 0.30. */
  perspectiveY?: number;
  /** Override color (hex). If omitted, uses polarity color. */
  color?: string;
  /** Show ticks on each arc tip (small dots). */
  showTips?: boolean;
};

export const RangeRing: React.FC<RangeRingProps> = ({
  progress,
  center,
  radii,
  labels,
  startAngleDeg = -180,
  sweepAngleDeg = 180,
  perspectiveY = 0.30,
  color,
  showTips = true,
  polarity = "neutral",
  scale = "standard",
}) => {
  const accentHex = color || polarityHex(polarity);
  const bloom = bloomForPolarity(polarity, false);
  const sw = scale === "hero" ? 2.8 : scale === "subtle" ? 1.2 : 2;

  const a0 = (startAngleDeg * Math.PI) / 180;
  const sweepRad = (sweepAngleDeg * Math.PI) / 180;

  // Stagger arcs so outer rings draw after inner — gives a sonar / expanding feel.
  const N = radii.length;
  return (
    <g>
      {radii.map((r, i) => {
        // Each ring starts a little later than the previous (i / N * 0.4 stagger)
        const ringStart = (i / Math.max(1, N)) * 0.35;
        const ringProgress = clamp01((progress - ringStart) / Math.max(0.001, 1 - ringStart));
        const t = easeOutQuart(ringProgress);
        if (t < 0.01) return null;

        const drawnSweep = sweepRad * t;
        const a1 = a0 + drawnSweep;

        // squash y for ground perspective
        const rx = r;
        const ry = r * perspectiveY;

        const p0 = {x: center.x + Math.cos(a0) * rx, y: center.y + Math.sin(a0) * ry};
        const p1 = {x: center.x + Math.cos(a1) * rx, y: center.y + Math.sin(a1) * ry};
        const largeArc = drawnSweep * (180 / Math.PI) > 180 ? 1 : 0;

        const arcPath = `M ${p0.x} ${p0.y} A ${rx} ${ry} 0 ${largeArc} 1 ${p1.x} ${p1.y}`;

        // Fade outer rings progressively
        const outerFade = 1 - (i / Math.max(1, N)) * 0.55;

        // Tip dot — small marker where the arc terminates
        const tipR = scale === "hero" ? 4 : 3;

        // Label sits past the arc tip on a leader line
        const labelText = labels?.[i];
        const labelOpacity = clamp01((ringProgress - 0.6) * 2.5);
        const lr = rx + 18;
        const lx = center.x + Math.cos(a1) * lr;
        const ly = center.y + Math.sin(a1) * (ry + 18);

        return (
          <g key={i} opacity={outerFade}>
            <path
              d={arcPath}
              stroke={accentHex}
              strokeWidth={sw}
              fill="none"
              strokeLinecap="round"
              filter={bloom}
              opacity={0.95}
            />
            {showTips && t > 0.95 ? (
              <circle cx={p1.x} cy={p1.y} r={tipR} fill={accentHex} filter={bloom} />
            ) : null}
            {labelText && labelOpacity > 0 ? (
              <g transform={`translate(${lx}, ${ly})`} opacity={labelOpacity}>
                <rect
                  x={-((labelText.length * 6) + 10)}
                  y={-11}
                  width={(labelText.length * 7) + 20}
                  height={22}
                  rx={4}
                  fill={palette.canvas.panel}
                />
                <text
                  x={0}
                  y={4}
                  textAnchor="middle"
                  fontFamily={type.mono}
                  fontSize={typeScale.labelSmall}
                  fill={accentHex}
                  style={{fontVariantNumeric: "tabular-nums"}}
                >
                  {labelText}
                </text>
              </g>
            ) : null}
          </g>
        );
      })}
      {/* Center marker (goal-mouth midpoint) */}
      <circle cx={center.x} cy={center.y} r={scale === "hero" ? 5 : 3.5} fill={accentHex} filter={bloom} />
    </g>
  );
};

/* -------------------------------------------------------------------------- */
/* HeightArrow — vertical double-headed arrow with limit caps + value chip     */
/* -------------------------------------------------------------------------- */
/**
 * Vertical arrow with triangular heads at top and bottom, optional horizontal
 * "limit" bars at each end. Used for ball height, contact height, jump height
 * — the Statsbomb "1.18m" callout style.
 *
 * Anim: arrow expands from center outward to both heads, value chip fades in
 * after the lines settle.
 */
export type HeightArrowProps = PrimitiveBase & {
  /** Top point (e.g. ball center). */
  top: ScreenPoint;
  /** Bottom point (e.g. ground projection directly under the ball). */
  bottom: ScreenPoint;
  /** Display value (e.g. "1.18"). */
  value: string;
  /** Unit suffix (e.g. "m" or "feet"). */
  unit?: string;
  /** Optional descriptive label below the value chip. */
  label?: string;
  /** Which side of the arrow the value chip sits on. Default 'right'. */
  chipSide?: "left" | "right" | "center";
  /** Distance from the arrow to the chip center (px). Default 32. */
  chipOffset?: number;
  /** Half-width of the horizontal "limit" caps (px). Default 14. */
  capHalfWidth?: number;
  /** Override color (hex). If omitted, uses polarity color. */
  color?: string;
};

export const HeightArrow: React.FC<HeightArrowProps> = ({
  progress,
  top,
  bottom,
  value,
  unit = "m",
  label,
  chipSide = "right",
  chipOffset = 32,
  capHalfWidth = 14,
  color,
  polarity = "neutral",
  scale = "hero",
}) => {
  const accentHex = color || polarityHex(polarity);
  const bloom = bloomForPolarity(polarity, false);
  const sw = scale === "hero" ? 2.5 : scale === "subtle" ? 1.4 : 2;

  const t = easeOutQuart(progress);
  const mid = {x: (top.x + bottom.x) / 2, y: (top.y + bottom.y) / 2};
  const half = {x: (top.x - bottom.x) / 2, y: (top.y - bottom.y) / 2};
  // Expand outward from midpoint
  const curTop = {x: mid.x + half.x * t, y: mid.y + half.y * t};
  const curBot = {x: mid.x - half.x * t, y: mid.y - half.y * t};

  // Arrow direction (top→bottom). Heads point outward at each end.
  const dx = bottom.x - top.x;
  const dy = bottom.y - top.y;
  const ang = Math.atan2(dy, dx); // along the line, pointing from top to bottom
  const px = -Math.sin(ang);
  const py = Math.cos(ang);

  // Triangular heads — head full width ≈ 3x shaft width (Statsbomb spec)
  const headLen = scale === "hero" ? 14 : 10;
  const headWidth = scale === "hero" ? 9 : 6;

  // Top arrowhead: points AWAY from midpoint, i.e. up-along-line at curTop
  const topBase = {x: curTop.x + Math.cos(ang) * headLen, y: curTop.y + Math.sin(ang) * headLen};
  const topH1 = {x: topBase.x + px * headWidth, y: topBase.y + py * headWidth};
  const topH2 = {x: topBase.x - px * headWidth, y: topBase.y - py * headWidth};
  const topHeadPath = `M ${curTop.x} ${curTop.y} L ${topH1.x} ${topH1.y} L ${topH2.x} ${topH2.y} Z`;

  // Bottom arrowhead: points AWAY from midpoint, i.e. down-along-line at curBot
  const botBase = {x: curBot.x - Math.cos(ang) * headLen, y: curBot.y - Math.sin(ang) * headLen};
  const botH1 = {x: botBase.x + px * headWidth, y: botBase.y + py * headWidth};
  const botH2 = {x: botBase.x - px * headWidth, y: botBase.y - py * headWidth};
  const botHeadPath = `M ${curBot.x} ${curBot.y} L ${botH1.x} ${botH1.y} L ${botH2.x} ${botH2.y} Z`;

  // Cap lines (horizontal limit bars at top and bottom)
  const capTopL = {x: top.x + px * capHalfWidth, y: top.y + py * capHalfWidth};
  const capTopR = {x: top.x - px * capHalfWidth, y: top.y - py * capHalfWidth};
  const capBotL = {x: bottom.x + px * capHalfWidth, y: bottom.y + py * capHalfWidth};
  const capBotR = {x: bottom.x - px * capHalfWidth, y: bottom.y - py * capHalfWidth};
  const capOpacity = clamp01((progress - 0.15) * 2);

  // Value chip
  const valueText = `${value}${unit ? " " + unit : ""}`;
  const labelOpacity = clamp01((progress - 0.55) * 2.5);
  const sideSign = chipSide === "right" ? 1 : chipSide === "left" ? -1 : 0;
  const chipX = chipSide === "center" ? mid.x : mid.x + sideSign * chipOffset;
  const chipY = mid.y;

  return (
    <g>
      {/* Limit caps (always appear early, anchor the measurement visually) */}
      <line
        x1={capTopL.x}
        y1={capTopL.y}
        x2={capTopR.x}
        y2={capTopR.y}
        stroke={accentHex}
        strokeWidth={sw}
        strokeLinecap="round"
        opacity={capOpacity * 0.9}
        filter={bloom}
      />
      <line
        x1={capBotL.x}
        y1={capBotL.y}
        x2={capBotR.x}
        y2={capBotR.y}
        stroke={accentHex}
        strokeWidth={sw}
        strokeLinecap="round"
        opacity={capOpacity * 0.9}
        filter={bloom}
      />
      {/* Shaft (expands from midpoint to both heads) */}
      {t > 0.01 ? (
        <line
          x1={curTop.x}
          y1={curTop.y}
          x2={curBot.x}
          y2={curBot.y}
          stroke={accentHex}
          strokeWidth={sw}
          strokeLinecap="round"
          opacity={0.95}
          filter={bloom}
        />
      ) : null}
      {/* Heads (only when fully drawn) */}
      {t > 0.85 ? (
        <>
          <path d={topHeadPath} fill={accentHex} filter={bloom} />
          <path d={botHeadPath} fill={accentHex} filter={bloom} />
        </>
      ) : null}
      {/* Value chip */}
      {labelOpacity > 0 ? (
        <g opacity={labelOpacity} transform={`translate(${chipX}, ${chipY})`}>
            <rect
              x={chipSide === "center" ? -((valueText.length * 9) + 22) / 2 : chipSide === "right" ? 0 : -((valueText.length * 9) + 22)}
              y={-15}
              width={(valueText.length * 10) + 22}
              height={30}
              rx={4}
              fill={palette.canvas.panel}
              stroke={accentHex}
              strokeOpacity={0.55}
              strokeWidth={1}
            />
          <text
            x={chipSide === "center" ? 0 : chipSide === "right" ? ((valueText.length * 10) + 22) / 2 : -((valueText.length * 9) + 22) / 2}
            y={6}
            textAnchor="middle"
            fontFamily={type.mono}
            fontSize={typeScale.numericStandard + 2}
            fill={accentHex}
            style={{fontVariantNumeric: "tabular-nums", fontWeight: 600}}
            filter={bloom}
          >
            {valueText}
          </text>
          {label ? (
            <text
              x={chipSide === "right" ? ((valueText.length * 10) + 22) / 2 : -((valueText.length * 9) + 22) / 2}
              y={28}
              textAnchor="middle"
              fontFamily={type.sans}
              fontSize={typeScale.labelSmall}
              fill={palette.text.inkSoft}
            >
              {label}
            </text>
          ) : null}
        </g>
      ) : null}
    </g>
  );
};

/* -------------------------------------------------------------------------- */
/* TrajectoryArc — glowing 3D parabolic shot trajectory                        */
/* -------------------------------------------------------------------------- */
/**
 * A bezier-style 3-point arc with apex above midpoint, drawing on from origin
 * to target. Used for shot flight from strike point to goal-mouth coordinate.
 *
 * Distinct from PathTrail (which renders a discrete sample list); TrajectoryArc
 * generates a smooth curve from just start + end + apex height.
 */
export type TrajectoryArcProps = PrimitiveBase & {
  start: ScreenPoint;
  end: ScreenPoint;
  /** Vertical apex height above the mid-line (px). Larger = higher arc. */
  apexHeight: number;
  /** Optional label drawn near the apex. */
  label?: string;
  /** Override color (hex). If omitted, uses polarity color. */
  color?: string;
  /** If true, render bone-glow white instead of polarity color (broadcast trajectory look). */
  bright?: boolean;
};

export const TrajectoryArc: React.FC<TrajectoryArcProps> = ({
  progress,
  start,
  end,
  apexHeight,
  label,
  color,
  bright = true,
  polarity = "neutral",
  scale = "hero",
}) => {
  const accentHex = color || (bright ? palette.subject.boneGlow : polarityHex(polarity));
  const bloom = bright ? "url(#bloomWhite)" : bloomForPolarity(polarity, false);
  const sw = scale === "hero" ? 3 : scale === "subtle" ? 1.5 : 2.2;

  // Quadratic Bezier control point — above the midpoint by `apexHeight`.
  const mid = {x: (start.x + end.x) / 2, y: (start.y + end.y) / 2};
  const ctrl = {x: mid.x, y: mid.y - apexHeight};

  // Sample 64 points along the curve and slice by progress for animated draw-on.
  const N = 64;
  const t = easeOutQuart(progress);
  const visible = Math.max(2, Math.floor(N * t));
  const samples: ScreenPoint[] = [];
  for (let i = 0; i <= visible; i++) {
    const u = i / N;
    const mu = 1 - u;
    const x = mu * mu * start.x + 2 * mu * u * ctrl.x + u * u * end.x;
    const y = mu * mu * start.y + 2 * mu * u * ctrl.y + u * u * end.y;
    samples.push({x, y});
  }

  const path = samples.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");

  // Apex label
  const labelOpacity = clamp01((progress - 0.55) * 2.5);

  return (
    <g>
      <path
        d={path}
        stroke={accentHex}
        strokeWidth={sw}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter={bloom}
        opacity={0.95}
      />
      {/* Head dot at current end */}
      {samples.length > 0 ? (
        <circle
          cx={samples[samples.length - 1].x}
          cy={samples[samples.length - 1].y}
          r={sw + 1.5}
          fill={accentHex}
          filter={bloom}
        />
      ) : null}
      {label && labelOpacity > 0 ? (
        <g transform={`translate(${ctrl.x}, ${ctrl.y - 16})`} opacity={labelOpacity}>
          <rect
            x={-((label.length * 6) + 12)}
            y={-12}
            width={(label.length * 7) + 24}
            height={24}
            rx={4}
            fill={palette.canvas.panel}
          />
          <text
            x={0}
            y={4}
            textAnchor="middle"
            fontFamily={type.sans}
            fontSize={typeScale.labelSmall}
            fill={accentHex}
          >
            {label}
          </text>
        </g>
      ) : null}
    </g>
  );
};
