import type { DialSettings } from '../core/types';

export interface PlatformBridge {
  cacheAudio(remoteUrl: string): Promise<string>;
  downloadForOffline(remoteUrl: string, signal?: AbortSignal): Promise<boolean>;
  isAudioCached(remoteUrl: string): Promise<boolean>;
  requestPersistentStorage(): Promise<boolean>;
  cacheJson<T>(key: string, remoteUrl: string): Promise<T>;
  triggerHaptic(style: 'light' | 'medium'): Promise<void>;
  acquireWakeLock(): Promise<void>;
  releaseWakeLock(): Promise<void>;
  loadPrefs(): DialSettings | null;
  savePrefs(prefs: DialSettings): void;
}
