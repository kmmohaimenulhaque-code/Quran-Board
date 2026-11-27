import React, { useEffect, useRef, useState } from 'react';
import type { AyahBundle, PlaybackPhase } from '../core/types';

function toArabicDigits(num: number): string {
  const map = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  return String(num).replace(/\d/g, (d) => map[Number(d)]);
}

interface RecitationSlateProps {
  bundles: AyahBundle[];
  currentAyahIdx: number;
  activeWordIndex: number;
  phase: PlaybackPhase;
  telemetryLeft: string;
  telemetryRight: string;
  playbackRate: number;
  onCycleSpeed: () => void;
  onStopAndFlip: () => void;
}

export const RecitationSlate: React.FC<RecitationSlateProps> = ({
  bundles,
  currentAyahIdx,
  activeWordIndex,
  phase,
  telemetryLeft,
  telemetryRight,
  playbackRate,
  onCycleSpeed,
  onStopAndFlip
}) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const [rowHeight, setRowHeight] = useState(74);

  useEffect(() => {
    const updateMetrics = () => {
      if (frameRef.current) setRowHeight(frameRef.current.clientHeight / 8);
    };
    updateMetrics();
    window.addEventListener('resize', updateMetrics);
    return () => window.removeEventListener('resize', updateMetrics);
  }, []);

  const fontSize = Math.max(18, Math.min(28, Math.round(rowHeight * 0.35)));

  return (
    <section className="slab-face face-b" aria-label="Recitation Slate">
      <button
        type="button"
        className={`speed-btn ${playbackRate !== 1 ? 'boosted' : ''}`}
        onClick={onCycleSpeed}
      >
        {playbackRate}×
      </button>
      <button type="button" className="flip-notch" onClick={onStopAndFlip}>
        ↺ DECK
      </button>

      <div className="slate-frame" ref={frameRef}>
        <div className="slate-grid-lines" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div key={idx} className="slate-grid-row" />
          ))}
        </div>

        <div className={`slate-text-viewport ${phase === 'PASS_RESET' ? 'fading' : ''}`}>
          <div
            className="slate-words-layer"
            dir="rtl"
            lang="ar"
            style={{ lineHeight: `${rowHeight.toFixed(2)}px`, fontSize: `${fontSize}px` }}
          >
            {bundles.map((bundle, aIdx) => {
              const medallionLit =
                aIdx < currentAyahIdx ||
                (aIdx === currentAyahIdx && activeWordIndex >= bundle.words.length);
              return (
                <React.Fragment key={bundle.verseKey}>
                  {bundle.words.map((w) => {
                    let cls = 'word-token';
                    if (aIdx < currentAyahIdx || (aIdx === currentAyahIdx && w.wordIndex < activeWordIndex)) {
                      cls += ' revealed';
                    } else if (aIdx === currentAyahIdx && w.wordIndex === activeWordIndex) {
                      cls += ' active';
                    }
                    return (
                      <React.Fragment key={`${bundle.verseKey}-${w.wordIndex}`}>
                        <span className={cls}>{w.textUthmani}</span>{' '}
                      </React.Fragment>
                    );
                  })}
                  {bundle.isBismillah ? (
                    <br />
                  ) : (
                    <>
                      <span className={`ayah-medallion ${medallionLit ? 'lit' : ''}`}>
                        ﴿{toArabicDigits(bundle.ayah)}﴾
                      </span>{' '}
                    </>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>

      <div className="face-b-bezel">
        <span className="telemetry-text">
          <span
            className={`slate-status-dot ${
              phase === 'PLAYING' ? 'playing' : phase === 'PAUSED' ? 'paused' : ''
            }`}
          />
          {telemetryLeft}
        </span>
        <span className="telemetry-text">{telemetryRight}</span>
      </div>
    </section>
  );
};
