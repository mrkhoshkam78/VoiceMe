/**
 * AudioManager – handles decoding, real-time preview graph,
 * offline rendering, and export.
 */

import { createEffectNodes, effectsRegistry } from '../effects/index.js';
import { audioBufferToWav, downloadBlob, clamp } from '../utils/helpers.js';

export class AudioManager {
  constructor() {
    this.audioContext = null;
    this.originalBuffer = null;
    this.fileName = '';
    this.fileSize = 0;
    this.fileType = '';

    // Real-time graph
    this.sourceNode = null;
    this.effectChain = []; // { id, nodes, params }
    this.masterGain = null;
    this.analyser = null;
    this.isPlaying = false;
    this.startTime = 0;
    this.pauseOffset = 0;
    this.previewMode = 'processed'; // 'original' | 'processed'

    // Active effect params (order matters)
    this.activeEffects = []; // [{ id, params, enabled }]

    this.onTimeUpdate = null;
    this.onEnded = null;
    this.onStateChange = null;

    this._rafId = null;
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
    this.stop();
    this.originalBuffer = null;
    this.fileName = file.name;
    this.fileSize = file.size;
    this.fileType = file.type || '';

    const arrayBuffer = await file.arrayBuffer();
    try {
      this.originalBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
    } catch (err) {
      throw new Error('DECODE_FAILED');
    }

    this.pauseOffset = 0;
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

  getCurrentTime() {
    if (!this.isPlaying || !this.audioContext) return this.pauseOffset;
    return this.pauseOffset + (this.audioContext.currentTime - this.startTime);
  }

  /**
   * Build the real-time processing graph according to activeEffects order.
   * Pitch-shifting effects return pitchFactor which is applied to the BufferSource.
   */
  _buildGraph() {
    if (!this.audioContext || !this.originalBuffer) return;

    // Disconnect previous
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (_) {}
    }
    this.effectChain.forEach((item) => {
      item.nodes.forEach((n) => {
        try { n.disconnect(); } catch (_) {}
      });
    });
    this.effectChain = [];

    if (this.masterGain) {
      try { this.masterGain.disconnect(); } catch (_) {}
    }

    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 1;

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;

    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);

    // Calculate combined pitch factor from voice effects
    let pitchFactor = 1;
    const enabled = this.activeEffects.filter((e) => e.enabled);

    // Create source
    this.sourceNode = this.audioContext.createBufferSource();
    this.sourceNode.buffer = this.originalBuffer;
    this.sourceNode.loop = false;

    let currentNode = this.sourceNode;

    if (this.previewMode === 'original' || enabled.length === 0) {
      currentNode.connect(this.masterGain);
    } else {
      for (const effect of enabled) {
        const result = createEffectNodes(this.audioContext, effect.id, effect.params);
        this.effectChain.push({ id: effect.id, nodes: result.nodes || [], update: result.update });

        if (result.pitchFactor && result.pitchFactor !== 1) {
          pitchFactor *= result.pitchFactor;
        }

        currentNode.connect(result.input);
        currentNode = result.output;
      }
      currentNode.connect(this.masterGain);
    }

    // Apply pitch (changes speed & pitch together – known limitation)
    this.sourceNode.playbackRate.value = clamp(pitchFactor, 0.5, 2.0);

    this.sourceNode.onended = () => {
      if (this.isPlaying) {
        this.isPlaying = false;
        this.pauseOffset = 0;
        if (this.onEnded) this.onEnded();
        if (this.onStateChange) this.onStateChange('stopped');
        this._stopTimeUpdate();
      }
    };
  }

  play(fromOffset = null) {
    if (!this.originalBuffer) return;
    this.stop(false);

    const offset = fromOffset !== null ? fromOffset : this.pauseOffset;
    this.pauseOffset = offset;

    this._buildGraph();
    this.sourceNode.start(0, offset);
    this.startTime = this.audioContext.currentTime;
    this.isPlaying = true;
    this._startTimeUpdate();
    if (this.onStateChange) this.onStateChange('playing');
  }

  pause() {
    if (!this.isPlaying) return;
    this.pauseOffset = this.getCurrentTime();
    this.stop(false);
    this.isPlaying = false;
    if (this.onStateChange) this.onStateChange('paused');
  }

  stop(resetOffset = true) {
    this._stopTimeUpdate();
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (_) {}
      this.sourceNode = null;
    }
    this.isPlaying = false;
    if (resetOffset) this.pauseOffset = 0;
    if (this.onStateChange) this.onStateChange('stopped');
  }

  seek(time) {
    const wasPlaying = this.isPlaying;
    this.pauseOffset = clamp(time, 0, this.getDuration());
    if (wasPlaying) {
      this.play(this.pauseOffset);
    }
  }

  setPreviewMode(mode) {
    const wasPlaying = this.isPlaying;
    const t = this.getCurrentTime();
    this.previewMode = mode;
    if (wasPlaying) {
      this.play(t);
    } else {
      this._buildGraph(); // keep graph ready
    }
  }

  /**
   * Update active effects list (order preserved)
   */
  setActiveEffects(effectsList) {
    // effectsList: [{ id, params, enabled }]
    const wasPlaying = this.isPlaying;
    const t = this.getCurrentTime();
    this.activeEffects = effectsList.map((e) => ({
      id: e.id,
      params: { ...e.params },
      enabled: !!e.enabled
    }));
    if (wasPlaying) {
      this.play(t);
    } else if (this.originalBuffer) {
      this._buildGraph();
    }
  }

  updateEffectParams(id, params) {
    const effect = this.activeEffects.find((e) => e.id === id);
    if (!effect) return;
    Object.assign(effect.params, params);

    // Try live update if the effect supports it
    const chainItem = this.effectChain.find((c) => c.id === id);
    if (chainItem && chainItem.update) {
      chainItem.update(params);
    } else if (this.isPlaying) {
      // Rebuild for effects that need it (pitch, etc.)
      const t = this.getCurrentTime();
      this.play(t);
    }
  }

  _startTimeUpdate() {
    this._stopTimeUpdate();
    const tick = () => {
      if (!this.isPlaying) return;
      const t = this.getCurrentTime();
      if (t >= this.getDuration()) {
        this.isPlaying = false;
        this.pauseOffset = 0;
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

  /**
   * Offline render of the full chain → AudioBuffer
   */
  async renderOffline(onProgress) {
    if (!this.originalBuffer) throw new Error('NO_BUFFER');

    const enabled = this.activeEffects.filter((e) => e.enabled);
    const duration = this.originalBuffer.duration;
    const sampleRate = this.originalBuffer.sampleRate;
    const channels = this.originalBuffer.numberOfChannels;

    // Combined pitch
    let pitchFactor = 1;
    for (const effect of enabled) {
      // Peek pitch without full node creation
      const tempCtx = this.audioContext;
      const result = createEffectNodes(tempCtx, effect.id, effect.params);
      if (result.pitchFactor) pitchFactor *= result.pitchFactor;
      // cleanup not strictly needed
    }
    pitchFactor = clamp(pitchFactor, 0.5, 2.0);

    // When pitch changes, rendered duration changes
    const renderedDuration = duration / pitchFactor;

    const offlineCtx = new OfflineAudioContext(channels, Math.ceil(sampleRate * renderedDuration), sampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = this.originalBuffer;
    source.playbackRate.value = pitchFactor;

    let current = source;

    for (const effect of enabled) {
      const result = createEffectNodes(offlineCtx, effect.id, effect.params);
      current.connect(result.input);
      current = result.output;
    }

    const master = offlineCtx.createGain();
    master.gain.value = 1;
    current.connect(master);
    master.connect(offlineCtx.destination);

    source.start(0);

    // Progress simulation (OfflineAudioContext has limited progress events)
    let progressInterval;
    if (onProgress) {
      let p = 0;
      progressInterval = setInterval(() => {
        p = Math.min(0.95, p + 0.05);
        onProgress(p);
      }, 100);
    }

    try {
      const rendered = await offlineCtx.startRendering();
      if (progressInterval) clearInterval(progressInterval);
      if (onProgress) onProgress(1);
      return rendered;
    } catch (err) {
      if (progressInterval) clearInterval(progressInterval);
      throw new Error('RENDER_FAILED');
    }
  }

  /**
   * Export processed audio as WAV
   */
  async exportWav(onProgress) {
    const buffer = await this.renderOffline(onProgress);
    const blob = audioBufferToWav(buffer);
    const baseName = this.fileName.replace(/\.[^/.]+$/, '') || 'audio';
    const outName = `${baseName}_edited.wav`;
    downloadBlob(blob, outName);
    return outName;
  }

  reset() {
    this.stop();
    this.activeEffects = [];
    this.previewMode = 'processed';
    this.pauseOffset = 0;
  }

  dispose() {
    this.stop();
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.originalBuffer = null;
  }
}
