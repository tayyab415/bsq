/**
 * Shared SVG filter definitions — bloom / glow for hero overlays.
 *
 * Drop <FilterDefs /> at the top of any SVG that uses bloom (typically once per
 * composition root). Then reference filters by id:
 *
 *   <line filter="url(#bloomPrimary)" ... />
 *   <line filter="url(#bloomPositive)" ... />
 *   <line filter="url(#bloomWhite)" ... />
 *
 * Bloom filters are keyed by our palette's *semantic* identity (primary / good /
 * ok / bad / white), so primitives can pick the right glow by polarity rather
 * than by raw hex. This keeps the Statsbomb-derived motion/vocabulary but
 * preserves our cyan-primary brand identity.
 */
import React from "react";
import {palette} from "../style/tokens";

const Bloom: React.FC<{id: string; color: string; stdDeviation?: number; intensity?: number}> = ({
  id,
  color,
  stdDeviation = 3,
  intensity = 0.9,
}) => {
  return (
    <filter id={id} x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation={stdDeviation} result="blur" />
      <feFlood floodColor={color} floodOpacity={intensity} result="tint" />
      <feComposite in="tint" in2="blur" operator="in" result="coloredBlur" />
      <feMerge>
        <feMergeNode in="coloredBlur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  );
};

export const FilterDefs: React.FC = () => {
  return (
    <defs>
      {/* Semantic bloom set — keyed to OUR cyan/green/amber/coral identity */}
      <Bloom id="bloomPrimary" color={palette.accent.primary} stdDeviation={3} intensity={0.95} />
      <Bloom id="bloomPrimarySoft" color={palette.accent.primary} stdDeviation={5} intensity={0.7} />
      <Bloom id="bloomPositive" color={palette.band.good} stdDeviation={3} intensity={0.95} />
      <Bloom id="bloomPositiveSoft" color={palette.band.good} stdDeviation={5} intensity={0.7} />
      <Bloom id="bloomNeutral" color={palette.band.ok} stdDeviation={3} intensity={0.9} />
      <Bloom id="bloomNegative" color={palette.band.bad} stdDeviation={3} intensity={0.95} />
      <Bloom id="bloomNegativeSoft" color={palette.band.bad} stdDeviation={5} intensity={0.7} />
      <Bloom id="bloomViolet" color={palette.accent.violet} stdDeviation={3} intensity={0.9} />
      <Bloom id="bloomWhite" color={palette.subject.boneGlow} stdDeviation={2.4} intensity={0.75} />
      {/* drop-shadow style (soft) for chips and labels */}
      <filter id="chipShadow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="2.5" />
        <feOffset dx="0" dy="2" result="offsetblur" />
        <feComponentTransfer>
          <feFuncA type="linear" slope="0.55" />
        </feComponentTransfer>
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
};

/** Convenience: bloom filter url by polarity (matches polarityHex semantics). */
export const bloomForPolarity = (polarity: "positive" | "neutral" | "negative", soft = false): string => {
  if (polarity === "positive") return soft ? "url(#bloomPositiveSoft)" : "url(#bloomPositive)";
  if (polarity === "negative") return soft ? "url(#bloomNegativeSoft)" : "url(#bloomNegative)";
  return "url(#bloomNeutral)";
};

/** Convenience: bloom filter url by *named* accent (when polarity is irrelevant). */
export const bloomForAccent = (
  accent: "primary" | "positive" | "neutral" | "negative" | "violet" | "white",
  soft = false,
): string => {
  switch (accent) {
    case "primary":
      return soft ? "url(#bloomPrimarySoft)" : "url(#bloomPrimary)";
    case "positive":
      return soft ? "url(#bloomPositiveSoft)" : "url(#bloomPositive)";
    case "neutral":
      return "url(#bloomNeutral)";
    case "negative":
      return soft ? "url(#bloomNegativeSoft)" : "url(#bloomNegative)";
    case "violet":
      return "url(#bloomViolet)";
    case "white":
    default:
      return "url(#bloomWhite)";
  }
};
