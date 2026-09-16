/**
 * Audio Editor V1.01 – Main Application
 */

import { AudioManager } from './audio/audioManager.js';
import { effectsRegistry, effectOrder } from './effects/index.js';
import {
  formatDuration,
  formatFileSize,
  isSupportedFormat,
  debounce
} from './utils/helpers.js';

const MAX_FILE_SIZE = 80 * 1024 * 1024; // 80 MB soft limit

class App {
  constructor() {
    this.manager = new AudioManager();
    this.effectState = {}; // id -> { enabled, params }
    this.isProcessing = false;

    this.els = {};
    this._bindElements();
    this._initEffectState();
    this._renderEffectCards();
    this._bindEvents();
    this._setupManagerCallbacks();
  }

  _bindElements() {
    this.els = {
      uploadSection: document.getElementById('uploadSection'),
      fileInput: document.getElementById('fileInput'),
      fileInfo: document.getElementById('fileInfo'),
      fileName: document.getElementById('fileName'),
      fileSize: document.getElementById('fileSize'),
      fileDuration: document.getElementById('fileDuration'),
      fileFormat: document.getElementById('fileFormat'),
      btnRemoveFile: document.getElementById('btnRemoveFile'),
      btnChangeFile: document.getElementById('btnChangeFile'),

      playerSection: document.getElementById('playerSection'),
      playBtn: document.getElementById('playBtn'),
      currentTime: document.getElementById('currentTime'),
      totalTime: document.getElementById('totalTime'),
      seekBar: document.getElementById('seekBar'),
      volumeSlider: document.getElementById('volumeSlider'),
      modeOriginal: document.getElementById('modeOriginal'),
      modeProcessed: document.getElementById('modeProcessed'),
      waveformCanvas: document.getElementById('waveformCanvas'),

      effectsSection: document.getElementById('effectsSection'),
      effectsGrid: document.getElementById('effectsGrid'),
      chainSection: document.getElementById('chainSection'),
      chainList: document.getElementById('chainList'),

      actionsBar: document.getElementById('actionsBar'),
      btnReset: document.getElementById('btnReset'),
      btnExport: document.getElementById('btnExport'),

      progressOverlay: document.getElementById('progressOverlay'),
      progressText: document.getElementById('progressText'),
      progressBar: document.getElementById('progressBar'),
      toastContainer: document.getElementById('toastContainer')
    };
  }

  _initEffectState() {
    effectOrder.forEach((id) => {
      const meta = effectsRegistry[id].meta;
      this.effectState[id] = {
        enabled: false,
        params: { ...meta.defaultParams }
      };
    });
  }

  _renderEffectCards() {
    const grid = this.els.effectsGrid;
    grid.innerHTML = '';

    const categories = {
      voice: 'افکت‌های صدا',
      environment: 'افکت‌های محیطی',
      enhancement: 'بهبود صدا'
    };

    let lastCat = null;

    effectOrder.forEach((id) => {
      const { meta } = effectsRegistry[id];
      if (meta.category !== lastCat) {
        lastCat = meta.category;
        const header = document.createElement('div');
        header.className = 'category-header';
        header.textContent = categories[meta.category] || meta.category;
        grid.appendChild(header);
      }

      const card = document.createElement('div');
      card.className = 'effect-card';
      card.dataset.effectId = id;

      const state = this.effectState[id];

      card.innerHTML = `
        <div class="effect-header">
          <div class="effect-title">
            <div class="effect-icon">${meta.icon}</div>
            <div>
              <div class="effect-name">${meta.name}</div>
              <div class="effect-desc">${meta.description}</div>
            </div>
          </div>
          <label class="toggle">
            <input type="checkbox" data-toggle="${id}" ${state.enabled ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
        <div class="effect-controls" data-controls="${id}">
          ${this._renderControls(id, meta, state.params)}
        </div>
      `;

      if (state.enabled) card.classList.add('active');
      grid.appendChild(card);
    });
  }

  _renderControls(id, meta, params) {
    let html = '';

    if (id === 'femaleVoice') {
      html += `
        <div class="control-group">
          <div class="control-label"><span>حالت</span></div>
          <div class="mode-select">
            <button type="button" class="mode-option ${params.mode === 'girl' ? 'active' : ''}" data-param="mode" data-value="girl" data-effect="${id}">دخترانه</button>
            <button type="button" class="mode-option ${params.mode === 'woman' ? 'active' : ''}" data-param="mode" data-value="woman" data-effect="${id}">زنانه</button>
          </div>
        </div>
        <div class="control-group">
          <div class="control-label"><span>شدت</span><span class="value" data-value-display="intensity">${Math.round(params.intensity * 100)}%</span></div>
          <input type="range" min="0" max="100" value="${params.intensity * 100}" data-param="intensity" data-effect="${id}" data-scale="0.01">
        </div>
      `;
    } else if (id === 'deepVoice') {
      html += `
        <div class="control-group">
          <div class="control-label"><span>شدت</span><span class="value" data-value-display="intensity">${Math.round(params.intensity * 100)}%</span></div>
          <input type="range" min="0" max="100" value="${params.intensity * 100}" data-param="intensity" data-effect="${id}" data-scale="0.01">
        </div>
      `;
    } else if (id === 'echo') {
      html += `
        <div class="control-group">
          <div class="control-label"><span>تأخیر (Delay)</span><span class="value" data-value-display="delay">${params.delay.toFixed(2)}s</span></div>
          <input type="range" min="5" max="100" value="${params.delay * 100}" data-param="delay" data-effect="${id}" data-scale="0.01">
        </div>
        <div class="control-group">
          <div class="control-label"><span>بازخورد (Feedback)</span><span class="value" data-value-display="feedback">${Math.round(params.feedback * 100)}%</span></div>
          <input type="range" min="0" max="80" value="${params.feedback * 100}" data-param="feedback" data-effect="${id}" data-scale="0.01">
        </div>
        <div class="control-group">
          <div class="control-label"><span>مخلوط (Mix)</span><span class="value" data-value-display="mix">${Math.round(params.mix * 100)}%</span></div>
          <input type="range" min="0" max="100" value="${params.mix * 100}" data-param="mix" data-effect="${id}" data-scale="0.01">
        </div>
      `;
    } else if (id === 'studio') {
      html += `
        <div class="control-group">
          <div class="control-label"><span>اندازه فضا</span><span class="value" data-value-display="roomSize">${Math.round(params.roomSize * 100)}%</span></div>
          <input type="range" min="10" max="100" value="${params.roomSize * 100}" data-param="roomSize" data-effect="${id}" data-scale="0.01">
        </div>
        <div class="control-group">
          <div class="control-label"><span>میزان ریورب</span><span class="value" data-value-display="wet">${Math.round(params.wet * 100)}%</span></div>
          <input type="range" min="5" max="60" value="${params.wet * 100}" data-param="wet" data-effect="${id}" data-scale="0.01">
        </div>
        <div class="control-group">
          <div class="control-label"><span>شدت کلی</span><span class="value" data-value-display="intensity">${Math.round(params.intensity * 100)}%</span></div>
          <input type="range" min="20" max="100" value="${params.intensity * 100}" data-param="intensity" data-effect="${id}" data-scale="0.01">
        </div>
      `;
    } else if (id === 'bassBoost') {
      html += `
        <div class="control-group">
          <div class="control-label"><span>مقدار بیس (dB)</span><span class="value" data-value-display="amount">${params.amount} dB</span></div>
          <input type="range" min="0" max="15" value="${params.amount}" data-param="amount" data-effect="${id}" data-scale="1">
        </div>
        <div class="control-group">
          <div class="control-label"><span>فرکانس مرکزی</span><span class="value" data-value-display="frequency">${params.frequency} Hz</span></div>
          <input type="range" min="60" max="200" value="${params.frequency}" data-param="frequency" data-effect="${id}" data-scale="1">
        </div>
      `;
    } else if (id === 'volume') {
      const pct = Math.round(params.gain * 100);
      html += `
        <div class="control-group">
          <div class="control-label"><span>بلندی</span><span class="value" data-value-display="gain">${pct}%</span></div>
          <input type="range" min="10" max="300" value="${pct}" data-param="gain" data-effect="${id}" data-scale="0.01">
        </div>
      `;
    } else if (id === 'speaker' || id === 'police' || id === 'improveQuality') {
      html += `
        <div class="control-group">
          <div class="control-label"><span>شدت</span><span class="value" data-value-display="intensity">${Math.round(params.intensity * 100)}%</span></div>
          <input type="range" min="0" max="100" value="${params.intensity * 100}" data-param="intensity" data-effect="${id}" data-scale="0.01">
        </div>
      `;
    }

    return html;
  }

  _bindEvents() {
    // Upload
    this.els.uploadSection.addEventListener('click', (e) => {
      if (e.target.closest('.file-info') || e.target.closest('.btn')) return;
      this.els.fileInput.click();
    });

    this.els.fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this._handleFile(file);
    });

    // Drag & drop
    ['dragenter', 'dragover'].forEach((ev) => {
      this.els.uploadSection.addEventListener(ev, (e) => {
        e.preventDefault();
        this.els.uploadSection.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      this.els.uploadSection.addEventListener(ev, (e) => {
        e.preventDefault();
        this.els.uploadSection.classList.remove('dragover');
      });
    });
    this.els.uploadSection.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) this._handleFile(file);
    });

    this.els.btnRemoveFile?.addEventListener('click', () => this._removeFile());
    this.els.btnChangeFile?.addEventListener('click', () => this.els.fileInput.click());

    // Player
    this.els.playBtn.addEventListener('click', () => this._togglePlay());
    this.els.seekBar.addEventListener('input', (e) => {
      const t = parseFloat(e.target.value);
      this.manager.seek(t);
      this.els.currentTime.textContent = formatDuration(t);
    });
    this.els.volumeSlider.addEventListener('input', (e) => {
      // Master volume is handled via a simple gain; for simplicity we store it
      // and rebuild is not needed – we can attach a separate gain later if wanted.
      // For V1 we just keep it visual; actual volume control via Volume effect.
    });

    this.els.modeOriginal.addEventListener('click', () => this._setMode('original'));
    this.els.modeProcessed.addEventListener('click', () => this._setMode('processed'));

    // Effects – event delegation
    this.els.effectsGrid.addEventListener('change', (e) => {
      const toggle = e.target.closest('[data-toggle]');
      if (toggle) {
        const id = toggle.dataset.toggle;
        this._toggleEffect(id, toggle.checked);
      }
    });

    this.els.effectsGrid.addEventListener('input', debounce((e) => {
      const input = e.target.closest('[data-param]');
      if (!input) return;
      const id = input.dataset.effect;
      const param = input.dataset.param;
      const scale = parseFloat(input.dataset.scale || '1');
      let value = parseFloat(input.value) * scale;

      this.effectState[id].params[param] = value;
      this._updateParamDisplay(input, param, value);
      this._syncEffectsToManager();
    }, 80));

    this.els.effectsGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.mode-option');
      if (!btn) return;
      const id = btn.dataset.effect;
      const param = btn.dataset.param;
      const value = btn.dataset.value;
      this.effectState[id].params[param] = value;

      // Update active class
      btn.parentElement.querySelectorAll('.mode-option').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      this._syncEffectsToManager();
    });

    // Actions
    this.els.btnReset.addEventListener('click', () => this._resetEffects());
    this.els.btnExport.addEventListener('click', () => this._export());
  }

  _setupManagerCallbacks() {
    this.manager.onTimeUpdate = (t) => {
      this.els.currentTime.textContent = formatDuration(t);
      this.els.seekBar.value = t;
      this._drawWaveform();
    };
    this.manager.onEnded = () => {
      this.els.playBtn.textContent = '▶';
      this.els.currentTime.textContent = formatDuration(0);
      this.els.seekBar.value = 0;
    };
    this.manager.onStateChange = (state) => {
      this.els.playBtn.textContent = state === 'playing' ? '⏸' : '▶';
    };
  }

  async _handleFile(file) {
    if (!isSupportedFormat(file.name)) {
      this._toast('error', 'فرمت پشتیبانی نمی‌شود', 'لطفاً فایل‌های MP3، WAV، OGG یا M4A آپلود کنید.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      this._toast('error', 'فایل خیلی بزرگ است', `حداکثر حجم مجاز حدود ${formatFileSize(MAX_FILE_SIZE)} است.`);
      return;
    }

    this._showProgress('در حال بارگذاری و رمزگشایی فایل...');
    try {
      const info = await this.manager.loadFile(file);
      this._hideProgress();

      this.els.uploadSection.classList.add('has-file');
      this.els.fileInfo.classList.add('visible');
      this.els.fileName.textContent = info.name;
      this.els.fileSize.textContent = formatFileSize(info.size);
      this.els.fileDuration.textContent = formatDuration(info.duration);
      this.els.fileFormat.textContent = (file.name.split('.').pop() || '').toUpperCase();

      this.els.playerSection.classList.add('visible');
      this.els.effectsSection.classList.add('visible');
      this.els.chainSection.classList.add('visible');
      this.els.actionsBar.classList.add('visible');

      this.els.totalTime.textContent = formatDuration(info.duration);
      this.els.seekBar.max = info.duration;
      this.els.seekBar.value = 0;
      this.els.currentTime.textContent = '00:00';

      this._resetEffects(true);
      this._toast('success', 'فایل بارگذاری شد', `${info.name} آماده پردازش است.`);
    } catch (err) {
      this._hideProgress();
      if (err.message === 'DECODE_FAILED') {
        this._toast('error', 'خطا در خواندن فایل', 'فایل صوتی خراب است یا قابل رمزگشایی نیست.');
      } else {
        this._toast('error', 'خطا', 'مشکلی در بارگذاری فایل رخ داد.');
      }
      console.error(err);
    }
  }

  _removeFile() {
    this.manager.dispose();
    this.manager = new AudioManager();
    this._setupManagerCallbacks();
    this._initEffectState();
    this._renderEffectCards();

    this.els.uploadSection.classList.remove('has-file');
    this.els.fileInfo.classList.remove('visible');
    this.els.playerSection.classList.remove('visible');
    this.els.effectsSection.classList.remove('visible');
    this.els.chainSection.classList.remove('visible');
    this.els.actionsBar.classList.remove('visible');
    this.els.fileInput.value = '';
    this.els.playBtn.textContent = '▶';
  }

  _togglePlay() {
    if (!this.manager.originalBuffer) return;
    if (this.manager.isPlaying) {
      this.manager.pause();
    } else {
      this.manager.play();
    }
  }

  _setMode(mode) {
    this.manager.setPreviewMode(mode);
    this.els.modeOriginal.classList.toggle('active', mode === 'original');
    this.els.modeProcessed.classList.toggle('active', mode === 'processed');
  }

  _toggleEffect(id, enabled) {
    this.effectState[id].enabled = enabled;
    const card = this.els.effectsGrid.querySelector(`[data-effect-id="${id}"]`);
    if (card) card.classList.toggle('active', enabled);
    this._syncEffectsToManager();
    this._updateChainUI();
  }

  _syncEffectsToManager() {
    const list = effectOrder
      .filter((id) => this.effectState[id])
      .map((id) => ({
        id,
        params: { ...this.effectState[id].params },
        enabled: this.effectState[id].enabled
      }));
    this.manager.setActiveEffects(list);
    this._updateChainUI();
  }

  _updateChainUI() {
    const list = this.els.chainList;
    const active = effectOrder.filter((id) => this.effectState[id]?.enabled);
    if (active.length === 0) {
      list.innerHTML = '<span class="chain-empty">هیچ افکتی فعال نیست — صدای اصلی پخش می‌شود</span>';
      return;
    }
    list.innerHTML = active
      .map((id, i) => {
        const name = effectsRegistry[id].meta.name;
        const arrow = i < active.length - 1 ? '<span class="chain-arrow">←</span>' : '';
        return `<span class="chain-item">${name} <span class="remove" data-remove="${id}" title="غیرفعال کردن">×</span></span>${arrow}`;
      })
      .join('');

    list.querySelectorAll('[data-remove]').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.dataset.remove;
        this.effectState[id].enabled = false;
        const toggle = this.els.effectsGrid.querySelector(`[data-toggle="${id}"]`);
        if (toggle) toggle.checked = false;
        const card = this.els.effectsGrid.querySelector(`[data-effect-id="${id}"]`);
        if (card) card.classList.remove('active');
        this._syncEffectsToManager();
      });
    });
  }

  _updateParamDisplay(input, param, value) {
    const group = input.closest('.control-group');
    const display = group?.querySelector(`[data-value-display="${param}"]`);
    if (!display) return;

    if (param === 'intensity' || param === 'feedback' || param === 'mix' || param === 'roomSize' || param === 'wet') {
      display.textContent = `${Math.round(value * 100)}%`;
    } else if (param === 'delay') {
      display.textContent = `${value.toFixed(2)}s`;
    } else if (param === 'amount') {
      display.textContent = `${value} dB`;
    } else if (param === 'frequency') {
      display.textContent = `${value} Hz`;
    } else if (param === 'gain') {
      display.textContent = `${Math.round(value * 100)}%`;
    } else {
      display.textContent = String(value);
    }
  }

  _resetEffects(silent = false) {
    this.manager.reset();
    this._initEffectState();
    this._renderEffectCards();
    this._updateChainUI();
    this._setMode('processed');
    if (!silent) {
      this._toast('success', 'بازنشانی شد', 'همه افکت‌ها غیرفعال شدند و به صدای اصلی بازگشتید.');
    }
  }

  async _export() {
    if (!this.manager.originalBuffer) return;
    if (this.isProcessing) return;

    this.isProcessing = true;
    this.els.btnExport.disabled = true;
    this.els.btnReset.disabled = true;
    this._showProgress('در حال پردازش و آماده‌سازی خروجی...');

    try {
      const name = await this.manager.exportWav((p) => {
        this.els.progressBar.style.width = `${Math.round(p * 100)}%`;
        this.els.progressText.textContent = `در حال رندر خروجی... ${Math.round(p * 100)}%`;
      });
      this._hideProgress();
      this._toast('success', 'خروجی آماده شد', `فایل «${name}» دانلود شد.`);
    } catch (err) {
      this._hideProgress();
      this._toast('error', 'خطا در خروجی', 'پردازش یا ساخت فایل خروجی با مشکل مواجه شد. لطفاً دوباره تلاش کنید.');
      console.error(err);
    } finally {
      this.isProcessing = false;
      this.els.btnExport.disabled = false;
      this.els.btnReset.disabled = false;
    }
  }

  _drawWaveform() {
    const canvas = this.els.waveformCanvas;
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

    ctx.fillStyle = '#0f1419';
    ctx.fillRect(0, 0, w, h);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3b82f6';
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

  _showProgress(text) {
    this.els.progressOverlay.classList.add('visible');
    this.els.progressText.textContent = text || 'در حال پردازش...';
    this.els.progressBar.style.width = '10%';
  }

  _hideProgress() {
    this.els.progressOverlay.classList.remove('visible');
    this.els.progressBar.style.width = '0%';
  }

  _toast(type, title, msg) {
    const icons = { error: '⚠️', success: '✅', warning: '⚡' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-msg">${msg}</div>
      </div>
      <button class="toast-close" aria-label="بستن">×</button>
    `;
    el.querySelector('.toast-close').addEventListener('click', () => el.remove());
    this.els.toastContainer.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 5500);
  }
}

// Boot
document.addEventListener('DOMContentLoaded', () => {
  window.audioEditorApp = new App();
});
