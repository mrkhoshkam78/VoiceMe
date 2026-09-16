/**
 * AudioManager V1.02
 * Fixed: effect chain connectivity, seek sync with playbackRate, offline = preview pipeline
 */

import { createEffectNodes, effectsRegistry } from '../effects/index.js';
import { audioBufferToWav, downloadBlob, clamp } from '../utils/helpers.js';

export class AudioManager {
  constructor() {
    this.audioContext = null;
    this.originalBuffer = null;
    this.fileName = '';
    this.fileSize = 0;

    this.sourceNode = null;
    this.effectChain = [];
    this.masterGain = null;
    this.analyser = null;

    this.isPlaying = false;
    this.startContextTime = 0;   // audioContext.currentTime when play started
    this.pauseOffset = 0;        // position in SOURCE buffer (seconds) when paused/stopped
    this.currentRate = 1;        // active playbackRate
    this.previewMode = 'processed';

    this.activeEffects = [];     // [{ id, params, enabled }]

    this.onTimeUpdate = null;
    this.onEnded = null;
    this.onStateChange = null;

    this._rafId = null;
    this._seeking = false;
  }

  async initContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
    return this.audioContext;
  }

  async loadFile(file) {
    await this.initContext();
    this.stop(true);
    this.originalBuffer = null;
    this.fileName = file.name;
    this.fileSize = file.size;

    const arrayBuffer = await file.arrayBuffer();
    try {
      this.originalBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
    } catch (err) {
      throw new Error('DECODE_FAILED');
    }

    this.pauseOffset = 0;
    this.currentRate = 1;
    this.activeEffects = [];
    return {
      duration: this.originalBuffer.duration,
      sampleRate: this.originalBuffer.sampleRate,
      channels: this.originalBuffer.numberOfChannels,
      name: this.fileName,
      size: this.fileSize
    };
  }

  getDuration() {
    return this.originalBuffer ? this.originalBuffer.duration : 0;
  }

  /**
   * Current position in the SOURCE buffer (0 … duration).
   * Accounts for playbackRate so seekbar stays in sync with audio content.
   */
  getCurrentTime() {
    if (!this.isPlaying || !this.audioContext) return this.pauseOffset;
    const elapsed = this.audioContext.currentTime - this.startContextTime;
    const pos = this.pauseOffset + elapsed * this.currentRate;
    return clamp(pos, 0, this.getDuration());
  }

  /**
   * Combined pitch factor from all enabled voice-type effects.
   */
  _computePitchFactor(effects) {
    let factor = 1;
    for (const e of effects) {
      if (!e.enabled) continue;
      // Peek pitchFactor by creating nodes (lightweight for this purpose)
      try {
        const result = createEffectNodes(this.audioContext, e.id, e.params);
        if (result.pitchFactor && result.pitchFactor !== 1) {
          factor *= result.pitchFactor;
        }
        // Disconnect temp nodes immediately
        (result.nodes || []).forEach(n => { try { n.disconnect(); } catch (_) {} });
      } catch (_) {}
    }
    return clamp(factor, 0.5, 2.0);
  }

  /**
   * Build real-time graph.
   * Signal: Source → Effect1 → Effect2 → … → MasterGain → Analyser → Destination
   */
  _buildGraph() {
    if (!this.audioContext || !this.originalBuffer) return;

    // Tear down previous graph
    if (this.sourceNode) {
      try { this.sourceNode.onended = null; this.sourceNode.stop(); } catch (_) {}
      try { this.sourceNode.disconnect(); } catch (_) {}
      this.sourceNode = null;
    }
    this.effectChain.forEach(item => {
      (item.nodes || []).forEach(n => { try { n.disconnect(); } catch (_) {} });
    });
    this.effectChain = [];
    if (this.masterGain) { try { this.masterGain.disconnect(); } catch (_) {} }
    if (this.analyser) { try { this.analyser.disconnect(); } catch (_) {} }

    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 1;

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.7;

    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);

    const enabled = this.activeEffects.filter(e => e.enabled);
    this.currentRate = 1;

    this.sourceNode = this.audioContext.createBufferSource();
    this.sourceNode.buffer = this.originalBuffer;
    this.sourceNode.loop = false;

    let current = this.sourceNode;

    if (this.previewMode === 'original' || enabled.length === 0) {
      // Direct path – no effects
      this.currentRate = 1;
    } else {
      for (const effect of enabled) {
        const result = createEffectNodes(this.audioContext, effect.id, effect.params);
        this.effectChain.push({
          id: effect.id,
          nodes: result.nodes || [],
          update: result.update || null,
          input: result.input,
          output: result.output
        });
        if (result.pitchFactor && result.pitchFactor !== 1) {
          this.currentRate *= result.pitchFactor;
        }
        current.connect(result.input);
        current = result.output;
      }
      this.currentRate = clamp(this.currentRate, 0.5, 2.0);
    }

    current.connect(this.masterGain);
    this.sourceNode.playbackRate.value = this.currentRate;

    this.sourceNode.onended = () => {
      // Only fire if we reached natural end (not stop/seek)
      if (this.isPlaying && !this._seeking) {
        this.isPlaying = false;
        this.pauseOffset = 0;
        this._stopTimeUpdate();
        if (this.onEnded) this.onEnded();
        if (this.onStateChange) this.onStateChange('stopped');
      }
    };
  }

  async play(fromOffset = null) {
    if (!this.originalBuffer) return;
    await this.initContext();

    const offset = fromOffset !== null ? clamp(fromOffset, 0, this.getDuration()) : this.pauseOffset;
    this.pauseOffset = offset;
    this._seeking = false;

    this._buildGraph();

    // When rate != 1 the remaining playable length changes
    const remaining = (this.getDuration() - offset) / this.currentRate;
    try {
      this.sourceNode.start(0, offset);
      // Schedule stop so onended fires reliably even with rate change
      if (remaining > 0 && isFinite(remaining)) {
        this.sourceNode.stop(this.audioContext.currentTime + remaining + 0.05);
      }
    } catch (err) {
      console.error('play start error', err);
      return;
    }

    this.startContextTime = this.audioContext.currentTime;
    this.isPlaying = true;
    this._startTimeUpdate();
    if (this.onStateChange) this.onStateChange('playing');
  }

  pause() {
    if (!this.isPlaying) return;
    this.pauseOffset = this.getCurrentTime();
    this._seeking = true;
    this._stopGraphSource();
    this.isPlaying = false;
    this._stopTimeUpdate();
    if (this.onStateChange) this.onStateChange('paused');
  }

  stop(resetOffset = true) {
    this._seeking = true;
    this._stopGraphSource();
    this.isPlaying = false;
    this._stopTimeUpdate();
    if (resetOffset) this.pauseOffset = 0;
    if (this.onStateChange) this.onStateChange('stopped');
  }

  _stopGraphSource() {
    if (this.sourceNode) {
      try { this.sourceNode.onended = null; this.sourceNode.stop(); } catch (_) {}
      try { this.sourceNode.disconnect(); } catch (_) {}
      this.sourceNode = null;
    }
  }

  seek(time) {
    const t = clamp(time, 0, this.getDuration());
    const wasPlaying = this.isPlaying;
    this.pauseOffset = t;
    if (wasPlaying) {
      this.play(t);
    } else {
      // Update UI time even when paused
      if (this.onTimeUpdate) this.onTimeUpdate(t);
    }
  }

  setPreviewMode(mode) {
    const wasPlaying = this.isPlaying;
    const t = this.getCurrentTime();
    this.previewMode = mode;
    if (wasPlaying) this.play(t);
  }

  setActiveEffects(effectsList) {
    const wasPlaying = this.isPlaying;
    const t = this.getCurrentTime();
    this.activeEffects = effectsList.map(e => ({
      id: e.id,
      params: { ...e.params },
      enabled: !!e.enabled
    }));
    if (wasPlaying) {
      this.play(t);
    }
  }

  updateEffectParams(id, params) {
    const effect = this.activeEffects.find(e => e.id === id);
    if (!effect) return;
    Object.assign(effect.params, params);

    const chainItem = this.effectChain.find(c => c.id === id);
    if (chainItem && typeof chainItem.update === 'function') {
      chainItem.update(params);
    } else if (this.isPlaying) {
      // Effects that affect pitchFactor need full rebuild
      const t = this.getCurrentTime();
      this.play(t);
    }
  }

  _startTimeUpdate() {
    this._stopTimeUpdate();
    const tick = () => {
      if (!this.isPlaying) return;
      const t = this.getCurrentTime();
      if (t >= this.getDuration() - 0.02) {
        this.isPlaying = false;
        this.pauseOffset = 0;
        this._stopTimeUpdate();
        if (this.onEnded) this.onEnded();
        if (this.onStateChange) this.onStateChange('stopped');
        return;
      }
      if (this.onTimeUpdate) this.onTimeUpdate(t);
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopTimeUpdate() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  getAnalyserData() {
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    return data;
  }

  getFrequencyData() {
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }

  /**
   * Offline render – identical effect chain as real-time preview.
   */
  async renderOffline(onProgress) {
    if (!this.originalBuffer) throw new Error('NO_BUFFER');
    await this.initContext();

    let workingBuffer = this.originalBuffer;
    const enabled = this.activeEffects.filter(e => e.enabled);

    // AutoTune offline pre-process (pitch correction on buffer)
    const atEffect = enabled.find(e => e.id === 'autotune');
    if (atEffect) {
      const entry = effectsRegistry['autotune'];
      if (entry && entry.processOfflineBuffer) {
        if (onProgress) onProgress(0.05);
        workingBuffer = await entry.processOfflineBuffer(
          workingBuffer,
          atEffect.params,
          (p) => { if (onProgress) onProgress(0.05 + p * 0.4); }
        );
      }
    }

    // Remaining effects (skip autotune nodes since already applied)
    const chainEffects = enabled.filter(e => e.id !== 'autotune');

    const duration = workingBuffer.duration;
    const sampleRate = workingBuffer.sampleRate;
    const channels = workingBuffer.numberOfChannels;

    let pitchFactor = 1;
    for (const e of chainEffects) {
      try {
        const r = createEffectNodes(this.audioContext, e.id, e.params);
        if (r.pitchFactor) pitchFactor *= r.pitchFactor;
        (r.nodes || []).forEach(n => { try { n.disconnect(); } catch (_) {} });
      } catch (_) {}
    }
    pitchFactor = clamp(pitchFactor, 0.5, 2.0);

    const renderedDuration = duration / pitchFactor;
    const frameCount = Math.max(1, Math.ceil(sampleRate * renderedDuration));
    const offlineCtx = new OfflineAudioContext(channels, frameCount, sampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = workingBuffer;
    source.playbackRate.value = pitchFactor;

    let current = source;
    for (const effect of chainEffects) {
      const result = createEffectNodes(offlineCtx, effect.id, effect.params);
      current.connect(result.input);
      current = result.output;
    }

    const master = offlineCtx.createGain();
    master.gain.value = 1;
    current.connect(master);
    master.connect(offlineCtx.destination);
    source.start(0);

    let progressTimer;
    if (onProgress) {
      let p = 0.5;
      progressTimer = setInterval(() => {
        p = Math.min(0.95, p + 0.03);
        onProgress(p);
      }, 80);
    }

    try {
      const rendered = await offlineCtx.startRendering();
      if (progressTimer) clearInterval(progressTimer);
      if (onProgress) onProgress(1);
      return rendered;
    } catch (err) {
      if (progressTimer) clearInterval(progressTimer);
      throw new Error('RENDER_FAILED');
    }
  }

  async exportWav(onProgress) {
    const buffer = await this.renderOffline(onProgress);
    const blob = audioBufferToWav(buffer);
    const baseName = this.fileName.replace(/\.[^/.]+$/, '') || 'audio';
    const outName = `${baseName}_edited.wav`;
    downloadBlob(blob, outName);
    return outName;
  }

  reset() {
    this.stop(true);
    this.activeEffects = [];
    this.previewMode = 'processed';
    this.currentRate = 1;
  }

  dispose() {
    this.stop(true);
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.originalBuffer = null;
  }
}
