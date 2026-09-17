import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'studio',
  name: 'استودیو',
  description: 'زنجیره استودیو: EQ اصلاحی، فشرده‌سازی ملایم، de-ess و ambience',
  icon: 'studio',
  category: 'environment',
  defaultParams: { roomSize: 0.5, wet: 0.32, intensity: 0.65 }
};

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
      if (t < 0.09) early = Math.exp(-28 * t) * (Math.random() * 0.55);
      data[i] = (noise * 0.45 + early) * env;
    }
  }
  return impulse;
}

export function createNodes(ctx, params = {}) {
  const roomSize = params.roomSize ?? 0.5;
  const wetAmt = params.wet ?? 0.32;
  const intensity = params.intensity ?? 0.65;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);
  const dry = createGain(ctx, 1 - wetAmt);
  const wet = createGain(ctx, wetAmt * intensity);

  const hp = createBiquad(ctx, 'highpass', 55, 0.7);
  const presence = createBiquad(ctx, 'peaking', 3400, 1.0, 2 + intensity * 2);
  const air = createBiquad(ctx, 'highshelf', 7500, 1, 1.2 + intensity);
  // Gentle de-ess
  const deess = createBiquad(ctx, 'peaking', 6500, 1.6, -1.2 - intensity * 1.5);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 12;
  comp.ratio.value = 2.4;
  comp.attack.value = 0.012;
  comp.release.value = 0.22;

  const convolver = ctx.createConvolver();
  convolver.buffer = createImpulse(ctx, 0.9 + roomSize * 1.8, 1.7 + roomSize * 1.6);

  const wetLp = createBiquad(ctx, 'lowpass', 6800 - roomSize * 1800, 0.7);

  input.connect(hp);
  hp.connect(presence);
  presence.connect(air);
  air.connect(deess);
  deess.connect(comp);

  comp.connect(dry);
  dry.connect(output);

  comp.connect(convolver);
  convolver.connect(wetLp);
  wetLp.connect(wet);
  wet.connect(output);

  return {
    input, output,
    nodes: [input, hp, presence, air, deess, comp, dry, convolver, wetLp, wet, output],
    update(p) {
      const w = p.wet ?? wetAmt;
      const inten = p.intensity ?? intensity;
      dry.gain.setTargetAtTime(1 - w, ctx.currentTime, 0.05);
      wet.gain.setTargetAtTime(w * inten, ctx.currentTime, 0.05);
      if (p.intensity !== undefined) {
        presence.gain.setTargetAtTime(2 + inten * 2, ctx.currentTime, 0.05);
      }
    }
  };
}
