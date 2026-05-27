import React from "react";
import {palette, polarityHex} from "../style/tokens";
import {clamp01, easeOutQuart, type PrimitiveBase, type ScreenPoint} from "./types";

/** Dotted leader from a floating label anchor to a spatial joint / pitch point. */
export type LeaderLineProps = PrimitiveBase & {
  from: ScreenPoint;
  to: ScreenPoint;
  dashed?: boolean;
};

export const LeaderLine: React.FC<LeaderLineProps> = ({
  progress,
  from,
  to,
  dashed = true,
  polarity = "neutral",
}) => {
  const color = polarityHex(polarity);
  const t = easeOutQuart(progress);
  const cx = from.x + (to.x - from.x) * t;
  const cy = from.y + (to.y - from.y) * t;
  return (
    <line
      x1={from.x}
      y1={from.y}
      x2={cx}
      y2={cy}
      stroke={color}
      strokeWidth={1.25}
      strokeOpacity={0.55}
      strokeLinecap="round"
      strokeDasharray={dashed ? "5 4" : undefined}
    />
  );
};

/** Small ground anchor dot at measurement base. */
export const GroundAnchorDot: React.FC<{
  point: ScreenPoint;
  progress: number;
  polarity?: "positive" | "neutral" | "negative";
}> = ({point, progress, polarity = "neutral"}) => {
  const color = polarityHex(polarity);
  const t = easeOutQuart(progress);
  return (
    <circle
      cx={point.x}
      cy={point.y}
      r={3 + t * 2}
      fill={color}
      fillOpacity={0.35 + t * 0.45}
      stroke={palette.text.ink}
      strokeWidth={0.5}
      strokeOpacity={0.25}
    />
  );
};
