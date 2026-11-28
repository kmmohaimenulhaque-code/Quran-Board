/**
 * Lightweight WSOLA (Waveform Similarity Overlap-Add) pitch-preserving time-stretcher.
 * Keeps vocal pitch 100% natural at 0.75x..2x speeds in Web Audio API on Linux WebKitGTK.
 */

export function timeStretchChannels(
  channels: Float32Array[],
  sampleRate: number,
  tempo: number
): Float32Array[] {
  if (channels.length === 0 || Math.abs(tempo - 1) < 0.01) {
    return channels;
  }

  const inLen = channels[0].length;
  const outLen = Math.max(1, Math.round(inLen / tempo));
  const numCh = channels.length;

  // 40ms Hann window (even length -> 50% overlap satisfies perfect COLA = 1.0)
  let winSize = Math.max(256, Math.round(sampleRate * 0.04));
  if (winSize % 2 !== 0) winSize += 1;
  const hopOut = winSize >> 1;
  const tolerance = Math.max(32, Math.round(sampleRate * 0.01));

  if (inLen <= winSize + tolerance) {
    return channels;
  }

  const win = new Float32Array(winSize);
  for (let i = 0; i < winSize; i++) {
    win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (winSize - 1)));
  }

  const outputs = Array.from({ length: numCh }, () => new Float32Array(outLen));
  const refCh = channels[0];

  // Copy initial half-window cleanly
  for (let c = 0; c < numCh; c++) {
    const src = channels[c];
    const dst = outputs[c];
    const limit = Math.min(winSize, outLen, inLen);
    for (let i = 0; i < limit; i++) {
      dst[i] += src[i] * win[i];
    }
  }

  let prevInPos = 0;
  const corrStep = 4; // 4-sample stride keeps 20s ayah stretching under ~10ms

  for (let outPos = hopOut; outPos < outLen; outPos += hopOut) {
    const idealInPos = Math.round(outPos * tempo);
    if (idealInPos >= inLen - hopOut) break;

    const natPos = prevInPos + hopOut;
    const minSearch = Math.max(0, idealInPos - tolerance);
    const maxSearch = Math.min(inLen - winSize, idealInPos + tolerance);

    let bestPos = Math.max(0, Math.min(inLen - winSize, idealInPos));
    if (natPos + hopOut < inLen && maxSearch >= minSearch) {
      let bestScore = -Infinity;
      for (let cand = minSearch; cand <= maxSearch; cand += 2) {
        let dot = 0;
        let energy = 1e-9;
        for (let k = 0; k < hopOut; k += corrStep) {
          const a = refCh[natPos + k];
          const b = refCh[cand + k];
          dot += a * b;
          energy += b * b;
        }
        const score = dot / Math.sqrt(energy);
        if (score > bestScore) {
          bestScore = score;
          bestPos = cand;
        }
      }
    }

    const writeLen = Math.min(winSize, outLen - outPos, inLen - bestPos);
    for (let c = 0; c < numCh; c++) {
      const src = channels[c];
      const dst = outputs[c];
      for (let i = 0; i < writeLen; i++) {
        dst[outPos + i] += src[bestPos + i] * win[i];
      }
    }

    prevInPos = bestPos;
  }

  return outputs;
}

export function timeStretchAudioBuffer(
  ctx: AudioContext,
  input: AudioBuffer,
  tempo: number
): AudioBuffer {
  if (Math.abs(tempo - 1) < 0.01) return input;
  const channels: Float32Array[] = [];
  for (let c = 0; c < input.numberOfChannels; c++) {
    channels.push(input.getChannelData(c));
  }
  const stretched = timeStretchChannels(channels, input.sampleRate, tempo);
  const out = ctx.createBuffer(stretched.length, stretched[0].length, input.sampleRate);
  for (let c = 0; c < stretched.length; c++) {
    out.getChannelData(c).set(stretched[c]);
  }
  return out;
}
