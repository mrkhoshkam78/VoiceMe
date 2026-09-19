/**
 * AudioEngine V1.06 – seamless effect updates, duration-safe vocals
 */
import { AudioContextManager } from './AudioContextManager.js';
import { AudioLoader } from './AudioLoader.js';
import { AudioGraph } from './AudioGraph.js';
import { AudioPlayer } from './AudioPlayer.js';
import { AudioRenderer } from './AudioRenderer.js';
import { AudioExporter } from './AudioExporter.js';
import { effectsRegistry } from '../effects/index.js';

const VOCAL_IDS = new Set(['femaleVoice', 'deepVoice']);
const LIVE_ONLY = new Set([
  'bassBoost', 'echo', 'volume', 'speaker', 'police',
  'studio', 'improveQuality', 'noiseReduction', 'autotune'
]);

export class AudioEngine {
  constructor() {
    this.ctxManager = new AudioContextManager();
    this.loader = new AudioLoader(this.ctxManager);
    this.graph = new AudioGraph(this.ctxManager);
    this.player = new AudioPlayer(this.ctxManager, this.graph);
    this.renderer = new AudioRenderer(this.ctxManager);
    this.exporter = new AudioExporter();

    this.originalBuffer = null;
    this.processedBuffer = null;
    this.instrumentalBuffer = null;
    this.vocalsBuffer = null;
    this.separationMeta = null;
    this.meta = null;
    this.effects = [];
    this.previewMode = 'processed';
    this._lastVocalKey = null;
    this._vocalBusy = false;
    this.speed = 1;
    // Track B (parallel dry mix)
    this.trackB = { buffer: null, meta: null, gain: 1, mute: false, solo: false, source: null };
    this.trackA = { gain: 1, mute: false, solo: false };


    this.player.onTimeUpdate = (t) => { if (this.onTimeUpdate) this.onTimeUpdate(t); };
    this.player.onEnded = () => { if (this.onEnded) this.onEnded(); };
    this.player.onStateChange = (s) => { if (this.onStateChange) this.onStateChange(s); };
  }

  onTimeUpdate = null;
  onEnded = null;
  onStateChange = null;
  onVocalProgress = null; // (0..1, label)

  async loadFile(file) {
    this.stop();
    const { buffer, meta } = await this.loader.load(file);
    this.originalBuffer = buffer; // immutable source – never mutate in place
    this.processedBuffer = null;
    this.instrumentalBuffer = null;
    this.vocalsBuffer = null;
    this.separationMeta = null;
    this._lastVocalKey = null;
    this.meta = meta;
    this.player.setBuffer(buffer);
    this.effects = [];
    this.player.setEffects([]);
    this.speed = 1;
    // Track B (parallel dry mix)
    this.trackB = { buffer: null, meta: null, gain: 1, mute: false, solo: false, source: null };
    this.trackA = { gain: 1, mute: false, solo: false };

    return meta;
  }

  _activeVocal() {
    return this.effects.find(e => e.enabled && VOCAL_IDS.has(e.id)) || null;
  }

  _vocalKey(vocal) {
    if (!vocal) return null;
    return JSON.stringify({ id: vocal.id, params: vocal.params });
  }

  /**
   * Duration-preserving vocal pitch. Yields to UI every chunk.
   */
  async _ensureProcessedBuffer() {
    const vocal = this._activeVocal();
    if (!vocal || this.previewMode === 'original') {
      this.processedBuffer = null;
      this._lastVocalKey = null;
      return this.originalBuffer;
    }

    const key = this._vocalKey(vocal);
    if (key === this._lastVocalKey && this.processedBuffer) {
      return this.processedBuffer;
    }

    this._vocalBusy = true;
    try {
      if (this.onVocalProgress) this.onVocalProgress(0.05, 'پردازش Pitch...');
      const entry = effectsRegistry[vocal.id];
      if (entry?.processOfflineBuffer) {
        // Yield once so UI can paint
        await new Promise(r => setTimeout(r, 0));
        this.processedBuffer = await entry.processOfflineBuffer(
          this.originalBuffer,
          vocal.params,
          (p) => {
            if (this.onVocalProgress) this.onVocalProgress(0.05 + p * 0.9, 'پردازش Pitch...');
          }
        );
        this._lastVocalKey = key;
      } else {
        this.processedBuffer = this.originalBuffer;
        this._lastVocalKey = key;
      }
      if (this.onVocalProgress) this.onVocalProgress(1, 'آماده');
    } finally {
      this._vocalBusy = false;
    }
    return this.processedBuffer || this.originalBuffer;
  }

  /**
   * Smart effect update:
   * - Live param changes → no pause
   * - Live effect toggle → seamless rebuild at same position
   * - Vocal toggle → process in background, then switch without dropping play state aggressively
   */
  async setEffects(list) {
    const prev = this.effects;
    this.effects = list.map(e => ({
      id: e.id,
      params: { ...e.params },
      enabled: !!e.enabled
    }));
    this.player.setEffects(this.effects);

    const prevVocal = prev.find(e => e.enabled && VOCAL_IDS.has(e.id));
    const nextVocal = this._activeVocal();
    const vocalChanged =
      (prevVocal?.id !== nextVocal?.id) ||
      (prevVocal && nextVocal && this._vocalKey(prevVocal) !== this._vocalKey(nextVocal));

    const wasPlaying = this.player.isPlaying;
    const t = this.player.currentTime;

    if (vocalChanged) {
      // Heavy path – process first, then one rebuild
      const buf = await this._ensureProcessedBuffer();
      this.player.setBuffer(buf);
      if (wasPlaying) {
        await this.player.play(t); // single restart at same position
      }
      return;
    }

    // No vocal change – ensure correct base buffer
    if (!nextVocal) {
      this.processedBuffer = null;
      this._lastVocalKey = null;
      if (this.player.buffer !== this.originalBuffer) {
        this.player.setBuffer(this.originalBuffer);
      }
    }

    // Graph structure change (enable/disable live effects) – one rebuild only
    if (wasPlaying) {
      await this.player.rebuild();
    }
  }

  async updateEffectParams(id, params) {
    const e = this.effects.find(x => x.id === id);
    if (!e) return;
    Object.assign(e.params, params);
    this.player.setEffects(this.effects);

    const isVocal = VOCAL_IDS.has(id);
    if (isVocal && e.enabled && (params.intensity !== undefined || params.mode !== undefined)) {
      // Debounced heavy path handled by UI; here process + seamless switch
      this._lastVocalKey = null;
      const wasPlaying = this.player.isPlaying;
      const t = this.player.currentTime;
      const buf = await this._ensureProcessedBuffer();
      this.player.setBuffer(buf);
      if (wasPlaying) await this.player.play(t);
      return;
    }

    // Live AudioParam – no pause
    const live = this.graph.updateParams(id, params);
    if (live) return;

    // Fallback rebuild only if needed
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
    this.player.setSpeed?.(this.speed);
    await this.player.play(offset);
    this._startTrackB(offset ?? this.player.currentTime);
  }

  async loadTrackB(file) {
    const { buffer, meta } = await this.loader.load(file);
    this.trackB.buffer = buffer;
    this.trackB.meta = meta;
    if (this.player.isPlaying) this._startTrackB(this.player.currentTime);
    return meta;
  }

  clearTrackB() {
    this._stopTrackB();
    this.trackB.buffer = null;
    this.trackB.meta = null;
  }

  setTrackGain(track, linear) {
    const g = Math.max(0, Math.min(1.5, linear));
    if (track === 'A') {
      this.trackA.gain = g;
      if (this.graph.masterGain) {
        // masterGain used for A path; apply relative
        const soloB = this.trackB.solo && !this.trackA.solo;
        const mute = this.trackA.mute || soloB;
        this.graph.masterGain.gain.setTargetAtTime(mute ? 0 : g, this.ctxManager.currentTime, 0.03);
      }
    } else {
      this.trackB.gain = g;
      if (this.trackB._gainNode) {
        const soloA = this.trackA.solo && !this.trackB.solo;
        const mute = this.trackB.mute || soloA;
        this.trackB._gainNode.gain.setTargetAtTime(mute ? 0 : g, this.ctxManager.currentTime, 0.03);
      }
    }
  }

  setTrackMute(track, muted) {
    if (track === 'A') this.trackA.mute = !!muted;
    else this.trackB.mute = !!muted;
    this.setTrackGain('A', this.trackA.gain);
    this.setTrackGain('B', this.trackB.gain);
  }

  setTrackSolo(track, solo) {
    if (track === 'A') this.trackA.solo = !!solo;
    else this.trackB.solo = !!solo;
    this.setTrackGain('A', this.trackA.gain);
    this.setTrackGain('B', this.trackB.gain);
  }

  _startTrackB(offset = 0) {
    this._stopTrackB();
    if (!this.trackB.buffer || !this.ctxManager.get()) return;
    const ctx = this.ctxManager.get();
    const src = ctx.createBufferSource();
    src.buffer = this.trackB.buffer;
    src.playbackRate.value = this.speed || 1;
    const g = ctx.createGain();
    const soloA = this.trackA.solo && !this.trackB.solo;
    const mute = this.trackB.mute || soloA;
    g.gain.value = mute ? 0 : this.trackB.gain;
    src.connect(g);
    // Mix into destination via analyser if available
    if (this.graph.analyser) g.connect(this.graph.analyser);
    else g.connect(ctx.destination);
    try {
      src.start(0, Math.max(0, offset));
    } catch (e) {
      console.warn('[TrackB] start', e);
      return;
    }
    this.trackB.source = src;
    this.trackB._gainNode = g;
  }

  _stopTrackB() {
    if (this.trackB.source) {
      try { this.trackB.source.stop(); } catch (_) {}
      try { this.trackB.source.disconnect(); } catch (_) {}
      this.trackB.source = null;
    }
    if (this.trackB._gainNode) {
      try { this.trackB._gainNode.disconnect(); } catch (_) {}
      this.trackB._gainNode = null;
    }
  }


  pause() { this.player.pause(); this._stopTrackB(); }
  stop(reset = true) { this.player.stop(reset); this._stopTrackB(); }
  seek(t) { this.player.seek(t); }

  setSpeed(rate) {
    this.speed = Math.max(0.5, Math.min(2, rate || 1));
    if (this.player.setSpeed) this.player.setSpeed(this.speed);
    else if (this.graph.source) {
      try {
        this.graph.source.playbackRate.setTargetAtTime(
          (this.graph.playbackRate || 1) * this.speed,
          this.ctxManager.currentTime,
          0.05
        );
      } catch (_) {}
    }
  }

  setPreviewMode(mode) {
    this.previewMode = mode;
    this.player.setMode(mode);
    if (this.player.isPlaying) this.player.rebuild();
  }

  get isPlaying() { return this.player.isPlaying; }
  get currentTime() { return this.player.currentTime; }
  get duration() {
    return this.originalBuffer ? this.originalBuffer.duration : 0;
  }

  getAnalyserTimeData() { return this.graph.getAnalyserTimeData(); }
  getAnalyserFreqData() { return this.graph.getAnalyserFreqData(); }


  async processVocalRemoval(params, onProgress) {
    if (!this.originalBuffer) throw new Error('NO_BUFFER');
    const { effectsRegistry } = await import('../effects/index.js');
    const entry = effectsRegistry.vocalRemoval;
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

  setPlaybackSource(which) {
    let buf = this.originalBuffer;
    if (which === 'instrumental' && this.instrumentalBuffer) buf = this.instrumentalBuffer;
    else if (which === 'vocals' && this.vocalsBuffer) buf = this.vocalsBuffer;
    if (!buf) return false;
    const wasPlaying = this.player.isPlaying;
    const t = Math.min(this.player.currentTime, buf.duration);
    this.player.setBuffer(buf);
    if (wasPlaying) this.player.play(t);
    return true;
  }

  clearVocalSeparation() {
    this.instrumentalBuffer = null;
    this.vocalsBuffer = null;
    this.separationMeta = null;
    if (this.originalBuffer) {
      const wasPlaying = this.player.isPlaying;
      const t = this.player.currentTime;
      this.player.setBuffer(this.originalBuffer);
      if (wasPlaying) this.player.play(Math.min(t, this.originalBuffer.duration));
    }
  }

  async export(options, onProgress) {
    if (!this.originalBuffer) throw new Error('NO_BUFFER');
    let rendered = await this.renderer.render(
      this.originalBuffer,
      this.effects,
      onProgress
    );

    // Mix Track B into the final export when present (fixes missing combined output)
    if (this.trackB?.buffer) {
      if (onProgress) onProgress(0.96, 'ترکیب Track A + B...');
      rendered = this._mixTracksForExport(rendered, this.trackB.buffer);
    }

    const fileName = this.meta?.name || 'audio';
    return this.exporter.export(rendered, { ...options, fileName }, onProgress);
  }

  /**
   * Mix rendered Track A with Track B at current gains / mute / solo.
   * Handles different lengths and channel counts. Peak-limited to ~0.98.
   */
  _mixTracksForExport(bufA, bufB) {
    const soloA = this.trackA.solo && !this.trackB.solo;
    const soloB = this.trackB.solo && !this.trackA.solo;
    const muteA = this.trackA.mute || soloB;
    const muteB = this.trackB.mute || soloA;
    const gainA = muteA ? 0 : (this.trackA.gain ?? 1);
    const gainB = muteB ? 0 : (this.trackB.gain ?? 1);

    // If one side is fully muted, return the other (scaled)
    if (gainB < 1e-6 && gainA > 1e-6) {
      return this._scaleBuffer(bufA, gainA);
    }
    if (gainA < 1e-6 && gainB > 1e-6) {
      return this._scaleBuffer(bufB, gainB);
    }
    if (gainA < 1e-6 && gainB < 1e-6) {
      // silence of max length
      const len = Math.max(bufA.length, bufB.length);
      const sr = bufA.sampleRate;
      return new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: sr });
    }

    const sr = bufA.sampleRate;
    const len = Math.max(bufA.length, bufB.length);
    const ch = Math.max(bufA.numberOfChannels, bufB.numberOfChannels, 2);
    const out = new AudioBuffer({ length: len, numberOfChannels: ch, sampleRate: sr });

    const aCh = bufA.numberOfChannels;
    const bCh = bufB.numberOfChannels;
    let peak = 1e-9;

    for (let c = 0; c < ch; c++) {
      const dst = out.getChannelData(c);
      const srcA = bufA.getChannelData(Math.min(c, aCh - 1));
      const srcB = bufB.getChannelData(Math.min(c, bCh - 1));
      const aLen = bufA.length;
      const bLen = bufB.length;
      for (let i = 0; i < len; i++) {
        const va = i < aLen ? srcA[i] * gainA : 0;
        const vb = i < bLen ? srcB[i] * gainB : 0;
        const sum = va + vb;
        dst[i] = sum;
        const a = Math.abs(sum);
        if (a > peak) peak = a;
      }
    }

    if (peak > 0.98) {
      const s = 0.98 / peak;
      for (let c = 0; c < ch; c++) {
        const d = out.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] *= s;
      }
    }
    return out;
  }

  _scaleBuffer(buf, gain) {
    if (Math.abs(gain - 1) < 1e-6) return buf;
    const out = new AudioBuffer({
      length: buf.length,
      numberOfChannels: buf.numberOfChannels,
      sampleRate: buf.sampleRate
    });
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c);
      const dst = out.getChannelData(c);
      for (let i = 0; i < src.length; i++) dst[i] = src[i] * gain;
    }
    return out;
  }

  reset() {
    this.stop(true);
    this.effects = [];
    this.processedBuffer = null;
    this._lastVocalKey = null;
    this.instrumentalBuffer = null;
    this.vocalsBuffer = null;
    this.separationMeta = null;
    this.player.setEffects([]);
    this.player.setBuffer(this.originalBuffer);
    this.previewMode = 'processed';
    this.player.setMode('processed');
    this.speed = 1;
    // Track B (parallel dry mix)
    this.trackB = { buffer: null, meta: null, gain: 1, mute: false, solo: false, source: null };
    this.trackA = { gain: 1, mute: false, solo: false };

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
    return {
      contextState: this.ctxManager.state,
      sampleRate: this.ctxManager.sampleRate,
      channels: this.originalBuffer?.numberOfChannels ?? 0,
      duration: this.duration,
      currentTime: this.currentTime,
      isPlaying: this.isPlaying,
      activeEffects: this.effects.filter(e => e.enabled).map(e => e.id),
      graphChain: (this.graph.chain || []).map(c => c.id),
      playbackRate: this.graph.playbackRate || 1,
      speed: this.speed,
      vocalProcessed: !!this.processedBuffer,
      vocalBusy: this._vocalBusy,
      signalPath: this._describeSignalPath()
    };
  }

  _describeSignalPath() {
    const parts = ['Source'];
    const enabled = this.effects.filter(e => e.enabled);
    if (this.previewMode === 'original' || enabled.length === 0) parts.push('(bypass)');
    else enabled.forEach(e => parts.push(e.id));
    parts.push('MasterGain', 'Analyser', 'Destination');
    return parts.join(' → ');
  }
}
