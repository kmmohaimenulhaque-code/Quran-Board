import type { AyahBundle, Reciter, VerseEntry } from '../core/types';

export interface RecitationProvider {
  getPageVerses(page: number): Promise<VerseEntry[]>;
  buildAyahBundle(verse: VerseEntry, reciter: Reciter, localOverrideUrl?: string | null): Promise<AyahBundle>;
}
