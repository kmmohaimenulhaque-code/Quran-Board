import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import recitersJson from './assets/data/reciters.json';
import surahsJson from './assets/data/surahs-114.json';
import type { Reciter, VerseEntry } from './core/types';
import { formatTelemetryRange, getSurahSliceOnPage, slicePageVerses } from './core/mushaf-index';
import { expandVersesWithBismillah } from './core/bismillah';
import { computeWaqfPauseMs, useInstrumentStore } from './core/state-machine';
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
  const [selectedSurahId, setSelectedSurahId] = useState<number | null>(null);
  const [openDrawer, setOpenDrawer] = useState<'none' | 'surahs' | 'offline'>('none');
  const [localMp3Url, setLocalMp3Url] = useState<string | null>(null);

  const peekTimer = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const waqfTimerRef = useRef<number | null>(null);
  const didLongPress = useRef(false);
  const pausedByDrawerRef = useRef(false);
  const startTokenRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const bridge = useMemo(() => new WebPlatformAdapter(), []);
  const provider = useMemo(() => new PublicRecitationProvider(bridge), [bridge]);
  const [activeScopeVerses, setActiveScopeVerses] = useState<VerseEntry[]>(
    () => provider.getCachedPageVerses(useInstrumentStore.getState().page) ?? []
  );

  const clearWaqfTimer = useCallback(() => {
    if (waqfTimerRef.current !== null) {
      window.clearTimeout(waqfTimerRef.current);
      waqfTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    void provider.cacheAllReciterBismillahs(RECITERS);
    return () => clearWaqfTimer();
  }, [provider, clearWaqfTimer]);

  // Keep Face A verse range synced in real time with either the active Page or active Full Surah
  useEffect(() => {
    let cancelled = false;

    if (playbackMode === 'surah' && selectedSurahId !== null) {
      const cachedSurah = provider.getCachedSurahVerses(selectedSurahId);
      if (cachedSurah && cachedSurah.length > 0) {
        setActiveScopeVerses(cachedSurah);
        if (useInstrumentStore.getState().pageMaxVerse !== cachedSurah.length) {
          useInstrumentStore.getState().setPageRange(store.page, cachedSurah.length, 1, cachedSurah.length);
        }
        return;
      }
      void provider
        .getSurahVerses(selectedSurahId)
        .then((vs) => {
          if (cancelled || vs.length === 0) return;
          setActiveScopeVerses(vs);
          useInstrumentStore.getState().setPageRange(store.page, vs.length, 1, vs.length);
        })
        .catch(() => {
          // Offline fallback
        });
      return () => {
        cancelled = true;
      };
    }

    const cached = provider.getCachedPageVerses(store.page);
    if (cached && cached.length > 0) {
      setActiveScopeVerses(cached);
      if (selectedSurahId !== null) {
        const slice = getSurahSliceOnPage(cached, selectedSurahId);
        if (slice) {
          useInstrumentStore
            .getState()
            .setPageRange(store.page, cached.length, slice.rangeStart, slice.rangeEnd);
          return;
        }
      }
      if (useInstrumentStore.getState().pageMaxVerse !== cached.length) {
        useInstrumentStore.getState().setPage(store.page, cached.length);
      }
      return;
    }

    void provider
      .getPageVerses(store.page)
      .then((vs) => {
        if (cancelled || vs.length === 0) return;
        setActiveScopeVerses(vs);
        if (selectedSurahId !== null) {
          const slice = getSurahSliceOnPage(vs, selectedSurahId);
          if (slice) {
            useInstrumentStore
              .getState()
              .setPageRange(store.page, vs.length, slice.rangeStart, slice.rangeEnd);
            return;
          }
        }
        useInstrumentStore.getState().setPage(store.page, vs.length);
      })
      .catch(() => {
        // Offline page not cached yet
      });

    return () => {
      cancelled = true;
    };
  }, [provider, store.page, playbackMode, selectedSurahId]);

  const deckRef = useRef<DualBufferAudioDeck | null>(null);

  const showPeek = useCallback((msg: string, isErr = false) => {
    setBezelPeek(msg);
    setPeekError(isErr);
    if (peekTimer.current) window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setBezelPeek(null), 2600);
  }, []);

  const showScopePeek = useCallback(
    (verses: VerseEntry[], pageNum: number, rStart: number, rEnd: number) => {
      const sliced = slicePageVerses(verses, rStart, rEnd);
      if (sliced.length === 0) return;
      const span = formatTelemetryRange(sliced);
      const firstSurah = SURAHS[sliced[0].surah - 1];
      const sameSurah = sliced[0].surah === sliced[sliced.length - 1].surah;
      const label = sameSurah && firstSurah ? `${firstSurah.english} · ${span}` : span;
      showPeek(`P.${String(pageNum).padStart(3, '0')} · ${label}`);
    },
    [showPeek]
  );

  const getDeck = useCallback(() => {
    if (!deckRef.current) {
      deckRef.current = new DualBufferAudioDeck({
        onWordChange: (w) => useInstrumentStore.getState().setActiveWord(w),
        onAyahEnded: () => {
          clearWaqfTimer();
          const s = useInstrumentStore.getState();
          const endedBundle = s.bundles[s.currentAyahIdx];
          // Light up the completed ayah's medallion immediately during the waqf breath
          if (endedBundle) {
            s.setActiveWord(endedBundle.words.length + 1);
          }

          const isLastInPass = s.currentAyahIdx >= s.bundles.length - 1;
          if (!isLastInPass) {
            const nextBundle = s.bundles[s.currentAyahIdx + 1];
            const waqfMs = computeWaqfPauseMs(endedBundle, nextBundle);
            waqfTimerRef.current = window.setTimeout(() => {
              waqfTimerRef.current = null;
              const latest = useInstrumentStore.getState();
              if (latest.phase !== 'PLAYING') return;
              const res = latest.advanceAyah();
              if (res.nextPhase === 'PLAYING') {
                const b = latest.bundles[res.nextAyahIdx];
                const nextB = latest.bundles[res.nextAyahIdx + 1];
                if (b) void deckRef.current?.play(b, nextB);
              }
            }, waqfMs);
            return;
          }

          const res = s.advanceAyah();
          if (res.nextPhase === 'PASS_RESET') {
            waqfTimerRef.current = window.setTimeout(() => {
              waqfTimerRef.current = null;
              const latest = useInstrumentStore.getState();
              if (latest.phase !== 'PASS_RESET') return;
              latest.finishPassReset();
              const updated = useInstrumentStore.getState();
              const startIdx = updated.currentAyahIdx;
              const first = updated.bundles[startIdx];
              if (first) void deckRef.current?.play(first, updated.bundles[startIdx + 1]);
            }, 520);
          } else {
            void bridge.releaseWakeLock();
          }
        }
      });
    }
    return deckRef.current;
  }, [bridge, clearWaqfTimer]);

  const cancelPrefetchIfActive = useCallback(() => {
    const s = useInstrumentStore.getState();
    if (s.phase === 'PREFETCHING') {
      startTokenRef.current += 1;
      s.finishFlipToControl();
    }
  }, []);

  const handleStart = useCallback(async () => {
    setOpenDrawer('none');
    pausedByDrawerRef.current = false;
    clearWaqfTimer();
    const s = useInstrumentStore.getState();
    if (s.phase !== 'IDLE') return;
    const token = ++startTokenRef.current;
    getDeck().unlock();
    playMechanicalClick(true);
    s.beginPrefetch();
    try {
      const verses =
        playbackMode === 'surah' && selectedSurahId !== null
          ? await provider.getSurahVerses(selectedSurahId)
          : await provider.getPageVerses(s.page);
      if (startTokenRef.current !== token) return;
      if (verses.length === 0) {
        throw new Error(`Page ${s.page} not available offline yet`);
      }
      const selected = expandVersesWithBismillah(slicePageVerses(verses, s.rangeStart, s.rangeEnd));
      const reciter = RECITERS[s.reciterId - 1] ?? RECITERS[0];
      const bundles = await Promise.all(
        selected.map((v) => provider.buildAyahBundle(v, reciter, localMp3Url))
      );
      if (startTokenRef.current !== token) return;
      s.readyToFlip(bundles);
      window.setTimeout(() => {
        if (startTokenRef.current !== token) return;
        const latest = useInstrumentStore.getState();
        if (latest.phase !== 'FLIPPING_TO_SLATE') return;
        latest.enterPlaying();
        void bridge.acquireWakeLock();
        void getDeck().play(bundles[0], bundles[1]);
      }, 560);
    } catch (err) {
      if (startTokenRef.current !== token) return;
      const msg = err instanceof Error ? err.message : 'Unable to load audio';
      s.failPrefetch(msg);
      showPeek(msg, true);
    }
  }, [bridge, clearWaqfTimer, getDeck, localMp3Url, playbackMode, provider, selectedSurahId, showPeek]);

  const handleTogglePause = useCallback(() => {
    const s = useInstrumentStore.getState();
    playMechanicalClick(true);
    if (s.phase === 'PLAYING') {
      clearWaqfTimer();
      getDeck().pause();
      s.togglePause();
      void bridge.releaseWakeLock();
    } else if (s.phase === 'PAUSED') {
      s.togglePause();
      void bridge.acquireWakeLock();
      const latest = useInstrumentStore.getState();
      const curBundle = latest.bundles[latest.currentAyahIdx];
      // If paused during a waqf pause right after an ayah finished, advance to next ayah cleanly
      if (curBundle && latest.activeWordIndex > curBundle.words.length) {
        const res = latest.advanceAyah();
        if (res.nextPhase === 'PLAYING') {
          const b = latest.bundles[res.nextAyahIdx];
          if (b) void getDeck().play(b, latest.bundles[res.nextAyahIdx + 1]);
        }
      } else {
        void getDeck().resume();
      }
    }
  }, [bridge, clearWaqfTimer, getDeck]);

  const handleStopAndFlip = useCallback(() => {
    setOpenDrawer('none');
    pausedByDrawerRef.current = false;
    clearWaqfTimer();
    startTokenRef.current += 1;
    const s = useInstrumentStore.getState();
    if (s.phase === 'IDLE') return;
    playMechanicalClick(true);
    getDeck().stop();
    void bridge.releaseWakeLock();
    if (s.phase === 'PREFETCHING') {
      s.finishFlipToControl();
      return;
    }
    s.stopAndFlip();
    window.setTimeout(() => {
      useInstrumentStore.getState().finishFlipToControl();
    }, 560);
  }, [bridge, clearWaqfTimer, getDeck]);

  const handleCloseDrawer = useCallback(() => {
    setOpenDrawer('none');
    if (pausedByDrawerRef.current) {
      pausedByDrawerRef.current = false;
      const s = useInstrumentStore.getState();
      if (s.phase === 'PAUSED') {
        s.togglePause();
        void bridge.acquireWakeLock();
        void getDeck().resume();
      }
    }
  }, [bridge, getDeck]);

  const handleToggleDrawer = useCallback(
    (target: 'surahs' | 'offline') => {
      playMechanicalClick();
      cancelPrefetchIfActive();
      if (openDrawer === target) {
        handleCloseDrawer();
        return;
      }
      const s = useInstrumentStore.getState();
      if (s.phase === 'PLAYING') {
        clearWaqfTimer();
        getDeck().pause();
        s.togglePause();
        void bridge.releaseWakeLock();
        pausedByDrawerRef.current = true;
      }
      setOpenDrawer(target);
    },
    [bridge, cancelPrefetchIfActive, clearWaqfTimer, getDeck, handleCloseDrawer, openDrawer]
  );

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
  const scopeTag =
    playbackMode === 'surah' && selectedSurahId !== null
      ? `S.${String(selectedSurahId).padStart(3, '0')}`
      : `P.${String(store.page).padStart(2, '0')}`;
  const telemetryLeft = `PASS ${String(store.currentPass).padStart(2, '0')}/${String(
    store.repetition
  ).padStart(2, '0')} · ${scopeTag} · ${verseSpan}`;

  // Map 1-based scope indices to actual Surah Ayah numbers for Face A LEDs
  const displayRangeStart = activeScopeVerses[store.rangeStart - 1]?.ayah ?? store.rangeStart;
  const displayRangeEnd = activeScopeVerses[store.rangeEnd - 1]?.ayah ?? store.rangeEnd;

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
        onToggleSurahs={() => handleToggleDrawer('surahs')}
        onToggleOffline={() => handleToggleDrawer('offline')}
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
          else if (store.phase === 'PREFETCHING') handleStopAndFlip();
          else if (!didLongPress.current) handleTogglePause();
        }}
        overlays={
          <>
            <SurahDrawer
              open={openDrawer === 'surahs'}
              currentPage={store.page}
              selectedSurahId={selectedSurahId}
              playbackMode={playbackMode}
              onChangeMode={(m) => {
                playMechanicalClick();
                setPlaybackMode(m);
                if (m === 'surah' && selectedSurahId === null) {
                  // Default Full Surah Mode to the Surah at the start of the current page
                  const firstOnPage = activeScopeVerses[0]?.surah ?? 1;
                  setSelectedSurahId(firstOnPage);
                }
              }}
              onSelectSurah={(surahId, startPage) => {
                playMechanicalClick(true);
                pausedByDrawerRef.current = false;
                if (store.phase !== 'IDLE') handleStopAndFlip();
                setSelectedSurahId(surahId);
                const sr = SURAHS[surahId - 1];

                if (playbackMode === 'surah') {
                  const cachedSurah = provider.getCachedSurahVerses(surahId);
                  const totalAyahs = cachedSurah?.length ?? sr?.ayahs ?? store.pageMaxVerse;
                  store.setPageRange(startPage, totalAyahs, 1, totalAyahs);
                  if (cachedSurah) setActiveScopeVerses(cachedSurah);
                  if (sr) showPeek(`FULL SURAH · ${sr.english} (1–${sr.ayahs})`);
                } else {
                  const cachedPage = provider.getCachedPageVerses(startPage);
                  if (cachedPage && cachedPage.length > 0) {
                    setActiveScopeVerses(cachedPage);
                    const slice = getSurahSliceOnPage(cachedPage, surahId);
                    if (slice) {
                      store.setPageRange(startPage, cachedPage.length, slice.rangeStart, slice.rangeEnd);
                      showScopePeek(cachedPage, startPage, slice.rangeStart, slice.rangeEnd);
                    } else {
                      store.setPage(startPage, cachedPage.length);
                      if (sr) showPeek(`P.${String(startPage).padStart(3, '0')} · ${sr.english} (${sr.ayahs}v)`);
                    }
                  } else {
                    store.setPage(startPage, store.pageMaxVerse);
                    if (sr) showPeek(`P.${String(startPage).padStart(3, '0')} · ${sr.english} (${sr.ayahs}v)`);
                  }
                }
              }}
              onClose={handleCloseDrawer}
            />
            <OfflineDrawer
              open={openDrawer === 'offline'}
              reciters={RECITERS}
              currentPage={store.page}
              selectedSurahId={selectedSurahId}
              bridge={bridge}
              onSelectReciter={(id) => {
                playMechanicalClick();
                store.setReciter(id);
                const r = RECITERS[id - 1];
                if (r) showPeek(`${String(r.id).padStart(2, '0')} · ${r.name}`);
                handleCloseDrawer();
              }}
              onClose={handleCloseDrawer}
            />
          </>
        }
      >
        <ControlFace
          reciterId={store.reciterId}
          page={store.page}
          rangeStart={displayRangeStart}
          rangeEnd={displayRangeEnd}
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
            setSelectedSurahId(null);
            if (playbackMode === 'surah') setPlaybackMode('page');
            const cached = provider.getCachedPageVerses(nextPage);
            store.setPage(nextPage, cached?.length ?? store.pageMaxVerse);
            if (cached && cached.length > 0) {
              setActiveScopeVerses(cached);
              showScopePeek(cached, nextPage, 1, cached.length);
            }
          }}
          onStepRange={(d) => {
            store.stepRange(d);
            const next = useInstrumentStore.getState();
            showScopePeek(activeScopeVerses, next.page, next.rangeStart, next.rangeEnd);
          }}
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
