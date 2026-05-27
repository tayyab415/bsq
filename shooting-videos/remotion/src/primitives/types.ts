/**
 * Shared primitive types. Every primitive consumes a subset of these so the
 * registry (Q13) and the phase composer can pass them uniformly.
 */
import type {CSSProperties} from "react";

export type ScreenPoint = {x: number; y: number};

export type Polarity = "positive" | "neutral" | "negative";

export type VisualScale = "hero" | "standard" | "subtle";

export type Band = "good" | "ok" | "bad";

export type PrimitiveBase = {
  /** 0..1 of the primitive's animation. 1.0 = fully drawn / settled. */
  progress: number;
  /** Visual scale from CSV. Drives stroke + label size. */
  scale?: VisualScale;
  /** Polarity from CSV. Drives color. */
  polarity?: Polarity;
  /** Optional inline style override for layout in containers. */
  style?: CSSProperties;
};

export type LabelProps = {
  label?: string;
  unit?: string;
  /** Formatted numeric value, already polarity-aware where applicable. */
  value?: string;
};

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export const easeOutQuart = (t: number) => {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 4);
};

export const easeOutOvershoot = (t: number) => {
  const x = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** AGY snap entrance: slide up + scale-in + fade (progress 0..1 over chip entrance). */
export const chipEntrance = (progress: number, holdFrom = 0.55): {
  opacity: number;
  translateY: number;
  scale: number;
} => {
  const t = clamp01(progress / holdFrom);
  const eased = 1 - Math.pow(1 - t, 4);
  return {
    opacity: eased,
    translateY: 10 * (1 - eased),
    scale: 0.82 + 0.18 * eased,
  };
};
