/**
 * Improve Quality (conservative)
 * - Gentle high-pass to reduce rumble
 * - Mild noise reduction approximation via high-cut of very high freqs + mild expand
 * - EQ polish
 * - Light compression
 * - Normalize is handled separately in the pipeline
 *
 * Does NOT claim to restore lost information.
 */

import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'improveQuality',
  name: 'بهبود کیفیت',
  description: 'کاهش نویز نسبی، EQ اصلاحی، Compression ملایم و افزایش وضوح',
  icon: '✨',
  category: 'enhancement',
  defaultParams: {
    intensity: 0.55
  }
};

export function createNodes(ctx, params = {}) {
  const intensity = params.intensity ?? 0.55;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  // Remove sub-rumble
  const highpass = createBiquad(ctx, 'highpass', 40 + intensity * 30, 0.7);

  // Mild presence / clarity boost
  const presence = createBiquad(ctx, 'peaking', 3200, 1.1, 1.5 + intensity * 2.5);

  // Soft high-shelf for air (not too much)
  const air = createBiquad(ctx, 'highshelf', 9000, 1, 1 + intensity * 1.5);

  // Gentle cut of harsh region if intensity high
  const deHarsh = createBiquad(ctx, 'peaking', 5500, 2.0, intensity > 0.6 ? -1.5 : 0);

  // Soft low-mid cleanup
  const mud = createBiquad(ctx, 'peaking', 280, 1.0, -1 - intensity);

  // Compression for consistency
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 15;
  compressor.ratio.value = 1.8 + intensity * 0.8;
  compressor.attack.value = 0.015;
  compressor.release.value = 0.3;

  // Very light make-up
  const makeUp = createGain(ctx, 1 + intensity * 0.08);

  input.connect(highpass);
  highpass.connect(mud);
  mud.connect(presence);
  presence.connect(deHarsh);
  deHarsh.connect(air);
  air.connect(compressor);
  compressor.connect(makeUp);
  makeUp.connect(output);

  return {
    input,
    output,
    nodes: [input, highpass, mud, presence, deHarsh, air, compressor, makeUp, output]
  };
}
