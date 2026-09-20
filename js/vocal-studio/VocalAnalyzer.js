/**
 * Stage 1 — Vocal Analysis & Diagnosis
 * Real signal measurements only — no gender/style guessing as fact.
 */
import { clamp } from '../utils/helpers.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function freqToMidi(f) {
  return 69 + 12 * Math.log2(f / 440);
}

function detectPitchAC(frame, sr, minF = 70, maxF = 900) {
  const n = frame.length;
  const maxLag = Math.min(Math.floor(sr / minF), n - 1);
  const minLag = Math.floor(sr / maxF);
  if (maxLag <= minLag) return { freq: 0, conf: 0 };

  let rms = 0;
  for (let i = 0; i < n; i++) rms += frame[i] * frame[i];
  rms = Math.sqrt(rms / n);
  if (rms < 0.008) return { freq: 0, conf: 0 };

  let bestLag = 0, bestCorr = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0, e1 = 0, e2 = 0;
    const lim = n - lag;
    for (let i = 0; i < lim; i++) {
      corr += frame[i] * frame[i + lag];
      e1 += frame[i] * frame[i];
      e2 += frame[i + lag] * frame[i + lag];
    }
    const norm = Math.sqrt(e1 * e2) + 1e-12;
    const c = corr / norm;
    if (c > bestCorr) { bestCorr = c; bestLag = lag; }
  }
  if (bestCorr < 0.4 || !bestLag) return { freq: 0, conf: 0 };
  return { freq: sr / bestLag, conf: clamp(bestCorr, 0, 1) };
}

function yieldToUI() {
  return new Promise(r => setTimeout(r, 0));
}

/**
 * @param {AudioBuffer} buffer
 * @param {object} meta - optional file meta { name, sampleRate, channels }
 * @param {function} onProgress - (0..1, label)
 */
export async function analyzeVocal(buffer, meta = {}, onProgress) {
  if (!buffer || !buffer.length) {
    throw new Error('INVALID_BUFFER');
  }

  const sr = buffer.sampleRate;
  const nCh = buffer.numberOfChannels;
  const length = buffer.length;
  const duration = buffer.duration;

  if (onProgress) onProgress(0.02, 'آماده‌سازی سیگنال...');

  // Mono mix for analysis
  const mono = new Float32Array(length);
  for (let c = 0; c < nCh; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += d[i] / nCh;
  }

  // ── Loudness / dynamics ──
  let peak = 0, sumSq = 0, clipCount = 0;
  const clipThresh = 0.99;
  for (let i = 0; i < length; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
    sumSq += mono[i] * mono[i];
    if (a >= clipThresh) clipCount++;
  }
  const rms = Math.sqrt(sumSq / length) || 1e-10;
  const peakDb = 20 * Math.log10(peak + 1e-12);
  const rmsDb = 20 * Math.log10(rms + 1e-12);
  // Approximate integrated loudness (not full ITU-R BS.1770, but useful relative)
  const lufsApprox = rmsDb - 0.691; // rough offset toward LUFS scale
  const crestDb = peakDb - rmsDb; // dynamic range proxy
  const clipRatio = clipCount / length;

  if (onProgress) onProgress(0.12, 'تحلیل بلندی و داینامیک...');
  await yieldToUI();

  // ── Silence / noise floor ──
  const frameSize = 2048;
  const hop = 1024;
  const energies = [];
  for (let i = 0; i + frameSize < length; i += hop) {
    let e = 0;
    for (let j = 0; j < frameSize; j++) e += mono[i + j] * mono[i + j];
    energies.push(Math.sqrt(e / frameSize));
  }
  const sortedE = [...energies].sort((a, b) => a - b);
  const noiseFloor = sortedE[Math.floor(sortedE.length * 0.08)] || 0.001;
  const noiseFloorDb = 20 * Math.log10(noiseFloor + 1e-12);
  const silenceThresh = Math.max(noiseFloor * 3, 0.005);
  let silentFrames = 0;
  for (const e of energies) if (e < silenceThresh) silentFrames++;
  const silenceRatio = silentFrames / Math.max(1, energies.length);

  if (onProgress) onProgress(0.25, 'تحلیل Pitch...');
  await yieldToUI();

  // ── Pitch analysis ──
  const pitches = [];
  const pitchConfs = [];
  const pitchHop = duration > 90 ? 3072 : (duration > 30 ? 2048 : 1536);
  const pitchFrame = 2048;
  for (let i = 0; i + pitchFrame < length; i += pitchHop) {
    const { freq, conf } = detectPitchAC(mono.subarray(i, i + pitchFrame), sr);
    if (freq > 0 && conf > 0.45) {
      pitches.push(freq);
      pitchConfs.push(conf);
    }
    if (onProgress && pitches.length % 40 === 0) {
      onProgress(0.25 + 0.25 * (i / length), 'تحلیل Pitch...');
      await yieldToUI();
    }
  }

  let pitchMean = 0, pitchStd = 0, pitchMin = 0, pitchMax = 0;
  let outOfTuneRatio = 0;
  let estimatedRange = null;
  let pitchStability = 0;

  if (pitches.length >= 6) {
    pitchMean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
    let varSum = 0;
    pitchMin = Math.min(...pitches);
    pitchMax = Math.max(...pitches);
    for (const f of pitches) varSum += (f - pitchMean) ** 2;
    pitchStd = Math.sqrt(varSum / pitches.length);

    // Out-of-tune: distance from nearest semitone
    let outCount = 0;
    for (const f of pitches) {
      const midi = freqToMidi(f);
      const nearest = Math.round(midi);
      const cents = Math.abs(midi - nearest) * 100;
      if (cents > 25) outCount++;
    }
    outOfTuneRatio = outCount / pitches.length;

    // Stability: inverse of relative pitch variance in voiced regions
    const relStd = pitchStd / (pitchMean + 1e-6);
    pitchStability = clamp(1 - relStd * 4, 0, 1);

    // Range label — descriptive only, NOT gender claim
    if (pitchMean < 165) estimatedRange = { label: 'محدوده پایین‌تر', note: 'میانگین فرکانس پایین — ممکن است وکال بم یا مردانه باشد', confidence: 0.45 };
    else if (pitchMean < 255) estimatedRange = { label: 'محدوده میانی', note: 'میانگین در باند میانی — جنسیت/سبک قطعی نیست', confidence: 0.35 };
    else estimatedRange = { label: 'محدوده بالاتر', note: 'میانگین فرکانس بالاتر — ممکن است وکال زیر یا زنانه باشد', confidence: 0.45 };
  }

  if (onProgress) onProgress(0.55, 'تحلیل طیفی (Mud / Harsh / Sibilance)...');
  await yieldToUI();

  // ── Spectral bands (simple energy ratios via time-domain filters approximation) ──
  // Use short STFT-like band energy via zero-crossing + band RMS on filtered sections
  const bandEnergies = estimateBandEnergies(mono, sr);
  const totalBand = Object.values(bandEnergies).reduce((a, b) => a + b, 0) + 1e-12;
  const mudRatio = bandEnergies.mud / totalBand;
  const harshRatio = bandEnergies.harsh / totalBand;
  const sibilanceRatio = bandEnergies.sibilance / totalBand;
  const breathRatio = bandEnergies.air / totalBand;
  const presenceRatio = bandEnergies.presence / totalBand;

  if (onProgress) onProgress(0.7, 'تحلیل استریو و فاز...');
  await yieldToUI();

  // ── Stereo / phase ──
  let stereoWidth = 0, phaseIssue = false, midSideRatio = 0.5;
  if (nCh >= 2) {
    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);
    let midE = 0, sideE = 0, corr = 0, eL = 0, eR = 0;
    const step = Math.max(1, Math.floor(length / 200000));
    for (let i = 0; i < length; i += step) {
      const mid = 0.5 * (L[i] + R[i]);
      const side = 0.5 * (L[i] - R[i]);
      midE += mid * mid;
      sideE += side * side;
      corr += L[i] * R[i];
      eL += L[i] * L[i];
      eR += R[i] * R[i];
    }
    midSideRatio = midE / (midE + sideE + 1e-12);
    stereoWidth = clamp(sideE / (midE + 1e-12), 0, 2);
    const correlation = corr / (Math.sqrt(eL * eR) + 1e-12);
    phaseIssue = correlation < -0.15;
  }

  // Background music / layered vocal heuristic
  // High side energy + dense spectrum in non-vocal bands → possible mix (not dry vocal)
  const possibleBackgroundMusic = nCh >= 2 && stereoWidth > 0.35 && mudRatio > 0.12 && presenceRatio < 0.25;
  const possibleLayeredVocal = pitches.length > 20 && pitchStd / (pitchMean + 1) > 0.25 && midSideRatio > 0.7;

  if (onProgress) onProgress(0.85, 'تولید گزارش تشخیصی...');
  await yieldToUI();

  // ── Issues with severity 0..1 ──
  const issues = [];

  if (clipRatio > 0.0005 || peak >= 0.99) {
    issues.push({ id: 'clipping', name: 'Clipping', severity: clamp(clipRatio * 500 + (peak >= 0.99 ? 0.6 : 0), 0, 1), detail: `Peak ${peakDb.toFixed(1)} dBFS` });
  }
  if (noiseFloorDb > -45 || (silenceRatio < 0.05 && noiseFloorDb > -50)) {
    issues.push({ id: 'noise', name: 'نویز پس‌زمینه', severity: clamp((noiseFloorDb + 60) / 30, 0.15, 1), detail: `کف نویز ~${noiseFloorDb.toFixed(0)} dB` });
  }
  if (outOfTuneRatio > 0.12) {
    issues.push({ id: 'pitch', name: 'نت‌های خارج از کوک', severity: clamp(outOfTuneRatio * 1.4, 0.2, 1), detail: `${Math.round(outOfTuneRatio * 100)}٪ فریم‌های دارای انحراف >25 cent` });
  }
  if (pitchStability < 0.45 && pitches.length >= 6) {
    issues.push({ id: 'pitchStability', name: 'ناپایداری Pitch', severity: clamp(1 - pitchStability, 0.2, 1), detail: `پایداری ${(pitchStability * 100).toFixed(0)}٪` });
  }
  if (sibilanceRatio > 0.14) {
    issues.push({ id: 'sibilance', name: 'Sibilance تیز', severity: clamp((sibilanceRatio - 0.1) * 5, 0.2, 1), detail: 'انرژی بالا در باند 5–10 kHz' });
  }
  if (breathRatio > 0.18 && silenceRatio > 0.08) {
    issues.push({ id: 'breath', name: 'نفس اضافه', severity: clamp(breathRatio * 2.5, 0.15, 0.9), detail: 'انرژی هوایی در سکوت/بین عبارات' });
  }
  if (mudRatio > 0.22) {
    issues.push({ id: 'mud', name: 'Mud / گل‌آلودگی', severity: clamp((mudRatio - 0.15) * 4, 0.2, 1), detail: 'انرژی زیاد در 150–350 Hz' });
  }
  if (harshRatio > 0.16) {
    issues.push({ id: 'harsh', name: 'Harshness', severity: clamp((harshRatio - 0.1) * 5, 0.2, 1), detail: 'انرژی زیاد در 2.5–5 kHz' });
  }
  if (crestDb < 6 && peak > 0.3) {
    issues.push({ id: 'overcompressed', name: 'داینامیک فشرده', severity: clamp((8 - crestDb) / 8, 0.2, 0.85), detail: `Crest ~${crestDb.toFixed(1)} dB` });
  }
  if (crestDb > 22 && rmsDb < -28) {
    issues.push({ id: 'tooQuiet', name: 'صدای خیلی آرام / داینامیک زیاد', severity: clamp((crestDb - 18) / 15, 0.2, 0.9), detail: `RMS ${rmsDb.toFixed(1)} dB` });
  }
  if (phaseIssue) {
    issues.push({ id: 'phase', name: 'مشکل فاز استریو', severity: 0.55, detail: 'همبستگی منفی بین L/R' });
  }
  if (possibleBackgroundMusic) {
    issues.push({ id: 'backgroundMix', name: 'احتمال موسیقی پس‌زمینه', severity: 0.4, detail: 'سیگنال شبیه میکس کامل است نه وکال خشک', confidence: 0.5 });
  }

  // Suggested processing (adaptive)
  const suggestions = buildSuggestions(issues, {
    peakDb, rmsDb, crestDb, outOfTuneRatio, pitchStability,
    sibilanceRatio, mudRatio, harshRatio, noiseFloorDb, nCh
  });

  // Overall confidence of analysis quality
  const analysisConfidence = clamp(
    0.35 +
    (pitches.length >= 10 ? 0.25 : pitches.length * 0.02) +
    (duration > 3 ? 0.15 : duration * 0.05) +
    (length > sr ? 0.15 : 0.05),
    0.2, 0.95
  );

  if (onProgress) onProgress(1, 'تحلیل کامل شد');

  return {
    stage: 1,
    meta: {
      name: meta.name || 'audio',
      sampleRate: sr,
      channels: nCh,
      duration,
      length,
      bitDepth: meta.bitDepth || null // browser decode usually float32; original bit depth often unavailable
    },
    loudness: {
      peak,
      peakDb: +peakDb.toFixed(2),
      rms,
      rmsDb: +rmsDb.toFixed(2),
      lufsApprox: +lufsApprox.toFixed(1),
      crestDb: +crestDb.toFixed(2),
      clipRatio,
      clipCount
    },
    noise: {
      noiseFloor,
      noiseFloorDb: +noiseFloorDb.toFixed(1),
      silenceRatio: +silenceRatio.toFixed(3)
    },
    pitch: {
      sampleCount: pitches.length,
      meanHz: pitches.length ? +pitchMean.toFixed(1) : null,
      stdHz: pitches.length ? +pitchStd.toFixed(1) : null,
      minHz: pitches.length ? +pitchMin.toFixed(1) : null,
      maxHz: pitches.length ? +pitchMax.toFixed(1) : null,
      outOfTuneRatio: +outOfTuneRatio.toFixed(3),
      stability: +pitchStability.toFixed(3),
      estimatedRange // NOT definitive gender
    },
    spectral: {
      mudRatio: +mudRatio.toFixed(3),
      harshRatio: +harshRatio.toFixed(3),
      sibilanceRatio: +sibilanceRatio.toFixed(3),
      breathRatio: +breathRatio.toFixed(3),
      presenceRatio: +presenceRatio.toFixed(3)
    },
    stereo: {
      channels: nCh,
      width: +stereoWidth.toFixed(3),
      midSideRatio: +midSideRatio.toFixed(3),
      phaseIssue,
      possibleBackgroundMusic,
      possibleLayeredVocal
    },
    issues,
    suggestions,
    analysisConfidence: +analysisConfidence.toFixed(2),
    timestamp: Date.now()
  };
}

/** Lightweight band energy via multi-rate downsampling + RMS (no full FFT cost) */
function estimateBandEnergies(mono, sr) {
  // Approximate band energies using simple resonant-ish accumulators
  // Bands: mud 150-350, presence 2-4k, harsh 3-5k, sibilance 5-10k, air 8-16k
  const bands = { mud: 0, presence: 0, harsh: 0, sibilance: 0, air: 0, low: 0 };
  const n = mono.length;
  // One-pole filters approximate
  let lp200 = 0, lp400 = 0, lp2k = 0, lp5k = 0, lp10k = 0;
  const a200 = Math.exp(-2 * Math.PI * 250 / sr);
  const a400 = Math.exp(-2 * Math.PI * 400 / sr);
  const a2k = Math.exp(-2 * Math.PI * 2500 / sr);
  const a5k = Math.exp(-2 * Math.PI * 5000 / sr);
  const a10k = Math.exp(-2 * Math.PI * 10000 / sr);

  const step = Math.max(1, Math.floor(n / 300000));
  let count = 0;
  for (let i = 0; i < n; i += step) {
    const x = mono[i];
    lp200 = a200 * lp200 + (1 - a200) * x;
    lp400 = a400 * lp400 + (1 - a400) * x;
    lp2k = a2k * lp2k + (1 - a2k) * x;
    lp5k = a5k * lp5k + (1 - a5k) * x;
    lp10k = a10k * lp10k + (1 - a10k) * x;
    const mud = lp400 - lp200;
    const presence = lp2k - lp400 * 0.3;
    const harsh = lp5k - lp2k;
    const sib = lp10k - lp5k;
    const air = x - lp10k;
    bands.mud += mud * mud;
    bands.presence += presence * presence;
    bands.harsh += harsh * harsh;
    bands.sibilance += sib * sib;
    bands.air += air * air;
    bands.low += lp200 * lp200;
    count++;
  }
  for (const k of Object.keys(bands)) bands[k] = Math.sqrt(bands[k] / (count || 1));
  return bands;
}

function buildSuggestions(issues, m) {
  const s = [];
  const has = (id) => issues.find(i => i.id === id);

  if (has('noise')) {
    s.push({ effect: 'noiseReduction', reason: 'کف نویز بالا', params: { strength: clamp(0.4 + (has('noise').severity) * 0.4, 0.35, 0.85), sensitivity: 0.45, intensity: 0.7 } });
  }
  if (has('pitch') || has('pitchStability')) {
    const sev = (has('pitch')?.severity || 0) * 0.7 + (has('pitchStability')?.severity || 0) * 0.3;
    s.push({
      effect: 'autotune',
      reason: 'انحراف کوک / ناپایداری',
      params: {
        amount: clamp(0.45 + sev * 0.4, 0.4, 0.88),
        retuneSpeed: clamp(0.35 + sev * 0.4, 0.3, 0.85),
        humanize: clamp(0.45 - sev * 0.25, 0.12, 0.55),
        mix: 0.85,
        style: 'pop'
      }
    });
  }
  if (has('sibilance') || has('breath')) {
    s.push({
      effect: 'breathSibilance',
      reason: 'سیبیلانس یا نفس اضافه',
      params: {
        amount: clamp(0.45 + (has('sibilance')?.severity || 0) * 0.35, 0.4, 0.85),
        sibilance: has('sibilance') ? clamp(0.55 + has('sibilance').severity * 0.35, 0.5, 0.9) : 0.4,
        breath: has('breath') ? clamp(0.4 + has('breath').severity * 0.4, 0.35, 0.8) : 0.25,
        sensitivity: 0.5,
        freq: 6800
      }
    });
  }
  if (has('mud') || has('harsh') || has('tooQuiet') || has('overcompressed')) {
    s.push({
      effect: 'improveQuality',
      reason: 'اصلاح طیفی / وضوح',
      params: {
        intensity: clamp(0.45 + (has('mud')?.severity || 0) * 0.3, 0.4, 0.8),
        clarity: clamp(0.5 + (has('harsh')?.severity || 0) * 0.3, 0.45, 0.85),
        warmth: has('mud') ? 0.25 : 0.4
      }
    });
  }
  if (has('clipping')) {
    s.push({ effect: 'volume', reason: 'کاهش سطح برای جلوگیری از کلیپ', params: { gain: 0.85 } });
  }
  // Gentle studio polish if mostly clean
  if (issues.length <= 2 && m.rmsDb > -35) {
    s.push({ effect: 'studio', reason: 'پولیش ملایم استودیویی', params: { roomSize: 0.35, wet: 0.18, intensity: 0.45 } });
  } else if (!has('backgroundMix')) {
    s.push({ effect: 'studio', reason: 'فضای کنترل‌شده وکال', params: { roomSize: 0.4, wet: 0.22, intensity: 0.5 } });
  }

  return s;
}
