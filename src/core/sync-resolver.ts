import type { WordSegment } from './types';

const PAUSE_MARKS = new Set(['ۖ', 'ۗ', 'ۘ', 'ۙ', 'ۚ', 'ۛ', 'ۜ', '۞', '۩']);

export function tokenizeArabicWords(textUthmani: string): string[] {
  const raw = textUthmani.trim().split(/\s+/).filter(Boolean);
  const words: string[] = [];
  for (const tok of raw) {
    if (PAUSE_MARKS.has(tok) && words.length > 0) {
      words[words.length - 1] += ` ${tok}`;
    } else {
      words.push(tok);
    }
  }
  return words;
}

/**
 * Deterministic character-weighted fallback word timestamp synthesizer.
 * Ensures word-by-word reveal never stalls if external timing JSON is unavailable.
 */
export function synthesizeWordSegments(
  textUthmani: string,
  durationMs: number,
  offsetMs = 0
): WordSegment[] {
  const tokens = tokenizeArabicWords(textUthmani);
  if (tokens.length === 0) return [];

  const safeDuration = Math.max(100, durationMs);
  const weights = tokens.map((w) => {
    const baseLen = w.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '').length;
    const maddBonus = /ٓ/.test(w) ? 3.2 : 0;
    return Math.max(2, baseLen * 1.15 + maddBonus);
  });
  const totalWeight = weights.reduce((acc, w) => acc + w, 0) || 1;

  let cursor = offsetMs;
  return tokens.map((text, idx) => {
    const share = (weights[idx] / totalWeight) * safeDuration;
    const startMs = Math.round(cursor);
    const endMs =
      idx === tokens.length - 1
        ? Math.round(offsetMs + safeDuration)
        : Math.round(cursor + share);
    cursor += share;
    return {
      wordIndex: idx + 1,
      textUthmani: text,
      startMs,
      endMs
    };
  });
}

/**
 * O(log W) binary search resolving currentMs -> 1-based active wordIndex.
 * Returns 0 if currentMs is before the first word starts.
 */
export function resolveActiveWordIndex(words: WordSegment[], currentMs: number): number {
  if (words.length === 0) return 0;
  if (currentMs < words[0].startMs) return 0;

  let lo = 0;
  let hi = words.length - 1;
  let lastStarted = words[0].wordIndex;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const seg = words[mid];
    if (currentMs >= seg.startMs && currentMs < seg.endMs) {
      return seg.wordIndex;
    }
    if (currentMs < seg.startMs) {
      hi = mid - 1;
    } else {
      lastStarted = seg.wordIndex;
      lo = mid + 1;
    }
  }
  return lastStarted;
}
