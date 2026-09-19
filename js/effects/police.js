/**
 * Police / Radio character – V2.5.2 Pro
 * Narrow band + peak + saturation for radio / walkie feel
 */
import { createGain, createBiquad, createShaper } from './baseEffect.js';

export const meta = {
  id: 'police',
  name: 'پلیس / رادیو',
  description: 'افکت رادیو و بلندگوی پلیس',
  icon: 'police',
  category: 'environment',
  defaultParams: { intensity: 0.75 }
};

export function createNodes(ctx, params = {}) {
  const intensity = params.intensity ?? 0.75;
  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const hp = createBiquad(ctx, 'highpass', 420 + intensity * 220, 1.0);
  const lp = createBiquad(ctx, 'lowpass', 2700 - intensity * 450, 1.0);
  const peak = createBiquad(ctx, 'peaking', 1300, 2.5, 7 + intensity * 4);
  const shaper = createShaper(ctx, 20 + intensity * 45);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -11;
  comp.knee.value = 2;
  comp.ratio.value = 6;
  comp.attack.value = 0.001;
  comp.release.value = 0.06;

  const hs = createBiquad(ctx, 'highshelf', 1900, 1, 2.5 + intensity * 3);
  const makeUp = createGain(ctx, 0.88);

  input.connect(hp);
  hp.connect(lp);
  lp.connect(peak);
  peak.connect(shaper);
  shaper.connect(hs);
  hs.connect(comp);
  comp.connect(makeUp);
  makeUp.connect(output);

  return {
    input, output,
    nodes: [input, hp, lp, peak, shaper, hs, comp, makeUp, output],
    update(p) {
      const inten = p.intensity ?? intensity;
      const t = ctx.currentTime;
      hp.frequency.setTargetAtTime(420 + inten * 220, t, 0.04);
      lp.frequency.setTargetAtTime(2700 - inten * 450, t, 0.04);
      peak.gain.setTargetAtTime(7 + inten * 4, t, 0.04);
      hs.gain.setTargetAtTime(2.5 + inten * 3, t, 0.04);
    }
  };
}
