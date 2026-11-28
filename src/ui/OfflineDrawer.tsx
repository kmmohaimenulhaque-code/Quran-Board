import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Reciter } from '../core/types';
import surahsJson from '../assets/data/surahs-114.json';
import type { PlatformBridge } from '../platform/bridge';

interface SurahItem {
  id: number;
  english: string;
  ayahs: number;
  startPage: number;
}

const SURAHS = surahsJson as SurahItem[];
const TOTAL_SURAHS = SURAHS.length;
const TOTAL_AYAHS = SURAHS.reduce((acc, s) => acc + s.ayahs, 0);
const CACHE_MANIFEST_KEY = 'quran-instrument-cached-surahs-v2';

type CachedManifest = Record<string, Record<string, boolean>>;

interface FullQuranProgress {
  running: boolean;
  currentSurahId: number;
  currentSurahName: string;
  currentSurahPct: number;
  completedSurahs: number;
  statusNote: string;
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

function loadManifest(): CachedManifest {
  try {
    const raw = localStorage.getItem(CACHE_MANIFEST_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as CachedManifest;
  } catch {
    return {};
  }
}

function saveManifest(m: CachedManifest): void {
  try {
    localStorage.setItem(CACHE_MANIFEST_KEY, JSON.stringify(m));
  } catch {
    // Ignore quota errors
  }
}

function buildAyahUrl(rec: Reciter, surahId: number, ayahNum: number): string | null {
  // Reciter 01 (Qari Muhammad Shamim) has 2:1-10 embedded locally in /audio/shamim/
  if (rec.providerMode === 'local-baqarah' && surahId === 2 && ayahNum >= 1 && ayahNum <= 10) {
    return null;
  }
  return `https://everyayah.com/data/${rec.everyAyahDir}/${pad3(surahId)}${pad3(ayahNum)}.mp3`;
}

interface OfflineDrawerProps {
  open: boolean;
  reciters: Reciter[];
  currentPage: number;
  selectedSurahId: number | null;
  bridge: PlatformBridge;
  onSelectReciter: (id: number) => void;
  onClose: () => void;
}

export const OfflineDrawer: React.FC<OfflineDrawerProps> = ({
  open,
  reciters,
  currentPage,
  selectedSurahId,
  bridge,
  onSelectReciter,
  onClose
}) => {
  const [manifest, setManifest] = useState<CachedManifest>(() => loadManifest());
  const [singlePct, setSinglePct] = useState<Record<string, number>>({});
  const [singleNote, setSingleNote] = useState<Record<string, string>>({});
  const [singleRunning, setSingleRunning] = useState<Record<string, boolean>>({});
  const [fullState, setFullState] = useState<Record<number, FullQuranProgress>>({});

  const singleAbortRefs = useRef<Record<string, AbortController>>({});
  const fullAbortRefs = useRef<Record<number, AbortController>>({});

  let curSurah = selectedSurahId ? SURAHS[selectedSurahId - 1] ?? SURAHS[0] : SURAHS[0];
  if (!selectedSurahId) {
    for (const s of SURAHS) {
      if (s.startPage <= currentPage) curSurah = s;
      else break;
    }
  }

  // Request persistent storage once when the Offline drawer opens
  useEffect(() => {
    if (open) {
      void bridge.requestPersistentStorage();
    }
  }, [open, bridge]);

  const markSurahCached = useCallback((reciterId: number, surahId: number) => {
    setManifest((prev) => {
      const rKey = String(reciterId);
      const nextRec = { ...(prev[rKey] ?? {}), [String(surahId)]: true };
      const next = { ...prev, [rKey]: nextRec };
      saveManifest(next);
      return next;
    });
  }, []);

  const isSurahMarkedCached = useCallback(
    (reciterId: number, surahId: number): boolean => Boolean(manifest[String(reciterId)]?.[String(surahId)]),
    [manifest]
  );

  const countCachedSurahs = useCallback(
    (reciterId: number): number => Object.keys(manifest[String(reciterId)] ?? {}).length,
    [manifest]
  );

  const downloadSingleSurah = useCallback(
    async (
      rec: Reciter,
      surah: SurahItem,
      signal: AbortSignal,
      onAyahProgress?: (done: number, total: number) => void
    ): Promise<{ succeeded: number; total: number; aborted: boolean }> => {
      const urls: string[] = [];
      if (surah.id !== 1 && surah.id !== 9) {
        if (rec.providerMode !== 'local-baqarah') {
          urls.push(`https://everyayah.com/data/${rec.everyAyahDir}/001001.mp3`);
        }
      }
      for (let a = 1; a <= surah.ayahs; a++) {
        const u = buildAyahUrl(rec, surah.id, a);
        if (u) urls.push(u);
      }

      if (urls.length === 0) {
        onAyahProgress?.(surah.ayahs, surah.ayahs);
        return { succeeded: surah.ayahs, total: surah.ayahs, aborted: false };
      }

      let done = 0;
      let succeeded = 0;
      const total = urls.length;
      const concurrency = 4;

      for (let i = 0; i < total; i += concurrency) {
        if (signal.aborted) {
          return { succeeded, total, aborted: true };
        }
        const batch = urls.slice(i, i + concurrency);
        const results = await Promise.all(
          batch.map((u) => bridge.downloadForOffline(u, signal))
        );
        for (const ok of results) {
          done += 1;
          if (ok) succeeded += 1;
        }
        onAyahProgress?.(done, total);
      }

      return { succeeded, total, aborted: signal.aborted };
    },
    [bridge]
  );

  const handleToggleSingleSurah = async (rec: Reciter) => {
    const key = `${rec.id}-${curSurah.id}`;
    if (singleRunning[key]) {
      singleAbortRefs.current[key]?.abort();
      setSingleRunning((prev) => ({ ...prev, [key]: false }));
      setSingleNote((prev) => ({ ...prev, [key]: `Paused · S.${curSurah.id} ${curSurah.english}` }));
      return;
    }

    const ac = new AbortController();
    singleAbortRefs.current[key] = ac;
    setSingleRunning((prev) => ({ ...prev, [key]: true }));
    setSinglePct((prev) => ({ ...prev, [key]: 0 }));
    setSingleNote((prev) => ({
      ...prev,
      [key]: `Caching S.${curSurah.id} ${curSurah.english} (0/${curSurah.ayahs})…`
    }));

    try {
      const res = await downloadSingleSurah(rec, curSurah, ac.signal, (done, total) => {
        setSinglePct((prev) => ({ ...prev, [key]: Math.round((done / total) * 100) }));
        setSingleNote((prev) => ({
          ...prev,
          [key]: `Caching S.${curSurah.id} ${curSurah.english} (${done}/${total})…`
        }));
      });

      if (res.aborted) return;

      if (res.succeeded === res.total) {
        markSurahCached(rec.id, curSurah.id);
        setSinglePct((prev) => ({ ...prev, [key]: 100 }));
        setSingleNote((prev) => ({
          ...prev,
          [key]: `Saved offline · S.${curSurah.id} ${curSurah.english} (${curSurah.ayahs}v)`
        }));
      } else if (res.succeeded > 0) {
        setSingleNote((prev) => ({
          ...prev,
          [key]: `Partial (${res.succeeded}/${res.total}) · Tap to resume online`
        }));
      } else {
        setSinglePct((prev) => ({ ...prev, [key]: 0 }));
        setSingleNote((prev) => ({
          ...prev,
          [key]: 'Offline — connect to internet to cache this Surah'
        }));
      }
    } finally {
      setSingleRunning((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleToggleFullQuran = async (rec: Reciter) => {
    const existing = fullState[rec.id];
    if (existing?.running) {
      fullAbortRefs.current[rec.id]?.abort();
      setFullState((prev) => ({
        ...prev,
        [rec.id]: {
          ...(prev[rec.id] ?? {
            currentSurahId: 1,
            currentSurahName: SURAHS[0].english,
            currentSurahPct: 0,
            completedSurahs: countCachedSurahs(rec.id)
          }),
          running: false,
          statusNote: `Paused at ${countCachedSurahs(rec.id)}/${TOTAL_SURAHS} Surahs · Tap to resume`
        }
      }));
      return;
    }

    const ac = new AbortController();
    fullAbortRefs.current[rec.id] = ac;
    void bridge.requestPersistentStorage();

    let completed = countCachedSurahs(rec.id);
    setFullState((prev) => ({
      ...prev,
      [rec.id]: {
        running: true,
        currentSurahId: 1,
        currentSurahName: SURAHS[0].english,
        currentSurahPct: 0,
        completedSurahs: completed,
        statusNote: `Starting Full Quran (${completed}/${TOTAL_SURAHS} Surahs saved)…`
      }
    }));

    let networkFailures = 0;
    for (const surah of SURAHS) {
      if (ac.signal.aborted) break;
      if (isSurahMarkedCached(rec.id, surah.id)) continue;

      setFullState((prev) => ({
        ...prev,
        [rec.id]: {
          running: true,
          currentSurahId: surah.id,
          currentSurahName: surah.english,
          currentSurahPct: 0,
          completedSurahs: completed,
          statusNote: `S.${String(surah.id).padStart(3, '0')}/${TOTAL_SURAHS} ${surah.english} (0/${surah.ayahs})…`
        }
      }));

      const res = await downloadSingleSurah(rec, surah, ac.signal, (done, total) => {
        const sPct = Math.round((done / total) * 100);
        setFullState((prev) => ({
          ...prev,
          [rec.id]: {
            running: true,
            currentSurahId: surah.id,
            currentSurahName: surah.english,
            currentSurahPct: sPct,
            completedSurahs: completed,
            statusNote: `S.${String(surah.id).padStart(3, '0')}/${TOTAL_SURAHS} ${surah.english} · ${sPct}%`
          }
        }));
      });

      if (res.aborted) break;

      if (res.succeeded === res.total) {
        markSurahCached(rec.id, surah.id);
        completed += 1;
        networkFailures = 0;
      } else {
        networkFailures += 1;
        if (networkFailures >= 2) {
          setFullState((prev) => ({
            ...prev,
            [rec.id]: {
              running: false,
              currentSurahId: surah.id,
              currentSurahName: surah.english,
              currentSurahPct: 0,
              completedSurahs: completed,
              statusNote: `Network offline at S.${surah.id} (${completed}/${TOTAL_SURAHS} saved) · Tap to resume`
            }
          }));
          return;
        }
      }
    }

    if (!ac.signal.aborted) {
      const finalCount = Math.min(TOTAL_SURAHS, completed);
      setFullState((prev) => ({
        ...prev,
        [rec.id]: {
          running: false,
          currentSurahId: TOTAL_SURAHS,
          currentSurahName: SURAHS[TOTAL_SURAHS - 1].english,
          currentSurahPct: finalCount === TOTAL_SURAHS ? 100 : 0,
          completedSurahs: finalCount,
          statusNote:
            finalCount === TOTAL_SURAHS
              ? `Full Quran Offline OK · All 114 Surahs (${TOTAL_AYAHS} ayahs)`
              : `Saved ${finalCount}/${TOTAL_SURAHS} Surahs · Tap to resume`
        }
      }));
    }
  };

  return (
    <div className={`surah-sheet ${open ? 'open' : ''}`} aria-label="Offline Audio Storage">
      <div className="surah-sheet-head">
        <img src="/favicon.png" alt="Logo" className="sheet-logo" />
        <span
          style={{
            flex: 1,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: '10.5px',
            letterSpacing: '0.07em',
            color: '#7AD8F5',
            textTransform: 'uppercase'
          }}
        >
          Offline Audio · Persistent Cache
        </span>
        <button type="button" className="surah-close-btn" onClick={onClose}>
          ESC
        </button>
      </div>

      <div className="surah-list">
        <div className="offline-section-label">
          ACTIVE SURAH · S.{curSurah.id} {curSurah.english.toUpperCase()} ({curSurah.ayahs} AYAHS)
        </div>

        {reciters.map((r) => {
          const key = `${r.id}-${curSurah.id}`;
          const cached = isSurahMarkedCached(r.id, curSurah.id);
          const running = Boolean(singleRunning[key]);
          const pct = cached && !running ? 100 : singlePct[key] ?? 0;
          const defaultSub =
            r.id === 1
              ? curSurah.id === 2
                ? `Caches S.2 Al-Baqarah (2:1–10 embedded Shamim + rest)`
                : `Caches S.${curSurah.id} ${curSurah.english} (${curSurah.ayahs}v · Shamim profile)`
              : `Caches only S.${curSurah.id} ${curSurah.english} (${curSurah.ayahs} ayahs)`;
          const note =
            singleNote[key] ??
            (cached ? `Saved offline · S.${curSurah.id} ${curSurah.english}` : defaultSub);

          return (
            <div key={`single-${r.id}`} className="offline-card">
              <div className="offline-card-top">
                <div style={{ cursor: 'pointer', minWidth: 0, flex: 1 }} onClick={() => onSelectReciter(r.id)}>
                  <div className="offline-name">
                    {String(r.id).padStart(2, '0')} · {r.name}
                  </div>
                  <div className="offline-sub">{note}</div>
                </div>
                <button
                  type="button"
                  className={`offline-dl-btn ${cached && !running ? 'done' : ''} ${running ? 'running' : ''}`}
                  onClick={() => void handleToggleSingleSurah(r)}
                >
                  {running ? 'Pause' : cached ? 'Offline OK' : `Cache S.${curSurah.id}`}
                </button>
              </div>
              <div className="offline-progress-track">
                <div className="offline-progress-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}

        <div className="offline-section-label" style={{ marginTop: '14px' }}>
          FULL QURAN OFFLINE · ALL 114 SURAHS ({TOTAL_AYAHS} AYAHS)
        </div>

        {reciters.map((r) => {
          const savedCount = countCachedSurahs(r.id);
          const fs = fullState[r.id];
          const running = Boolean(fs?.running);
          const isAllDone = savedCount >= TOTAL_SURAHS;
          const overallPct = Math.round((savedCount / TOTAL_SURAHS) * 100);
          const subText =
            fs?.statusNote ??
            (isAllDone
              ? `Full Quran Offline OK · 114/114 Surahs saved`
              : r.id === 1
              ? `All 114 Surahs · Shamim 2:1–10 embedded + full cache (${savedCount}/114)`
              : `All 114 Surahs (${savedCount}/${TOTAL_SURAHS} cached · resumable)`);

          return (
            <div key={`full-${r.id}`} className="offline-card offline-card-full">
              <div className="offline-card-top">
                <div style={{ cursor: 'pointer', minWidth: 0, flex: 1 }} onClick={() => onSelectReciter(r.id)}>
                  <div className="offline-name">
                    {String(r.id).padStart(2, '0')} · {r.name} (All 114)
                  </div>
                  <div className="offline-sub">{subText}</div>
                </div>
                <button
                  type="button"
                  className={`offline-dl-btn ${isAllDone && !running ? 'done' : ''} ${running ? 'running' : ''}`}
                  onClick={() => void handleToggleFullQuran(r)}
                >
                  {running
                    ? 'Pause'
                    : isAllDone
                    ? '114/114 OK'
                    : savedCount > 0
                    ? `Resume ${savedCount}/114`
                    : 'Cache All 114'}
                </button>
              </div>
              {/* Overall 114-Surah progress bar */}
              <div className="offline-progress-track">
                <div className="offline-progress-fill" style={{ width: `${overallPct}%` }} />
              </div>
              {/* Active Surah sub-progress bar while downloading */}
              {running && fs && (
                <div className="offline-sub-progress">
                  <span className="offline-sub-label">
                    S.{String(fs.currentSurahId).padStart(3, '0')} {fs.currentSurahName}
                  </span>
                  <div className="offline-progress-track mini">
                    <div className="offline-progress-fill cyan" style={{ width: `${fs.currentSurahPct}%` }} />
                  </div>
                  <span className="offline-sub-pct">{fs.currentSurahPct}%</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
