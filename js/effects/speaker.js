import { createGain, createBiquad, createShaper } from './baseEffect.js';

export const meta = {
  id: 'speaker',
  name: 'بلندگو',
  description: 'شبیه‌سازی صدای بلندگوی کوچک',
  icon: 'speaker',
  category: 'environment',
  defaultParams: { intensity: 0.75 }
};

export function createNodes(ctx, params = {}) {
  const intensity = params.intensity ?? 0.75;
  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const hp = createBiquad(ctx, 'highpass', 200 + intensity * 100, 0.8);
  const lp = createBiquad(ctx, 'lowpass', 4200 - intensity * 1400, 0.85);
  const mid = createBiquad(ctx, 'peaking', 1100, 1.6, 5 + intensity * 5);
  const shaper = createShaper(ctx, 15 + intensity * 35);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 3;
  comp.ratio.value = 2.50 + intensity * 5;
  comp.attack.value = 0.003;
  comp.release.value = 0.08;

  const makeUp = createGain(ctx, 0.95);

  input.connect(hp);
  hp.connect(lp);
  lp.connect(mid);
  mid.connect(shaper);
  shaper.connect(comp);
  comp.connect(makeUp);
  makeUp.connect(output);

  return {
    input, output,
    nodes: [input, hp, lp, mid, shaper, comp, makeUp, output],
    update(p) {
      const inten = p.intensity ?? intensity;
      hp.frequency.setTargetAtTime(200 + inten * 100, ctx.currentTime, 0.04);
      lp.frequency.setTargetAtTime(4200 - inten * 1400, ctx.currentTime, 0.04);
      mid.gain.setTargetAtTime(5 + inten * 5, ctx.currentTime, 0.04);
      comp.ratio.setTargetAtTime(5 + inten * 5, ctx.currentTime, 0.04);
    }
  };
}
