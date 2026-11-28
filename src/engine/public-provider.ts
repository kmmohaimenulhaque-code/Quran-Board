import type { AyahBundle, Reciter, VerseEntry } from '../core/types';
import type { RecitationProvider } from './provider';
import { synthesizeWordSegments } from '../core/sync-resolver';
import { BISMILLAH_TEXT, SHAMIM_BISMILLAH_CLIP } from '../core/bismillah';
import type { PlatformBridge } from '../platform/bridge';
import bundledPages from '../assets/data/mushaf-604.json';
import shamimTimings from '../assets/data/shamim-baqarah-timings.json';

type TimingMap = Record<string, { startMs: number; endMs: number }>;
const SHAMIM_MAP = shamimTimings as TimingMap;
const BUNDLED_MAP = bundledPages as Record<string, VerseEntry[]>;

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

export class PublicRecitationProvider implements RecitationProvider {
  private pageCache = new Map<number, VerseEntry[]>();

  constructor(private bridge: PlatformBridge) {
    for (const [pageStr, verses] of Object.entries(BUNDLED_MAP)) {
      this.pageCache.set(Number(pageStr), verses);
    }
  }

  /**
   * Synchronous cache lookup so Face A immediately displays true Surah Ayah numbers
   * (e.g., Page 2 -> 01-05, Page 3 -> 06-16, Page 45 -> 265-269) with zero flicker.
   */
  getCachedPageVerses(page: number): VerseEntry[] | null {
    return this.pageCache.get(page) ?? null;
  }

  /**
   * Proactively warms 001001.mp3 (Bismillah) for every EveryAyah reciter in Web/PWA mode.
   */
  async cacheAllReciterBismillahs(reciters: Reciter[]): Promise<void> {
    if (
      typeof window !== 'undefined' &&
      ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
    ) {
      return;
    }
    await Promise.allSettled(
      reciters
        .filter((r) => r.providerMode === 'everyayah')
        .map((r) => this.bridge.cacheAudio(`https://everyayah.com/data/${r.everyAyahDir}/001001.mp3`))
    );
  }

  async getPageVerses(page: number): Promise<VerseEntry[]> {
    const cached = this.pageCache.get(page);
    if (cached) return cached;

    const url = `https://api.alquran.cloud/v1/page/${page}/quran-uthmani`;
    const json = await this.bridge.cacheJson<{
      data?: { ayahs?: Array<{ surah: { number: number }; numberInSurah: number; text: string }> };
    }>(`page-${page}`, url);

    const verses: VerseEntry[] = (json?.data?.ayahs ?? []).map((a) => ({
      verseKey: `${a.surah.number}:${a.numberInSurah}`,
      surah: a.surah.number,
      ayah: a.numberInSurah,
      textUthmani: a.text
    }));
    if (verses.length > 0) this.pageCache.set(page, verses);
    return verses;
  }

  async buildAyahBundle(
    verse: VerseEntry,
    reciter: Reciter,
    localOverrideUrl?: string | null
  ): Promise<AyahBundle> {
    if (verse.isBismillah) {
      if (reciter.providerMode === 'local-baqarah') {
        const durationMs = SHAMIM_BISMILLAH_CLIP.endMs - SHAMIM_BISMILLAH_CLIP.startMs;
        // Use dedicated pre-sliced clip (/audio/shamim/002000.mp3) to avoid Android WebView seek bugs
        if (!localOverrideUrl) {
          return {
            verseKey: verse.verseKey,
            surah: verse.surah,
            ayah: 0,
            isBismillah: true,
            reciterId: reciter.id,
            audioUrl: '/audio/shamim/002000.mp3',
            clipStartSec: 0,
            clipEndSec: null,
            durationMs,
            words: synthesizeWordSegments(BISMILLAH_TEXT, durationMs, 0)
          };
        }
        return {
          verseKey: verse.verseKey,
          surah: verse.surah,
          ayah: 0,
          isBismillah: true,
          reciterId: reciter.id,
          audioUrl: localOverrideUrl,
          clipStartSec: SHAMIM_BISMILLAH_CLIP.startMs / 1000,
          clipEndSec: SHAMIM_BISMILLAH_CLIP.endMs / 1000,
          durationMs,
          words: synthesizeWordSegments(BISMILLAH_TEXT, durationMs, 0)
        };
      }
      const bismillahUrl = `https://everyayah.com/data/${reciter.everyAyahDir}/001001.mp3`;
      const audioUrl = await this.bridge.cacheAudio(bismillahUrl);
      const provisionalMs = 5200;
      return {
        verseKey: verse.verseKey,
        surah: verse.surah,
        ayah: 0,
        isBismillah: true,
        reciterId: reciter.id,
        audioUrl,
        clipStartSec: 0,
        clipEndSec: null,
        durationMs: provisionalMs,
        words: synthesizeWordSegments(BISMILLAH_TEXT, provisionalMs, 0)
      };
    }

    if (reciter.providerMode === 'local-baqarah' && verse.surah === 2) {
      const seg = SHAMIM_MAP[verse.verseKey];
      if (seg) {
        const durationMs = seg.endMs - seg.startMs;
        // Dedicated per-ayah MP3 clip (002001.mp3..002010.mp3) -> zero seek-reset on Android WebView
        if (!localOverrideUrl && verse.ayah >= 1 && verse.ayah <= 10) {
          return {
            verseKey: verse.verseKey,
            surah: verse.surah,
            ayah: verse.ayah,
            reciterId: reciter.id,
            audioUrl: `/audio/shamim/002${pad3(verse.ayah)}.mp3`,
            clipStartSec: 0,
            clipEndSec: null,
            durationMs,
            words: synthesizeWordSegments(verse.textUthmani, durationMs, 0)
          };
        }
        return {
          verseKey: verse.verseKey,
          surah: verse.surah,
          ayah: verse.ayah,
          reciterId: reciter.id,
          audioUrl: localOverrideUrl || reciter.localAudioPath || '/audio/baqarah-preview.mp3',
          clipStartSec: seg.startMs / 1000,
          clipEndSec: seg.endMs / 1000,
          durationMs,
          words: synthesizeWordSegments(verse.textUthmani, durationMs, 0)
        };
      }
    }

    const remoteUrl = `https://everyayah.com/data/${reciter.everyAyahDir}/${pad3(verse.surah)}${pad3(verse.ayah)}.mp3`;
    const audioUrl = await this.bridge.cacheAudio(remoteUrl);
    const provisionalMs = Math.max(3200, verse.textUthmani.length * 115);

    return {
      verseKey: verse.verseKey,
      surah: verse.surah,
      ayah: verse.ayah,
      reciterId: reciter.id,
      audioUrl,
      clipStartSec: 0,
      clipEndSec: null,
      durationMs: provisionalMs,
      words: synthesizeWordSegments(verse.textUthmani, provisionalMs, 0)
    };
  }
}
