/**
 * Low-End Processor (Bass) – V2.4.4
 * Controlled shelf + Q peaking, mud guard, soft makeup, no runaway gain.
 * Units: amount (dB 0–9), frequency (Hz 50–200), q (0.5–2.5)
 */
import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'bassBoost',
  name: 'Bass / Low-End',
  description: 'تقویت کنترل‌شده بیس با محافظت از گل‌آلودگی و کلیپ',
  icon: 'bass',
  category: 'tone',
  defaultParams: { amount: 3.5, frequency: 90, q: 0.85 },
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
  let amount = clamp(params.amount ?? 3.5, 0, 9);
  let freq = clamp(params.frequency ?? 90, 50, 200);
  let q = clamp(params.q ?? 0.85, 0.5, 2.5);

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  // Kill sub-rumble that causes boom on small speakers
  const hp = createBiquad(ctx, 'highpass', 32, 0.7);
  // Primary low shelf – musical boost
  const shelf = createBiquad(ctx, 'lowshelf', freq, 0.8, amount * 0.75);
  // Focused bell for punch (around freq * 1.3)
  const punch = createBiquad(ctx, 'peaking', Math.min(220, freq * 1.35), q, amount * 0.35);
  // Mud cut 250–350 when boost is strong
  const mud = createBiquad(ctx, 'peaking', 280, 1.1, amount > 4 ? -(amount - 3) * 0.45 : 0);
  // Soft dynamics to catch peaks after boost
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 1.6;
  comp.attack.value = 0.012;
  comp.release.value = 0.2;
  // Makeup inverse so perceived loudness doesn't explode
  const makeup = createGain(ctx, Math.max(0.65, 1 - amount * 0.035));

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
      shelf.gain.setTargetAtTime(amount * 0.75, t, 0.04);
      punch.frequency.setTargetAtTime(Math.min(220, freq * 1.35), t, 0.04);
      punch.Q.setTargetAtTime(q, t, 0.04);
      punch.gain.setTargetAtTime(amount * 0.35, t, 0.04);
      mud.gain.setTargetAtTime(amount > 4 ? -(amount - 3) * 0.45 : 0, t, 0.04);
      makeup.gain.setTargetAtTime(Math.max(0.65, 1 - amount * 0.035), t, 0.04);
    }
  };
}
