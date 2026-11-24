// Performance policy for phones and tablets (render/device.js picks the preset).
//  - Base pixel ratio = min(devicePixelRatio, preset prCap), lowered so the drawing
//    buffer stays within the preset's pixel budget (maxMP): a 2800x1752 tablet at
//    devicePixelRatio 2 would otherwise draw 3.3x the pixels of a phone. The budget is
//    computed on the window size (stable while side panels open and close).
//  - Dynamic resolution: while the user interacts (any pointer down, orbit
//    controls active) the frame interval is measured; if frames are slow the
//    AO pass is suspended first, then the resolution is lowered in steps.
//    When the interaction ends the full resolution (and AO) is restored and
//    one crisp frame is rendered.
//  - AO mode 'rest' (Media): AO is never computed while frames flow (gestures,
//    animations); the frame drawn once the image is still has it.
//  - Thermal / power saving (Android): a hot or battery-saving device gets a lower
//    base resolution until it recovers.
//  - Optional FPS meter HUD.
import { h } from '../ui/kit.js';
import { pixelRatioFor } from './device.js';

const SLOW_MS = 21;   // ~48 fps: degrade
const FAST_MS = 12.5; // ~80 fps: allowed to climb back during the interaction
const STEP = 0.8;
const MIN_CHANGE_GAP = 350; // ms between resolution changes (each one reallocates buffers)
const IDLE_RESTORE_MS = 220;
const MAX_RESTORE_WAIT = 1500; // ms after the gesture ended

export class PerfController {
  constructor(app, shell, pipeline) {
    this.app = app;
    this.shell = shell;
    this.pipeline = pipeline;
    this.prCap = 2;
    this.maxMP = 0;
    this.aoMode = 'on';
    /** extra factor on the base resolution (thermal throttling), 1 = none */
    this.throttle = 1;
    this.dynamic = true;
    this.scale = 1;
    this.interacting = false;
    this._pointers = new Set();
    this._controlsActive = false;
    this._ema = 0;
    this._last = 0;
    this._lastChange = 0;
    this._restoreTimer = 0;
    this._restoreTick = this._restoreTick.bind(this);
    this._lastFrameAt = 0;
    this._releasedAt = 0;
    // AO suspension has two owners: the dynamic-resolution policy (slow gestures) and the
    // 'rest' mode (no AO while frames flow); pipeline.suspendAO = either of them
    this._dynAO = false;
    this._restAO = false;
    this._stillTimer = 0;
    this._stillTick = this._stillTick.bind(this);
    // FPS meter
    this._frames = 0;
    this._fpsT0 = performance.now();
    this._hud = null;
    this._hudTimer = 0;

    const down = (e) => { this._pointers.add(e.pointerId); this._updateInteracting(); };
    const up = (e) => { this._pointers.delete(e.pointerId); this._updateInteracting(); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', () => { this._pointers.clear(); this._updateInteracting(); });
    app.controls.addEventListener('start', () => { this._controlsActive = true; this._updateInteracting(); });
    app.controls.addEventListener('end', () => { this._controlsActive = false; this._updateInteracting(); });
    // window size changes (rotation keeps the area; split screen / free-form windows do not)
    window.addEventListener('resize', () => this._rebase());
    // a frame-time sample is valid only when two consecutive animation ticks both rendered
    this._renderedPrevTick = false;
    this._renderedThisTick = false;
    app.addRenderHook(() => { this._renderedPrevTick = this._renderedThisTick; this._renderedThisTick = false; return false; });
    app.addAfterRenderHook(() => this._afterRender());
    this.basePixelRatio = this._computeBase();
  }

  /** CSS size the pixel budget is computed on: the window (the canvas never exceeds it). */
  _cssSize() {
    const w = Math.max(window.innerWidth || 0, this.app.container?.clientWidth || 0, 1);
    const hh = Math.max(window.innerHeight || 0, this.app.container?.clientHeight || 0, 1);
    return [w, hh];
  }

  _computeBase() {
    const [w, hh] = this._cssSize();
    const pr = pixelRatioFor({ prCap: this.prCap, maxMP: this.maxMP }, w, hh) * this.throttle;
    return Math.max(0.5, Math.round(pr * 100) / 100);
  }

  _rebase() {
    const b = this._computeBase();
    if (Math.abs(b - this.basePixelRatio) < 1e-3) return;
    this.basePixelRatio = b;
    this._apply();
  }

  /** Applies a quality preset ({prCap, maxMP, ao}, see device.js QUALITY). */
  setQuality(q) {
    this.prCap = q.prCap;
    this.maxMP = q.maxMP || 0;
    this.aoMode = q.ao || 'on';
    this.basePixelRatio = this._computeBase();
    this.scale = 1;
    this._dynAO = false;
    this._restAO = false;
    this._syncAO();
    this._apply();
  }

  _syncAO() { this.pipeline.suspendAO = this._dynAO || this._restAO; }

  /** 'rest' mode: hold AO off while frames flow; released once the loop is still. */
  _holdRestAO() {
    if (!this._restAO) { this._restAO = true; this._syncAO(); }
    if (!this._stillTimer) this._stillTimer = setTimeout(this._stillTick, IDLE_RESTORE_MS);
  }

  _stillTick() {
    this._stillTimer = 0;
    if (!this._restAO) return;
    const app = this.app;
    // still = no gesture and the frame loop ran two ticks without drawing (or slept)
    const still = !this.interacting && (!app._looping || app._idleFrames >= 2);
    if (!still) { this._stillTimer = setTimeout(this._stillTick, IDLE_RESTORE_MS * 0.5); return; }
    this._restAO = false;
    this._syncAO();
    this._restFrame = true; // the frame drawn now must not count as "frames flowing"
    this._apply();
  }

  /** Back-compat: a plain pixel-ratio cap (Alta 2, Media 1.75, Bassa 1.25). */
  setCap(cap) { this.setQuality({ prCap: cap, maxMP: this.maxMP, ao: this.aoMode }); }

  /** Thermal / power-saving factor on the base resolution (1 = none). */
  setThrottle(k) {
    const t = Math.max(0.5, Math.min(1, +k || 1));
    if (t === this.throttle) return;
    this.throttle = t;
    this._rebase();
  }

  setDynamic(on) {
    this.dynamic = !!on;
    if (!on && (this.scale !== 1 || this._dynAO)) { this.scale = 1; this._dynAO = false; this._syncAO(); this._apply(); }
  }

  get pixelRatio() { return this.app.renderer.getPixelRatio(); }

  _apply() {
    const pr = Math.round(this.basePixelRatio * this.scale * 100) / 100;
    if (Math.abs(this.app.renderer.getPixelRatio() - pr) > 1e-3) this.app.renderer.setPixelRatio(pr);
    // resolution / AO only: the scene (and its shadow maps) did not change
    if (this.app.invalidateView) this.app.invalidateView(); else this.app.invalidate();
  }

  _updateInteracting() {
    const now = this._pointers.size > 0 || this._controlsActive;
    if (now === this.interacting) return;
    this.interacting = now;
    if (now) {
      clearTimeout(this._restoreTimer); this._restoreTimer = 0; this._last = 0;
      // 'rest': no AO from the first frame of a gesture
      if (this.aoMode === 'rest' && this.pipeline.opts.ao) this._holdRestAO();
    } else { this._releasedAt = performance.now(); this._scheduleRestore(); }
  }

  /** Arms (once) the timer that restores full quality after the interaction ended. */
  _scheduleRestore() {
    if (this._restoreTimer || (this.scale === 1 && !this._dynAO)) return;
    this._restoreTimer = setTimeout(this._restoreTick, IDLE_RESTORE_MS);
  }

  _restoreTick() {
    this._restoreTimer = 0;
    if (this.interacting) return;
    // wait while frames are still flowing (orbit damping), but never longer than MAX_RESTORE_WAIT
    const now = performance.now();
    if (now - this._lastFrameAt < IDLE_RESTORE_MS * 0.8 && now - this._releasedAt < MAX_RESTORE_WAIT) { this._scheduleRestore(); return; }
    this.scale = 1;
    this._dynAO = false;
    this._syncAO();
    this._apply();
  }

  _afterRender() {
    const now = performance.now();
    this._lastFrameAt = now;
    this._frames++;
    if (this._renderedPrevTick && this._last) {
      const dt = Math.min(250, now - this._last);
      this._ema = this._ema ? this._ema * 0.7 + dt * 0.3 : dt;
    }
    // 'rest': frames are flowing (animation / continuous updates) -> AO waits for the still frame
    if (this._restFrame) this._restFrame = false;
    else if (this.aoMode === 'rest' && this._renderedPrevTick && this.pipeline.opts.ao) this._holdRestAO();
    this._renderedThisTick = true;
    this._last = now;
    if (this.dynamic && this.interacting && now - this._lastChange > MIN_CHANGE_GAP && this._ema) {
      const minScale = Math.max(0.4, Math.min(1, Math.max(0.75, this.basePixelRatio * 0.5) / this.basePixelRatio));
      if (this._ema > SLOW_MS) {
        if (this.pipeline.opts.ao && !this.pipeline.suspendAO) { this._dynAO = true; this._syncAO(); this._lastChange = now; this._ema = 0; }
        else if (this.scale > minScale + 1e-3) { this.scale = Math.max(minScale, this.scale * STEP); this._lastChange = now; this._ema = 0; this._apply(); }
      } else if (this._ema < FAST_MS && this.scale < 1) {
        this.scale = Math.min(1, this.scale / STEP); this._lastChange = now; this._ema = 0; this._apply();
      }
    }
    if (!this.interacting && (this.scale !== 1 || this._dynAO)) this._scheduleRestore();
  }

  // ------------------------------------------------------------ FPS meter
  setMeter(on) {
    if (on && !this._hud) {
      this._hud = h('div', { class: 'pv-fps passthrough', style: {
        position: 'absolute', left: 'calc(var(--safe-left) + 10px)', top: 'calc(var(--safe-top) + 58px)',
        padding: '4px 8px', borderRadius: '8px', background: 'rgba(0,0,0,.55)', color: '#cfe',
        font: '11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace', pointerEvents: 'none', whiteSpace: 'pre', zIndex: 3,
      } });
      this.shell.overlay.appendChild(this._hud);
      this._frames = 0; this._fpsT0 = performance.now();
      this._hudTimer = setInterval(() => this._updateHud(), 500);
      this._updateHud();
    } else if (!on && this._hud) {
      clearInterval(this._hudTimer);
      this._hud.remove();
      this._hud = null;
    }
  }

  _updateHud() {
    const now = performance.now();
    const dt = now - this._fpsT0;
    const fps = (this._frames * 1000) / Math.max(1, dt);
    this._frames = 0; this._fpsT0 = now;
    const r = this.app.renderer, c = this.app.canvas;
    const pr = r.getPixelRatio();
    const w = Math.round(c.clientWidth * pr), hh = Math.round(c.clientHeight * pr);
    const st = this.pipeline.stats;
    const flags = [this.app.renderOverride ? 'post' : 'diretto', st.ink && this.app.renderOverride ? 'china' : null, st.ao && this.app.renderOverride ? 'AO' : null,
      this.app.frameRateCap ? `max ${this.app.frameRateCap} fps` : null, this.throttle < 1 ? 'termico' : null].filter(Boolean).join(' · ');
    this._hud.textContent = fps < 0.5
      ? `inattivo · ${w}×${hh} (${pr.toFixed(2)}x)\n${flags}`
      : `${fps.toFixed(0)} fps · ${this._ema ? this._ema.toFixed(1) : '–'} ms\n${w}×${hh} (${pr.toFixed(2)}x${this.scale < 1 ? ' dinamica' : ''})\n${flags}`;
  }
}
