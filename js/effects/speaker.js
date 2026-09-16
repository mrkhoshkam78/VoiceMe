/**
 * Speaker / Loudspeaker simulation
 * Band-limited, mid-focused, slight distortion/compression to mimic small speaker.
 */

import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'speaker',
  name: 'بلندگو / اسپیکر',
  description: 'شبیه‌سازی صدای بلندگوی کوچک یا سیستم صوتی',
  icon: '🔊',
  category: 'environment',
  defaultParams: {
    intensity: 0.7
  }
};

export function createNodes(ctx, params = {}) {
  const intensity = params.intensity ?? 0.7;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  // Band-pass characteristic of small speaker
  const highpass = createBiquad(ctx, 'highpass', 180 + intensity * 80, 0.7);
  const lowpass = createBiquad(ctx, 'lowpass', 4500 - intensity * 1500, 0.8);
  // Mid boost (nasal / boxy)
  const mid = createBiquad(ctx, 'peaking', 1200, 1.5, 3 + intensity * 4);

  // Mild compression + soft clipping simulation via high ratio
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 4;
  compressor.ratio.value = 4 + intensity * 4;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.1;

  // WaveShaper for light distortion
  const shaper = ctx.createWaveShaper();
  const amount = 10 + intensity * 30;
  const curve = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const x = (i * 2) / 255 - 1;
    curve[i] = ((Math.PI + amount) * x) / (Math.PI + amount * Math.abs(x));
  }
  shaper.curve = curve;
  shaper.oversample = '2x';

  const makeUp = createGain(ctx, 0.9);

  input.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(mid);
  mid.connect(shaper);
  shaper.connect(compressor);
  compressor.connect(makeUp);
  makeUp.connect(output);

  return {
    input,
    output,
    nodes: [input, highpass, lowpass, mid, shaper, compressor, makeUp, output]
  };
}
