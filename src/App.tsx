import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import recitersJson from './assets/data/reciters.json';
import surahsJson from './assets/data/surahs-114.json';
import type { Reciter } from './core/types';
import { formatTelemetryRange, slicePageVerses } from './core/mushaf-index';
import { expandVersesWithBismillah } from './core/bismillah';
import { useInstrumentStore } from './core/state-machine';
import { DualBufferAudioDeck } from './engine/audio-deck';
import { PublicRecitationProvider } from './engine/public-provider';
import { playMechanicalClick } from './engine/click-synth';
import { WebPlatformAdapter } from './platform/web-adapter';
import { Chassis, type ActiveTab } from './ui/Chassis';
import { ControlFace } from './ui/ControlFace';
import { RecitationSlate } from './ui/RecitationSlate';
import { SurahDrawer } from './ui/SurahDrawer';
import { OfflineDrawer } from './ui/OfflineDrawer';
import { useEdgeKeyboardShortcuts } from './ui/EdgeControls';

const RECITERS = recitersJson as Reciter[];
const SURAHS = surahsJson as Array<{ id: number; english: string; ayahs: number; startPage: number }>;
const SPEED_STEPS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export const App: React.FC = () => {
  const store = useInstrumentStore();
  const [bezelPeek, setBezelPeek] = useState<string | null>('01 · Qari Muhammad Shamim · Al-Baqarah');
  const [peekError, setPeekError] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playbackMode, setPlaybackMode] = useState<'page' | 'surah'>('page');
  const [openDrawer, setOpenDrawer] = useState<'none' | 'surahs' | 'offline'>('none');
  const [localMp3Url, setLocalMp3Url] = useState<string | null>(null);

  const peekTimer = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const didLongPress = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bridge = useMemo(() => new WebPlatformAdapter(), []);
  const provider = useMemo(() => new PublicRecitationProvider(bridge), [bridge]);

  useEffect(() => {
    void provider.cacheAllReciterBismillahs(RECITERS);
  }, [provider]);
  const deckRef = useRef<DualBufferAudioDeck | null>(null);

  const showPeek = useCallback((msg: string, isErr = false) => {
    setBezelPeek(msg);
    setPeekError(isErr);
    if (peekTimer.current) window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setBezelPeek(null), 2400);
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
    setOpenDrawer('none');
    const s = useInstrumentStore.getState();
    if (s.phase !== 'IDLE') return;
    playMechanicalClick(true);
    s.beginPrefetch();
    try {
      const verses = await provider.getPageVerses(s.page);
      const selected = expandVersesWithBismillah(slicePageVerses(verses, s.rangeStart, s.rangeEnd));
      const reciter = RECITERS[s.reciterId - 1] ?? RECITERS[0];
      const bundles = await Promise.all(
        selected.map((v) => provider.buildAyahBundle(v, reciter, localMp3Url))
      );
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
  }, [bridge, getDeck, localMp3Url, provider, showPeek]);

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
    setOpenDrawer('none');
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

  const handleCycleSpeed = useCallback(() => {
    playMechanicalClick();
    setPlaybackRate((prev) => {
      const next = SPEED_STEPS[(SPEED_STEPS.indexOf(prev) + 1) % SPEED_STEPS.length];
      getDeck().setPlaybackRate(next);
      return next;
    });
  }, [getDeck]);

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

  const activeTab: ActiveTab =
    openDrawer === 'surahs'
      ? 'surahs'
      : openDrawer === 'offline'
      ? 'offline'
      : flipped
      ? 'face-b'
      : 'face-a';

  const currentReciter = RECITERS[store.reciterId - 1] ?? RECITERS[0];
  const verseSpan = formatTelemetryRange(
    store.bundles
      .filter((b) => !b.isBismillah)
      .map((b) => ({ verseKey: b.verseKey, surah: b.surah, ayah: b.ayah, textUthmani: '' }))
  );
  const telemetryLeft = `PASS ${String(store.currentPass).padStart(2, '0')}/${String(
    store.repetition
  ).padStart(2, '0')} · P.${String(store.page).padStart(2, '0')} · ${verseSpan}`;

  const edgeClassName =
    store.phase === 'PREFETCHING'
      ? 'prefetching'
      : flipped
      ? store.phase === 'PAUSED'
        ? 'slate-paused'
        : 'slate-active'
      : '';

  return (
    <>
      <Chassis
        flipped={flipped}
        activeTab={activeTab}
        edgeClassName={edgeClassName}
        onSelectFaceA={handleStopAndFlip}
        onSelectFaceB={handleStart}
        onToggleSurahs={() => {
          playMechanicalClick();
          setOpenDrawer((d) => (d === 'surahs' ? 'none' : 'surahs'));
        }}
        onToggleOffline={() => {
          playMechanicalClick();
          setOpenDrawer((d) => (d === 'offline' ? 'none' : 'offline'));
        }}
        onEdgePressStart={() => {
          didLongPress.current = false;
          if (store.phase !== 'IDLE') {
            longPressTimer.current = window.setTimeout(() => {
              didLongPress.current = true;
              handleStopAndFlip();
            }, 450);
          }
        }}
        onEdgePressEnd={() => {
          if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
          if (store.phase === 'IDLE') void handleStart();
          else if (!didLongPress.current) handleTogglePause();
        }}
        overlays={
          <>
            <SurahDrawer
              open={openDrawer === 'surahs'}
              currentPage={store.page}
              playbackMode={playbackMode}
              onChangeMode={(m) => {
                playMechanicalClick();
                setPlaybackMode(m);
              }}
              onSelectSurah={(surahId, startPage) => {
                playMechanicalClick(true);
                if (store.phase !== 'IDLE') handleStopAndFlip();
                store.setPage(startPage, store.pageMaxVerse);
                const sr = SURAHS[surahId - 1];
                if (sr) showPeek(`P.${String(startPage).padStart(3, '0')} · ${sr.english} (${sr.ayahs}v)`);
                void provider.getPageVerses(startPage).then((vs) => {
                  if (vs.length > 0) useInstrumentStore.getState().setPage(startPage, vs.length);
                });
              }}
              onClose={() => setOpenDrawer('none')}
            />
            <OfflineDrawer
              open={openDrawer === 'offline'}
              reciters={RECITERS}
              currentPage={store.page}
              bridge={bridge}
              onSelectReciter={(id) => {
                playMechanicalClick();
                store.setReciter(id);
                const r = RECITERS[id - 1];
                if (r) showPeek(`${String(r.id).padStart(2, '0')} · ${r.name}`);
                setOpenDrawer('none');
              }}
              onClose={() => setOpenDrawer('none')}
            />
          </>
        }
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
          localMp3Loaded={Boolean(localMp3Url)}
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
          onOpenMp3Slot={() => {
            playMechanicalClick();
            fileInputRef.current?.click();
          }}
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
          onStopAndFlip={handleStopAndFlip}
        />
      </Chassis>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mpeg,audio/mp3,audio/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (localMp3Url) URL.revokeObjectURL(localMp3Url);
          setLocalMp3Url(URL.createObjectURL(f));
          showPeek(`Loaded: ${f.name.slice(0, 32)}`);
        }}
      />
    </>
  );
};

export default App;
