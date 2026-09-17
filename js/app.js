/**
 * Audio Editor V2.2.0 – Application (UI layer only) — Professional Vocal Engine
 * Audio logic lives in audio-engine/
 */

import { AudioEngine } from './audio-engine/AudioEngine.js';
import { t, STRINGS } from './i18n/strings.js';
import { AudioExporter } from './audio-engine/AudioExporter.js';
import { effectsRegistry, effectOrder, effectCategories } from './effects/index.js';
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

const CATEGORIES = {
  voice: 'صدا (Vocal)',
  correction: 'تصحیح',
  tone: 'تن',
  space: 'فضا',
  character: 'کاراکتر',
  environment: 'فضا',
  enhancement: 'تن'
};

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
    this._initLang();
    this._initStudioMenu();
    this._initStudioBg();
    this._initEffectState();
    this._cacheDom();
    this._renderSidebar();
    this._bindEvents();
    this._wireEngine();
    this.engine.onVocalProgress = (p, label) => {
      if (p < 1 && this.$.overlay && !this.$.overlay.classList.contains('visible')) {
        // light indicator only – do not block UI with full overlay for short files
      }
    };
    try {
      if (typeof this._populateExportFormats === 'function') this._populateExportFormats();
    } catch (e) {
      console.warn('[App] export formats init skipped', e);
    }
    try {
      if (typeof this._initLanding === 'function') {
        this._initLanding();
      }
    } catch (e) {
      console.warn('[App] landing init skipped', e);
    }
  }

  _initLanding() {
    this.$.landing = document.getElementById('landing');
    this.$.mainApp = document.getElementById('mainApp') || document.querySelector('main.main');
    this.$.landingViz = document.getElementById('landingViz');
    if (this.$.landingViz) this._startLandingViz();
  }

  _startLandingViz() {
    const canvas = this.$.landingViz;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, t = 0;
    const resize = () => {
      w = canvas.width = window.innerWidth * devicePixelRatio;
      h = canvas.height = window.innerHeight * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
    };
    resize();
    window.addEventListener('resize', resize);
    const waves = [
      { amp: 28, freq: 0.008, speed: 0.012, phase: 0 },
      { amp: 18, freq: 0.014, speed: 0.018, phase: 1.2 },
      { amp: 12, freq: 0.022, speed: 0.025, phase: 2.5 }
    ];
    const draw = () => {
      if (!this.$.landing || this.$.landing.classList.contains('hidden')) return;
      const cssW = window.innerWidth, cssH = window.innerHeight;
      ctx.clearRect(0, 0, cssW, cssH);
      const mid = cssH * 0.55;
      waves.forEach((wv, wi) => {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${90 + wi * 40}, ${140 + wi * 20}, 250, ${0.18 - wi * 0.04})`;
        ctx.lineWidth = 2 - wi * 0.4;
        for (let x = 0; x <= cssW; x += 3) {
          const y = mid + Math.sin(x * wv.freq + t * wv.speed + wv.phase) * wv.amp
            + Math.sin(x * wv.freq * 0.4 + t * 0.008) * (wv.amp * 0.35);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
      t += 1;
      this._landingRaf = requestAnimationFrame(draw);
    };
    draw();
  }

  _enterEditor() {
    if (this.$.landing) {
      this.$.landing.classList.add('hidden');
      this.$.landing.style.pointerEvents = 'none';
      setTimeout(() => {
        if (this.$.landing) {
          this.$.landing.style.display = 'none';
          this.$.landing.setAttribute('aria-hidden', 'true');
        }
      }, 500);
    }
    if (this.$.mainApp) {
      this.$.mainApp.style.display = 'flex';
      this.$.mainApp.classList.add('entering');
    }
    if (this._landingRaf) {
      cancelAnimationFrame(this._landingRaf);
      this._landingRaf = null;
    }
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
      exportSampleRate: id('exportSampleRate'),
      speedSelect: id('speedSelect'),
      sidePanel: id('sidePanel'),
      sideFileName: id('sideFileName'),
      sideFormat: id('sideFormat'),
      sideSize: id('sideSize'),
      sideDuration: id('sideDuration'),
      sideRate: id('sideRate'),
      sideChannels: id('sideChannels'),
      sideEffects: id('sideEffects'),
      sideAutotune: id('sideAutotune'),
      btnSideToggle: id('btnSideToggle'),
      playerStatus: id('playerStatus'),
      fileCover: id('fileCover'),
      fileCoverCanvas: id('fileCoverCanvas'),
      fileCoverFallback: id('fileCoverFallback'),
      headerExport: id('headerExport')
    };
  }


  _initLang() {
    const saved = localStorage.getItem('ae-lang') || 'fa';
    this.lang = saved === 'en' ? 'en' : 'fa';
    document.documentElement.setAttribute('lang', this.lang);
    document.documentElement.setAttribute('dir', this.lang === 'fa' ? 'rtl' : 'ltr');
    const sel = document.getElementById('langSelect');
    if (sel) {
      sel.value = this.lang;
      // re-bind change in case DOM ready order differs
      sel.onchange = (e) => this._setLang(e.target.value);
    }
    this._applyI18n();
  }

  _setLang(lang) {
    this.lang = lang === 'en' ? 'en' : 'fa';
    localStorage.setItem('ae-lang', this.lang);
    document.documentElement.setAttribute('lang', this.lang);
    document.documentElement.setAttribute('dir', this.lang === 'fa' ? 'rtl' : 'ltr');
    this._applyI18n();
  }

  _applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key, this.lang);
      if (val) el.textContent = val;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = t(key, this.lang);
      if (val) el.setAttribute('placeholder', val);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      const key = el.getAttribute('data-i18n-aria');
      const val = t(key, this.lang);
      if (val) el.setAttribute('aria-label', val);
    });
    // Dynamic status
    const st = document.getElementById('playerStatus');
    if (st) {
      st.textContent = this.engine?.isPlaying ? t('playing', this.lang) : t('ready', this.lang);
    }
    // Drawer title stays brand
    const drawerTitle = document.querySelector('.nav-drawer-title');
    if (drawerTitle) drawerTitle.textContent = 'VoiceMe';
    // Re-render sidebar labels via effect meta (names already FA in registry)
    try { this._renderSidebar?.(); } catch (_) {}
    try { this._updateSideStatus?.(); } catch (_) {}
  }

  _tt(key) { return t(key, this.lang || 'fa'); }


  _initStudioMenu() {
    const btn = document.getElementById('hamburgerBtn');
    const drawer = document.getElementById('navDrawer');
    const overlay = document.getElementById('navOverlay');
    const closeBtn = document.getElementById('navClose');
    if (!btn || !drawer) {
      console.warn('[Menu] hamburger elements missing');
      return;
    }

    const openMenu = () => {
      drawer.hidden = false;
      if (overlay) overlay.hidden = false;
      // force reflow then animate
      void drawer.offsetWidth;
      drawer.classList.add('open');
      overlay?.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      btn.classList.add('is-open');
      document.body.classList.add('menu-open');
    };

    const closeMenu = () => {
      drawer.classList.remove('open');
      overlay?.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('is-open');
      document.body.classList.remove('menu-open');
      const onEnd = () => {
        drawer.hidden = true;
        if (overlay) overlay.hidden = true;
        drawer.removeEventListener('transitionend', onEnd);
      };
      drawer.addEventListener('transitionend', onEnd);
      // fallback
      setTimeout(() => {
        if (!drawer.classList.contains('open')) {
          drawer.hidden = true;
          if (overlay) overlay.hidden = true;
        }
      }, 320);
    };

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (drawer.classList.contains('open')) closeMenu();
      else openMenu();
    });
    closeBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      closeMenu();
    });
    overlay?.addEventListener('click', () => closeMenu());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('open')) closeMenu();
    });

    drawer.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const action = el.getAttribute('data-action');
        if (action === 'scroll') {
          const t = document.getElementById(el.getAttribute('data-target'));
          if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else if (action === 'fx') {
          const id = el.getAttribute('data-fx');
          if (id && this.effectState?.[id] !== undefined) {
            if (typeof this._selectEffect === 'function') this._selectEffect(id);
            document.getElementById('effectsWorkspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        } else if (action === 'export') {
          const fmt = el.getAttribute('data-format');
          const sel = document.getElementById('exportFormat');
          if (sel && fmt) {
            const opt = [...sel.options].find(o => o.value === fmt || String(o.value).includes(fmt));
            if (opt) sel.value = opt.value;
          }
          if (typeof this._export === 'function') this._export();
        } else if (action === 'theme' || action === 'theme-dark' || action === 'theme-light') {
          if (action === 'theme-dark') this._setTheme('dark');
          else if (action === 'theme-light') this._setTheme('light');
          else if (typeof this._toggleTheme === 'function') this._toggleTheme();
        }
        closeMenu();
      });
    });
  }

  _initStudioBg() {
    const canvas = document.getElementById('studioBg');
    if (!canvas) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const ctx = canvas.getContext('2d');
    let w, h, raf;
    const isMobile = () => window.innerWidth < 640;
    const blobs = Array.from({ length: isMobile() ? 3 : 5 }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.12 + Math.random() * 0.18,
      vx: (Math.random() - 0.5) * 0.00025,
      vy: (Math.random() - 0.5) * 0.00025,
      hue: [265, 190, 300, 250, 175][i % 5]
    }));

    const resize = () => {
      w = canvas.width = window.innerWidth * (window.devicePixelRatio > 1 ? 1 : 1);
      h = canvas.height = window.innerHeight;
      // lower res on mobile for perf
      if (isMobile()) {
        canvas.width = Math.floor(window.innerWidth * 0.6);
        canvas.height = Math.floor(window.innerHeight * 0.6);
      }
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const theme = document.documentElement.getAttribute('data-theme') || 'light';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cw = canvas.width, ch = canvas.height;
      blobs.forEach(b => {
        b.x += b.vx; b.y += b.vy;
        if (b.x < -0.2 || b.x > 1.2) b.vx *= -1;
        if (b.y < -0.2 || b.y > 1.2) b.vy *= -1;
        const grd = ctx.createRadialGradient(
          b.x * cw, b.y * ch, 0,
          b.x * cw, b.y * ch, b.r * Math.min(cw, ch)
        );
        const alpha = theme === 'light' ? 0.22 : 0.28;
        grd.addColorStop(0, `hsla(${b.hue}, 70%, 60%, ${alpha})`);
        grd.addColorStop(1, `hsla(${b.hue}, 70%, 50%, 0)`);
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(b.x * cw, b.y * ch, b.r * Math.min(cw, ch), 0, Math.PI * 2);
        ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    };
    // throttle: run at ~30fps via skipping is complex; simple RAF is ok with few blobs
    draw();
    this._studioBgRaf = raf;
  }

  _setTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('ae-theme', next);
    document.documentElement.setAttribute('data-theme-name', next === 'dark' ? 'nebula' : 'daylight');
  }

  _initTheme() {
    // Nebula (dark) is the primary identity; Daylight (light) is optional
    const saved = localStorage.getItem('ae-theme') || 'dark';
    const theme = saved === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.setAttribute('data-theme-name', theme === 'dark' ? 'nebula' : 'daylight');
  }

  _toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    this._setTheme(cur === 'dark' ? 'light' : 'dark');
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
    const cats = (typeof effectCategories !== 'undefined') ? effectCategories : null;
    if (cats) {
      cats.forEach(cat => {
        const lab = document.createElement('div');
        lab.className = 'effect-cat-label';
        lab.textContent = cat.label;
        sidebar.appendChild(lab);
        cat.ids.forEach(id => {
          const meta = effectsRegistry[id]?.meta;
          if (!meta) return;
          const item = document.createElement('div');
          item.className = 'effect-item' + (this.effectState[id]?.enabled ? ' active-fx' : '');
          item.dataset.id = id;
          item.tabIndex = 0;
          item.innerHTML = `
            <div class="fx-icon">${ICONS[meta.icon] || ICONS.quality}</div>
            <div class="fx-label"><div class="fx-name">${meta.name}</div></div>
            <label class="fx-toggle" data-toggle-wrap="${id}">
              <input type="checkbox" data-toggle="${id}" ${this.effectState[id]?.enabled ? 'checked' : ''} aria-label="فعال‌سازی ${meta.name}">
              <span class="fx-toggle-track"></span>
            </label>`;
          sidebar.appendChild(item);
        });
      });
    } else {
      effectOrder.forEach(id => {
        const meta = effectsRegistry[id].meta;
        const item = document.createElement('div');
        item.className = 'effect-item';
        item.dataset.id = id;
        item.innerHTML = `
          <div class="fx-icon">${ICONS[meta.icon] || ''}</div>
          <div class="fx-label"><div class="fx-name">${meta.name}</div></div>
          <label class="fx-toggle" data-toggle-wrap="${id}">
            <input type="checkbox" data-toggle="${id}">
            <span class="fx-toggle-track"></span>
          </label>`;
        sidebar.appendChild(item);
      });
    }
  }

  _populateExportFormats() {
    const sel = document.getElementById('exportFormat');
    const hdr = document.getElementById('headerExport');
    if (!sel) return;
    const formats = AudioExporter.availableFormats();
    sel.innerHTML = formats.map(f => `<option value="${f.id}">${f.label}</option>`).join('');
    this.$.exportFormat = sel;
    this.$.exportBitrate = document.getElementById('exportBitrate');
    this.$.exportChannels = document.getElementById('exportChannels');
    this.$.exportSampleRate = document.getElementById('exportSampleRate'); // may be null
    this.$.btnExportHdr = document.getElementById('btnExportHdr');
    this.$.headerExport = hdr;
    // Keep action bar export in sync if present
    if (this.$.btnExportHdr) {
      this.$.btnExportHdr.onclick = () => this._export();
    }
  }

  _bindEvents() {
    const on = (el, ev, fn) => { if (el) el.addEventListener(ev, fn); };

    on(this.$.themeBtn, 'click', () => this._toggleTheme());
    on(document.getElementById('langSelect'), 'change', e => this._setLang(e.target.value));
    on(document.getElementById('navExport'), 'click', () => this._export());
    on(document.getElementById('navBurger'), 'click', () => {
      document.getElementById('mainNav')?.classList.toggle('open-mobile');
    });
    on(this.$.btnSideToggle, 'click', () => {
      const p = this.$.sidePanel;
      if (!p) return;
      p.classList.toggle('open');
    });

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

    // CRITICAL: listen to 'change' on checkboxes — click alone was blocked by stopPropagation
    on(this.$.effectsSidebar, 'change', e => {
      const input = e.target;
      if (input && input.matches && input.matches('input[data-toggle]')) {
        const id = input.dataset.toggle;
        this._toggleEffect(id, input.checked);
      }
    });

    on(this.$.effectsSidebar, 'click', e => {
      // clicks on the toggle itself should not only-select; change handler enables
      if (e.target.closest('[data-toggle-wrap], input[data-toggle]')) {
        e.stopPropagation();
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
      // Live DSP update while playing — no full chain rebuild if effect supports it
      if (this.effectState[id].enabled) {
        const isVocal = id === 'femaleVoice' || id === 'deepVoice';
        // Vocal is heavy – longer debounce; live effects update immediately via AudioParam
        this.engine.updateEffectParams(id, { ...this.effectState[id].params });
      }
    }, 120));

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

    // Dual track
    on(document.getElementById('fileInputB'), 'change', async e => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const meta = await this.engine.loadTrackB(f);
        const nameEl = document.getElementById('trackNameB');
        const durEl = document.getElementById('trackDurB');
        if (nameEl) nameEl.textContent = meta.name || 'Track B';
        if (durEl) durEl.textContent = formatDuration(meta.duration || 0);
        ['muteB','soloB','gainB','removeB'].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.disabled = false;
        });
        this._toast('success', 'Track B', meta.name || 'بارگذاری شد');
      } catch (err) {
        this._toast('error', 'Track B', 'بارگذاری ناموفق');
      }
    });
    on(document.getElementById('removeB'), 'click', () => {
      this.engine.clearTrackB();
      const nameEl = document.getElementById('trackNameB');
      if (nameEl) nameEl.textContent = 'Track B — خالی';
      const durEl = document.getElementById('trackDurB');
      if (durEl) durEl.textContent = '—';
      ['muteB','soloB','gainB','removeB'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = true;
      });
    });
    const bindGain = (id, track, valId) => {
      on(document.getElementById(id), 'input', e => {
        const pct = parseFloat(e.target.value) || 0;
        const linear = pct / 100;
        this.engine.setTrackGain(track, linear);
        const db = linear <= 0 ? '-∞' : (20 * Math.log10(linear)).toFixed(1);
        const v = document.getElementById(valId);
        if (v) v.textContent = (linear <= 0 ? '-∞' : db) + ' dB';
      });
    };
    bindGain('gainA', 'A', 'gainValA');
    bindGain('gainB', 'B', 'gainValB');
    on(document.getElementById('muteA'), 'click', e => {
      e.currentTarget.classList.toggle('active');
      this.engine.setTrackMute('A', e.currentTarget.classList.contains('active'));
    });
    on(document.getElementById('muteB'), 'click', e => {
      e.currentTarget.classList.toggle('active');
      this.engine.setTrackMute('B', e.currentTarget.classList.contains('active'));
    });
    on(document.getElementById('soloA'), 'click', e => {
      e.currentTarget.classList.toggle('active');
      this.engine.setTrackSolo('A', e.currentTarget.classList.contains('active'));
    });
    on(document.getElementById('soloB'), 'click', e => {
      e.currentTarget.classList.toggle('active');
      this.engine.setTrackSolo('B', e.currentTarget.classList.contains('active'));
    });

    on(this.$.btnExport, 'click', () => this._export());
    on(this.$.btnExportHdr, 'click', () => this._export());
    on(this.$.speedSelect, 'change', e => {
      const v = parseFloat(e.target.value) || 1;
      this.engine.setSpeed(v);
    });
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
    if (this.$.playIcon) {
      this.$.playIcon.innerHTML = playing
        ? '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'
        : '<path d="M8 5v14l11-7z"/>';
    }
    if (this.$.playBtn) {
      this.$.playBtn.classList.toggle('is-playing', !!playing);
    }
    const panel = this.$.playerPanel || document.getElementById('playerPanel');
    if (panel) panel.classList.toggle('is-pulsing', !!playing);
    const st = this.$.playerStatus || document.getElementById('playerStatus');
    if (st) {
      st.textContent = playing ? 'در حال پخش' : 'آماده';
      st.classList.toggle('is-paused', !playing);
    }
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

      this._enterEditor();
      if (this.$.headerExport) this.$.headerExport.hidden = false;
      // Show editor panels FIRST so UI never stays blank
      if (this.$.playerPanel) this.$.playerPanel.classList.add('visible');
      if (this.$.effectsWorkspace) this.$.effectsWorkspace.classList.add('visible');
      if (this.$.chainBar) this.$.chainBar.classList.add('visible');
      if (this.$.actionBar) this.$.actionBar.classList.add('visible');
      try { this._renderCover(info);
      this._updateSideInfo(info, file); } catch (e) { console.warn(e); }
      const tn = document.getElementById('trackNameA');
      const td = document.getElementById('trackDurA');
      if (tn) tn.textContent = info.name || 'Track A';
      const tcn = document.getElementById('trackCardName');
      if (tcn) tcn.textContent = info.name || 'Preview';
      const ffm = document.getElementById('fileFormatMini');
      if (ffm) ffm.textContent = (info.name || '').split('.').pop()?.toUpperCase() || '';
      if (td) td.textContent = formatDuration(info.duration || 0);
      try { if (typeof this._populateExportFormats === 'function') this._populateExportFormats(); } catch(_){}

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
    this.engine.onVocalProgress = (p, label) => {
      if (p < 1 && this.$.overlay && !this.$.overlay.classList.contains('visible')) {
        // light indicator only – do not block UI with full overlay for short files
      }
    };
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
    if (this.$.sidePanel) {
      this.$.sidePanel.hidden = true;
      this.$.sidePanel.classList.remove('open');
    }
    this.$.fileInput.value = '';
    this._setPlayIcon(false);
  }

  _setMode(mode) {
    this.engine.setPreviewMode(mode);
    this.$.modeOriginal.classList.toggle('active', mode === 'original');
    this.$.modeProcessed.classList.toggle('active', mode === 'processed');
  }

  async _toggleEffect(id, enabled) {
    this.effectState[id].enabled = !!enabled;
    const item = this.$.effectsSidebar.querySelector(`[data-id="${id}"]`);
    if (item) item.classList.toggle('active-fx', !!enabled);
    const cb = this.$.effectsSidebar.querySelector(`input[data-toggle="${id}"]`);
    if (cb && cb.checked !== !!enabled) cb.checked = !!enabled;

    await this._syncEffects();

    if (typeof console !== 'undefined') {
      console.debug('[Effect]', id, enabled ? 'ON' : 'OFF',
        'path=', this.engine.getDiagnostics?.()?.signalPath);
    }

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
        { v: 'girl', l: 'Girl' }, { v: 'female', l: 'Female' }, { v: 'woman', l: 'Woman' }
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

  async _syncEffects() {
    const list = effectOrder.map(id => ({
      id,
      params: { ...this.effectState[id].params },
      enabled: this.effectState[id].enabled
    }));
    await this.engine.setEffects(list);
    this._updateSideStatus();
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
    const bitrate = parseInt(this.$.exportBitrate?.value || '192', 10);

    try {
      const name = await this.engine.export(
        { format, channels, sampleRate: sr || undefined, bitrate, bitDepth: 16 },
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

  /* ── Dotted Equalizer Visualizer ── */
  _startVizLoop() {
    this._stopVizLoop();
    const canvas = this.$.vizCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cols = 40;
    if (!this._smoothedWave) this._smoothedWave = new Float32Array(cols);

    const draw = () => {
      const playing = this.engine.isPlaying;
      const freq = this.engine.getAnalyserFreqData?.() || null;
      const time = this.engine.getAnalyserTimeData?.() || null;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 2 || h < 2) {
        this._vizRaf = requestAnimationFrame(draw);
        return;
      }
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim()
        || getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
        || '#0c1224';
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Update levels from analyser
      for (let i = 0; i < cols; i++) {
        let target = 0.08; // idle baseline
        if (freq && freq.length) {
          const idx = Math.floor((i / cols) * Math.min(freq.length * 0.7, freq.length - 1));
          target = Math.min(1, (freq[idx] / 255) * 1.15);
        } else if (time && time.length) {
          const step = Math.floor(time.length / cols);
          let sum = 0;
          for (let k = 0; k < step; k++) sum += Math.abs(time[i * step + k] - 128);
          target = Math.min(1, (sum / step) / 64);
        }
        if (!playing) target *= 0.25;
        const smooth = playing ? 0.35 : 0.12;
        this._smoothedWave[i] += (target - this._smoothedWave[i]) * smooth;
      }

      const gap = 3;
      const colW = (w - gap * (cols - 1)) / cols;
      const dotR = Math.max(1.2, Math.min(2.8, colW * 0.28));
      const dotGap = dotR * 2.4;

      for (let i = 0; i < cols; i++) {
        const level = this._smoothedWave[i];
        const colH = Math.max(dotR * 2, level * (h - 8));
        const x = i * (colW + gap) + colW / 2;
        const dots = Math.max(2, Math.floor(colH / dotGap));
        for (let d = 0; d < dots; d++) {
          const y = h - 4 - d * dotGap;
          const t = d / Math.max(1, dots - 1);
          // Cyan → Violet → Magenta
          const r = Math.round(34 + t * 180);
          const g = Math.round(211 - t * 100);
          const b = Math.round(238 - t * 30 + (1 - t) * 20);
          const a = 0.35 + level * 0.55;
          ctx.beginPath();
          ctx.fillStyle = `rgba(${r},${g},${Math.min(255, b)},${a})`;
          ctx.arc(x, y, dotR, 0, Math.PI * 2);
          ctx.fill();
        }
      }

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


  _renderCover(info) {
    try {
      const canvas = this.$.fileCoverCanvas || document.getElementById('fileCoverCanvas');
      const img = this.$.fileCover || document.getElementById('fileCover');
      const fallback = this.$.fileCoverFallback || document.getElementById('fileCoverFallback');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const w = canvas.width || 64;
      const h = canvas.height || 64;
      const name = (info && info.name) || 'audio';
      let hash = 0;
      for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
      const h1 = hash % 360;
      const h2 = (hash * 7) % 360;
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, `hsl(${h1}, 70%, 45%)`);
      g.addColorStop(1, `hsl(${h2}, 65%, 30%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const y = h / 2 + Math.sin(x * 0.2 + hash) * 8 + Math.sin(x * 0.08) * 5;
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      canvas.hidden = false;
      if (img) img.hidden = true;
      if (fallback) fallback.style.display = 'none';
    } catch (e) {
      console.warn('[cover]', e);
    }
  }


  _updateSideInfo(info, file) {
    const set = (el, v) => { if (el) el.textContent = v; };
    set(this.$.sideFileName, info?.name || '—');
    const ext = (file?.name || info?.name || '').split('.').pop()?.toUpperCase() || '—';
    set(this.$.sideFormat, ext);
    set(this.$.sideSize, info?.size != null ? formatFileSize(info.size) : '—');
    set(this.$.sideDuration, formatDuration(info?.duration || 0));
    set(this.$.sideRate, info?.sampleRate ? `${(info.sampleRate / 1000).toFixed(1)} kHz` : '—');
    set(this.$.sideChannels, info?.channels === 1 ? 'Mono' : (info?.channels === 2 ? 'Stereo' : (info?.channels || '—')));
    this._updateSideStatus();
    if (this.$.sidePanel) this.$.sidePanel.hidden = false;
  }

  _updateSideStatus() {
    const enabled = Object.entries(this.effectState || {})
      .filter(([, s]) => s.enabled)
      .map(([id]) => effectsRegistry[id]?.meta?.name || id);
    if (this.$.sideEffects) {
      this.$.sideEffects.textContent = enabled.length ? enabled.join(' · ') : 'هیچ';
    }
    if (this.$.sideAutotune) {
      const at = this.effectState?.autotune;
      this.$.sideAutotune.textContent = at?.enabled ? 'فعال' : 'خاموش';
    }
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
