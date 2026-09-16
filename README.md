# Audio Editor V1.03

ویرایشگر صوتی حرفه‌ای تحت وب – پردازش واقعی با Web Audio API.

## تغییرات اصلی V1.03

- **رفع پخش Chrome**: مدیریت صحیح AudioContext، resume روی User Gesture، بازسازی BufferSource
- **معماری تمیز**: `audio-engine/` جدا از UI
- **کاهش نویز** واقعی (Noise Reduction)
- **اتوتیون هوشمند**: Preset سبک (پاپ/سنتی/راک/متال/رپ) + حالت Auto با تشخیص Key/Scale
- **Visualizer سیال** بر اساس AnalyserNode
- **Export**: WAV + WebM/OGG (MediaRecorder) با انتخاب کانال و Sample Rate
- **شدت فیلتر** برای افکت‌ها
- سایه Card قوی‌تر، متن فارسی طبیعی‌تر

## اجرا

```bash
npx serve .
```

Chrome توصیه می‌شود.

## ساختار

```
js/
  audio-engine/   # AudioContext, Loader, Player, Graph, Renderer, Exporter
  effects/        # ماژول مستقل هر افکت
  utils/
  app.js          # فقط UI
```

## محدودیت‌ها

1. Pitch shift با playbackRate → تغییر مدت
2. AutoTune قوی در Export؛ Preview شخصیت تیون‌شده دارد
3. MP3 Export بدون انکودر خارجی ممکن نیست (WAV/WebM/OGG ارائه شده)
4. Noise Reduction سبک است، نه spectral subtraction حرفه‌ای

نسخه: **V1.03**
