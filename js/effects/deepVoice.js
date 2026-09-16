/**
 * Deep / Thick Voice Effect
 * Lowers pitch and adds body via low-shelf + mild saturation approximation.
 */

import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'deepVoice',
  name: 'صدای عمیق / ضخیم',
  description: 'کاهش Pitch و افزایش ضخامت و عمق صدا',
  icon: '🧔',
  category: 'voice',
  defaultParams: {
    intensity: 0.6
  }
};

export function createNodes(ctx, params = {}) {
  const intensity = params.intensity ?? 0.6;

  // Pitch factor < 1
  const pitchFactor = 1 - intensity * 0.25; // 1.0 → 0.75

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  // Add low-end body
  const lowShelf = createBiquad(ctx, 'lowshelf', 180, 1, 4 + intensity * 6);
  const midBoost = createBiquad(ctx, 'peaking', 400, 1.0, 1.5 + intensity * 2);
  // Soft high cut to thicken
  const highCut = createBiquad(ctx, 'lowpass', 6000 - intensity * 2000, 0.8);

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 10;
  compressor.ratio.value = 2;
  compressor.attack.value = 0.02;
  compressor.release.value = 0.2;

  // Slight overall gain compensation
  const makeUp = createGain(ctx, 1 + intensity * 0.15);

  input.connect(lowShelf);
  lowShelf.connect(midBoost);
  midBoost.connect(highCut);
  highCut.connect(compressor);
  compressor.connect(makeUp);
  makeUp.connect(output);

  return {
    input,
    output,
    pitchFactor,
    nodes: [input, lowShelf, midBoost, highCut, compressor, makeUp, output]
  };
}
