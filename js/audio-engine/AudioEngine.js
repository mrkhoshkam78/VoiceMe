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
    // try live update without rebuild
    const live = this.graph.updateParams(id, params);
    if (!live && this.player.isPlaying) {
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
    return {
      contextState: this.ctxManager.state,
      sampleRate: this.ctxManager.sampleRate,
      channels: this.originalBuffer?.numberOfChannels ?? 0,
      duration: this.duration,
      currentTime: this.currentTime,
      isPlaying: this.isPlaying,
      activeEffects: this.effects.filter(e => e.enabled).map(e => e.id),
      previewMode: this.previewMode,
      bufferSampleRate: this.originalBuffer?.sampleRate ?? 0
    };
  }
}
