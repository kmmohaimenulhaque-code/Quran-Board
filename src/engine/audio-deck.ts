import type { AyahBundle } from '../core/types';
import { resolveActiveWordIndex, synthesizeWordSegments } from '../core/sync-resolver';

export interface DeckCallbacks {
  onWordChange: (wordIndex: number) => void;
  onAyahEnded: () => void;
  onError?: (message: string) => void;
}

/**
 * Dual-buffer gapless HTML5 Audio deck with synchronous user-gesture unlock
 * (prevents Safari/iOS/WebKitGTK NotAllowedError after async prefetch or 560ms flip)
 * and safe loadedmetadata seeking for clipped single-file tracks.
 */
export class DualBufferAudioDeck {
  private activeAudio = new Audio();
  private standbyAudio = new Audio();
  private rafId: number | null = null;
  private currentBundle: AyahBundle | null = null;
  private lastWordIndex = -1;
  private playing = false;
  private playbackRate = 1;
  private unlocked = false;

  constructor(private callbacks: DeckCallbacks) {
    this.activeAudio.preload = 'auto';
    this.standbyAudio.preload = 'auto';
    this.activeAudio.setAttribute('playsinline', 'true');
    this.standbyAudio.setAttribute('playsinline', 'true');
  }

  /**
   * Must be called synchronously inside a user click/tap handler before any await or setTimeout.
   */
  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;
    const silentWav =
      'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
    for (const el of [this.activeAudio, this.standbyAudio]) {
      try {
        el.src = silentWav;
        el.muted = true;
        const pr = el.play();
        if (pr && typeof pr.then === 'function') {
          pr.then(() => {
            el.pause();
            el.muted = false;
            el.currentTime = 0;
          }).catch(() => {
            el.muted = false;
          });
        } else {
          el.muted = false;
        }
      } catch {
        el.muted = false;
      }
    }
  }

  setPlaybackRate(rate: number): void {
    this.playbackRate = rate;
    this.activeAudio.playbackRate = rate;
    this.standbyAudio.playbackRate = rate;
  }

  preloadNext(bundle: AyahBundle | undefined): void {
    if (!bundle) return;
    if (!this.standbyAudio.src || !this.standbyAudio.src.endsWith(bundle.audioUrl)) {
      this.standbyAudio.src = bundle.audioUrl;
      this.standbyAudio.load();
    }
  }

  private waitForMetadata(audio: HTMLAudioElement): Promise<void> {
    if (audio.readyState >= 1) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        audio.removeEventListener('loadedmetadata', done);
        audio.removeEventListener('canplay', done);
        audio.removeEventListener('error', done);
        resolve();
      };
      audio.addEventListener('loadedmetadata', done, { once: true });
      audio.addEventListener('canplay', done, { once: true });
      audio.addEventListener('error', done, { once: true });
      window.setTimeout(done, 3500);
    });
  }

  async play(bundle: AyahBundle, nextBundle?: AyahBundle): Promise<void> {
    this.stopLoop();
    this.currentBundle = bundle;
    this.lastWordIndex = -1;
    this.playing = true;

    const reuseSameClip =
      Boolean(this.activeAudio.src) &&
      this.activeAudio.src.endsWith(bundle.audioUrl) &&
      (bundle.clipStartSec ?? 0) > 0;

    if (!reuseSameClip) {
      if (this.standbyAudio.src && this.standbyAudio.src.endsWith(bundle.audioUrl)) {
        const tmp = this.activeAudio;
        this.activeAudio = this.standbyAudio;
        this.standbyAudio = tmp;
      } else {
        this.activeAudio.src = bundle.audioUrl;
        this.activeAudio.load();
      }
    }

    this.activeAudio.muted = false;
    await this.waitForMetadata(this.activeAudio);
    if (!this.playing || this.currentBundle !== bundle) return;

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

    this.activeAudio.onended = () => {
      if (this.playing && (bundle.clipEndSec === null || bundle.clipEndSec === undefined)) {
        this.stopLoop();
        this.callbacks.onAyahEnded();
      }
    };

    try {
      this.activeAudio.currentTime = bundle.clipStartSec ?? 0;
    } catch {
      // Ignore seek errors on unseekable streams
    }

    if (nextBundle && nextBundle.audioUrl !== bundle.audioUrl) {
      this.preloadNext(nextBundle);
    }

    this.activeAudio.playbackRate = this.playbackRate;
    try {
      await this.activeAudio.play();
      this.startLoop();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Audio playback blocked';
      this.callbacks.onError?.(msg);
      this.runTimedFallback(bundle);
    }
  }

  private runTimedFallback(bundle: AyahBundle): void {
    this.stopLoop();
    const startPerf = performance.now();
    const tick = () => {
      if (!this.playing || this.currentBundle !== bundle) return;
      const elapsed = (performance.now() - startPerf) * this.playbackRate;
      if (elapsed >= bundle.durationMs) {
        this.stopLoop();
        this.callbacks.onAyahEnded();
        return;
      }
      const w = resolveActiveWordIndex(bundle.words, elapsed);
      if (w !== this.lastWordIndex) {
        this.lastWordIndex = w;
        this.callbacks.onWordChange(w);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  pause(): void {
    this.playing = false;
    this.stopLoop();
    this.activeAudio.pause();
  }

  async resume(): Promise<void> {
    if (!this.currentBundle) return;
    this.playing = true;
    this.activeAudio.playbackRate = this.playbackRate;
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
