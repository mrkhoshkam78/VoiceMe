/**
 * Improve Quality – corrective vocal enhancement (not just treble boost)
 */
import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'improveQuality',
  name: 'بهبود کیفیت',
  description: 'اصلاح mud، harshness و افزایش Presence طبیعی',
  icon: 'quality',
  category: 'tone',
  defaultParams: { intensity: 0.65, clarity: 0.5, warmth: 0.4 }
};

export function createNodes(ctx, params = {}) {
  const intensity = params.intensity ?? 0.65;
  const clarity = params.clarity ?? 0.5;
  const warmth = params.warmth ?? 0.4;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  // Sub rumble out
  const hp = createBiquad(ctx, 'highpass', 55, 0.7);
  // Reduce boxiness / mud (200–400 Hz)
  const mud = createBiquad(ctx, 'peaking', 280, 1.1, -1.5 - intensity * 2.5);
  // Mild body restore
  const body = createBiquad(ctx, 'peaking', 180, 0.9, warmth * 2.2);
  // Tame harshness ~3–5 kHz
  const harsh = createBiquad(ctx, 'peaking', 4200, 1.4, -0.8 - clarity * 2);
  // Presence for intelligibility
  const presence = createBiquad(ctx, 'peaking', 3200, 1.2, 1.2 + intensity * 2.5 * clarity);
  // Soft air, not harsh treble
  const air = createBiquad(ctx, 'highshelf', 9000, 0.7, 0.6 + intensity * 1.2 * clarity);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -22;
  comp.knee.value = 12;
  comp.ratio.value = 1.8;
  comp.attack.value = 0.015;
  comp.release.value = 0.2;

  const makeup = createGain(ctx, 1.02);

  input.connect(hp);
  hp.connect(mud);
  mud.connect(body);
  body.connect(harsh);
  harsh.connect(presence);
  presence.connect(air);
  air.connect(comp);
  comp.connect(makeup);
  makeup.connect(output);

  return {
    input, output,
    nodes: [input, hp, mud, body, harsh, presence, air, comp, makeup, output],
    update(p) {
      const inten = p.intensity ?? intensity;
      const cl = p.clarity ?? clarity;
      const w = p.warmth ?? warmth;
      mud.gain.setTargetAtTime(-1.5 - inten * 2.5, ctx.currentTime, 0.05);
      body.gain.setTargetAtTime(w * 2.2, ctx.currentTime, 0.05);
      harsh.gain.setTargetAtTime(-0.8 - cl * 2, ctx.currentTime, 0.05);
      presence.gain.setTargetAtTime(1.2 + inten * 2.5 * cl, ctx.currentTime, 0.05);
      air.gain.setTargetAtTime(0.6 + inten * 1.2 * cl, ctx.currentTime, 0.05);
    }
  };
}
