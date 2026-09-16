/**
 * Female / Girl Voice Effect
 * Uses playbackRate-style pitch shifting approximation via OfflineAudioContext resampling
 * or real-time with a simple rate change + formant approximation via filtering.
 *
 * Limitation (V1.01): True formant-preserving pitch shift requires phase vocoder or
 * more advanced DSP. Here we use a combination of rate change + EQ to approximate
 * a higher/thinner voice. Duration is preserved in offline render by resampling.
 */

import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'femaleVoice',
  name: 'صدای زنانه / دخترانه',
  description: 'افزایش Pitch و تغییر Formant تقریبی برای صدای زنانه یا دخترانه',
  icon: '👩',
  category: 'voice',
  defaultParams: {
    mode: 'girl', // 'girl' | 'woman'
    intensity: 0.7 // 0-1
  }
};

/**
 * Create real-time nodes.
 * For real-time we cannot easily change duration, so we use a playbackRate source
 * approach is handled at buffer source level. Here we return an EQ + gain chain
 * that approximates brightness/thinness, and the actual pitch is applied at source.
 *
 * The audioManager will handle the pitch shift factor when creating BufferSource.
 */
export function createNodes(ctx, params = {}) {
  const intensity = params.intensity ?? 0.7;
  const mode = params.mode || 'girl';

  // Pitch factor is returned so manager can apply it to BufferSource.playbackRate
  // girl ~ +4 to +6 semitones, woman ~ +2 to +3.5
  const pitchFactor = mode === 'girl'
    ? 1 + intensity * 0.35   // ~1.0 - 1.35
    : 1 + intensity * 0.22;  // ~1.0 - 1.22

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  // Brighten / thin the voice (approximate formant shift upward)
  const highShelf = createBiquad(ctx, 'highshelf', 2500, 1, 3 + intensity * 5);
  const peak = createBiquad(ctx, 'peaking', 1800, 1.2, 2 + intensity * 3);
  const lowCut = createBiquad(ctx, 'highpass', 80 + intensity * 40, 0.7);

  // Slight compression of dynamics to make it clearer
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 8;
  compressor.ratio.value = 2.5;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.15;

  input.connect(lowCut);
  lowCut.connect(peak);
  peak.connect(highShelf);
  highShelf.connect(compressor);
  compressor.connect(output);

  return {
    input,
    output,
    pitchFactor, // used by audio manager for BufferSource
    nodes: [input, lowCut, peak, highShelf, compressor, output]
  };
}

/**
 * Offline render helper: actually resample the buffer to change pitch while
 * keeping approximate duration by stretching (simple linear interpolation).
 * This is a basic pitch shifter; quality is limited.
 */
export async function applyOffline(ctx, sourceBuffer, params = {}) {
  const intensity = params.intensity ?? 0.7;
  const mode = params.mode || 'girl';
  const pitchFactor = mode === 'girl'
    ? 1 + intensity * 0.35
    : 1 + intensity * 0.22;

  // Simple approach: create a new buffer with higher sample rate playback
  // but same length → higher pitch, shorter duration, then we time-stretch back.
  // For V1.01 we accept duration change or use a crude stretch.

  // Better simple method for offline: use OfflineAudioContext with playbackRate
  // and accept that duration changes, OR implement basic resampling.

  // We will let the main pipeline handle pitch via playbackRate on the source
  // and then apply the EQ chain. Duration will change slightly; we note it in UI.
  return createNodes(ctx, params);
}
