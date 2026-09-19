/**
 * Low-End Processor (Bass) – V2.5.2 Pro
 * Controlled shelf + Q peaking, mud guard, soft makeup, no runaway gain.
 * Tuned like a console low-end: tight punch, controlled boom, speaker-safe.
 */
import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'bassBoost',
  name: 'Bass / Low-End',
  description: 'تقویت کنترل‌شده بیس با محافظت از گل‌آلودگی و کلیپ',
  icon: 'bass',
  category: 'tone',
  defaultParams: { amount: 3.0, frequency: 85, q: 0.75 },
  paramUnits: { amount: 'dB', frequency: 'Hz', q: 'Q' },
  paramRanges: {
    amount: [0, 9],
    frequency: [50, 200],
    q: [0.5, 2.5]
  }
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(v) || lo));
}

export function createNodes(ctx, params = {}) {
  let amount = clamp(params.amount ?? 3.0, 0, 9);
  let freq = clamp(params.frequency ?? 85, 50, 200);
  let q = clamp(params.q ?? 0.75, 0.5, 2.5);

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  // Kill sub-rumble (speaker-safe, DC/rumble)
  const hp = createBiquad(ctx, 'highpass', 28, 0.7);
  // Primary low shelf – musical, not exaggerated
  const shelf = createBiquad(ctx, 'lowshelf', freq, 0.75, amount * 0.7);
  // Focused bell for punch (kick body / bass note definition)
  const punch = createBiquad(ctx, 'peaking', Math.min(200, freq * 1.3), q, amount * 0.32);
  // Mud cut 250–320 when boost is strong (classic mix move)
  const mud = createBiquad(ctx, 'peaking', 270, 1.0, amount > 3.5 ? -(amount - 2.5) * 0.4 : -0.3);
  // Soft dynamics to catch peaks after boost without pumping
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 14;
  comp.ratio.value = 1.5;
  comp.attack.value = 0.015;
  comp.release.value = 0.22;
  // Makeup inverse so perceived loudness doesn't explode
  const makeup = createGain(ctx, Math.max(0.7, 1 - amount * 0.03));

  input.connect(hp);
  hp.connect(shelf);
  shelf.connect(punch);
  punch.connect(mud);
  mud.connect(comp);
  comp.connect(makeup);
  makeup.connect(output);

  return {
    input, output,
    nodes: [input, hp, shelf, punch, mud, comp, makeup, output],
    update(p) {
      amount = clamp(p.amount ?? amount, 0, 9);
      freq = clamp(p.frequency ?? freq, 50, 200);
      q = clamp(p.q ?? q, 0.5, 2.5);
      const t = ctx.currentTime;
      shelf.frequency.setTargetAtTime(freq, t, 0.04);
      shelf.gain.setTargetAtTime(amount * 0.7, t, 0.04);
      punch.frequency.setTargetAtTime(Math.min(200, freq * 1.3), t, 0.04);
      punch.Q.setTargetAtTime(q, t, 0.04);
      punch.gain.setTargetAtTime(amount * 0.32, t, 0.04);
      mud.gain.setTargetAtTime(amount > 3.5 ? -(amount - 2.5) * 0.4 : -0.3, t, 0.04);
      makeup.gain.setTargetAtTime(Math.max(0.7, 1 - amount * 0.03), t, 0.04);
    }
  };
}
