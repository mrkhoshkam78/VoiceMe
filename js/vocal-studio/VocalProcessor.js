/**
 * Stage 2 — Intelligent Vocal Processing
 * Adaptive DSP chain driven by Stage 1 diagnosis.
 * Uses existing effect offline processors + live-node offline render where needed.
 * Records every step: params, reason, delta, success.
 */
import { effectsRegistry } from '../effects/index.js';
import { clamp } from '../utils/helpers.js';

const HEADROOM = 0.92;

function limitPeaks(buffer, target = HEADROOM) {
  const ch = buffer.numberOfChannels;
  let peak = 0;
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  if (peak < 1e-6 || peak <= target) return buffer;
  const scale = target / peak;
  const out = new AudioBuffer({ length: buffer.length, numberOfChannels: ch, sampleRate: buffer.sampleRate });
  for (let c = 0; c < ch; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) dst[i] = src[i] * scale;
  }
  return out;
}

function measurePeakRms(buffer) {
  let peak = 0, sum = 0, n = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      sum += d[i] * d[i];
      n++;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  return {
    peak,
    peakDb: 20 * Math.log10(peak + 1e-12),
    rms,
    rmsDb: 20 * Math.log10(rms + 1e-12)
  };
}

/** Style → processing bias */
const STYLE_BIAS = {
  pop: { autotuneAmount: 0.72, reverbWet: 0.24, deess: 0.65, humanize: 0.28 },
  traditional: { autotuneAmount: 0.38, reverbWet: 0.3, deess: 0.45, humanize: 0.55 },
  rock: { autotuneAmount: 0.55, reverbWet: 0.2, deess: 0.55, humanize: 0.32 },
  metal: { autotuneAmount: 0.82, reverbWet: 0.15, deess: 0.7, humanize: 0.12 },
  rap: { autotuneAmount: 0.78, reverbWet: 0.12, deess: 0.75, humanize: 0.2 },
  ballad: { autotuneAmount: 0.48, reverbWet: 0.35, deess: 0.5, humanize: 0.42 },
  natural: { autotuneAmount: 0.35, reverbWet: 0.15, deess: 0.5, humanize: 0.5 }
};

/**
 * Build adaptive effect list from diagnosis + user options.
 * @param {object} diagnosis - Stage 1 report
 * @param {object} options - { style, intensity 0..1, naturalness 0..1 }
 */
export function planProcessing(diagnosis, options = {}) {
  const style = options.style || 'pop';
  const intensity = clamp(options.intensity ?? 0.7, 0, 1);
  const naturalness = clamp(options.naturalness ?? 0.6, 0, 1);
  const bias = STYLE_BIAS[style] || STYLE_BIAS.pop;

  const steps = [];
  const issues = diagnosis?.issues || [];
  const has = (id) => issues.find(i => i.id === id);
  const sug = diagnosis?.suggestions || [];

  // 1) Noise first if needed
  const noiseSug = sug.find(s => s.effect === 'noiseReduction');
  if (noiseSug || has('noise')) {
    const p = { ...(noiseSug?.params || { strength: 0.5, sensitivity: 0.45, intensity: 0.65 }) };
    p.strength = clamp(p.strength * (0.7 + intensity * 0.4), 0.25, 0.9);
    steps.push({ id: 'noiseReduction', reason: noiseSug?.reason || 'کاهش نویز', params: p, offline: true });
  }

  // 2) Pitch correction if needed
  const pitchSug = sug.find(s => s.effect === 'autotune');
  if (pitchSug || has('pitch') || has('pitchStability')) {
    const p = { ...(pitchSug?.params || {}) };
    p.amount = clamp((p.amount ?? bias.autotuneAmount) * (0.6 + intensity * 0.5) * (1.15 - naturalness * 0.35), 0.25, 0.92);
    p.humanize = clamp((p.humanize ?? bias.humanize) * (0.7 + naturalness * 0.5), 0.1, 0.65);
    p.retuneSpeed = clamp(p.retuneSpeed ?? 0.5, 0.2, 0.9);
    p.mix = clamp(0.75 + intensity * 0.15, 0.7, 0.95);
    p.style = style === 'traditional' ? 'traditional' : (style === 'rap' ? 'rap' : (style === 'metal' ? 'metal' : 'pop'));
    p.key = options.key || diagnosis?.detectedKey || 'C';
    p.scale = options.scale || 'major';
    steps.push({ id: 'autotune', reason: pitchSug?.reason || 'اصلاح کوک تطبیقی', params: p, offline: true });
  }

  // 3) De-ess / breath
  const sibSug = sug.find(s => s.effect === 'breathSibilance');
  if (sibSug || has('sibilance') || has('breath')) {
    const p = { ...(sibSug?.params || { amount: 0.55, sibilance: 0.6, breath: 0.35, sensitivity: 0.5, freq: 6800 }) };
    p.amount = clamp(p.amount * (0.75 + intensity * 0.35), 0.3, 0.9);
    p.sibilance = clamp((p.sibilance ?? bias.deess) * (0.8 + intensity * 0.3), 0.3, 0.92);
    steps.push({ id: 'breathSibilance', reason: sibSug?.reason || 'کنترل سیبیلانس/نفس', params: p, offline: false });
  }

  // 4) Corrective EQ
  const iqSug = sug.find(s => s.effect === 'improveQuality');
  if (iqSug || has('mud') || has('harsh')) {
    const p = { ...(iqSug?.params || { intensity: 0.55, clarity: 0.55, warmth: 0.35 }) };
    p.intensity = clamp(p.intensity * (0.7 + intensity * 0.4), 0.3, 0.85);
    steps.push({ id: 'improveQuality', reason: iqSug?.reason || 'EQ اصلاحی', params: p, offline: false });
  }

  // 5) Level
  if (has('clipping') || (diagnosis?.loudness?.peakDb > -0.5)) {
    steps.push({ id: 'volume', reason: 'کاهش Gain برای جلوگیری از کلیپ', params: { gain: 0.88 }, offline: false });
  } else if (diagnosis?.loudness?.rmsDb < -28) {
    steps.push({ id: 'volume', reason: 'افزایش ملایم سطح وکال', params: { gain: clamp(1.1 + intensity * 0.15, 1.05, 1.35) }, offline: false });
  }

  // 6) Space (style-dependent) — skip heavy reverb if background mix suspected
  if (!has('backgroundMix')) {
    const wet = clamp(bias.reverbWet * (0.7 + intensity * 0.5) * (1.1 - naturalness * 0.3), 0.08, 0.4);
    steps.push({
      id: 'studio',
      reason: 'فضا و پولیش استودیویی متناسب با سبک',
      params: { roomSize: clamp(0.3 + wet, 0.25, 0.65), wet, intensity: clamp(0.4 + intensity * 0.35, 0.35, 0.75) },
      offline: false
    });
  }

  return {
    style,
    intensity,
    naturalness,
    steps,
    note: 'پردازش وکال — این مسترینگ کامل میکس نیست'
  };
}

/**
 * Execute processing plan on AudioBuffer.
 * @returns {{ buffer, log, plan }}
 */
export async function processVocal(buffer, diagnosis, options = {}, onProgress) {
  const plan = planProcessing(diagnosis, options);
  const log = [];
  let working = buffer;
  const total = Math.max(1, plan.steps.length);

  if (onProgress) onProgress(0.02, 'شروع پردازش تطبیقی...');

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const entry = effectsRegistry[step.id];
    const before = measurePeakRms(working);
    let success = false;
    let error = null;

    if (onProgress) {
      onProgress(0.05 + (i / total) * 0.85, `اعمال ${step.id}...`);
    }

    try {
      if (entry?.processOfflineBuffer && step.offline) {
        working = await entry.processOfflineBuffer(working, step.params, (p, label) => {
          if (onProgress) onProgress(0.05 + ((i + p * 0.9) / total) * 0.85, label || step.id);
        });
        working = limitPeaks(working, HEADROOM);
        success = true;
      } else if (entry?.createNodes) {
        // Offline render single effect via OfflineAudioContext
        working = await renderEffectOffline(working, step.id, step.params);
        working = limitPeaks(working, HEADROOM);
        success = true;
      } else {
        error = 'EFFECT_UNAVAILABLE';
      }
    } catch (err) {
      error = (err && err.message) || 'PROCESS_FAIL';
      console.error('[VocalProcessor]', step.id, err);
    }

    const after = measurePeakRms(working);
    log.push({
      id: step.id,
      reason: step.reason,
      params: { ...step.params },
      success,
      error,
      before: { peakDb: +before.peakDb.toFixed(2), rmsDb: +before.rmsDb.toFixed(2) },
      after: { peakDb: +after.peakDb.toFixed(2), rmsDb: +after.rmsDb.toFixed(2) },
      deltaRmsDb: +(after.rmsDb - before.rmsDb).toFixed(2)
    });

    await new Promise(r => setTimeout(r, 0));
  }

  // Final gentle headroom
  working = limitPeaks(working, 0.95);

  if (onProgress) onProgress(1, 'پردازش کامل شد');

  return {
    buffer: working,
    plan,
    log,
    disclaimer: 'این خروجی پردازش وکال است، نه مسترینگ کامل آهنگ.'
  };
}

async function renderEffectOffline(buffer, effectId, params) {
  const { createEffectNodes } = await import('../effects/index.js');
  const sr = buffer.sampleRate;
  const ch = buffer.numberOfChannels;
  const frames = buffer.length;
  const offline = new OfflineAudioContext(ch, frames, sr);
  const src = offline.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = 1;

  const nodes = createEffectNodes(offline, effectId, params);
  src.connect(nodes.input);
  nodes.output.connect(offline.destination);
  src.start(0);
  return offline.startRendering();
}
