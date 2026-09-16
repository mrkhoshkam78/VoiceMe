/**
 * Bass Boost
 */

import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'bassBoost',
  name: 'تقویت بیس',
  description: 'افزایش فرکانس‌های پایین با کنترل شدت',
  icon: '🔉',
  category: 'enhancement',
  defaultParams: {
    amount: 6, // dB 0-15
    frequency: 100 // Hz
  }
};

export function createNodes(ctx, params = {}) {
  const amount = params.amount ?? 6;
  const freq = params.frequency ?? 100;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const lowshelf = createBiquad(ctx, 'lowshelf', freq, 1, amount);
  // Gentle mid cut to prevent muddiness when boosting a lot
  const midCut = createBiquad(ctx, 'peaking', 350, 1.2, amount > 8 ? -1.5 : 0);

  // Soft limiter-ish compressor to control peaks from bass boost
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 8;
  compressor.ratio.value = 2.5;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.2;

  const makeUp = createGain(ctx, 1);

  input.connect(lowshelf);
  lowshelf.connect(midCut);
  midCut.connect(compressor);
  compressor.connect(makeUp);
  makeUp.connect(output);

  return {
    input,
    output,
    nodes: [input, lowshelf, midCut, compressor, makeUp, output],
    update(params) {
      if (params.amount !== undefined) {
        lowshelf.gain.setTargetAtTime(params.amount, ctx.currentTime, 0.05);
        midCut.gain.setTargetAtTime(params.amount > 8 ? -1.5 : 0, ctx.currentTime, 0.05);
      }
      if (params.frequency !== undefined) {
        lowshelf.frequency.setTargetAtTime(params.frequency, ctx.currentTime, 0.05);
      }
    }
  };
}
