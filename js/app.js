/**
 * Audio Editor V1.03 – Application (UI layer only)
 * Audio logic lives in audio-engine/
 */

import { AudioEngine } from './audio-engine/AudioEngine.js';
import { AudioExporter } from './audio-engine/AudioExporter.js';
import { effectsRegistry, effectOrder } from './effects/index.js';
import { STYLE_PRESETS, detectKeyAndScale, applyStylePreset } from './effects/autotune.js';
import {
  formatDuration, formatFileSize, isSupportedFormat,
  debounce, NOTE_NAMES, clamp
} from './utils/helpers.js';

const MAX_FILE_SIZE = 100 * 1024 * 1024;

const ICONS = {
  female: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M12 12v8M9 18h6"/></svg>',
  deep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="7" r="3.5"/><path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>',
  autotune: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="12" r="3"/></svg>',
  police: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2L4 6v5c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V6l-8-4z"/></svg>',
  echo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12h4M6 8v8M10 5v14M14 8v8M18 10v4"/></svg>',
  studio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2a5 5 0 0 1 5 5v4a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v4"/></svg>',
  bass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 18c2-4 4-6 6-6s4 2 6 6 4 6 6 6"/></svg>',
  quality: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l2.4 7.2H22l-6 4.8 2.3 7L12 16.8 5.7 21l2.3-7-6-4.8h7.6z"/></svg>',
  noise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2M21 12h0"/></svg>',
  volume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>'
};

const CATEGORIES = { voice: 'صدا', environment: 'محیط', enhancement: 'بهبود' };

class App {
  constructor() {
    this.engine = new AudioEngine();
    this.effectState = {};
    this.selectedEffect = null;
    this.isProcessing = false;
    this.isSeeking = false;
    this._vizRaf = null;
    this._smoothedWave = null;

    this._initTheme();
    this._initEffectState();
    this._cacheDom();
    this._renderSidebar();
    this._bindEvents();
    this._wireEngine();
    this._populateExportFormats();
  }

  _cacheDom() {
    const id = (s) => document.getElementById(s);
    this.$ = {
      uploadZone: id('uploadZone'), fileInput: id('fileInput'),
      fileName: id('fileName'), fileSize: id('fileSize'),
      fileDuration: id('fileDuration'), fileFormat: id('fileFormat'),
      btnPickFile: id('btnPickFile'), btnChangeFile: id('btnChangeFile'),
      btnRemoveFile: id('btnRemoveFile'),
      playerPanel: id('playerPanel'), playBtn: id('playBtn'),
      playIcon: id('playIcon'), currentTime: id('currentTime'),
      totalTime: id('totalTime'), seekBar: id('seekBar'),
      modeOriginal: id('modeOriginal'), modeProcessed: id('modeProcessed'),
      vizCanvas: id('vizCanvas'),
      effectsWorkspace: id('effectsWorkspace'), effectsSidebar: id('effectsSidebar'),
      controlsEmpty: id('controlsEmpty'), controlsContent: id('controlsContent'),
      chainBar: id('chainBar'), chainFlow: id('chainFlow'),
      actionBar: id('actionBar'), btnReset: id('btnReset'), btnExport: id('btnExport'),
      overlay: id('overlay'), overlayText: id('overlayText'), progressFill: id('progressFill'),
      toastBox: id('toastBox'), themeBtn: id('themeBtn'),
      // export settings (may be injected)
      exportFormat: id('exportFormat'),
      exportChannels: id('exportChannels'),
      exportSampleRate: id('exportSampleRate')
    };
  }

  _initTheme() {
    const saved = localStorage.getItem('ae-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
  }

  _toggleTheme() {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('ae-theme', next);
  }

  _initEffectState() {
    effectOrder.forEach(id => {
      const meta = effectsRegistry[id].meta;
      this.effectState[id] = { enabled: false, params: { ...meta.defaultParams } };
    });
  }

  _renderSidebar() {
    const sidebar = this.$.effectsSidebar;
    sidebar.innerHTML = '<div class="sidebar-title">افکت‌ها</div>';
    let lastCat = null;
    effectOrder.forEach(id => {
      const meta = effectsRegistry[id].meta;
      if (meta.category !== lastCat) {
        lastCat = meta.category;
        const lab = document.createElement('div');
        lab.className = 'effect-cat-label';
        lab.textContent = CATEGORIES[meta.category] || meta.category;
        sidebar.appendChild(lab);
      }
      const item = document.createElement('div');
      item.className = 'effect-item';
      item.dataset.id = id;
      item.tabIndex = 0;
      item.innerHTML = `
        <div class="fx-icon">${ICONS[meta.icon] || ICONS.quality}</div>
        <div class="fx-label"><div class="fx-name">${meta.name}</div></div>
        <label class="fx-toggle" onclick="event.stopPropagation()">
          <input type="checkbox" data-toggle="${id}">
          <span class="fx-toggle-track"></span>
        </label>`;
      sidebar.appendChild(item);
    });
  }

  _populateExportFormats() {
    // Inject export settings into action bar if not present
    const bar = this.$.actionBar?.querySelector('.action-bar-inner');
    if (!bar || document.getElementById('exportFormat')) return;

    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;margin-left:auto;';
    const formats = AudioExporter.availableFormats();
    wrap.innerHTML = `
      <select id="exportFormat" class="option-chip" style="padding:0.4rem 0.6rem;cursor:pointer;" aria-label="فرمت خروجی">
        ${formats.map(f => `<option value="${f.id}">${f.label}</option>`).join('')}
      </select>
      <select id="exportChannels" class="option-chip" style="padding:0.4rem 0.6rem;cursor:pointer;" aria-label="کانال">
        <option value="2">استریو</option>
        <option value="1">مونو</option>
      </select>
      <select id="exportSampleRate" class="option-chip" style="padding:0.4rem 0.6rem;cursor:pointer;" aria-label="نرخ نمونه‌برداری">
        <option value="0">اصلی</option>
        <option value="44100">44100 Hz</option>
        <option value="48000">48000 Hz</option>
        <option value="22050">22050 Hz</option>
      </select>`;
    bar.insertBefore(wrap, bar.firstChild);
    this.$.exportFormat = document.getElementById('exportFormat');
    this.$.exportChannels = document.getElementById('exportChannels');
    this.$.exportSampleRate = document.getElementById('exportSampleRate');
  }

  _bindEvents() {
    const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };

    on(this.$.themeBtn, 'click', () => this._toggleTheme());

    // label[for=fileInput] already opens the picker natively; stop zone double-handling
    on(this.$.btnPickFile, 'click', e => { e.stopPropagation(); });
    on(this.$.uploadZone, 'click', e => {
      if (this.$.uploadZone.classList.contains('has-file')) return;
      if (e.target.closest('button, label, a, input')) return;
      this.$.fileInput?.click();
    });
    on(this.$.fileInput, 'change', e => {
      const f = e.target.files?.[0];
      if (f) this._handleFile(f);
    });

    ['dragenter', 'dragover'].forEach(ev => {
      on(this.$.uploadZone, ev, e => { e.preventDefault(); this.$.uploadZone.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(ev => {
      on(this.$.uploadZone, ev, e => { e.preventDefault(); this.$.uploadZone.classList.remove('dragover'); });
    });
    on(this.$.uploadZone, 'drop', e => {
      const f = e.dataTransfer?.files?.[0];
      if (f) this._handleFile(f);
    });

    on(this.$.btnChangeFile, 'click', () => this.$.fileInput?.click());
    on(this.$.btnRemoveFile, 'click', () => this._removeFile());

    // Play – user gesture → resume context
    on(this.$.playBtn, 'click', async () => {
      if (!this.engine.originalBuffer) return;
      if (this.engine.isPlaying) {
        this.engine.pause();
      } else {
        await this.engine.play();
      }
    });

    // Seek
    on(this.$.seekBar, 'pointerdown', () => { this.isSeeking = true; });
    on(this.$.seekBar, 'pointerup', () => {
      this.isSeeking = false;
      this.engine.seek(parseFloat(this.$.seekBar.value));
    });
    on(this.$.seekBar, 'input', () => {
      this.$.currentTime.textContent = formatDuration(parseFloat(this.$.seekBar.value));
    });
    on(this.$.seekBar, 'change', () => {
      this.isSeeking = false;
      this.engine.seek(parseFloat(this.$.seekBar.value));
    });

    on(this.$.modeOriginal, 'click', () => this._setMode('original'));
    on(this.$.modeProcessed, 'click', () => this._setMode('processed'));

    on(this.$.effectsSidebar, 'click', e => {
      const toggle = e.target.closest('[data-toggle]');
      if (toggle) {
        this._toggleEffect(toggle.dataset.toggle, toggle.checked);
        return;
      }
      const item = e.target.closest('.effect-item');
      if (item) this._selectEffect(item.dataset.id);
    });

    on(this.$.controlsContent, 'input', debounce(e => {
      const input = e.target.closest('[data-param]');
      if (!input) return;
      const id = input.dataset.effect;
      const param = input.dataset.param;
      const scale = parseFloat(input.dataset.scale || '1');
      const value = parseFloat(input.value) * scale;
      this.effectState[id].params[param] = value;
      this._updateValLabel(input, param, value);
      this._syncEffects();
    }, 50));

    on(this.$.controlsContent, 'click', e => {
      const chip = e.target.closest('.option-chip');
      if (!chip) return;
      const id = chip.dataset.effect;
      const param = chip.dataset.param;
      const value = chip.dataset.value;

      if (param === 'style') {
        // Apply style preset
        const preset = applyStylePreset(value);
        Object.assign(this.effectState[id].params, preset);
        this._renderControls(id);
        this._syncEffects();
        return;
      }

      if (param === 'autoMode') {
        const on = value === 'true';
        this.effectState[id].params.autoMode = on;
        if (on && this.engine.originalBuffer) {
          this._runAutoDetect(id);
        }
        this._renderControls(id);
        this._syncEffects();
        return;
      }

      this.effectState[id].params[param] = value;
      chip.parentElement.querySelectorAll('.option-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      this._syncEffects();
    });

    on(this.$.btnReset, 'click', () => this._resetEffects());
    on(this.$.btnExport, 'click', () => this._export());
  }

  _wireEngine() {
    this.engine.onTimeUpdate = (t) => {
      if (this.isSeeking) return;
      this.$.currentTime.textContent = formatDuration(t);
      this.$.seekBar.value = t;
    };
    this.engine.onEnded = () => {
      this._setPlayIcon(false);
      this.$.currentTime.textContent = '00:00';
      this.$.seekBar.value = 0;
      this._stopVizLoop();
    };
    this.engine.onStateChange = (state) => {
      this._setPlayIcon(state === 'playing');
      if (state === 'playing') this._startVizLoop();
      else this._stopVizLoop();
    };
  }

  _setPlayIcon(playing) {
    this.$.playIcon.innerHTML = playing
      ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
      : '<path d="M8 5v14l11-7z"/>';
  }

  async _handleFile(file) {
    if (!isSupportedFormat(file.name)) {
      this._toast('error', 'فرمت پشتیبانی نمی‌شود', 'فرمت‌های مجاز: MP3، WAV، OGG، M4A، WebM، FLAC');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      this._toast('error', 'فایل خیلی بزرگ است', `حداکثر حدود ${formatFileSize(MAX_FILE_SIZE)}`);
      return;
    }

    this._showOverlay('در حال بارگذاری و رمزگشایی...');
    try {
      // Resume context early on user gesture (file pick is a gesture)
      await this.engine.ctxManager.ensure();
      const info = await this.engine.loadFile(file);
      this._hideOverlay();

      this.$.uploadZone.classList.add('has-file');
      this.$.fileName.textContent = info.name;
      this.$.fileSize.textContent = formatFileSize(info.size);
      this.$.fileDuration.textContent = formatDuration(info.duration);
      this.$.fileFormat.textContent =
        `${(file.name.split('.').pop() || '').toUpperCase()} · ${info.sampleRate} Hz · ${info.channels}ch`;

      this.$.playerPanel.classList.add('visible');
      this.$.effectsWorkspace.classList.add('visible');
      this.$.chainBar.classList.add('visible');
      this.$.actionBar.classList.add('visible');
      this._populateExportFormats();

      this.$.totalTime.textContent = formatDuration(info.duration);
      this.$.seekBar.max = info.duration;
      this.$.seekBar.value = 0;
      this.$.currentTime.textContent = '00:00';

      this._resetEffects(true);
      this._toast('success', 'آماده پخش', info.name);

      if (window.location.search.includes('debug')) {
        console.log('[Diagnostics]', this.engine.getDiagnostics());
      }
    } catch (err) {
      this._hideOverlay();
      const messages = {
        UNSUPPORTED_FORMAT: 'این فرمت پشتیبانی نمی‌شود',
        DECODE_FAILED: 'فایل خراب است یا مرورگر نمی‌تواند آن را بخواند',
        READ_FAILED: 'خواندن فایل ناموفق بود',
        EMPTY_FILE: 'فایل خالی است'
      };
      this._toast('error', 'خطا', messages[err.message] || 'بارگذاری ناموفق بود');
      console.error(err);
    }
  }

  async _removeFile() {
    await this.engine.dispose();
    this.engine = new AudioEngine();
    this._wireEngine();
    this._initEffectState();
    this.selectedEffect = null;
    this._renderSidebar();
    this._showControlsEmpty();
    this._stopVizLoop();

    this.$.uploadZone.classList.remove('has-file');
    this.$.playerPanel.classList.remove('visible');
    this.$.effectsWorkspace.classList.remove('visible');
    this.$.chainBar.classList.remove('visible');
    this.$.actionBar.classList.remove('visible');
    this.$.fileInput.value = '';
    this._setPlayIcon(false);
  }

  _setMode(mode) {
    this.engine.setPreviewMode(mode);
    this.$.modeOriginal.classList.toggle('active', mode === 'original');
    this.$.modeProcessed.classList.toggle('active', mode === 'processed');
  }

  _toggleEffect(id, enabled) {
    this.effectState[id].enabled = enabled;
    const item = this.$.effectsSidebar.querySelector(`[data-id="${id}"]`);
    if (item) item.classList.toggle('active-fx', enabled);
    this._syncEffects();
    this._updateChain();
    if (enabled) this._selectEffect(id);
    else if (this.selectedEffect === id) this._renderControls(id);
  }

  _selectEffect(id) {
    this.selectedEffect = id;
    this.$.effectsSidebar.querySelectorAll('.effect-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.id === id);
    });
    this._renderControls(id);
  }

  _renderControls(id) {
    const meta = effectsRegistry[id].meta;
    const p = this.effectState[id].params;
    this.$.controlsEmpty.style.display = 'none';
    this.$.controlsContent.style.display = 'block';

    let body = `
      <div class="controls-header">
        <div class="fx-icon">${ICONS[meta.icon] || ''}</div>
        <div><h3>${meta.name}</h3><p>${meta.description}</p></div>
      </div>`;

    if (id === 'femaleVoice') {
      body += this._chips(id, 'mode', 'حالت', [
        { v: 'girl', l: 'دخترانه' }, { v: 'woman', l: 'زنانه' }
      ], p.mode);
      body += this._slider(id, 'intensity', 'شدت فیلتر', 0, 100, (p.intensity ?? 0.75) * 100, 0.01);
    } else if (id === 'deepVoice') {
      body += this._slider(id, 'intensity', 'شدت فیلتر', 0, 100, (p.intensity ?? 0.7) * 100, 0.01);
    } else if (id === 'autotune') {
      body += this._chips(id, 'style', 'سبک موسیقی', [
        { v: 'pop', l: 'پاپ' }, { v: 'traditional', l: 'سنتی' },
        { v: 'rock', l: 'راک' }, { v: 'metal', l: 'متال' }, { v: 'rap', l: 'رپ' }
      ], p.style || 'pop');
      body += this._chips(id, 'autoMode', 'حالت خودکار', [
        { v: 'true', l: 'خودکار (Auto)' }, { v: 'false', l: 'دستی' }
      ], p.autoMode ? 'true' : 'false');
      if (p.detectedKey) {
        body += `<div class="control-row"><div class="control-label">
          <span>تشخیص‌شده: ${p.detectedKey} ${p.detectedScale === 'minor' ? 'مینور' : 'ماژور'}</span>
          <span class="val">اطمینان ${p.confidence || 0}٪</span>
        </div></div>`;
      }
      body += this._chips(id, 'key', 'کلید', NOTE_NAMES.map(n => ({ v: n, l: n })), p.key);
      body += this._chips(id, 'scale', 'گام', [
        { v: 'major', l: 'ماژور' }, { v: 'minor', l: 'مینور' }, { v: 'chromatic', l: 'کروماتیک' }
      ], p.scale);
      body += this._slider(id, 'amount', 'میزان تصحیح', 0, 100, (p.amount ?? 0.7) * 100, 0.01);
      body += this._slider(id, 'retuneSpeed', 'سرعت Retune', 0, 100, (p.retuneSpeed ?? 0.55) * 100, 0.01);
      body += this._slider(id, 'humanize', 'انسانی‌سازی', 0, 100, (p.humanize ?? 0.25) * 100, 0.01);
      body += this._slider(id, 'mix', 'مخلوط', 0, 100, (p.mix ?? 0.85) * 100, 0.01);
      body += this._slider(id, 'intensity', 'شدت فیلتر', 0, 100, (p.intensity ?? 1) * 100, 0.01);
    } else if (id === 'echo') {
      body += this._slider(id, 'delay', 'تأخیر', 5, 100, (p.delay ?? 0.28) * 100, 0.01, 's');
      body += this._slider(id, 'feedback', 'بازخورد', 0, 80, (p.feedback ?? 0.4) * 100, 0.01);
      body += this._slider(id, 'mix', 'مخلوط', 0, 100, (p.mix ?? 0.45) * 100, 0.01);
    } else if (id === 'studio') {
      body += this._slider(id, 'roomSize', 'اندازه فضا', 10, 100, (p.roomSize ?? 0.5) * 100, 0.01);
      body += this._slider(id, 'wet', 'میزان ریورب', 5, 60, (p.wet ?? 0.32) * 100, 0.01);
      body += this._slider(id, 'intensity', 'شدت فیلتر', 20, 100, (p.intensity ?? 0.65) * 100, 0.01);
    } else if (id === 'bassBoost') {
      body += this._slider(id, 'amount', 'مقدار بیس', 0, 15, p.amount ?? 8, 1, 'dB');
      body += this._slider(id, 'frequency', 'فرکانس', 60, 200, p.frequency ?? 95, 1, 'Hz');
    } else if (id === 'volume') {
      body += this._slider(id, 'gain', 'بلندی', 10, 300, (p.gain ?? 1) * 100, 0.01);
    } else if (id === 'noiseReduction') {
      body += this._slider(id, 'strength', 'قدرت کاهش', 0, 100, (p.strength ?? 0.55) * 100, 0.01);
      body += this._slider(id, 'sensitivity', 'حساسیت', 0, 100, (p.sensitivity ?? 0.5) * 100, 0.01);
      body += this._slider(id, 'intensity', 'شدت فیلتر', 0, 100, (p.intensity ?? 0.7) * 100, 0.01);
    } else {
      body += this._slider(id, 'intensity', 'شدت فیلتر', 0, 100, (p.intensity ?? 0.7) * 100, 0.01);
    }

    this.$.controlsContent.innerHTML = body;
  }

  _slider(id, param, label, min, max, value, scale, unit) {
    let disp;
    if (unit === 'dB') disp = value + ' dB';
    else if (unit === 'Hz') disp = value + ' Hz';
    else if (unit === 's') disp = (value * scale).toFixed(2) + ' ثانیه';
    else disp = Math.round(value) + '٪';

    return `<div class="control-row">
      <div class="control-label"><span>${label}</span><span class="val" data-value-display="${param}">${disp}</span></div>
      <input type="range" min="${min}" max="${max}" value="${value}"
        data-param="${param}" data-effect="${id}" data-scale="${scale}" aria-label="${label}">
    </div>`;
  }

  _chips(id, param, label, options, current) {
    const chips = options.map(o =>
      `<button type="button" class="option-chip ${String(o.v) === String(current) ? 'active' : ''}"
        data-effect="${id}" data-param="${param}" data-value="${o.v}">${o.l}</button>`
    ).join('');
    return `<div class="control-row">
      <div class="control-label"><span>${label}</span></div>
      <div class="option-group">${chips}</div>
    </div>`;
  }

  _updateValLabel(input, param, value) {
    const el = input.closest('.control-row')?.querySelector(`[data-value-display="${param}"]`);
    if (!el) return;
    if (param === 'delay') el.textContent = value.toFixed(2) + ' ثانیه';
    else if (param === 'amount' && value > 1) el.textContent = value + ' dB';
    else if (param === 'frequency') el.textContent = value + ' Hz';
    else el.textContent = Math.round(value * 100) + '٪';
  }

  async _runAutoDetect(id) {
    if (!this.engine.originalBuffer) return;
    this._showOverlay('در حال تشخیص Key و Scale...');
    try {
      // Yield to UI
      await new Promise(r => setTimeout(r, 50));
      const result = detectKeyAndScale(this.engine.originalBuffer);
      this.effectState[id].params.key = result.key;
      this.effectState[id].params.scale = result.scale;
      this.effectState[id].params.detectedKey = result.key;
      this.effectState[id].params.detectedScale = result.scale;
      this.effectState[id].params.confidence = result.confidence;
      // also apply style defaults
      const style = this.effectState[id].params.style || 'pop';
      Object.assign(this.effectState[id].params, applyStylePreset(style), {
        key: result.key,
        scale: result.scale,
        detectedKey: result.key,
        detectedScale: result.scale,
        confidence: result.confidence,
        autoMode: true
      });
      this._hideOverlay();
      this._renderControls(id);
      this._syncEffects();
      this._toast('success', 'تشخیص انجام شد',
        `کلید: ${result.key} · اطمینان: ${result.confidence}٪`);
    } catch (err) {
      this._hideOverlay();
      this._toast('error', 'خطا', 'تشخیص خودکار ناموفق بود');
      console.error(err);
    }
  }

  _showControlsEmpty() {
    this.$.controlsEmpty.style.display = 'flex';
    this.$.controlsContent.style.display = 'none';
    this.$.controlsContent.innerHTML = '';
  }

  _syncEffects() {
    const list = effectOrder.map(id => ({
      id,
      params: { ...this.effectState[id].params },
      enabled: this.effectState[id].enabled
    }));
    this.engine.setEffects(list);
    this._updateChain();
  }

  _updateChain() {
    const active = effectOrder.filter(id => this.effectState[id]?.enabled);
    if (!active.length) {
      this.$.chainFlow.innerHTML = '<span class="chain-empty-msg">هیچ افکتی فعال نیست</span>';
      return;
    }
    this.$.chainFlow.innerHTML = active.map((id, i) => {
      const name = effectsRegistry[id].meta.name;
      const arrow = i < active.length - 1 ? '<span class="chain-arrow">←</span>' : '';
      return `<span class="chain-chip">${name}<span class="x" data-rm="${id}">×</span></span>${arrow}`;
    }).join('');
    this.$.chainFlow.querySelectorAll('[data-rm]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.rm;
        this.effectState[id].enabled = false;
        const cb = this.$.effectsSidebar.querySelector(`[data-toggle="${id}"]`);
        if (cb) cb.checked = false;
        this.$.effectsSidebar.querySelector(`[data-id="${id}"]`)?.classList.remove('active-fx');
        this._syncEffects();
      });
    });
  }

  _resetEffects(silent = false) {
    this.engine.reset();
    this._initEffectState();
    this.selectedEffect = null;
    this._renderSidebar();
    this._showControlsEmpty();
    this._updateChain();
    this._setMode('processed');
    if (!silent) this._toast('success', 'بازنشانی شد', 'همه افکت‌ها خاموش شدند');
  }

  async _export() {
    if (!this.engine.originalBuffer || this.isProcessing) return;
    this.isProcessing = true;
    this.$.btnExport.disabled = true;
    this.$.btnReset.disabled = true;
    this._showOverlay('شروع پردازش...');

    const format = this.$.exportFormat?.value || 'wav';
    const channels = parseInt(this.$.exportChannels?.value || '2', 10);
    const sr = parseInt(this.$.exportSampleRate?.value || '0', 10);

    try {
      const name = await this.engine.export(
        { format, channels, sampleRate: sr || undefined },
        (p, label) => {
          this.$.progressFill.style.width = Math.round(p * 100) + '%';
          this.$.overlayText.textContent = label || `پردازش... ${Math.round(p * 100)}٪`;
        }
      );
      this._hideOverlay();
      this._toast('success', 'پردازش با موفقیت انجام شد', name);
    } catch (err) {
      this._hideOverlay();
      this._toast('error', 'خطا در خروجی', 'پردازش یا ساخت فایل ناموفق بود');
      console.error(err);
    } finally {
      this.isProcessing = false;
      this.$.btnExport.disabled = false;
      this.$.btnReset.disabled = false;
    }
  }

  /* ── Fluid Wave Visualizer ── */
  _startVizLoop() {
    this._stopVizLoop();
    const canvas = this.$.vizCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const bins = 128;
    if (!this._smoothedWave) this._smoothedWave = new Float32Array(bins);

    const draw = () => {
      if (!this.engine.isPlaying) return;
      const data = this.engine.getAnalyserTimeData();
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      const theme = document.documentElement.getAttribute('data-theme');
      ctx.fillStyle = theme === 'light' ? '#f0f4f8' : '#0b1220';
      ctx.fillRect(0, 0, w, h);

      if (data) {
        // Downsample + smooth
        const step = Math.floor(data.length / bins);
        for (let i = 0; i < bins; i++) {
          const v = (data[i * step] - 128) / 128;
          this._smoothedWave[i] += (v - this._smoothedWave[i]) * 0.35;
        }
      }

      // Organic bezier wave
      ctx.beginPath();
      ctx.strokeStyle = theme === 'light' ? '#2563eb' : '#60a5fa';
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';

      const mid = h / 2;
      for (let i = 0; i < bins; i++) {
        const x = (i / (bins - 1)) * w;
        const y = mid + this._smoothedWave[i] * mid * 0.85;
        if (i === 0) ctx.moveTo(x, y);
        else {
          const prevX = ((i - 1) / (bins - 1)) * w;
          const cpx = (prevX + x) / 2;
          ctx.quadraticCurveTo(prevX, mid + this._smoothedWave[i - 1] * mid * 0.85, cpx, y);
        }
      }
      ctx.stroke();

      // Soft fill
      ctx.lineTo(w, mid);
      ctx.lineTo(0, mid);
      ctx.closePath();
      ctx.fillStyle = theme === 'light' ? 'rgba(37,99,235,0.08)' : 'rgba(96,165,250,0.1)';
      ctx.fill();

      this._vizRaf = requestAnimationFrame(draw);
    };
    this._vizRaf = requestAnimationFrame(draw);
  }

  _stopVizLoop() {
    if (this._vizRaf) {
      cancelAnimationFrame(this._vizRaf);
      this._vizRaf = null;
    }
    // Gentle decay draw once
    if (this._smoothedWave) {
      for (let i = 0; i < this._smoothedWave.length; i++) {
        this._smoothedWave[i] *= 0.5;
      }
    }
  }

  _showOverlay(text) {
    this.$.overlay.classList.add('visible');
    this.$.overlayText.textContent = text || 'در حال پردازش...';
    this.$.progressFill.style.width = '6%';
  }

  _hideOverlay() {
    this.$.overlay.classList.remove('visible');
    this.$.progressFill.style.width = '0%';
  }

  _toast(type, title, msg) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<div class="toast-body"><div class="toast-title">${title}</div>
      <div class="toast-msg">${msg}</div></div>
      <button class="toast-close" aria-label="بستن">×</button>`;
    el.querySelector('.toast-close').addEventListener('click', () => el.remove());
    this.$.toastBox.appendChild(el);
    setTimeout(() => el.parentNode && el.remove(), 5000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    window.audioEditorApp = new App();
  } catch (err) {
    console.error('[App] boot failed', err);
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);color:#fff;display:flex;align-items:center;justify-content:center;z-index:99999;padding:2rem;text-align:center;direction:rtl;font-family:Tahoma,sans-serif';
    el.innerHTML = '<div><b>خطا در راه‌اندازی</b><br><br><code style="font-size:12px">' + (err && err.message ? err.message : err) + '</code><br><br>صفحه را با سرور محلی باز کنید (npx serve .)</div>';
    document.body.appendChild(el);
  }
});
