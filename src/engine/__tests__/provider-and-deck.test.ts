import { describe, it, expect } from 'vitest';
import reciters from '../../assets/data/reciters.json';
import shamimTimings from '../../assets/data/shamim-baqarah-timings.json';

describe('Reciter Directory (01..06) & Offline Pack Pipeline', () => {
  it('registers all 6 reciters including Qari Muhammad Shamim (01) and Yasser Al-Dosari (06)', () => {
    expect(reciters.length).toBe(6);
    expect(reciters[0].id).toBe(1);
    expect(reciters[0].name).toBe('Qari Muhammad Shamim');
    expect(reciters[5].id).toBe(6);
    expect(reciters[5].name).toBe('Yasser Al-Dosari');
    expect(reciters[5].everyAyahDir).toBe('Yasser_Ad-Dussary_128kbps');
  });

  it('has valid monotonic millisecond clip boundaries for Surah Al-Baqarah 2:1..2:10', () => {
    const keys = Object.keys(shamimTimings);
    expect(keys.length).toBe(10);
    let prevEnd = 0;
    for (const k of keys) {
      const seg = (shamimTimings as Record<string, { startMs: number; endMs: number }>)[k];
      expect(seg.startMs).toBeGreaterThanOrEqual(prevEnd);
      expect(seg.endMs).toBeGreaterThan(seg.startMs);
      prevEnd = seg.endMs;
    }
  });
});
