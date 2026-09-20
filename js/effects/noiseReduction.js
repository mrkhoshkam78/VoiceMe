/**
 * Noise Reduction – V2.5.2 Pro
 * Live: HPF + hiss shelf + mild mid cleanup + soft dynamics
 * Offline: energy-based noise floor estimate + smooth attenuation
 * Conservative to avoid underwater / robotic artifacts.
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
    intensityMode: 'medium',
    strength: 0.6,
    sensitivity: 0.5,
    intensity: 0.75
  },
  intensityPresets: {
    low: { strength: 0.35, sensitivity: 0.35, intensity: 0.45 },
    medium: { strength: 0.6, sensitivity: 0.5, intensity: 0.75 },
    strong: { strength: 0.85, sensitivity: 0.7, intensity: 0.95 }
  },
  paramUnits: { strength: 'ratio', sensitivity: 'ratio', intensity: 'ratio' },
  paramRanges: {
    strength: [0, 1],
    sensitivity: [0, 1],
    intensity: [0, 1]
  }
};

function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

const NR_PRESETS = {
  low: { strength: 0.35, sensitivity: 0.35, intensity: 0.45 },
  medium: { strength: 0.6, sensitivity: 0.5, intensity: 0.75 },
  strong: { strength: 0.85, sensitivity: 0.7, intensity: 0.95 }
};

export function createNodes(ctx, params = {}) {
  const pr = NR_PRESETS[params.intensityMode] || null;
  let strength = clamp01(params.strength ?? pr?.strength ?? 0.6) * clamp01(params.intensity ?? pr?.intensity ?? 0.75);
  let sensitivity = clamp01(params.sensitivity ?? pr?.sensitivity ?? 0.5);

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  // Remove rumble / low hum
  const hp = createBiquad(ctx, 'highpass', 35 + sensitivity * 45, 0.7);

  // Cut hiss region proportionally – milder than before
  const hissCut = createBiquad(ctx, 'highshelf', 7000 + sensitivity * 1500, 0.9, -2 - strength * 6);

  // Mild mid noise cleanup (not a deep notch)
  const midNotch = createBiquad(ctx, 'peaking', 2400, 1.2, -0.6 - strength * 1.4);

  const gate = ctx.createDynamicsCompressor();
  gate.threshold.value = -48 + sensitivity * 16;
  gate.knee.value = 24;
  gate.ratio.value = 1.3 + strength * 2.5;
  gate.attack.value = 0.008;
  gate.release.value = 0.18 + (1 - strength) * 0.15;

  const makeUp = createGain(ctx, 1 + strength * 0.05);

  const dry = createGain(ctx, 1 - strength * 0.55);
  const wet = createGain(ctx, strength * 0.55 + 0.2);

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
      const s = clamp01(p.strength ?? 0.45) * clamp01(p.intensity ?? 0.6);
      const sens = clamp01(p.sensitivity ?? sensitivity);
      strength = s;
      sensitivity = sens;
      const t = ctx.currentTime;
      dry.gain.setTargetAtTime(1 - s * 0.55, t, 0.05);
      wet.gain.setTargetAtTime(s * 0.55 + 0.2, t, 0.05);
      hissCut.gain.setTargetAtTime(-2 - s * 6, t, 0.05);
      hissCut.frequency.setTargetAtTime(7000 + sens * 1500, t, 0.05);
      midNotch.gain.setTargetAtTime(-0.6 - s * 1.4, t, 0.05);
      hp.frequency.setTargetAtTime(35 + sens * 45, t, 0.05);
      gate.threshold.setTargetAtTime(-48 + sens * 16, t, 0.05);
      gate.ratio.setTargetAtTime(1.3 + s * 2.5, t, 0.05);
      makeUp.gain.setTargetAtTime(1 + s * 0.05, t, 0.05);
    }
  };
}

/**
 * Offline: energy-based noise reduction with smooth fades (less choppy)
 */
export async function processOfflineBuffer(audioBuffer, params = {}, onProgress) {
  const strength = clamp01(params.strength ?? 0.55) * clamp01(params.intensity ?? 0.7);
  const sensitivity = clamp01(params.sensitivity ?? 0.45);
  if (strength < 0.04) return audioBuffer;

  const sr = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const frameSize = 1024;
  const hop = 512;

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
  const noiseFloor = energies[Math.floor(energies.length * 0.08)]?.e || 0.008;
  const threshold = noiseFloor * (1.8 + sensitivity * 2.5);

  if (onProgress) onProgress(0.25);

  // Rebuild energy order by position for smooth application
  const byPos = [...energies].sort((a, b) => a.i - b.i);
  const outBuf = new AudioBuffer({ length, numberOfChannels: channels, sampleRate: sr });

  for (let c = 0; c < channels; c++) {
    const src = audioBuffer.getChannelData(c);
    const dst = outBuf.getChannelData(c);
    dst.set(src);

    for (let f = 0; f < byPos.length; f++) {
      const start = byPos[f].i;
      let e = 0;
      for (let j = 0; j < frameSize && start + j < length; j++) {
        e += src[start + j] * src[start + j];
      }
      e = Math.sqrt(e / frameSize);
      if (e < threshold) {
        // Soft knee attenuation
        const ratio = e / (threshold + 1e-10);
        const atten = clamp(1 - strength * (1 - ratio) * 0.9, 0.2, 1);
        // Fade across hop to avoid clicks
        for (let j = 0; j < hop && start + j < length; j++) {
          const fade = j < 64 ? j / 64 : (j > hop - 64 ? (hop - j) / 64 : 1);
          const a = 1 - (1 - atten) * fade;
          dst[start + j] *= a;
        }
      }
    }
    if (onProgress) onProgress(0.25 + 0.7 * ((c + 1) / channels));
  }
  return outBuf;
}
