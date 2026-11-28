import type { AyahBundle } from '../core/types';
import { resolveActiveWordIndex, synthesizeWordSegments } from '../core/sync-resolver';

export interface DeckCallbacks {
  onWordChange: (wordIndex: number) => void;
  onAyahEnded: () => void;
  onOfflineError?: (bundle: AyahBundle, message: string) => void;
  onError?: (message: string) => void;
}

type MetadataStatus = 'ready' | 'error' | 'timeout';

/**
 * Dual-buffer gapless HTML5 Audio deck with synchronous user-gesture unlock
 * and strict offline-error detection (never fakes silent word animations when audio is uncached).
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

  private waitForMetadata(audio: HTMLAudioElement): Promise<MetadataStatus> {
    if (audio.readyState >= 1) return Promise.resolve('ready');
    if (audio.error) return Promise.resolve('error');
    return new Promise((resolve) => {
      let settled = false;
      const finish = (status: MetadataStatus) => {
        if (settled) return;
        settled = true;
        audio.removeEventListener('loadedmetadata', onReady);
        audio.removeEventListener('canplay', onReady);
        audio.removeEventListener('error', onErr);
        window.clearTimeout(timer);
        resolve(status);
      };
      const onReady = () => finish('ready');
      const onErr = () => finish('error');
      audio.addEventListener('loadedmetadata', onReady, { once: true });
      audio.addEventListener('canplay', onReady, { once: true });
      audio.addEventListener('error', onErr, { once: true });
      const timer = window.setTimeout(() => finish('timeout'), 4500);
    });
  }

  private isRemoteUrl(url: string): boolean {
    return /^https?:\/\//i.test(url);
  }

  async play(bundle: AyahBundle, nextBundle?: AyahBundle): Promise<void> {
    this.stopLoop();
    this.currentBundle = bundle;
    this.lastWordIndex = -1;
    this.playing = true;

    // Fast offline guard: if URL is uncached remote https:// and device is offline, fail cleanly immediately
    if (
      typeof navigator !== 'undefined' &&
      navigator.onLine === false &&
      this.isRemoteUrl(bundle.audioUrl)
    ) {
      this.stop();
      this.callbacks.onOfflineError?.(
        bundle,
        `Offline · S.${bundle.surah} not cached — open OFFLINE tab`
      );
      return;
    }

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
    const metaStatus = await this.waitForMetadata(this.activeAudio);
    if (!this.playing || this.currentBundle !== bundle) return;

    if (metaStatus === 'error' || (metaStatus === 'timeout' && this.activeAudio.readyState === 0)) {
      this.stop();
      const msg =
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? `Offline · S.${bundle.surah} not cached — open OFFLINE tab`
          : `Audio unavailable for ${bundle.verseKey} — cache in OFFLINE tab`;
      this.callbacks.onOfflineError?.(bundle, msg);
      return;
    }

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

    this.activeAudio.onerror = () => {
      if (this.playing && this.currentBundle === bundle) {
        this.stop();
        this.callbacks.onOfflineError?.(
          bundle,
          `Audio interrupted for ${bundle.verseKey} — cache in OFFLINE tab`
        );
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
      this.stop();
      const msg =
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? `Offline · S.${bundle.surah} not cached — open OFFLINE tab`
          : err instanceof Error
          ? err.message
          : 'Audio playback blocked';
      this.callbacks.onOfflineError?.(bundle, msg);
    }
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
    this.activeAudio.onended = null;
    this.activeAudio.onerror = null;
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
