# VoiceMe V2.3.0

Hamburger navigation · Real AutoTune style profiles · Dotted EQ visualizer · Enhanced effects

## AutoTune Styles (real DSP)
Each style changes: amount, retuneSpeed, humanize, mix, scale, presence/air EQ, compressor, pitch-smooth window.

## Run
```bash
npx serve .
```

## V2.5.0 – Vocal Removal

- **حذف صدای خواننده** (Studio category): STFT چندبانده + Mid/Side coherence + Residual cleanup
- حالت Fast / High Quality
- A/B: Original ↔ Instrumental ↔ Vocal stem
- Original همیشه Non-destructive می‌ماند
- محدودیت: مدل عصبی Demucs نیست؛ بهترین نتیجه روی Stereo با Vocal مرکزی

