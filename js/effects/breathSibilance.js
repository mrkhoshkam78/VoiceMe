/**
 * Breath & Sibilance Control – V2.5.2 Pro
 * Split-band dynamic de-esser + gentle breath control.
 * Preserves clarity; avoids dulling the whole track.
 */
import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'breathSibilance',
  name: 'نفس و سیبیلانس',
  description: 'کاهش نفس اضافه و تیزی S/SH بدون از بین رفتن وضوح',
  icon: 'quality',
  category: 'correction',
  defaultParams: {
    amount: 0.5,
    sensitivity: 0.45,
    sibilance: 0.6,
    breath: 0.35,
    freq: 6800
  },
  paramHints: {
    amount: 'شدت کلی کنترل',
    sensitivity: 'حساسیت تشخیص',
    sibilance: 'کاهش تیزی S و SH',
    breath: 'کاهش نفس‌های بلند',
    freq: 'مرکز باند سیبیلانس'
  }
};

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

export function createNodes(ctx, params = {}) {
  const amount = clamp01(params.amount ?? 0.5);
  const sens = clamp01(params.sensitivity ?? 0.45);
  const sib = clamp01(params.sibilance ?? 0.6);
  const breath = clamp01(params.breath ?? 0.35);
  const freq = params.freq ?? 6800;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  // Split: low-mid dry + compressed high band
  const lowMid = createBiquad(ctx, 'lowpass', freq * 0.72, 0.7);
  const highBand = createBiquad(ctx, 'highpass', freq * 0.68, 0.7);

  const highComp = ctx.createDynamicsCompressor();
  highComp.threshold.value = -28 - sens * 14;
  highComp.knee.value = 10;
  highComp.ratio.value = 3.5 + amount * sib * 7;
  highComp.attack.value = 0.0012;
  highComp.release.value = 0.05 + (1 - sens) * 0.07;

  // Reduce high band level after compression (de-ess feel)
  const highGain = createGain(ctx, 1 - sib * amount * 0.42);

  // Mild breath shelf – only light, not a blanket dull
  const breathShelf = createBiquad(ctx, 'highshelf', 5000, 0.7, -breath * amount * 2.8);

  // Soft dynamics on quiet airy material
  const breathComp = ctx.createDynamicsCompressor();
  breathComp.threshold.value = -40 - breath * 8;
  breathComp.knee.value = 16;
  breathComp.ratio.value = 1.4 + breath * amount * 1.6;
  breathComp.attack.value = 0.025;
  breathComp.release.value = 0.28;

  input.connect(lowMid);
  lowMid.connect(breathShelf);

  input.connect(highBand);
  highBand.connect(highComp);
  highComp.connect(highGain);
  highGain.connect(breathShelf);

  breathShelf.connect(breathComp);
  breathComp.connect(output);

  return {
    input, output,
    nodes: [input, lowMid, highBand, highComp, highGain, breathShelf, breathComp, output],
    update(p) {
      const a = clamp01(p.amount ?? amount);
      const s = clamp01(p.sensitivity ?? sens);
      const sb = clamp01(p.sibilance ?? sib);
      const br = clamp01(p.breath ?? breath);
      const f = p.freq ?? freq;
      const t = ctx.currentTime;

      highBand.frequency.setTargetAtTime(f * 0.68, t, 0.05);
      lowMid.frequency.setTargetAtTime(f * 0.72, t, 0.05);
      highComp.threshold.setTargetAtTime(-28 - s * 14, t, 0.05);
      highComp.ratio.setTargetAtTime(3.5 + a * sb * 7, t, 0.05);
      highGain.gain.setTargetAtTime(1 - sb * a * 0.42, t, 0.05);
      breathShelf.gain.setTargetAtTime(-br * a * 2.8, t, 0.05);
      breathComp.threshold.setTargetAtTime(-40 - br * 8, t, 0.05);
      breathComp.ratio.setTargetAtTime(1.4 + br * a * 1.6, t, 0.05);
    }
  };
}
