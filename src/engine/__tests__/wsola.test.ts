import { describe, it, expect } from 'vitest';
import { timeStretchChannels } from '../wsola';

function estimateFrequencyHz(samples: Float32Array, sampleRate: number): number {
  let crossings = 0;
  const start = Math.floor(samples.length * 0.15);
  const end = Math.floor(samples.length * 0.85);
  for (let i = start + 1; i < end; i++) {
    if (samples[i - 1] <= 0 && samples[i] > 0) crossings++;
  }
  const durSec = (end - start) / sampleRate;
  return crossings / durSec;
}

describe('WSOLA Pitch-Preserving Time-Stretcher', () => {
  const sr = 24000;
  const f0 = 150; // typical male vocal fundamental frequency (150 Hz)
  const input = new Float32Array(sr); // 1 second
  for (let i = 0; i < sr; i++) {
    input[i] = Math.sin((2 * Math.PI * f0 * i) / sr);
  }

  it('preserves vocal pitch at 1.5x speed while shortening duration by 1/1.5', () => {
    const [out] = timeStretchChannels([input], sr, 1.5);
    expect(out.length).toBe(Math.round(sr / 1.5));
    const estHz = estimateFrequencyHz(out, sr);
    expect(Math.abs(estHz - f0)).toBeLessThan(8);
  });

  it('preserves vocal pitch at 0.75x speed while lengthening duration by 1/0.75', () => {
    const [out] = timeStretchChannels([input], sr, 0.75);
    expect(out.length).toBe(Math.round(sr / 0.75));
    const estHz = estimateFrequencyHz(out, sr);
    expect(Math.abs(estHz - f0)).toBeLessThan(8);
  });
});
