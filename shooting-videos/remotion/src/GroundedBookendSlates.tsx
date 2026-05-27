/**
 * PRE shot card + POST verdict slate (full-frame SVG bookends).
 */
import React from "react";
import {AbsoluteFill, interpolate, useCurrentFrame} from "remotion";
import {ShotCard, VerdictSlate} from "./primitives";
import type {ShotCardNarrative, VerdictNarrative} from "./groundedShotNarrative";

export const GroundedPreRollSlate: React.FC<{
  width: number;
  height: number;
  card: ShotCardNarrative;
  durationFrames: number;
}> = ({width, height, card, durationFrames}) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [8, durationFrames * 0.35], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(frame, [durationFrames - 24, durationFrames - 4], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{background: "#020815", opacity: fadeOut}}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <ShotCard
          progress={progress}
          width={width}
          height={height}
          player={card.player}
          jersey={card.jersey}
          team={card.team}
          match={card.match}
          matchSub={card.matchSub}
          family={card.family}
          foot={card.foot}
          pressure={card.pressure}
          xg={card.xg}
          shotValue={card.shotValue}
          outcome={card.outcome}
        />
      </svg>
    </AbsoluteFill>
  );
};

export const GroundedPostRollSlate: React.FC<{
  width: number;
  height: number;
  verdict: VerdictNarrative;
  durationFrames: number;
}> = ({width, height, verdict, durationFrames}) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [6, durationFrames * 0.55], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{background: "#020815"}}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <VerdictSlate
          progress={progress}
          width={width}
          height={height}
          bsq={verdict.bsq}
          band={verdict.band}
          technique={verdict.technique}
          techniqueBand={verdict.techniqueBand}
          positioning={verdict.positioning}
          positioningBand={verdict.positioningBand}
          phases={verdict.phases}
          scoreline={verdict.scoreline}
          scorelineSub={verdict.scorelineSub}
        />
      </svg>
    </AbsoluteFill>
  );
};
