/**
 * Offline rendering of the full effect chain.
 * AutoTune (if present) is pre-processed on the buffer first.
 */
import { createEffectNodes, effectsRegistry } from '../effects/index.js';
import { clamp } from '../utils/helpers.js';

export class AudioRenderer {
  constructor(ctxManager) {
    this.ctxManager = ctxManager;
  }

  /**
   * @param {AudioBuffer} originalBuffer
   * @param {Array} effects  [{id, params, enabled}]
   * @param {function} onProgress  (0..1, stageLabel)
   * @returns {Promise<AudioBuffer>}
   */
  async render(originalBuffer, effects, onProgress) {
    await this.ctxManager.ensure();
    let working = originalBuffer;
    const enabled = effects.filter(e => e.enabled);

    // 0) Vocal Removal / Stem Separation (offline, first)
    const vr = enabled.find(e => e.id === 'vocalRemoval');
    if (vr) {
      const entry = effectsRegistry.vocalRemoval;
      if (entry?.processOfflineBuffer) {
        if (onProgress) onProgress(0.01, 'شروع جداسازی Vocal...');
        working = await entry.processOfflineBuffer(working, vr.params, (p, label) => {
          if (onProgress) onProgress(0.01 + p * 0.4, label || 'جداسازی Vocal...');
        });
      }
    }

    // 1) AutoTune offline pitch correction
    const at = enabled.find(e => e.id === 'autotune');
    if (at) {
      const entry = effectsRegistry.autotune;
      if (entry?.processOfflineBuffer) {
        if (onProgress) onProgress(0.42, 'در حال تشخیص Pitch...');
        working = await entry.processOfflineBuffer(working, at.params, (p) => {
          if (onProgress) onProgress(0.42 + p * 0.25, 'در حال اعمال اتوتیون...');
        });
      }
    }

    // 2) Noise reduction offline if available
    const nr = enabled.find(e => e.id === 'noiseReduction');
    if (nr) {
      const entry = effectsRegistry.noiseReduction;
      if (entry?.processOfflineBuffer) {
        if (onProgress) onProgress(0.68, 'در حال کاهش نویز...');
        working = await entry.processOfflineBuffer(working, nr.params, (p) => {
          if (onProgress) onProgress(0.68 + p * 0.1, 'در حال کاهش نویز...');
        });
      }
    }

    const chain = enabled.filter(e => e.id !== 'autotune' && e.id !== 'noiseReduction' && e.id !== 'vocalRemoval');
    const duration = working.duration;
    const sampleRate = working.sampleRate;
    const channels = working.numberOfChannels;

    let pitchFactor = 1;
    for (const e of chain) {
      try {
        const r = createEffectNodes(this.ctxManager.get(), e.id, e.params);
        if (r.pitchFactor) pitchFactor *= r.pitchFactor;
        (r.nodes || []).forEach(n => { try { n.disconnect(); } catch (_) {} });
      } catch (_) {}
    }
    pitchFactor = clamp(pitchFactor, 0.5, 2.0);

    const renderedDuration = duration / pitchFactor;
    const frames = Math.max(1, Math.ceil(sampleRate * renderedDuration));
    const offline = new OfflineAudioContext(channels, frames, sampleRate);

    const source = offline.createBufferSource();
    source.buffer = working;
    source.playbackRate.value = pitchFactor;

    let current = source;
    for (const effect of chain) {
      const result = createEffectNodes(offline, effect.id, effect.params);
      current.connect(result.input);
      current = result.output;
    }

    const master = offline.createGain();
    master.gain.value = 1;
    current.connect(master);
    master.connect(offline.destination);
    source.start(0);

    if (onProgress) onProgress(0.55, 'در حال رندر نهایی...');

    let timer;
    if (onProgress) {
      let p = 0.55;
      timer = setInterval(() => {
        p = Math.min(0.95, p + 0.025);
        onProgress(p, 'در حال رندر نهایی...');
      }, 90);
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
