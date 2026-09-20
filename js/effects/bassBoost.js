/**
 * Bass / Low-End – V3.0.1
 * Auto intensity: low | medium | strong + manual amount
 */
import { createGain, createBiquad } from './baseEffect.js';

export const INTENSITY_PRESETS = {
  low:    { amount: 3.0, frequency: 85, q: 0.75 },
  medium: { amount: 5.5, frequency: 95, q: 0.9 },
  strong: { amount: 8.0, frequency: 105, q: 1.1 }
};

export const meta = {
  id: 'bassBoost',
  name: 'Bass / Low-End',
  description: 'تقویت بیس با سه شدت: کم، متوسط، قوی',
  icon: 'bass',
  category: 'tone',
  defaultParams: { intensityMode: 'medium', amount: 5.5, frequency: 95, q: 0.9 },
  paramUnits: { amount: 'dB', frequency: 'Hz', q: 'Q' },
  paramRanges: {
    amount: [0, 12],
    frequency: [50, 200],
    q: [0.5, 2.5]
  },
  paramHints: {
    intensityMode: 'کم · متوسط · قوی'
  }
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(v) || lo));
}

function resolveParams(params = {}) {
  const mode = params.intensityMode || 'medium';
  const preset = INTENSITY_PRESETS[mode] || INTENSITY_PRESETS.medium;
  return {
    amount: clamp(params.amount ?? preset.amount, 0, 12),
    frequency: clamp(params.frequency ?? preset.frequency, 50, 200),
    q: clamp(params.q ?? preset.q, 0.5, 2.5),
    intensityMode: mode
  };
}

export function createNodes(ctx, params = {}) {
  let p = resolveParams(params);
  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const hp = createBiquad(ctx, 'highpass', 28, 0.7);
  const shelf = createBiquad(ctx, 'lowshelf', p.frequency, 0.75, p.amount * 0.9);
  const punch = createBiquad(ctx, 'peaking', Math.min(200, p.frequency * 1.35), p.q, p.amount * 0.5);
  const mud = createBiquad(ctx, 'peaking', 270, 1.0, p.amount > 4 ? -(p.amount - 3) * 0.45 : -0.4);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 1.8;
  comp.attack.value = 0.012;
  comp.release.value = 0.2;

  const makeup = createGain(ctx, Math.max(0.65, 1 - p.amount * 0.028));

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
    update(raw) {
      p = resolveParams(raw);
      const t = ctx.currentTime;
      shelf.frequency.setTargetAtTime(p.frequency, t, 0.04);
      shelf.gain.setTargetAtTime(p.amount * 0.9, t, 0.04);
      punch.frequency.setTargetAtTime(Math.min(200, p.frequency * 1.35), t, 0.04);
      punch.Q.setTargetAtTime(p.q, t, 0.04);
      punch.gain.setTargetAtTime(p.amount * 0.5, t, 0.04);
      mud.gain.setTargetAtTime(p.amount > 4 ? -(p.amount - 3) * 0.45 : -0.4, t, 0.04);
      makeup.gain.setTargetAtTime(Math.max(0.65, 1 - p.amount * 0.028), t, 0.04);
    }
  };
}
