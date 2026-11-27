import { describe, it, expect } from 'vitest';
import { tokenizeArabicWords, synthesizeWordSegments, resolveActiveWordIndex } from '../sync-resolver';

describe('Arabic tokenization, fallback synthesizer & O(log W) binary search', () => {
  it('attaches Uthmani waqf pause marks to preceding words', () => {
    const tokens = tokenizeArabicWords('ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ');
    expect(tokens.length).toBe(7);
    expect(tokens[3]).toContain('ۛ');
  });

  it('handles single-word Ayah (Alif-Lam-Meem 2:1)', () => {
    const segs = synthesizeWordSegments('الٓمٓ', 9200, 0);
    expect(segs).toEqual([{ wordIndex: 1, textUthmani: 'الٓمٓ', startMs: 0, endMs: 9200 }]);
    expect(resolveActiveWordIndex(segs, 4500)).toBe(1);
  });

  it('resolves exact boundaries in O(log W)', () => {
    const words = [
      { wordIndex: 1, textUthmani: 'أ', startMs: 0, endMs: 1000 },
      { wordIndex: 2, textUthmani: 'ب', startMs: 1000, endMs: 2500 },
      { wordIndex: 3, textUthmani: 'ج', startMs: 2500, endMs: 4200 }
    ];
    expect(resolveActiveWordIndex([], 500)).toBe(0);
    expect(resolveActiveWordIndex(words, -1)).toBe(0);
    expect(resolveActiveWordIndex(words, 0)).toBe(1);
    expect(resolveActiveWordIndex(words, 999)).toBe(1);
    expect(resolveActiveWordIndex(words, 1000)).toBe(2);
    expect(resolveActiveWordIndex(words, 2500)).toBe(3);
    expect(resolveActiveWordIndex(words, 9999)).toBe(3);
  });
});
