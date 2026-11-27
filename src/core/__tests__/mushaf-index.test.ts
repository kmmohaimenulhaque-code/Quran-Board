import { describe, it, expect } from 'vitest';
import surahs from '../../assets/data/surahs-114.json';
import bundledPages from '../../assets/data/mushaf-604.json';
import {
  clampPage,
  clampRepetition,
  clampVerseRange,
  slicePageVerses,
  formatTelemetryRange
} from '../mushaf-index';

describe('Full 114-Surah & 604-Page Madani Mushaf Index', () => {
  it('contains all 114 Surahs summing to exactly 6,236 Ayahs in monotonic page order', () => {
    expect(surahs.length).toBe(114);
    const totalAyahs = surahs.reduce((sum, s) => sum + s.ayahs, 0);
    expect(totalAyahs).toBe(6236);
    for (let i = 1; i < surahs.length; i++) {
      expect(surahs[i].id).toBe(surahs[i - 1].id + 1);
      expect(surahs[i].startPage).toBeGreaterThanOrEqual(surahs[i - 1].startPage);
      expect(surahs[i].startPage).toBeLessThanOrEqual(604);
    }
  });

  it('clamps page numbers strictly to 1..604 and repetition to 1..99', () => {
    expect(clampPage(-5)).toBe(1);
    expect(clampPage(604)).toBe(604);
    expect(clampPage(999)).toBe(604);
    expect(clampRepetition(0)).toBe(1);
    expect(clampRepetition(99)).toBe(99);
    expect(clampRepetition(200)).toBe(99);
  });

  it('clamps verse ranges strictly to 1 <= start <= end <= pageMaxVerse', () => {
    expect(clampVerseRange(0, 99, 5)).toEqual({ rangeStart: 1, rangeEnd: 5 });
    expect(clampVerseRange(4, 2, 5)).toEqual({ rangeStart: 4, rangeEnd: 4 });
    expect(clampVerseRange(1, 15, 15)).toEqual({ rangeStart: 1, rangeEnd: 15 });
  });

  it('handles multi-Surah Page 604 (Al-Ikhlas, Al-Falaq, An-Nas) with 15 verses cleanly', () => {
    const p604 = bundledPages['604'];
    expect(p604.length).toBe(15);
    expect(formatTelemetryRange(p604)).toBe('112:1–114:6');
    expect(slicePageVerses(p604, 5, 9)[0].verseKey).toBe('113:1');
  });
});
