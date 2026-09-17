import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'bassBoost',
  name: 'Bass Boost',
  description: 'Controlled low-end warmth without mud or clipping',
  icon: 'bass',
  category: 'tone',
  defaultParams: { amount: 4, frequency: 100 }
};

export function createNodes(ctx, params = {}) {
  const amount = Math.min(8, Math.max(0, params.amount ?? 4));
  const freq = Math.min(250, Math.max(50, params.frequency ?? 100));

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);

  // Sub-cut to avoid boom/rumble
  const hp = createBiquad(ctx, 'highpass', 35, 0.7);
  // Focused low shelf, modest gain
  const shelf = createBiquad(ctx, 'lowshelf', freq, 0.8, amount * 0.85);
  // Light low-mid body, not muddy
  const body = createBiquad(ctx, 'peaking', 180, 0.9, amount > 4 ? amount * 0.15 : 0);
  // Slight high-mid clarity to compensate perception
  const clear = createBiquad(ctx, 'peaking', 3200, 1.2, amount > 5 ? 0.8 : 0);

  // Soft dynamics, low ratio – cascade-friendly
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 10;
  comp.ratio.value = 1.8;
  comp.attack.value = 0.015;
  comp.release.value = 0.22;

  // Makeup compensation roughly inverse of boost energy
  const makeup = createGain(ctx, Math.max(0.7, 1 - amount * 0.03));

  input.connect(hp);
  hp.connect(shelf);
  shelf.connect(body);
  body.connect(clear);
  clear.connect(comp);
  comp.connect(makeup);
  makeup.connect(output);

  return {
    input, output,
    nodes: [input, hp, shelf, body, clear, comp, makeup, output],
    update(p) {
      if (p.amount !== undefined) {
        const a = Math.min(8, Math.max(0, p.amount));
        shelf.gain.setTargetAtTime(a * 0.85, ctx.currentTime, 0.05);
        body.gain.setTargetAtTime(a > 4 ? a * 0.15 : 0, ctx.currentTime, 0.05);
        clear.gain.setTargetAtTime(a > 5 ? 0.8 : 0, ctx.currentTime, 0.05);
        makeup.gain.setTargetAtTime(Math.max(0.7, 1 - a * 0.03), ctx.currentTime, 0.05);
      }
      if (p.frequency !== undefined) {
        shelf.frequency.setTargetAtTime(Math.min(250, Math.max(50, p.frequency)), ctx.currentTime, 0.05);
      }
    }
  };
}
