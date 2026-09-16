/**
 * Export rendered AudioBuffer to various formats.
 * WAV: pure JS PCM encoder (always available)
 * WebM/OGG: via MediaRecorder when supported by browser
 * MP3: not available without external encoder – we do not fake it
 */
import { audioBufferToWav, downloadBlob } from '../utils/helpers.js';

export class AudioExporter {
  /**
   * @param {AudioBuffer} buffer
   * @param {object} options { format, sampleRate, channels, bitrate, fileName }
   * @param {function} onProgress
   */
  async export(buffer, options = {}, onProgress) {
    const format = (options.format || 'wav').toLowerCase();
    const baseName = (options.fileName || 'audio').replace(/\.[^/.]+$/, '');
    const channels = options.channels || buffer.numberOfChannels;
    const targetRate = options.sampleRate || buffer.sampleRate;

    if (onProgress) onProgress(0.1, 'آماده‌سازی خروجی...');

    // Channel conversion
    let work = buffer;
    if (channels === 1 && buffer.numberOfChannels > 1) {
      work = this._toMono(buffer);
    }

    // Sample rate conversion (simple if needed)
    if (targetRate !== work.sampleRate) {
      work = this._resample(work, targetRate);
    }

    if (format === 'wav') {
      if (onProgress) onProgress(0.6, 'ساخت فایل WAV...');
      const blob = audioBufferToWav(work);
      const name = `${baseName}_edited.wav`;
      downloadBlob(blob, name);
      if (onProgress) onProgress(1, 'دانلود شد');
      return name;
    }

    if (format === 'webm' || format === 'ogg') {
      if (onProgress) onProgress(0.3, 'رمزگذاری با MediaRecorder...');
      const mime = format === 'ogg' ? 'audio/ogg' : 'audio/webm';
      const supported = MediaRecorder.isTypeSupported(mime) ||
        MediaRecorder.isTypeSupported(mime + ';codecs=opus');
      if (!supported) {
        // fallback to wav
        const blob = audioBufferToWav(work);
        const name = `${baseName}_edited.wav`;
        downloadBlob(blob, name);
        if (onProgress) onProgress(1, 'دانلود شد (WAV – مرورگر از این فرمت پشتیبانی نکرد)');
        return name;
      }
      const blob = await this._recordBuffer(work, mime, options.bitrate);
      const ext = format === 'ogg' ? 'ogg' : 'webm';
      const name = `${baseName}_edited.${ext}`;
      downloadBlob(blob, name);
      if (onProgress) onProgress(1, 'دانلود شد');
      return name;
    }

    // Unknown → wav
    const blob = audioBufferToWav(work);
    const name = `${baseName}_edited.wav`;
    downloadBlob(blob, name);
    if (onProgress) onProgress(1, 'دانلود شد');
    return name;
  }

  _toMono(buffer) {
    const len = buffer.length;
    const mono = new AudioBuffer({ length: len, numberOfChannels: 1, sampleRate: buffer.sampleRate });
    const out = mono.getChannelData(0);
    const chs = buffer.numberOfChannels;
    for (let i = 0; i < len; i++) {
      let sum = 0;
      for (let c = 0; c < chs; c++) sum += buffer.getChannelData(c)[i];
      out[i] = sum / chs;
    }
    return mono;
  }

  _resample(buffer, targetRate) {
    const ratio = buffer.sampleRate / targetRate;
    const newLen = Math.floor(buffer.length / ratio);
    const out = new AudioBuffer({
      length: newLen,
      numberOfChannels: buffer.numberOfChannels,
      sampleRate: targetRate
    });
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c);
      const dst = out.getChannelData(c);
      for (let i = 0; i < newLen; i++) {
        const srcPos = i * ratio;
        const i0 = Math.floor(srcPos);
        const i1 = Math.min(i0 + 1, src.length - 1);
        const frac = srcPos - i0;
        dst[i] = src[i0] * (1 - frac) + src[i1] * frac;
      }
    }
    return out;
  }

  async _recordBuffer(buffer, mimeType, bitrate) {
    const ctx = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );
    // Play through a real AudioContext + MediaStreamDestination for MediaRecorder
    const live = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: buffer.sampleRate });
    const dest = live.createMediaStreamDestination();
    const src = live.createBufferSource();
    src.buffer = buffer;
    src.connect(dest);
    // also silence to speakers
    const silent = live.createGain();
    silent.gain.value = 0;
    src.connect(silent);
    silent.connect(live.destination);

    const opts = { mimeType };
    if (bitrate) opts.audioBitsPerSecond = bitrate * 1000;

    let recorder;
    try {
      recorder = new MediaRecorder(dest.stream, opts);
    } catch {
      recorder = new MediaRecorder(dest.stream);
    }

    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

    const done = new Promise(resolve => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    });

    recorder.start(100);
    src.start(0);
    await new Promise(r => { src.onended = r; });
    // small pad
    await new Promise(r => setTimeout(r, 150));
    recorder.stop();
    const blob = await done;
    await live.close();
    return blob;
  }

  static availableFormats() {
    const list = [{ id: 'wav', label: 'WAV (بدون فشرده‌سازی)' }];
    if (typeof MediaRecorder !== 'undefined') {
      if (MediaRecorder.isTypeSupported('audio/webm') || MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        list.push({ id: 'webm', label: 'WebM (Opus)' });
      }
      if (MediaRecorder.isTypeSupported('audio/ogg') || MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        list.push({ id: 'ogg', label: 'OGG (Opus)' });
      }
    }
    return list;
  }
}
