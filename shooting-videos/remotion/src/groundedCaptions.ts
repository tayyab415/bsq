/**
 * Convert narrative subtitle cues → @remotion/captions Caption[].
 */
import type {Caption} from "@remotion/captions";
import {GROUNDED_FPS} from "./groundedExpandedTimeline";
import type {SubtitleCue} from "./groundedShotNarrative";

const frameToMs = (frame: number) => (frame / GROUNDED_FPS) * 1000;

/** Word-level captions with spaces preserved (Remotion whitespace-sensitive). */
export function subtitleCuesToCaptions(cues: SubtitleCue[]): Caption[] {
  const captions: Caption[] = [];

  for (const cue of cues) {
    const words = cue.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const startMs = frameToMs(cue.startFrame);
    const endMs = frameToMs(cue.endFrame);
    const span = Math.max(120, endMs - startMs);
    const step = span / words.length;

    words.forEach((word, i) => {
      const tokenStart = startMs + i * step;
      const tokenEnd = startMs + (i + 1) * step;
      captions.push({
        text: i === 0 ? word : ` ${word}`,
        startMs: tokenStart,
        endMs: tokenEnd,
        timestampMs: tokenStart,
        confidence: 1,
      });
    });
  }

  return captions.sort((a, b) => a.startMs - b.startMs);
}
