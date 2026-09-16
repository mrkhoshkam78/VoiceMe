/**
 * Studio Reverb + light EQ + Compression
 * Uses synthetic impulse response for a controlled room reverb.
 * Conservative settings to keep natural character.
 */

import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'studio',
  name: 'استودیو / ریورب',
  description: 'ریورب کنترل‌شده + EQ و Compression برای صدای استودیویی طبیعی',
  icon: '🎙️',
  category: 'environment',
  defaultParams: {
    roomSize: 0.45,   // 0-1
    wet: 0.28,        // mix
    intensity: 0.6
  }
};

/**
 * Generate a simple synthetic impulse response for room reverb
 */
function createImpulseResponse(ctx, duration = 1.8, decay = 2.2) {
  const sampleRate = ctx.sampleRate;
  const length = sampleRate * duration;
  const impulse = ctx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const channel = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      // Exponential decay + some early reflections simulation
      const t = i / sampleRate;
      const envelope = Math.exp(-decay * t);
      // Sparse noise for more natural decay
      const noise = (Math.random() * 2 - 1);
      // Add a few early reflection peaks
      let early = 0;
      if (i < sampleRate * 0.08) {
        early = Math.exp(-30 * t) * (Math.random() * 0.6);
      }
      channel[i] = (noise * 0.5 + early) * envelope;
    }
  }
  return impulse;
}

export function createNodes(ctx, params = {}) {
  const roomSize = params.roomSize ?? 0.45;
  const wetAmount = params.wet ?? 0.28;
  const intensity = params.intensity ?? 0.6;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);
  const dry = createGain(ctx, 1 - wetAmount);
  const wet = createGain(ctx, wetAmount * intensity);

  // Light EQ before reverb (studio polish)
  const highpass = createBiquad(ctx, 'highpass', 60, 0.7);
  const presence = createBiquad(ctx, 'peaking', 3500, 1.0, 1.5 + intensity);
  const air = createBiquad(ctx, 'highshelf', 8000, 1, 1.5);

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -22;
  compressor.knee.value = 12;
  compressor.ratio.value = 2.2;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.25;

  // Convolver for reverb
  const convolver = ctx.createConvolver();
  const duration = 0.8 + roomSize * 1.6;
  const decay = 1.8 + roomSize * 1.5;
  convolver.buffer = createImpulseResponse(ctx, duration, decay);

  // Filter the wet signal a bit
  const wetFilter = createBiquad(ctx, 'lowpass', 7000 - roomSize * 2000, 0.7);

  input.connect(highpass);
  highpass.connect(presence);
  presence.connect(air);
  air.connect(compressor);

  compressor.connect(dry);
  dry.connect(output);

  compressor.connect(convolver);
  convolver.connect(wetFilter);
  wetFilter.connect(wet);
  wet.connect(output);

  return {
    input,
    output,
    nodes: [input, highpass, presence, air, compressor, dry, convolver, wetFilter, wet, output],
    update(params) {
      // Limited live update; room size requires new IR so we skip heavy changes
      if (params.wet !== undefined) {
        dry.gain.setTargetAtTime(1 - params.wet, ctx.currentTime, 0.05);
        wet.gain.setTargetAtTime(params.wet * (params.intensity ?? intensity), ctx.currentTime, 0.05);
      }
    }
  };
}
