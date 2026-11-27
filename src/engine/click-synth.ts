let sharedAudioCtx: AudioContext | null = null;

/**
 * Procedural 8ms tactile micro-switch click using Web Audio API
 * (OscillatorNode + short bandpass noise burst). Zero external audio files.
 */
export function playMechanicalClick(accent = false): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
    if (sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume();
    }
    const now = sharedAudioCtx.currentTime;

    const osc = sharedAudioCtx.createOscillator();
    const oscGain = sharedAudioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(accent ? 1650 : 2100, now);
    osc.frequency.exponentialRampToValueAtTime(accent ? 320 : 480, now + 0.008);
    oscGain.gain.setValueAtTime(accent ? 0.16 : 0.11, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.009);
    osc.connect(oscGain);
    oscGain.connect(sharedAudioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.01);

    const bufferSize = Math.floor(sharedAudioCtx.sampleRate * 0.008);
    const buffer = sharedAudioCtx.createBuffer(1, bufferSize, sharedAudioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
    }
    const noise = sharedAudioCtx.createBufferSource();
    noise.buffer = buffer;
    const filter = sharedAudioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = accent ? 2400 : 3200;
    filter.Q.value = 1.8;
    const noiseGain = sharedAudioCtx.createGain();
    noiseGain.gain.setValueAtTime(accent ? 0.22 : 0.14, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.008);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(sharedAudioCtx.destination);
    noise.start(now);
  } catch {
    // AudioContext blocked prior to gesture
  }
}
