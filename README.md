# VoiceMe V1.05 — Professional Vocal Engine

Professional browser-based vocal processing studio.

## Highlights

### Vocal Engine (Duration Preserved)
- **Girl / Female / Woman / Male** presets
- Independent Pitch + Formant shift
- Playback speed always **1.0x**
- Duration of input = duration of output
- No Chipmunk / cartoon artifacts

### AutoTune
- Real pitch detection (autocorrelation)
- Key / Scale / Style presets
- Offline pitch correction for Export
- Preview character processing

### Export (Real Encoding)
- **WAV** – PCM
- **MP3** – LAME (64–320 kbps)
- **FLAC** – Lossless 16-bit
- WebM / OGG when browser supports

### Immersive UI
- Fullscreen audio landing
- Smooth transition into editor
- Categorized effects list
- RTL + responsive

## Run
```bash
npx serve .
```
Chrome recommended.

## Architecture
```
File → Decode → AudioBuffer
  → PitchProcessor (vocal gender, duration-safe)
  → AutoTune (offline)
  → Effect Chain (EQ / Dynamics / Space)
  → Master → Analyser → Destination
```

## Known Limitations
1. True LPC formant shift is approximated via EQ (full LPC is heavier).
2. AutoTune full frame-by-frame correction is strongest on Export.
3. Pitch time-stretch is high quality but CPU-bound on very long files.

Version: **V1.05**
