import type { VerseEntry } from './types';

export const MIN_PAGE = 1;
export const MAX_PAGE = 604;
export const MIN_REPETITION = 1;
export const MAX_REPETITION = 99;

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function clampPage(page: number): number {
  return clamp(Math.trunc(page), MIN_PAGE, MAX_PAGE);
}

export function clampRepetition(rep: number): number {
  return clamp(Math.trunc(rep), MIN_REPETITION, MAX_REPETITION);
}

/**
 * Enforces strict 1-based on-page verse range bounds:
 * 1 <= start <= end <= pageMaxVerse
 */
export function clampVerseRange(
  start: number,
  end: number,
  pageMaxVerse: number
): { rangeStart: number; rangeEnd: number } {
  const safeMax = Math.max(1, Math.trunc(pageMaxVerse));
  const clampedStart = clamp(Math.trunc(start), 1, safeMax);
  const clampedEnd = clamp(Math.trunc(end), clampedStart, safeMax);
  return { rangeStart: clampedStart, rangeEnd: clampedEnd };
}

export function slicePageVerses(
  verses: VerseEntry[],
  rangeStart: number,
  rangeEnd: number
): VerseEntry[] {
  if (verses.length === 0) return [];
  const { rangeStart: s, rangeEnd: e } = clampVerseRange(rangeStart, rangeEnd, verses.length);
  return verses.slice(s - 1, e);
}

/**
 * Finds the exact 1-based [rangeStart, rangeEnd] indices for a specific Surah on a Madani page.
 * Fixes shared multi-Surah pages (e.g., Page 604: 112 Al-Ikhlas -> 1..4, 113 Al-Falaq -> 5..9, 114 An-Nas -> 10..15).
 */
export function getSurahSliceOnPage(
  verses: VerseEntry[],
  surahId: number
): { rangeStart: number; rangeEnd: number } | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < verses.length; i++) {
    if (verses[i].surah === surahId) {
      if (first === -1) first = i + 1;
      last = i + 1;
    }
  }
  if (first === -1 || last === -1) return null;
  return { rangeStart: first, rangeEnd: last };
}

export function formatTelemetryRange(verses: VerseEntry[]): string {
  if (verses.length === 0) return '00–00';
  const first = verses[0];
  const last = verses[verses.length - 1];
  if (first.surah === last.surah) {
    return `${first.surah}:${first.ayah}–${last.ayah}`;
  }
  return `${first.verseKey}–${last.verseKey}`;
}
