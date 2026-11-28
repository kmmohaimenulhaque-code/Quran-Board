import React, { useState } from 'react';
import type { Reciter } from '../core/types';
import surahsJson from '../assets/data/surahs-114.json';
import type { PlatformBridge } from '../platform/bridge';

const SURAHS = surahsJson as Array<{ id: number; english: string; ayahs: number; startPage: number }>;

function pad3(n: number): string {
  return String(n).padStart(3, '0');
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
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [statusMap, setStatusMap] = useState<Record<string, string>>({});

  let curSurah = selectedSurahId ? SURAHS[selectedSurahId - 1] ?? SURAHS[0] : SURAHS[0];
  if (!selectedSurahId) {
    for (const s of SURAHS) {
      if (s.startPage <= currentPage) curSurah = s;
      else break;
    }
  }

  const handleCacheSurah = async (rec: Reciter) => {
    const key = `${rec.id}-${curSurah.id}`;
    if (rec.providerMode === 'local-baqarah' && curSurah.id === 2) {
      setProgress((prev) => ({ ...prev, [key]: 100 }));
      setStatusMap((prev) => ({ ...prev, [key]: 'Embedded Offline · Al-Baqarah 2:1–10' }));
      return;
    }

    setProgress((prev) => ({ ...prev, [key]: 0 }));
    setStatusMap((prev) => ({ ...prev, [key]: `Caching ${curSurah.english}…` }));
    let succeeded = 0;
    try {
      // Cache Bismillah first for Surahs other than 1 and 9
      if (curSurah.id !== 1 && curSurah.id !== 9) {
        const bisUrl = `https://everyayah.com/data/${rec.everyAyahDir}/001001.mp3`;
        await bridge.downloadForOffline(bisUrl);
      }
      for (let a = 1; a <= curSurah.ayahs; a++) {
        const url = `https://everyayah.com/data/${rec.everyAyahDir}/${pad3(curSurah.id)}${pad3(a)}.mp3`;
        const ok = await bridge.downloadForOffline(url);
        if (ok) succeeded++;
        setProgress((prev) => ({ ...prev, [key]: Math.round((a / curSurah.ayahs) * 100) }));
      }
      if (succeeded === curSurah.ayahs) {
        setStatusMap((prev) => ({ ...prev, [key]: `Offline OK · ${curSurah.english}` }));
      } else if (succeeded > 0) {
        setStatusMap((prev) => ({ ...prev, [key]: `Partial (${succeeded}/${curSurah.ayahs}) · Retry online` }));
      } else {
        setProgress((prev) => ({ ...prev, [key]: 0 }));
        setStatusMap((prev) => ({ ...prev, [key]: 'Unavailable offline — use Opus Pack or retry online' }));
      }
    } catch {
      setProgress((prev) => ({ ...prev, [key]: 0 }));
      setStatusMap((prev) => ({ ...prev, [key]: 'Connect once to cache' }));
    }
  };

  return (
    <div className={`surah-sheet ${open ? 'open' : ''}`} aria-label="Offline Audio Packs">
      <div className="surah-sheet-head">
        <img src="/favicon.png" alt="Logo" className="sheet-logo" />
        <span
          style={{
            flex: 1,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: '11px',
            letterSpacing: '0.08em',
            color: '#7AD8F5',
            textTransform: 'uppercase'
          }}
        >
          6 Shaikhs · 24k Opus Offline
        </span>
        <button type="button" className="surah-close-btn" onClick={onClose}>
          ESC
        </button>
      </div>
      <div className="surah-list">
        {reciters.map((r) => {
          const key = `${r.id}-${curSurah.id}`;
          const pct = progress[key] ?? 0;
          const note =
            statusMap[key] ??
            (r.id === 1
              ? 'Embedded 2:1–10 · ~26 MB Opus full Baqarah'
              : 'EveryAyah Full 114 Surahs · ~260 MB at 24k Opus');
          return (
            <div key={r.id} className="offline-card">
              <div className="offline-card-top">
                <div style={{ cursor: 'pointer' }} onClick={() => onSelectReciter(r.id)}>
                  <div className="offline-name">
                    {String(r.id).padStart(2, '0')} · {r.name}
                  </div>
                  <div className="offline-sub">{note}</div>
                </div>
                <button
                  type="button"
                  className={`offline-dl-btn ${pct === 100 ? 'done' : ''}`}
                  onClick={() => void handleCacheSurah(r)}
                >
                  {pct === 100 ? 'Offline OK' : `Cache S.${curSurah.id}`}
                </button>
              </div>
              <div className="offline-progress-track">
                <div className="offline-progress-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
