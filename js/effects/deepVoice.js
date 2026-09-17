/**
 * Male / Deep Voice – Independent Pitch + Formant (duration preserved)
 * Natural male body, not cartoon "deep".
 */
import { createGain, createBiquad } from './baseEffect.js';
import { VOCAL_PRESETS } from '../audio-engine/PitchProcessor.js';

export const meta = {
  id: 'deepVoice',
  name: 'صدای مردانه',
  description: 'صدای مردانه‌تر و پرتر؛ بدون تغییر سرعت یا مدت فایل',
  icon: 'deep',
  category: 'voice',
  defaultParams: { intensity: 0.75 },
  requiresPitchProcess: true,
  pitchProcessKey: 'deepVoice'
};

export function getPitchConfig(params = {}) {
  const intensity = Math.max(0, Math.min(1, params.intensity ?? 0.75));
  const preset = VOCAL_PRESETS.male;

  const pitchRatio = 1 + (preset.pitchRatio - 1) * intensity;
  const formantShift = preset.formantShift * intensity;

  return {
    pitchRatio,
    formantShift,
    intensity,
    eq: {
      lowShelf: (preset.lowShelf || 4) * intensity,
      presence: preset.presence * intensity,
      highShelf: (preset.highShelf || -1.5) * intensity,
      lowCut: preset.lowCut
    }
  };
}

export function createNodes(ctx, params = {}) {
  const cfg = getPitchConfig(params);
  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const lowShelf = createBiquad(ctx, 'lowshelf', 180, 1, cfg.eq.lowShelf || 3);
  const mid = createBiquad(ctx, 'peaking', 420, 1.0, 1.5 + cfg.intensity * 2);
  const highpass = createBiquad(ctx, 'highpass', cfg.eq.lowCut || 60, 0.7);
  const highShelf = createBiquad(ctx, 'highshelf', 6000, 1, cfg.eq.highShelf || -1);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 10;
  comp.ratio.value = 2.2;
  comp.attack.value = 0.015;
  comp.release.value = 0.2;

  const makeUp = createGain(ctx, 1 + cfg.intensity * 0.12);

  input.connect(highpass);
  highpass.connect(lowShelf);
  lowShelf.connect(mid);
  mid.connect(highShelf);
  highShelf.connect(comp);
  comp.connect(makeUp);
  makeUp.connect(output);

  return {
    input, output,
    nodes: [input, highpass, lowShelf, mid, highShelf, comp, makeUp, output],
    pitchFactor: 1,
    update(p) {
      const c = getPitchConfig(p);
      lowShelf.gain.setTargetAtTime(c.eq.lowShelf || 3, ctx.currentTime, 0.04);
      mid.gain.setTargetAtTime(1.5 + c.intensity * 2, ctx.currentTime, 0.04);
      highShelf.gain.setTargetAtTime(c.eq.highShelf || -1, ctx.currentTime, 0.04);
      makeUp.gain.setTargetAtTime(1 + c.intensity * 0.12, ctx.currentTime, 0.04);
    }
  };
}

export async function processOfflineBuffer(audioBuffer, params = {}, onProgress) {
  const { processPitchPreserveDuration } = await import('../audio-engine/PitchProcessor.js');
  const cfg = getPitchConfig(params);
  if (onProgress) onProgress(0.3);
  const pitched = await processPitchPreserveDuration(audioBuffer, cfg.pitchRatio, cfg.formantShift, onProgress);
  if (onProgress) onProgress(0.9);
  return pitched;
}
