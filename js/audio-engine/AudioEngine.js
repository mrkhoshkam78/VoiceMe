/**
 * AudioEngine – public facade for the entire audio subsystem.
 * UI talks only to this class.
 */
import { AudioContextManager } from './AudioContextManager.js';
import { AudioLoader } from './AudioLoader.js';
import { AudioGraph } from './AudioGraph.js';
import { AudioPlayer } from './AudioPlayer.js';
import { AudioRenderer } from './AudioRenderer.js';
import { AudioExporter } from './AudioExporter.js';

export class AudioEngine {
  constructor() {
    this.ctxManager = new AudioContextManager();
    this.loader = new AudioLoader(this.ctxManager);
    this.graph = new AudioGraph(this.ctxManager);
    this.player = new AudioPlayer(this.ctxManager, this.graph);
    this.renderer = new AudioRenderer(this.ctxManager);
    this.exporter = new AudioExporter();

    this.originalBuffer = null;
    this.meta = null;
    this.effects = []; // [{id, params, enabled}]
    this.previewMode = 'processed';
    this.instrumentalBuffer = null;  // cached vocal-removed stem
    this.vocalsBuffer = null;
    this.separationMeta = null;

    // proxy events
    this.player.onTimeUpdate = (t) => { if (this.onTimeUpdate) this.onTimeUpdate(t); };
    this.player.onEnded = () => { if (this.onEnded) this.onEnded(); };
    this.player.onStateChange = (s) => { if (this.onStateChange) this.onStateChange(s); };
  }

  // ── Events (set by UI) ──
  onTimeUpdate = null;
  onEnded = null;
  onStateChange = null;

  // ── Load ──
  async loadFile(file) {
    this.stop();
    const { buffer, meta } = await this.loader.load(file);
    this.originalBuffer = buffer;
    this.meta = meta;
    this.instrumentalBuffer = null;
    this.vocalsBuffer = null;
    this.separationMeta = null;
    this.player.setBuffer(buffer);
    this.effects = [];
    this.player.setEffects([]);
    return meta;
  }

  // ── Effects ──
  setEffects(list) {
    this.effects = list.map(e => ({
      id: e.id,
      params: { ...e.params },
      enabled: !!e.enabled
    }));
    this.player.setEffects(this.effects);
    if (this.player.isPlaying) {
      this.player.rebuild();
    }
  }

  updateEffectParams(id, params) {
    const e = this.effects.find(x => x.id === id);
    if (!e) return;
    Object.assign(e.params, params);
    this.player.setEffects(this.effects);

    // 1) Prefer live AudioParam update (no audible gap)
    const live = this.graph.updateParams(id, params);
    if (live) return;

    // 2) Effect needs structural rebuild (e.g. pitchFactor) while playing
    if (this.player.isPlaying) {
      this.player.rebuild();
    }
  }

  // ── Playback ──
  async play(offset) {
    // Ensure context is running (Chrome autoplay)
    await this.ctxManager.ensure();
    this.player.setMode(this.previewMode);
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
  get duration() { return this.player.duration; }

  getAnalyserTimeData() { return this.graph.getAnalyserTimeData(); }
  getAnalyserFreqData() { return this.graph.getAnalyserFreqData(); }


  /**
   * Run vocal separation offline and cache instrumental for preview A/B.
   * Original buffer is never modified.
   */
  async processVocalRemoval(params, onProgress) {
    if (!this.originalBuffer) throw new Error('NO_BUFFER');
    const entry = (await import('../effects/index.js')).effectsRegistry.vocalRemoval;
    if (!entry?.processOfflineBuffer) throw new Error('NO_VR');
    const result = await entry.processOfflineBuffer(
      this.originalBuffer,
      params || {},
      onProgress
    );
    this.instrumentalBuffer = result;
    this.vocalsBuffer = result._vocalsBuffer || null;
    this.separationMeta = result._separationMeta || null;
    return {
      confidence: this.separationMeta?.confidence ?? 0,
      method: this.separationMeta?.method ?? 'stft',
      hasVocalsStem: !!this.vocalsBuffer
    };
  }

  /**
   * Switch playback source: 'original' | 'instrumental' | 'vocals'
   * Used for A/B after separation. Keeps originalBuffer intact.
   */
  setPlaybackSource(which) {
    let buf = this.originalBuffer;
    if (which === 'instrumental' && this.instrumentalBuffer) buf = this.instrumentalBuffer;
    else if (which === 'vocals' && this.vocalsBuffer) buf = this.vocalsBuffer;
    if (!buf) return false;
    const wasPlaying = this.player.isPlaying;
    const t = this.player.currentTime;
    this.player.setBuffer(buf);
    // Restore duration-related UI via player buffer; effects still apply on top
    if (wasPlaying) this.player.play(Math.min(t, buf.duration));
    return true;
  }

  clearVocalSeparation() {
    this.instrumentalBuffer = null;
    this.vocalsBuffer = null;
    this.separationMeta = null;
    if (this.originalBuffer) this.player.setBuffer(this.originalBuffer);
  }

  // ── Export ──
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
    this.player.setEffects([]);
    this.previewMode = 'processed';
    this.player.setMode('processed');
    this.clearVocalSeparation();
  }

  async dispose() {
    this.stop(true);
    this.graph.disconnect();
    await this.ctxManager.close();
    this.originalBuffer = null;
    this.meta = null;
  }

  /** Diagnostics for development */
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
