/**
 * AudioEngine – public facade V1.05
 * UI talks only to this class.
 * Vocal pitch effects use duration-preserving PitchProcessor.
 */
import { AudioContextManager } from './AudioContextManager.js';
import { AudioLoader } from './AudioLoader.js';
import { AudioGraph } from './AudioGraph.js';
import { AudioPlayer } from './AudioPlayer.js';
import { AudioRenderer } from './AudioRenderer.js';
import { AudioExporter } from './AudioExporter.js';
import { effectsRegistry } from '../effects/index.js';

export class AudioEngine {
  constructor() {
    this.ctxManager = new AudioContextManager();
    this.loader = new AudioLoader(this.ctxManager);
    this.graph = new AudioGraph(this.ctxManager);
    this.player = new AudioPlayer(this.ctxManager, this.graph);
    this.renderer = new AudioRenderer(this.ctxManager);
    this.exporter = new AudioExporter();

    this.originalBuffer = null;
    this.processedBuffer = null; // after vocal pitch (duration-preserved)
    this.meta = null;
    this.effects = [];
    this.previewMode = 'processed';
    this._vocalProcessing = false;

    this.player.onTimeUpdate = (t) => { if (this.onTimeUpdate) this.onTimeUpdate(t); };
    this.player.onEnded = () => { if (this.onEnded) this.onEnded(); };
    this.player.onStateChange = (s) => { if (this.onStateChange) this.onStateChange(s); };
  }

  onTimeUpdate = null;
  onEnded = null;
  onStateChange = null;

  async loadFile(file) {
    this.stop();
    const { buffer, meta } = await this.loader.load(file);
    this.originalBuffer = buffer;
    this.processedBuffer = null;
    this.meta = meta;
    this.player.setBuffer(buffer);
    this.effects = [];
    this.player.setEffects([]);
    return meta;
  }

  /**
   * Apply duration-preserving vocal pitch if female/deep enabled.
   * Returns the buffer that should be played (original or pitched).
   */
  async _ensureProcessedBuffer() {
    const vocal = this.effects.find(e =>
      e.enabled && (e.id === 'femaleVoice' || e.id === 'deepVoice')
    );

    if (!vocal || this.previewMode === 'original') {
      this.processedBuffer = null;
      return this.originalBuffer;
    }

    // Cache key
    const key = JSON.stringify({ id: vocal.id, params: vocal.params });
    if (this._lastVocalKey === key && this.processedBuffer) {
      return this.processedBuffer;
    }

    this._vocalProcessing = true;
    try {
      const entry = effectsRegistry[vocal.id];
      if (entry?.processOfflineBuffer) {
        this.processedBuffer = await entry.processOfflineBuffer(
          this.originalBuffer,
          vocal.params
        );
        this._lastVocalKey = key;
      } else {
        this.processedBuffer = this.originalBuffer;
      }
    } finally {
      this._vocalProcessing = false;
    }
    return this.processedBuffer || this.originalBuffer;
  }

  async setEffects(list) {
    this.effects = list.map(e => ({
      id: e.id,
      params: { ...e.params },
      enabled: !!e.enabled
    }));
    this.player.setEffects(this.effects);

    // Re-process vocal buffer if needed
    const hasVocal = this.effects.some(e =>
      e.enabled && (e.id === 'femaleVoice' || e.id === 'deepVoice')
    );
    if (hasVocal) {
      this._lastVocalKey = null; // force reprocess
      const buf = await this._ensureProcessedBuffer();
      this.player.setBuffer(buf);
    } else {
      this.processedBuffer = null;
      this._lastVocalKey = null;
      this.player.setBuffer(this.originalBuffer);
    }

    if (this.player.isPlaying) {
      await this.player.rebuild();
    }
  }

  async updateEffectParams(id, params) {
    const e = this.effects.find(x => x.id === id);
    if (!e) return;
    Object.assign(e.params, params);
    this.player.setEffects(this.effects);

    const isVocal = id === 'femaleVoice' || id === 'deepVoice';
    const intensityOrMode = params.intensity !== undefined || params.mode !== undefined;

    if (isVocal && intensityOrMode && e.enabled) {
      this._lastVocalKey = null;
      const buf = await this._ensureProcessedBuffer();
      this.player.setBuffer(buf);
      if (this.player.isPlaying) await this.player.rebuild();
      return;
    }

    // Live AudioParam update
    const live = this.graph.updateParams(id, params);
    if (live) return;

    if (this.player.isPlaying) {
      await this.player.rebuild();
    }
  }

  async play(offset) {
    await this.ctxManager.ensure();
    this.player.setMode(this.previewMode);

    if (this.previewMode === 'processed') {
      const buf = await this._ensureProcessedBuffer();
      this.player.setBuffer(buf);
    } else {
      this.player.setBuffer(this.originalBuffer);
    }

    this.player.setEffects(this.effects);
    await this.player.play(offset);
  }

  pause() { this.player.pause(); }
  stop(reset = true) { this.player.stop(reset); }
  seek(t) { this.player.seek(t); }

  setPreviewMode(mode) {
    this.previewMode = mode;
    this.player.setMode(mode);
    if (this.player.isPlaying) this.player.rebuild();
  }

  get isPlaying() { return this.player.isPlaying; }
  get currentTime() { return this.player.currentTime; }
  get duration() {
    // Always report original duration (pitch preserves it)
    return this.originalBuffer ? this.originalBuffer.duration : 0;
  }

  getAnalyserTimeData() { return this.graph.getAnalyserTimeData(); }
  getAnalyserFreqData() { return this.graph.getAnalyserFreqData(); }

  async export(options, onProgress) {
    if (!this.originalBuffer) throw new Error('NO_BUFFER');
    const rendered = await this.renderer.render(
      this.originalBuffer,
      this.effects,
      onProgress
    );
    const fileName = this.meta?.name || 'audio';
    return this.exporter.export(rendered, { ...options, fileName }, onProgress);
  }

  reset() {
    this.stop(true);
    this.effects = [];
    this.processedBuffer = null;
    this._lastVocalKey = null;
    this.player.setEffects([]);
    this.player.setBuffer(this.originalBuffer);
    this.previewMode = 'processed';
    this.player.setMode('processed');
  }

  async dispose() {
    this.stop(true);
    this.graph.disconnect();
    await this.ctxManager.close();
    this.originalBuffer = null;
    this.processedBuffer = null;
    this.meta = null;
  }

  getDiagnostics() {
    const chain = this.graph.chain || [];
    return {
      contextState: this.ctxManager.state,
      sampleRate: this.ctxManager.sampleRate,
      channels: this.originalBuffer?.numberOfChannels ?? 0,
      duration: this.duration,
      currentTime: this.currentTime,
      isPlaying: this.isPlaying,
      activeEffects: this.effects.filter(e => e.enabled).map(e => e.id),
      graphChain: chain.map(c => c.id),
      sourceConnected: !!this.graph.source,
      masterGain: !!this.graph.masterGain,
      analyser: !!this.graph.analyser,
      playbackRate: this.graph.playbackRate || 1,
      previewMode: this.previewMode,
      bufferSampleRate: this.originalBuffer?.sampleRate ?? 0,
      vocalProcessed: !!this.processedBuffer,
      signalPath: this._describeSignalPath()
    };
  }

  _describeSignalPath() {
    const parts = ['Source'];
    const enabled = this.effects.filter(e => e.enabled);
    if (this.previewMode === 'original' || enabled.length === 0) {
      parts.push('(bypass)');
    } else {
      enabled.forEach(e => parts.push(e.id));
    }
    parts.push('MasterGain', 'Analyser', 'Destination');
    return parts.join(' → ');
  }
}
