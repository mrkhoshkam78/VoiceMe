/**
 * Load & decode audio files into AudioBuffer.
 */
import { getFileExtension } from '../utils/helpers.js';

const SUPPORTED = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'webm', 'opus'];

export class AudioLoader {
  constructor(ctxManager) {
    this.ctxManager = ctxManager;
  }

  static isSupported(filename) {
    return SUPPORTED.includes(getFileExtension(filename));
  }

  static supportedList() {
    return [...SUPPORTED];
  }

  async load(file) {
    const ctx = await this.ctxManager.ensure();
    const ext = getFileExtension(file.name);

    if (!SUPPORTED.includes(ext)) {
      throw new Error('UNSUPPORTED_FORMAT');
    }

    let arrayBuffer;
    try {
      arrayBuffer = await file.arrayBuffer();
    } catch {
      throw new Error('READ_FAILED');
    }

    if (!arrayBuffer || arrayBuffer.byteLength === 0) {
      throw new Error('EMPTY_FILE');
    }

    let buffer;
    try {
      // slice(0) creates a copy – required because decodeAudioData may detach
      buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch (err) {
      console.error('[AudioLoader] decode failed', err);
      throw new Error('DECODE_FAILED');
    }

    if (!buffer || buffer.length === 0) {
      throw new Error('DECODE_FAILED');
    }

    return {
      buffer,
      meta: {
        name: file.name,
        size: file.size,
        type: file.type || ext,
        duration: buffer.duration,
        sampleRate: buffer.sampleRate,
        channels: buffer.numberOfChannels
      }
    };
  }
}
