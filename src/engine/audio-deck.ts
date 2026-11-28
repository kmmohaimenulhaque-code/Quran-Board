import type { AyahBundle } from '../core/types';
import { resolveActiveWordIndex, synthesizeWordSegments } from '../core/sync-resolver';

export interface DeckCallbacks {
  onWordChange: (wordIndex: number) => void;
  onAyahEnded: () => void;
  onOfflineError?: (bundle: AyahBundle, message: string) => void;
  onError?: (message: string) => void;
}

/**
 * Dual-buffer gapless HTML5 Audio deck.
 * v1.2.2: Never blocks play() behind a 4.5s waitForMetadata timeout (fixes Linux WebKitGTK
 * GStreamer inter-ayah stalls) and syncs real duration dynamically when metadata arrives.
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
    if (!bundle || !bundle.audioUrl) return;
    if (this.standbyAudio.src !== bundle.audioUrl && !this.standbyAudio.src.endsWith(bundle.audioUrl)) {
      this.standbyAudio.src = bundle.audioUrl;
      this.standbyAudio.load();
    }
  }

  private isRemoteUrl(url: string): boolean {
    return /^https?:\/\//i.test(url);
  }

  private syncDurationFromAudio(audio: HTMLAudioElement, bundle: AyahBundle): void {
    if (
      (bundle.clipEndSec === null || bundle.clipEndSec === undefined) &&
      Number.isFinite(audio.duration) &&
      audio.duration > 0
    ) {
      const realMs = Math.round(audio.duration * 1000);
      if (Math.abs(realMs - bundle.durationMs) > 250) {
        bundle.durationMs = realMs;
        const text = bundle.words.map((w) => w.textUthmani).join(' ');
        bundle.words = synthesizeWordSegments(text, realMs, 0);
      }
    }
  }

  async play(bundle: AyahBundle, nextBundle?: AyahBundle): Promise<void> {
    this.stopLoop();
    this.currentBundle = bundle;
    this.lastWordIndex = -1;
    this.playing = true;

    // Fast offline guard: uncached remote https:// while offline fails cleanly immediately
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
      (this.activeAudio.src === bundle.audioUrl || this.activeAudio.src.endsWith(bundle.audioUrl)) &&
      (bundle.clipStartSec ?? 0) > 0;

    if (!reuseSameClip) {
      const standbyMatches =
        Boolean(this.standbyAudio.src) &&
        (this.standbyAudio.src === bundle.audioUrl || this.standbyAudio.src.endsWith(bundle.audioUrl));
      if (standbyMatches) {
        const tmp = this.activeAudio;
        this.activeAudio = this.standbyAudio;
        this.standbyAudio = tmp;
      } else {
        this.activeAudio.src = bundle.audioUrl;
      }
    }

    const audio = this.activeAudio;
    audio.muted = false;
    audio.playbackRate = this.playbackRate;

    const applySeekAndDuration = () => {
      if (this.currentBundle !== bundle) return;
      this.syncDurationFromAudio(audio, bundle);
      if ((bundle.clipStartSec ?? 0) > 0 && Math.abs(audio.currentTime - (bundle.clipStartSec ?? 0)) > 0.25) {
        try {
          audio.currentTime = bundle.clipStartSec ?? 0;
        } catch {
          // Ignore seek errors on unseekable streams
        }
      }
    };

    if (audio.readyState >= 1) {
      applySeekAndDuration();
    } else {
      audio.onloadedmetadata = () => applySeekAndDuration();
    }

    audio.onended = () => {
      if (this.playing && this.currentBundle === bundle && (bundle.clipEndSec === null || bundle.clipEndSec === undefined)) {
        this.stopLoop();
        this.callbacks.onAyahEnded();
      }
    };

    audio.onerror = () => {
      if (this.playing && this.currentBundle === bundle) {
        this.stop();
        const msg =
          typeof navigator !== 'undefined' && navigator.onLine === false
            ? `Offline · S.${bundle.surah} not cached — open OFFLINE tab`
            : `Audio unavailable for ${bundle.verseKey} — cache in OFFLINE tab`;
        this.callbacks.onOfflineError?.(bundle, msg);
      }
    };

    if ((bundle.clipStartSec ?? 0) === 0 && audio.readyState >= 1) {
      try {
        audio.currentTime = 0;
      } catch {
        // Ignore
      }
    }

    // Start playback immediately without waiting for a 4.5s metadata timeout!
    try {
      await audio.play();
      if (!this.playing || this.currentBundle !== bundle) return;
      this.syncDurationFromAudio(audio, bundle);
      this.startLoop();
      if (nextBundle && nextBundle.audioUrl && nextBundle.audioUrl !== bundle.audioUrl) {
        this.preloadNext(nextBundle);
      }
    } catch (err) {
      if (this.currentBundle !== bundle) return;
      this.stop();
      const msg =
        typeof navigator !== 'undefined' && navigator.onLine === false
          ? `Offline · S.${bundle.surah} not cached — open OFFLINE tab`
          : err instanceof Error
          ? err.message
          : `Audio unavailable for ${bundle.verseKey}`;
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
    this.activeAudio.onloadedmetadata = null;
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
