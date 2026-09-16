/**
 * Base effect interface / helpers
 * Each effect module exports:
 * - id, name, description, icon
 * - defaultParams
 * - createNodes(ctx, params) -> { input, output, nodes?, cleanup? }
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
