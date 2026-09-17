# VoiceMe V2.0.0 — Vocal Changer · Music Maker

## Audio Quality Root Cause (fixed)
Cascaded DynamicsCompressors across many effects + no inter-stage peak limiting caused warble/mud/metallic artifacts on multi-effect export.

## Fixes
- Single-pass offline render with peak limiting between stages
- Master soft-limiter + headroom
- Only one vocal pitch stage (female OR deep)
- Softened compressor ratios
- Professional Bass Boost with makeup compensation
- Non-destructive: original buffer never mutated

## Product
- Identity: Vocal Changer · Music Maker
- Default theme: Light
- i18n: فارسی / English
- Header navigation + Export

## Run
```bash
npx serve .
```
