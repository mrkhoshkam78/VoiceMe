/**
 * Professional Female Voice – V3.0.1
 * Stronger pitch + formant so the change is clearly audible in realtime path (EQ)
 * and offline pitch path. Modes: girl / female / woman.
 */
import { createGain, createBiquad } from './baseEffect.js';
import { VOCAL_PRESETS } from '../audio-engine/PitchProcessor.js';

export const meta = {
  id: 'femaleVoice',
  name: 'صدای زنانه',
  description: 'تغییر واضح به کاراکتر زنانه با pitch + formant (سرعت ثابت)',
  icon: 'female',
  category: 'voice',
  defaultParams: { mode: 'female', intensity: 0.85 },
  requiresPitchProcess: true,
  pitchProcessKey: 'femaleVoice',
  paramHints: {
    mode: 'Girl روشن‌تر · Female متعادل · Woman بالغ‌تر',
    intensity: 'شدت تغییر جنس صدا'
  },
  paramRanges: {
    intensity: [0, 1]
  }
};

export function getPitchConfig(params = {}) {
  const mode = params.mode || 'female';
  const intensity = Math.max(0, Math.min(1, params.intensity ?? 0.85));
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
      lowCut: preset.lowCut || 95,
      body: (preset.body || 0) * intensity,
      air: (preset.air || 0) * intensity
    }
  };
}

/**
 * Realtime character chain — strong enough to hear even before offline pitch finishes
 */
export function createNodes(ctx, params = {}) {
  const cfg = getPitchConfig(params);
  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  const highpass = createBiquad(ctx, 'highpass', cfg.eq.lowCut, 0.75);
  // Body: reduce chest for feminine
  const body = createBiquad(ctx, 'peaking', 220, 0.9, cfg.eq.body ?? -0.8);
  // Strong presence (female vocal formant region)
  const presence = createBiquad(ctx, 'peaking', 2800, 1.1, Math.min(6, (cfg.eq.presence || 3) * 1.15));
  // Upper presence / brightness
  const midBright = createBiquad(ctx, 'peaking', 4500, 1.0, Math.min(4, (cfg.eq.highShelf || 2) * 0.7));
  const air = createBiquad(ctx, 'highshelf', 8000, 0.7, Math.min(4, cfg.eq.air || 1.8));
  // Mild low-mid scoop for thinner feminine body
  const scoop = createBiquad(ctx, 'peaking', 450, 0.85, -1.2 * (cfg.intensity || 0.85));

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 2.0;
  comp.attack.value = 0.008;
  comp.release.value = 0.15;

  const makeup = createGain(ctx, 1.08);

  input.connect(highpass);
  highpass.connect(body);
  body.connect(scoop);
  scoop.connect(presence);
  presence.connect(midBright);
  midBright.connect(air);
  air.connect(comp);
  comp.connect(makeup);
  makeup.connect(output);

  return {
    input, output,
    nodes: [input, highpass, body, scoop, presence, midBright, air, comp, makeup, output],
    pitchFactor: 1,
    update(p) {
      const c = getPitchConfig(p);
      const t = ctx.currentTime;
      highpass.frequency.setTargetAtTime(c.eq.lowCut, t, 0.04);
      body.gain.setTargetAtTime(c.eq.body || 0, t, 0.04);
      scoop.gain.setTargetAtTime(-1.2 * (c.intensity || 0.85), t, 0.04);
      presence.gain.setTargetAtTime(Math.min(6, (c.eq.presence || 3) * 1.15), t, 0.04);
      midBright.gain.setTargetAtTime(Math.min(4, (c.eq.highShelf || 2) * 0.7), t, 0.04);
      air.gain.setTargetAtTime(Math.min(4, c.eq.air || 1.8), t, 0.04);
    }
  };
}

export async function processOfflineBuffer(audioBuffer, params = {}, onProgress) {
  const { processPitchPreserveDuration } = await import('../audio-engine/PitchProcessor.js');
  const cfg = getPitchConfig(params);
  if (onProgress) onProgress(0.15);
  const pitched = await processPitchPreserveDuration(
    audioBuffer,
    cfg.pitchRatio,
    cfg.formantShift,
    onProgress
  );
  if (onProgress) onProgress(1);
  return pitched;
}
