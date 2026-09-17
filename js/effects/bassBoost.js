import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'bassBoost',
  name: 'تقویت بیس',
  description: 'تقویت کنترل‌شده بم و گرمای صدا بدون clipping',
  icon: 'bass',
  category: 'enhancement',
  defaultParams: { amount: 5, frequency: 110 }
};

export function createNodes(ctx, params = {}) {
  const amount = Math.min(10, params.amount ?? 5);
  const freq = params.frequency ?? 110;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  // Protect sub-rumble
  const hp = createBiquad(ctx, 'highpass', 40, 0.7);
  const shelf = createBiquad(ctx, 'lowshelf', freq, 1, amount);
  const warm = createBiquad(ctx, 'peaking', 220, 1.0, amount > 6 ? amount * 0.25 : 0);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 8;
  comp.ratio.value = 2.2;
  comp.attack.value = 0.01;
  comp.release.value = 0.2;

  const makeUp = createGain(ctx, 1);

  input.connect(hp);
  hp.connect(shelf);
  shelf.connect(warm);
  warm.connect(comp);
  comp.connect(makeUp);
  makeUp.connect(output);

  return {
    input, output,
    nodes: [input, hp, shelf, warm, comp, makeUp, output],
    update(p) {
      if (p.amount !== undefined) {
        const a = Math.min(10, p.amount);
        shelf.gain.setTargetAtTime(a, ctx.currentTime, 0.04);
        warm.gain.setTargetAtTime(a > 6 ? a * 0.25 : 0, ctx.currentTime, 0.04);
      }
      if (p.frequency !== undefined) {
        shelf.frequency.setTargetAtTime(p.frequency, ctx.currentTime, 0.04);
      }
    }
  };
}
