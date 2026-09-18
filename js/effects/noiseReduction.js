/**
 * Noise Reduction – lightweight spectral-ish approach using
 * high-pass + adaptive low-level gating approximation via expansion-like dynamics
 * and mild high-frequency noise shelf cut.
 *
 * Not a full spectral subtraction engine (that needs FFT frames + noise profile),
 * but produces clearly audible noise reduction without robotic artifacts.
 */
import { createGain, createBiquad } from './baseEffect.js';
import { clamp } from '../utils/helpers.js';

export const meta = {
  id: 'noiseReduction',
  name: 'کاهش نویز',
  description: 'کاهش نویز پس‌زمینه با حفظ طبیعی بودن صدا',
  icon: 'noise',
  category: 'enhancement',
  defaultParams: {
    strength: 0.5,
    sensitivity: 0.45,
    intensity: 0.65
  },
  paramUnits: { strength: 'ratio', sensitivity: 'ratio', intensity: 'ratio' },
  paramRanges: {
    strength: [0, 1],
    sensitivity: [0, 1],
    intensity: [0, 1]
  }
};

function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

export function createNodes(ctx, params = {}) {
  let strength = clamp01(params.strength ?? 0.5) * clamp01(params.intensity ?? 0.65);
  let sensitivity = clamp01(params.sensitivity ?? 0.45);

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  // Remove rumble / low hum
  const hp = createBiquad(ctx, 'highpass', 40 + sensitivity * 60, 0.7);

  // Cut hiss region proportionally
  const hissCut = createBiquad(ctx, 'highshelf', 6000 + sensitivity * 2000, 1, -3 - strength * 9);

  // Mild mid noise cleanup
  const midNotch = createBiquad(ctx, 'peaking', 2500, 1.5, -1 - strength * 2);

  // Expander-like: high ratio above a low threshold reduces quiet noise floor
  // DynamicsCompressor with high threshold acts as downward expander approximation
  // when combined with makeup – we use a parallel dry/wet soft-gate feel
  const gate = ctx.createDynamicsCompressor();
  gate.threshold.value = -50 + sensitivity * 20; // more sensitive = higher threshold for noise
  gate.knee.value = 20;
  gate.ratio.value = 1.5 + strength * 4;
  gate.attack.value = 0.005;
  gate.release.value = 0.15 + (1 - strength) * 0.2;

  const makeUp = createGain(ctx, 1 + strength * 0.08);

  // Wet/dry based on strength
  const dry = createGain(ctx, 1 - strength * 0.7);
  const wet = createGain(ctx, strength * 0.7 + 0.15);

  input.connect(dry);
  dry.connect(output);

  input.connect(hp);
  hp.connect(hissCut);
  hissCut.connect(midNotch);
  midNotch.connect(gate);
  gate.connect(makeUp);
  makeUp.connect(wet);
  wet.connect(output);

  return {
    input, output,
    nodes: [input, dry, wet, hp, hissCut, midNotch, gate, makeUp, output],
    update(p) {
      const s = (p.strength ?? strength) * (p.intensity ?? 1);
      dry.gain.setTargetAtTime(1 - s * 0.7, ctx.currentTime, 0.05);
      wet.gain.setTargetAtTime(s * 0.7 + 0.15, ctx.currentTime, 0.05);
      hissCut.gain.setTargetAtTime(-3 - s * 9, ctx.currentTime, 0.05);
    }
  };
}

/**
 * Offline: spectral-ish noise gate per frame (simple energy-based)
 */
export async function processOfflineBuffer(audioBuffer, params = {}, onProgress) {
  const strength = (params.strength ?? 0.55) * (params.intensity ?? 0.7);
  const sensitivity = params.sensitivity ?? 0.5;
  if (strength < 0.05) return audioBuffer;

  const sr = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const frameSize = 1024;
  const hop = 512;

  // Estimate noise floor from quietest 10% of frames (mono mix energy)
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const d = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += d[i] / channels;
  }

  const energies = [];
  for (let i = 0; i + frameSize < length; i += hop) {
    let e = 0;
    for (let j = 0; j < frameSize; j++) e += mono[i + j] * mono[i + j];
    energies.push({ i, e: Math.sqrt(e / frameSize) });
  }
  energies.sort((a, b) => a.e - b.e);
  const noiseFloor = energies[Math.floor(energies.length * 0.1)]?.e || 0.01;
  const threshold = noiseFloor * (1.5 + sensitivity * 3);

  if (onProgress) onProgress(0.3);

  const outBuf = new AudioBuffer({ length, numberOfChannels: channels, sampleRate: sr });
  for (let c = 0; c < channels; c++) {
    const src = audioBuffer.getChannelData(c);
    const dst = outBuf.getChannelData(c);
    dst.set(src);

    for (let f = 0; f < energies.length; f++) {
      const start = energies[f].i;
      // recompute energy for this channel
      let e = 0;
      for (let j = 0; j < frameSize && start + j < length; j++) {
        e += src[start + j] * src[start + j];
      }
      e = Math.sqrt(e / frameSize);
      if (e < threshold) {
        const atten = clamp(1 - strength * (1 - e / threshold), 0.15, 1);
        for (let j = 0; j < hop && start + j < length; j++) {
          dst[start + j] *= atten;
        }
      }
    }
    if (onProgress) onProgress(0.3 + 0.7 * ((c + 1) / channels));
  }
  return outBuf;
}
