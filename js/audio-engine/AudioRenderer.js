/**
 * Offline rendering of the full effect chain.
 * Order:
 * 1. Vocal pitch (female/deep) – duration-preserving
 * 2. AutoTune offline pitch correction
 * 3. Noise Reduction offline
 * 4. Remaining live-style effects via OfflineAudioContext (rate = 1)
 */
import { createEffectNodes, effectsRegistry } from '../effects/index.js';

export class AudioRenderer {
  constructor(ctxManager) {
    this.ctxManager = ctxManager;
  }

  async render(originalBuffer, effects, onProgress) {
    await this.ctxManager.ensure();
    let working = originalBuffer;
    const enabled = effects.filter(e => e.enabled);

    // 1) Vocal gender pitch (duration preserved)
    const vocalIds = ['femaleVoice', 'deepVoice'];
    for (const vid of vocalIds) {
      const fx = enabled.find(e => e.id === vid);
      if (!fx) continue;
      const entry = effectsRegistry[vid];
      if (entry?.processOfflineBuffer) {
        if (onProgress) onProgress(0.05, 'در حال تغییر Pitch / Formant...');
        working = await entry.processOfflineBuffer(working, fx.params, (p) => {
          if (onProgress) onProgress(0.05 + p * 0.25, 'در حال تغییر Pitch / Formant...');
        });
      }
    }

    // 2) AutoTune offline
    const at = enabled.find(e => e.id === 'autotune');
    if (at) {
      const entry = effectsRegistry.autotune;
      if (entry?.processOfflineBuffer) {
        if (onProgress) onProgress(0.32, 'در حال تشخیص و اصلاح Pitch...');
        working = await entry.processOfflineBuffer(working, at.params, (p) => {
          if (onProgress) onProgress(0.32 + p * 0.25, 'در حال اعمال اتوتیون...');
        });
      }
    }

    // 3) Noise reduction offline
    const nr = enabled.find(e => e.id === 'noiseReduction');
    if (nr) {
      const entry = effectsRegistry.noiseReduction;
      if (entry?.processOfflineBuffer) {
        if (onProgress) onProgress(0.58, 'در حال کاهش نویز...');
        working = await entry.processOfflineBuffer(working, nr.params, (p) => {
          if (onProgress) onProgress(0.58 + p * 0.12, 'در حال کاهش نویز...');
        });
      }
    }

    // Remaining effects that are pure Web Audio nodes (no buffer pre-process)
    const skip = new Set(['autotune', 'noiseReduction', 'femaleVoice', 'deepVoice']);
    const chain = enabled.filter(e => !skip.has(e.id));

    const duration = working.duration;
    const sampleRate = working.sampleRate;
    const channels = working.numberOfChannels;
    const frames = Math.max(1, Math.ceil(sampleRate * duration));
    const offline = new OfflineAudioContext(channels, frames, sampleRate);

    const source = offline.createBufferSource();
    source.buffer = working;
    source.playbackRate.value = 1; // always 1 – duration already preserved

    let current = source;
    for (const effect of chain) {
      try {
        const result = createEffectNodes(offline, effect.id, effect.params);
        current.connect(result.input);
        current = result.output;
      } catch (err) {
        console.error('[Renderer] effect failed', effect.id, err);
      }
    }

    const master = offline.createGain();
    master.gain.value = 1;
    current.connect(master);
    master.connect(offline.destination);
    source.start(0);

    if (onProgress) onProgress(0.72, 'در حال رندر نهایی...');

    let timer;
    if (onProgress) {
      let p = 0.72;
      timer = setInterval(() => {
        p = Math.min(0.95, p + 0.02);
        onProgress(p, 'در حال رندر نهایی...');
      }, 80);
    }

    try {
      const out = await offline.startRendering();
      if (timer) clearInterval(timer);
      if (onProgress) onProgress(1, 'آماده');
      return out;
    } catch (err) {
      if (timer) clearInterval(timer);
      console.error('[AudioRenderer]', err);
      throw new Error('RENDER_FAILED');
    }
  }
}
