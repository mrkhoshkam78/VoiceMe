# VoiceMe V2.5.0

ویرایشگر صوتی تحت وب با **حذف صدای خواننده (Vocal Removal)** مبتنی بر STFT چندبانده.

## قابلیت جدید V2.5

- **حذف صدای خواننده**: جداسازی Spectral / Mid-Side چندبانده + Residual cleanup
- حالت Fast / High Quality
- کنترل Strength، Residual، حفظ ساز، حفظ استریو
- A/B: Original ↔ Instrumental ↔ Vocal stem
- Progress مرحله‌ای واقعی
- Export با همان Instrumental در pipeline

## محدودیت صادقانه

این نسخه از **مدل عصبی Demucs/UVR** استفاده نمی‌کند (حجم و محدودیت Browser).
الگوریتم DSP پیشرفته است؛ روی میکس‌های Stereo با Vocal مرکزی بهترین نتیجه را می‌دهد.
فایل Mono فقط fallback محدود دارد.

## اجرا

```bash
npx serve .
```

Chrome توصیه می‌شود.
