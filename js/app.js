/**
 * Audio Editor V1.02 – Application
 */

import { AudioManager } from './audio/audioManager.js';
import { effectsRegistry, effectOrder } from './effects/index.js';
import { formatDuration, formatFileSize, isSupportedFormat, debounce, NOTE_NAMES } from './utils/helpers.js';

const MAX_FILE_SIZE = 80 * 1024 * 1024;

const ICONS = {
  female: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M12 12v8M9 18h6"/></svg>',
  deep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="7" r="3.5"/><path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M12 14v3"/></svg>',
  autotune: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M12 9l2 2 4-4"/></svg>',
  speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="1"/></svg>',
  police: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2L4 6v5c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V6l-8-4z"/><path d="M9 12l2 2 4-4"/></svg>',
  echo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12h4M6 8v8M10 5v14M14 8v8M18 10v4M22 12h0"/></svg>',
  studio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2a5 5 0 0 1 5 5v4a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v4M8 22h8"/></svg>',
  bass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 18c2-4 4-6 6-6s4 2 6 6 4 6 6 6"/><path d="M3 12h18"/></svg>',
  quality: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2l2.4 7.2H22l-6 4.8 2.3 7L12 16.8 5.7 21l2.3-7-6-4.8h7.6z"/></svg>',
  volume: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/></svg>'
};

const CATEGORIES = {
  voice: 'صدا',
  environment: 'محیط',
  enhancement: 'بهبود'
};

class App {
  constructor() {
    this.manager = new AudioManager();
    this.effectState = {};
    this.selectedEffect = null;
    this.isProcessing = false;
    this.isSeeking = false;

    this._initTheme();
    this._initEffectState();
    this._cacheDom();
    this._renderSidebar();
    this._bindEvents();
    this._setupManager();
  }

  _cacheDom() {
    this.$ = {
      uploadZone: document.getElementById('uploadZone'),
      fileInput: document.getElementById('fileInput'),
      fileName: document.getElementById('fileName'),
      fileSize: document.getElementById('fileSize'),
      fileDuration: document.getElementById('fileDuration'),
      fileFormat: document.getElementById('fileFormat'),
      btnPickFile: document.getElementById('btnPickFile'),
      btnChangeFile: document.getElementById('btnChangeFile'),
      btnRemoveFile: document.getElementById('btnRemoveFile'),
      playerPanel: document.getElementById('playerPanel'),
      playBtn: document.getElementById('playBtn'),
      playIcon: document.getElementById('playIcon'),
      currentTime: document.getElementById('currentTime'),
      totalTime: document.getElementById('totalTime'),
      seekBar: document.getElementById('seekBar'),
      modeOriginal: document.getElementById('modeOriginal'),
      modeProcessed: document.getElementById('modeProcessed'),
      vizCanvas: document.getElementById('vizCanvas'),
      effectsWorkspace: document.getElementById('effectsWorkspace'),
      effectsSidebar: document.getElementById('effectsSidebar'),
      controlsPanel: document.getElementById('controlsPanel'),
      controlsEmpty: document.getElementById('controlsEmpty'),
      controlsContent: document.getElementById('controlsContent'),
      chainBar: document.getElementById('chainBar'),
      chainFlow: document.getElementById('chainFlow'),
      actionBar: document.getElementById('actionBar'),
      btnReset: document.getElementById('btnReset'),
      btnExport: document.getElementById('btnExport'),
      overlay: document.getElementById('overlay'),
      overlayText: document.getElementById('overlayText'),
      progressFill: document.getElementById('progressFill'),
      toastBox: document.getElementById('toastBox'),
      themeBtn: document.getElementById('themeBtn')
    };
  }

  _initTheme() {
    const saved = localStorage.getItem('ae-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
  }

  _toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
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
    // Keep title
    const title = sidebar.querySelector('.sidebar-title');
    sidebar.innerHTML = '';
    if (title) sidebar.appendChild(title);
    else {
      const t = document.createElement('div');
      t.className = 'sidebar-title';
      t.textContent = 'افکت‌ها';
      sidebar.appendChild(t);
    }

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
      item.setAttribute('role', 'button');
      item.innerHTML = `
        <div class="fx-icon">${ICONS[meta.icon] || ICONS.quality}</div>
        <div class="fx-label"><div class="fx-name">${meta.name}</div></div>
        <label class="fx-toggle" onclick="event.stopPropagation()">
          <input type="checkbox" data-toggle="${id}">
          <span class="fx-toggle-track"></span>
        </label>
      `;
      sidebar.appendChild(item);
    });
  }

  _bindEvents() {
    this.$.themeBtn.addEventListener('click', () => this._toggleTheme());

    this.$.btnPickFile.addEventListener('click', (e) => { e.stopPropagation(); this.$.fileInput.click(); });
    this.$.uploadZone.addEventListener('click', (e) => {
      if (this.$.uploadZone.classList.contains('has-file')) return;
      if (e.target.closest('button')) return;
      this.$.fileInput.click();
    });
    this.$.fileInput.addEventListener('change', e => {
      const f = e.target.files?.[0];
      if (f) this._handleFile(f);
    });

    ['dragenter', 'dragover'].forEach(ev => {
      this.$.uploadZone.addEventListener(ev, e => { e.preventDefault(); this.$.uploadZone.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(ev => {
      this.$.uploadZone.addEventListener(ev, e => { e.preventDefault(); this.$.uploadZone.classList.remove('dragover'); });
    });
    this.$.uploadZone.addEventListener('drop', e => {
      const f = e.dataTransfer?.files?.[0];
      if (f) this._handleFile(f);
    });

    this.$.btnChangeFile.addEventListener('click', () => this.$.fileInput.click());
    this.$.btnRemoveFile.addEventListener('click', () => this._removeFile());

    this.$.playBtn.addEventListener('click', () => this._togglePlay());

    this.$.seekBar.addEventListener('pointerdown', () => { this.isSeeking = true; });
    this.$.seekBar.addEventListener('pointerup', () => {
      this.isSeeking = false;
      this.manager.seek(parseFloat(this.$.seekBar.value));
    });
    this.$.seekBar.addEventListener('input', () => {
      const t = parseFloat(this.$.seekBar.value);
      this.$.currentTime.textContent = formatDuration(t);
    });
    this.$.seekBar.addEventListener('change', () => {
      this.isSeeking = false;
      this.manager.seek(parseFloat(this.$.seekBar.value));
    });

    this.$.modeOriginal.addEventListener('click', () => this._setMode('original'));
    this.$.modeProcessed.addEventListener('click', () => this._setMode('processed'));

    // Sidebar: select effect / toggle
    this.$.effectsSidebar.addEventListener('click', e => {
      const toggle = e.target.closest('[data-toggle]');
      if (toggle) {
        const id = toggle.dataset.toggle;
        this._toggleEffect(id, toggle.checked);
        return;
      }
      const item = e.target.closest('.effect-item');
      if (item) this._selectEffect(item.dataset.id);
    });

    this.$.effectsSidebar.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        const item = e.target.closest('.effect-item');
        if (item) { e.preventDefault(); this._selectEffect(item.dataset.id); }
      }
    });

    // Controls delegation
    this.$.controlsContent.addEventListener('input', debounce(e => {
      const input = e.target.closest('[data-param]');
      if (!input) return;
      const id = input.dataset.effect;
      const param = input.dataset.param;
      const scale = parseFloat(input.dataset.scale || '1');
      let value = parseFloat(input.value) * scale;
      this.effectState[id].params[param] = value;
      this._updateValDisplay(input, param, value);
      this._syncEffects();
    }, 60));

    this.$.controlsContent.addEventListener('click', e => {
      const chip = e.target.closest('.option-chip');
      if (!chip) return;
      const id = chip.dataset.effect;
      const param = chip.dataset.param;
      const value = chip.dataset.value;
      this.effectState[id].params[param] = value;
      chip.parentElement.querySelectorAll('.option-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      this._syncEffects();
    });

    this.$.btnReset.addEventListener('click', () => this._resetEffects());
    this.$.btnExport.addEventListener('click', () => this._export());
  }

  _setupManager() {
    this.manager.onTimeUpdate = (t) => {
      if (this.isSeeking) return;
      this.$.currentTime.textContent = formatDuration(t);
      this.$.seekBar.value = t;
      this._drawViz();
    };
    this.manager.onEnded = () => {
      this._setPlayIcon(false);
      this.$.currentTime.textContent = '00:00';
      this.$.seekBar.value = 0;
    };
    this.manager.onStateChange = (state) => {
      this._setPlayIcon(state === 'playing');
    };
  }

  _setPlayIcon(playing) {
    this.$.playIcon.innerHTML = playing
      ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
      : '<path d="M8 5v14l11-7z"/>';
  }

  async _handleFile(file) {
    if (!isSupportedFormat(file.name)) {
      this._toast('error', 'فرمت پشتیبانی نمی‌شود', 'فقط MP3، WAV، OGG یا M4A');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      this._toast('error', 'فایل خیلی بزرگ است', `حداکثر حدود ${formatFileSize(MAX_FILE_SIZE)}`);
      return;
    }

    this._showOverlay('در حال بارگذاری...');
    try {
      const info = await this.manager.loadFile(file);
      this._hideOverlay();

      this.$.uploadZone.classList.add('has-file');
      this.$.fileName.textContent = info.name;
      this.$.fileSize.textContent = formatFileSize(info.size);
      this.$.fileDuration.textContent = formatDuration(info.duration);
      this.$.fileFormat.textContent = (file.name.split('.').pop() || '').toUpperCase();

      this.$.playerPanel.classList.add('visible');
      this.$.effectsWorkspace.classList.add('visible');
      this.$.chainBar.classList.add('visible');
      this.$.actionBar.classList.add('visible');

      this.$.totalTime.textContent = formatDuration(info.duration);
      this.$.seekBar.max = info.duration;
      this.$.seekBar.value = 0;
      this.$.currentTime.textContent = '00:00';

      this._resetEffects(true);
      this._toast('success', 'آماده', `${info.name} بارگذاری شد`);
    } catch (err) {
      this._hideOverlay();
      this._toast('error', 'خطا', err.message === 'DECODE_FAILED'
        ? 'فایل خراب است یا قابل خواندن نیست'
        : 'بارگذاری ناموفق بود');
      console.error(err);
    }
  }

  _removeFile() {
    this.manager.dispose();
    this.manager = new AudioManager();
    this._setupManager();
    this._initEffectState();
    this.selectedEffect = null;
    this._renderSidebar();
    this._showControlsEmpty();

    this.$.uploadZone.classList.remove('has-file');
    this.$.playerPanel.classList.remove('visible');
    this.$.effectsWorkspace.classList.remove('visible');
    this.$.chainBar.classList.remove('visible');
    this.$.actionBar.classList.remove('visible');
    this.$.fileInput.value = '';
    this._setPlayIcon(false);
  }

  _togglePlay() {
    if (!this.manager.originalBuffer) return;
    if (this.manager.isPlaying) this.manager.pause();
    else this.manager.play();
  }

  _setMode(mode) {
    this.manager.setPreviewMode(mode);
    this.$.modeOriginal.classList.toggle('active', mode === 'original');
    this.$.modeProcessed.classList.toggle('active', mode === 'processed');
  }

  _toggleEffect(id, enabled) {
    this.effectState[id].enabled = enabled;
    const item = this.$.effectsSidebar.querySelector(`[data-id="${id}"]`);
    if (item) item.classList.toggle('active-fx', enabled);
    this._syncEffects();
    this._updateChain();
    // If selecting and enabling, show controls
    if (enabled && this.selectedEffect !== id) this._selectEffect(id);
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
    const params = this.effectState[id].params;
    this.$.controlsEmpty.style.display = 'none';
    this.$.controlsContent.style.display = 'block';

    let body = `
      <div class="controls-header">
        <div class="fx-icon">${ICONS[meta.icon] || ''}</div>
        <div>
          <h3>${meta.name}</h3>
          <p>${meta.description}</p>
        </div>
      </div>
    `;

    if (id === 'femaleVoice') {
      body += this._chips(id, 'mode', 'حالت', [
        { v: 'girl', l: 'دخترانه' }, { v: 'woman', l: 'زنانه' }
      ], params.mode);
      body += this._slider(id, 'intensity', 'شدت', 0, 100, params.intensity * 100, 0.01, '%');
    } else if (id === 'deepVoice') {
      body += this._slider(id, 'intensity', 'شدت', 0, 100, params.intensity * 100, 0.01, '%');
    } else if (id === 'autotune') {
      body += this._chips(id, 'key', 'کلید (Key)', NOTE_NAMES.map(n => ({ v: n, l: n })), params.key);
      body += this._chips(id, 'scale', 'گام (Scale)', [
        { v: 'major', l: 'ماژور' }, { v: 'minor', l: 'مینور' }, { v: 'chromatic', l: 'کروماتیک' }
      ], params.scale);
      body += this._slider(id, 'amount', 'میزان تصحیح', 0, 100, params.amount * 100, 0.01, '%');
      body += this._slider(id, 'retuneSpeed', 'سرعت Retune', 0, 100, params.retuneSpeed * 100, 0.01, '%');
      body += this._slider(id, 'humanize', 'انسانی‌سازی', 0, 100, params.humanize * 100, 0.01, '%');
      body += this._slider(id, 'mix', 'مخلوط', 0, 100, params.mix * 100, 0.01, '%');
    } else if (id === 'echo') {
      body += this._slider(id, 'delay', 'تأخیر', 5, 100, params.delay * 100, 0.01, 's', v => (v).toFixed(2) + 's');
      body += this._slider(id, 'feedback', 'بازخورد', 0, 80, params.feedback * 100, 0.01, '%');
      body += this._slider(id, 'mix', 'مخلوط', 0, 100, params.mix * 100, 0.01, '%');
    } else if (id === 'studio') {
      body += this._slider(id, 'roomSize', 'اندازه فضا', 10, 100, params.roomSize * 100, 0.01, '%');
      body += this._slider(id, 'wet', 'میزان ریورب', 5, 60, params.wet * 100, 0.01, '%');
      body += this._slider(id, 'intensity', 'شدت', 20, 100, params.intensity * 100, 0.01, '%');
    } else if (id === 'bassBoost') {
      body += this._slider(id, 'amount', 'مقدار بیس', 0, 15, params.amount, 1, 'dB', v => v + ' dB');
      body += this._slider(id, 'frequency', 'فرکانس', 60, 200, params.frequency, 1, 'Hz', v => v + ' Hz');
    } else if (id === 'volume') {
      body += this._slider(id, 'gain', 'بلندی', 10, 300, params.gain * 100, 0.01, '%');
    } else {
      // speaker, police, improveQuality
      body += this._slider(id, 'intensity', 'شدت', 0, 100, params.intensity * 100, 0.01, '%');
    }

    this.$.controlsContent.innerHTML = body;
  }

  _slider(id, param, label, min, max, value, scale, unit, fmt) {
    const display = fmt ? fmt(value * (scale < 1 ? scale : 1) === value ? value : value) : (
      unit === '%' ? Math.round(value) + '%' :
      unit === 'dB' ? value + ' dB' :
      unit === 'Hz' ? value + ' Hz' :
      unit === 's' ? (value / 100).toFixed(2) + 's' : value
    );
    // Simpler display
    let disp;
    if (unit === '%') disp = Math.round(value) + '%';
    else if (unit === 'dB') disp = value + ' dB';
    else if (unit === 'Hz') disp = value + ' Hz';
    else if (unit === 's') disp = (value * scale).toFixed(2) + 's';
    else disp = value;

    return `
      <div class="control-row">
        <div class="control-label"><span>${label}</span><span class="val" data-value-display="${param}">${disp}</span></div>
        <input type="range" min="${min}" max="${max}" value="${value}" data-param="${param}" data-effect="${id}" data-scale="${scale}" aria-label="${label}">
      </div>
    `;
  }

  _chips(id, param, label, options, current) {
    const chips = options.map(o =>
      `<button type="button" class="option-chip ${o.v === current ? 'active' : ''}" data-effect="${id}" data-param="${param}" data-value="${o.v}">${o.l}</button>`
    ).join('');
    return `
      <div class="control-row">
        <div class="control-label"><span>${label}</span></div>
        <div class="option-group">${chips}</div>
      </div>
    `;
  }

  _updateValDisplay(input, param, value) {
    const row = input.closest('.control-row');
    const el = row?.querySelector(`[data-value-display="${param}"]`);
    if (!el) return;
    if (param === 'intensity' || param === 'feedback' || param === 'mix' || param === 'roomSize' || param === 'wet' || param === 'amount' && value <= 1 || param === 'retuneSpeed' || param === 'humanize' || param === 'gain') {
      el.textContent = Math.round(value * 100) / (param === 'amount' && value > 1 ? 1 : 1);
      // fix
      if (['intensity','feedback','mix','roomSize','wet','retuneSpeed','humanize'].includes(param) || (param === 'amount' && value <= 1) || param === 'gain') {
        el.textContent = Math.round(value * 100) + '%';
      } else if (param === 'amount') {
        el.textContent = value + ' dB';
      } else if (param === 'frequency') {
        el.textContent = value + ' Hz';
      } else if (param === 'delay') {
        el.textContent = value.toFixed(2) + 's';
      }
    } else if (param === 'delay') {
      el.textContent = value.toFixed(2) + 's';
    } else if (param === 'amount') {
      el.textContent = value + ' dB';
    } else if (param === 'frequency') {
      el.textContent = value + ' Hz';
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
    this.manager.setActiveEffects(list);
    this._updateChain();
  }

  _updateChain() {
    const active = effectOrder.filter(id => this.effectState[id]?.enabled);
    if (active.length === 0) {
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
        const item = this.$.effectsSidebar.querySelector(`[data-id="${id}"]`);
        if (item) item.classList.remove('active-fx');
        this._syncEffects();
      });
    });
  }

  _resetEffects(silent = false) {
    this.manager.reset();
    this._initEffectState();
    this.selectedEffect = null;
    this._renderSidebar();
    this._showControlsEmpty();
    this._updateChain();
    this._setMode('processed');
    if (!silent) this._toast('success', 'بازنشانی', 'همه افکت‌ها غیرفعال شدند');
  }

  async _export() {
    if (!this.manager.originalBuffer || this.isProcessing) return;
    this.isProcessing = true;
    this.$.btnExport.disabled = true;
    this.$.btnReset.disabled = true;
    this._showOverlay('در حال رندر خروجی...');

    try {
      const name = await this.manager.exportWav(p => {
        this.$.progressFill.style.width = Math.round(p * 100) + '%';
        this.$.overlayText.textContent = `رندر خروجی... ${Math.round(p * 100)}%`;
      });
      this._hideOverlay();
      this._toast('success', 'دانلود شد', name);
    } catch (err) {
      this._hideOverlay();
      this._toast('error', 'خطا در خروجی', 'پردازش ناموفق بود. دوباره تلاش کنید.');
      console.error(err);
    } finally {
      this.isProcessing = false;
      this.$.btnExport.disabled = false;
      this.$.btnReset.disabled = false;
    }
  }

  _drawViz() {
    const canvas = this.$.vizCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const data = this.manager.getAnalyserData();
    if (!data) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    }

    const theme = document.documentElement.getAttribute('data-theme');
    ctx.fillStyle = theme === 'light' ? '#f0f4f8' : '#0b1220';
    ctx.fillRect(0, 0, w, h);

    ctx.lineWidth = 2;
    ctx.strokeStyle = theme === 'light' ? '#2563eb' : '#3b82f6';
    ctx.beginPath();
    const slice = w / data.length;
    let x = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i] / 128.0;
      const y = (v * h) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += slice;
    }
    ctx.stroke();
  }

  _showOverlay(text) {
    this.$.overlay.classList.add('visible');
    this.$.overlayText.textContent = text || 'در حال پردازش...';
    this.$.progressFill.style.width = '8%';
  }

  _hideOverlay() {
    this.$.overlay.classList.remove('visible');
    this.$.progressFill.style.width = '0%';
  }

  _toast(type, title, msg) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
      <div class="toast-body">
        <div class="toast-title">${title}</div>
        <div class="toast-msg">${msg}</div>
      </div>
      <button class="toast-close" aria-label="بستن">×</button>
    `;
    el.querySelector('.toast-close').addEventListener('click', () => el.remove());
    this.$.toastBox.appendChild(el);
    setTimeout(() => el.parentNode && el.remove(), 5000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.audioEditorApp = new App();
});
