/**
 * Stage 2 — Intelligent Vocal Processing (V2.6.1)
 * Conservative adaptive chain — avoids warble, over-reverb, over-NR.
 * Offline AutoTune only when pitch severity is meaningful; always soft.
 */
import { effectsRegistry } from '../effects/index.js';
import { clamp } from '../utils/helpers.js';

const HEADROOM = 0.94;

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

/** Style bias — soft defaults for natural, pro vocal polish */
const STYLE_BIAS = {
  pop: { autotuneAmount: 0.42, reverbWet: 0.16, deess: 0.55, humanize: 0.4 },
  traditional: { autotuneAmount: 0.28, reverbWet: 0.2, deess: 0.4, humanize: 0.55 },
  rock: { autotuneAmount: 0.38, reverbWet: 0.12, deess: 0.5, humanize: 0.35 },
  metal: { autotuneAmount: 0.55, reverbWet: 0.1, deess: 0.6, humanize: 0.2 },
  rap: { autotuneAmount: 0.5, reverbWet: 0.08, deess: 0.65, humanize: 0.25 },
  ballad: { autotuneAmount: 0.32, reverbWet: 0.22, deess: 0.45, humanize: 0.48 },
  natural: { autotuneAmount: 0.22, reverbWet: 0.1, deess: 0.4, humanize: 0.55 }
};

export function planProcessing(diagnosis, options = {}) {
  const style = options.style || 'pop';
  const intensity = clamp(options.intensity ?? 0.65, 0, 1);
  const naturalness = clamp(options.naturalness ?? 0.7, 0, 1);
  const bias = STYLE_BIAS[style] || STYLE_BIAS.pop;

  const steps = [];
  const issues = diagnosis?.issues || [];
  const has = (id) => issues.find(i => i.id === id);
  const sug = diagnosis?.suggestions || [];

  // 1) Noise — only if clearly needed, mild
  const noiseIssue = has('noise');
  if (noiseIssue && noiseIssue.severity > 0.25) {
    const p = {
      strength: clamp(0.3 + noiseIssue.severity * 0.25 * intensity, 0.25, 0.55),
      sensitivity: 0.4,
      intensity: 0.55
    };
    steps.push({ id: 'noiseReduction', reason: 'کاهش نویز ملایم', params: p, offline: true });
  }

  // 2) Pitch — ONLY when out-of-tune is significant (severity > 0.35)
  // Offline AT was causing warble; keep soft + high humanize + dry mix
  const pitchIssue = has('pitch') || has('pitchStability');
  const pitchSev = Math.max(has('pitch')?.severity || 0, has('pitchStability')?.severity || 0);
  if (pitchIssue && pitchSev > 0.35 && style !== 'natural') {
    const p = {
      amount: clamp(bias.autotuneAmount * (0.5 + pitchSev * 0.4) * intensity * (1.05 - naturalness * 0.4), 0.18, 0.55),
      humanize: clamp(bias.humanize * (0.85 + naturalness * 0.3), 0.25, 0.65),
      retuneSpeed: clamp(0.25 + (1 - naturalness) * 0.25, 0.2, 0.55),
      mix: clamp(0.45 + intensity * 0.2 - naturalness * 0.1, 0.35, 0.7),
      style: style === 'traditional' ? 'traditional' : (style === 'rap' ? 'rap' : 'pop'),
      key: options.key || 'C',
      scale: options.scale || 'major'
    };
    steps.push({ id: 'autotune', reason: 'اصلاح کوک نرم (ضد-warble)', params: p, offline: true });
  }

  // 3) De-ess / breath
  if (has('sibilance') || has('breath')) {
    const sib = has('sibilance')?.severity || 0;
    const br = has('breath')?.severity || 0;
    steps.push({
      id: 'breathSibilance',
      reason: 'کنترل سیبیلانس/نفس',
      params: {
        amount: clamp(0.4 + Math.max(sib, br) * 0.3 * intensity, 0.35, 0.7),
        sibilance: clamp(0.45 + sib * 0.35, 0.35, 0.8),
        breath: clamp(0.3 + br * 0.35, 0.25, 0.65),
        sensitivity: 0.45,
        freq: 6800
      },
      offline: false
    });
  }

  // 4) Corrective EQ — core polish for almost all vocals
  if (has('mud') || has('harsh') || has('tooQuiet') || issues.length === 0 || intensity > 0.3) {
    steps.push({
      id: 'improveQuality',
      reason: 'EQ اصلاحی و وضوح',
      params: {
        intensity: clamp(0.4 + intensity * 0.25, 0.35, 0.7),
        clarity: clamp(0.45 + (has('harsh')?.severity || 0.2) * 0.3, 0.4, 0.75),
        warmth: has('mud') ? 0.25 : 0.4
      },
      offline: false
    });
  }

  // 5) Level
  if (has('clipping') || (diagnosis?.loudness?.peakDb != null && diagnosis.loudness.peakDb > -0.8)) {
    steps.push({ id: 'volume', reason: 'کاهش Gain ضدکلیپ', params: { gain: 0.9 }, offline: false });
  } else if (diagnosis?.loudness?.rmsDb != null && diagnosis.loudness.rmsDb < -30) {
    steps.push({ id: 'volume', reason: 'افزایش ملایم سطح', params: { gain: clamp(1.08 + intensity * 0.1, 1.05, 1.22) }, offline: false });
  }

  // 6) Studio space — light, never washout
  if (!has('backgroundMix')) {
    const wet = clamp(bias.reverbWet * (0.65 + intensity * 0.35) * (1.05 - naturalness * 0.35), 0.06, 0.22);
    steps.push({
      id: 'studio',
      reason: 'فضای ملایم استودیویی',
      params: {
        roomSize: clamp(0.28 + wet * 0.8, 0.22, 0.5),
        wet,
        intensity: clamp(0.35 + intensity * 0.25, 0.3, 0.6)
      },
      offline: false
    });
  }

  return {
    style,
    intensity,
    naturalness,
    steps,
    note: 'پردازش وکال محافظه‌کار — نه مسترینگ کامل میکس'
  };
}

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

    if (onProgress) onProgress(0.05 + (i / total) * 0.85, `اعمال ${step.id}...`);

    try {
      if (entry?.processOfflineBuffer && step.offline) {
        working = await entry.processOfflineBuffer(working, step.params, (p, label) => {
          if (onProgress) onProgress(0.05 + ((i + p * 0.9) / total) * 0.85, label || step.id);
        });
        working = limitPeaks(working, HEADROOM);
        success = true;
      } else if (entry?.createNodes) {
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

  working = limitPeaks(working, 0.96);
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
