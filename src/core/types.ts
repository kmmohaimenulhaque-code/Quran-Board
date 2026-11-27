export interface Reciter {
  id: number;
  name: string;
  shortName: string;
  providerMode: 'local-baqarah' | 'everyayah';
  localSurah?: number;
  localAudioPath?: string;
  everyAyahDir: string;
  description: string;
}

export interface VerseEntry {
  verseKey: string;
  surah: number;
  ayah: number;
  textUthmani: string;
}

export interface PageEntry {
  page: number;
  verses: VerseEntry[];
}

export interface WordSegment {
  wordIndex: number;   // 1-based position in Ayah
  textUthmani: string; // Word token
  startMs: number;
  endMs: number;
}

export interface AyahBundle {
  verseKey: string;    // e.g. "2:265"
  surah: number;
  ayah: number;
  reciterId: number;
  audioUrl: string;    // Object URL from cache or remote/local URL
  clipStartSec?: number;
  clipEndSec?: number | null;
  durationMs: number;
  words: WordSegment[];
}

export type PlaybackPhase =
  | 'IDLE'
  | 'PREFETCHING'
  | 'FLIPPING_TO_SLATE'
  | 'PLAYING'
  | 'PAUSED'
  | 'PASS_RESET'
  | 'COMPLETED'
  | 'FLIPPING_TO_CONTROL';

export type RangeFocus = 'start' | 'end';

export interface DialSettings {
  reciterId: number;
  page: number;
  rangeStart: number;
  rangeEnd: number;
  repetition: number;
}

export interface PlaybackState extends DialSettings {
  rangeFocus: RangeFocus;
  phase: PlaybackPhase;
  currentPass: number;
  currentAyahIdx: number;
  activeWordIndex: number;
  bundles: AyahBundle[];
  errorMessage: string | null;
}
