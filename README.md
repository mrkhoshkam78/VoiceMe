# VoiceMe V1.06

Professional Vocal Engine — Dual Track · Speed · Seamless Effects

## Fixes
- Effect apply no longer freezes UI for long periods (async pitch + yield)
- Playback does not unnecessarily pause on live effect param changes
- Vocal processing only restarts audio once after processing completes

## Features
- Dual Track (A + B): independent Gain / Mute / Solo, synchronized play
- Track B parallel mix (effects primarily on Track A in this build)
- Speed control 0.5x–2.0x
- Export settings in header
- Procedural cover art
- Animated play button
- Duration-preserving Girl / Female / Woman / Male
- Real MP3 (LAME) + FLAC + WAV

## Run
```bash
npx serve .
```
