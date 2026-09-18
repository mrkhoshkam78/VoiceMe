/**
 * Offline rendering – Non-destructive, single-pass, gain-staged
 * Root-cause fix for multi-effect warble/mud:
 *  - Original buffer never mutated
 *  - Offline pitch stages run once each
 *  - Live nodes applied once in OfflineAudioContext
 *  - Inter-stage peak limiting + master headroom
 *  - playbackRate always 1 after duration-preserving pitch
 */
import { createEffectNodes, effectsRegistry } from '../effects/index.js';

const HEADROOM = 0.85; // V2.4.4 tighter inter-stage headroom ~-1.4 dBFS // ~ -1 dBFS peak target

export class AudioRenderer {
  constructor(ctxManager) {
    this.ctxManager = ctxManager;
  }

  /** Peak-normalize / limit buffer in-place on a COPY */
  _limitPeaks(buffer, targetPeak = HEADROOM) {
    const channels = buffer.numberOfChannels;
    let peak = 0;
    for (let c = 0; c < channels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) {
        const a = Math.abs(d[i]);
        if (a > peak) peak = a;
      }
    }
    if (peak < 1e-6 || peak <= targetPeak) return buffer;

    const scale = targetPeak / peak;
    const out = new AudioBuffer({
      length: buffer.length,
      numberOfChannels: channels,
      sampleRate: buffer.sampleRate
    });
    for (let c = 0; c < channels; c++) {
      const src = buffer.getChannelData(c);
      const dst = out.getChannelData(c);
      for (let i = 0; i < src.length; i++) dst[i] = src[i] * scale;
    }
    return out;
  }

  async render(originalBuffer, effects, onProgress) {
    await this.ctxManager.ensure();
    // Never mutate original
    let working = originalBuffer;
    const enabled = effects.filter(e => e.enabled);

    // 0) Vocal Removal / Stem Separation (first, on original mix)
    const vr = enabled.find(e => e.id === 'vocalRemoval');
    if (vr) {
      const entry = effectsRegistry.vocalRemoval;
      if (entry?.processOfflineBuffer) {
        if (onProgress) onProgress(0.02, 'جداسازی Vocal / Instrumental...');
        working = await entry.processOfflineBuffer(working, vr.params, (p, label) => {
          if (onProgress) onProgress(0.02 + p * 0.28, label || 'جداسازی Stem...');
        });
        working = this._limitPeaks(working, HEADROOM);
      }
    }

    // 1) Vocal pitch once (female OR deep – not both stacked)
    const vocalIds = ['femaleVoice', 'deepVoice'];
    const vocalFx = vocalIds.map(id => enabled.find(e => e.id === id)).find(Boolean);
    if (vocalFx) {
      const entry = effectsRegistry[vocalFx.id];
      if (entry?.processOfflineBuffer) {
        if (onProgress) onProgress(0.05, 'Pitch / Formant...');
        working = await entry.processOfflineBuffer(working, vocalFx.params, (p) => {
          if (onProgress) onProgress(0.05 + p * 0.22, 'Pitch / Formant...');
        });
        working = this._limitPeaks(working, HEADROOM);
      }
    }

    // 2) AutoTune offline once
    const at = enabled.find(e => e.id === 'autotune');
    if (at) {
      const entry = effectsRegistry.autotune;
      if (entry?.processOfflineBuffer) {
        if (onProgress) onProgress(0.28, 'AutoTune...');
        working = await entry.processOfflineBuffer(working, at.params, (p) => {
          if (onProgress) onProgress(0.28 + p * 0.2, 'AutoTune...');
        });
        working = this._limitPeaks(working, HEADROOM);
      }
    }

    // 3) Noise reduction offline once
    const nr = enabled.find(e => e.id === 'noiseReduction');
    if (nr) {
      const entry = effectsRegistry.noiseReduction;
      if (entry?.processOfflineBuffer) {
        if (onProgress) onProgress(0.5, 'Noise Reduction...');
        working = await entry.processOfflineBuffer(working, nr.params, (p) => {
          if (onProgress) onProgress(0.5 + p * 0.12, 'Noise Reduction...');
        });
        working = this._limitPeaks(working, HEADROOM);
      }
    }

    // Skip offline-preprocessed from node chain (avoid double processing)
    const skip = new Set(['autotune', 'noiseReduction', 'femaleVoice', 'deepVoice', 'vocalRemoval']);
    // Character EQ for vocal still useful once in graph:
    // keep femaleVoice/deepVoice nodes for EQ only IF pitch already applied
    // Actually female createNodes is EQ-only (pitchFactor 1) – include EQ once
    skip.delete('femaleVoice');
    skip.delete('deepVoice');
    // But only include the active vocal for EQ
    const chain = enabled.filter(e => {
      if (e.id === 'femaleVoice' || e.id === 'deepVoice') {
        return vocalFx && e.id === vocalFx.id;
      }
      return !skip.has(e.id);
    });

    const duration = working.duration;
    const sampleRate = working.sampleRate;
    const channels = working.numberOfChannels;
    const frames = Math.max(1, Math.ceil(sampleRate * duration));

    const offline = new OfflineAudioContext(channels, frames, sampleRate);
    const source = offline.createBufferSource();
    source.buffer = working;
    source.playbackRate.value = 1;

    let current = source;
    for (const effect of chain) {
      try {
        const result = createEffectNodes(offline, effect.id, effect.params);
        // Soften cascade: scale makeup if many compressors downstream handled at master
        current.connect(result.input);
        current = result.output;
      } catch (err) {
        console.error('[Renderer] effect failed', effect.id, err);
      }
    }

    // Master: headroom gain + soft limiter (single stage – not per effect)
    const master = offline.createGain();
    master.gain.value = 0.95;
    const limiter = offline.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 2;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.05;

    current.connect(master);
    master.connect(limiter);
    limiter.connect(offline.destination);
    source.start(0);

    if (onProgress) onProgress(0.72, 'Rendering...');

    let timer;
    if (onProgress) {
      let p = 0.72;
      timer = setInterval(() => {
        p = Math.min(0.95, p + 0.02);
        onProgress(p, 'Rendering...');
      }, 80);
    }

    try {
      let out = await offline.startRendering();
      if (timer) clearInterval(timer);
      out = this._limitPeaks(out, HEADROOM);
      if (onProgress) onProgress(1, 'Done');
      return out;
    } catch (err) {
      if (timer) clearInterval(timer);
      console.error('[AudioRenderer]', err);
      throw new Error('RENDER_FAILED');
    }
  }
}
