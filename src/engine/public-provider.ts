import type { AyahBundle, Reciter, VerseEntry } from '../core/types';
import type { RecitationProvider } from './provider';
import { synthesizeWordSegments } from '../core/sync-resolver';
import { BISMILLAH_TEXT, SHAMIM_BISMILLAH_CLIP } from '../core/bismillah';
import type { PlatformBridge } from '../platform/bridge';
import bundledPages from '../assets/data/mushaf-604.json';
import surahsJson from '../assets/data/surahs-114.json';
import shamimTimings from '../assets/data/shamim-baqarah-timings.json';

type TimingMap = Record<string, { startMs: number; endMs: number }>;
const SHAMIM_MAP = shamimTimings as TimingMap;
const BUNDLED_MAP = bundledPages as Record<string, VerseEntry[]>;
const SURAHS_META = surahsJson as Array<{ id: number; ayahs: number; startPage: number }>;

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

export class PublicRecitationProvider implements RecitationProvider {
  private pageCache = new Map<number, VerseEntry[]>();
  private surahCache = new Map<number, VerseEntry[]>();
  private resolvedAudioCache = new Map<string, string>();

  constructor(private bridge: PlatformBridge) {
    for (const [pageStr, verses] of Object.entries(BUNDLED_MAP)) {
      this.pageCache.set(Number(pageStr), verses);
    }
  }

  getCachedPageVerses(page: number): VerseEntry[] | null {
    return this.pageCache.get(page) ?? null;
  }

  getCachedSurahVerses(surahId: number): VerseEntry[] | null {
    const existing = this.surahCache.get(surahId);
    if (existing) return existing;
    const meta = SURAHS_META[surahId - 1];
    if (!meta) return null;

    const collected: VerseEntry[] = [];
    const nextStart = SURAHS_META[surahId]?.startPage ?? 604;
    const endPage = Math.min(604, Math.max(meta.startPage, nextStart));
    for (let p = meta.startPage; p <= endPage; p++) {
      const pv = this.pageCache.get(p);
      if (!pv) return null;
      for (const v of pv) {
        if (v.surah === surahId) collected.push(v);
      }
    }
    if (collected.length === meta.ayahs) {
      this.surahCache.set(surahId, collected);
      return collected;
    }
    return null;
  }

  async getSurahVerses(surahId: number): Promise<VerseEntry[]> {
    const cached = this.getCachedSurahVerses(surahId);
    if (cached && cached.length > 0) return cached;

    const url = `https://api.alquran.cloud/v1/surah/${surahId}/quran-uthmani`;
    const json = await this.bridge.cacheJson<{
      data?: { ayahs?: Array<{ numberInSurah: number; text: string }> };
    }>(`surah-${surahId}`, url);

    const verses: VerseEntry[] = (json?.data?.ayahs ?? []).map((a) => ({
      verseKey: `${surahId}:${a.numberInSurah}`,
      surah: surahId,
      ayah: a.numberInSurah,
      textUthmani: a.text
    }));
    if (verses.length > 0) this.surahCache.set(surahId, verses);
    return verses;
  }

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

  /**
   * Synchronous zero-latency bundle builder so clicking FACE B on 286-ayah Al-Baqarah
   * flips in <50ms without running 286 parallel Cache API lookups up front.
   */
  buildProvisionalBundle(
    verse: VerseEntry,
    reciter: Reciter,
    localOverrideUrl?: string | null
  ): AyahBundle {
    if (verse.isBismillah) {
      if (reciter.providerMode === 'local-baqarah') {
        const durationMs = SHAMIM_BISMILLAH_CLIP.endMs - SHAMIM_BISMILLAH_CLIP.startMs;
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
      const provisionalMs = 5200;
      return {
        verseKey: verse.verseKey,
        surah: verse.surah,
        ayah: 0,
        isBismillah: true,
        reciterId: reciter.id,
        audioUrl: bismillahUrl,
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
    const provisionalMs = Math.max(3200, verse.textUthmani.length * 115);

    return {
      verseKey: verse.verseKey,
      surah: verse.surah,
      ayah: verse.ayah,
      reciterId: reciter.id,
      audioUrl: remoteUrl,
      clipStartSec: 0,
      clipEndSec: null,
      durationMs: provisionalMs,
      words: synthesizeWordSegments(verse.textUthmani, provisionalMs, 0)
    };
  }

  /**
   * Resolves a single bundle's audio URL just-in-time:
   * - Local /audio/... assets are fetched into cached in-memory blob: URLs so Linux WebKitGTK
   *   GStreamer never rejects Tauri's custom tauri:// protocol.
   * - Remote https:// URLs check persistent Cache API via bridge.cacheAudio().
   */
  async resolveBundleAudio(bundle: AyahBundle): Promise<AyahBundle> {
    const raw = bundle.audioUrl;
    if (!raw || raw.startsWith('blob:') || raw.startsWith('data:')) {
      return bundle;
    }

    const memHit = this.resolvedAudioCache.get(raw);
    if (memHit) {
      bundle.audioUrl = memHit;
      return bundle;
    }

    if (raw.startsWith('/audio/')) {
      try {
        const resp = await fetch(raw);
        if (resp.ok) {
          const blob = await resp.blob();
          const blobUrl = URL.createObjectURL(blob);
          this.resolvedAudioCache.set(raw, blobUrl);
          bundle.audioUrl = blobUrl;
        }
      } catch {
        // Fallback to original relative path
      }
      return bundle;
    }

    const resolved = await this.bridge.cacheAudio(raw);
    if (resolved.startsWith('blob:')) {
      this.resolvedAudioCache.set(raw, resolved);
    }
    bundle.audioUrl = resolved;
    return bundle;
  }

  async buildAyahBundle(
    verse: VerseEntry,
    reciter: Reciter,
    localOverrideUrl?: string | null
  ): Promise<AyahBundle> {
    const bundle = this.buildProvisionalBundle(verse, reciter, localOverrideUrl);
    return this.resolveBundleAudio(bundle);
  }
}
