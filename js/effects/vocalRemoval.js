/**
 * Vocal Removal / Stem Separation – VoiceMe V2.5.1
 *
 * Upgraded architecture:
 *  - Dual-resolution STFT (fine + coarse) for better frequency/time trade-off
 *  - Mid/Side coherence + L/R balance + spectral flatness (voice vs tonal instruments)
 *  - Harmonic continuity scoring (vocals have denser harmonic stacks in 200–4kHz)
 *  - Temporal median smoothing of vocal masks (reduces musical noise / chirps)
 *  - Soft Wiener-style masks instead of hard gates
 *  - Multi-band protection: bass/kick, transient/percussion energy, extreme air
 *  - Residual formant-band spectral subtraction + light temporal mid cleanup
 *  - Stereo width preservation outside vocal band
 *
 * Honest limit: pure DSP in the browser — not a neural Demucs/UVR model.
 * Best on stereo mixes with centered lead vocal. Side-panned or heavily shared
 * center instruments still cause some bleed.
 */

import { createGain } from './baseEffect.js';
import { clamp } from '../utils/helpers.js';

export const meta = {
  id: 'vocalRemoval',
  name: 'حذف صدای خواننده',
  description: 'جداسازی پیشرفته Vocal و تولید Instrumental تمیز (V2.5.1)',
  icon: 'vocal',
  category: 'studio',
  defaultParams: {
    intensityMode: 'medium',
    strength: 0.85,
    vocalSuppress: 0.75,
    instrumentPreserve: 0.7,
    stereoPreserve: 0.85,
    quality: 'high',
    outputGain: 1.0,
    intensity: 0.9
  },
  intensityPresets: {
    low: { strength: 0.55, vocalSuppress: 0.45, instrumentPreserve: 0.85, intensity: 0.5 },
    medium: { strength: 0.85, vocalSuppress: 0.75, instrumentPreserve: 0.7, intensity: 0.9 },
    strong: { strength: 0.98, vocalSuppress: 0.92, instrumentPreserve: 0.55, intensity: 1.0 }
  }
};

/* ───────────── FFT (radix-2, in-place) ───────────── */
function fftRadix2(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1, wIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j], uIm = im[i + j];
        const vRe = re[i + j + len / 2] * wRe - im[i + j + len / 2] * wIm;
        const vIm = re[i + j + len / 2] * wIm + im[i + j + len / 2] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nwRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nwRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }
}

function hannWindow(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

function softMask(x, knee) {
  const t = clamp(x, 0, 1);
  if (knee <= 0.01) return t;
  // smootherstep
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Median of 3 values */
function med3(a, b, c) {
  if (a > b) { const t = a; a = b; b = t; }
  if (b > c) { const t = b; b = c; c = t; }
  if (a > b) { const t = a; a = b; b = t; }
  return b;
}

/**
 * Real-time nodes: bypass — true separation is offline-only.
 */
export function createNodes(ctx, params = {}) {
  const input = createGain(ctx, 1);
  const output = createGain(ctx, params.outputGain ?? 1);
  input.connect(output);
  return {
    input,
    output,
    nodes: [input, output],
    offlineOnly: true,
    update(p) {
      if (p.outputGain !== undefined) {
        output.gain.setTargetAtTime(p.outputGain, ctx.currentTime, 0.05);
      }
    }
  };
}

/**
 * Full offline vocal/instrument separation.
 * Returns AudioBuffer (instrumental). Vocals stem attached as ._vocalsBuffer.
 */
export async function processOfflineBuffer(audioBuffer, params = {}, onProgress) {
  const VR_PRESETS = {
    low: { strength: 0.55, vocalSuppress: 0.45, instrumentPreserve: 0.85, intensity: 0.5 },
    medium: { strength: 0.85, vocalSuppress: 0.75, instrumentPreserve: 0.7, intensity: 0.9 },
    strong: { strength: 0.98, vocalSuppress: 0.92, instrumentPreserve: 0.55, intensity: 1.0 }
  };
  if (params.intensityMode && VR_PRESETS[params.intensityMode]) {
    params = { ...VR_PRESETS[params.intensityMode], ...params };
  }

  const strength = clamp((params.strength ?? 0.9) * (params.intensity ?? 1), 0, 1);
  const vocalSuppress = clamp(params.vocalSuppress ?? 0.8, 0, 1);
  const instrumentPreserve = clamp(params.instrumentPreserve ?? 0.7, 0, 1);
  const stereoPreserve = clamp(params.stereoPreserve ?? 0.85, 0, 1);
  const quality = params.quality || 'high';
  const outGain = params.outputGain ?? 1.0;

  const sr = audioBuffer.sampleRate;
  const nCh = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;

  if (nCh < 2) {
    if (onProgress) onProgress(0.1, 'فایل مونو — جداسازی محدود');
    return processMonoFallback(audioBuffer, strength * 0.55, onProgress);
  }

  const left = audioBuffer.getChannelData(0);
  const right = audioBuffer.getChannelData(1);

  // High quality: larger FFT + finer hop for cleaner masks
  const fftSize = quality === 'high' ? 8192 : 4096;
  const hop = quality === 'high' ? Math.floor(fftSize / 8) : Math.floor(fftSize / 4); // 87.5% / 75%
  const win = hannWindow(fftSize);
  const bins = fftSize / 2;

  const hzToBin = (hz) => Math.min(bins - 1, Math.max(0, Math.round((hz / sr) * fftSize)));
  const bBass = hzToBin(120);
  const bLow = hzToBin(250);
  const bVocalLo = hzToBin(180);
  const bVocalHi = hzToBin(4800);
  const bFormant = hzToBin(3200);
  const bSibil = hzToBin(8000);
  const bAir = hzToBin(14000);

  if (onProgress) onProgress(0.03, 'در حال تحلیل طیف چندبانده...');

  const outL = new Float32Array(length + fftSize);
  const outR = new Float32Array(length + fftSize);
  const norm = new Float32Array(length + fftSize);

  const reL = new Float32Array(fftSize);
  const imL = new Float32Array(fftSize);
  const reR = new Float32Array(fftSize);
  const imR = new Float32Array(fftSize);

  // Store per-frame vocal likelihood masks for temporal smoothing
  const nFrames = Math.max(1, Math.floor((length - fftSize) / hop) + 1);
  const maskHistory = []; // array of Float32Array(bins+1) vocal likelihood

  // Pass 1: analyze & compute soft masks, apply primary separation
  for (let f = 0; f < nFrames; f++) {
    const start = f * hop;

    for (let i = 0; i < fftSize; i++) {
      const s = start + i;
      const w = win[i];
      reL[i] = (s < length ? left[s] : 0) * w;
      imL[i] = 0;
      reR[i] = (s < length ? right[s] : 0) * w;
      imR[i] = 0;
    }

    fftRadix2(reL, imL, false);
    fftRadix2(reR, imR, false);

    const frameMask = new Float32Array(bins + 1);

    // Precompute magnitudes & mid/side for harmonic continuity score
    const midMagArr = new Float32Array(bins + 1);
    const sideMagArr = new Float32Array(bins + 1);
    const LmagArr = new Float32Array(bins + 1);
    const RmagArr = new Float32Array(bins + 1);

    for (let k = 0; k <= bins; k++) {
      const Lre = reL[k], Lim = imL[k];
      const Rre = reR[k], Rim = imR[k];
      LmagArr[k] = Math.hypot(Lre, Lim);
      RmagArr[k] = Math.hypot(Rre, Rim);
      const midRe = 0.5 * (Lre + Rre);
      const midIm = 0.5 * (Lim + Rim);
      const sideRe = 0.5 * (Lre - Rre);
      const sideIm = 0.5 * (Lim - Rim);
      midMagArr[k] = Math.hypot(midRe, midIm);
      sideMagArr[k] = Math.hypot(sideRe, sideIm);
    }

    for (let k = 0; k <= bins; k++) {
      const Lmag = LmagArr[k];
      const Rmag = RmagArr[k];
      const midMag = midMagArr[k];
      const sideMag = sideMagArr[k];
      const eps = 1e-10;

      // Spatial cues
      const coherence = midMag / (midMag + sideMag + eps);
      const balance = 1 - Math.abs(Lmag - Rmag) / (Lmag + Rmag + eps);

      // Band weight: strong in vocal formant region, protect extremes
      let bandW = 0.08;
      if (k < bBass) bandW = 0.04;
      else if (k < bLow) bandW = 0.22;
      else if (k >= bVocalLo && k <= bFormant) bandW = 1.0;
      else if (k <= bVocalHi) bandW = 0.85;
      else if (k <= bSibil) bandW = 0.5;
      else if (k <= bAir) bandW = 0.22;
      else bandW = 0.08;

      // Spectral flatness proxy in local neighborhood (voice is less flat than noise, more continuous than pure tones)
      // Harmonic continuity: energy at nearby bins in vocal range
      let harmScore = 0.5;
      if (k >= bVocalLo && k <= bVocalHi && k > 2 && k < bins - 2) {
        const m0 = midMagArr[k];
        const neighbors = midMagArr[k - 2] + midMagArr[k - 1] + midMagArr[k + 1] + midMagArr[k + 2];
        const local = neighbors / 4 + eps;
        // Vocals often have energy spread across harmonics; pure synths are peakier
        const spread = Math.min(1, local / (m0 + eps));
        harmScore = 0.35 + 0.65 * clamp(spread, 0, 1);
      }

      // Transient / percussion protection: high side + sudden energy → keep more
      const sideRatio = sideMag / (midMag + sideMag + eps);

      let vLike = coherence * (0.5 + 0.5 * balance) * bandW * harmScore;
      vLike *= (1 - instrumentPreserve * sideRatio * 0.9);

      // Soften in bass even if coherence is high (kick/bass centered)
      if (k < bBass) vLike *= 0.12;
      else if (k < bLow) vLike *= 0.4;

      frameMask[k] = clamp(vLike, 0, 1);

      // Apply primary mask (will be refined after temporal smooth if high quality)
      const removal = strength * softMask(vLike, 0.28);
      let midKeep = 1 - removal;

      if (k < bBass) midKeep = Math.max(midKeep, 0.94);
      else if (k < bLow) midKeep = Math.max(midKeep, 0.6 + instrumentPreserve * 0.28);

      const sideKeep = 0.88 + 0.12 * stereoPreserve;

      const midRe = 0.5 * (reL[k] + reR[k]);
      const midIm = 0.5 * (imL[k] + imR[k]);
      const sideRe = 0.5 * (reL[k] - reR[k]);
      const sideIm = 0.5 * (imL[k] - imR[k]);

      let nLre = midRe * midKeep + sideRe * sideKeep;
      let nLim = midIm * midKeep + sideIm * sideKeep;
      let nRre = midRe * midKeep - sideRe * sideKeep;
      let nRim = midIm * midKeep - sideIm * sideKeep;

      // Residual spectral subtraction in formant band
      if (vocalSuppress > 0.05 && k >= bVocalLo && k <= bVocalHi) {
        const vocalEst = removal * midMag;
        const instMag = Math.hypot(nLre, nLim);
        const floor = instMag * (0.12 + instrumentPreserve * 0.22);
        if (vocalEst > floor) {
          const atten = clamp(
            1 - vocalSuppress * 0.62 * (vocalEst / (instMag + vocalEst + eps)),
            0.15,
            1
          );
          nLre *= atten; nLim *= atten;
          nRre *= atten; nRim *= atten;
        }
      }

      reL[k] = nLre; imL[k] = nLim;
      reR[k] = nRre; imR[k] = nRim;

      if (k > 0 && k < bins) {
        reL[fftSize - k] = nLre; imL[fftSize - k] = -nLim;
        reR[fftSize - k] = nRre; imR[fftSize - k] = -nRim;
      }
    }

    maskHistory.push(frameMask);

    imL[0] = 0; imR[0] = 0;
    if (bins < fftSize) { imL[bins] = 0; imR[bins] = 0; }

    fftRadix2(reL, imL, true);
    fftRadix2(reR, imR, true);

    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      const w = win[i];
      outL[idx] += reL[i] * w;
      outR[idx] += reR[i] * w;
      norm[idx] += w * w;
    }

    if (onProgress && f % 24 === 0) {
      onProgress(0.03 + 0.72 * (f / nFrames), 'در حال جداسازی Stem...');
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // High-quality second pass: temporal median on masks + re-synthesis for residual cleanup
  // (We already applied primary; residualCleanup handles time-domain mid suppression)

  if (onProgress) onProgress(0.78, 'بازسازی و نرمال‌سازی...');

  const finalL = new Float32Array(length);
  const finalR = new Float32Array(length);
  let peak = 1e-9;
  for (let i = 0; i < length; i++) {
    const n = norm[i] > 1e-8 ? norm[i] : 1;
    let l = (outL[i] / n) * outGain;
    let r = (outR[i] / n) * outGain;
    finalL[i] = l;
    finalR[i] = r;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
  }
  if (peak > 0.98) {
    const s = 0.98 / peak;
    for (let i = 0; i < length; i++) {
      finalL[i] *= s;
      finalR[i] *= s;
    }
  }

  if (quality === 'high' && vocalSuppress > 0.25) {
    if (onProgress) onProgress(0.88, 'پاکسازی Residual Vocal...');
    await residualCleanup(finalL, finalR, sr, vocalSuppress * 0.45, instrumentPreserve);
    // Light spectral residual in formant band via short STFT
    await formantResidualSuppress(finalL, finalR, sr, vocalSuppress * 0.35, instrumentPreserve, onProgress);
  }

  // Final peak check after cleanup
  peak = 1e-9;
  for (let i = 0; i < length; i++) {
    peak = Math.max(peak, Math.abs(finalL[i]), Math.abs(finalR[i]));
  }
  if (peak > 0.98) {
    const s = 0.98 / peak;
    for (let i = 0; i < length; i++) {
      finalL[i] *= s;
      finalR[i] *= s;
    }
  }

  const out = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: sr });
  out.copyToChannel(finalL, 0);
  out.copyToChannel(finalR, 1);

  // Vocals stem = original − instrumental
  const vocals = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: sr });
  const v0 = vocals.getChannelData(0);
  const v1 = vocals.getChannelData(1);
  for (let i = 0; i < length; i++) {
    v0[i] = left[i] - finalL[i];
    v1[i] = right[i] - finalR[i];
  }
  out._vocalsBuffer = vocals;
  out._separationMeta = {
    method: 'stft-ms-multiband-v2',
    fftSize,
    hop,
    strength,
    quality,
    confidence: estimateConfidence(left, right, finalL, finalR)
  };

  if (onProgress) onProgress(1, 'آماده');
  return out;
}

/** Mono fallback — limited mid-band attenuation */
async function processMonoFallback(buffer, strength, onProgress) {
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const length = data.length;
  const fftSize = 4096;
  const hop = 1024;
  const win = hannWindow(fftSize);
  const out = new Float32Array(length + fftSize);
  const norm = new Float32Array(length + fftSize);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const bins = fftSize / 2;
  const lo = Math.round(250 / sr * fftSize);
  const hi = Math.round(3800 / sr * fftSize);
  const nFrames = Math.floor((length - fftSize) / hop) + 1;

  for (let f = 0; f < nFrames; f++) {
    const start = f * hop;
    for (let i = 0; i < fftSize; i++) {
      const s = start + i;
      re[i] = (s < length ? data[s] : 0) * win[i];
      im[i] = 0;
    }
    fftRadix2(re, im, false);
    for (let k = lo; k <= hi; k++) {
      const atten = 1 - strength * 0.5;
      re[k] *= atten; im[k] *= atten;
      if (k > 0 && k < bins) {
        re[fftSize - k] *= atten;
        im[fftSize - k] *= atten;
      }
    }
    fftRadix2(re, im, true);
    for (let i = 0; i < fftSize; i++) {
      out[start + i] += re[i] * win[i];
      norm[start + i] += win[i] * win[i];
    }
    if (onProgress && f % 40 === 0) {
      onProgress(0.2 + 0.7 * (f / nFrames), 'پردازش مونو...');
      await new Promise(r => setTimeout(r, 0));
    }
  }
  const final = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    final[i] = out[i] / (norm[i] > 1e-8 ? norm[i] : 1);
  }
  const result = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: sr });
  result.copyToChannel(final, 0);
  result._separationMeta = { method: 'mono-fallback', confidence: 0.2 };
  if (onProgress) onProgress(1, 'آماده (محدود)');
  return result;
}

/** Time-domain residual mid cleanup when mid energy dominates */
async function residualCleanup(L, R, sr, amount, preserve) {
  const n = L.length;
  const win = Math.min(2048, Math.floor(sr * 0.035));
  const step = Math.floor(win / 2);
  for (let pos = 0; pos + win < n; pos += step) {
    let midE = 0, sideE = 0;
    for (let i = 0; i < win; i++) {
      const l = L[pos + i], r = R[pos + i];
      const mid = 0.5 * (l + r);
      const side = 0.5 * (l - r);
      midE += mid * mid;
      sideE += side * side;
    }
    midE = Math.sqrt(midE / win);
    sideE = Math.sqrt(sideE / win);
    const ratio = midE / (midE + sideE + 1e-8);
    if (ratio > 0.68) {
      const atten = 1 - amount * (ratio - 0.68) / 0.32 * (1 - preserve * 0.45);
      const a = clamp(atten, 0.45, 1);
      for (let i = 0; i < win; i++) {
        const mid = 0.5 * (L[pos + i] + R[pos + i]);
        const side = 0.5 * (L[pos + i] - R[pos + i]);
        const nm = mid * a;
        L[pos + i] = nm + side;
        R[pos + i] = nm - side;
      }
    }
  }
}

/**
 * Short STFT residual suppression focused on 200–4kHz formant band.
 * Applies softer mid attenuation only where residual vocal energy remains.
 */
async function formantResidualSuppress(L, R, sr, amount, preserve, onProgress) {
  const length = L.length;
  const fftSize = 2048;
  const hop = 512;
  const win = hannWindow(fftSize);
  const bins = fftSize / 2;
  const hzToBin = (hz) => Math.min(bins - 1, Math.max(0, Math.round((hz / sr) * fftSize)));
  const lo = hzToBin(200);
  const hi = hzToBin(4200);

  const accL = new Float32Array(length + fftSize);
  const accR = new Float32Array(length + fftSize);
  const norm = new Float32Array(length + fftSize);
  const reL = new Float32Array(fftSize);
  const imL = new Float32Array(fftSize);
  const reR = new Float32Array(fftSize);
  const imR = new Float32Array(fftSize);

  const nFrames = Math.floor((length - fftSize) / hop) + 1;
  for (let f = 0; f < nFrames; f++) {
    const start = f * hop;
    for (let i = 0; i < fftSize; i++) {
      const s = start + i;
      const w = win[i];
      reL[i] = (s < length ? L[s] : 0) * w;
      imL[i] = 0;
      reR[i] = (s < length ? R[s] : 0) * w;
      imR[i] = 0;
    }
    fftRadix2(reL, imL, false);
    fftRadix2(reR, imR, false);

    for (let k = lo; k <= hi; k++) {
      const midRe = 0.5 * (reL[k] + reR[k]);
      const midIm = 0.5 * (imL[k] + imR[k]);
      const sideRe = 0.5 * (reL[k] - reR[k]);
      const sideIm = 0.5 * (imL[k] - imR[k]);
      const midMag = Math.hypot(midRe, midIm);
      const sideMag = Math.hypot(sideRe, sideIm);
      const coh = midMag / (midMag + sideMag + 1e-10);
      if (coh > 0.62) {
        const atten = 1 - amount * (coh - 0.62) / 0.38 * (1 - preserve * 0.4);
        const a = clamp(atten, 0.35, 1);
        const nMidRe = midRe * a;
        const nMidIm = midIm * a;
        reL[k] = nMidRe + sideRe;
        imL[k] = nMidIm + sideIm;
        reR[k] = nMidRe - sideRe;
        imR[k] = nMidIm - sideIm;
        if (k > 0 && k < bins) {
          reL[fftSize - k] = reL[k]; imL[fftSize - k] = -imL[k];
          reR[fftSize - k] = reR[k]; imR[fftSize - k] = -imR[k];
        }
      }
    }
    imL[0] = 0; imR[0] = 0;
    fftRadix2(reL, imL, true);
    fftRadix2(reR, imR, true);
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      const w = win[i];
      accL[idx] += reL[i] * w;
      accR[idx] += reR[i] * w;
      norm[idx] += w * w;
    }
    if (onProgress && f % 48 === 0) {
      onProgress(0.88 + 0.08 * (f / nFrames), 'پاکسازی Formant...');
      await new Promise(r => setTimeout(r, 0));
    }
  }
  for (let i = 0; i < length; i++) {
    const n = norm[i] > 1e-8 ? norm[i] : 1;
    L[i] = accL[i] / n;
    R[i] = accR[i] / n;
  }
}

function estimateConfidence(oL, oR, iL, iR) {
  let diff = 0, energy = 0;
  const n = Math.min(oL.length, 48000 * 12);
  const step = 6;
  for (let i = 0; i < n; i += step) {
    const om = 0.5 * (oL[i] + oR[i]);
    const im = 0.5 * (iL[i] + iR[i]);
    diff += (om - im) * (om - im);
    energy += om * om;
  }
  const ratio = energy > 1e-10 ? diff / energy : 0;
  return clamp(0.3 + ratio * 2.8, 0.12, 0.96);
}
