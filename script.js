/**
 * FLUX — Deep Focus App
 * script.js — Modular vanilla JS
 *
 * Modules:
 *  1. App Init & Loader
 *  2. State Management
 *  3. Timer Engine
 *  4. Ring Renderer
 *  5. Task Manager
 *  6. Stats Engine
 *  7. Settings Modal
 *  8. Background Controller
 *  9. Focus Mode
 * 10. Sound Engine
 * 11. Keyboard Shortcuts
 * 12. Toast Notifications
 * 13. Mobile Nav
 */

'use strict';

/* ═══════════════════════════════════════
   1. APP STATE
═══════════════════════════════════════ */
const STATE = {
  // Timer state
  timer: {
    running:       false,
    mode:          'work',     // 'work' | 'short' | 'long'
    secondsLeft:   25 * 60,
    totalSeconds:  25 * 60,
    sessionCount:  0,
    intervalId:    null,
  },

  // Settings (loaded from localStorage)
  settings: {
    focusDuration:    25,
    shortBreak:        5,
    longBreak:        15,
    longBreakAfter:    4,
    soundEnabled:   true,
    autoBreak:      false,
  },

  // Stats (persisted per-day)
  stats: {
    sessionsToday:  0,
    minutesToday:   0,
    tasksCompleted: 0,
    streak:         0,
    lastActiveDate: null,
    weekActivity:   {}, // { 'YYYY-MM-DD': sessions }
  },

  // UI state
  ui: {
    focusMode:    false,
    bgMode:       'gradient', // 'video' | 'gradient'
    dimLevel:     40,
    activePanel:  'timer',
  }
};

/* ═══════════════════════════════════════
   2. PERSISTENCE HELPERS
═══════════════════════════════════════ */
const KEYS = {
  settings: 'flux_settings',
  tasks:    'flux_tasks',
  stats:    'flux_stats',
};

function saveToStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('Storage write failed:', e); }
}

function loadFromStorage(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}

function loadSettings() {
  const saved = loadFromStorage(KEYS.settings);
  if (saved) Object.assign(STATE.settings, saved);
}

function saveSettings() {
  saveToStorage(KEYS.settings, STATE.settings);
}

function loadStats() {
  const saved = loadFromStorage(KEYS.stats);
  if (saved) {
    Object.assign(STATE.stats, saved);
    // Reset daily stats if it's a new day
    const today = getTodayStr();
    if (STATE.stats.lastActiveDate !== today) {
      STATE.stats.sessionsToday = 0;
      STATE.stats.minutesToday  = 0;
      // Update streak
      const yesterday = getDateStr(-1);
      if (STATE.stats.lastActiveDate === yesterday) {
        STATE.stats.streak = (STATE.stats.streak || 0) + 1;
      } else if (STATE.stats.lastActiveDate !== today) {
        STATE.stats.streak = 0;
      }
      STATE.stats.lastActiveDate = today;
      saveToStorage(KEYS.stats, STATE.stats);
    }
  }
}

function saveStat() {
  STATE.stats.lastActiveDate = getTodayStr();
  saveToStorage(KEYS.stats, STATE.stats);
}

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getDateStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

/* ═══════════════════════════════════════
   3. TIMER ENGINE
═══════════════════════════════════════ */
const Timer = {
  /** Initialise duration from settings + mode */
  init(mode) {
    clearInterval(STATE.timer.intervalId);
    STATE.timer.running      = false;
    STATE.timer.mode         = mode;
    STATE.timer.secondsLeft  = Timer.durationFor(mode) * 60;
    STATE.timer.totalSeconds = STATE.timer.secondsLeft;
    Timer.updateUI();
    Ring.render(1); // Full ring on init
    Buttons.setPlayIcon(false);
    PlayBtn.setBreakMode(mode !== 'work');
  },

  durationFor(mode) {
    const s = STATE.settings;
    if (mode === 'work')  return s.focusDuration;
    if (mode === 'short') return s.shortBreak;
    if (mode === 'long')  return s.longBreak;
    return s.focusDuration;
  },

  start() {
    if (STATE.timer.running) return;
    STATE.timer.running = true;
    Buttons.setPlayIcon(true);
    document.getElementById('timerRingContainer').classList.add('running');

    STATE.timer.intervalId = setInterval(() => {
      STATE.timer.secondsLeft--;

      if (STATE.timer.secondsLeft < 0) {
        Timer.complete();
        return;
      }

      Timer.updateUI();
      Ring.render(STATE.timer.secondsLeft / STATE.timer.totalSeconds);
    }, 1000);
  },

  pause() {
    clearInterval(STATE.timer.intervalId);
    STATE.timer.running = false;
    Buttons.setPlayIcon(false);
    document.getElementById('timerRingContainer').classList.remove('running');
  },

  toggle() {
    STATE.timer.running ? Timer.pause() : Timer.start();
  },

  reset() {
    Timer.init(STATE.timer.mode);
  },

  skip() {
    Timer.complete(true);
  },

  complete(manual = false) {
    clearInterval(STATE.timer.intervalId);
    STATE.timer.running = false;
    document.getElementById('timerRingContainer').classList.remove('running');
    Buttons.setPlayIcon(false);

    if (STATE.timer.mode === 'work') {
      // Record completed session
      STATE.timer.sessionCount++;
      STATE.stats.sessionsToday++;
      STATE.stats.minutesToday += STATE.settings.focusDuration;
      if (!STATE.stats.weekActivity) STATE.stats.weekActivity = {};
      const today = getTodayStr();
      STATE.stats.weekActivity[today] = (STATE.stats.weekActivity[today] || 0) + 1;
      STATE.stats.lastActiveDate = today;
      saveStat();
      Stats.render();

      if (!manual) {
        Sound.playDone();
        showToast('🎉 Focus session complete!');
      }

      // Determine next break
      const isLong = STATE.timer.sessionCount % STATE.settings.longBreakAfter === 0;
      const nextMode = isLong ? 'long' : 'short';

      if (STATE.settings.autoBreak) {
        setTimeout(() => {
          switchMode(nextMode, true);
          Timer.start();
        }, 1200);
      } else {
        setTimeout(() => switchMode(nextMode), 800);
      }

    } else {
      // Break ended → back to work
      if (!manual) {
        Sound.playBreakEnd();
        showToast('Break over — back to focus!');
      }
      if (STATE.settings.autoBreak) {
        setTimeout(() => { switchMode('work', true); Timer.start(); }, 1200);
      } else {
        setTimeout(() => switchMode('work'), 800);
      }
    }

    // Update session label
    document.getElementById('timerSession').textContent = `Session ${STATE.timer.sessionCount + 1}`;
  },

  updateUI() {
    const m = Math.floor(STATE.timer.secondsLeft / 60).toString().padStart(2, '0');
    const s = (STATE.timer.secondsLeft % 60).toString().padStart(2, '0');
    document.getElementById('timerDisplay').textContent = `${m}:${s}`;
    document.title = `${m}:${s} — Flux`;
  }
};

/* ═══════════════════════════════════════
   4. RING RENDERER
═══════════════════════════════════════ */
const Ring = {
  circumference: 753.98,

  render(progress) {
    const offset = this.circumference * (1 - Math.max(0, Math.min(1, progress)));
    document.getElementById('ringProgress').style.strokeDashoffset = offset;
  }
};

/* ═══════════════════════════════════════
   5. PLAY BUTTON HELPERS
═══════════════════════════════════════ */
const Buttons = {
  setPlayIcon(playing) {
    const btn = document.getElementById('startBtn');
    const playIcon  = btn.querySelector('.icon-play');
    const pauseIcon = btn.querySelector('.icon-pause');
    if (playing) {
      playIcon.classList.add('hidden');
      pauseIcon.classList.remove('hidden');
    } else {
      playIcon.classList.remove('hidden');
      pauseIcon.classList.add('hidden');
    }
  }
};

const PlayBtn = {
  setBreakMode(isBreak) {
    const btn  = document.getElementById('startBtn');
    const ring = document.getElementById('ringProgress');
    const lbl  = document.getElementById('timerLabel');

    if (isBreak) {
      btn.classList.add('break-mode');
      ring.classList.add('break-mode');
      lbl.classList.add('break-mode');
    } else {
      btn.classList.remove('break-mode');
      ring.classList.remove('break-mode');
      lbl.classList.remove('break-mode');
    }
  }
};

/** Switch mode tab & re-init timer */
function switchMode(mode, silent = false) {
  STATE.timer.mode = mode;

  // Update tab UI
  document.querySelectorAll('.mode-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });

  // Update label
  const labels = { work: 'FOCUS', short: 'SHORT BREAK', long: 'LONG BREAK' };
  document.getElementById('timerLabel').textContent = labels[mode] || 'FOCUS';

  Timer.init(mode);

  if (!silent) Ring.render(1);
}

/* ═══════════════════════════════════════
   6. TASK MANAGER
═══════════════════════════════════════ */
const Tasks = {
  items: [],

  load() {
    this.items = loadFromStorage(KEYS.tasks, []);
    this.render();
  },

  save() {
    saveToStorage(KEYS.tasks, this.items);
  },

  add(text) {
    if (!text.trim()) return;
    this.items.push({
      id:   Date.now(),
      text: text.trim(),
      done: false
    });
    this.save();
    this.render();
  },

  toggle(id) {
    const task = this.items.find(t => t.id === id);
    if (!task) return;
    task.done = !task.done;

    if (task.done) {
      STATE.stats.tasksCompleted++;
      saveStat();
      Stats.render();
    } else {
      STATE.stats.tasksCompleted = Math.max(0, STATE.stats.tasksCompleted - 1);
      saveStat();
      Stats.render();
    }

    this.save();
    this.render();
  },

  delete(id) {
    this.items = this.items.filter(t => t.id !== id);
    this.save();
    this.render();
  },

  clearCompleted() {
    this.items = this.items.filter(t => !t.done);
    this.save();
    this.render();
  },

  render() {
    const list = document.getElementById('taskList');
    const remaining = this.items.filter(t => !t.done).length;
    document.getElementById('taskCount').textContent =
      remaining === 0 ? 'all done ✓' : `${remaining} remaining`;

    list.innerHTML = '';

    if (this.items.length === 0) {
      list.innerHTML = `<li style="text-align:center;padding:var(--gap-xl) 0;color:var(--text-tertiary);font-size:0.82rem;font-family:'DM Mono',monospace;letter-spacing:0.1em;">no tasks yet</li>`;
      return;
    }

    // Sort: undone first, done last
    const sorted = [...this.items].sort((a, b) => a.done - b.done);

    sorted.forEach(task => {
      const li = document.createElement('li');
      li.className = `task-item${task.done ? ' done' : ''}`;
      li.setAttribute('role', 'listitem');
      li.innerHTML = `
        <input type="checkbox" class="task-checkbox" ${task.done ? 'checked' : ''} aria-label="Complete task" />
        <span class="task-text">${escapeHtml(task.text)}</span>
        <button class="task-del-btn" aria-label="Delete task">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      `;
      li.querySelector('.task-checkbox').addEventListener('change', () => this.toggle(task.id));
      li.querySelector('.task-del-btn').addEventListener('click', () => this.delete(task.id));
      list.appendChild(li);
    });
  }
};

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ═══════════════════════════════════════
   7. STATS ENGINE
═══════════════════════════════════════ */
const Stats = {
  render() {
    document.getElementById('statSessions').textContent = STATE.stats.sessionsToday;
    document.getElementById('statMinutes').textContent  = STATE.stats.minutesToday;
    document.getElementById('statStreak').textContent   = STATE.stats.streak || 0;
    document.getElementById('statTasks').textContent    = STATE.stats.tasksCompleted || 0;
    this.renderWeek();
  },

  renderWeek() {
    const grid    = document.getElementById('weekGrid');
    const today   = new Date();
    const days    = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    const activity = STATE.stats.weekActivity || {};

    grid.innerHTML = '';

    for (let i = 6; i >= 0; i--) {
      const d     = new Date(today);
      d.setDate(today.getDate() - i);
      const key   = d.toISOString().slice(0, 10);
      const label = days[d.getDay()];
      const count = activity[key] || 0;
      const isToday = (i === 0);

      const col = document.createElement('div');
      col.className = 'week-day';
      col.innerHTML = `
        <span class="week-day-label">${label}</span>
        <div class="week-day-dot ${count > 0 ? (isToday ? 'today' : 'active') : (isToday ? 'today' : '')}" title="${count} session${count !== 1 ? 's' : ''}">
          ${count > 0 ? count : ''}
        </div>
      `;
      grid.appendChild(col);
    }
  }
};

/* ═══════════════════════════════════════
   8. SETTINGS MODAL
═══════════════════════════════════════ */
const SettingsModal = {
  open() {
    // Populate fields
    document.getElementById('setFocus').value         = STATE.settings.focusDuration;
    document.getElementById('setShortBreak').value    = STATE.settings.shortBreak;
    document.getElementById('setLongBreak').value     = STATE.settings.longBreak;
    document.getElementById('setLongBreakAfter').value = STATE.settings.longBreakAfter;
    document.getElementById('setSoundEnabled').checked = STATE.settings.soundEnabled;
    document.getElementById('setAutoBreak').checked    = STATE.settings.autoBreak;
    document.getElementById('settingsBackdrop').classList.remove('hidden');
  },

  close() {
    document.getElementById('settingsBackdrop').classList.add('hidden');
  },

  save() {
    const get = id => parseInt(document.getElementById(id).value, 10);
    STATE.settings.focusDuration    = Math.max(1, get('setFocus'));
    STATE.settings.shortBreak       = Math.max(1, get('setShortBreak'));
    STATE.settings.longBreak        = Math.max(1, get('setLongBreak'));
    STATE.settings.longBreakAfter   = Math.max(2, get('setLongBreakAfter'));
    STATE.settings.soundEnabled     = document.getElementById('setSoundEnabled').checked;
    STATE.settings.autoBreak        = document.getElementById('setAutoBreak').checked;
    saveSettings();
    this.close();
    // Re-init current mode with new durations
    if (!STATE.timer.running) switchMode(STATE.timer.mode);
    showToast('Settings saved');
  }
};

/* ═══════════════════════════════════════
   9. BACKGROUND CONTROLLER
═══════════════════════════════════════ */
const Background = {
  init() {
    const video   = document.getElementById('bgVideo');
    const bgLayer = document.getElementById('bgLayer');

    // Attempt to use a free ambient video via direct URL
    // Using a reliable Unsplash/Pexels embed source
    const videoSources = [
      'https://videos.pexels.com/video-files/3163534/3163534-uhd_2560_1440_25fps.mp4',
    ];

    video.addEventListener('loadeddata', () => {
      video.classList.add('loaded');
    });

    video.addEventListener('error', () => {
      // Silently fall back to gradient
      this.setMode('gradient');
    });

    // Default to gradient (video requires external source)
    this.setMode('gradient');

    // Dim slider
    const slider = document.getElementById('dimSlider');
    slider.value = STATE.ui.dimLevel;
    slider.addEventListener('input', e => {
      this.setDim(parseInt(e.target.value));
    });
  },

  setMode(mode) {
    STATE.ui.bgMode = mode;
    const bgLayer = document.getElementById('bgLayer');
    const video   = document.getElementById('bgVideo');

    document.getElementById('bgVideoBtn').classList.toggle('active', mode === 'video');
    document.getElementById('bgGradientBtn').classList.toggle('active', mode === 'gradient');

    if (mode === 'video') {
      bgLayer.classList.remove('gradient-mode');
      if (!video.src) {
        video.src = 'https://videos.pexels.com/video-files/3163534/3163534-uhd_2560_1440_25fps.mp4';
        video.load();
        video.play().catch(() => this.setMode('gradient'));
      }
    } else {
      bgLayer.classList.add('gradient-mode');
    }
  },

  setDim(level) {
    STATE.ui.dimLevel = level;
    const alpha = level / 100;
    document.getElementById('bgOverlay').style.background = `rgba(8,8,8,${alpha})`;
  }
};

/* ═══════════════════════════════════════
   10. FOCUS MODE
═══════════════════════════════════════ */
const FocusMode = {
  hint: null,
  hintTimeout: null,

  toggle() {
    STATE.ui.focusMode = !STATE.ui.focusMode;
    document.getElementById('app').classList.toggle('focus-mode', STATE.ui.focusMode);

    if (STATE.ui.focusMode) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      this.showHint();
    } else {
      document.exitFullscreen?.().catch(() => {});
      this.hideHint();
    }
  },

  exit() {
    if (!STATE.ui.focusMode) return;
    this.toggle();
  },

  showHint() {
    const hint = document.getElementById('focusHint');
    hint.classList.remove('hidden', 'fading');
    clearTimeout(this.hintTimeout);
    this.hintTimeout = setTimeout(() => {
      hint.classList.add('fading');
      setTimeout(() => hint.classList.add('hidden'), 500);
    }, 3000);
  },

  hideHint() {
    const hint = document.getElementById('focusHint');
    hint.classList.add('hidden');
  }
};

/* ═══════════════════════════════════════
   11. SOUND ENGINE
═══════════════════════════════════════ */
const Sound = {
  ctx: null,

  _getCtx() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    return this.ctx;
  },

  _tone(freq, duration, type = 'sine', gain = 0.18) {
    if (!STATE.settings.soundEnabled) return;
    try {
      const ctx = this._getCtx();
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.connect(vol);
      vol.connect(ctx.destination);
      osc.type      = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      vol.gain.setValueAtTime(gain, ctx.currentTime);
      vol.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) { /* Audio not supported */ }
  },

  playDone() {
    // Ascending chime — G4, B4, D5
    this._tone(392, 0.3);
    setTimeout(() => this._tone(494, 0.3), 200);
    setTimeout(() => this._tone(587, 0.6), 400);
  },

  playBreakEnd() {
    // Gentle nudge
    this._tone(523, 0.4);
    setTimeout(() => this._tone(440, 0.4), 250);
  },

  playTick() {
    this._tone(880, 0.05, 'sine', 0.04);
  }
};

/* ═══════════════════════════════════════
   12. TOAST NOTIFICATIONS
═══════════════════════════════════════ */
let toastEl  = null;
let toastTid = null;

function showToast(message, duration = 2500) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  clearTimeout(toastTid);
  toastEl.textContent = message;
  toastEl.classList.add('show');
  toastTid = setTimeout(() => toastEl.classList.remove('show'), duration);
}

/* ═══════════════════════════════════════
   13. PANEL NAVIGATION
═══════════════════════════════════════ */
function switchPanel(name) {
  STATE.ui.activePanel = name;

  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn, .mobile-nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.panel === name);
  });

  const target = document.getElementById(`panel-${name}`);
  if (target) {
    target.classList.add('active');
    // Re-trigger animation
    target.style.animation = 'none';
    requestAnimationFrame(() => { target.style.animation = ''; });
  }
}

/* ═══════════════════════════════════════
   14. MOBILE NAV INJECTION
═══════════════════════════════════════ */
function buildMobileNav() {
  const nav = document.createElement('nav');
  nav.className = 'mobile-nav';
  nav.innerHTML = `
    <button class="mobile-nav-btn active" data-panel="timer" aria-label="Timer">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>
      timer
    </button>
    <button class="mobile-nav-btn" data-panel="tasks" aria-label="Tasks">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
      tasks
    </button>
    <button class="mobile-nav-btn" data-panel="stats" aria-label="Stats">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
      stats
    </button>
  `;
  document.body.appendChild(nav);
  nav.addEventListener('click', e => {
    const btn = e.target.closest('.mobile-nav-btn');
    if (btn?.dataset.panel) switchPanel(btn.dataset.panel);
  });
}

/* ═══════════════════════════════════════
   15. KEYBOARD SHORTCUTS
═══════════════════════════════════════ */
function initKeyboard() {
  document.addEventListener('keydown', e => {
    // Don't intercept when typing in inputs
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      if (e.key === 'Enter' && document.activeElement.id === 'taskInput') {
        e.preventDefault();
        addTaskFromInput();
      }
      return;
    }

    switch (e.key) {
      case ' ':
        e.preventDefault();
        Timer.toggle();
        break;
      case 'r':
      case 'R':
        Timer.reset();
        break;
      case 'f':
      case 'F':
        FocusMode.toggle();
        break;
      case 'Escape':
        FocusMode.exit();
        SettingsModal.close();
        break;
      case '1':
        switchPanel('timer');
        break;
      case '2':
        switchPanel('tasks');
        break;
      case '3':
        switchPanel('stats');
        break;
    }
  });
}

/* ═══════════════════════════════════════
   16. EVENT LISTENERS
═══════════════════════════════════════ */
function initEventListeners() {
  // Timer controls
  document.getElementById('startBtn').addEventListener('click', () => Timer.toggle());
  document.getElementById('resetBtn').addEventListener('click', () => Timer.reset());
  document.getElementById('skipBtn').addEventListener('click',  () => Timer.skip());

  // Mode tabs
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (!STATE.timer.running) switchMode(tab.dataset.mode);
      else showToast('Pause timer to switch modes');
    });
  });

  // Nav buttons (header)
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchPanel(btn.dataset.panel));
  });

  // Task input
  document.getElementById('taskAddBtn').addEventListener('click', addTaskFromInput);
  document.getElementById('taskInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addTaskFromInput();
  });
  document.getElementById('clearCompletedBtn').addEventListener('click', () => {
    Tasks.clearCompleted();
    showToast('Cleared completed tasks');
  });

  // Settings
  document.getElementById('settingsBtn').addEventListener('click',      () => SettingsModal.open());
  document.getElementById('closeSettingsBtn').addEventListener('click', () => SettingsModal.close());
  document.getElementById('saveSettingsBtn').addEventListener('click',  () => SettingsModal.save());
  document.getElementById('settingsBackdrop').addEventListener('click', e => {
    if (e.target === document.getElementById('settingsBackdrop')) SettingsModal.close();
  });

  // Focus mode
  document.getElementById('focusModeBtn').addEventListener('click', () => FocusMode.toggle());

  // Background
  document.getElementById('bgVideoBtn').addEventListener('click',    () => Background.setMode('video'));
  document.getElementById('bgGradientBtn').addEventListener('click', () => Background.setMode('gradient'));
}

function addTaskFromInput() {
  const input = document.getElementById('taskInput');
  const text  = input.value.trim();
  if (!text) { input.focus(); return; }
  Tasks.add(text);
  input.value = '';
  input.focus();
}

/* ═══════════════════════════════════════
   17. LOADER + APP INIT
═══════════════════════════════════════ */
function initApp() {
  // Load persisted data
  loadSettings();
  loadStats();
  Tasks.load();

  // Init subsystems
  Background.init();
  Timer.init('work');
  Stats.render();
  buildMobileNav();
  initEventListeners();
  initKeyboard();

  // Hide loader, reveal app
  setTimeout(() => {
    document.getElementById('loader').classList.add('hidden');
    document.getElementById('app').classList.add('visible');
  }, 2000);
}

// Kick off when DOM is ready
document.addEventListener('DOMContentLoaded', initApp);
