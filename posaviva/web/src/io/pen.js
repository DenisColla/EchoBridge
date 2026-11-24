// S Pen / stylus input on tablets (Galaxy Tab S6 / S9 / S9+), pointer type 'pen':
//
//  - palm rejection: while the pen touches the screen, new finger / palm touches are ignored
//    everywhere; while it hovers near the 3D view they are ignored there. A palm already
//    resting on the view when the pen comes down is cancelled (pointercancel), so it does not
//    block the pose handles or turn the pen stroke into a pinch.
//  - barrel (side) button held while the pen touches: the drag orbits the camera, even over
//    the character or a pose handle (the pose gizmo skips such presses).
//  - "La penna non muove la vista": a pen drag that does not start on a handle leaves the
//    camera alone (fingers still orbit / zoom); the barrel button still orbits.
//  - hover highlight: with the Posa / Mani tool open (Ruota), or with no panel while Tocco
//    diretto is on, the part a press would grab (direct.palmAsHand) glows (teal) under the
//    hovering pen before it is touched.
//  - finer pick tolerance for pen taps / handles lives in the pose gizmo (hitTest / hitDot
//    take the pointer type).
//
// The side button is read from the pointer event (buttons & 2 / button 2); the Android shell may
// also report it with window.__onStylusButton(down) (MotionEvent.BUTTON_STYLUS_PRIMARY) for
// WebViews that do not expose it: app.penBarrel mirrors that state (the pose gizmo reads it).
// Settings (io Settings, localStorage posaviva.settings): penPalm, penBarrel, penNoOrbit,
// penHover (all default true except penNoOrbit), penSeen (a pen was used on this device).
// API: app.modules.ui.pen = {state: {down, near, seen}, setOption(key, on)}.
import { MOUSE, Vector2 } from 'three';
import { Highlight } from '../pose/highlight.js';
import { toast } from '../ui/kit.js';

const NEAR_MS = 450; // a pen event within this time = the pen is near the screen (hover stream)
const HOVER_MS = 50; // hover picks (CPU raycast over the skinned bodies) at most ~20 per second
const POSE_TOOLS = new Set(['pose', 'hands']);
const _ndc = new Vector2();

export class PenInput {
  /** ctx: {app, shell, settings} */
  constructor(ctx) {
    this.app = ctx.app;
    this.shell = ctx.shell;
    this.settings = ctx.settings;
    this.state = { down: false, near: false, seen: !!this.settings.get('penSeen') };
    this._penAt = -Infinity;
    this._penId = null;
    this._touches = new Map(); // touch pointerId -> {x, y, target} (not blocked)
    this._blocked = new Set(); // touch pointerIds ignored until they lift
    this._restore = null; // OrbitControls mouseButtons to restore after a pen gesture
    this._hover = null; // {x, y} pending hover position
    this._hoverRaf = 0;
    this._hoverAt = null; // {x, y, t} of the last hover pick
    this._hl = null; // hover Highlight (created on first use)
    this._hlKey = '';
    this.app.penBarrel = false;
    this._install();
    const prev = window.__onStylusButton;
    window.__onStylusButton = (down) => { try { prev?.(down); } finally { this.app.penBarrel = !!down; } };
  }

  opt(key) {
    const v = this.settings.get(key);
    return key === 'penNoOrbit' ? v === true : v !== false;
  }

  setOption(key, on) {
    this.settings.set(key, !!on);
    if (key === 'penHover' && !on) this._hideHover();
  }

  _inView(t) {
    return !!t && (t === this.app.canvas || !!t.closest?.('.pv-viewport, .pv-overlay'));
  }

  _install() {
    const w = window;
    const stop = (e) => { e.stopImmediatePropagation(); if (e.cancelable) e.preventDefault(); };
    w.addEventListener('pointerdown', (e) => {
      if (e.pvSynthetic) return;
      if (e.pointerType === 'pen') { this._penDown(e); return; }
      if (e.pointerType !== 'touch') return;
      const now = performance.now();
      const near = now - this._penAt < NEAR_MS;
      if (this.opt('penPalm') && (this.state.down || (near && this._inView(e.target)))) {
        this._blocked.add(e.pointerId);
        stop(e);
        return;
      }
      this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY, target: e.target });
    }, true);
    w.addEventListener('pointermove', (e) => {
      if (e.pvSynthetic) return;
      if (this._blocked.has(e.pointerId)) { stop(e); return; }
      if (e.pointerType === 'pen') {
        this._penAt = performance.now();
        this.state.near = true;
        if (!e.buttons && !this.state.down) this._queueHover(e);
        return;
      }
      const t = this._touches.get(e.pointerId);
      if (t) { t.x = e.clientX; t.y = e.clientY; }
    }, true);
    const up = (e) => {
      if (e.pvSynthetic) return;
      if (this._blocked.has(e.pointerId)) { this._blocked.delete(e.pointerId); stop(e); return; }
      this._touches.delete(e.pointerId);
      if (e.pointerType === 'pen' && e.pointerId === this._penId) {
        this._penId = null;
        this.state.down = false;
        this._penAt = performance.now();
        // after every listener of this event (the pose gizmo restores the controls on up)
        if (this._restore) { const r = this._restore; this._restore = null; setTimeout(() => this._restoreButtons(r), 0); }
      }
    };
    w.addEventListener('pointerup', up, true);
    w.addEventListener('pointercancel', up, true);
    // the pen leaves the hover range / the window
    const leave = (e) => { if (e.pointerType === 'pen' && !this.state.down) { this.state.near = false; this._hideHover(); } };
    this.app.canvas.addEventListener('pointerleave', leave);
    w.addEventListener('pointerout', (e) => { if (!e.relatedTarget) leave(e); });
    // anything else changing the scene or the tool hides the hover glow
    for (const ev of ['tool', 'selection', 'characters']) this.app.addEventListener(ev, () => this._hideHover());
  }

  _penDown(e) {
    this._penId = e.pointerId;
    this._penAt = performance.now();
    this.state.down = true;
    this.state.near = true;
    this._hideHover();
    if (!this.state.seen) {
      this.state.seen = true;
      this.settings.set('penSeen', true);
      // once per device, when the pen first touches the view
      if (this._inView(e.target) && !navigator.webdriver) toast('Penna rilevata: il palmo appoggiato viene ignorato, il tasto laterale ruota la vista (Impostazioni › Penna)', { kind: 'info', icon: 'pen', ms: 5200 });
    }
    // palm rejection: touches already resting on the screen are cancelled for everyone
    if (this.opt('penPalm') && this._touches.size) {
      for (const [id, t] of [...this._touches]) {
        this._touches.delete(id);
        this._blocked.add(id);
        const tgt = t.target?.isConnected ? t.target : this.app.canvas;
        try {
          const ev = new PointerEvent('pointercancel', { pointerId: id, pointerType: 'touch', isPrimary: false, clientX: t.x, clientY: t.y, bubbles: true, cancelable: false, composed: true });
          ev.pvSynthetic = true;
          tgt.dispatchEvent(ev);
        } catch { /* old engines: the touch simply stays */ }
      }
    }
    if (e.target !== this.app.canvas) return;
    const ctl = this.app.controls;
    if (!ctl?.mouseButtons) return;
    const barrel = (e.buttons & 2) !== 0 || e.button === 2 || this.app.penBarrel;
    // OrbitControls reads mouseButtons when the press starts: set them for this gesture only
    if (barrel && this.opt('penBarrel')) this._setButtons({ LEFT: MOUSE.ROTATE, RIGHT: MOUSE.ROTATE });
    else if (!barrel && this.opt('penNoOrbit')) this._setButtons({ LEFT: -1 });
  }

  _setButtons(patch) {
    const mb = this.app.controls.mouseButtons;
    if (!this._restore) this._restore = { ...mb };
    Object.assign(mb, patch);
  }

  _restoreButtons(r) { Object.assign(this.app.controls.mouseButtons, r); }

  // ------------------------------------------------------------ hover highlight
  _queueHover(e) {
    if (e.target !== this.app.canvas || !this.opt('penHover')) { this._hideHover(); return; }
    const last = this._hoverAt;
    if (last && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 3) return; // the pen barely moved
    this._hover = { x: e.clientX, y: e.clientY };
    if (this._hoverRaf) return;
    const wait = Math.max(0, HOVER_MS - (performance.now() - (last?.t || 0)));
    this._hoverRaf = setTimeout(() => requestAnimationFrame(() => {
      this._hoverRaf = 0;
      if (!this._hover) return;
      this._hoverAt = { x: this._hover.x, y: this._hover.y, t: performance.now() };
      this._updateHover();
    }), wait);
  }

  _updateHover() {
    const p = this._hover, app = this.app, posing = app.posing;
    // where a press poses a part: Posa / Mani (Ruota), or no panel with Tocco diretto on
    const tool = this.shell.activeToolId, mode = posing?.state.mode, dt = posing?.direct;
    const live = posing && ((POSE_TOOLS.has(tool) && mode === 'rotate') || (tool === null && dt?.enabled && !dt.suspended && mode !== 'move'));
    if (!p || this.state.down || !live) { this._clearGlow(); return; }
    const g = posing.gizmo;
    // over a pose handle: the handle itself is the target, no body glow (over the body only a
    // ring's stroke takes the press, gizmo.hitTestBody)
    if ((g?.hitTestBody || g?.hitTest)?.call(g, p.x, p.y, 'pen')) { this._clearGlow(); return; }
    const sel = app.selection;
    let ch = null, control = null;
    const dot = posing.state.showJoints ? g?.hitDot?.(p.x, p.y, 'pen') : null;
    if (dot && sel.character) { ch = sel.character; control = posing.controls.get(dot); }
    else {
      app.pointerToNDC({ clientX: p.x, clientY: p.y }, _ndc);
      const hit = posing.pick(_ndc);
      if (hit) {
        ch = hit.character; control = hit.control;
        // what a press there would actually drag: the hips move the pelvis, a small hand is grabbed whole
        if (app.model.bones[hit.bone]?.name === 'spine05') control = posing.controls.get('pelvis') || control;
        else if (dt?.palmAsHand) control = dt.palmAsHand(control, ch);
      }
    }
    // the Mani tool only poses hands
    if (control && this.shell.activeToolId === 'hands' && !['hand', 'finger'].includes(control.region)) control = null;
    if (!ch || !control || (ch === sel.character && control.id === sel.part)) { this._clearGlow(); return; }
    const key = `${ch.id}|${control.id}`;
    if (key === this._hlKey) return;
    this._hlKey = key;
    const hl = this._highlight();
    hl.set(ch, control, control.own.map((n) => app.model.boneIndex.get(n)));
  }

  _highlight() {
    if (this._hl) return this._hl;
    const hl = new Highlight(this.app);
    // teal and fainter than the selection glow (violet)
    for (const m of [hl.front, hl.xray]) m.uniforms.uColor.value.set('#4fd1c5');
    // (the x-ray pass shows parts under clothes; a hover must read at a glance, so it starts half faded in)
    hl._applyOpacity = function applyOpacity() {
      const f = Math.max(this._fade, 0.5), k = f * f * (3 - 2 * f);
      this.front.uniforms.uOpacity.value = 0.34 * k;
      this.xray.uniforms.uOpacity.value = 0.22 * k;
    };
    this._hl = hl;
    return hl;
  }

  /** Hides the glow (nothing under the pen); the hover throttle keeps running. */
  _clearGlow() {
    if (!this._hlKey) return;
    this._hlKey = '';
    this._hl?.set(null, null);
  }

  /** The pen left, touched the screen, or the tool / scene changed: stop hovering. */
  _hideHover() {
    this._hover = null;
    this._hoverAt = null;
    this._clearGlow();
  }
}
