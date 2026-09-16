/**
 * Police radio / megaphone style effect
 * Narrow band, distortion, high-pass, slight modulation feel.
 */

import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'police',
  name: 'پلیس / رادیو',
  description: 'افکت شبیه سیستم بلندگوی خودرو یا رادیوی پلیس',
  icon: '🚓',
  category: 'environment',
  defaultParams: {
    intensity: 0.75
  }
};

export function createNodes(ctx, params = {}) {
  const intensity = params.intensity ?? 0.75;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  // Strong band-pass (radio-like)
  const highpass = createBiquad(ctx, 'highpass', 400 + intensity * 200, 0.9);
  const lowpass = createBiquad(ctx, 'lowpass', 2800 - intensity * 600, 0.9);
  const peak = createBiquad(ctx, 'peaking', 1400, 2.5, 6 + intensity * 4);

  // Distortion
  const shaper = ctx.createWaveShaper();
  const amount = 20 + intensity * 50;
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = Math.tanh(x * (1 + amount / 20));
  }
  shaper.curve = curve;
  shaper.oversample = '2x';

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -12;
  compressor.knee.value = 2;
  compressor.ratio.value = 8;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.08;

  // Noise-ish high frequency emphasis
  const noiseBoost = createBiquad(ctx, 'highshelf', 2000, 1, 2 + intensity * 3);

  const makeUp = createGain(ctx, 0.85);

  input.connect(highpass);
  highpass.connect(lowpass);
  lowpass.connect(peak);
  peak.connect(shaper);
  shaper.connect(noiseBoost);
  noiseBoost.connect(compressor);
  compressor.connect(makeUp);
  makeUp.connect(output);

  return {
    input,
    output,
    nodes: [input, highpass, lowpass, peak, shaper, noiseBoost, compressor, makeUp, output]
  };
}
