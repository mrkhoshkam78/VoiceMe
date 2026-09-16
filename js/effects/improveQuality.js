import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'improveQuality',
  name: 'بهبود کیفیت',
  description: 'EQ اصلاحی، Compression ملایم و افزایش وضوح',
  icon: 'quality',
  category: 'enhancement',
  defaultParams: { intensity: 0.6 }
};

export function createNodes(ctx, params = {}) {
  const intensity = params.intensity ?? 0.6;
  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const hp = createBiquad(ctx, 'highpass', 45 + intensity * 25, 0.7);
  const mud = createBiquad(ctx, 'peaking', 260, 1.0, -1.5 - intensity * 1.5);
  const presence = createBiquad(ctx, 'peaking', 3100, 1.15, 2.5 + intensity * 3);
  const deHarsh = createBiquad(ctx, 'peaking', 5200, 2.2, intensity > 0.55 ? -2 : 0);
  const air = createBiquad(ctx, 'highshelf', 8500, 1, 1.5 + intensity * 2);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -22;
  comp.knee.value = 14;
  comp.ratio.value = 2.0 + intensity;
  comp.attack.value = 0.012;
  comp.release.value = 0.28;

  const makeUp = createGain(ctx, 1 + intensity * 0.1);

  input.connect(hp);
  hp.connect(mud);
  mud.connect(presence);
  presence.connect(deHarsh);
  deHarsh.connect(air);
  air.connect(comp);
  comp.connect(makeUp);
  makeUp.connect(output);

  return {
    input, output,
    nodes: [input, hp, mud, presence, deHarsh, air, comp, makeUp, output],
    update(p) {
      const inten = p.intensity ?? intensity;
      hp.frequency.setTargetAtTime(45 + inten * 25, ctx.currentTime, 0.04);
      mud.gain.setTargetAtTime(-1.5 - inten * 1.5, ctx.currentTime, 0.04);
      presence.gain.setTargetAtTime(2.5 + inten * 3, ctx.currentTime, 0.04);
      deHarsh.gain.setTargetAtTime(inten > 0.55 ? -2 : 0, ctx.currentTime, 0.04);
      air.gain.setTargetAtTime(1.5 + inten * 2, ctx.currentTime, 0.04);
      comp.ratio.setTargetAtTime(2.0 + inten, ctx.currentTime, 0.04);
      makeUp.gain.setTargetAtTime(1 + inten * 0.1, ctx.currentTime, 0.04);
    }
  };
}
