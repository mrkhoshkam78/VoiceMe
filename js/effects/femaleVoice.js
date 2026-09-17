/**
 * Female / Girl / Woman Voice – Independent Pitch + Formant (duration preserved)
 * Uses PitchProcessor for real pitch shift without speed change.
 */
import { createGain, createBiquad } from './baseEffect.js';
import { VOCAL_PRESETS } from '../audio-engine/PitchProcessor.js';

export const meta = {
  id: 'femaleVoice',
  name: 'صدای زنانه',
  description: 'تغییر Pitch و Formant مستقل از سرعت – Girl / Female / Woman',
  icon: 'female',
  category: 'voice',
  defaultParams: { mode: 'female', intensity: 0.75 },
  // Flags for engine: this effect requires buffer-level pitch processing
  requiresPitchProcess: true,
  pitchProcessKey: 'femaleVoice'
};

export function getPitchConfig(params = {}) {
  const mode = params.mode || 'female';
  const intensity = Math.max(0, Math.min(1, params.intensity ?? 0.75));
  const preset = VOCAL_PRESETS[mode] || VOCAL_PRESETS.female;

  // Intensity scales the deviation from 1.0
  const pitchRatio = 1 + (preset.pitchRatio - 1) * intensity;
  const formantShift = preset.formantShift * intensity;

  return {
    pitchRatio,
    formantShift,
    mode,
    intensity,
    eq: {
      highShelf: preset.highShelf * intensity,
      presence: preset.presence * intensity,
      lowCut: preset.lowCut
    }
  };
}

/**
 * Real-time nodes: only the character EQ (pitch already applied on buffer)
 */
export function createNodes(ctx, params = {}) {
  const cfg = getPitchConfig(params);
  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const highpass = createBiquad(ctx, 'highpass', cfg.eq.lowCut || 100, 0.7);
  const peak = createBiquad(ctx, 'peaking', 2200, 1.3, cfg.eq.presence || 3);
  const highShelf = createBiquad(ctx, 'highshelf', 3200, 1, cfg.eq.highShelf || 3);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 8;
  comp.ratio.value = 2.5;
  comp.attack.value = 0.01;
  comp.release.value = 0.15;

  input.connect(highpass);
  highpass.connect(peak);
  peak.connect(highShelf);
  highShelf.connect(comp);
  comp.connect(output);

  return {
    input, output,
    nodes: [input, highpass, peak, highShelf, comp, output],
    // No pitchFactor – duration is preserved by buffer processing
    pitchFactor: 1,
    update(p) {
      const c = getPitchConfig(p);
      highpass.frequency.setTargetAtTime(c.eq.lowCut || 100, ctx.currentTime, 0.04);
      peak.gain.setTargetAtTime(c.eq.presence || 3, ctx.currentTime, 0.04);
      highShelf.gain.setTargetAtTime(c.eq.highShelf || 3, ctx.currentTime, 0.04);
    }
  };
}

/** Offline buffer processing for Export & processed preview buffer */
export async function processOfflineBuffer(audioBuffer, params = {}, onProgress) {
  const { processPitchPreserveDuration } = await import('../audio-engine/PitchProcessor.js');
  const cfg = getPitchConfig(params);
  if (onProgress) onProgress(0.3);
  const pitched = processPitchPreserveDuration(audioBuffer, cfg.pitchRatio, cfg.formantShift);
  if (onProgress) onProgress(0.9);
  return pitched;
}
