/**
 * Small Speaker character – V2.5.2 Pro
 * Band-limited + mid push + soft saturation (phone/radio speaker feel)
 */
import { createGain, createBiquad, createShaper } from './baseEffect.js';

export const meta = {
  id: 'speaker',
  name: 'بلندگو',
  description: 'شبیه‌سازی صدای بلندگوی کوچک',
  icon: 'speaker',
  category: 'environment',
  defaultParams: { intensity: 0.7 }
};

export function createNodes(ctx, params = {}) {
  const intensity = params.intensity ?? 0.7;
  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const hp = createBiquad(ctx, 'highpass', 180 + intensity * 90, 0.8);
  const lp = createBiquad(ctx, 'lowpass', 4500 - intensity * 1200, 0.85);
  const mid = createBiquad(ctx, 'peaking', 1050, 1.5, 4 + intensity * 4);
  const shaper = createShaper(ctx, 12 + intensity * 28);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 4;
  comp.ratio.value = 3 + intensity * 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.08;

  const makeUp = createGain(ctx, 0.92);

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
      const t = ctx.currentTime;
      hp.frequency.setTargetAtTime(180 + inten * 90, t, 0.04);
      lp.frequency.setTargetAtTime(4500 - inten * 1200, t, 0.04);
      mid.gain.setTargetAtTime(4 + inten * 4, t, 0.04);
      comp.ratio.setTargetAtTime(3 + inten * 4, t, 0.04);
    }
  };
}
