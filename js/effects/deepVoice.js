/**
 * Professional Male / Deep Voice – V3.0.1
 * Stronger pitch + formant for clearly audible male character
 */
import { createGain, createBiquad } from './baseEffect.js';
import { VOCAL_PRESETS } from '../audio-engine/PitchProcessor.js';

export const meta = {
  id: 'deepVoice',
  name: 'صدای مردانه',
  description: 'تغییر واضح به کاراکتر مردانه با pitch + formant (سرعت ثابت)',
  icon: 'deep',
  category: 'voice',
  defaultParams: { mode: 'male', intensity: 0.85 },
  requiresPitchProcess: true,
  pitchProcessKey: 'deepVoice',
  paramHints: {
    mode: 'Male عمیق طبیعی',
    intensity: 'شدت تغییر جنس صدا'
  },
  paramRanges: { intensity: [0, 1] }
};

export function getPitchConfig(params = {}) {
  const mode = params.mode || 'male';
  const intensity = Math.max(0, Math.min(1, params.intensity ?? 0.85));
  const preset = VOCAL_PRESETS[mode] || VOCAL_PRESETS.male;
  return {
    pitchRatio: 1 + (preset.pitchRatio - 1) * intensity,
    formantShift: (preset.formantShift || 0) * intensity,
    mode,
    intensity,
    eq: {
      highShelf: (preset.highShelf || 0) * intensity,
      presence: (preset.presence || 0) * intensity,
      lowCut: preset.lowCut || 70,
      body: (preset.body || 0) * intensity,
      air: (preset.air || 0) * intensity
    }
  };
}

export function createNodes(ctx, params = {}) {
  const cfg = getPitchConfig(params);
  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const highpass = createBiquad(ctx, 'highpass', cfg.eq.lowCut, 0.7);
  const body = createBiquad(ctx, 'peaking', 180, 0.85, Math.min(5, (cfg.eq.body || 2) * 1.1));
  const warmth = createBiquad(ctx, 'lowshelf', 120, 0.8, Math.min(4, 1.5 * (cfg.intensity || 0.85)));
  const presence = createBiquad(ctx, 'peaking', 2200, 1.0, cfg.eq.presence || -0.5);
  const air = createBiquad(ctx, 'highshelf', 7000, 0.7, cfg.eq.air || -0.8);
  // Reduce sparkle for male
  const darken = createBiquad(ctx, 'peaking', 5000, 1.0, -1.5 * (cfg.intensity || 0.85));

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 2.2;
  comp.attack.value = 0.012;
  comp.release.value = 0.2;

  const makeup = createGain(ctx, 1.05);

  input.connect(highpass);
  highpass.connect(warmth);
  warmth.connect(body);
  body.connect(presence);
  presence.connect(darken);
  darken.connect(air);
  air.connect(comp);
  comp.connect(makeup);
  makeup.connect(output);

  return {
    input, output,
    nodes: [input, highpass, warmth, body, presence, darken, air, comp, makeup, output],
    pitchFactor: 1,
    update(p) {
      const c = getPitchConfig(p);
      const t = ctx.currentTime;
      highpass.frequency.setTargetAtTime(c.eq.lowCut, t, 0.04);
      body.gain.setTargetAtTime(Math.min(5, (c.eq.body || 2) * 1.1), t, 0.04);
      warmth.gain.setTargetAtTime(Math.min(4, 1.5 * (c.intensity || 0.85)), t, 0.04);
      presence.gain.setTargetAtTime(c.eq.presence || -0.5, t, 0.04);
      air.gain.setTargetAtTime(c.eq.air || -0.8, t, 0.04);
      darken.gain.setTargetAtTime(-1.5 * (c.intensity || 0.85), t, 0.04);
    }
  };
}

export async function processOfflineBuffer(audioBuffer, params = {}, onProgress) {
  const { processPitchPreserveDuration } = await import('../audio-engine/PitchProcessor.js');
  const cfg = getPitchConfig(params);
  if (onProgress) onProgress(0.15);
  const pitched = await processPitchPreserveDuration(audioBuffer, cfg.pitchRatio, cfg.formantShift, onProgress);
  if (onProgress) onProgress(1);
  return pitched;
}
