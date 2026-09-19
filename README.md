# VoiceMe V2.5.1

Hamburger navigation · Real AutoTune style profiles · Dotted EQ visualizer · Enhanced effects

## AutoTune Styles (real DSP)
Each style changes: amount, retuneSpeed, humanize, mix, scale, presence/air EQ, compressor, pitch-smooth window.

## Run
```bash
npx serve .
```

## V2.5.1 – Vocal Removal + Dual-Track Export

- **حذف صدای خواننده** (ارتقا یافته): Dual-res STFT + Mid/Side + harmonic continuity + residual formant cleanup
- حالت Fast / High Quality — کیفیت High با FFT بزرگ‌تر و overlap بیشتر
- A/B: Original ↔ Instrumental ↔ Vocal stem
- **ترکیب Track A + B در Export** (مشکل قبلی حل شد — خروجی ترکیب‌شده دانلود می‌شود)
- Gain / Mute / Solo برای هر ترک در خروجی اعمال می‌شود
- Original همیشه Non-destructive می‌ماند
- محدودیت: مدل عصبی Demucs نیست؛ بهترین نتیجه روی Stereo با Vocal مرکزی
