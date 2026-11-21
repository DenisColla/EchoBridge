// Performance policy for high-DPI phones (Galaxy S25 Ultra: devicePixelRatio
// ~2.6-3.5, 120 Hz panel).
//  - Base pixel ratio = min(devicePixelRatio, quality cap).
//  - Dynamic resolution: while the user interacts (any pointer down, orbit
//    controls active) the frame interval is measured; if frames are slow the
//    AO pass is suspended first, then the resolution is lowered in steps.
//    When the interaction ends the full resolution (and AO) is restored and
//    one crisp frame is rendered.
//  - Optional FPS meter HUD.
import { h } from '../ui/kit.js';

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
    // a frame-time sample is valid only when two consecutive animation ticks both rendered
    this._renderedPrevTick = false;
    this._renderedThisTick = false;
    app.addRenderHook(() => { this._renderedPrevTick = this._renderedThisTick; this._renderedThisTick = false; return false; });
    app.addAfterRenderHook(() => this._afterRender());
    this.basePixelRatio = this._computeBase();
  }

  _computeBase() { return Math.max(0.5, Math.min(window.devicePixelRatio || 1, this.prCap)); }

  /** Applies a new quality cap (Alta 2, Media 1.5, Bassa 1). */
  setCap(cap) {
    this.prCap = cap;
    this.basePixelRatio = this._computeBase();
    this.scale = 1;
    this._apply();
  }

  setDynamic(on) {
    this.dynamic = !!on;
    if (!on && (this.scale !== 1 || this.pipeline.suspendAO)) { this.scale = 1; this.pipeline.suspendAO = false; this._apply(); }
  }

  get pixelRatio() { return this.app.renderer.getPixelRatio(); }

  _apply() {
    const pr = Math.round(this.basePixelRatio * this.scale * 100) / 100;
    if (Math.abs(this.app.renderer.getPixelRatio() - pr) > 1e-3) this.app.renderer.setPixelRatio(pr);
    this.app.invalidate();
  }

  _updateInteracting() {
    const now = this._pointers.size > 0 || this._controlsActive;
    if (now === this.interacting) return;
    this.interacting = now;
    if (now) { clearTimeout(this._restoreTimer); this._restoreTimer = 0; this._last = 0; }
    else { this._releasedAt = performance.now(); this._scheduleRestore(); }
  }

  /** Arms (once) the timer that restores full quality after the interaction ended. */
  _scheduleRestore() {
    if (this._restoreTimer || (this.scale === 1 && !this.pipeline.suspendAO)) return;
    this._restoreTimer = setTimeout(this._restoreTick, IDLE_RESTORE_MS);
  }

  _restoreTick() {
    this._restoreTimer = 0;
    if (this.interacting) return;
    // wait while frames are still flowing (orbit damping), but never longer than MAX_RESTORE_WAIT
    const now = performance.now();
    if (now - this._lastFrameAt < IDLE_RESTORE_MS * 0.8 && now - this._releasedAt < MAX_RESTORE_WAIT) { this._scheduleRestore(); return; }
    this.scale = 1;
    this.pipeline.suspendAO = false;
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
    this._renderedThisTick = true;
    this._last = now;
    if (this.dynamic && this.interacting && now - this._lastChange > MIN_CHANGE_GAP && this._ema) {
      const minScale = Math.max(0.4, Math.min(1, Math.max(0.75, this.basePixelRatio * 0.5) / this.basePixelRatio));
      if (this._ema > SLOW_MS) {
        if (this.pipeline.opts.ao && !this.pipeline.suspendAO) { this.pipeline.suspendAO = true; this._lastChange = now; this._ema = 0; }
        else if (this.scale > minScale + 1e-3) { this.scale = Math.max(minScale, this.scale * STEP); this._lastChange = now; this._ema = 0; this._apply(); }
      } else if (this._ema < FAST_MS && this.scale < 1) {
        this.scale = Math.min(1, this.scale / STEP); this._lastChange = now; this._ema = 0; this._apply();
      }
    }
    if (!this.interacting && (this.scale !== 1 || this.pipeline.suspendAO)) this._scheduleRestore();
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
    const flags = [this.app.renderOverride ? 'post' : 'diretto', st.ink && this.app.renderOverride ? 'china' : null, st.ao && this.app.renderOverride ? 'AO' : null].filter(Boolean).join(' · ');
    this._hud.textContent = fps < 0.5
      ? `inattivo · ${w}×${hh} (${pr.toFixed(2)}x)\n${flags}`
      : `${fps.toFixed(0)} fps · ${this._ema ? this._ema.toFixed(1) : '–'} ms\n${w}×${hh} (${pr.toFixed(2)}x${this.scale < 1 ? ' dinamica' : ''})\n${flags}`;
  }
}
