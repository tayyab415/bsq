/**
 * Style tokens — locked at Q6 (Hudl Assembly + RT Software telestration language).
 * Used by every primitive and composition. Do not inline raw colors / fonts anywhere else.
 */

export const palette = {
  canvas: {
    background: "#0e1116",
    backgroundDeep: "#0B0B0C", // Statsbomb-style deeper void (AGY-derived)
    pitchBase: "#15191f",
    pitchTurf: "#2C3E2B", // desaturated sage green turf (AGY-derived)
    pitchLine: "rgba(232, 240, 248, 0.18)",
    panel: "rgba(14, 17, 22, 0.78)",
    panelBorder: "rgba(232, 240, 248, 0.10)",
    panelStrong: "rgba(20, 25, 33, 0.92)",
    chipBackdrop: "rgba(28, 28, 30, 0.60)", // Statsbomb pill backdrop (AGY-derived)
  },
  subject: {
    bone: "#e8f0f8",
    boneGlow: "#FFFFFF", // pure-white glowing bone (AGY: Statsbomb freeze-frame style)
    joint: "#e8f0f8",
    boneRim: "rgba(180, 200, 220, 0.40)",
    ball: "#f2bf5e",
    ballHighlight: "#ffe7a8",
    shooterAccent: "#5ee7ff",
    defenderAccent: "#91b8d7",
    keeperAccent: "#b18cff",
  },
  accent: {
    primary: "#5ee7ff",
    primaryDeep: "#146dff",
    amber: "#f2b950",
    coral: "#ff6f7e",
    violet: "#b18cff",
    green: "#2cd49a",
    // Statsbomb / AGY-derived telestration accents
    statsbombOrange: "#FF6600",
    statsbombOrangeSoft: "rgba(255, 102, 0, 0.55)",
    statsbombCyan: "#00FFFF",
    statsbombCyanSoft: "rgba(0, 255, 255, 0.55)",
  },
  band: {
    good: "#2cd49a",
    ok: "#f2b950",
    bad: "#ff6f7e",
  },
  polarity: {
    positive: "#5ee7ff",
    neutral: "#f2b950",
    negative: "#ff6f7e",
  },
  text: {
    ink: "#e8f0f8",
    inkSoft: "rgba(232, 240, 248, 0.78)",
    inkMuted: "rgba(232, 240, 248, 0.52)",
    inkFaint: "rgba(232, 240, 248, 0.28)",
    onLight: "#16211f",
  },
  team: {
    homeStripe: "#e04444",
    awayStripe: "#6bb7ff",
  },
} as const;

export const type = {
  serifTitle: '"Source Serif Pro", "Source Serif 4", Georgia, "Times New Roman", serif',
  sans: 'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"JetBrains Mono", ui-monospace, "SFMono-Regular", Menlo, monospace',
} as const;

export const typeScale = {
  // px sizes for 1920x1080 canvas
  hero: 144,
  title: 96,
  phaseTitle: 56,
  sectionTitle: 32,
  label: 18,
  labelSmall: 14,
  numericHero: 144,
  numericLarge: 56,
  numericStandard: 22,
  numericSmall: 16,
  caption: 13,
  eyebrow: 12,
} as const;

export const stroke = {
  hero: 3,
  standard: 2,
  subtle: 1.25,
  hairline: 1,
  ringHero: 2.5,
  ringStandard: 1.75,
} as const;

export const radius = {
  card: 14,
  chip: 999,
  panel: 10,
  tight: 6,
} as const;

export const motion = {
  // frames @ 30 fps unless noted
  drawOnFrames: 8, // AGY: 12 frames @ 50 fps = 7-8 frames @ 30 fps (snappy)
  drawOnOvershootFrames: 14,
  drawOnOvershootSnapAtFrame: 11,
  ribbonSweepFrames: 14,
  dialSweepFrames: 22,
  ghostFadeInFrames: 10,
  ghostOpacity: 0.32,
  pulseFrames: 14,
  fadeOutFrames: 5, // AGY: ~8 frames @ 50 fps = 5 frames @ 30 fps (quick out)
  phaseBannerSlideFrames: 12,
  phaseBannerHoldFrames: 60,
  impactFreezeFrames: 8,
  impactRingExpandFrames: 18,
  impactShockwaveFrames: 12,
  impactLabelFrames: 10,
  expandingRingFrames: 22,
  /** Stagger between sequential annotations in one beat (AGY comparison). */
  annotationStaggerFrames: 14,
  /** Hold per annotation before fade-out (AGY comparison). */
  annotationHoldFrames: 52,
  /** Contact freeze hold for orbit + staged overlays (AGY comparison). */
  contactFreezeHoldFrames: 75,
  defenderCaptureFlashFrames: 10,
  countUpFrames: 26,
  cardRevealFrames: 26,
  cardHoldFrames: 90,
  cardExitFrames: 16,
  // Chip entrance — slide up + scale-in + fade (AGY-derived)
  chipEntranceFrames: 10,
  chipEntranceShiftPx: 10,
  chipEntranceScaleFrom: 0.82,
} as const;

export const shadow = {
  callout: "0 1px 2px rgba(0, 0, 0, 0.45)",
  panel: "0 14px 38px rgba(0, 0, 0, 0.45)",
  card: "0 24px 60px rgba(0, 0, 0, 0.55)",
} as const;

export const polarityHex = (polarity: "positive" | "neutral" | "negative"): string => {
  switch (polarity) {
    case "positive": return palette.polarity.positive;
    case "negative": return palette.polarity.negative;
    default: return palette.polarity.neutral;
  }
};

export const bandHex = (band: "good" | "ok" | "bad" | string | undefined): string => {
  switch (band) {
    case "good": return palette.band.good;
    case "bad": return palette.band.bad;
    case "ok":
    default: return palette.band.ok;
  }
};

// Easings expressed as cubic-bezier values for CSS / SVG animations.
export const easing = {
  default: "cubic-bezier(0.4, 0.0, 0.2, 1)",
  easeOut: "cubic-bezier(0.0, 0.0, 0.2, 1)",
  easeOutQuart: "cubic-bezier(0.25, 1, 0.5, 1)",
  easeInOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  overshoot: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  // Statsbomb snap-ease — quick start, smooth land (AGY-derived)
  snap: "cubic-bezier(0.16, 1, 0.3, 1)",
} as const;
