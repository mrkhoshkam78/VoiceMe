/**
 * Professional Female / Girl / Woman – V2.5.2 Pro
 * Pitch + Formant independent of speed. Natural, not chipmunk.
 */
import { createGain, createBiquad } from './baseEffect.js';
import { VOCAL_PRESETS } from '../audio-engine/PitchProcessor.js';

export const meta = {
  id: 'femaleVoice',
  name: 'صدای زنانه',
  description: 'Natural female character via pitch + formant + timbre — speed unchanged',
  icon: 'female',
  category: 'voice',
  defaultParams: { mode: 'female', intensity: 0.75 },
  requiresPitchProcess: true,
  pitchProcessKey: 'femaleVoice',
  paramHints: {
    mode: 'Girl روشن‌تر · Female متعادل · Woman بالغ‌تر',
    intensity: 'شدت تغییر جنس صدا'
  }
};

export function getPitchConfig(params = {}) {
  const mode = params.mode || 'female';
  const intensity = Math.max(0, Math.min(1, params.intensity ?? 0.75));
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
 * Chain: HPF → Body → Presence → Air → soft Comp → Output
 */
export function createNodes(ctx, params = {}) {
  const cfg = getPitchConfig(params);
  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const highpass = createBiquad(ctx, 'highpass', cfg.eq.lowCut, 0.7);
  const body = createBiquad(ctx, 'peaking', 260, 0.85, cfg.eq.body || 0);
  const presence = createBiquad(ctx, 'peaking', 2500, 1.15, Math.min(3.5, cfg.eq.presence || 2.0));
  const air = createBiquad(ctx, 'highshelf', 7500, 0.7, Math.min(2.2, cfg.eq.air || 1.2));
  // Single high-shelf path – avoid double-bright stacking
  const highShelf = createBiquad(ctx, 'highshelf', 4000, 0.9, Math.min(2.0, (cfg.eq.highShelf || 1.5) * 0.55));

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 1.6;
  comp.attack.value = 0.012;
  comp.release.value = 0.2;

  const makeup = createGain(ctx, 1.02);

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
      const t = ctx.currentTime;
      highpass.frequency.setTargetAtTime(c.eq.lowCut, t, 0.05);
      body.gain.setTargetAtTime(c.eq.body || 0, t, 0.05);
      presence.gain.setTargetAtTime(Math.min(3.5, c.eq.presence || 2.0), t, 0.05);
      air.gain.setTargetAtTime(Math.min(2.2, c.eq.air || 1.2), t, 0.05);
      highShelf.gain.setTargetAtTime(Math.min(2.0, (c.eq.highShelf || 1.5) * 0.55), t, 0.05);
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
