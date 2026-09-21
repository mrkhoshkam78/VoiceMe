/**
 * Builds the real-time processing graph:
 * Source → [Effect nodes…] → MasterGain → Analyser → Destination
 */
import { createEffectNodes } from '../effects/index.js';
import { clamp } from '../utils/helpers.js';

export class AudioGraph {
  constructor(ctxManager) {
    this.ctxManager = ctxManager;
    this.source = null;
    this.chain = [];
    this.masterGain = null;
    this.analyser = null;
    this.playbackRate = 1;
  }

  /**
   * Tear down all nodes safely.
   */
  disconnect() {
    if (this.source) {
      try { this.source.onended = null; } catch (_) {}
      try { this.source.stop(); } catch (_) {}
      try { this.source.disconnect(); } catch (_) {}
      this.source = null;
    }
    this.chain.forEach(item => {
      (item.nodes || []).forEach(n => {
        try { n.disconnect(); } catch (_) {}
      });
    });
    this.chain = [];
    if (this.masterGain) {
      try { this.masterGain.disconnect(); } catch (_) {}
      this.masterGain = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch (_) {}
      this.analyser = null;
    }
  }

  /**
   * Build graph for a given buffer + effects list.
   * effects: [{ id, params, enabled }]
   * mode: 'processed' | 'original'
   * Returns { source, playbackRate }
   */
  build(buffer, effects, mode = 'processed') {
    const ctx = this.ctxManager.get();
    if (!ctx || !buffer) return null;

    this.disconnect();

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 1;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.75;

    this.masterGain.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.source = ctx.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = false;

    let rate = 1;
    let current = this.source;
    const enabled = (mode === 'processed')
      ? effects.filter(e => e.enabled)
      : [];

    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[AudioGraph] build mode=%s enabled=%d ids=%s',
        mode, enabled.length, enabled.map(e => e.id).join(','));
    }

    for (const effect of enabled) {
      try {
        const result = createEffectNodes(ctx, effect.id, effect.params);
        if (!result || !result.input || !result.output) {
          console.error('[AudioGraph] effect returned invalid nodes:', effect.id);
          continue;
        }
        // Skip pure offline effects from live graph (they are bypass/no-op and only
        // confuse diagnostics). Their real work runs in AudioRenderer / processOffline.
        if (result.offlineOnly) {
          continue;
        }
        this.chain.push({
          id: effect.id,
          nodes: result.nodes || [],
          update: result.update || null
        });
        if (result.pitchFactor && result.pitchFactor !== 1) {
          rate *= result.pitchFactor;
        }
        current.connect(result.input);
        current = result.output;
      } catch (err) {
        console.error('[AudioGraph] effect failed:', effect.id, err);
        // do not break the chain — signal continues to next / master
      }
    }

    current.connect(this.masterGain);
    this.playbackRate = clamp(rate, 0.5, 2.0);
    this.source.playbackRate.value = this.playbackRate;

    return { source: this.source, playbackRate: this.playbackRate };
  }

  updateParams(id, params) {
    const item = this.chain.find(c => c.id === id);
    if (item && typeof item.update === 'function') {
      item.update(params);
      return true;
    }
    return false;
  }

  getAnalyserTimeData() {
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    return data;
  }

  getAnalyserFreqData() {
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }
}
