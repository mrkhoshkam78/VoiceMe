import { createGain } from './baseEffect.js';

export const meta = {
  id: 'echo',
  name: 'اکو',
  description: 'تکرار کنترل‌شده صدا با Delay، Feedback و Mix',
  icon: 'echo',
  category: 'environment',
  defaultParams: { delay: 0.28, feedback: 0.35, mix: 0.4 }
};

export function createNodes(ctx, params = {}) {
  const delayTime = params.delay ?? 0.28;
  const feedback = Math.min(0.75, params.feedback ?? 0.35);
  const mix = params.mix ?? 0.4;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);
  const dry = createGain(ctx, 1 - mix);
  const wet = createGain(ctx, mix);

  const delayNode = ctx.createDelay(2.5);
  delayNode.delayTime.value = delayTime;

  const fbGain = createGain(ctx, feedback);
  const fbFilter = ctx.createBiquadFilter();
  fbFilter.type = 'lowpass';
  fbFilter.frequency.value = 3800;
  fbFilter.Q.value = 0.7;

  // subtle high-pass on wet to keep vocal clear
  const wetHp = ctx.createBiquadFilter();
  wetHp.type = 'highpass';
  wetHp.frequency.value = 120;

  input.connect(dry);
  dry.connect(output);

  input.connect(delayNode);
  delayNode.connect(wetHp);
  wetHp.connect(wet);
  wet.connect(output);

  delayNode.connect(fbFilter);
  fbFilter.connect(fbGain);
  fbGain.connect(delayNode);

  return {
    input, output,
    nodes: [input, dry, wet, delayNode, fbGain, fbFilter, wetHp, output],
    update(p) {
      if (p.delay !== undefined) delayNode.delayTime.setTargetAtTime(p.delay, ctx.currentTime, 0.05);
      if (p.feedback !== undefined) fbGain.gain.setTargetAtTime(Math.min(0.75, p.feedback), ctx.currentTime, 0.05);
      if (p.mix !== undefined) {
        dry.gain.setTargetAtTime(1 - p.mix, ctx.currentTime, 0.05);
        wet.gain.setTargetAtTime(p.mix, ctx.currentTime, 0.05);
      }
    }
  };
}
