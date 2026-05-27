import React from "react";
import {bandHex, palette, type, typeScale} from "../style/tokens";
import {clamp01, easeOutQuart, type PrimitiveBase} from "./types";

/* -------------------------------------------------------------------------- */
/* PhaseHeader — top-strip banner: phase number + name + BSQ weight + progress
 * -------------------------------------------------------------------------- */

export type PhaseHeaderProps = PrimitiveBase & {
  width: number;
  /** e.g. "P3" */
  phaseCode: string;
  /** e.g. "Backswing" */
  phaseName: string;
  /** e.g. "Coil — hips and shoulders separate before release." */
  tagline?: string;
  /** Phase contribution weight 0..1 (e.g. 0.20 for P3). */
  weight: number;
  /** Overall video progress 0..1 across all phases. */
  overallProgress?: number;
};

export const PhaseHeader: React.FC<PhaseHeaderProps> = ({
  progress,
  width,
  phaseCode,
  phaseName,
  tagline,
  weight,
  overallProgress = 0,
}) => {
  const t = easeOutQuart(progress);
  const xShift = (1 - t) * -40;
  const opacity = t;
  const h = 96;

  return (
    <g opacity={opacity} transform={`translate(0, ${(1 - t) * -10})`}>
      <rect x={0} y={0} width={width} height={h} fill={palette.canvas.panelStrong} />
      <rect x={0} y={h - 3} width={width} height={3} fill={palette.canvas.panelBorder} />
      <rect x={0} y={h - 3} width={width * clamp01(overallProgress)} height={3} fill={palette.accent.primary} />
      <g transform={`translate(${48 + xShift}, 0)`}>
        <text x={0} y={42} fontFamily={type.mono} fontSize={36} fill={palette.accent.primary} style={{fontVariantNumeric: "tabular-nums"}}>
          {phaseCode}
        </text>
        <text x={88} y={42} fontFamily={type.serifTitle} fontSize={typeScale.phaseTitle} fontWeight={600} fill={palette.text.ink}>
          {phaseName}
        </text>
      </g>
      <g transform={`translate(${48 + xShift}, 0)`} opacity={clamp01((t - 0.4) * 2)}>
        {tagline ? (
          <text x={0} y={74} fontFamily={type.sans} fontSize={typeScale.labelSmall} fill={palette.text.inkSoft}>
            {tagline}
          </text>
        ) : null}
      </g>
      <g transform={`translate(${width - 220}, 24)`}>
        <text x={0} y={14} fontFamily={type.sans} fontSize={typeScale.eyebrow} fill={palette.text.inkMuted} letterSpacing="1.4px">
          PHASE WEIGHT
        </text>
        <text x={0} y={50} fontFamily={type.mono} fontSize={32} fill={palette.text.ink} style={{fontVariantNumeric: "tabular-nums"}}>
          {Math.round(weight * 100)}%
        </text>
      </g>
    </g>
  );
};

/* -------------------------------------------------------------------------- */
/* ShotCard — full-screen pre-roll slate                                       */
/* -------------------------------------------------------------------------- */

export type ShotCardProps = PrimitiveBase & {
  width: number;
  height: number;
  player: string;
  jersey?: string | number;
  team: string;
  teamColor?: string;
  match: string;
  matchSub?: string;
  family: string;
  foot?: string;
  pressure?: string;
  xg?: string;
  outcome?: string;
  shotValue?: string;
};

export const ShotCard: React.FC<ShotCardProps> = ({
  progress,
  width,
  height,
  player,
  jersey,
  team,
  teamColor = palette.team.homeStripe,
  match,
  matchSub,
  family,
  foot,
  pressure,
  xg,
  outcome,
  shotValue,
}) => {
  const t = easeOutQuart(progress);
  const headerOpacity = clamp01(t * 1.4);
  const chipsT = clamp01((t - 0.25) * 1.6);

  // Centered card geometry
  const cardW = Math.min(width - 200, 1380);
  const cardH = 520;
  const cardX = (width - cardW) / 2;
  const cardY = (height - cardH) / 2 - 20;

  const chipW = 240;
  const chipH = 78;
  const chipGap = 16;
  const chipsPerRow = 4;
  const chipsTotalW = chipsPerRow * chipW + (chipsPerRow - 1) * chipGap;
  const chipsX = cardX + (cardW - chipsTotalW) / 2;
  const chipsTopY = cardY + cardH - 200;

  type Chip = {label: string; value: string};
  const chips: Chip[] = [
    {label: "FAMILY", value: family},
    {label: "FOOT", value: foot ?? "—"},
    {label: "PRESSURE", value: pressure ?? "—"},
    {label: "xG", value: xg ?? "—"},
    {label: "MATCH", value: matchSub ?? "—"},
    {label: "OUTCOME", value: outcome ?? "—"},
    {label: "SHOT VALUE", value: shotValue ?? "—"},
    {label: "JERSEY", value: jersey ? `#${jersey}` : "—"},
  ];

  return (
    <g>
      <rect x={0} y={0} width={width} height={height} fill={palette.canvas.background} />

      {/* eyebrow */}
      <g opacity={headerOpacity} transform={`translate(${width / 2}, ${cardY + 56})`}>
        <text
          x={0}
          y={0}
          textAnchor="middle"
          fontFamily={type.sans}
          fontSize={typeScale.eyebrow}
          letterSpacing="3.2px"
          fill={palette.accent.primary}
        >
          BALL-STRIKE QUALITY · SHOT BREAKDOWN
        </text>
      </g>

      {/* player name */}
      <g opacity={headerOpacity} transform={`translate(${width / 2}, ${cardY + 140})`}>
        <text
          x={0}
          y={0}
          textAnchor="middle"
          fontFamily={type.serifTitle}
          fontSize={typeScale.title}
          fontWeight={600}
          fill={palette.text.ink}
          letterSpacing="0.2px"
        >
          {player}
        </text>
      </g>

      {/* team + color stripe */}
      <g opacity={chipsT} transform={`translate(${width / 2}, ${cardY + 195})`}>
        <rect x={-80} y={-3} width={160} height={2} fill={teamColor} />
        <text
          x={0}
          y={26}
          textAnchor="middle"
          fontFamily={type.sans}
          fontSize={typeScale.label}
          fill={palette.text.inkSoft}
          letterSpacing="1.4px"
        >
          {team.toUpperCase()}
        </text>
      </g>

      {/* match line */}
      <g opacity={chipsT} transform={`translate(${width / 2}, ${cardY + 260})`}>
        <text
          x={0}
          y={0}
          textAnchor="middle"
          fontFamily={type.sans}
          fontSize={typeScale.labelSmall}
          fill={palette.text.inkMuted}
          letterSpacing="1.0px"
        >
          {match}
        </text>
      </g>

      {/* chips */}
      {chips.map((c, i) => {
        const row = Math.floor(i / chipsPerRow);
        const col = i % chipsPerRow;
        const chipX = chipsX + col * (chipW + chipGap);
        const chipY = chipsTopY + row * (chipH + chipGap);
        const cascadeT = clamp01((t - 0.35 - i * 0.04) * 2.5);
        const yShift = (1 - cascadeT) * 14;
        return (
          <g key={c.label} transform={`translate(${chipX}, ${chipY + yShift})`} opacity={cascadeT}>
            <rect x={0} y={0} width={chipW} height={chipH} rx={8} fill={palette.canvas.panelStrong} stroke={palette.canvas.panelBorder} strokeWidth={1} />
            <text x={16} y={24} fontFamily={type.sans} fontSize={typeScale.eyebrow} letterSpacing="1.5px" fill={palette.text.inkMuted}>
              {c.label}
            </text>
            <text x={16} y={56} fontFamily={type.mono} fontSize={22} fill={palette.text.ink} style={{fontVariantNumeric: "tabular-nums"}}>
              {c.value}
            </text>
          </g>
        );
      })}
    </g>
  );
};

/* -------------------------------------------------------------------------- */
/* VerdictSlate — closing slate with BSQ + phase stacked bar + verdict band   */
/* -------------------------------------------------------------------------- */

export type PhaseContribution = {
  code: string;
  name: string;
  weight: number;
  score: number;
  band: "good" | "ok" | "bad";
};

export type VerdictSlateProps = PrimitiveBase & {
  width: number;
  height: number;
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

export const VerdictSlate: React.FC<VerdictSlateProps> = ({
  progress,
  width,
  height,
  bsq,
  band,
  technique,
  techniqueBand,
  positioning,
  positioningBand,
  phases,
  scoreline,
  scorelineSub,
}) => {
  const t = easeOutQuart(progress);
  const headerOpacity = clamp01(t * 1.4);
  const barT = clamp01((t - 0.2) * 1.8);
  const sideT = clamp01((t - 0.45) * 2.2);
  const footerT = clamp01((t - 0.6) * 2.5);

  const color = bandHex(band);

  const centerX = width / 2;
  const bsqY = 230;
  const barY = 460;
  const barW = 1240;
  const barX = (width - barW) / 2;
  const barH = 40;
  const totalWeight = phases.reduce((acc, p) => acc + p.weight, 0) || 1;

  let cursor = 0;
  const segments = phases.map((p) => {
    const w = (p.weight / totalWeight) * barW;
    const seg = {x: barX + cursor, w, p};
    cursor += w;
    return seg;
  });

  return (
    <g>
      <rect x={0} y={0} width={width} height={height} fill={palette.canvas.background} />

      {/* eyebrow */}
      <g opacity={headerOpacity}>
        <text x={centerX} y={130} textAnchor="middle" fontFamily={type.sans} fontSize={typeScale.eyebrow} letterSpacing="3.2px" fill={palette.accent.primary}>
          BSQ VERDICT
        </text>
      </g>

      {/* BSQ hero number */}
      <g opacity={headerOpacity}>
        <text x={centerX} y={bsqY + 80} textAnchor="middle" fontFamily={type.mono} fontSize={typeScale.hero} fontWeight={600} fill={color} style={{fontVariantNumeric: "tabular-nums"}}>
          {Math.round(bsq)}
        </text>
        <text x={centerX} y={bsqY + 130} textAnchor="middle" fontFamily={type.serifTitle} fontSize={36} fontStyle="italic" fill={palette.text.inkSoft}>
          Strike Quality — {bandLabel(band)}
        </text>
      </g>

      {/* phase stacked bar */}
      <g opacity={barT}>
        <text x={barX} y={barY - 18} fontFamily={type.sans} fontSize={typeScale.eyebrow} letterSpacing="1.5px" fill={palette.text.inkMuted}>
          PHASE CONTRIBUTION
        </text>
        <rect x={barX} y={barY} width={barW} height={barH} rx={4} fill={palette.canvas.panelStrong} stroke={palette.canvas.panelBorder} strokeWidth={1} />
        {segments.map((s) => {
          const fill = bandHex(s.p.band);
          const fillW = s.w * barT;
          return (
            <g key={s.p.code}>
              <rect x={s.x} y={barY} width={fillW} height={barH} fill={fill} fillOpacity={0.75} />
              <line x1={s.x + s.w} y1={barY} x2={s.x + s.w} y2={barY + barH} stroke={palette.canvas.panelBorder} strokeWidth={1} />
              <text x={s.x + s.w / 2} y={barY + barH + 22} textAnchor="middle" fontFamily={type.sans} fontSize={typeScale.eyebrow} letterSpacing="0.8px" fill={palette.text.inkMuted}>
                {s.p.code}
              </text>
              <text x={s.x + s.w / 2} y={barY + barH + 42} textAnchor="middle" fontFamily={type.mono} fontSize={16} fill={palette.text.ink} style={{fontVariantNumeric: "tabular-nums"}}>
                {Math.round(s.p.score)}
              </text>
            </g>
          );
        })}
      </g>

      {/* technique + positioning side blocks */}
      <g opacity={sideT}>
        <g transform={`translate(${barX}, ${barY + 110})`}>
          <text x={0} y={14} fontFamily={type.sans} fontSize={typeScale.eyebrow} letterSpacing="1.5px" fill={palette.text.inkMuted}>TECHNIQUE</text>
          <text x={0} y={56} fontFamily={type.mono} fontSize={44} fill={bandHex(techniqueBand)} style={{fontVariantNumeric: "tabular-nums"}}>{Math.round(technique)}</text>
          <text x={0} y={84} fontFamily={type.sans} fontSize={typeScale.labelSmall} fill={palette.text.inkSoft}>{bandLabel(techniqueBand)}</text>
        </g>
        <g transform={`translate(${barX + barW - 220}, ${barY + 110})`}>
          <text x={220} y={14} textAnchor="end" fontFamily={type.sans} fontSize={typeScale.eyebrow} letterSpacing="1.5px" fill={palette.text.inkMuted}>POSITIONING</text>
          <text x={220} y={56} textAnchor="end" fontFamily={type.mono} fontSize={44} fill={bandHex(positioningBand)} style={{fontVariantNumeric: "tabular-nums"}}>{Math.round(positioning)}</text>
          <text x={220} y={84} textAnchor="end" fontFamily={type.sans} fontSize={typeScale.labelSmall} fill={palette.text.inkSoft}>{bandLabel(positioningBand)}</text>
        </g>
      </g>

      {/* scoreline footer */}
      <g opacity={footerT} transform={`translate(${centerX}, ${height - 80})`}>
        <text x={0} y={0} textAnchor="middle" fontFamily={type.sans} fontSize={typeScale.label} fill={palette.text.inkSoft} letterSpacing="1.0px">
          {scoreline}
        </text>
        {scorelineSub ? (
          <text x={0} y={26} textAnchor="middle" fontFamily={type.sans} fontSize={typeScale.eyebrow} letterSpacing="1.5px" fill={palette.text.inkMuted}>
            {scorelineSub}
          </text>
        ) : null}
      </g>
    </g>
  );
};

function bandLabel(b: "good" | "ok" | "bad"): string {
  if (b === "good") return "GOOD";
  if (b === "bad") return "BELOW PAR";
  return "OK";
}
