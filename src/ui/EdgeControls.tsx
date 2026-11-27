import { useEffect } from 'react';
import type { PlaybackPhase } from '../core/types';

interface EdgeControlsProps {
  phase: PlaybackPhase;
  onStart: () => void;
  onTogglePause: () => void;
  onStopAndFlip: () => void;
}

export function useEdgeKeyboardShortcuts({
  phase,
  onStart,
  onTogglePause,
  onStopAndFlip
}: EdgeControlsProps): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (phase === 'IDLE') onStart();
        else onTogglePause();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        if (phase !== 'IDLE') onStopAndFlip();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, onStart, onTogglePause, onStopAndFlip]);
}
