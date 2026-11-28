import type { VerseEntry } from './types';

export const BISMILLAH_TEXT = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';
export const SHAMIM_BISMILLAH_CLIP = { startMs: 7500, endMs: 15000 } as const;

/**
 * Strips any Bismillah prefix prepended by AlQuran Cloud onto Ayah 1
 * of Surahs other than Al-Fatihah (1) and At-Tawbah (9), including
 * optional leading BOM (\uFEFF) or Rub el Hizb (۞) markers.
 */
export function stripLeadingBismillah(textUthmani: string, surah: number, ayah: number): string {
  const normalized = textUthmani.replace(/^\uFEFF/, '').trim();
  if (surah === 1 || surah === 9 || ayah !== 1) return normalized;
  const cleaned = normalized
    .replace(/^(?:۞\s*)?بِسْمِ\s+ٱ?للَّهِ\s+ٱ?لرَّحْمَٰنِ\s+ٱ?لرَّحِيمِ\s*/u, '')
    .replace(/^(?:۞\s*)?بسم\s+الله\s+الرحمن\s+الرحيم\s*/u, '')
    .trim();
  return cleaned.length > 0 ? cleaned : normalized;
}

/**
 * Prepends a dedicated recited Bismillah entry (ayah: 0, isBismillah: true)
 * before Ayah 1 of every Surah except Surah 1 (already Bismillah) and Surah 9 (At-Tawbah).
 */
export function expandVersesWithBismillah(verses: VerseEntry[]): VerseEntry[] {
  const expanded: VerseEntry[] = [];
  for (const v of verses) {
    if (v.ayah === 1 && v.surah !== 1 && v.surah !== 9) {
      expanded.push({
        verseKey: `${v.surah}:0`,
        surah: v.surah,
        ayah: 0,
        isBismillah: true,
        textUthmani: BISMILLAH_TEXT
      });
      expanded.push({
        ...v,
        textUthmani: stripLeadingBismillah(v.textUthmani, v.surah, v.ayah)
      });
    } else {
      expanded.push(v);
    }
  }
  return expanded;
}
