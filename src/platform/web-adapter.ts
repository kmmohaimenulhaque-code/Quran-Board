import type { DialSettings } from '../core/types';
import type { PlatformBridge } from './bridge';

const AUDIO_CACHE_NAME = 'quran-instrument-audio-v1';
const PREFS_KEY = 'quran-instrument-dials-v1';

function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)
  );
}

function createTimeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms);
  }
  return undefined;
}

export class WebPlatformAdapter implements PlatformBridge {
  private wakeLock: WakeLockSentinel | null = null;

  /**
   * Returns a playable audio URL immediately without blocking playback on network fetches.
   * - In Tauri, checks Cache API if available (fast local hit) or streams remoteUrl directly
   *   so WebKitGTK CORS/fetch never stalls or freezes the UI.
   * - In Web/PWA, serves from Cache API on hit; on miss returns remoteUrl instantly and warms cache in background.
   */
  async cacheAudio(remoteUrl: string): Promise<string> {
    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        const cache = await caches.open(AUDIO_CACHE_NAME);
        const hit = await cache.match(remoteUrl);
        if (hit && hit.ok) {
          const blob = await hit.blob();
          return URL.createObjectURL(blob);
        }
        if (!isTauriRuntime()) {
          void fetch(remoteUrl, { signal: createTimeoutSignal(5000) })
            .then((resp) => {
              if (resp.ok) return cache.put(remoteUrl, resp.clone());
              return undefined;
            })
            .catch(() => {
              // Non-fatal background cache miss
            });
        }
      } catch {
        // Fallback to direct URL
      }
    }
    return remoteUrl;
  }

  /**
   * Genuine offline downloader used by OfflineDrawer.
   * Actually fetches and stores the audio asset in Cache API and returns true only when verified.
   */
  async downloadForOffline(remoteUrl: string): Promise<boolean> {
    if (typeof window === 'undefined' || !('caches' in window)) {
      return false;
    }
    try {
      const cache = await caches.open(AUDIO_CACHE_NAME);
      const existing = await cache.match(remoteUrl);
      if (existing && existing.ok) return true;
      const resp = await fetch(remoteUrl, { signal: createTimeoutSignal(12000) });
      if (!resp.ok) return false;
      await cache.put(remoteUrl, resp.clone());
      return true;
    } catch {
      return false;
    }
  }

  async cacheJson<T>(key: string, remoteUrl: string): Promise<T> {
    const storageKey = `quran-json-${key}`;
    try {
      const hit = localStorage.getItem(storageKey);
      if (hit) return JSON.parse(hit) as T;
    } catch {
      // Ignore storage read errors
    }
    const res = await fetch(remoteUrl, { signal: createTimeoutSignal(6000) });
    if (!res.ok) throw new Error(`Failed to fetch ${remoteUrl}`);
    const data = (await res.json()) as T;
    try {
      localStorage.setItem(storageKey, JSON.stringify(data));
    } catch {
      // Ignore quota errors
    }
    return data;
  }

  async triggerHaptic(style: 'light' | 'medium'): Promise<void> {
    if ('vibrate' in navigator) {
      navigator.vibrate(style === 'medium' ? 14 : 6);
    }
  }

  async acquireWakeLock(): Promise<void> {
    try {
      if ('wakeLock' in navigator && !this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {
      // Unsupported or denied
    }
  }

  async releaseWakeLock(): Promise<void> {
    try {
      if (this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }
    } catch {
      // Ignore
    }
  }

  loadPrefs(): DialSettings | null {
    try {
      const raw = localStorage.getItem(PREFS_KEY);
      return raw ? (JSON.parse(raw) as DialSettings) : null;
    } catch {
      return null;
    }
  }

  savePrefs(prefs: DialSettings): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Ignore
    }
  }
}
