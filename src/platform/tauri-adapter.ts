import { appCacheDir, join } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';
import { exists, mkdir, writeFile } from '@tauri-apps/plugin-fs';
import { impactFeedback } from '@tauri-apps/plugin-haptics';
import type { PlatformBridge } from './bridge';
import { WebPlatformAdapter } from './web-adapter';

export class TauriPlatformAdapter extends WebPlatformAdapter implements PlatformBridge {
  override async cacheAudio(remoteUrl: string): Promise<string> {
    try {
      const cacheRoot = await appCacheDir();
      const audioDir = await join(cacheRoot, 'audio');
      await mkdir(audioDir, { recursive: true });
      const fileName = remoteUrl.replace(/[^a-zA-Z0-9._-]/g, '_');
      const fullPath = await join(audioDir, fileName);

      if (!(await exists(fullPath))) {
        const res = await fetch(remoteUrl);
        if (!res.ok) return remoteUrl;
        const buf = new Uint8Array(await res.arrayBuffer());
        await writeFile(fullPath, buf);
      }
      return convertFileSrc(fullPath);
    } catch {
      return super.cacheAudio(remoteUrl);
    }
  }

  override async triggerHaptic(style: 'light' | 'medium'): Promise<void> {
    try {
      await impactFeedback(style);
    } catch {
      await super.triggerHaptic(style);
    }
  }
}
