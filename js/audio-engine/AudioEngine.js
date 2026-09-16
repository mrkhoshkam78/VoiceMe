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
