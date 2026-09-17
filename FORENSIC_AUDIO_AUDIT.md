# VoiceMe V2.4.4 — Forensic Audio Audit Report

## Signal Chain (final)

```
Original (immutable)
→ Offline (once, if enabled): Noise Reduction → Vocal Pitch/Formant → AutoTune
→ Live graph nodes in order:
  noiseReduction → breathSibilance → femaleVoice|deepVoice (EQ character)
  → autotune (character) → bassBoost → improveQuality
  → speaker → police → echo → studio → volume
→ Master headroom limit (export)
→ Encoder (WAV/MP3/FLAC)
```

**Order rationale:** clean noise first, then pitch-domain, then tone, character, space last (so reverb/delay are not noise-amplified).

---

## Effect Matrix

| Effect | Status | Real DSP | Key Parameters | Changes V2.4.4 | Test |
|--------|--------|----------|----------------|----------------|------|
| femaleVoice | PASS | Pitch preserve-duration + formant tilt + EQ | mode, intensity | Softer pitch ratios (less chipmunk) | PASS |
| deepVoice | PASS | Same engine, male preset | intensity | Male pitch 0.94, formant -0.20 | PASS |
| autotune | PASS | Offline corr + live EQ/comp | style, key, scale, amount, retune, humanize | Style profiles differ (smoothFrames, presence, ratio) | PASS |
| breathSibilance | PASS | Split-band de-ess + breath shelf | breath, sibilance amounts | Kept independent of NR | PASS |
| noiseReduction | PASS | HP + hiss shelf + mid notch + dynamics | strength, sensitivity, intensity | Clamped ranges | PASS* |
| improveQuality | PASS | Corrective EQ chain + soft comp | intensity, clarity, warmth | Not treble-only; mud/harsh/presence | PASS |
| bassBoost | PASS | Shelf + punch Q + mud guard + makeup | amount dB, frequency Hz, q | Professional low-end | PASS |
| studio | PASS | EQ + de-ess + comp + convolver ambience | roomSize, wet, intensity | Wet capped 0.6, filtered IR | PASS |
| echo | PASS | Delay + filtered feedback | delay s, feedback, mix | Feedback max 0.75, HP/LP in loop | PASS |
| speaker | PASS | Band limit + shaper + comp | intensity | Character real | PASS |
| police | PASS | Narrow BP + peak + shaper | intensity | Radio character real | PASS |
| volume | PASS | Gain node | gain | Direct mapping | PASS |

\*Noise Reduction is **not** full STFT spectral subtraction (browser cost). It is a real multi-band + dynamics cleaner. True FFT NR would need AudioWorklet + more CPU.

---

## Vocal Female/Male

- Pitch via resample + time-stretch (duration preserved)
- Formant via tilt + EQ (not pure pitch)
- Girl/Female/Woman/Male presets differentiated
- playbackRate **not** used for gender

## Gain Staging

- Inter-stage peak limit HEADROOM = 0.85
- Bass/Studio makeup compensation
- Echo feedback hard cap

## Preview vs Export

- Shared effect definitions (`createNodes` + offline processors)
- Export uses AudioRenderer single-pass with same effect list
- Live path uses graph `update()` without full rebuild for param tweaks

## Known Limitations

1. Formant shift is EQ/tilt approximation (not LPC)
2. Noise Reduction is not full spectral subtraction
3. Breath detection is energy/spectral heuristic, not ML VAD
4. AutoTune real-time is character EQ; hard pitch quantize is offline
5. No true AudioWorklet yet (main-thread nodes)

## Files Changed

- `js/audio-engine/PitchProcessor.js` — vocal presets
- `js/audio-engine/AudioRenderer.js` — headroom
- `js/effects/bassBoost.js` — low-end processor
- `js/effects/echo.js` — safe delay
- `js/effects/studio.js` — studio chain
- `js/effects/improveQuality.js` — corrective EQ
- `js/effects/noiseReduction.js` — validation
- `index.html` / `js/app.js` — version 2.4.4
