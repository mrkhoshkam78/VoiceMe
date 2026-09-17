/**
 * PitchProcessor – Independent Pitch + Formant shift with Duration Preservation
 * Uses: Resample for pitch → WSOLA-like overlap-add for time-stretch back to original duration.
 * Real DSP, not playbackRate.
 */

/**
 * Linear interpolate sample
 */
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Resample a channel by factor ( >1 = higher pitch, shorter; <1 = lower pitch, longer )
 */
function resampleChannel(input, factor) {
  if (Math.abs(factor - 1) < 0.001) return new Float32Array(input);
  const outLen = Math.max(1, Math.floor(input.length / factor));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * factor;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = srcPos - i0;
    out[i] = lerp(input[i0], input[i1], frac);
  }
  return out;
}

/**
 * Simple WSOLA-style time stretch to target length (preserves pitch of input)
 * frameSize ~ 1024-2048, hop analysis/synthesis control rate
 */
function timeStretch(input, targetLen, frameSize = 1024, hopSynth = 512) {
  if (input.length === targetLen) return new Float32Array(input);
  if (input.length < frameSize * 2) {
    // Too short – simple resample
    return resampleChannel(input, input.length / targetLen);
  }

  const hopAnalysis = Math.max(1, Math.round(hopSynth * (input.length / targetLen)));
  const out = new Float32Array(targetLen);
  const window = new Float32Array(frameSize);
  for (let i = 0; i < frameSize; i++) {
    // Hann window
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (frameSize - 1)));
  }

  let inPos = 0;
  let outPos = 0;
  const maxIn = input.length - frameSize;

  while (outPos + frameSize < targetLen && inPos <= maxIn) {
    // Find best match around expected position (limited search for speed)
    let bestOffset = 0;
    let bestCorr = -Infinity;
    const searchRadius = Math.min(hopAnalysis, 32);
    const expected = inPos;

    for (let off = -searchRadius; off <= searchRadius; off += 8) {
      const pos = Math.max(0, Math.min(maxIn, expected + off));
      let corr = 0;
      // Lightweight correlation on a subset
      for (let i = 0; i < frameSize; i += 16) {
        corr += input[pos + i] * (outPos > 0 ? out[outPos + i] || 0 : input[pos + i]);
      }
      if (corr > bestCorr) {
        bestCorr = corr;
        bestOffset = off;
      }
    }

    const readPos = Math.max(0, Math.min(maxIn, expected + bestOffset));
    for (let i = 0; i < frameSize; i++) {
      const idx = outPos + i;
      if (idx < targetLen) {
        out[idx] += input[readPos + i] * window[i];
      }
    }

    inPos += hopAnalysis;
    outPos += hopSynth;
  }

  // Normalize overlapping regions roughly
  // Simple peak normalize to avoid clipping
  let maxAbs = 0.0001;
  for (let i = 0; i < targetLen; i++) {
    const a = Math.abs(out[i]);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs > 0.95) {
    const g = 0.95 / maxAbs;
    for (let i = 0; i < targetLen; i++) out[i] *= g;
  }

  return out;
}

/**
 * Apply formant-ish spectral tilt / brightness shift via multi-band EQ approximation
 * (true formant shift needs LPC; this is a practical timbre control)
 */
function applyFormantTilt(channel, formantShift, sampleRate) {
  // formantShift: 0 = neutral, +1 = brighter/higher formants, -1 = darker
  if (Math.abs(formantShift) < 0.05) return channel;
  // Simple one-pole high-shelf approximation in time domain is limited;
  // We leave formant primarily to the EQ nodes in the effect graph.
  // This function can be extended later with LPC.
  return channel;
}

/**
 * Main entry: pitch shift + preserve duration
 * @param {AudioBuffer} buffer
 * @param {number} pitchRatio  e.g. 1.15 = +~2.4 semitones
 * @param {number} formantShift -1..+1 (used for guidance, real formant via EQ)
 * @returns {AudioBuffer}
 */
export async function processPitchPreserveDuration(buffer, pitchRatio = 1.0, formantShift = 0, onProgress) {
  if (!buffer || Math.abs(pitchRatio - 1) < 0.008) {
    return buffer;
  }

  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const originalLen = buffer.length;
  const targetLen = originalLen;

  const out = new AudioBuffer({
    length: targetLen,
    numberOfChannels: channels,
    sampleRate
  });

  for (let ch = 0; ch < channels; ch++) {
    if (onProgress) onProgress((ch) / channels);
    // Yield to UI between channels
    await new Promise(r => setTimeout(r, 0));
    const input = buffer.getChannelData(ch);
    const pitched = resampleChannel(input, pitchRatio);
    await new Promise(r => setTimeout(r, 0));
    const stretched = timeStretch(pitched, targetLen);
    const final = applyFormantTilt(stretched, formantShift, sampleRate);
    out.getChannelData(ch).set(final);
  }
  if (onProgress) onProgress(1);
  return out;
}

/** Sync wrapper for places that cannot await */
export function processPitchPreserveDurationSync(buffer, pitchRatio = 1.0, formantShift = 0) {
  if (!buffer || Math.abs(pitchRatio - 1) < 0.008) return buffer;
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const targetLen = buffer.length;
  const out = new AudioBuffer({ length: targetLen, numberOfChannels: channels, sampleRate });
  for (let ch = 0; ch < channels; ch++) {
    const input = buffer.getChannelData(ch);
    const pitched = resampleChannel(input, pitchRatio);
    const stretched = timeStretch(pitched, targetLen);
    out.getChannelData(ch).set(applyFormantTilt(stretched, formantShift, sampleRate));
  }
  return out;
}

/**
 * Convenience presets for vocal gender (pitchRatio, formantShift, eq hints)
 */
export const VOCAL_PRESETS = {
  /* V2.4.4 forensic-tuned: moderate pitch, independent formant, natural timbre */
  girl: {
    pitchRatio: 1.08,       // ~ +1.3 st – youthful, avoid chipmunk
    formantShift: 0.28,
    highShelf: 2.6,
    presence: 3.0,
    lowCut: 110,
    body: -1.2,
    air: 2.0
  },
  female: {
    pitchRatio: 1.05,       // ~ +0.85 st – natural adult female
    formantShift: 0.20,
    highShelf: 2.0,
    presence: 2.4,
    lowCut: 85,
    body: 0.4,
    air: 1.5
  },
  woman: {
    pitchRatio: 1.025,      // ~ +0.4 st – mature warmer
    formantShift: 0.10,
    highShelf: 1.2,
    presence: 1.8,
    lowCut: 70,
    body: 1.6,
    air: 0.6
  },
  male: {
    pitchRatio: 0.94,       // ~ -1.05 st – natural male, not cartoon deep
    formantShift: -0.20,
    highShelf: -0.6,
    presence: 1.0,
    lowCut: 50,
    lowShelf: 2.4,
    body: 2.2,
    air: -0.4
  }
};

/**
 * Semitone helper
 */
export function semitonesToRatio(st) {
  return Math.pow(2, st / 12);
}

export function ratioToSemitones(ratio) {
  return 12 * Math.log2(ratio);
}
