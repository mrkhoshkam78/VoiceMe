/**
 * Studio Vocal Chain – V2.4.4
 * HPF → presence EQ → de-ess → gentle comp → filtered ambience → mix
 */
import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'studio',
  name: 'استودیو',
  description: 'زنجیره استودیو: EQ اصلاحی، فشرده‌سازی، de-ess و فضای کنترل‌شده',
  icon: 'studio',
  category: 'space',
  defaultParams: { roomSize: 0.45, wet: 0.28, intensity: 0.6 },
  paramUnits: { roomSize: 'ratio', wet: 'ratio', intensity: 'ratio' },
  paramRanges: {
    roomSize: [0.1, 1],
    wet: [0, 0.6],
    intensity: [0, 1]
  }
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(v) || lo));
}

function createImpulse(ctx, duration, decay) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * duration);
  const impulse = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-decay * t);
      const noise = Math.random() * 2 - 1;
      let early = 0;
      if (t < 0.08) early = Math.exp(-30 * t) * (Math.random() * 0.5);
      data[i] = (noise * 0.4 + early) * env;
    }
  }
  return impulse;
}

export function createNodes(ctx, params = {}) {
  let roomSize = clamp(params.roomSize ?? 0.45, 0.1, 1);
  let wetAmt = clamp(params.wet ?? 0.28, 0, 0.6);
  let intensity = clamp(params.intensity ?? 0.6, 0, 1);

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);
  const dry = createGain(ctx, 1 - wetAmt);
  const wet = createGain(ctx, wetAmt * intensity);

  const hp = createBiquad(ctx, 'highpass', 60, 0.7);
  const presence = createBiquad(ctx, 'peaking', 3200, 1.0, 1.5 + intensity * 2);
  const air = createBiquad(ctx, 'highshelf', 8000, 0.8, 0.8 + intensity * 1.2);
  const deess = createBiquad(ctx, 'peaking', 6500, 1.5, -1 - intensity * 1.8);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -22;
  comp.knee.value = 12;
  comp.ratio.value = 2.2;
  comp.attack.value = 0.012;
  comp.release.value = 0.2;

  const convolver = ctx.createConvolver();
  convolver.buffer = createImpulse(ctx, 0.7 + roomSize * 1.6, 1.8 + roomSize * 1.4);

  const wetLp = createBiquad(ctx, 'lowpass', 6200 - roomSize * 1500, 0.7);
  const wetHp = createBiquad(ctx, 'highpass', 150, 0.7);

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
      wetAmt = clamp(p.wet ?? wetAmt, 0, 0.6);
      intensity = clamp(p.intensity ?? intensity, 0, 1);
      roomSize = clamp(p.roomSize ?? roomSize, 0.1, 1);
      dry.gain.setTargetAtTime(1 - wetAmt, t, 0.05);
      wet.gain.setTargetAtTime(wetAmt * intensity, t, 0.05);
      presence.gain.setTargetAtTime(1.5 + intensity * 2, t, 0.05);
      air.gain.setTargetAtTime(0.8 + intensity * 1.2, t, 0.05);
      deess.gain.setTargetAtTime(-1 - intensity * 1.8, t, 0.05);
      wetLp.frequency.setTargetAtTime(6200 - roomSize * 1500, t, 0.08);
    }
  };
}
