import { create } from 'zustand';
import type { AyahBundle, PlaybackPhase, PlaybackState, RangeFocus } from './types';
import { clampPage, clampRepetition, clampVerseRange } from './mushaf-index';

export interface BlockTransitionResult {
  nextPhase: PlaybackPhase;
  nextPass: number;
  nextAyahIdx: number;
}

/**
 * Pure FSM transition for Full-Range Block Repetition (1..N).
 */
export function computeAyahEndedTransition(
  currentPass: number,
  repetition: number,
  currentAyahIdx: number,
  totalAyahs: number
): BlockTransitionResult {
  if (currentAyahIdx < totalAyahs - 1) {
    return {
      nextPhase: 'PLAYING',
      nextPass: currentPass,
      nextAyahIdx: currentAyahIdx + 1
    };
  }
  if (currentPass < repetition) {
    return {
      nextPhase: 'PASS_RESET',
      nextPass: currentPass + 1,
      nextAyahIdx: 0
    };
  }
  return {
    nextPhase: 'COMPLETED',
    nextPass: currentPass,
    nextAyahIdx: currentAyahIdx
  };
}

/**
 * On Pass 2..N, skip the opening Bismillah bundle so Bismillah is recited
 * aloud once at the start of Pass 1 and never repeated on subsequent passes.
 */
export function computePassResetAyahIdx(
  bundles: ReadonlyArray<Pick<AyahBundle, 'isBismillah'>>
): number {
  return bundles[0]?.isBismillah && bundles.length > 1 ? 1 : 0;
}

/**
 * Computes the natural real-time Tajweed waqf pause (in ms) between two consecutive ayahs.
 * Independent of playbackRate so even at 2x speed, ayahs (e.g., Al-Fatihah 1:6 -> 1:7)
 * have a clear, dignified breath pause instead of slamming together.
 */
export function computeWaqfPauseMs(
  endedBundle: Pick<AyahBundle, 'surah' | 'isBismillah'> | undefined,
  nextBundle: Pick<AyahBundle, 'surah' | 'isBismillah'> | undefined
): number {
  if (!endedBundle || !nextBundle) return 0;
  if (endedBundle.isBismillah || nextBundle.isBismillah || endedBundle.surah !== nextBundle.surah) {
    return 620;
  }
  return 420;
}

export interface InstrumentStore extends PlaybackState {
  reciterCount: number;
  pageMaxVerse: number;
  setReciter: (id: number) => void;
  stepReciter: (delta: number) => void;
  setPage: (page: number, maxVerse: number) => void;
  setPageRange: (page: number, maxVerse: number, rangeStart: number, rangeEnd: number) => void;
  setRangeFocus: (focus: RangeFocus) => void;
  stepRange: (delta: number) => void;
  setRepetition: (rep: number) => void;
  beginPrefetch: () => void;
  failPrefetch: (message: string) => void;
  readyToFlip: (bundles: AyahBundle[]) => void;
  enterPlaying: () => void;
  togglePause: () => void;
  setActiveWord: (wordIndex: number) => void;
  advanceAyah: () => BlockTransitionResult;
  finishPassReset: () => void;
  stopAndFlip: () => void;
  finishFlipToControl: () => void;
}

export const useInstrumentStore = create<InstrumentStore>((set, get) => ({
  reciterId: 1,
  reciterCount: 6,
  page: 2,
  pageMaxVerse: 5,
  rangeStart: 1,
  rangeEnd: 5,
  rangeFocus: 'end',
  repetition: 3,
  phase: 'IDLE',
  currentPass: 1,
  currentAyahIdx: 0,
  activeWordIndex: 0,
  bundles: [],
  errorMessage: null,

  setReciter: (id) =>
    set((s) => ({
      reciterId: ((id - 1 + s.reciterCount) % s.reciterCount) + 1
    })),

  stepReciter: (delta) => {
    const { reciterId, reciterCount } = get();
    const next = ((reciterId - 1 + delta) % reciterCount + reciterCount) % reciterCount + 1;
    set({ reciterId: next });
  },

  setPage: (page, maxVerse) =>
    set((s) => {
      const clampedPage = clampPage(page);
      const safeMax = Math.max(1, Math.trunc(maxVerse));
      if (clampedPage !== s.page) {
        return {
          page: clampedPage,
          pageMaxVerse: safeMax,
          rangeStart: 1,
          rangeEnd: safeMax
        };
      }
      if (s.rangeStart === 1 && s.rangeEnd === s.pageMaxVerse) {
        return {
          page: clampedPage,
          pageMaxVerse: safeMax,
          rangeStart: 1,
          rangeEnd: safeMax
        };
      }
      const { rangeStart, rangeEnd } = clampVerseRange(s.rangeStart, s.rangeEnd, safeMax);
      return { page: clampedPage, pageMaxVerse: safeMax, rangeStart, rangeEnd };
    }),

  setPageRange: (page, maxVerse, start, end) =>
    set(() => {
      const clampedPage = clampPage(page);
      const safeMax = Math.max(1, Math.trunc(maxVerse));
      const { rangeStart, rangeEnd } = clampVerseRange(start, end, safeMax);
      return { page: clampedPage, pageMaxVerse: safeMax, rangeStart, rangeEnd };
    }),

  setRangeFocus: (focus) => set({ rangeFocus: focus }),

  stepRange: (delta) =>
    set((s) => {
      if (s.rangeFocus === 'start') {
        const nextStart = Math.max(1, Math.min(s.rangeEnd, s.rangeStart + delta));
        return { rangeStart: nextStart };
      }
      const nextEnd = Math.max(s.rangeStart, Math.min(s.pageMaxVerse, s.rangeEnd + delta));
      return { rangeEnd: nextEnd };
    }),

  setRepetition: (rep) => set({ repetition: clampRepetition(rep) }),

  beginPrefetch: () => set({ phase: 'PREFETCHING', errorMessage: null }),

  failPrefetch: (message) => set({ phase: 'IDLE', errorMessage: message }),

  readyToFlip: (bundles) =>
    set({
      bundles,
      currentPass: 1,
      currentAyahIdx: 0,
      activeWordIndex: 0,
      phase: 'FLIPPING_TO_SLATE'
    }),

  enterPlaying: () => set({ phase: 'PLAYING' }),

  togglePause: () =>
    set((s) => {
      if (s.phase === 'PLAYING') return { phase: 'PAUSED' };
      if (s.phase === 'PAUSED') return { phase: 'PLAYING' };
      return {};
    }),

  setActiveWord: (wordIndex) =>
    set((s) => (s.activeWordIndex === wordIndex ? s : { activeWordIndex: wordIndex })),

  advanceAyah: () => {
    const s = get();
    const res = computeAyahEndedTransition(
      s.currentPass,
      s.repetition,
      s.currentAyahIdx,
      s.bundles.length
    );
    if (res.nextPhase === 'PLAYING') {
      set({ currentAyahIdx: res.nextAyahIdx, activeWordIndex: 0 });
    } else if (res.nextPhase === 'PASS_RESET') {
      set({ phase: 'PASS_RESET' });
    } else {
      set({ phase: 'COMPLETED' });
    }
    return res;
  },

  finishPassReset: () =>
    set((s) => ({
      phase: 'PLAYING',
      currentPass: s.currentPass + 1,
      currentAyahIdx: computePassResetAyahIdx(s.bundles),
      activeWordIndex: 0
    })),

  stopAndFlip: () => set({ phase: 'FLIPPING_TO_CONTROL' }),

  finishFlipToControl: () => set({ phase: 'IDLE', activeWordIndex: 0, currentAyahIdx: 0 })
}));
