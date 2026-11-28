import React, { useMemo, useState } from 'react';
import surahsJson from '../assets/data/surahs-114.json';

export interface SurahMeta {
  id: number;
  arabic: string;
  english: string;
  ayahs: number;
  startPage: number;
}

const SURAHS = surahsJson as SurahMeta[];

interface SurahDrawerProps {
  open: boolean;
  currentPage: number;
  selectedSurahId: number | null;
  playbackMode: 'page' | 'surah';
  onChangeMode: (mode: 'page' | 'surah') => void;
  onSelectSurah: (surahId: number, startPage: number) => void;
  onClose: () => void;
}

export const SurahDrawer: React.FC<SurahDrawerProps> = ({
  open,
  currentPage,
  selectedSurahId,
  playbackMode,
  onChangeMode,
  onSelectSurah,
  onClose
}) => {
  const [query, setQuery] = useState('');

  const activeSurahId = useMemo(() => {
    if (selectedSurahId !== null) return selectedSurahId;
    let match = SURAHS[0];
    for (const s of SURAHS) {
      if (s.startPage <= currentPage) match = s;
      else break;
    }
    return match.id;
  }, [currentPage, selectedSurahId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SURAHS;
    return SURAHS.filter(
      (s) => String(s.id) === q || s.english.toLowerCase().includes(q) || s.arabic.includes(q)
    );
  }, [query]);

  return (
    <div className={`surah-sheet ${open ? 'open' : ''}`} aria-label="All 114 Surahs">
      <div className="surah-sheet-head">
        <img src="/favicon.png" alt="Logo" className="sheet-logo" />
        <input
          type="text"
          className="surah-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search 114 Surahs (e.g. Baqarah, 36, يس)..."
        />
        <button type="button" className="surah-close-btn" onClick={onClose}>
          ESC
        </button>
      </div>
      <div className="mode-bar" role="group" aria-label="Playback Scope Mode">
        <button
          type="button"
          className={`mode-pill ${playbackMode === 'page' ? 'active' : ''}`}
          onClick={() => onChangeMode('page')}
        >
          Page Range Mode
        </button>
        <button
          type="button"
          className={`mode-pill ${playbackMode === 'surah' ? 'active' : ''}`}
          onClick={() => onChangeMode('surah')}
        >
          Full Surah Mode
        </button>
      </div>
      <div className="surah-list">
        {filtered.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`surah-item ${s.id === activeSurahId ? 'current' : ''}`}
            onClick={() => {
              onSelectSurah(s.id, s.startPage);
              onClose();
            }}
          >
            <span className="surah-num">{String(s.id).padStart(3, '0')}</span>
            <span className="surah-en">{s.english}</span>
            <span className="surah-ar">{s.arabic}</span>
            <span className="surah-meta">
              P.{String(s.startPage).padStart(3, '0')} · {s.ayahs}v
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};
