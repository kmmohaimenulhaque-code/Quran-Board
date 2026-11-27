import { describe, it, expect } from 'vitest';
import { clampPage, clampRepetition, clampVerseRange, slicePageVerses, formatTelemetryRange } from '../mushaf-index';
import { synthesizeWordSegments, resolveActiveWordIndex } from '../sync-resolver';
import { computeAyahEndedTransition } from '../state-machine';

describe('mushaf-index clamping & multi-Surah page handling', () => {
  it('clamps page numbers strictly to 1..604', () => {
    expect(clampPage(0)).toBe(1);
    expect(clampPage(45)).toBe(45);
    expect(clampPage(999)).toBe(604);
  });

  it('clamps repetition strictly to 1..99', () => {
    expect(clampRepetition(0)).toBe(1);
    expect(clampRepetition(3)).toBe(3);
    expect(clampRepetition(120)).toBe(99);
  });

  it('enforces 1 <= start <= end <= pageMaxVerse', () => {
    expect(clampVerseRange(0, 10, 5)).toEqual({ rangeStart: 1, rangeEnd: 5 });
    expect(clampVerseRange(4, 2, 5)).toEqual({ rangeStart: 4, rangeEnd: 4 });
    expect(clampVerseRange(2, 5, 5)).toEqual({ rangeStart: 2, rangeEnd: 5 });
  });

  it('formats single-Surah and multi-Surah ranges cleanly', () => {
    const single = [
      { verseKey: '2:1', surah: 2, ayah: 1, textUthmani: 'الٓمٓ' },
      { verseKey: '2:5', surah: 2, ayah: 5, textUthmani: 'أُو۟لَٰٓئِكَ' }
    ];
    expect(formatTelemetryRange(single)).toBe('2:1–5');

    const multi = [
      { verseKey: '113:5', surah: 113, ayah: 5, textUthmani: 'وَمِن شَرِّ' },
      { verseKey: '114:6', surah: 114, ayah: 6, textUthmani: 'مِنَ ٱلْجِنَّةِ' }
    ];
    expect(formatTelemetryRange(multi)).toBe('113:5–114:6');
    expect(slicePageVerses(single, 1, 2).length).toBe(2);
  });
});

describe('sync-resolver binary search & fallback synthesizer', () => {
  it('synthesizes monotonic non-overlapping word segments covering durationMs', () => {
    const text = 'ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ';
    const segs = synthesizeWordSegments(text, 10100, 0);
    expect(segs.length).toBe(7);
    expect(segs[0].startMs).toBe(0);
    expect(segs[segs.length - 1].endMs).toBe(10100);
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i].startMs).toBeGreaterThanOrEqual(segs[i - 1].startMs);
    }
  });

  it('resolves active word index in O(log W) accurately', () => {
    const words = [
      { wordIndex: 1, textUthmani: 'الٓمٓ', startMs: 0, endMs: 1000 },
      { wordIndex: 2, textUthmani: 'ذَٰلِكَ', startMs: 1000, endMs: 2500 },
      { wordIndex: 3, textUthmani: 'ٱلْكِتَٰبُ', startMs: 2500, endMs: 4200 }
    ];
    expect(resolveActiveWordIndex(words, -10)).toBe(0);
    expect(resolveActiveWordIndex(words, 0)).toBe(1);
    expect(resolveActiveWordIndex(words, 999)).toBe(1);
    expect(resolveActiveWordIndex(words, 1000)).toBe(2);
    expect(resolveActiveWordIndex(words, 3100)).toBe(3);
    expect(resolveActiveWordIndex(words, 5000)).toBe(3);
  });
});

describe('state-machine full-range block repetition FSM', () => {
  it('advances sequentially across ayahs, resets block on pass < N, completes on pass === N', () => {
    // Pass 1 of 3, Ayah 0 of 5 -> Ayah 1
    expect(computeAyahEndedTransition(1, 3, 0, 5)).toEqual({
      nextPhase: 'PLAYING',
      nextPass: 1,
      nextAyahIdx: 1
    });
    // Pass 1 of 3, Ayah 4 (last) -> PASS_RESET for Pass 2
    expect(computeAyahEndedTransition(1, 3, 4, 5)).toEqual({
      nextPhase: 'PASS_RESET',
      nextPass: 2,
      nextAyahIdx: 0
    });
    // Pass 3 of 3, Ayah 4 (last) -> COMPLETED
    expect(computeAyahEndedTransition(3, 3, 4, 5)).toEqual({
      nextPhase: 'COMPLETED',
      nextPass: 3,
      nextAyahIdx: 4
    });
  });
});
