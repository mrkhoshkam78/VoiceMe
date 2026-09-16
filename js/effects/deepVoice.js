/**
 * Deep / Thick Voice
 * Real-time: EQ + dynamics; pitchFactor requires rebuild
 */
import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'deepVoice',
  name: 'صدای عمیق',
  description: 'کاهش Pitch و افزایش ضخامت صدا',
  icon: 'deep',
  category: 'voice',
  defaultParams: { intensity: 0.7 }
};

export function createNodes(ctx, params = {}) {
  const intensity = params.intensity ?? 0.7;
  const pitchFactor = 1 - intensity * 0.32; // down to ~0.68

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const lowShelf = createBiquad(ctx, 'lowshelf', 160, 1, 5 + intensity * 8);
  const mid = createBiquad(ctx, 'peaking', 380, 1.1, 2 + intensity * 3);
  const lowpass = createBiquad(ctx, 'lowpass', 5500 - intensity * 1800, 0.75);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 10;
  comp.ratio.value = 2.2;
  comp.attack.value = 0.015;
  comp.release.value = 0.2;

  const makeUp = createGain(ctx, 1 + intensity * 0.2);

  input.connect(lowShelf);
  lowShelf.connect(mid);
  mid.connect(lowpass);
  lowpass.connect(comp);
  comp.connect(makeUp);
  makeUp.connect(output);

  return {
    input, output, pitchFactor,
    nodes: [input, lowShelf, mid, lowpass, comp, makeUp, output],
    update(p) {
      const inten = p.intensity ?? intensity;
      lowShelf.gain.setTargetAtTime(5 + inten * 8, ctx.currentTime, 0.04);
      mid.gain.setTargetAtTime(2 + inten * 3, ctx.currentTime, 0.04);
      lowpass.frequency.setTargetAtTime(5500 - inten * 1800, ctx.currentTime, 0.04);
      makeUp.gain.setTargetAtTime(1 + inten * 0.2, ctx.currentTime, 0.04);
    }
  };
}
