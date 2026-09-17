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

  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -2.5;
  limiter.knee.value = 1.5;
  limiter.ratio.value = 14;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.04;

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
