/**
 * Female / Girl Voice – audible pitch + formant approximation
 */
import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'femaleVoice',
  name: 'صدای زنانه',
  description: 'افزایش Pitch و روشن‌سازی برای صدای زنانه/دخترانه',
  icon: 'female',
  category: 'voice',
  defaultParams: { mode: 'girl', intensity: 0.75 }
};

export function createNodes(ctx, params = {}) {
  const intensity = params.intensity ?? 0.75;
  const mode = params.mode || 'girl';

  // Stronger, clearly audible pitch shift
  const pitchFactor = mode === 'girl'
    ? 1 + intensity * 0.42   // up to ~1.42 (+~5.5 semitones)
    : 1 + intensity * 0.28;  // up to ~1.28 (+~4 semitones)

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const highpass = createBiquad(ctx, 'highpass', 90 + intensity * 50, 0.7);
  const peak = createBiquad(ctx, 'peaking', 2000, 1.4, 4 + intensity * 5);
  const highShelf = createBiquad(ctx, 'highshelf', 2800, 1, 4 + intensity * 6);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 6;
  comp.ratio.value = 2.8;
  comp.attack.value = 0.008;
  comp.release.value = 0.12;

  input.connect(highpass);
  highpass.connect(peak);
  peak.connect(highShelf);
  highShelf.connect(comp);
  comp.connect(output);

  return {
    input, output, pitchFactor,
    nodes: [input, highpass, peak, highShelf, comp, output]
  };
}
