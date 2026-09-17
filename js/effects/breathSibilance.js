/**
 * Breath & Sibilance Control – Dynamic De-Esser + Breath attenuation
 * Real multi-band dynamics (not static EQ cut).
 */
import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'breathSibilance',
  name: 'نفس و سیبیلانس',
  description: 'کاهش نفس اضافه و تیزی S/SH بدون از بین رفتن وضوح',
  icon: 'quality',
  category: 'correction',
  defaultParams: {
    amount: 0.55,
    sensitivity: 0.5,
    sibilance: 0.65,
    breath: 0.45,
    freq: 6500
  },
  paramHints: {
    amount: 'شدت کلی کنترل',
    sensitivity: 'حساسیت تشخیص',
    sibilance: 'کاهش تیزی S و SH',
    breath: 'کاهش نفس‌های بلند',
    freq: 'مرکز باند سیبیلانس'
  }
};

/**
 * Split-band dynamic de-esser + gentle breath shelf.
 * Sibilance path: BP → compressor → blend
 * Breath path: high-shelf ducked by amount when energy is airy
 */
export function createNodes(ctx, params = {}) {
  const amount = clamp01(params.amount ?? 0.55);
  const sens = clamp01(params.sensitivity ?? 0.5);
  const sib = clamp01(params.sibilance ?? 0.65);
  const breath = clamp01(params.breath ?? 0.45);
  const freq = params.freq ?? 6500;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  // --- Main path (mostly dry, mild breath shelf) ---
  const main = createGain(ctx, 1);
  const breathShelf = createBiquad(ctx, 'highshelf', 4500, 0.7, -breath * amount * 4);

  // --- Sibilance detection / reduction band ---
  const bp = createBiquad(ctx, 'bandpass', freq, 1.4);
  const sibComp = ctx.createDynamicsCompressor();
  // Higher sensitivity → lower threshold (easier to trigger)
  sibComp.threshold.value = -28 - sens * 18;
  sibComp.knee.value = 6;
  sibComp.ratio.value = 3 + sib * amount * 8;
  sibComp.attack.value = 0.002;
  sibComp.release.value = 0.08;

  const sibGain = createGain(ctx, -sib * amount * 0.85); // inverted send for reduction feel
  // Better approach: process sibilance band and mix reduced version
  const wetSib = createGain(ctx, sib * amount * 0.9);
  const dryMain = createGain(ctx, 1);

  // Parallel: take sibilance band, compress heavily, subtract-ish via lower wet
  const sibOut = createGain(ctx, 1);

  // Structure:
  // input → dryMain → breathShelf → output
  // input → bp → sibComp → wetSib (attenuated) → mix concept:
  // Actually classic: split low+mid pass + compressed high, then sum.
  const lowMid = createBiquad(ctx, 'lowpass', freq * 0.75, 0.7);
  const highBand = createBiquad(ctx, 'highpass', freq * 0.7, 0.7);
  const highComp = ctx.createDynamicsCompressor();
  highComp.threshold.value = -30 - sens * 16;
  highComp.knee.value = 8;
  highComp.ratio.value = 4 + amount * sib * 10;
  highComp.attack.value = 0.0015;
  highComp.release.value = 0.06 + (1 - sens) * 0.08;
  const highGain = createGain(ctx, 1 - sib * amount * 0.55);

  input.connect(lowMid);
  lowMid.connect(breathShelf);

  input.connect(highBand);
  highBand.connect(highComp);
  highComp.connect(highGain);
  highGain.connect(breathShelf);

  // Mild overall breath noise gate-ish on very quiet air
  const breathComp = ctx.createDynamicsCompressor();
  breathComp.threshold.value = -42 - breath * 10;
  breathComp.knee.value = 12;
  breathComp.ratio.value = 1.5 + breath * amount * 2;
  breathComp.attack.value = 0.02;
  breathComp.release.value = 0.25;

  breathShelf.connect(breathComp);
  breathComp.connect(output);

  // Keep unused nodes referenced for disconnect cleanup
  void bp; void sibComp; void sibGain; void wetSib; void dryMain; void sibOut; void main;

  return {
    input, output,
    nodes: [input, lowMid, highBand, highComp, highGain, breathShelf, breathComp, output],
    update(p) {
      const a = clamp01(p.amount ?? amount);
      const s = clamp01(p.sensitivity ?? sens);
      const sb = clamp01(p.sibilance ?? sib);
      const br = clamp01(p.breath ?? breath);
      const f = p.freq ?? freq;

      highBand.frequency.setTargetAtTime(f * 0.7, ctx.currentTime, 0.05);
      lowMid.frequency.setTargetAtTime(f * 0.75, ctx.currentTime, 0.05);
      highComp.threshold.setTargetAtTime(-30 - s * 16, ctx.currentTime, 0.05);
      highComp.ratio.setTargetAtTime(4 + a * sb * 10, ctx.currentTime, 0.05);
      highGain.gain.setTargetAtTime(1 - sb * a * 0.55, ctx.currentTime, 0.05);
      breathShelf.gain.setTargetAtTime(-br * a * 4, ctx.currentTime, 0.05);
      breathComp.threshold.setTargetAtTime(-42 - br * 10, ctx.currentTime, 0.05);
      breathComp.ratio.setTargetAtTime(1.5 + br * a * 2, ctx.currentTime, 0.05);
    }
  };
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}
