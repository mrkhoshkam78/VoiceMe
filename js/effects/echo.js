/**
 * Echo / Delay effect
 */

import { createGain } from './baseEffect.js';

export const meta = {
  id: 'echo',
  name: 'اکو / پژواک',
  description: 'تأخیر و بازتاب صدا با کنترل Delay و Feedback',
  icon: '🔁',
  category: 'environment',
  defaultParams: {
    delay: 0.25,      // seconds 0.05 - 1.0
    feedback: 0.35,   // 0 - 0.8
    mix: 0.4          // wet/dry 0-1
  }
};

export function createNodes(ctx, params = {}) {
  const delayTime = params.delay ?? 0.25;
  const feedback = Math.min(0.8, params.feedback ?? 0.35);
  const mix = params.mix ?? 0.4;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);
  const dry = createGain(ctx, 1 - mix);
  const wet = createGain(ctx, mix);

  const delayNode = ctx.createDelay(2.0);
  delayNode.delayTime.value = delayTime;

  const feedbackGain = createGain(ctx, feedback);

  // Soft filter in feedback loop to prevent harsh buildup
  const feedbackFilter = ctx.createBiquadFilter();
  feedbackFilter.type = 'lowpass';
  feedbackFilter.frequency.value = 3500;

  input.connect(dry);
  dry.connect(output);

  input.connect(delayNode);
  delayNode.connect(wet);
  wet.connect(output);

  // Feedback loop
  delayNode.connect(feedbackFilter);
  feedbackFilter.connect(feedbackGain);
  feedbackGain.connect(delayNode);

  return {
    input,
    output,
    nodes: [input, dry, wet, delayNode, feedbackGain, feedbackFilter, output],
    update(params) {
      if (params.delay !== undefined) delayNode.delayTime.setTargetAtTime(params.delay, ctx.currentTime, 0.05);
      if (params.feedback !== undefined) feedbackGain.gain.setTargetAtTime(Math.min(0.8, params.feedback), ctx.currentTime, 0.05);
      if (params.mix !== undefined) {
        dry.gain.setTargetAtTime(1 - params.mix, ctx.currentTime, 0.05);
        wet.gain.setTargetAtTime(params.mix, ctx.currentTime, 0.05);
      }
    }
  };
}
