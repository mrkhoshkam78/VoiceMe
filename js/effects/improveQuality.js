/**
 * Improve Quality – V2.5.2 Pro corrective chain
 * HPF → mud cut → body → harsh cut → presence → air → soft comp
 * Conservative musical defaults – clarity without harshness.
 */
import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'improveQuality',
  name: 'بهبود کیفیت',
  description: 'اصلاح mud/harshness و Presence طبیعی — نه فقط Treble',
  icon: 'quality',
  category: 'tone',
  defaultParams: { intensity: 0.5, clarity: 0.5, warmth: 0.4 },
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
  let intensity = clamp01(params.intensity ?? 0.5);
  let clarity = clamp01(params.clarity ?? 0.5);
  let warmth = clamp01(params.warmth ?? 0.4);

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const hp = createBiquad(ctx, 'highpass', 45 + intensity * 12, 0.7);
  // Mud cut – classic 250–300 Hz cleanup
  const mud = createBiquad(ctx, 'peaking', 270, 1.0, -0.8 - intensity * 1.8);
  // Body / warmth around 160–180
  const body = createBiquad(ctx, 'peaking', 165, 0.85, warmth * 1.8);
  // Harshness cut (nasal / boxy upper mids) – gentle
  const harsh = createBiquad(ctx, 'peaking', 4000, 1.3, -0.4 - clarity * 1.6);
  // Presence – musical, not piercing
  const presence = createBiquad(ctx, 'peaking', 3000, 1.1, 0.6 + intensity * 1.6 * clarity);
  // Soft air – capped to avoid brittle highs
  const air = createBiquad(ctx, 'highshelf', 10000, 0.7, Math.min(1.8, 0.3 + intensity * 0.8 * clarity));

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -22;
  comp.knee.value = 16;
  comp.ratio.value = 1.5;
  comp.attack.value = 0.018;
  comp.release.value = 0.25;

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
      hp.frequency.setTargetAtTime(45 + intensity * 12, t, 0.05);
      mud.gain.setTargetAtTime(-0.8 - intensity * 1.8, t, 0.05);
      body.gain.setTargetAtTime(warmth * 1.8, t, 0.05);
      harsh.gain.setTargetAtTime(-0.4 - clarity * 1.6, t, 0.05);
      presence.gain.setTargetAtTime(0.6 + intensity * 1.6 * clarity, t, 0.05);
      air.gain.setTargetAtTime(Math.min(1.8, 0.3 + intensity * 0.8 * clarity), t, 0.05);
    }
  };
}
