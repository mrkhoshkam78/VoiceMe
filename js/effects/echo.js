import { createGain } from './baseEffect.js';

export const meta = {
  id: 'echo',
  name: 'اکو',
  description: 'تأخیر و پژواک با کنترل Delay و Feedback',
  icon: 'echo',
  category: 'environment',
  defaultParams: { delay: 0.28, feedback: 0.4, mix: 0.45 }
};

export function createNodes(ctx, params = {}) {
  const delayTime = params.delay ?? 0.28;
  const feedback = Math.min(0.85, params.feedback ?? 0.4);
  const mix = params.mix ?? 0.45;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);
  const dry = createGain(ctx, 1 - mix);
  const wet = createGain(ctx, mix);

  const delayNode = ctx.createDelay(2.5);
  delayNode.delayTime.value = delayTime;

  const fbGain = createGain(ctx, feedback);
  const fbFilter = ctx.createBiquadFilter();
  fbFilter.type = 'lowpass';
  fbFilter.frequency.value = 3200;

  input.connect(dry);
  dry.connect(output);

  input.connect(delayNode);
  delayNode.connect(wet);
  wet.connect(output);

  delayNode.connect(fbFilter);
  fbFilter.connect(fbGain);
  fbGain.connect(delayNode);

  return {
    input, output,
    nodes: [input, dry, wet, delayNode, fbGain, fbFilter, output],
    update(p) {
      if (p.delay !== undefined) delayNode.delayTime.setTargetAtTime(p.delay, ctx.currentTime, 0.04);
      if (p.feedback !== undefined) fbGain.gain.setTargetAtTime(Math.min(0.85, p.feedback), ctx.currentTime, 0.04);
      if (p.mix !== undefined) {
        dry.gain.setTargetAtTime(1 - p.mix, ctx.currentTime, 0.04);
        wet.gain.setTargetAtTime(p.mix, ctx.currentTime, 0.04);
      }
    }
  };
}
