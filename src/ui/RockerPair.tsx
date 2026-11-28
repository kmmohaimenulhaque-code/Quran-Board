import React, { useCallback, useEffect, useRef } from 'react';
import { playMechanicalClick } from '../engine/click-synth';

interface RockerPairProps {
  label: string;
  onStep: (delta: 1 | -1) => void;
}

export const RockerPair: React.FC<RockerPairProps> = ({ label, onStep }) => {
  const holdRef = useRef<number | null>(null);
  const fastRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (holdRef.current) window.clearTimeout(holdRef.current);
    if (fastRef.current) window.clearTimeout(fastRef.current);
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    holdRef.current = null;
    fastRef.current = null;
    intervalRef.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const startHold = (delta: 1 | -1) => (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    clearTimers();
    playMechanicalClick();
    onStep(delta);

    const stop = () => {
      clearTimers();
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('blur', stop);
    };
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
    window.addEventListener('blur', stop, { once: true });

    holdRef.current = window.setTimeout(() => {
      intervalRef.current = window.setInterval(() => {
        playMechanicalClick();
        onStep(delta);
      }, 110);
      fastRef.current = window.setTimeout(() => {
        if (intervalRef.current) window.clearInterval(intervalRef.current);
        intervalRef.current = window.setInterval(() => {
          playMechanicalClick();
          onStep(delta);
        }, 45);
      }, 1000);
    }, 380);
  };

  return (
    <div className="rocker-pair">
      <button
        type="button"
        className="rocker-btn"
        aria-label={`Increase ${label}`}
        onPointerDown={startHold(1)}
        onPointerUp={clearTimers}
        onPointerCancel={clearTimers}
      >
        <svg viewBox="0 0 10 8">
          <path d="M5 1L9 7H1L5 1Z" />
        </svg>
      </button>
      <button
        type="button"
        className="rocker-btn"
        aria-label={`Decrease ${label}`}
        onPointerDown={startHold(-1)}
        onPointerUp={clearTimers}
        onPointerCancel={clearTimers}
      >
        <svg viewBox="0 0 10 8">
          <path d="M5 7L1 1H9L5 7Z" />
        </svg>
      </button>
    </div>
  );
};
