/**
 * Smart AutoTune V1.03
 * - Style presets (pop, traditional, rock, metal, rap)
 * - Auto mode: key/scale detection from audio
 * - Offline pitch correction via autocorrelation + resampling
 * - Real-time: tuned vocal character (EQ + dynamics)
 */
import { createGain, createBiquad } from './baseEffect.js';
import {
  freqToMidi, midiToFreq, SCALES, NOTE_NAMES, clamp
} from '../utils/helpers.js';

export const meta = {
  id: 'autotune',
  name: 'اتوتیون',
  description: 'خطاهای کوک را به نت مناسب نزدیک می‌کند',
  icon: 'autotune',
  category: 'voice',
  defaultParams: {
    style: 'pop',
    autoMode: false,
    key: 'C',
    scale: 'major',
    amount: 0.7,
    retuneSpeed: 0.55,
    humanize: 0.25,
    mix: 0.85,
    formantPreserve: true,
    intensity: 1.0,
    detectedKey: null,
    detectedScale: null,
    confidence: 0
  }
};

export const STYLE_PRESETS = {
  /* V2.5.2 – musical presence/air caps; less harsh stacking */
  pop: {
    label: 'پاپ',
    amount: 0.75,
    retuneSpeed: 0.65,
    humanize: 0.3,
    mix: 0.88,
    formantPreserve: true,
    scale: 'major',
    presenceGain: 2.6,
    airGain: 1.4,
    compRatio: 2.2,
    compAttack: 0.01,
    smoothFrames: 3
  },
  traditional: {
    label: 'سنتی',
    amount: 0.4,
    retuneSpeed: 0.26,
    humanize: 0.6,
    mix: 0.7,
    formantPreserve: true,
    scale: 'minor',
    presenceGain: 1.5,
    airGain: 0.6,
    compRatio: 1.5,
    compAttack: 0.022,
    smoothFrames: 5
  },
  rock: {
    label: 'راک',
    amount: 0.55,
    retuneSpeed: 0.5,
    humanize: 0.35,
    mix: 0.8,
    formantPreserve: true,
    scale: 'minor',
    presenceGain: 3.2,
    airGain: 1.0,
    compRatio: 2.5,
    compAttack: 0.008,
    smoothFrames: 3
  },
  metal: {
    label: 'متال',
    amount: 0.85,
    retuneSpeed: 0.88,
    humanize: 0.12,
    mix: 0.92,
    formantPreserve: false,
    scale: 'minor',
    presenceGain: 4.0,
    airGain: 2.0,
    compRatio: 3.2,
    compAttack: 0.004,
    smoothFrames: 1
  },
  rap: {
    label: 'رپ',
    amount: 0.8,
    retuneSpeed: 0.9,
    humanize: 0.22,
    mix: 0.88,
    formantPreserve: true,
    scale: 'minor',
    presenceGain: 2.8,
    airGain: 0.9,
    compRatio: 2.8,
    compAttack: 0.005,
    smoothFrames: 2
  }
};

const NOTE_INDEX = {};
NOTE_NAMES.forEach((n, i) => { NOTE_INDEX[n] = i; });

function detectPitch(frame, sampleRate, minFreq = 70, maxFreq = 600) {
  const n = frame.length;
  const maxLag = Math.floor(sampleRate / minFreq);
  const minLag = Math.floor(sampleRate / maxFreq);
  if (maxLag >= n) return 0;

  let rms = 0;
  for (let i = 0; i < n; i++) rms += frame[i] * frame[i];
  rms = Math.sqrt(rms / n);
  if (rms < 0.012) return 0;

  let bestLag = 0;
  let bestCorr = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0, norm = 0;
    for (let i = 0; i < n - lag; i++) {
      corr += frame[i] * frame[i + lag];
      norm += frame[i] * frame[i] + frame[i + lag] * frame[i + lag];
    }
    if (norm > 0) corr = (2 * corr) / norm;
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  if (bestCorr < 0.42 || bestLag === 0) return 0;
  return sampleRate / bestLag;
}

function nearestScaleMidi(midi, keyIndex, scaleIntervals) {
  const noteClass = ((Math.round(midi) % 12) + 12) % 12;
  const octave = Math.floor(Math.round(midi) / 12);
  let bestDist = 99;
  let bestMidi = Math.round(midi);
  for (const iv of scaleIntervals) {
    const targetClass = (keyIndex + iv) % 12;
    let dist = Math.abs(noteClass - targetClass);
    if (dist > 6) dist = 12 - dist;
    if (dist < bestDist) {
      bestDist = dist;
      let candidate = octave * 12 + targetClass;
      if (Math.abs(candidate - midi) > Math.abs(candidate + 12 - midi)) candidate += 12;
      if (Math.abs(candidate - midi) > Math.abs(candidate - 12 - midi)) candidate -= 12;
      bestMidi = candidate;
    }
  }
  return bestMidi;
}

/**
 * Detect most likely key & scale from pitch histogram.
 */
/** Cache: avoid re-analyzing same buffer for key/scale */
const _analysisCache = new WeakMap();

export function detectKeyAndScale(audioBuffer) {
  if (!audioBuffer) return { key: 'C', scale: 'major', confidence: 0 };
  const cached = _analysisCache.get(audioBuffer);
  if (cached) return { ...cached };

  const sr = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const channels = audioBuffer.numberOfChannels;
  const mono = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const d = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += d[i] / channels;
  }

  const frameSize = 2048;
  // Adaptive hop: longer files use larger hop for faster analysis
  const hop = audioBuffer.duration > 60 ? 2048 : (audioBuffer.duration > 20 ? 1536 : 1024);
  const hist = new Float32Array(12); // chroma
  let total = 0;

  for (let i = 0; i + frameSize < length; i += hop) {
    const frame = mono.subarray(i, i + frameSize);
    const freq = detectPitch(frame, sr);
    if (freq > 0) {
      const midi = freqToMidi(freq);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      hist[pc] += 1;
      total++;
    }
  }

  if (total < 8) {
    const r = { key: 'C', scale: 'major', confidence: 0 };
    try { _analysisCache.set(audioBuffer, r); } catch (_) {}
    return r;
  }

  // Score each key/scale
  let best = { key: 'C', scale: 'major', score: -1 };
  for (let k = 0; k < 12; k++) {
    for (const [scaleName, intervals] of Object.entries(SCALES)) {
      if (scaleName === 'chromatic') continue;
      let score = 0;
      for (const iv of intervals) {
        score += hist[(k + iv) % 12];
      }
      // penalize out-of-scale
      for (let p = 0; p < 12; p++) {
        if (!intervals.includes((p - k + 12) % 12)) score -= hist[p] * 0.3;
      }
      if (score > best.score) {
        best = { key: NOTE_NAMES[k], scale: scaleName, score };
      }
    }
  }

  const confidence = clamp(best.score / total, 0, 1);
  const result = { key: best.key, scale: best.scale, confidence: Math.round(confidence * 100) };
  try { _analysisCache.set(audioBuffer, result); } catch (_) {}
  return result;
}

export function applyStylePreset(style) {
  const p = STYLE_PRESETS[style] || STYLE_PRESETS.pop;
  return {
    style,
    amount: p.amount,
    retuneSpeed: p.retuneSpeed,
    humanize: p.humanize,
    mix: p.mix,
    formantPreserve: p.formantPreserve,
    scale: p.scale
  };
}

export function createNodes(ctx, params = {}) {
  const amount = (params.amount ?? 0.7) * (params.intensity ?? 1);
  const mix = params.mix ?? 0.85;
  const retune = params.retuneSpeed ?? 0.55;
  const formant = params.formantPreserve !== false;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);
  const dry = createGain(ctx, 1 - mix);
  const wet = createGain(ctx, mix);

  const hp = createBiquad(ctx, 'highpass', 70, 0.7);
  const presence = createBiquad(ctx, 'peaking', 2800, 1.2, 2 + amount * 3.5);
  const air = createBiquad(ctx, 'highshelf', 7000, 1, formant ? 1.2 + amount : 2.5 + amount * 2);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18 - retune * 5;
  comp.knee.value = 8;
  comp.ratio.value = 2.2 + retune * 2.5;
  comp.attack.value = 0.004 + (1 - retune) * 0.02;
  comp.release.value = 0.08 + (1 - retune) * 0.12;

  input.connect(dry);
  dry.connect(output);

  input.connect(hp);
  hp.connect(presence);
  presence.connect(air);
  air.connect(comp);
  comp.connect(wet);
  wet.connect(output);

  return {
    input, output, pitchFactor: 1,
    nodes: [input, dry, wet, hp, presence, air, comp, output],
    update(p) {
      const a = (p.amount ?? amount) * (p.intensity ?? 1);
      const m = p.mix ?? mix;
      const r = p.retuneSpeed ?? retune;
      const form = p.formantPreserve !== false;
      const st = STYLE_PRESETS[p.style] || null;
      dry.gain.setTargetAtTime(1 - m, ctx.currentTime, 0.04);
      wet.gain.setTargetAtTime(m, ctx.currentTime, 0.04);
      presence.gain.setTargetAtTime(
        (st?.presenceGain ?? 2) + a * 2.5, ctx.currentTime, 0.05
      );
      air.gain.setTargetAtTime(
        form ? (st?.airGain ?? 1.2) + a * 0.8 : (st?.airGain ?? 2) + a * 1.5,
        ctx.currentTime, 0.05
      );
      comp.ratio.setTargetAtTime((st?.compRatio ?? 2.2) + r * 1.2, ctx.currentTime, 0.05);
      comp.attack.setTargetAtTime(st?.compAttack ?? (0.004 + (1 - r) * 0.02), ctx.currentTime, 0.05);
    }
  };
}

export async function processOfflineBuffer(audioBuffer, params = {}, onProgress) {
  // Resolve style profile so presets truly change offline correction
  const styleKey = params.style || 'pop';
  const preset = STYLE_PRESETS[styleKey] || STYLE_PRESETS.pop;
  const amount = (params.amount ?? preset.amount ?? 0.7) * (params.intensity ?? 1);
  const humanize = params.humanize ?? preset.humanize ?? 0.25;
  const retuneSpeed = params.retuneSpeed ?? preset.retuneSpeed ?? 0.55;
  const smoothFrames = preset.smoothFrames ?? 3;
  const key = params.key || 'C';
  const scaleName = params.scale || preset.scale || 'major';
  const keyIndex = NOTE_INDEX[key] ?? 0;
  const scaleIntervals = SCALES[scaleName] || SCALES.major;

  const sr = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;

  const mono = new Float32Array(length);
  for (let ch = 0; ch < channels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }

  const frameSize = 2048;
  const hop = 512;
  const numFrames = Math.floor((length - frameSize) / hop);
  const pitches = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    pitches[f] = detectPitch(mono.subarray(f * hop, f * hop + frameSize), sr);
    if (onProgress && f % 50 === 0) onProgress(0.2 * (f / numFrames));
  }

  // Smooth
  // Wider smooth = slower/more natural (traditional); narrow = tight (metal/rap)
  const half = Math.max(1, Math.round(smoothFrames * (1.2 - retuneSpeed * 0.5)));
  const smoothed = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    let sum = 0, cnt = 0;
    for (let k = -half; k <= half; k++) {
      const idx = f + k;
      if (idx >= 0 && idx < numFrames && pitches[idx] > 0) {
        sum += pitches[idx]; cnt++;
      }
    }
    smoothed[f] = cnt > 0 ? sum / cnt : 0;
  }

  const rateMap = new Float32Array(length);
  rateMap.fill(1);

  for (let f = 0; f < numFrames; f++) {
    const freq = smoothed[f];
    if (freq <= 0) continue;
    const midi = freqToMidi(freq);
    const targetMidi = nearestScaleMidi(midi, keyIndex, scaleIntervals);
    const corrected = midi + (targetMidi - midi) * amount * (1 - humanize * 0.4);
    const micro = humanize > 0 ? (Math.random() - 0.5) * humanize * 0.12 : 0;
    const playRate = clamp(freq / midiToFreq(corrected + micro), 0.72, 1.38);
    const start = f * hop;
    const end = Math.min(start + hop, length);
    for (let i = start; i < end; i++) rateMap[i] = playRate;
  }

  if (onProgress) onProgress(0.4);

  const outChannels = [];
  for (let ch = 0; ch < channels; ch++) {
    const src = audioBuffer.getChannelData(ch);
    const out = [];
    let srcPos = 0;
    while (srcPos < length - 1) {
      const idx = Math.min(Math.floor(srcPos), length - 1);
      const rate = rateMap[idx] || 1;
      const i0 = Math.floor(srcPos);
      const i1 = Math.min(i0 + 1, length - 1);
      const frac = srcPos - i0;
      out.push(src[i0] * (1 - frac) + src[i1] * frac);
      srcPos += rate;
    }
    outChannels.push(new Float32Array(out));
    if (onProgress) onProgress(0.4 + 0.55 * ((ch + 1) / channels));
  }

  let minLen = outChannels[0].length;
  for (let ch = 1; ch < channels; ch++) minLen = Math.min(minLen, outChannels[ch].length);

  const outBuffer = new AudioBuffer({ length: minLen, numberOfChannels: channels, sampleRate: sr });
  for (let ch = 0; ch < channels; ch++) {
    outBuffer.copyToChannel(outChannels[ch].subarray(0, minLen), ch);
  }
  if (onProgress) onProgress(1);
  return outBuffer;
}
