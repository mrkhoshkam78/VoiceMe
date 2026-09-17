/**
 * Improve Quality – V2.4.4 professional corrective chain
 * HPF → mud cut → body → harsh cut → presence → air → soft comp
 * NOT a treble/volume booster.
 */
import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'improveQuality',
  name: 'بهبود کیفیت',
  description: 'اصلاح mud/harshness و Presence طبیعی — نه فقط Treble',
  icon: 'quality',
  category: 'tone',
  defaultParams: { intensity: 0.6, clarity: 0.55, warmth: 0.35 },
  paramUnits: { intensity: 'ratio', clarity: 'ratio', warmth: 'ratio' },
  paramRanges: {
    intensity: [0, 1],
    clarity: [0, 1],
    warmth: [0, 1]
  }
};

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

export function createNodes(ctx, params = {}) {
  let intensity = clamp01(params.intensity ?? 0.6);
  let clarity = clamp01(params.clarity ?? 0.55);
  let warmth = clamp01(params.warmth ?? 0.35);

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const hp = createBiquad(ctx, 'highpass', 50 + intensity * 15, 0.7);
  const mud = createBiquad(ctx, 'peaking', 280, 1.1, -1.2 - intensity * 2.2);
  const body = createBiquad(ctx, 'peaking', 170, 0.9, warmth * 2.0);
  const harsh = createBiquad(ctx, 'peaking', 4200, 1.4, -0.6 - clarity * 2.2);
  const presence = createBiquad(ctx, 'peaking', 3100, 1.15, 1.0 + intensity * 2.2 * clarity);
  // Soft air — capped to avoid brittle highs
  const air = createBiquad(ctx, 'highshelf', 9500, 0.7, Math.min(2.2, 0.4 + intensity * 1.0 * clarity));

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -24;
  comp.knee.value = 14;
  comp.ratio.value = 1.7;
  comp.attack.value = 0.015;
  comp.release.value = 0.22;

  const makeup = createGain(ctx, 1.0);

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
      intensity = clamp01(p.intensity ?? intensity);
      clarity = clamp01(p.clarity ?? clarity);
      warmth = clamp01(p.warmth ?? warmth);
      const t = ctx.currentTime;
      hp.frequency.setTargetAtTime(50 + intensity * 15, t, 0.05);
      mud.gain.setTargetAtTime(-1.2 - intensity * 2.2, t, 0.05);
      body.gain.setTargetAtTime(warmth * 2.0, t, 0.05);
      harsh.gain.setTargetAtTime(-0.6 - clarity * 2.2, t, 0.05);
      presence.gain.setTargetAtTime(1.0 + intensity * 2.2 * clarity, t, 0.05);
      air.gain.setTargetAtTime(Math.min(2.2, 0.4 + intensity * 1.0 * clarity), t, 0.05);
    }
  };
}
