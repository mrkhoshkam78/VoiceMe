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
import { VocalStudioEngine } from './vocal-studio/VocalStudioEngine.js';
import { formatReportHTML, stageLabel } from './vocal-studio/ui.js';

const MAX_FILE_SIZE = 100 * 1024 * 1024;

const ICONS = {
  vocal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/><path d="M19 11a7 7 0 0 1-14 0M12 18v4M8 22h8"/><line x1="4" y1="4" x2="20" y2="20"/></svg>',
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
    this.vocalStudio = new VocalStudioEngine();
    this._vsBusy = false;
    this.selectedEffect = null;
    this.isProcessing = false;
    this.isSeeking = false;
    this._vizRaf = null;
    this._smoothedWave = null;

    this._initTheme();
    this._initLang();
    this._initStudioMenu();
    this._initStudioBg();
    this._markActiveTheme();
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
    document.body.setAttribute('data-page', 'editor');
    document.body.classList.add('in-editor');
    if (!this._menuBound) this._initStudioMenu();
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
    const lang = this.lang || 'fa';
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.body.dir = lang === 'fa' ? 'rtl' : 'ltr';

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = t(key, lang);
      if (val) el.textContent = val;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = t(key, lang);
      if (val) el.setAttribute('placeholder', val);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(el => {
      const key = el.getAttribute('data-i18n-aria');
      const val = t(key, lang);
      if (val) el.setAttribute('aria-label', val);
    });

    const st = document.getElementById('playerStatus');
    if (st) {
      st.textContent = this.engine?.isPlaying ? t('playing', lang) : t('ready', lang);
    }
    // Re-render dynamic lists so labels follow language where possible
    try { this._renderSidebar?.(); } catch (_) {}
    try { this._updateSideStatus?.(); } catch (_) {}
    this._markActiveTheme?.();
  }


  _tt(key) { return t(key, this.lang || 'fa'); }


  _initStudioMenu() {
    if (this._menuBound) return;
    this._menuBound = true;

    const btn = document.getElementById('hamburgerBtn');
    const drawer = document.getElementById('navDrawer');
    const overlay = document.getElementById('navOverlay');
    const closeBtn = document.getElementById('navClose');
    const accBtn = document.getElementById('themeAccordionBtn');
    const accPanel = document.getElementById('themeAccordionPanel');

    if (!btn || !drawer) {
      console.warn('[Menu] elements missing');
      this._menuBound = false;
      return;
    }

    // Ensure fully inert when closed
    const setClosedDom = () => {
      drawer.classList.remove('open');
      overlay?.classList.remove('open');
      document.documentElement.removeAttribute('data-menu');
      document.body.classList.remove('menu-open');
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('is-open');
      drawer.setAttribute('hidden', '');
      drawer.setAttribute('aria-hidden', 'true');
      drawer.setAttribute('inert', '');
      if (overlay) {
        overlay.setAttribute('hidden', '');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.setAttribute('inert', '');
      }
    };

    const openMenu = () => {
      drawer.removeAttribute('hidden');
      drawer.removeAttribute('inert');
      drawer.setAttribute('aria-hidden', 'false');
      if (overlay) {
        overlay.removeAttribute('hidden');
        overlay.removeAttribute('inert');
        overlay.setAttribute('aria-hidden', 'false');
      }
      // reflow then animate
      void drawer.offsetWidth;
      document.documentElement.setAttribute('data-menu', 'open');
      drawer.classList.add('open');
      overlay?.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      btn.classList.add('is-open');
      document.body.classList.add('menu-open');
      this._markActiveTheme();
    };

    const closeMenu = () => {
      drawer.classList.remove('open');
      overlay?.classList.remove('open');
      document.documentElement.removeAttribute('data-menu');
      btn.setAttribute('aria-expanded', 'false');
      btn.classList.remove('is-open');
      document.body.classList.remove('menu-open');
      setTimeout(setClosedDom, 300);
    };

    // Initial closed state (no layout impact)
    setClosedDom();

    this._openMenu = openMenu;
    this._closeMenu = closeMenu;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (document.documentElement.getAttribute('data-menu') === 'open') closeMenu();
      else openMenu();
    }, true);

    closeBtn?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
    }, true);

    overlay?.addEventListener('click', () => closeMenu(), true);

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.documentElement.getAttribute('data-menu') === 'open') {
        closeMenu();
      }
    });

    // Theme accordion (independent of menu open/close persistence via local flag)
    if (accBtn && accPanel) {
      const savedAcc = localStorage.getItem('ae-theme-acc') === '1';
      if (savedAcc) {
        accPanel.hidden = false;
        accBtn.setAttribute('aria-expanded', 'true');
        accBtn.classList.add('open');
      }
      accBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const open = accPanel.hidden;
        accPanel.hidden = !open;
        accBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        accBtn.classList.toggle('open', open);
        localStorage.setItem('ae-theme-acc', open ? '1' : '0');
      });
    }

    drawer.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el || !drawer.contains(el)) return;
      e.preventDefault();
      e.stopPropagation();
      const action = el.getAttribute('data-action');

      if (action === 'home') {
        closeMenu();
        this._goHome();
      } else if (action === 'export') {
        closeMenu();
        if (document.body.getAttribute('data-page') !== 'editor') {
          this._toast?.('info', this._tt('export') || 'Export', this._tt('upload_first') || 'ابتدا فایل بارگذاری کنید');
          return;
        }
        document.getElementById('playerPanel')?.scrollIntoView({ behavior: 'smooth' });
        setTimeout(() => {
          if (typeof this._export === 'function') this._export();
          else document.getElementById('btnExport')?.click();
        }, 150);
      } else if (action === 'theme-set') {
        const th = el.getAttribute('data-theme');
        if (th) this._setTheme(th);
        this._markActiveTheme();
      }
    });
  }

  _goHome() {
    document.body.setAttribute('data-page', 'landing');
    document.body.classList.remove('in-editor', 'is-playing-pulse');
    const landing = document.getElementById('landing');
    const main = document.getElementById('mainApp');
    if (landing) {
      landing.classList.remove('hidden');
      landing.style.display = '';
      landing.style.pointerEvents = '';
      landing.removeAttribute('aria-hidden');
    }
    if (main) main.style.display = 'none';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (typeof this._startLandingViz === 'function' && this.$.landingViz) {
      try { this._startLandingViz(); } catch (_) {}
    }
  }

  _markActiveTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'nebula';
    document.querySelectorAll('.theme-opt').forEach(btn => {
      const on = btn.getAttribute('data-theme') === cur;
      btn.classList.toggle('active-theme', on);
      btn.setAttribute('aria-current', on ? 'true' : 'false');
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
    const allowed = ['nebula', 'ember', 'arctic', 'vinyl', 'daylight', 'dark', 'light'];
    let next = allowed.includes(theme) ? theme : 'nebula';
    // map legacy
    if (next === 'dark') next = 'nebula';
    if (next === 'light') next = 'daylight';
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.setAttribute('data-theme-name', next);
    localStorage.setItem('ae-theme', next);
    this._markActiveTheme?.();
  }

  _initTheme() {
    let saved = localStorage.getItem('ae-theme') || 'nebula';
    if (saved === 'dark') saved = 'nebula';
    if (saved === 'light') saved = 'daylight';
    this._setTheme(saved);
  }

  _toggleTheme() {
    const order = ['nebula', 'ember', 'arctic', 'vinyl'];
    const cur = document.documentElement.getAttribute('data-theme') || 'nebula';
    const i = order.indexOf(cur);
    this._setTheme(order[(i + 1) % order.length]);
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
      if (e.target.closest('#btnRunVocalRemoval')) {
        e.preventDefault();
        this._runVocalRemoval();
        return;
      }
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
    this._bindVocalStudio();

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
    // Global ambient pulse for entire editor (theme-aware CSS)
    document.body.classList.toggle('is-playing-pulse', !!playing);
    document.documentElement.classList.toggle('is-playing-pulse', !!playing);
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
    } else if (id === 'vocalRemoval') {
      body += this._chips(id, 'quality', 'کیفیت پردازش', [
        { v: 'fast', l: 'سریع (Fast)' }, { v: 'high', l: 'کیفیت بالا (HQ)' }
      ], p.quality || 'high');
      body += this._slider(id, 'strength', 'قدرت حذف Vocal', 0, 100, (p.strength ?? 0.9) * 100, 0.01);
      body += this._slider(id, 'vocalSuppress', 'حذف Residual', 0, 100, (p.vocalSuppress ?? 0.8) * 100, 0.01);
      body += this._slider(id, 'instrumentPreserve', 'حفظ سازها', 0, 100, (p.instrumentPreserve ?? 0.7) * 100, 0.01);
      body += this._slider(id, 'stereoPreserve', 'حفظ استریو', 0, 100, (p.stereoPreserve ?? 0.85) * 100, 0.01);
      body += this._slider(id, 'outputGain', 'Gain خروجی', 50, 150, (p.outputGain ?? 1) * 100, 0.01);
      body += `<div class="control-row" style="margin-top:0.75rem">
        <button type="button" class="btn btn-primary" id="btnRunVocalRemoval" style="width:100%">
          اعمال حذف صدای خواننده
        </button>
        <p style="font-size:0.75rem;color:var(--text-muted);margin-top:0.5rem;line-height:1.45">
          پردازش Offline پیشرفته (V2.5.1). پس از اتمام، Original / Instrumental / Vocal را مقایسه کنید.
          بهترین نتیجه روی ترک Stereo با Vocal مرکزی است. برای خروجی تمیزتر کیفیت HQ را انتخاب کنید.
        </p>
      </div>`;
      if (this.engine.separationMeta) {
        const c = Math.round((this.engine.separationMeta.confidence || 0) * 100);
        body += `<div class="control-row"><div class="control-label">
          <span>نتیجه جداسازی</span>
          <span class="val">اطمینان ~${c}٪</span>
        </div></div>`;
      }
    } else {
      body += this._slider(id, 'intensity', 'شدت فیلتر', 0, 100, (p.intensity ?? 0.7) * 100, 0.01);
    }

    this.$.controlsContent.innerHTML = body;
  }


  async _runVocalRemoval() {
    if (!this.engine.originalBuffer) {
      this._toast('error', 'فایلی نیست', 'ابتدا یک فایل صوتی آپلود کنید');
      return;
    }
    if (this.isProcessing) return;
    if (!this.effectState.vocalRemoval) {
      this._toast('error', 'افکت موجود نیست', 'vocalRemoval در رجیستری نیست');
      return;
    }
    this.effectState.vocalRemoval.enabled = true;
    const cb = this.$.effectsSidebar.querySelector('input[data-toggle="vocalRemoval"]');
    if (cb) cb.checked = true;
    const item = this.$.effectsSidebar.querySelector('[data-id="vocalRemoval"]');
    if (item) item.classList.add('active-fx');

    const params = { ...this.effectState.vocalRemoval.params };
    this.isProcessing = true;
    if (this.$.btnExport) this.$.btnExport.disabled = true;
    this._showOverlay('شروع جداسازی Vocal...');

    try {
      const result = await this.engine.processVocalRemoval(params, (p, label) => {
        if (this.$.progressFill) this.$.progressFill.style.width = Math.round(p * 100) + '%';
        if (this.$.overlayText) this.$.overlayText.textContent = label || ('جداسازی... ' + Math.round(p * 100) + '٪');
      });
      this._hideOverlay();
      this._syncEffects();
      this._updateChain();
      this.engine.setPlaybackSource('instrumental');
      this._ensureVocalAB();
      const conf = Math.round((result.confidence || 0) * 100);
      if (conf < 30) {
        this._toast('warning', 'جداسازی ضعیف', 'اطمینان پایین (' + conf + '٪). ممکن است Vocal باقی بماند.');
      } else {
        this._toast('success', 'Instrumental آماده است', 'اطمینان تقریبی ' + conf + '٪ — A/B را امتحان کنید');
      }
      if (this.selectedEffect === 'vocalRemoval') this._renderControls('vocalRemoval');
    } catch (err) {
      this._hideOverlay();
      this._toast('error', 'پردازش ناموفق', (err && err.message) || 'جداسازی انجام نشد');
      console.error(err);
    } finally {
      this.isProcessing = false;
      if (this.$.btnExport) this.$.btnExport.disabled = false;
    }
  }

  _ensureVocalAB() {
    const switchEl = document.querySelector('.mode-switch');
    if (!switchEl || document.getElementById('modeInstrumental')) return;
    const btnI = document.createElement('button');
    btnI.type = 'button';
    btnI.id = 'modeInstrumental';
    btnI.textContent = 'Instrumental';
    btnI.className = 'active';
    const btnV = document.createElement('button');
    btnV.type = 'button';
    btnV.id = 'modeVocals';
    btnV.textContent = 'Vocal';
    switchEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
    switchEl.appendChild(btnI);
    switchEl.appendChild(btnV);
    btnI.addEventListener('click', () => {
      this.engine.setPlaybackSource('instrumental');
      switchEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btnI.classList.add('active');
    });
    btnV.addEventListener('click', () => {
      if (!this.engine.setPlaybackSource('vocals')) {
        this._toast('warning', 'موجود نیست', 'Stem وکال در دسترس نیست');
        return;
      }
      switchEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btnV.classList.add('active');
    });
    const orig = document.getElementById('modeOriginal');
    if (orig) {
      orig.addEventListener('click', () => {
        this.engine.setPlaybackSource('original');
        switchEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        orig.classList.add('active');
      });
    }
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


  /* ── AI Vocal Production Studio ── */
  _bindVocalStudio() {
    const run = document.getElementById('btnVsRun');
    const analyze = document.getElementById('btnVsAnalyze');
    const abort = document.getElementById('btnVsAbort');
    const abO = document.getElementById('btnVsOriginal');
    const abP = document.getElementById('btnVsProcessed');
    const inten = document.getElementById('vsIntensity');
    const nat = document.getElementById('vsNatural');
    const intenVal = document.getElementById('vsIntensityVal');
    const natVal = document.getElementById('vsNaturalVal');

    if (inten) inten.addEventListener('input', () => {
      if (intenVal) intenVal.textContent = inten.value + '٪';
    });
    if (nat) nat.addEventListener('input', () => {
      if (natVal) natVal.textContent = nat.value + '٪';
    });
    if (run) run.addEventListener('click', () => this._vsRunFull());
    if (analyze) analyze.addEventListener('click', () => this._vsAnalyzeOnly());
    if (abort) abort.addEventListener('click', () => {
      this.vocalStudio.abort();
      this._toast('info', 'لغو', 'درخواست لغو ارسال شد');
    });
    if (abO) abO.addEventListener('click', () => this._vsPlayAB('original'));
    if (abP) abP.addEventListener('click', () => this._vsPlayAB('processed'));
  }

  _vsCollectOptions() {
    const style = document.getElementById('vsStyle')?.value || 'pop';
    const intensity = (parseInt(document.getElementById('vsIntensity')?.value || '70', 10)) / 100;
    const naturalness = (parseInt(document.getElementById('vsNatural')?.value || '60', 10)) / 100;
    return { style, intensity, naturalness };
  }

  _vsSetStage(active, doneUpTo = 0) {
    document.querySelectorAll('.vs-stage').forEach(el => {
      const s = parseInt(el.dataset.stage, 10);
      el.classList.toggle('active', s === active);
      el.classList.toggle('done', s <= doneUpTo && s !== active);
    });
  }

  _vsProgress(stage, p, label) {
    const wrap = document.getElementById('vsProgressWrap');
    const fill = document.getElementById('vsProgressFill');
    const lab = document.getElementById('vsProgressLabel');
    if (wrap) wrap.hidden = false;
    if (fill) fill.style.width = Math.round(p * 100) + '%';
    if (lab) lab.textContent = (stageLabel(stage) || '') + (label ? ' — ' + label : '');
    this._vsSetStage(stage, stage - 1);
  }

  async _vsRunFull() {
    if (!this.engine.originalBuffer) {
      this._toast('error', 'فایلی نیست', 'ابتدا یک فایل صوتی آپلود کنید');
      return;
    }
    if (this._vsBusy) return;
    this._vsBusy = true;
    const abortBtn = document.getElementById('btnVsAbort');
    if (abortBtn) abortBtn.hidden = false;
    if (this.$.btnExport) this.$.btnExport.disabled = true;

    this.vocalStudio.reset();
    this.vocalStudio.setOptions(this._vsCollectOptions());

    try {
      const report = await this.vocalStudio.runFull(
        this.engine.originalBuffer,
        this.engine.meta || {},
        (stage, p, label) => this._vsProgress(stage, p, label)
      );
      this._vsSetStage(3, 3);
      const reportEl = document.getElementById('vsReport');
      if (reportEl) reportEl.innerHTML = formatReportHTML(report);

      const proc = this.vocalStudio.getProcessedBuffer();
      if (proc) {
        this.engine._vsOutputBuffer = proc;
        this.engine.player.setBuffer(proc);
        document.getElementById('btnVsOriginal')?.removeAttribute('disabled');
        document.getElementById('btnVsProcessed')?.removeAttribute('disabled');
        this._toast('success', 'وکال آماده است', 'A/B را امتحان کنید');
      }
    } catch (err) {
      if (err && err.message === 'ABORTED') {
        this._toast('info', 'لغو شد', 'پردازش متوقف شد');
      } else {
        console.error(err);
        this._toast('error', 'خطا', (err && err.message) || 'پردازش ناموفق');
      }
    } finally {
      this._vsBusy = false;
      if (abortBtn) abortBtn.hidden = true;
      if (this.$.btnExport) this.$.btnExport.disabled = false;
      const wrap = document.getElementById('vsProgressWrap');
      if (wrap) setTimeout(() => { wrap.hidden = true; }, 800);
    }
  }

  async _vsAnalyzeOnly() {
    if (!this.engine.originalBuffer) {
      this._toast('error', 'فایلی نیست', 'ابتدا یک فایل صوتی آپلود کنید');
      return;
    }
    if (this._vsBusy) return;
    this._vsBusy = true;
    try {
      this.vocalStudio.reset();
      const diagnosis = await this.vocalStudio.runAnalyze(
        this.engine.originalBuffer,
        this.engine.meta || {},
        (stage, p, label) => this._vsProgress(stage, p, label)
      );
      this._vsSetStage(1, 1);
      const reportEl = document.getElementById('vsReport');
      if (reportEl) reportEl.innerHTML = formatReportHTML({ diagnosis });
      this._toast('success', 'تحلیل کامل', `اطمینان ${Math.round((diagnosis.analysisConfidence || 0) * 100)}٪`);
    } catch (err) {
      console.error(err);
      this._toast('error', 'خطا', (err && err.message) || 'تحلیل ناموفق');
    } finally {
      this._vsBusy = false;
      const wrap = document.getElementById('vsProgressWrap');
      if (wrap) setTimeout(() => { wrap.hidden = true; }, 600);
    }
  }

  _vsPlayAB(which) {
    const orig = this.vocalStudio.getOriginalBuffer() || this.engine.originalBuffer;
    const proc = this.vocalStudio.getProcessedBuffer();
    const buf = which === 'processed' ? proc : orig;
    if (!buf) return;
    const was = this.engine.player.isPlaying;
    const t = this.engine.player.currentTime;
    this.engine.player.setBuffer(buf);
    if (was) this.engine.player.play(Math.min(t, buf.duration));
    else this.engine.player.play(0);
    this._toast('info', 'A/B', which === 'processed' ? 'پردازش‌شده' : 'اصلی');
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
