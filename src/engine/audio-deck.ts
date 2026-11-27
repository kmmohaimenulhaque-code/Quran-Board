import type { AyahBundle } from '../core/types';
import { resolveActiveWordIndex, synthesizeWordSegments } from '../core/sync-resolver';

export interface DeckCallbacks {
  onWordChange: (wordIndex: number) => void;
  onAyahEnded: () => void;
}

/**
 * Dual-buffer gapless HTML5 Audio deck driven by 60/120Hz requestAnimationFrame.
 */
export class DualBufferAudioDeck {
  private activeAudio = new Audio();
  private standbyAudio = new Audio();
  private rafId: number | null = null;
  private currentBundle: AyahBundle | null = null;
  private lastWordIndex = -1;
  private playing = false;
  private playbackRate = 1;

  constructor(private callbacks: DeckCallbacks) {
    this.activeAudio.preload = 'auto';
    this.standbyAudio.preload = 'auto';
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = rate;
    this.activeAudio.playbackRate = rate;
    this.standbyAudio.playbackRate = rate;
  }

  preloadNext(bundle: AyahBundle | undefined): void {
    if (!bundle) return;
    if (this.standbyAudio.src !== bundle.audioUrl) {
      this.standbyAudio.src = bundle.audioUrl;
      this.standbyAudio.load();
    }
  }

  async play(bundle: AyahBundle, nextBundle?: AyahBundle): Promise<void> {
    this.stopLoop();
    this.currentBundle = bundle;
    this.lastWordIndex = -1;
    this.playing = true;

    const reuseSameClip =
      this.activeAudio.src.endsWith(bundle.audioUrl) && (bundle.clipStartSec ?? 0) > 0;

    if (!reuseSameClip) {
      if (this.standbyAudio.src.endsWith(bundle.audioUrl)) {
        const tmp = this.activeAudio;
        this.activeAudio = this.standbyAudio;
        this.standbyAudio = tmp;
      } else {
        this.activeAudio.src = bundle.audioUrl;
      }
    }

    this.activeAudio.onloadedmetadata = () => {
      if (
        (bundle.clipEndSec === null || bundle.clipEndSec === undefined) &&
        Number.isFinite(this.activeAudio.duration) &&
        this.activeAudio.duration > 0
      ) {
        const realMs = Math.round(this.activeAudio.duration * 1000);
        if (Math.abs(realMs - bundle.durationMs) > 250) {
          bundle.durationMs = realMs;
          const text = bundle.words.map((w) => w.textUthmani).join(' ');
          bundle.words = synthesizeWordSegments(text, realMs, 0);
        }
      }
    };

    this.activeAudio.onended = () => {
      if (this.playing && (bundle.clipEndSec === null || bundle.clipEndSec === undefined)) {
        this.stopLoop();
        this.callbacks.onAyahEnded();
      }
    };

    this.activeAudio.currentTime = bundle.clipStartSec ?? 0;
    if (nextBundle && nextBundle.audioUrl !== bundle.audioUrl) {
      this.preloadNext(nextBundle);
    }

    this.activeAudio.playbackRate = this.playbackRate;
    await this.activeAudio.play();
    this.startLoop();
  }

  pause(): void {
    this.playing = false;
    this.stopLoop();
    this.activeAudio.pause();
  }

  async resume(): Promise<void> {
    if (!this.currentBundle) return;
    this.playing = true;
    await this.activeAudio.play();
    this.startLoop();
  }

  stop(): void {
    this.playing = false;
    this.stopLoop();
    this.activeAudio.pause();
    this.standbyAudio.pause();
    this.currentBundle = null;
  }

  private startLoop(): void {
    this.stopLoop();
    const tick = () => {
      if (!this.playing || !this.currentBundle) return;
      const b = this.currentBundle;
      const startSec = b.clipStartSec ?? 0;
      const endSec = b.clipEndSec;

      if (endSec !== null && endSec !== undefined && this.activeAudio.currentTime >= endSec) {
        this.activeAudio.pause();
        this.stopLoop();
        this.callbacks.onAyahEnded();
        return;
      }

      const relMs = Math.max(0, (this.activeAudio.currentTime - startSec) * 1000);
      const wordIdx = resolveActiveWordIndex(b.words, relMs);
      if (wordIdx !== this.lastWordIndex) {
        this.lastWordIndex = wordIdx;
        this.callbacks.onWordChange(wordIdx);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
