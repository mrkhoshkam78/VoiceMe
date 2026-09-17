/**
 * Professional Female / Girl / Woman – Pitch + Formant independent of speed
 */
import { createGain, createBiquad } from './baseEffect.js';
import { VOCAL_PRESETS } from '../audio-engine/PitchProcessor.js';

export const meta = {
  id: 'femaleVoice',
  name: 'صدای زنانه',
  description: 'Natural female character via pitch + formant + timbre — speed unchanged',
  icon: 'female',
  category: 'voice',
  defaultParams: { mode: 'female', intensity: 0.8 },
  requiresPitchProcess: true,
  pitchProcessKey: 'femaleVoice',
  paramHints: {
    mode: 'Girl روشن‌تر · Female متعادل · Woman بالغ‌تر',
    intensity: 'شدت تغییر جنس صدا'
  }
};

export function getPitchConfig(params = {}) {
  const mode = params.mode || 'female';
  const intensity = Math.max(0, Math.min(1, params.intensity ?? 0.8));
  const preset = VOCAL_PRESETS[mode] || VOCAL_PRESETS.female;

  const pitchRatio = 1 + (preset.pitchRatio - 1) * intensity;
  const formantShift = (preset.formantShift || 0) * intensity;

  return {
    pitchRatio,
    formantShift,
    mode,
    intensity,
    eq: {
      highShelf: (preset.highShelf || 0) * intensity,
      presence: (preset.presence || 0) * intensity,
      lowCut: preset.lowCut || 90,
      body: (preset.body || 0) * intensity,
      air: (preset.air || 0) * intensity
    }
  };
}

/**
 * Real-time character EQ after offline pitch buffer
 * Chain: HPF → Body → Presence → Air → Comp → Output
 */
export function createNodes(ctx, params = {}) {
  const cfg = getPitchConfig(params);
  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const highpass = createBiquad(ctx, 'highpass', cfg.eq.lowCut, 0.7);
  const body = createBiquad(ctx, 'peaking', 280, 0.9, cfg.eq.body || 0);
  const presence = createBiquad(ctx, 'peaking', 2400, 1.2, cfg.eq.presence || 2.5);
  const air = createBiquad(ctx, 'highshelf', 6000, 0.7, cfg.eq.air || 1.5);
  const highShelf = createBiquad(ctx, 'highshelf', 3500, 1, Math.min(3, (cfg.eq.highShelf || 2) * 0.7));

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 10;
  comp.ratio.value = 1.8;
  comp.attack.value = 0.012;
  comp.release.value = 0.18;

  const makeup = createGain(ctx, 1.05);

  input.connect(highpass);
  highpass.connect(body);
  body.connect(presence);
  presence.connect(highShelf);
  highShelf.connect(air);
  air.connect(comp);
  comp.connect(makeup);
  makeup.connect(output);

  return {
    input, output,
    nodes: [input, highpass, body, presence, highShelf, air, comp, makeup, output],
    pitchFactor: 1,
    update(p) {
      const c = getPitchConfig(p);
      highpass.frequency.setTargetAtTime(c.eq.lowCut, ctx.currentTime, 0.05);
      body.gain.setTargetAtTime(c.eq.body || 0, ctx.currentTime, 0.05);
      presence.gain.setTargetAtTime(c.eq.presence || 2.5, ctx.currentTime, 0.05);
      air.gain.setTargetAtTime(c.eq.air || 1.5, ctx.currentTime, 0.05);
      highShelf.gain.setTargetAtTime(Math.min(3, (c.eq.highShelf || 2) * 0.7), ctx.currentTime, 0.05);
    }
  };
}

export async function processOfflineBuffer(audioBuffer, params = {}, onProgress) {
  const { processPitchPreserveDuration } = await import('../audio-engine/PitchProcessor.js');
  const cfg = getPitchConfig(params);
  if (onProgress) onProgress(0.2);
  const pitched = await processPitchPreserveDuration(
    audioBuffer,
    cfg.pitchRatio,
    cfg.formantShift,
    onProgress
  );
  if (onProgress) onProgress(1);
  return pitched;
}
