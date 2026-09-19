/**
 * Volume – V2.5.2 Pro
 * Clean gain + true brickwall-style limiter for export safety.
 */
import { createGain } from './baseEffect.js';

export const meta = {
  id: 'volume',
  name: 'بلندی صدا',
  description: 'بلندی خروجی با محافظت در برابر clipping',
  icon: 'volume',
  category: 'enhancement',
  defaultParams: { gain: 1.0 }
};

export function createNodes(ctx, params = {}) {
  const gainValue = params.gain ?? 1.0;
  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);
  const gainNode = createGain(ctx, gainValue);

  // Near-brickwall limiter for safety
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.2;
  limiter.knee.value = 0.5;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.05;

  input.connect(gainNode);
  gainNode.connect(limiter);
  limiter.connect(output);

  return {
    input, output,
    nodes: [input, gainNode, limiter, output],
    update(p) {
      if (p.gain !== undefined) {
        gainNode.gain.setTargetAtTime(p.gain, ctx.currentTime, 0.025);
      }
    }
  };
}
