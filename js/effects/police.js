import { createGain, createBiquad, createShaper } from './baseEffect.js';

export const meta = {
  id: 'police',
  name: 'پلیس / رادیو',
  description: 'افکت رادیو و بلندگوی پلیس',
  icon: 'police',
  category: 'environment',
  defaultParams: { intensity: 0.8 }
};

export function createNodes(ctx, params = {}) {
  const intensity = params.intensity ?? 0.8;
  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const hp = createBiquad(ctx, 'highpass', 450 + intensity * 250, 1.0);
  const lp = createBiquad(ctx, 'lowpass', 2600 - intensity * 500, 1.0);
  const peak = createBiquad(ctx, 'peaking', 1350, 2.8, 8 + intensity * 5);
  const shaper = createShaper(ctx, 25 + intensity * 55);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 2;
  comp.ratio.value = 10;
  comp.attack.value = 0.001;
  comp.release.value = 0.06;

  const hs = createBiquad(ctx, 'highshelf', 1800, 1, 3 + intensity * 4);
  const makeUp = createGain(ctx, 0.9);

  input.connect(hp);
  hp.connect(lp);
  lp.connect(peak);
  peak.connect(shaper);
  shaper.connect(hs);
  hs.connect(comp);
  comp.connect(makeUp);
  makeUp.connect(output);

  return { input, output, nodes: [input, hp, lp, peak, shaper, hs, comp, makeUp, output] };
}
