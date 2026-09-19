/**
 * Male / Deep Voice – V2.5.2 Pro
 * Independent Pitch + Formant (duration preserved). Natural male body.
 */
import { createGain, createBiquad } from './baseEffect.js';
import { VOCAL_PRESETS } from '../audio-engine/PitchProcessor.js';

export const meta = {
  id: 'deepVoice',
  name: 'صدای مردانه',
  description: 'صدای مردانه‌تر و پرتر؛ بدون تغییر سرعت یا مدت فایل',
  icon: 'deep',
  category: 'voice',
  defaultParams: { intensity: 0.7 },
  requiresPitchProcess: true,
  pitchProcessKey: 'deepVoice'
};

export function getPitchConfig(params = {}) {
  const intensity = Math.max(0, Math.min(1, params.intensity ?? 0.7));
  const preset = VOCAL_PRESETS.male;

  const pitchRatio = 1 + (preset.pitchRatio - 1) * intensity;
  const formantShift = preset.formantShift * intensity;

  return {
    pitchRatio,
    formantShift,
    intensity,
    eq: {
      lowShelf: (preset.lowShelf || 3) * intensity,
      presence: (preset.presence || 1) * intensity,
      highShelf: (preset.highShelf || -0.8) * intensity,
      lowCut: preset.lowCut || 50,
      body: (preset.body || 2) * intensity
    }
  };
}

export function createNodes(ctx, params = {}) {
  const cfg = getPitchConfig(params);
  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const highpass = createBiquad(ctx, 'highpass', cfg.eq.lowCut || 50, 0.7);
  const lowShelf = createBiquad(ctx, 'lowshelf', 160, 0.9, Math.min(4, cfg.eq.lowShelf || 2.5));
  // Chest / body – not muddy
  const mid = createBiquad(ctx, 'peaking', 380, 0.95, 1.0 + cfg.intensity * 1.5);
  const highShelf = createBiquad(ctx, 'highshelf', 6500, 0.9, cfg.eq.highShelf || -0.8);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -17;
  comp.knee.value = 12;
  comp.ratio.value = 2.0;
  comp.attack.value = 0.014;
  comp.release.value = 0.22;

  const makeUp = createGain(ctx, 1 + cfg.intensity * 0.08);

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
      const t = ctx.currentTime;
      lowShelf.gain.setTargetAtTime(Math.min(4, c.eq.lowShelf || 2.5), t, 0.04);
      mid.gain.setTargetAtTime(1.0 + c.intensity * 1.5, t, 0.04);
      highShelf.gain.setTargetAtTime(c.eq.highShelf || -0.8, t, 0.04);
      makeUp.gain.setTargetAtTime(1 + c.intensity * 0.08, t, 0.04);
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
