# VoiceMe / Audio Editor V1.04-FULL

ویرایشگر صوتی حرفه‌ای تحت وب – پردازش واقعی با Web Audio API + Real-Time Effects.

## تغییرات اصلی V1.04-FULL (Critical Audio Engine Fix + Complete Exports)

### Real-Time Audio Engine (مشکل اصلی برطرف شد)
- مسیر سیگنال صحیح: `Source → Effect Chain → MasterGain → Analyser → Destination`
- تغییر پارامترها در حین پخش با `setTargetAtTime` (بدون Click/Pop)
- Enable/Disable افکت بدون قطع صدا و حفظ موقعیت پخش
- مدیریت صحیح Lifecycle مربوط به `AudioBufferSourceNode`
- Chrome Autoplay Policy کامل (`AudioContext.resume()` روی User Gesture)
- Diagnostics کامل (`getDiagnostics()` + signal path)

### افکت‌ها (همه با پشتیبانی Real-Time تا حد ممکن)
1. Female Voice / Woman Voice
2. Deep / Thick Voice
3. Speaker
4. Police / Radio
5. Echo
6. Studio (Reverb)
7. Bass Boost
8. Quality Enhancement
9. Volume
10. Noise Reduction
11. AutoTune (Preview شخصیت تیون‌شده + Export تصحیح Pitch واقعی)

### Export واقعی
- **WAV** – PCM 16-bit خالص
- **MP3** – رمزگذاری واقعی با LAME (lamejs) – بیت‌ریت ۶۴ تا ۳۲۰
- **FLAC** – Lossless واقعی (16-bit)
- **WebM / OGG** – MediaRecorder (Opus) در صورت پشتیبانی مرورگر

### معماری
```
js/
  audio-engine/   # Context, Loader, Player, Graph, Renderer, Exporter
  effects/        # ماژول مستقل هر افکت + update() برای Real-Time
  lib/            # lame.min.js (MP3 encoder)
  utils/
  app.js          # فقط UI
```

## اجرا
```bash
npx serve .
# یا
python -m http.server 8080
```
Chrome توصیه می‌شود.

## محدودیت‌های شناخته‌شده
1. Pitch shift با `playbackRate` → تغییر مدت زمان (Female/Deep)
2. AutoTune کامل (تصحیح Pitch فریم‌به‌فریم) در Export قوی‌تر از Preview است
3. Noise Reduction سبک است (نه spectral subtraction حرفه‌ای)
4. FLAC encoder ساده‌شده است (قابل پخش، اما فشرده‌سازی بهینه نیست)

نسخه: **V1.04-FULL**
