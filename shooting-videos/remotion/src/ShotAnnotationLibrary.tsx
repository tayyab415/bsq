/**
 * Shot Annotation Library — visual swatch (Q12 Step 0).
 *
 * Renders every v3 primitive on a single 1920x1800 canvas with synthetic
 * sample data so we can lock the visual treatment (palette / stroke / typography
 * / animation end-state) before authoring any phase composition.
 *
 * All primitives are driven at progress = 1.0 (animation end state) so the
 * still represents the "settled" look every annotation eventually reaches.
 */
import React from "react";
import {AbsoluteFill, useVideoConfig} from "remotion";
import {palette, type, typeScale, shadow as shadowToken} from "./style/tokens";
import {
  AngleArc,
  AxisLine,
  ContextBadge,
  DistanceRule,
  FilterDefs,
  GhostSkeleton,
  HeightArrow,
  LaneZone,
  PathTrail,
  PhaseHeader,
  PlayerSpotlight,
  PoseSticker,
  PressureZone,
  DefenderGhost,
  ImpactShockwave,
  KeeperSpotlightCylinder,
  PressureWedgeCorridor,
  RangeRing,
  ResultBadge,
  ScoreDial,
  ShotCard,
  TargetLane,
  TrajectoryArc,
  VelocityArrow,
  VerdictSlate,
  ZoneRing,
  type ScreenPoint,
  type SkeletonJoints,
} from "./primitives";

export const SWATCH_WIDTH = 1920;
export const SWATCH_HEIGHT = 2520;

const Panel: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  csvName?: string;
  scale?: "hero" | "standard" | "subtle";
  layer?: "screen_2d" | "hybrid";
  children: React.ReactNode;
}> = ({x, y, w, h, title, csvName, scale, layer, children}) => {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        background: palette.canvas.pitchBase,
        border: `1px solid ${palette.canvas.panelBorder}`,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Panel chrome */}
      <div
        style={{
          position: "absolute",
          left: 14,
          top: 12,
          right: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 2,
        }}
      >
        <div style={{display: "flex", flexDirection: "column"}}>
          <div
            style={{
              fontFamily: type.sans,
              fontSize: typeScale.eyebrow,
              letterSpacing: "1.4px",
              color: palette.text.inkMuted,
            }}
          >
            {title.toUpperCase()}
          </div>
          {csvName ? (
            <div
              style={{
                fontFamily: type.mono,
                fontSize: typeScale.labelSmall,
                color: palette.accent.primary,
                marginTop: 4,
              }}
            >
              {csvName}
            </div>
          ) : null}
        </div>
        <div style={{display: "flex", gap: 8}}>
          {scale ? (
            <Chip text={scale.toUpperCase()} color={
              scale === "hero" ? palette.band.good : scale === "subtle" ? palette.text.inkMuted : palette.accent.amber
            } />
          ) : null}
          {layer ? (
            <Chip text={layer === "hybrid" ? "HYBRID" : "SVG"} color={layer === "hybrid" ? palette.accent.violet : palette.accent.primary} />
          ) : null}
        </div>
      </div>

      {/* Mini-pitch baseline (visual context) */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        style={{position: "absolute", left: 0, top: 0}}
      >
        <defs>
          <filter id={`dropShadowSubtle-${title.replace(/\s/g, "")}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" />
            <feOffset dx="0" dy="1.5" result="offsetblur" />
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.45" />
            </feComponentTransfer>
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {children}
      </svg>
    </div>
  );
};

const Chip: React.FC<{text: string; color: string}> = ({text, color}) => (
  <div
    style={{
      fontFamily: type.sans,
      fontSize: typeScale.eyebrow,
      letterSpacing: "1.2px",
      color: color,
      border: `1px solid ${color}55`,
      borderRadius: 999,
      padding: "3px 9px",
      background: "rgba(14,17,22,0.6)",
    }}
  >
    {text}
  </div>
);

/* ----------------------------- mock skeleton ----------------------------- */
// Synthetic side-view shooter (mid-backswing) used by primitives needing joints.
const makeMockShooter = (cx: number, cy: number, scale = 1): SkeletonJoints => {
  const s = scale;
  return {
    nose:           {x: cx - 4 * s,  y: cy - 165 * s},
    neck:           {x: cx - 2 * s,  y: cy - 140 * s},
    left_shoulder:  {x: cx + 12 * s, y: cy - 130 * s},
    right_shoulder: {x: cx - 16 * s, y: cy - 130 * s},
    left_elbow:     {x: cx + 22 * s, y: cy - 90 * s},
    right_elbow:    {x: cx - 32 * s, y: cy - 80 * s},
    left_wrist:     {x: cx + 18 * s, y: cy - 50 * s},
    right_wrist:    {x: cx - 48 * s, y: cy - 50 * s},
    pelvis:         {x: cx + 0  * s, y: cy - 80 * s},
    left_hip:       {x: cx + 12 * s, y: cy - 78 * s},
    right_hip:      {x: cx - 12 * s, y: cy - 78 * s},
    left_knee:      {x: cx + 28 * s, y: cy - 30 * s},
    right_knee:     {x: cx - 20 * s, y: cy - 36 * s},
    left_ankle:     {x: cx + 38 * s, y: cy + 10 * s},
    right_ankle:    {x: cx - 30 * s, y: cy + 20 * s},
    left_toe:       {x: cx + 52 * s, y: cy + 14 * s},
    right_toe:      {x: cx - 48 * s, y: cy + 22 * s},
  };
};

// Variant pose: peak coil — shoulders rotated further back.
const makeMockShooterPeak = (cx: number, cy: number, scale = 1): SkeletonJoints => {
  const s = scale;
  return {
    nose:           {x: cx - 12 * s, y: cy - 165 * s},
    neck:           {x: cx - 8 * s,  y: cy - 140 * s},
    left_shoulder:  {x: cx + 4 * s,  y: cy - 132 * s},
    right_shoulder: {x: cx - 30 * s, y: cy - 128 * s},
    left_elbow:     {x: cx + 14 * s, y: cy - 90 * s},
    right_elbow:    {x: cx - 50 * s, y: cy - 70 * s},
    left_wrist:     {x: cx + 6 * s,  y: cy - 50 * s},
    right_wrist:    {x: cx - 70 * s, y: cy - 40 * s},
    pelvis:         {x: cx + 0  * s, y: cy - 80 * s},
    left_hip:       {x: cx + 10 * s, y: cy - 78 * s},
    right_hip:      {x: cx - 14 * s, y: cy - 78 * s},
    left_knee:      {x: cx + 22 * s, y: cy - 30 * s},
    right_knee:     {x: cx - 22 * s, y: cy - 36 * s},
    left_ankle:     {x: cx + 30 * s, y: cy + 10 * s},
    right_ankle:    {x: cx - 32 * s, y: cy + 20 * s},
    left_toe:       {x: cx + 44 * s, y: cy + 14 * s},
    right_toe:      {x: cx - 50 * s, y: cy + 22 * s},
  };
};

/* ============================ main composition ============================ */

export const ShotAnnotationLibrary: React.FC = () => {
  const cfg = useVideoConfig();
  const W = cfg.width;
  const H = cfg.height;
  const progress = 1; // settled end state — swatch shows what every annotation "lands on"

  /* layout grid (1920 x 1800) ----------------------------------------------- */
  const titleH = 70;
  const headerY = titleH + 24;
  const headerH = 110;
  const bookendsY = headerY + headerH + 24;
  const bookendH = 400;
  const row1Y = bookendsY + bookendH + 24;
  const rowH = 340;
  const row2Y = row1Y + rowH + 16;
  const row3Y = row2Y + rowH + 16;

  const row4Y = row3Y + rowH + 16;
  const row5Y = row4Y + rowH + 16;
  const colCount = 4;
  const colGap = 16;
  const sideGutter = 32;
  const cellW = (W - sideGutter * 2 - colGap * (colCount - 1)) / colCount;

  const cellX = (col: number) => sideGutter + col * (cellW + colGap);

  return (
    <AbsoluteFill style={{background: palette.canvas.backgroundDeep}}>
      {/* Global SVG filters available everywhere via id refs */}
      <svg width={0} height={0} style={{position: "absolute"}}>
        <FilterDefs />
      </svg>
      {/* TITLE BAR */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: W,
          height: titleH,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 32px",
          borderBottom: `1px solid ${palette.canvas.panelBorder}`,
        }}
      >
        <div style={{display: "flex", flexDirection: "column"}}>
          <div
            style={{
              fontFamily: type.sans,
              fontSize: typeScale.eyebrow,
              letterSpacing: "3.0px",
              color: palette.accent.primary,
            }}
          >
            BSQ · ANNOTATION LIBRARY v3
          </div>
          <div
            style={{
              fontFamily: type.serifTitle,
              fontSize: 28,
              fontWeight: 600,
              color: palette.text.ink,
              marginTop: 2,
            }}
          >
            Visual Treatment Swatch
          </div>
        </div>
        <div style={{display: "flex", gap: 10}}>
          <Chip text="HUDL · RT SOFTWARE" color={palette.accent.primary} />
          <Chip text="AGY MOTION v3.2" color={palette.band.good} />
          <Chip text="3D SCENE = SUBJECT" color={palette.accent.violet} />
        </div>
      </div>

      {/* PHASE HEADER STRIP */}
      <div
        style={{
          position: "absolute",
          left: sideGutter,
          top: headerY,
          width: W - sideGutter * 2,
          height: headerH,
          background: palette.canvas.pitchBase,
          border: `1px solid ${palette.canvas.panelBorder}`,
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <svg viewBox={`0 0 ${W - sideGutter * 2} ${headerH}`} width="100%" height="100%">
          <PhaseHeader
            progress={progress}
            width={W - sideGutter * 2}
            phaseCode="P3"
            phaseName="Backswing"
            tagline="Coil — hips and shoulders separate before release."
            weight={0.20}
            overallProgress={0.42}
          />
        </svg>
        <div style={{position: "absolute", right: 14, top: 12}}>
          <Chip text="phase_header" color={palette.accent.primary} />
        </div>
      </div>

      {/* SHOT CARD + VERDICT SLATE */}
      <div
        style={{
          position: "absolute",
          left: sideGutter,
          top: bookendsY,
          width: (W - sideGutter * 2 - colGap) / 2,
          height: bookendH,
          borderRadius: 10,
          border: `1px solid ${palette.canvas.panelBorder}`,
          overflow: "hidden",
        }}
      >
        <svg viewBox={`0 0 1920 1080`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%">
          <ShotCard
            progress={progress}
            width={1920}
            height={1080}
            player="Jean-Mattéo Bahoya"
            jersey={80}
            team="Eintracht Frankfurt"
            teamColor={palette.team.homeStripe}
            match="Frankfurt vs Bayern · firstHalf · ~23'"
            matchSub="Frankfurt 0-0 Bayern"
            family="carry / self-created"
            foot="right · plant left"
            pressure="0.95"
            xg="0.04"
            outcome="saved · keeper at 14.2 m"
            shotValue="0.05"
          />
        </svg>
        <div style={{position: "absolute", left: 14, top: 12}}>
          <Chip text="shot_card · PRE" color={palette.accent.primary} />
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: sideGutter + (W - sideGutter * 2 - colGap) / 2 + colGap,
          top: bookendsY,
          width: (W - sideGutter * 2 - colGap) / 2,
          height: bookendH,
          borderRadius: 10,
          border: `1px solid ${palette.canvas.panelBorder}`,
          overflow: "hidden",
        }}
      >
        <svg viewBox={`0 0 1920 1080`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%">
          <VerdictSlate
            progress={progress}
            width={1920}
            height={1080}
            bsq={71}
            band="ok"
            technique={88}
            techniqueBand="good"
            positioning={51}
            positioningBand="ok"
            phases={[
              {code: "P1", name: "Context", weight: 0.10, score: 46, band: "bad"},
              {code: "P2", name: "Approach", weight: 0.20, score: 76, band: "good"},
              {code: "P3", name: "Backswing", weight: 0.20, score: 88, band: "good"},
              {code: "P4", name: "Contact", weight: 0.30, score: 83, band: "good"},
              {code: "P5", name: "Follow-through", weight: 0.10, score: 68, band: "ok"},
              {code: "P6", name: "Outcome", weight: 0.10, score: 77, band: "good"},
            ]}
            scoreline="Frankfurt 0-1 Bayern · 23' (state at shot)"
            scorelineSub="EVENT 18905200000743 · TRACAB 50 fps · BSQ v3"
          />
        </svg>
        <div style={{position: "absolute", left: 14, top: 12}}>
          <Chip text="verdict_slate · POST" color={palette.accent.primary} />
        </div>
      </div>

      {/* ROW 1: distance_ruler · angle_arc · axis_line · score_dial */}
      <Panel x={cellX(0)} y={row1Y} w={cellW} h={rowH} title="Distance Ruler" csvName="distance_ruler" scale="hero" layer="screen_2d">
        <RulerPanel w={cellW} h={rowH} progress={progress} />
      </Panel>
      <Panel x={cellX(1)} y={row1Y} w={cellW} h={rowH} title="Angle Arc" csvName="angle_arc" scale="standard" layer="hybrid">
        <AnglePanel w={cellW} h={rowH} progress={progress} />
      </Panel>
      <Panel x={cellX(2)} y={row1Y} w={cellW} h={rowH} title="Axis Line" csvName="axis_line" scale="standard" layer="hybrid">
        <AxisPanel w={cellW} h={rowH} progress={progress} />
      </Panel>
      <Panel x={cellX(3)} y={row1Y} w={cellW} h={rowH} title="Score Dial" csvName="score_dial" scale="standard" layer="screen_2d">
        <DialPanel w={cellW} h={rowH} progress={progress} />
      </Panel>

      {/* ROW 2: velocity_arrow · path_trail · ghost_skeleton · zone_ring */}
      <Panel x={cellX(0)} y={row2Y} w={cellW} h={rowH} title="Velocity Arrow" csvName="velocity_arrow" scale="hero" layer="screen_2d">
        <VelocityPanel w={cellW} h={rowH} progress={progress} />
      </Panel>
      <Panel x={cellX(1)} y={row2Y} w={cellW} h={rowH} title="Path Trail" csvName="path_trail" scale="standard" layer="screen_2d">
        <PathPanel w={cellW} h={rowH} progress={progress} />
      </Panel>
      <Panel x={cellX(2)} y={row2Y} w={cellW} h={rowH} title="Ghost Skeleton" csvName="ghost_skeleton" scale="hero" layer="hybrid">
        <GhostPanel w={cellW} h={rowH} progress={progress} />
      </Panel>
      <Panel x={cellX(3)} y={row2Y} w={cellW} h={rowH} title="Zone Ring" csvName="zone_ring" scale="standard" layer="hybrid">
        <ZonePanel w={cellW} h={rowH} progress={progress} />
      </Panel>

      {/* ROW 3: pressure_zone · lane_zone · target_lane · highlights+chips combo */}
      <Panel x={cellX(0)} y={row3Y} w={cellW} h={rowH} title="Pressure Zone" csvName="pressure_zone" scale="hero" layer="hybrid">
        <PressurePanel w={cellW} h={rowH} progress={progress} />
      </Panel>
      <Panel x={cellX(1)} y={row3Y} w={cellW} h={rowH} title="Lane Zone" csvName="lane_zone" scale="hero" layer="hybrid">
        <LanePanel w={cellW} h={rowH} progress={progress} />
      </Panel>
      <Panel x={cellX(2)} y={row3Y} w={cellW} h={rowH} title="Target Lane + Player Spotlight" csvName="target_lane + player_spotlight" scale="standard" layer="hybrid">
        <TargetSpotlightPanel w={cellW} h={rowH} progress={progress} />
      </Panel>
      <Panel x={cellX(3)} y={row3Y} w={cellW} h={rowH} title="Pose Sticker + Chips" csvName="pose_sticker + context_badge + result_badge" scale="standard" layer="screen_2d">
        <PoseChipsPanel w={cellW} h={rowH} progress={progress} />
      </Panel>

      {/* ROW 4: distance contours · height · trajectory · freeze-frame body */}
      <Panel x={cellX(0)} y={row4Y} w={cellW} h={rowH} title="Range Ring" csvName="range_ring" scale="hero" layer="hybrid">
        <RangeRingPanel w={cellW} h={rowH} progress={progress} />
      </Panel>
      <Panel x={cellX(1)} y={row4Y} w={cellW} h={rowH} title="Height Arrow" csvName="height_arrow" scale="hero" layer="screen_2d">
        <HeightArrowPanel w={cellW} h={rowH} progress={progress} />
      </Panel>
      <Panel x={cellX(2)} y={row4Y} w={cellW} h={rowH} title="Trajectory Arc" csvName="trajectory_arc" scale="hero" layer="hybrid">
        <TrajectoryArcPanel w={cellW} h={rowH} progress={progress} />
      </Panel>
      <Panel x={cellX(3)} y={row4Y} w={cellW} h={rowH} title="Glowing Skeleton" csvName="bone_glow + bloom" scale="hero" layer="hybrid">
        <GlowingSkeletonPanel w={cellW} h={rowH} progress={progress} />
      </Panel>

      {/* ROW 5: AGY gap-fill (impact · GK spotlight · pressure wedge · defender ghost) */}
      <Panel x={cellX(0)} y={row5Y} w={cellW} h={rowH} title="Impact Shockwave" csvName="impact_shockwave" scale="hero" layer="hybrid">
        <ImpactShockwavePanel w={cellW} h={rowH} progress={progress} />
      </Panel>
      <Panel x={cellX(1)} y={row5Y} w={cellW} h={rowH} title="Keeper Spotlight" csvName="keeper_spotlight" scale="hero" layer="hybrid">
        <KeeperSpotlightPanel w={cellW} h={rowH} progress={progress} />
      </Panel>
      <Panel x={cellX(2)} y={row5Y} w={cellW} h={rowH} title="Pressure Wedge" csvName="pressure_wedge" scale="hero" layer="hybrid">
        <PressureWedgePanel w={cellW} h={rowH} progress={progress} />
      </Panel>
      <Panel x={cellX(3)} y={row5Y} w={cellW} h={rowH} title="Defender Ghost" csvName="defender_ghost" scale="hero" layer="hybrid">
        <DefenderGhostPanel w={cellW} h={rowH} progress={progress} />
      </Panel>
    </AbsoluteFill>
  );
};

/* ============================== panel bodies ============================== */

const drawMockSubject = (cx: number, cy: number, scale: number) => {
  const j = makeMockShooter(cx, cy, scale);
  const lines: [string, string][] = [
    ["nose", "neck"], ["neck", "left_shoulder"], ["neck", "right_shoulder"],
    ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"],
    ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"],
    ["neck", "pelvis"], ["pelvis", "left_hip"], ["pelvis", "right_hip"],
    ["left_hip", "left_knee"], ["left_knee", "left_ankle"], ["left_ankle", "left_toe"],
    ["right_hip", "right_knee"], ["right_knee", "right_ankle"], ["right_ankle", "right_toe"],
  ];
  return (
    <g opacity={0.85}>
      {lines.map(([a, b], i) => (
        <line key={i} x1={j[a].x} y1={j[a].y} x2={j[b].x} y2={j[b].y} stroke={palette.subject.bone} strokeWidth={2} strokeLinecap="round" />
      ))}
      {Object.entries(j).map(([k, p]) => (
        <circle key={k} cx={p.x} cy={p.y} r={2.5} fill={palette.subject.bone} />
      ))}
    </g>
  );
};

const drawMockBall = (x: number, y: number, r = 8) => (
  <g>
    <circle cx={x} cy={y} r={r} fill={palette.subject.ball} />
    <circle cx={x - r * 0.3} cy={y - r * 0.3} r={r * 0.4} fill={palette.subject.ballHighlight} opacity={0.7} />
  </g>
);

const drawGroundLine = (w: number, y: number) => (
  <line x1={20} y1={y} x2={w - 20} y2={y} stroke={palette.canvas.pitchLine} strokeWidth={1} strokeDasharray="3 5" />
);

const RulerPanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  const cx = w / 2 + 30;
  const cy = ground - 8;
  return (
    <g>
      {drawGroundLine(w, ground)}
      {drawMockSubject(cx, cy, 1)}
      {drawMockBall(cx - 100, cy + 6, 10)}
      <DistanceRule
        progress={progress}
        start={{x: cx - 100, y: cy + 6}}
        end={{x: cx - 30, y: cy + 20}}
        value="0.42"
        unit="m"
        label="plant foot → ball"
        polarity="positive"
        scale="hero"
        overshoot
        labelOffset={-22}
      />
    </g>
  );
};

const AnglePanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  // Place body in the left half so the angle wedge can live on the right
  const cx = w * 0.28;
  const cy = ground - 8;
  const j = makeMockShooter(cx, cy, 1);

  // Vertex is the pelvis; the wedge sits ON the body (this is how angle_arc actually
  // lands in P3 for trunk_lean). The chip is moved OFF the body via a leader line.
  const vertex = j.pelvis;
  const upAngleSvg = -90;
  const sweep = 14;
  const radius = 56;

  // Anchor point on the wedge bisector (where the AngleArc primitive would normally
  // place its own label).
  const aBis = (upAngleSvg + sweep / 2) * Math.PI / 180;
  const anchorX = vertex.x + Math.cos(aBis) * (radius + 4);
  const anchorY = vertex.y + Math.sin(aBis) * (radius + 4);
  // Float the chip well to the right of the body so it never overlaps.
  const chipX = cx + 145;
  const chipY = cy - 130;
  const labelOpacity = Math.max(0, Math.min(1, (progress - 0.55) * 2.5));

  return (
    <g>
      {drawGroundLine(w, ground)}
      {drawMockSubject(cx, cy, 1)}
      {/* dashed vertical reference (the "from vertical" line) */}
      <line x1={vertex.x} y1={vertex.y} x2={vertex.x} y2={vertex.y - 110} stroke={palette.text.inkFaint} strokeWidth={1.25} strokeDasharray="5 4" />
      {/* wedge ONLY — no internal chip, we draw our own below for clean off-body placement */}
      <AngleArc
        progress={progress}
        vertex={vertex}
        startAngleDeg={upAngleSvg}
        sweepAngleDeg={sweep}
        radius={radius}
        value=""
        unit=""
        polarity="positive"
        scale="standard"
        filled
      />
      {/* leader line + off-body chip */}
      {labelOpacity > 0 ? (
        <g opacity={labelOpacity}>
          <line x1={anchorX} y1={anchorY} x2={chipX - 32} y2={chipY} stroke={palette.accent.primary} strokeWidth={1.25} opacity={0.65} />
          <g transform={`translate(${chipX}, ${chipY})`}>
            <rect x={-36} y={-15} width={72} height={30} rx={4} fill={palette.canvas.chipBackdrop} stroke={palette.accent.primary} strokeOpacity={0.55} strokeWidth={1} />
            <text x={0} y={6} textAnchor="middle" fontFamily={type.mono} fontSize={typeScale.numericStandard} fill={palette.accent.primary} style={{fontVariantNumeric: "tabular-nums", fontWeight: 600}}>14°</text>
            <text x={0} y={28} textAnchor="middle" fontFamily={type.sans} fontSize={typeScale.labelSmall} fill={palette.text.inkSoft}>trunk lean</text>
          </g>
        </g>
      ) : null}
      {/* second example: a wider conceptual angle on the right side, demonstrating
          how a bigger sweep (e.g. launch_angle_deg in P6) reads */}
      {(() => {
        const vx = w * 0.60;
        const vy = ground - 14;
        const r = 60;
        return (
          <>
            <line x1={vx} y1={vy} x2={vx + r + 14} y2={vy} stroke={palette.text.inkFaint} strokeWidth={1.25} strokeDasharray="5 4" />
            <AngleArc
              progress={progress}
              vertex={{x: vx, y: vy}}
              startAngleDeg={0}
              sweepAngleDeg={-32}
              radius={r}
              value="32"
              unit="deg"
              label="launch angle"
              polarity="positive"
              scale="hero"
              filled
            />
          </>
        );
      })()}
    </g>
  );
};

const AxisPanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  const cx = w / 2;
  const cy = ground - 8;
  const j = makeMockShooter(cx, cy, 1);
  // Axis lines extend BEYOND the body so labels at the right end sit clear of the silhouette.
  // shoulder axis: a horizontal line through the shoulder y, spanning from left of body to right edge.
  // hip axis: same, through the hip y. labels anchored at line END.
  const shoulderY = (j.left_shoulder.y + j.right_shoulder.y) / 2;
  const hipY = (j.left_hip.y + j.right_hip.y) / 2;
  return (
    <g>
      {drawGroundLine(w, ground)}
      {drawMockSubject(cx, cy, 1)}
      {/* dashed vertical reference axis through body center */}
      <AxisLine
        progress={progress}
        start={{x: cx, y: cy - 160}}
        end={{x: cx, y: cy + 40}}
        color={palette.text.inkFaint}
        label=""
        scale="subtle"
        dashed
      />
      {/* shoulder axis — runs left-to-right past the body. End BEFORE right edge so chip fits. */}
      <AxisLine
        progress={progress}
        start={{x: cx - 100, y: shoulderY - 2}}
        end={{x: w - 86, y: shoulderY - 6}}
        color={palette.accent.primary}
        label="shoulder axis"
        scale="hero"
        labelAnchor="end"
        labelOffset={20}
        labelSide={-1}
      />
      {/* hip axis — runs left-to-right past the body. */}
      <AxisLine
        progress={progress}
        start={{x: cx - 100, y: hipY}}
        end={{x: w - 86, y: hipY + 4}}
        color={palette.accent.green}
        label="hip axis"
        scale="hero"
        labelAnchor="end"
        labelOffset={20}
        labelSide={1}
      />
    </g>
  );
};

const DialPanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const dialSize = 128;
  const dialH = dialSize + 28;
  const innerW = w - 32;
  const gap = (innerW - dialSize * 3) / 2;
  const baseX = 16;
  const baseY = h - dialH - 26;
  return (
    <g>
      <ScoreDial progress={progress} at={{x: baseX + 0 * (dialSize + gap), y: baseY}} value={0.92} band="good" label="V exit speed" numericText="0.92" size={dialSize} />
      <ScoreDial progress={progress} at={{x: baseX + 1 * (dialSize + gap), y: baseY}} value={0.55} band="ok" label="C plant fwd" numericText="0.55" size={dialSize} />
      <ScoreDial progress={progress} at={{x: baseX + 2 * (dialSize + gap), y: baseY}} value={0.13} band="bad" label="D distance" numericText="0.13" size={dialSize} />
    </g>
  );
};

const VelocityPanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 80;
  const cx = w / 2 - 40;
  const cy = ground - 8;
  return (
    <g>
      {drawGroundLine(w, ground)}
      {drawMockSubject(cx, cy, 1)}
      {drawMockBall(cx + 110, cy + 6, 10)}
      <VelocityArrow
        progress={progress}
        uid="vp"
        start={{x: cx + 40, y: cy + 20}}
        end={{x: cx + 105, y: cy + 4}}
        value="18.4"
        unit="m/s"
        label="foot → ball"
        polarity="positive"
        scale="hero"
      />
    </g>
  );
};

const PathPanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  const cx = w / 2;
  const cy = ground - 8;
  // synthetic foot arc
  const points: ScreenPoint[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const x = cx - 90 + t * 200;
    const y = ground - 12 - Math.sin(t * Math.PI) * 80;
    points.push({x, y});
  }
  return (
    <g>
      {drawGroundLine(w, ground)}
      {drawMockSubject(cx - 40, cy, 0.85)}
      <PathTrail
        progress={progress}
        uid="pp"
        points={points}
        polarity="positive"
        scale="hero"
      />
    </g>
  );
};

const GhostPanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  const cx = w / 2;
  const cy = ground - 8;
  const live = makeMockShooter(cx, cy, 1);
  const ghost = makeMockShooterPeak(cx, cy, 1);
  return (
    <g>
      {drawGroundLine(w, ground)}
      <GhostSkeleton
        progress={progress}
        live={live}
        ghost={ghost}
        ghostLabel="peak coil frame (Δ 14 deg)"
        scale="hero"
      />
    </g>
  );
};

const ZonePanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  const cx = w / 2;
  const cy = ground - 8;
  return (
    <g>
      {drawGroundLine(w, ground)}
      <ZoneRing
        progress={progress}
        center={{x: cx, y: ground - 4}}
        radius={110}
        radiusY={36}
        label="strike footprint"
        polarity="positive"
        scale="hero"
      />
      {drawMockSubject(cx, cy, 0.85)}
    </g>
  );
};

const PressurePanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  const cx = w / 2 - 40;
  const cy = ground - 4;
  const defenders = [
    {position: {x: cx + 60, y: cy - 24}, distance: 0.45},
    {position: {x: cx - 70, y: cy - 18}, distance: 0.65},
    {position: {x: cx + 24, y: cy - 60}, distance: 0.85},
  ];
  return (
    <g>
      {drawGroundLine(w, ground)}
      <PressureZone
        progress={progress}
        uid="pz"
        center={{x: cx, y: cy}}
        finalRadius={130}
        finalRadiusY={45}
        defenders={defenders}
        pressureValue={0.95}
      />
      {drawMockSubject(cx, cy - 8, 0.85)}
    </g>
  );
};

const LanePanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  const cx = w / 2;
  const cy = ground - 8;
  return (
    <g>
      {drawGroundLine(w, ground)}
      <LaneZone
        progress={progress}
        uid="lz"
        vertex={{x: 30, y: cy + 4}}
        leftPoint={{x: w - 30, y: cy - 50}}
        rightPoint={{x: w - 30, y: cy + 60}}
        label="42 deg shooting lane"
        polarity="positive"
      />
      {drawMockSubject(80, cy, 0.7)}
      <g transform={`translate(${w - 50}, ${cy + 4})`}>
        <line x1={-12} y1={-60} x2={-12} y2={60} stroke={palette.text.inkSoft} strokeWidth={3} />
        <line x1={-12} y1={-60} x2={12} y2={-60} stroke={palette.text.inkSoft} strokeWidth={3} />
        <line x1={-12} y1={60} x2={12} y2={60} stroke={palette.text.inkSoft} strokeWidth={3} />
      </g>
    </g>
  );
};

const TargetSpotlightPanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  const cy = ground - 8;
  return (
    <g>
      {drawGroundLine(w, ground)}
      <TargetLane
        progress={progress}
        uid="tl"
        start={{x: 50, y: cy + 6}}
        end={{x: w - 60, y: cy - 60}}
        width={36}
        label="shot direction → top-left corner"
        polarity="positive"
      />
      {drawMockSubject(60, cy, 0.6)}
      <PlayerSpotlight
        progress={progress}
        uid="ps"
        joint={{x: w - 90, y: cy - 50}}
        labelAt={{x: w - 90, y: cy - 110}}
        label="Manuel Neuer"
        sub="GK · 14.2 m off line"
        polarity="neutral"
        scale="standard"
      />
    </g>
  );
};

/* -------------------------- row 4 + 5 (AGY motion vocabulary) ---------------- */

const drawMockGoal = (cx: number, gy: number, halfWidth = 110) => {
  // 2D pictograph goal — two posts + crossbar (for RangeRing / TrajectoryArc anchor context)
  return (
    <g opacity={0.85}>
      <line x1={cx - halfWidth} y1={gy} x2={cx - halfWidth} y2={gy - 40} stroke={palette.text.inkSoft} strokeWidth={3} strokeLinecap="round" />
      <line x1={cx + halfWidth} y1={gy} x2={cx + halfWidth} y2={gy - 40} stroke={palette.text.inkSoft} strokeWidth={3} strokeLinecap="round" />
      <line x1={cx - halfWidth} y1={gy - 40} x2={cx + halfWidth} y2={gy - 40} stroke={palette.text.inkSoft} strokeWidth={3} strokeLinecap="round" />
      {/* net hatching */}
      {Array.from({length: 6}).map((_, i) => {
        const t = (i + 1) / 7;
        const x = cx - halfWidth + t * (halfWidth * 2);
        return <line key={`v${i}`} x1={x} y1={gy} x2={x} y2={gy - 40} stroke={palette.text.inkFaint} strokeWidth={1} />;
      })}
      {Array.from({length: 3}).map((_, i) => {
        const y = gy - 10 - i * 10;
        return <line key={`h${i}`} x1={cx - halfWidth} y1={y} x2={cx + halfWidth} y2={y} stroke={palette.text.inkFaint} strokeWidth={1} />;
      })}
    </g>
  );
};

const RangeRingPanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  // Goal at top center; shooter at bottom-left. Range rings emanate from goal mid.
  const goalCx = w / 2;
  const goalY = 88;
  const shooterX = w * 0.30;
  const shooterY = ground - 8;
  return (
    <g>
      {drawGroundLine(w, ground)}
      {drawMockGoal(goalCx, goalY, 86)}
      {drawMockSubject(shooterX, shooterY, 0.7)}
      {drawMockBall(shooterX + 30, shooterY + 16, 8)}
      <RangeRing
        progress={progress}
        center={{x: goalCx, y: goalY + 4}}
        radii={[68, 116, 168, 220]}
        labels={["6 m", "12 m", "18 m", "24 m"]}
        startAngleDeg={20}
        sweepAngleDeg={140}
        perspectiveY={0.55}
        polarity="positive"
        color={palette.accent.primary}
        scale="hero"
      />
    </g>
  );
};

const HeightArrowPanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  // Place the body left-of-center; ball is raised mid-air to its right.
  const cx = w * 0.32;
  const cy = ground - 8;
  const ballX = cx + 92;
  const ballY = ground - 92; // ball 92 px above the ground
  return (
    <g>
      {drawGroundLine(w, ground)}
      {drawMockSubject(cx, cy, 0.95)}
      {drawMockBall(ballX, ballY, 11)}
      <HeightArrow
        progress={progress}
        top={{x: ballX, y: ballY}}
        bottom={{x: ballX, y: ground}}
        value="1.18"
        unit="m"
        label="ball height at contact"
        chipSide="right"
        chipOffset={28}
        polarity="neutral"
        color={palette.accent.primary}
        scale="hero"
      />
    </g>
  );
};

const TrajectoryArcPanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  const shooterX = 70;
  const shooterY = ground - 8;
  const goalCx = w - 60;
  const goalY = 88;
  return (
    <g>
      {drawGroundLine(w, ground)}
      {drawMockGoal(goalCx, goalY, 60)}
      {drawMockSubject(shooterX, shooterY, 0.7)}
      {drawMockBall(shooterX + 18, shooterY + 16, 8)}
      <TrajectoryArc
        progress={progress}
        start={{x: shooterX + 18, y: shooterY + 12}}
        end={{x: goalCx, y: goalY - 8}}
        apexHeight={120}
        label="shot trajectory · 19.4 m/s"
        bright
        scale="hero"
      />
    </g>
  );
};

const GlowingSkeletonPanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  const cx = w / 2;
  const cy = ground - 8;
  const j = makeMockShooter(cx, cy, 1.1);
  const lines: [string, string][] = [
    ["nose", "neck"], ["neck", "left_shoulder"], ["neck", "right_shoulder"],
    ["left_shoulder", "left_elbow"], ["left_elbow", "left_wrist"],
    ["right_shoulder", "right_elbow"], ["right_elbow", "right_wrist"],
    ["neck", "pelvis"], ["pelvis", "left_hip"], ["pelvis", "right_hip"],
    ["left_hip", "left_knee"], ["left_knee", "left_ankle"], ["left_ankle", "left_toe"],
    ["right_hip", "right_knee"], ["right_knee", "right_ankle"], ["right_ankle", "right_toe"],
  ];
  return (
    <g>
      {drawGroundLine(w, ground)}
      <g filter="url(#bloomWhite)">
        {lines.map(([a, b], i) => (
          <line key={i} x1={j[a].x} y1={j[a].y} x2={j[b].x} y2={j[b].y} stroke={palette.subject.boneGlow} strokeWidth={2.5} strokeLinecap="round" />
        ))}
        {Object.entries(j).map(([k, p]) => (
          <circle key={k} cx={p.x} cy={p.y} r={3.5} fill={palette.subject.boneGlow} />
        ))}
      </g>
      {/* xG floating chip — our cyan-primary identity (AGY motion language only) */}
      <g transform={`translate(${cx + 80}, ${cy - 120})`}>
        <rect x={-44} y={-18} width={88} height={36} rx={4} fill={palette.canvas.panel} stroke={palette.accent.primary} strokeOpacity={0.55} />
        <text x={0} y={6} textAnchor="middle" fontFamily={type.mono} fontSize={typeScale.numericStandard + 2} fill={palette.accent.primary} style={{fontVariantNumeric: "tabular-nums", fontWeight: 600}}>
          xG=0.37
        </text>
      </g>
    </g>
  );
};

const ImpactShockwavePanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  const cx = w / 2 - 20;
  const cy = ground - 8;
  const contact = {x: cx + 55, y: cy + 18};
  return (
    <g>
      {drawGroundLine(w, ground)}
      {drawMockSubject(cx, cy, 0.95)}
      {drawMockBall(contact.x, contact.y, 10)}
      <ImpactShockwave progress={progress} center={contact} maxRadius={100} polarity="positive" scale="hero" />
    </g>
  );
};

const KeeperSpotlightPanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  const gkX = w * 0.62;
  const gkY = ground - 6;
  return (
    <g>
      {drawGroundLine(w, ground)}
      {drawMockGoal(w - 50, 70, 50)}
      {drawMockSubject(gkX, gkY, 0.75)}
      <KeeperSpotlightCylinder
        progress={progress}
        base={{x: gkX, y: gkY + 12}}
        columnHeight={130}
        label="Manuel Neuer"
        sub="14.2 m off line"
        uid="sw-gk"
      />
    </g>
  );
};

const PressureWedgePanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  const shooterX = 70;
  const shooterY = ground - 8;
  const goalX = w - 48;
  const goalY = ground - 60;
  return (
    <g>
      {drawGroundLine(w, ground)}
      {drawMockGoal(goalX, ground, 44)}
      {drawMockSubject(shooterX, shooterY, 0.7)}
      {drawMockBall(shooterX + 24, shooterY + 10, 8)}
      <PressureWedgeCorridor
        progress={progress}
        vertex={{x: shooterX + 24, y: shooterY + 10}}
        goalLeft={{x: goalX - 40, y: goalY}}
        goalRight={{x: goalX + 40, y: goalY}}
        label="blocked shooting lane"
        uid="sw-pw"
        polarity="negative"
      />
    </g>
  );
};

const DefenderGhostPanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  const cx = w / 2 - 30;
  const cy = ground - 8;
  const defenders = [
    {position: {x: cx + 70, y: cy - 20}, jersey: 4},
    {position: {x: cx - 60, y: cy - 14}, jersey: 23},
    {position: {x: cx + 20, y: cy - 55}, jersey: 2},
  ];
  return (
    <g>
      {drawGroundLine(w, ground)}
      {drawMockSubject(cx, cy, 0.85)}
      <DefenderGhost progress={progress} defenders={defenders} solidify={progress} />
    </g>
  );
};

const PoseChipsPanel: React.FC<{w: number; h: number; progress: number}> = ({w, h, progress}) => {
  const ground = h - 30;
  const cx = 110;
  const cy = ground - 8;
  return (
    <g>
      {drawGroundLine(w, ground)}
      {drawMockSubject(cx, cy, 0.85)}
      <PoseSticker
        progress={progress}
        anchor={{x: cx + 2, y: cy - 130}}
        stickerAt={{x: w - 130, y: 86}}
        title="Trunk lean"
        detail="12 deg fwd · good"
        polarity="positive"
      />
      <foreignObject x={14} y={h - 110} width={w - 28} height={96}>
        <div style={{display: "flex", gap: 10, alignItems: "stretch"}}>
          <div style={{flex: 1, position: "relative", height: 78}}>
            <svg viewBox={`0 0 ${(w - 38) / 2} 78`} width="100%" height="100%">
              <ContextBadge
                progress={progress}
                at={{x: 0, y: 0}}
                eyebrow="PRESSURE"
                value="0.95"
                sub="high · 3 defenders in lane"
                width={(w - 38) / 2}
                polarity="negative"
              />
            </svg>
          </div>
          <div style={{flex: 1, position: "relative", height: 78}}>
            <svg viewBox={`0 0 ${(w - 38) / 2} 78`} width="100%" height="100%">
              <ResultBadge
                progress={progress}
                at={{x: 0, y: 0}}
                label="OUTCOME"
                outcome="Saved · keeper at 14.2 m"
                band="ok"
                width={(w - 38) / 2}
              />
            </svg>
          </div>
        </div>
      </foreignObject>
    </g>
  );
};
