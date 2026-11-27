import type { DialSettings } from '../core/types';
import type { PlatformBridge } from './bridge';

const AUDIO_CACHE_NAME = 'quran-instrument-audio-v1';
const PREFS_KEY = 'quran-instrument-dials-v1';

export class WebPlatformAdapter implements PlatformBridge {
  private wakeLock: WakeLockSentinel | null = null;

  async cacheAudio(remoteUrl: string): Promise<string> {
    if ('caches' in window) {
      try {
        const cache = await caches.open(AUDIO_CACHE_NAME);
        let resp = await cache.match(remoteUrl);
        if (!resp) {
          resp = await fetch(remoteUrl);
          if (resp.ok) await cache.put(remoteUrl, resp.clone());
        }
        if (resp && resp.ok) {
          const blob = await resp.blob();
          return URL.createObjectURL(blob);
        }
      } catch {
        // Fallback to direct URL
      }
    }
    return remoteUrl;
  }

  async cacheJson<T>(key: string, remoteUrl: string): Promise<T> {
    const storageKey = `quran-json-${key}`;
    try {
      const hit = localStorage.getItem(storageKey);
      if (hit) return JSON.parse(hit) as T;
    } catch {
      // Ignore storage read errors
    }
    const res = await fetch(remoteUrl);
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
