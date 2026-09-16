/**
 * Volume / Loudness control with soft limiting to reduce clipping risk
 */

import { createGain } from './baseEffect.js';

export const meta = {
  id: 'volume',
  name: 'بلندی صدا',
  description: 'افزایش یا کاهش Volume با جلوگیری نسبی از Clipping',
  icon: '🔈',
  category: 'enhancement',
  defaultParams: {
    gain: 1.0 // linear 0.1 - 3.0
  }
};

export function createNodes(ctx, params = {}) {
  const gainValue = params.gain ?? 1.0;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const gainNode = createGain(ctx, gainValue);

  // Soft limiter
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3;
  limiter.knee.value = 2;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.05;

  input.connect(gainNode);
  gainNode.connect(limiter);
  limiter.connect(output);

  return {
    input,
    output,
    nodes: [input, gainNode, limiter, output],
    update(params) {
      if (params.gain !== undefined) {
        gainNode.gain.setTargetAtTime(params.gain, ctx.currentTime, 0.03);
      }
    }
  };
}
