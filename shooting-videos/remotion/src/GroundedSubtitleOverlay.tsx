/**
 * Broadcast-style subtitles via @remotion/captions (TikTok-style pages, optional word emphasis).
 */
import React, {useMemo} from "react";
import {AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig} from "remotion";
import {createTikTokStyleCaptions, type Caption, type TikTokPage} from "@remotion/captions";
import {palette, type} from "./style/tokens";

const SWITCH_CAPTIONS_EVERY_MS = 2800;

const CaptionPage: React.FC<{page: TikTokPage; fps: number; sequenceFrom: number}> = ({
  page,
  fps,
  sequenceFrom,
}) => {
  const frame = useCurrentFrame();
  const {width} = useVideoConfig();
  const absoluteFrame = sequenceFrom + frame;
  const currentTimeMs = (absoluteFrame / fps) * 1000;
  const localMs = currentTimeMs - page.startMs;
  const fadeIn = interpolate(localMs, [0, 180], [0, 1], {extrapolateRight: "clamp"});
  const fadeOut = interpolate(page.durationMs - localMs, [0, 220], [0, 1], {extrapolateRight: "clamp"});
  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 72,
        display: "flex",
        justifyContent: "center",
        padding: "0 48px",
        opacity,
        pointerEvents: "none",
        zIndex: 12,
      }}
    >
      <div
        style={{
          maxWidth: Math.min(1100, width - 96),
          background: "rgba(3, 10, 22, 0.88)",
          border: `1px solid ${palette.accent.primary}55`,
          borderRadius: 8,
          padding: "14px 28px",
          boxShadow: "0 8px 40px rgba(0,0,0,0.45), 0 0 24px rgba(30, 231, 255, 0.28)",
        }}
      >
        <p
          style={{
            margin: 0,
            color: palette.text.ink,
            fontFamily: type.sans,
            fontSize: 26,
            fontWeight: 600,
            lineHeight: 1.35,
            textAlign: "center",
            whiteSpace: "pre",
          }}
        >
          {page.tokens.map((token) => {
            const active = currentTimeMs >= token.fromMs && currentTimeMs < token.toMs;
            return (
              <span
                key={`${token.fromMs}-${token.text}`}
                style={{
                  color: active ? palette.accent.primary : palette.text.inkSoft,
                  textShadow: active ? "0 0 12px rgba(30, 231, 255, 0.55)" : undefined,
                }}
              >
                {token.text}
              </span>
            );
          })}
        </p>
      </div>
    </div>
  );
};

export const GroundedSubtitleOverlay: React.FC<{captions: Caption[]}> = ({captions}) => {
  const {fps} = useVideoConfig();

  const pages = useMemo(() => {
    return createTikTokStyleCaptions({
      captions,
      combineTokensWithinMilliseconds: SWITCH_CAPTIONS_EVERY_MS,
    }).pages;
  }, [captions]);

  if (pages.length === 0) return null;

  return (
    <AbsoluteFill style={{pointerEvents: "none"}}>
      {pages.map((page, index) => {
        const startFrame = Math.round((page.startMs / 1000) * fps);
        const durationFrames = Math.max(1, Math.round((page.durationMs / 1000) * fps) + 6);
        return (
          <Sequence key={`${page.startMs}-${index}`} from={startFrame} durationInFrames={durationFrames} layout="none">
            <CaptionPage page={page} fps={fps} sequenceFrom={startFrame} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
