/**
 * Manages AudioContext lifecycle – critical for Chrome autoplay policy.
 */
export class AudioContextManager {
  constructor() {
    this.ctx = null;
  }

  async ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (e) {
        console.warn('[AudioContext] resume failed', e);
      }
    }
    return this.ctx;
  }

  get() {
    return this.ctx;
  }

  get state() {
    return this.ctx ? this.ctx.state : 'none';
  }

  get sampleRate() {
    return this.ctx ? this.ctx.sampleRate : 0;
  }

  get currentTime() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  async close() {
    if (this.ctx) {
      try { await this.ctx.close(); } catch (_) {}
      this.ctx = null;
    }
  }
}
