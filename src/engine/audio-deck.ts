import type { AyahBundle } from '../core/types';
import { resolveActiveWordIndex, synthesizeWordSegments } from '../core/sync-resolver';

export interface DeckCallbacks {
  onWordChange: (wordIndex: number) => void;
  onAyahEnded: () => void;
  onOfflineError?: (bundle: AyahBundle, message: string) => void;
  onError?: (message: string) => void;
}

function isLinuxTauriRuntime(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const isTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
  const ua = navigator.userAgent || '';
  return isTauri && /Linux/i.test(ua) && !/Android/i.test(ua);
}

/**
 * Dual-buffer gapless Audio deck.
 * - Android, iOS, Windows, macOS, and Web use the proven dual HTML5 <audio> deck.
 * - Linux Tauri desktop uses a persistent Web Audio API (AudioContext + decodeAudioData +
 *   AudioBufferSourceNode) path to bypass WebKitGTK's 10-second per-ayah GStreamer playbin
 *   teardown/re-negotiation stall, achieving ~2ms inter-ayah handoff.
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

  // Linux Tauri Web Audio API state
  private readonly useWebAudioOnLinux = isLinuxTauriRuntime();
  private audioCtx: AudioContext | null = null;
  private activeSource: AudioBufferSourceNode | null = null;
  private activeBuffer: AudioBuffer | null = null;
  private bufferCache = new Map<string, AudioBuffer>();
  private decodingPromises = new Map<string, Promise<AudioBuffer | null>>();
  private webAudioStartCtxTime = 0;
  private webAudioOffsetSec = 0;

  constructor(private callbacks: DeckCallbacks) {
    this.activeAudio.preload = 'auto';
    this.standbyAudio.preload = 'auto';
    this.activeAudio.setAttribute('playsinline', 'true');
    this.standbyAudio.setAttribute('playsinline', 'true');
  }

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        this.audioCtx = new Ctx();
      }
    }
    return this.audioCtx;
  }

  unlock(): void {
    if (this.unlocked) return;
    this.unlocked = true;

    if (this.useWebAudioOnLinux) {
      const ctx = this.ensureAudioContext();
      if (ctx && ctx.state === 'suspended') {
        void ctx.resume().catch(() => {});
      }
      return;
    }

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
    if (this.useWebAudioOnLinux && this.audioCtx && this.activeSource && this.playing) {
      this.webAudioOffsetSec +=
        (this.audioCtx.currentTime - this.webAudioStartCtxTime) * this.playbackRate;
      this.webAudioStartCtxTime = this.audioCtx.currentTime;
      this.activeSource.playbackRate.value = rate;
    }
    this.playbackRate = rate;
    this.activeAudio.playbackRate = rate;
    this.standbyAudio.playbackRate = rate;
  }

  private async decodeUrl(url: string): Promise<AudioBuffer | null> {
    if (!url) return null;
    const hit = this.bufferCache.get(url);
    if (hit) return hit;

    const inflight = this.decodingPromises.get(url);
    if (inflight) return inflight;

    const ctx = this.ensureAudioContext();
    if (!ctx) return null;

    const task = (async (): Promise<AudioBuffer | null> => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const raw = await resp.arrayBuffer();
        const decoded = await ctx.decodeAudioData(raw.slice(0));
        if (this.bufferCache.size >= 16) {
          const oldestKey = this.bufferCache.keys().next().value;
          if (oldestKey) this.bufferCache.delete(oldestKey);
        }
        this.bufferCache.set(url, decoded);
        return decoded;
      } catch {
        return null;
      } finally {
        this.decodingPromises.delete(url);
      }
    })();

    this.decodingPromises.set(url, task);
    return task;
  }

  preloadNext(bundle: AyahBundle | undefined): void {
    if (!bundle || !bundle.audioUrl) return;
    if (this.useWebAudioOnLinux) {
      void this.decodeUrl(bundle.audioUrl);
      return;
    }
    if (this.standbyAudio.src !== bundle.audioUrl && !this.standbyAudio.src.endsWith(bundle.audioUrl)) {
      this.standbyAudio.src = bundle.audioUrl;
      this.standbyAudio.load();
    }
  }

  private isRemoteUrl(url: string): boolean {
    return /^https?:\/\//i.test(url);
  }

  private syncDurationFromSeconds(durationSec: number, bundle: AyahBundle): void {
    if (
      (bundle.clipEndSec === null || bundle.clipEndSec === undefined) &&
      Number.isFinite(durationSec) &&
      durationSec > 0
    ) {
      const realMs = Math.round(durationSec * 1000);
      if (Math.abs(realMs - bundle.durationMs) > 250) {
        bundle.durationMs = realMs;
        const text = bundle.words.map((w) => w.textUthmani).join(' ');
        bundle.words = synthesizeWordSegments(text, realMs, 0);
      }
    }
  }

  private stopWebAudioSource(): void {
    if (this.activeSource) {
      this.activeSource.onended = null;
      try {
        this.activeSource.stop();
      } catch {
        // Already stopped
      }
      try {
        this.activeSource.disconnect();
      } catch {
        // Ignore
      }
      this.activeSource = null;
    }
  }

  private startWebAudioBuffer(bundle: AyahBundle, buffer: AudioBuffer, offsetSec: number): void {
    const ctx = this.ensureAudioContext();
    if (!ctx) return;
    this.stopWebAudioSource();

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = this.playbackRate;
    src.connect(ctx.destination);

    this.activeSource = src;
    this.activeBuffer = buffer;
    this.webAudioOffsetSec = offsetSec;
    this.webAudioStartCtxTime = ctx.currentTime;

    src.onended = () => {
      if (this.playing && this.activeSource === src && this.currentBundle === bundle) {
        this.activeSource = null;
        this.stopLoop();
        this.callbacks.onAyahEnded();
      }
    };

    const clipEnd = bundle.clipEndSec;
    if (clipEnd !== null && clipEnd !== undefined && clipEnd > offsetSec) {
      src.start(0, offsetSec, Math.max(0.05, clipEnd - offsetSec));
    } else {
      src.start(0, Math.max(0, offsetSec));
    }
    this.startWebAudioLoop();
  }

  private async playViaWebAudio(bundle: AyahBundle, nextBundle?: AyahBundle): Promise<boolean> {
    const ctx = this.ensureAudioContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // Continue
      }
    }

    // Kick off next-ayah decode immediately in parallel
    if (nextBundle && nextBundle.audioUrl && nextBundle.audioUrl !== bundle.audioUrl) {
      void this.decodeUrl(nextBundle.audioUrl);
    }

    const decoded = await this.decodeUrl(bundle.audioUrl);
    if (!this.playing || this.currentBundle !== bundle) return true;
    if (!decoded) return false;

    this.syncDurationFromSeconds(decoded.duration, bundle);
    this.startWebAudioBuffer(bundle, decoded, bundle.clipStartSec ?? 0);
    return true;
  }

  async play(bundle: AyahBundle, nextBundle?: AyahBundle): Promise<void> {
    this.stopLoop();
    this.stopWebAudioSource();
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

    // Linux Tauri fast path: zero-latency persistent AudioContext (~2ms handoff)
    if (this.useWebAudioOnLinux) {
      const ok = await this.playViaWebAudio(bundle, nextBundle);
      if (ok) return;
      if (!this.playing || this.currentBundle !== bundle) return;
      // If offline or local asset failed decode, report error cleanly; otherwise fall back to <audio>
      if (
        (typeof navigator !== 'undefined' && navigator.onLine === false) ||
        !this.isRemoteUrl(bundle.audioUrl)
      ) {
        this.stop();
        this.callbacks.onOfflineError?.(
          bundle,
          `Audio unavailable for ${bundle.verseKey} — cache in OFFLINE tab`
        );
        return;
      }
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
      this.syncDurationFromSeconds(audio.duration, bundle);
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

    try {
      await audio.play();
      if (!this.playing || this.currentBundle !== bundle) return;
      this.syncDurationFromSeconds(audio.duration, bundle);
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
    if (this.useWebAudioOnLinux && this.audioCtx && this.activeSource) {
      this.webAudioOffsetSec +=
        (this.audioCtx.currentTime - this.webAudioStartCtxTime) * this.playbackRate;
      this.stopWebAudioSource();
      return;
    }
    this.activeAudio.pause();
  }

  async resume(): Promise<void> {
    if (!this.currentBundle) return;
    this.playing = true;
    if (this.useWebAudioOnLinux && this.activeBuffer) {
      const ctx = this.ensureAudioContext();
      if (ctx && ctx.state === 'suspended') {
        await ctx.resume();
      }
      this.startWebAudioBuffer(this.currentBundle, this.activeBuffer, this.webAudioOffsetSec);
      return;
    }
    this.activeAudio.playbackRate = this.playbackRate;
    await this.activeAudio.play();
    this.startLoop();
  }

  stop(): void {
    this.playing = false;
    this.stopLoop();
    this.stopWebAudioSource();
    this.activeBuffer = null;
    this.webAudioOffsetSec = 0;
    this.activeAudio.onended = null;
    this.activeAudio.onerror = null;
    this.activeAudio.onloadedmetadata = null;
    this.activeAudio.pause();
    this.standbyAudio.pause();
    this.currentBundle = null;
  }

  private startWebAudioLoop(): void {
    this.stopLoop();
    const tick = () => {
      if (!this.playing || !this.currentBundle || !this.audioCtx) return;
      const b = this.currentBundle;
      const startSec = b.clipStartSec ?? 0;
      const elapsedSec =
        this.webAudioOffsetSec + (this.audioCtx.currentTime - this.webAudioStartCtxTime) * this.playbackRate;
      const relMs = Math.max(0, (elapsedSec - startSec) * 1000);
      const wordIdx = resolveActiveWordIndex(b.words, relMs);
      if (wordIdx !== this.lastWordIndex) {
        this.lastWordIndex = wordIdx;
        this.callbacks.onWordChange(wordIdx);
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
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
