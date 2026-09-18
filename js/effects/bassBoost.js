import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'bassBoost',
  name: 'تقویت بیس',
  description: 'افزایش فرکانس‌های پایین',
  icon: 'bass',
  category: 'enhancement',
  defaultParams: { amount: 8, frequency: 95 }
};

export function createNodes(ctx, params = {}) {
  const amount = params.amount ?? 8;
  const freq = params.frequency ?? 95;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const shelf = createBiquad(ctx, 'lowshelf', freq, 1, amount);
  const midCut = createBiquad(ctx, 'peaking', 320, 1.3, amount > 9 ? -2 : 0);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 6;
  comp.ratio.value = 2.8;
  comp.attack.value = 0.008;
  comp.release.value = 0.18;

  input.connect(shelf);
  shelf.connect(midCut);
  midCut.connect(comp);
  comp.connect(output);

  return {
    input, output,
    nodes: [input, shelf, midCut, comp, output],
    update(p) {
      if (p.amount !== undefined) {
        shelf.gain.setTargetAtTime(p.amount, ctx.currentTime, 0.04);
        midCut.gain.setTargetAtTime(p.amount > 9 ? -2 : 0, ctx.currentTime, 0.04);
      }
      if (p.frequency !== undefined) {
        shelf.frequency.setTargetAtTime(p.frequency, ctx.currentTime, 0.04);
      }
    }
  };
}
