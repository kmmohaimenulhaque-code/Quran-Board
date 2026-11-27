import React, { useCallback, useMemo, useRef, useState } from 'react';
import recitersJson from './assets/data/reciters.json';
import type { Reciter } from './core/types';
import { formatTelemetryRange, slicePageVerses } from './core/mushaf-index';
import { useInstrumentStore } from './core/state-machine';
import { DualBufferAudioDeck } from './engine/audio-deck';
import { PublicRecitationProvider } from './engine/public-provider';
import { playMechanicalClick } from './engine/click-synth';
import { WebPlatformAdapter } from './platform/web-adapter';
import { Chassis } from './ui/Chassis';
import { ControlFace } from './ui/ControlFace';
import { RecitationSlate } from './ui/RecitationSlate';
import { useEdgeKeyboardShortcuts } from './ui/EdgeControls';

const RECITERS = recitersJson as Reciter[];

export const App: React.FC = () => {
  const store = useInstrumentStore();
  const [bezelPeek, setBezelPeek] = useState<string | null>('01 · Qari Muhammad Shamim · Al-Baqarah');
  const [peekError, setPeekError] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const speedSteps = [0.75, 1, 1.25, 1.5, 1.75, 2];
  const peekTimer = useRef<number | null>(null);

  const bridge = useMemo(() => new WebPlatformAdapter(), []);
  const provider = useMemo(() => new PublicRecitationProvider(bridge), [bridge]);

  const deckRef = useRef<DualBufferAudioDeck | null>(null);

  const showPeek = useCallback((msg: string, isErr = false) => {
    setBezelPeek(msg);
    setPeekError(isErr);
    if (peekTimer.current) window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setBezelPeek(null), 2200);
  }, []);

  const getDeck = useCallback(() => {
    if (!deckRef.current) {
      deckRef.current = new DualBufferAudioDeck({
        onWordChange: (w) => useInstrumentStore.getState().setActiveWord(w),
        onAyahEnded: () => {
          const s = useInstrumentStore.getState();
          const res = s.advanceAyah();
          if (res.nextPhase === 'PLAYING') {
            const b = s.bundles[res.nextAyahIdx];
            const nextB = s.bundles[res.nextAyahIdx + 1];
            if (b) void deckRef.current?.play(b, nextB);
          } else if (res.nextPhase === 'PASS_RESET') {
            window.setTimeout(() => {
              const latest = useInstrumentStore.getState();
              if (latest.phase !== 'PASS_RESET') return;
              latest.finishPassReset();
              const first = latest.bundles[0];
              if (first) void deckRef.current?.play(first, latest.bundles[1]);
            }, 450);
          } else {
            void bridge.releaseWakeLock();
          }
        }
      });
    }
    return deckRef.current;
  }, [bridge]);

  const handleStart = useCallback(async () => {
    const s = useInstrumentStore.getState();
    if (s.phase !== 'IDLE') return;
    playMechanicalClick(true);
    s.beginPrefetch();
    try {
      const verses = await provider.getPageVerses(s.page);
      const selected = slicePageVerses(verses, s.rangeStart, s.rangeEnd);
      const reciter = RECITERS[s.reciterId - 1] ?? RECITERS[0];
      const bundles = await Promise.all(selected.map((v) => provider.buildAyahBundle(v, reciter)));
      s.readyToFlip(bundles);
      window.setTimeout(() => {
        const latest = useInstrumentStore.getState();
        if (latest.phase !== 'FLIPPING_TO_SLATE') return;
        latest.enterPlaying();
        void bridge.acquireWakeLock();
        void getDeck().play(bundles[0], bundles[1]);
      }, 560);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load audio';
      s.failPrefetch(msg);
      showPeek(msg, true);
    }
  }, [bridge, getDeck, provider, showPeek]);

  const handleTogglePause = useCallback(() => {
    const s = useInstrumentStore.getState();
    playMechanicalClick(true);
    if (s.phase === 'PLAYING') {
      getDeck().pause();
      s.togglePause();
      void bridge.releaseWakeLock();
    } else if (s.phase === 'PAUSED') {
      s.togglePause();
      void bridge.acquireWakeLock();
      void getDeck().resume();
    }
  }, [bridge, getDeck]);

  const handleStopAndFlip = useCallback(() => {
    const s = useInstrumentStore.getState();
    if (s.phase === 'IDLE') return;
    playMechanicalClick(true);
    getDeck().stop();
    void bridge.releaseWakeLock();
    s.stopAndFlip();
    window.setTimeout(() => {
      useInstrumentStore.getState().finishFlipToControl();
    }, 560);
  }, [bridge, getDeck]);

  useEdgeKeyboardShortcuts({
    phase: store.phase,
    onStart: handleStart,
    onTogglePause: handleTogglePause,
    onStopAndFlip: handleStopAndFlip
  });

  const flipped =
    store.phase === 'FLIPPING_TO_SLATE' ||
    store.phase === 'PLAYING' ||
    store.phase === 'PAUSED' ||
    store.phase === 'PASS_RESET' ||
    store.phase === 'COMPLETED';

  const currentReciter = RECITERS[store.reciterId - 1] ?? RECITERS[0];
  const verseSpan = formatTelemetryRange(
    store.bundles.map((b) => ({ verseKey: b.verseKey, surah: b.surah, ayah: b.ayah, textUthmani: '' }))
  );
  const telemetryLeft = `PASS ${String(store.currentPass).padStart(2, '0')}/${String(
    store.repetition
  ).padStart(2, '0')} · P.${String(store.page).padStart(2, '0')} · ${verseSpan}`;

  const handleCycleSpeed = useCallback(() => {
    playMechanicalClick();
    setPlaybackRate((prev) => {
      const next = speedSteps[(speedSteps.indexOf(prev) + 1) % speedSteps.length];
      getDeck().setPlaybackRate(next);
      return next;
    });
  }, [getDeck]);

  return (
    <Chassis
      flipped={flipped}
      onSelectFaceA={handleStopAndFlip}
      onSelectFaceB={handleStart}
    >
      <ControlFace
        reciterId={store.reciterId}
        page={store.page}
        rangeStart={store.rangeStart}
        rangeEnd={store.rangeEnd}
        rangeFocus={store.rangeFocus}
        repetition={store.repetition}
        bezelPeek={bezelPeek}
        isError={peekError}
        prefetching={store.phase === 'PREFETCHING'}
        onStepReciter={(d) => {
          store.stepReciter(d);
          const next = RECITERS[useInstrumentStore.getState().reciterId - 1];
          if (next) showPeek(`${String(next.id).padStart(2, '0')} · ${next.name}`);
        }}
        onStepPage={(d) => {
          const nextPage = Math.max(1, Math.min(604, store.page + d));
          store.setPage(nextPage, store.pageMaxVerse);
          void provider.getPageVerses(nextPage).then((vs) => {
            if (vs.length > 0) useInstrumentStore.getState().setPage(nextPage, vs.length);
          });
        }}
        onStepRange={(d) => store.stepRange(d)}
        onFocusRange={(f) => store.setRangeFocus(f)}
        onStepRepetition={(d) => store.setRepetition(store.repetition + d)}
        onStart={handleStart}
      />

      <RecitationSlate
        bundles={store.bundles}
        currentAyahIdx={store.currentAyahIdx}
        activeWordIndex={store.activeWordIndex}
        phase={store.phase}
        telemetryLeft={telemetryLeft}
        telemetryRight={currentReciter.shortName}
        playbackRate={playbackRate}
        onCycleSpeed={handleCycleSpeed}
        onTogglePause={handleTogglePause}
        onStopAndFlip={handleStopAndFlip}
      />
    </Chassis>
  );
};

export default App;
