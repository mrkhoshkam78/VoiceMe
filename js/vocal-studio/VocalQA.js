/**
 * Stage 3 — Quality Assurance & Finalization
 * Re-analyze processed buffer, compare to original, detect artifacts, optional light fixes.
 */
import { analyzeVocal } from './VocalAnalyzer.js';
import { clamp } from '../utils/helpers.js';

/**
 * @param {AudioBuffer} original
 * @param {AudioBuffer} processed
 * @param {object} stage1Diagnosis
 * @param {object} processLog - from Stage 2
 * @param {function} onProgress
 */
export async function qualityAssure(original, processed, stage1Diagnosis, processLog, onProgress) {
  if (onProgress) onProgress(0.05, 'ارزیابی مجدد خروجی...');

  const post = await analyzeVocal(processed, { name: 'processed' }, (p, label) => {
    if (onProgress) onProgress(0.05 + p * 0.55, label || 'QA تحلیل...');
  });

  if (onProgress) onProgress(0.65, 'مقایسه قبل/بعد...');

  const before = stage1Diagnosis?.loudness || {};
  const after = post.loudness || {};

  const comparison = {
    peakDb: { before: before.peakDb, after: after.peakDb, delta: +(after.peakDb - (before.peakDb || 0)).toFixed(2) },
    rmsDb: { before: before.rmsDb, after: after.rmsDb, delta: +(after.rmsDb - (before.rmsDb || 0)).toFixed(2) },
    crestDb: { before: before.crestDb, after: after.crestDb, delta: +(after.crestDb - (before.crestDb || 0)).toFixed(2) },
    pitchStability: {
      before: stage1Diagnosis?.pitch?.stability,
      after: post.pitch?.stability,
      delta: post.pitch?.stability != null && stage1Diagnosis?.pitch?.stability != null
        ? +(post.pitch.stability - stage1Diagnosis.pitch.stability).toFixed(3)
        : null
    },
    outOfTuneRatio: {
      before: stage1Diagnosis?.pitch?.outOfTuneRatio,
      after: post.pitch?.outOfTuneRatio
    },
    issuesBefore: (stage1Diagnosis?.issues || []).length,
    issuesAfter: (post.issues || []).length
  };

  // Artifact heuristics
  const artifacts = [];
  const log = processLog?.log || [];

  // Pitch chipmunk / warble: large stability drop after autotune
  const atStep = log.find(l => l.id === 'autotune' && l.success);
  if (atStep && post.pitch?.stability != null && stage1Diagnosis?.pitch?.stability != null) {
    if (post.pitch.stability < stage1Diagnosis.pitch.stability - 0.15) {
      artifacts.push({
        id: 'pitchArtifact',
        severity: 0.55,
        detail: 'پایداری Pitch پس از AutoTune کاهش یافته — ممکن است Retune زیاد باشد',
        suggestion: 'کاهش amount یا افزایش humanize'
      });
    }
  }

  // Over-de-ess: presence collapsed
  if (post.spectral?.presenceRatio < (stage1Diagnosis?.spectral?.presenceRatio || 0.2) * 0.55) {
    artifacts.push({
      id: 'dullDeess',
      severity: 0.4,
      detail: 'Presence کاهش زیاد — De-ess ممکن است بیش از حد باشد',
      suggestion: 'کاهش sibilance amount'
    });
  }

  // Clipping introduced
  if ((after.clipRatio || 0) > (before.clipRatio || 0) + 0.0003 || after.peakDb > -0.3) {
    artifacts.push({
      id: 'newClipping',
      severity: 0.7,
      detail: 'اوج نزدیک به کلیپ در خروجی',
      suggestion: 'کاهش Gain / Makeup'
    });
  }

  // Noise reduction underwater
  const nrStep = log.find(l => l.id === 'noiseReduction' && l.success);
  if (nrStep && post.spectral?.airRatio < 0.05 && (stage1Diagnosis?.spectral?.breathRatio || 0) > 0.1) {
    artifacts.push({
      id: 'nrArtifacts',
      severity: 0.35,
      detail: 'احتمال Artifact ناشی از Noise Reduction',
      suggestion: 'کاهش strength نویز'
    });
  }

  if (onProgress) onProgress(0.8, 'آماده‌سازی گزارش نهایی...');

  // Optional light fix: only peak limit if new clipping
  let finalBuffer = processed;
  let fixApplied = null;
  if (artifacts.some(a => a.id === 'newClipping')) {
    finalBuffer = softLimit(processed, 0.95);
    fixApplied = 'softLimit_0.95';
  }

  const warnings = [];
  if (stage1Diagnosis?.stereo?.possibleBackgroundMusic) {
    warnings.push('ورودی احتمالاً میکس کامل است نه وکال خشک — پردازش وکال ممکن است سازها را هم تغییر دهد.');
  }
  warnings.push('این پردازش وکال است، نه Mastering کامل آهنگ.');
  if (artifacts.length) {
    warnings.push(`${artifacts.length} مورد Artifact احتمالی شناسایی شد.`);
  }

  const qaScore = clamp(
    0.5 +
    (comparison.issuesAfter < comparison.issuesBefore ? 0.2 : -0.05) +
    (artifacts.length === 0 ? 0.15 : -0.08 * artifacts.length) +
    (after.peakDb < -0.5 ? 0.1 : -0.1),
    0.15, 0.95
  );

  if (onProgress) onProgress(1, 'QA کامل شد');

  return {
    stage: 3,
    postDiagnosis: post,
    comparison,
    artifacts,
    fixApplied,
    finalBuffer,
    warnings,
    qaScore: +qaScore.toFixed(2),
    processLog: log,
    disclaimer: 'پردازش وکال — مسترینگ نهایی میکس محسوب نمی‌شود.'
  };
}

function softLimit(buffer, target = 0.95) {
  const ch = buffer.numberOfChannels;
  let peak = 0;
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak <= target) return buffer;
  const s = target / peak;
  const out = new AudioBuffer({ length: buffer.length, numberOfChannels: ch, sampleRate: buffer.sampleRate });
  for (let c = 0; c < ch; c++) {
    const src = buffer.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0; i < src.length; i++) dst[i] = src[i] * s;
  }
  return out;
}
