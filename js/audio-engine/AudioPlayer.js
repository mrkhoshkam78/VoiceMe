/**
 * Playback control – handles Chrome autoplay, BufferSource lifecycle, seek sync.
 *
 * BufferSourceNode can only be started ONCE. After stop/end we must rebuild.
 * CurrentTime is always in SOURCE buffer coordinates (0 … duration).
 */
import { clamp } from '../utils/helpers.js';

export class AudioPlayer {
  constructor(ctxManager, graph) {
    this.ctxManager = ctxManager;
    this.graph = graph;

    this.buffer = null;
    this.effects = [];
    this.mode = 'processed';

    this.isPlaying = false;
    this.pauseOffset = 0;       // position in source buffer
    this.startCtxTime = 0;      // ctx.currentTime when started
    this.rate = 1;
    this._endedHandler = null;
    this._raf = null;
    this._seeking = false;

    this.onTimeUpdate = null;
    this.onEnded = null;
    this.onStateChange = null;
  }

  setBuffer(buffer) {
    this.stop(true);
    this.buffer = buffer;
  }

  setEffects(effects) {
    this.effects = effects;
  }

  setMode(mode) {
    this.mode = mode;
  }

  get duration() {
    return this.buffer ? this.buffer.duration : 0;
  }

  /**
   * Source-buffer position, accounting for playbackRate.
   */
  get currentTime() {
    if (!this.isPlaying) return this.pauseOffset;
    const elapsed = this.ctxManager.currentTime - this.startCtxTime;
    return clamp(this.pauseOffset + elapsed * this.rate, 0, this.duration);
  }

  async play(fromOffset = null) {
    if (!this.buffer) return;

    // CRITICAL for Chrome: resume AudioContext on user gesture
    await this.ctxManager.ensure();

    const offset = fromOffset !== null
      ? clamp(fromOffset, 0, this.duration)
      : this.pauseOffset;

    this.pauseOffset = offset;
    this._seeking = false;

    // Always rebuild – BufferSource is one-shot
    const built = this.graph.build(this.buffer, this.effects, this.mode);
    if (!built || !built.source) {
      console.error('[AudioPlayer] graph build failed');
      return;
    }

    this.rate = built.playbackRate;
    const source = built.source;

    const remaining = (this.duration - offset) / this.rate;

    this._endedHandler = () => {
      if (this.isPlaying && !this._seeking) {
        this.isPlaying = false;
        this.pauseOffset = 0;
        this._stopRaf();
        if (this.onEnded) this.onEnded();
        if (this.onStateChange) this.onStateChange('stopped');
      }
    };
    source.onended = this._endedHandler;

    try {
      source.start(0, offset);
      // Safety stop so onended fires even with rate changes
      if (remaining > 0.05 && isFinite(remaining)) {
        source.stop(this.ctxManager.currentTime + remaining + 0.08);
      }
    } catch (err) {
      console.error('[AudioPlayer] start error', err);
      this.isPlaying = false;
      return;
    }

    this.startCtxTime = this.ctxManager.currentTime;
    this.isPlaying = true;
    this._startRaf();
    if (this.onStateChange) this.onStateChange('playing');
  }

  pause() {
    if (!this.isPlaying) return;
    this.pauseOffset = this.currentTime;
    this._seeking = true;
    this._stopSource();
    this.isPlaying = false;
    this._stopRaf();
    if (this.onStateChange) this.onStateChange('paused');
  }

  stop(reset = true) {
    this._seeking = true;
    this._stopSource();
    this.isPlaying = false;
    this._stopRaf();
    if (reset) this.pauseOffset = 0;
    if (this.onStateChange) this.onStateChange('stopped');
  }

  seek(time) {
    const t = clamp(time, 0, this.duration);
    const wasPlaying = this.isPlaying;
    this.pauseOffset = t;
    if (wasPlaying) {
      this.play(t);
    } else if (this.onTimeUpdate) {
      this.onTimeUpdate(t);
    }
  }

  /**
   * Rebuild graph while playing (e.g. effect toggle).
   */
  async rebuild() {
    if (this.isPlaying) {
      const t = this.currentTime;
      await this.play(t);
    }
  }

  _stopSource() {
    if (this.graph.source) {
      try { this.graph.source.onended = null; } catch (_) {}
      try { this.graph.source.stop(); } catch (_) {}
      try { this.graph.source.disconnect(); } catch (_) {}
      this.graph.source = null;
    }
  }

  _startRaf() {
    this._stopRaf();
    const tick = () => {
      if (!this.isPlaying) return;
      const t = this.currentTime;
      if (t >= this.duration - 0.03) {
        this.isPlaying = false;
        this.pauseOffset = 0;
        this._stopRaf();
        if (this.onEnded) this.onEnded();
        if (this.onStateChange) this.onStateChange('stopped');
        return;
      }
      if (this.onTimeUpdate) this.onTimeUpdate(t);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _stopRaf() {
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }
}
