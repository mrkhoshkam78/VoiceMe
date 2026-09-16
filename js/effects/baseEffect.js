/**
 * Base helpers for effect modules
 */
export function createGain(ctx, value = 1) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

export function createBiquad(ctx, type, frequency, Q = 1, gain = 0) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = Q;
  if (type === 'peaking' || type === 'lowshelf' || type === 'highshelf') {
    f.gain.value = gain;
  }
  return f;
}

export function createShaper(ctx, amount = 20) {
  const shaper = ctx.createWaveShaper();
  const n = 256;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = Math.tanh(x * (1 + amount / 15));
  }
  shaper.curve = curve;
  shaper.oversample = '2x';
  return shaper;
}
