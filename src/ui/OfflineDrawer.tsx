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
  bridge: PlatformBridge;
  onSelectReciter: (id: number) => void;
  onClose: () => void;
}

export const OfflineDrawer: React.FC<OfflineDrawerProps> = ({
  open,
  reciters,
  currentPage,
  bridge,
  onSelectReciter,
  onClose
}) => {
  const [progress, setProgress] = useState<Record<number, number>>({});
  const [statusMap, setStatusMap] = useState<Record<number, string>>({});

  let curSurah = SURAHS[0];
  for (const s of SURAHS) {
    if (s.startPage <= currentPage) curSurah = s;
    else break;
  }

  const handleCacheSurah = async (rec: Reciter) => {
    setStatusMap((prev) => ({ ...prev, [rec.id]: `Caching ${curSurah.english}…` }));
    try {
      for (let a = 1; a <= curSurah.ayahs; a++) {
        const url = `https://everyayah.com/data/${rec.everyAyahDir}/${pad3(curSurah.id)}${pad3(a)}.mp3`;
        await bridge.cacheAudio(url);
        setProgress((prev) => ({ ...prev, [rec.id]: Math.round((a / curSurah.ayahs) * 100) }));
      }
      setStatusMap((prev) => ({ ...prev, [rec.id]: `Offline OK · ${curSurah.english}` }));
    } catch {
      setStatusMap((prev) => ({ ...prev, [rec.id]: 'Connect once to cache' }));
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
          const pct = progress[r.id] ?? 0;
          const note =
            statusMap[r.id] ??
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
