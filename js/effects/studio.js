/**
 * Studio Vocal Chain – V2.5.2 Pro
 * HPF → gentle presence → de-ess → musical comp → stereo IR ambience → mix
 * IR: exponential decay + early reflections + L/R decorrelation (not cheap noise)
 */
import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'studio',
  name: 'استودیو',
  description: 'زنجیره استودیو: EQ اصلاحی، فشرده‌سازی، de-ess و فضای کنترل‌شده',
  icon: 'studio',
  category: 'space',
  defaultParams: { intensityMode: 'medium', roomSize: 0.5, wet: 0.38, intensity: 0.75 },
  intensityPresets: {
    low: { roomSize: 0.3, wet: 0.22, intensity: 0.5 },
    medium: { roomSize: 0.5, wet: 0.38, intensity: 0.75 },
    strong: { roomSize: 0.72, wet: 0.48, intensity: 0.95 }
  },
  paramUnits: { roomSize: 'ratio', wet: 'ratio', intensity: 'ratio' },
  paramRanges: {
    roomSize: [0.1, 1],
    wet: [0, 0.55],
    intensity: [0, 1]
  }
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(v) || lo));
}

/** Professional-style impulse: early reflections + smooth exponential tail + stereo width */
function createImpulse(ctx, duration, decay) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * duration);
  const impulse = ctx.createBuffer(2, len, sr);
  const earlyTimes = [0.008, 0.015, 0.027, 0.041, 0.058, 0.075];
  const earlyGains = [0.55, 0.4, 0.32, 0.22, 0.15, 0.1];

  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    const sideSign = ch === 0 ? 1 : -1;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-decay * t);
      // Decorrelated noise (different seed per channel via offset)
      const noise = (Math.sin(i * 12.9898 + ch * 78.233) * 43758.5453) % 1;
      const n = (noise * 2 - 1) * 0.35 * env;

      let early = 0;
      for (let e = 0; e < earlyTimes.length; e++) {
        const dt = Math.abs(t - earlyTimes[e] - ch * 0.0025);
        if (dt < 0.0015) {
          early += earlyGains[e] * (1 - dt / 0.0015) * sideSign * 0.5;
        }
      }
      data[i] = n + early * Math.exp(-12 * t);
    }
    // Soft peak normalize IR
    let peak = 1e-6;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(data[i]));
    const g = 0.85 / peak;
    for (let i = 0; i < len; i++) data[i] *= g;
  }
  return impulse;
}

const STUDIO_PRESETS = {
  low: { roomSize: 0.3, wet: 0.22, intensity: 0.5 },
  medium: { roomSize: 0.5, wet: 0.38, intensity: 0.75 },
  strong: { roomSize: 0.72, wet: 0.48, intensity: 0.95 }
};

export function createNodes(ctx, params = {}) {
  const preset = STUDIO_PRESETS[params.intensityMode] || null;
  let roomSize = clamp(params.roomSize ?? preset?.roomSize ?? 0.5, 0.1, 1);
  let wetAmt = clamp(params.wet ?? preset?.wet ?? 0.38, 0, 0.55);
  let intensity = clamp(params.intensity ?? preset?.intensity ?? 0.75, 0, 1);

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);
  const dry = createGain(ctx, 1 - wetAmt);
  const wet = createGain(ctx, wetAmt * intensity);

  // Subtle vocal polish – not aggressive
  const hp = createBiquad(ctx, 'highpass', 55, 0.7);
  const presence = createBiquad(ctx, 'peaking', 2800, 1.1, 1.0 + intensity * 1.6);
  const air = createBiquad(ctx, 'highshelf', 9000, 0.7, 0.5 + intensity * 0.9);
  const deess = createBiquad(ctx, 'peaking', 6800, 1.6, -0.8 - intensity * 1.4);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 14;
  comp.ratio.value = 2.0;
  comp.attack.value = 0.01;
  comp.release.value = 0.18;

  const convolver = ctx.createConvolver();
  convolver.buffer = createImpulse(ctx, 0.55 + roomSize * 1.4, 2.0 + roomSize * 1.2);

  // Keep reverb from becoming muddy or harsh
  const wetLp = createBiquad(ctx, 'lowpass', 5800 - roomSize * 1200, 0.7);
  const wetHp = createBiquad(ctx, 'highpass', 180, 0.7);

  input.connect(hp);
  hp.connect(presence);
  presence.connect(air);
  air.connect(deess);
  deess.connect(comp);

  comp.connect(dry);
  dry.connect(output);

  comp.connect(convolver);
  convolver.connect(wetHp);
  wetHp.connect(wetLp);
  wetLp.connect(wet);
  wet.connect(output);

  return {
    input, output,
    nodes: [input, hp, presence, air, deess, comp, dry, convolver, wetHp, wetLp, wet, output],
    update(p) {
      const t = ctx.currentTime;
      wetAmt = clamp(p.wet ?? wetAmt, 0, 0.55);
      intensity = clamp(p.intensity ?? intensity, 0, 1);
      roomSize = clamp(p.roomSize ?? roomSize, 0.1, 1);
      dry.gain.setTargetAtTime(1 - wetAmt, t, 0.05);
      wet.gain.setTargetAtTime(wetAmt * intensity, t, 0.05);
      presence.gain.setTargetAtTime(1.0 + intensity * 1.6, t, 0.05);
      air.gain.setTargetAtTime(0.5 + intensity * 0.9, t, 0.05);
      deess.gain.setTargetAtTime(-0.8 - intensity * 1.4, t, 0.05);
      wetLp.frequency.setTargetAtTime(5800 - roomSize * 1200, t, 0.08);
    }
  };
}
