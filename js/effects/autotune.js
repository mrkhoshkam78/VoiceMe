/**
 * AutoTune V1.02 – pitch detection (autocorrelation) + correction via rate + mild formant EQ
 *
 * Strategy:
 * - Real-time path: applies a mild "tuned" character (EQ + compression) and a global
 *   pitch bias derived from average detected pitch vs target key when possible.
 * - For strong correction the offline render path uses frame-based pitch detection
 *   and per-frame resampling toward nearest scale note.
 *
 * Limitations are documented; architecture is modular for future AudioWorklet upgrade.
 */

import { createGain, createBiquad } from './baseEffect.js';
import { freqToMidi, midiToFreq, SCALES, clamp, resampleLinear } from '../utils/helpers.js';

export const meta = {
  id: 'autotune',
  name: 'اتوتیون',
  description: 'تصحیح Pitch برای صدا و آواز',
  icon: 'autotune',
  category: 'voice',
  defaultParams: {
    key: 'C',
    scale: 'major',
    amount: 0.7,        // 0–1 correction strength
    retuneSpeed: 0.55,  // 0=slow/natural, 1=fast/hard
    humanize: 0.25,     // 0–1
    mix: 0.85           // wet/dry
  }
};

const NOTE_INDEX = { C:0, 'C#':1, D:2, 'D#':3, E:4, F:5, 'F#':6, G:7, 'G#':8, A:9, 'A#':10, B:11 };

/**
 * Autocorrelation pitch detector (simple YIN-inspired)
 */
function detectPitch(frame, sampleRate, minFreq = 70, maxFreq = 600) {
  const n = frame.length;
  const maxLag = Math.floor(sampleRate / minFreq);
  const minLag = Math.floor(sampleRate / maxFreq);
  if (maxLag >= n) return 0;

  // RMS energy gate
  let rms = 0;
  for (let i = 0; i < n; i++) rms += frame[i] * frame[i];
  rms = Math.sqrt(rms / n);
  if (rms < 0.01) return 0;

  let bestLag = 0;
  let bestCorr = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let norm = 0;
    for (let i = 0; i < n - lag; i++) {
      corr += frame[i] * frame[i + lag];
      norm += frame[i] * frame[i] + frame[i + lag] * frame[i + lag];
    }
    if (norm > 0) corr = (2 * corr) / norm;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }
  if (bestCorr < 0.4 || bestLag === 0) return 0;
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
      // choose octave closest to original
      let candidate = octave * 12 + targetClass;
      if (Math.abs(candidate - midi) > Math.abs(candidate + 12 - midi)) candidate += 12;
      if (Math.abs(candidate - midi) > Math.abs(candidate - 12 - midi)) candidate -= 12;
      bestMidi = candidate;
    }
  }
  return bestMidi;
}

/**
 * Real-time nodes: character processing + wet/dry.
 * Strong pitch correction happens in offline path; live path gives audible "tuned" feel.
 */
export function createNodes(ctx, params = {}) {
  const amount = params.amount ?? 0.7;
  const mix = params.mix ?? 0.85;
  const retune = params.retuneSpeed ?? 0.55;

  const input = createGain(ctx, 1);
  const output = createGain(ctx, 1);
  const dry = createGain(ctx, 1 - mix);
  const wet = createGain(ctx, mix);

  // Pre-emphasis / presence that mimics tuned vocal chain
  const hp = createBiquad(ctx, 'highpass', 70, 0.7);
  const presence = createBiquad(ctx, 'peaking', 2800, 1.2, 2 + amount * 4);
  const air = createBiquad(ctx, 'highshelf', 7000, 1, 1.5 + amount * 2);

  // Mild compression – tighter when retune is fast
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18 - retune * 6;
  comp.knee.value = 8;
  comp.ratio.value = 2.5 + retune * 3;
  comp.attack.value = 0.005 + (1 - retune) * 0.02;
  comp.release.value = 0.08 + (1 - retune) * 0.15;

  // Slight pitch bias is applied at BufferSource level when average pitch is known.
  // For live we keep pitchFactor ≈ 1; offline does the heavy lifting.
  const pitchFactor = 1;

  input.connect(dry);
  dry.connect(output);

  input.connect(hp);
  hp.connect(presence);
  presence.connect(air);
  air.connect(comp);
  comp.connect(wet);
  wet.connect(output);

  return {
    input, output, pitchFactor,
    nodes: [input, dry, wet, hp, presence, air, comp, output],
    update(p) {
      if (p.mix !== undefined) {
        dry.gain.setTargetAtTime(1 - p.mix, ctx.currentTime, 0.04);
        wet.gain.setTargetAtTime(p.mix, ctx.currentTime, 0.04);
      }
    }
  };
}

/**
 * Offline frame-based pitch correction.
 * Returns a new AudioBuffer with corrected pitch.
 */
export async function processOfflineBuffer(audioBuffer, params = {}, onProgress) {
  const amount = params.amount ?? 0.7;
  const humanize = params.humanize ?? 0.25;
  const key = params.key || 'C';
  const scaleName = params.scale || 'major';
  const keyIndex = NOTE_INDEX[key] ?? 0;
  const scaleIntervals = SCALES[scaleName] || SCALES.major;

  const sr = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;

  // Work on mono mix for detection
  const mono = new Float32Array(length);
  for (let ch = 0; ch < channels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
  }

  const frameSize = 2048;
  const hop = 512;
  const numFrames = Math.floor((length - frameSize) / hop);

  // Detect pitch per frame
  const pitches = new Float32Array(numFrames);
  for (let f = 0; f < numFrames; f++) {
    const start = f * hop;
    const frame = mono.subarray(start, start + frameSize);
    pitches[f] = detectPitch(frame, sr);
    if (onProgress && f % 40 === 0) onProgress(0.15 * (f / numFrames));
  }

  // Smooth pitch contour
  const smoothed = new Float32Array(numFrames);
  const smoothWin = 3;
  for (let f = 0; f < numFrames; f++) {
    let sum = 0, cnt = 0;
    for (let k = -smoothWin; k <= smoothWin; k++) {
      const idx = f + k;
      if (idx >= 0 && idx < numFrames && pitches[idx] > 0) {
        sum += pitches[idx];
        cnt++;
      }
    }
    smoothed[f] = cnt > 0 ? sum / cnt : 0;
  }

  // Build per-sample rate map
  const rateMap = new Float32Array(length);
  rateMap.fill(1);

  for (let f = 0; f < numFrames; f++) {
    const freq = smoothed[f];
    if (freq <= 0) continue;
    const midi = freqToMidi(freq);
    const targetMidi = nearestScaleMidi(midi, keyIndex, scaleIntervals);

    // Humanize: leave some of the original deviation
    const correctedMidi = midi + (targetMidi - midi) * amount * (1 - humanize * 0.5);
    // Extra random micro-variation for humanize
    const micro = humanize > 0 ? (Math.random() - 0.5) * humanize * 0.15 : 0;
    const finalMidi = correctedMidi + micro;
    const ratio = freq / midiToFreq(finalMidi); // >1 means we need to slow down to raise pitch? 
    // ratio = sourceFreq / targetFreq → playbackRate to apply to this region
    // If source is higher than target, rate < 1 to lower pitch.
    const playRate = clamp(freq / midiToFreq(finalMidi), 0.7, 1.4);

    const start = f * hop;
    const end = Math.min(start + hop, length);
    for (let i = start; i < end; i++) rateMap[i] = playRate;
  }

  if (onProgress) onProgress(0.35);

  // Resample each channel according to rate map (variable rate – approximate with block resampling)
  const outChannels = [];
  for (let ch = 0; ch < channels; ch++) {
    const src = audioBuffer.getChannelData(ch);
    // Collect output samples by walking through with variable rate
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
    if (onProgress) onProgress(0.35 + 0.5 * ((ch + 1) / channels));
  }

  // Align lengths
  let minLen = outChannels[0].length;
  for (let ch = 1; ch < channels; ch++) minLen = Math.min(minLen, outChannels[ch].length);

  const outBuffer = new AudioBuffer({
    length: minLen,
    numberOfChannels: channels,
    sampleRate: sr
  });
  for (let ch = 0; ch < channels; ch++) {
    outBuffer.copyToChannel(outChannels[ch].subarray(0, minLen), ch);
  }

  if (onProgress) onProgress(1);
  return outBuffer;
}
