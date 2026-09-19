/**
 * Echo / Delay – V2.5.2 Pro
 * Filtered feedback, musical defaults, soft high-damp on repeats.
 * Units: delay (s), feedback (0–0.72), mix (0–1)
 */
import { createGain, createBiquad } from './baseEffect.js';

export const meta = {
  id: 'echo',
  name: 'اکو (Echo)',
  description: 'تأخیر کنترل‌شده با فیلتر و سقف Feedback',
  icon: 'echo',
  category: 'space',
  defaultParams: { delay: 0.32, feedback: 0.28, mix: 0.28 },
  paramUnits: { delay: 's', feedback: 'ratio', mix: 'ratio' },
  paramRanges: {
    delay: [0.05, 0.9],
    feedback: [0, 0.72],
    mix: [0, 1]
  }
};

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(v) || lo));
}

export function createNodes(ctx, params = {}) {
  let delayTime = clamp(params.delay ?? 0.32, 0.05, 0.9);
  let feedbackAmt = clamp(params.feedback ?? 0.28, 0, 0.72);
  let mix = clamp(params.mix ?? 0.28, 0, 1);

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);
  const dry = createGain(ctx, 1 - mix);
  const wet = createGain(ctx, mix);

  const delayNode = ctx.createDelay(1.0);
  delayNode.delayTime.value = delayTime;

  const feedback = createGain(ctx, feedbackAmt);
  // Filter feedback loop – prevent harsh buildup (classic analog delay tone)
  const fbHp = createBiquad(ctx, 'highpass', 100, 0.7);
  const fbLp = createBiquad(ctx, 'lowpass', 4800, 0.7);
  // Mild damping on wet path for darker, more musical repeats
  const wetLp = createBiquad(ctx, 'lowpass', 6200, 0.7);

  input.connect(dry);
  dry.connect(output);

  input.connect(delayNode);
  delayNode.connect(fbHp);
  fbHp.connect(fbLp);
  fbLp.connect(feedback);
  feedback.connect(delayNode);

  delayNode.connect(wetLp);
  wetLp.connect(wet);
  wet.connect(output);

  return {
    input, output,
    nodes: [input, dry, wet, delayNode, feedback, fbHp, fbLp, wetLp, output],
    update(p) {
      const t = ctx.currentTime;
      delayTime = clamp(p.delay ?? delayTime, 0.05, 0.9);
      feedbackAmt = clamp(p.feedback ?? feedbackAmt, 0, 0.72);
      mix = clamp(p.mix ?? mix, 0, 1);
      delayNode.delayTime.setTargetAtTime(delayTime, t, 0.05);
      feedback.gain.setTargetAtTime(feedbackAmt, t, 0.05);
      dry.gain.setTargetAtTime(1 - mix, t, 0.04);
      wet.gain.setTargetAtTime(mix, t, 0.04);
    }
  };
}
