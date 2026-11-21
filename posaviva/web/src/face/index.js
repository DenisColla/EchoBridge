// "face" module: eyes (procedural iris texture), eyelashes, eyebrows,
// expressions and gaze, plus the "Viso" tool. See posaviva/ARCHITECTURE.md.
//
// Per-character state lives in ch.data.face (see DEFAULT_FACE); the final
// expression weights live in the core (ch.expression) and the eye rotations in
// the core pose, so undo/redo and save/load restore everything.
//
// Public API: app.face (FaceController below) and the `facechange` app event.
import './face.css';
import * as THREE from 'three';
import { faceLandmarks } from './landmarks.js';
import { createEyeTexture } from './eyeTexture.js';
import { Lashes } from './lashes.js';
import { Brows, BROW_BY_ID } from './brows.js';
import { composeExpression, sameWeights, PRESET_BY_ID, FINE_BY_ID } from './expressions.js';
import { aimHeadLocal, freeTarget, headWorldMatrix } from './gaze.js';
import { buildFacePanel } from './panel.js';

export const DEFAULT_FACE = Object.freeze({
  preset: 'neutral', intensity: 1, fine: {}, mirror: false,
  gaze: [0, 0], lookAtCamera: false, lookAt: null,
  brows: 'natural', lashes: true,
});
/** eyebrow colour when the hair module has not set ch.appearance.hair */
export const DEFAULT_HAIR = '#3a2819';

/** Material spec that hides the MakeHuman eyelash helper (draw group 1 of ch.body). */
const HIDDEN_LASH_SPEC = Object.freeze({ kind: 'lashes', color: '#000000', opacity: 0, alphaTest: 0.5, pvFaceHidden: true });
const CORE_BODY_SPEC = (ch) => [
  { kind: 'skin', color: ch.appearance.skin, lips: ch.appearance.lips },
  { kind: 'lashes', color: '#1a1410' }, { kind: 'teeth', color: '#efe9dc' }, { kind: 'tongue', color: '#b4545a' },
];

const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _dark = new THREE.Color('#140e0a');
const _T = new THREE.Vector3(), _W = new THREE.Vector3(), _H = new THREE.Matrix4(), _Hi = new THREE.Matrix4();

/** Brow / lash colours derived from the hair colour (hex strings, stable for material caching). */
function hairColors(hair) {
  _c1.set(hair || DEFAULT_HAIR);
  const brow = '#' + _c2.copy(_c1).lerp(_dark, 0.15).getHexString();
  const lash = '#' + _c2.copy(_c1).lerp(_dark, 0.72).getHexString();
  return { brow, lash };
}

/** Fills missing fields of ch.data.face (never overwrites). Returns the state. */
export function faceState(ch) {
  const st = ch.data.face || (ch.data.face = {});
  for (const [k, v] of Object.entries(DEFAULT_FACE)) if (st[k] === undefined) st[k] = Array.isArray(v) ? v.slice() : v && typeof v === 'object' ? { ...v } : v;
  if (!Array.isArray(st.gaze) || st.gaze.length !== 2) st.gaze = [0, 0];
  if (!BROW_BY_ID.has(st.brows)) st.brows = DEFAULT_FACE.brows;
  if (st.preset && !PRESET_BY_ID.has(st.preset)) st.preset = null;
  return st;
}

// ====================================================================== per character
class FaceRig {
  constructor(ctl, ch) {
    this.ctl = ctl;
    this.ch = ch;
    const L = ctl.landmarks(ch);
    this.lashes = new Lashes(ch, L.lashGrids);
    ch.addAttachment(this.lashes.mesh);
    this.brows = new Brows(ch, L);
    this.boundStyle = null; // brow style / body preset currently bound
    this.boundPreset = null;
    this.shapeDirty = true;
    this.exprDirty = true;
    this.matKey = null; // hair colour the lash / brow materials were made for
    /** camera / point gaze change detection: head world matrix + target */
    this.sig = new Float64Array(19).fill(NaN);
    this._on = {
      shape: () => { this.shapeDirty = true; },
      expression: () => { this.exprDirty = true; },
      appearance: () => this.ensureMaterials(true),
      pose: () => this.onPose(),
    };
    for (const [k, fn] of Object.entries(this._on)) ch.addEventListener(k, fn);
  }

  dispose() {
    for (const [k, fn] of Object.entries(this._on)) this.ch.removeEventListener(k, fn);
    this.ch.removeAttachment(this.lashes.mesh);
    if (this.brows.mesh) this.ch.removeAttachment(this.brows.mesh);
    this.lashes.dispose();
    this.brows.dispose();
  }

  /**
   * Re-applies the module's materials when the core (or anyone) replaced them:
   * procedural eye texture, hidden helper lashes, lash / brow colours.
   * Cheap when nothing changed (called every frame from the render hook).
   */
  ensureMaterials(force = false) {
    const ch = this.ch, mats = this.ctl.materials, ap = ch.appearance;
    const eyeTex = this.ctl.eyeTexture;
    if (eyeTex && (force || ch.eyeMesh.material?.map !== eyeTex || this._eyeColor !== ap.eyes)) {
      mats.apply(ch.eyeMesh, { kind: 'eye', color: ap.eyes, map: eyeTex });
      this._eyeColor = ap.eyes;
    }
    const bm = ch.body.material;
    if (force || !Array.isArray(bm) || !bm[1]?.userData?.pvFaceHidden) {
      const cur = mats.tracked?.get(ch.body);
      const spec = Array.isArray(cur) && cur.length >= 4 ? cur.slice() : CORE_BODY_SPEC(ch);
      spec[1] = HIDDEN_LASH_SPEC;
      const res = mats.apply(ch.body, spec);
      if (Array.isArray(res) && res[1]) { res[1].visible = false; res[1].userData.pvFaceHidden = true; }
    }
    const key = ap.hair || '';
    if (force || key !== this.matKey) {
      this.matKey = key;
      const c = hairColors(ap.hair);
      mats.apply(this.lashes.mesh, { kind: 'lashes', color: c.lash });
      if (this.brows.mesh) mats.apply(this.brows.mesh, { kind: 'hair', color: c.brow, roughness: 0.6, sheen: 0.2, vertexColors: true });
    }
  }

  /** Called every frame before rendering (allocation-free when idle). Returns true if something visible changed. */
  flush() {
    const st = this.ch.data.face || faceState(this.ch);
    let changed = false;
    // Brow hairs are bound to skin triangles, so they follow slider changes by
    // themselves; the (costlier) projection only runs when the template changes.
    if (st.brows !== this.boundStyle || this.ch.presetId !== this.boundPreset) {
      const had = !!this.brows.mesh;
      this.brows.bind(st.brows);
      this.boundStyle = st.brows;
      this.boundPreset = this.ch.presetId;
      if (!had && this.brows.mesh) { this.ch.addAttachment(this.brows.mesh); this.matKey = null; }
      this.exprDirty = true;
      changed = true;
    }
    if (this.shapeDirty) { this.shapeDirty = false; this.exprDirty = true; }
    if (this.exprDirty) {
      this.lashes.update();
      this.brows.update();
      this.exprDirty = false;
      changed = true;
    }
    this.ensureMaterials();
    const lashOn = st.lashes !== false;
    if (this.lashes.mesh.visible !== lashOn) { this.lashes.mesh.visible = lashOn; changed = true; }
    if (st.lookAtCamera || st.lookAt) changed = this.trackTarget(st) || changed;
    return changed;
  }

  /** Free gaze from the pad values (head-relative, independent of the head pose). */
  applyFreeGaze() {
    const st = faceState(this.ch);
    freeTarget(this.ch, st.gaze[0], st.gaze[1], _T);
    return aimHeadLocal(this.ch, _T);
  }

  /** Camera / point gaze: re-aims only when the head or the target moved. */
  trackTarget(st) {
    const cam = this.ctl.app.camera;
    if (st.lookAtCamera) { cam.updateMatrixWorld(); _W.setFromMatrixPosition(cam.matrixWorld); }
    else _W.fromArray(st.lookAt);
    headWorldMatrix(this.ch, _H);
    const s = this.sig, e = _H.elements;
    let same = s[16] === _W.x && s[17] === _W.y && s[18] === _W.z;
    for (let i = 0; same && i < 16; i++) same = s[i] === e[i];
    if (same) return false;
    for (let i = 0; i < 16; i++) s[i] = e[i];
    s[16] = _W.x; s[17] = _W.y; s[18] = _W.z;
    _T.copy(_W).applyMatrix4(_Hi.copy(_H).invert());
    const changed = aimHeadLocal(this.ch, _T);
    if (changed) this.ctl._gazeMoved(this.ch);
    return changed;
  }

  onPose() {
    const st = this.ch.data.face;
    if (!st) return;
    if (st.lookAtCamera || st.lookAt) { this.sig[0] = NaN; return; } // re-aim on the next frame
    if (this.applyFreeGaze()) this.ctl.app.invalidate();
  }
}

// ====================================================================== controller
class FaceController extends THREE.EventDispatcher {
  constructor(app, shell) {
    super();
    this.app = app;
    this.shell = shell;
    this.materials = app.materials;
    /** @type {Map<any, FaceRig>} */
    this.rigs = new Map();
    this.eyeTexture = null;
    this._pendingExpr = new Set();
    this._raf = 0;
    this.onGaze = null; // panel callback (character) while visible
    app.addRenderHook(() => {
      let changed = false;
      for (const rig of this.rigs.values()) changed = rig.flush() || changed;
      if (changed) app.invalidate();
      return false;
    });
    // style switches rebuild every material: re-hide the helper lashes right away
    this.materials.addEventListener?.('refresh', () => { for (const r of this.rigs.values()) r.ensureMaterials(); });
  }

  landmarks(ch) {
    const L = faceLandmarks(this.app.model, ch);
    // the procedural eye texture is built off the boot path (the stock eye
    // texture shows meanwhile); every rig picks it up in its next flush
    if (!this.eyeTexture && !this._texPending) {
      this._texPending = true;
      const build = () => { this.eyeTexture = createEyeTexture(L.eyeUV, 1024); this.app.invalidate(); };
      if (window.requestIdleCallback) requestIdleCallback(build, { timeout: 600 }); else setTimeout(build, 60);
    }
    return L;
  }

  // ------------------------------------------------------------ lifecycle
  add(ch) {
    if (this.rigs.has(ch)) return;
    const fresh = !ch.data.face;
    const st = faceState(ch);
    const rig = new FaceRig(this, ch);
    this.rigs.set(ch, rig);
    rig.ensureMaterials(true);
    rig.onPose();
    // a brand-new character starts from the "Neutro" preset (lips gently closed)
    if (fresh && !Object.keys(ch.expression).length) ch.setExpression(composeExpression(st), true);
  }

  remove(ch) {
    const rig = this.rigs.get(ch);
    if (!rig) return;
    rig.dispose();
    this.rigs.delete(ch);
    this._pendingExpr.delete(ch);
  }

  /** After load / undo: idempotent, cheap when nothing changed. */
  sync(ch) {
    const rig = this.rigs.get(ch);
    if (!rig) return;
    faceState(ch);
    rig.ensureMaterials(); // fromJSON may have re-applied the core materials silently
    rig.sig[0] = NaN;
    rig.onPose();
    this.app.invalidate();
  }

  state(ch = this.app.selection.character) { return ch ? faceState(ch) : null; }

  // ------------------------------------------------------------ expression
  /** Recomputes ch.expression from ch.data.face (throttled to one per frame). */
  applyExpression(ch, now = false) {
    if (now) { this._pendingExpr.delete(ch); ch.setExpression(composeExpression(faceState(ch)), true); this._emit(ch, 'expression'); return; }
    this._pendingExpr.add(ch);
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      for (const c of this._pendingExpr) if (this.rigs.has(c)) { c.setExpression(composeExpression(faceState(c)), true); this._emit(c, 'expression'); }
      this._pendingExpr.clear();
    });
  }

  /** Applies a pending (throttled) expression update right away. */
  flushExpression(ch) {
    if (this._pendingExpr.has(ch)) this.applyExpression(ch, true);
  }

  /** Ends a gaze drag: flushes the lid coupling and records an undo step. */
  commitGaze(ch) {
    if (!ch) return;
    this.flushExpression(ch);
    this.app.commit('sguardo');
  }

  /** Selects an expression preset (resets fine tuning and mirroring). */
  setPreset(ch, id, commit = true) {
    if (!ch || !PRESET_BY_ID.has(id)) return;
    const st = faceState(ch);
    st.preset = id; st.fine = {}; st.mirror = false;
    this.applyExpression(ch, true);
    if (commit) this.app.commit('espressione');
  }

  setIntensity(ch, v, commit = false) {
    if (!ch) return;
    faceState(ch).intensity = Math.max(0, Math.min(1.5, v));
    this.applyExpression(ch, commit);
    if (commit) this.app.commit('intensità espressione');
  }

  setFine(ch, id, v, commit = false) {
    if (!ch || !FINE_BY_ID.has(id)) return;
    const st = faceState(ch);
    if (Math.abs(v) < 0.005) delete st.fine[id]; else st.fine[id] = Math.round(v * 1000) / 1000;
    this.applyExpression(ch, commit);
    if (commit) this.app.commit('ritocco viso');
  }

  resetFine(ch) {
    if (!ch) return;
    faceState(ch).fine = {};
    this.applyExpression(ch, true);
    this.app.commit('azzera ritocchi');
  }

  toggleMirror(ch) {
    if (!ch) return;
    const st = faceState(ch);
    st.mirror = !st.mirror;
    this.applyExpression(ch, true);
    this.app.commit('inverti espressione');
  }

  /** Neutral face, no tuning. */
  resetExpression(ch) {
    if (!ch) return;
    Object.assign(faceState(ch), { preset: 'neutral', intensity: 1, fine: {}, mirror: false });
    this.applyExpression(ch, true);
    this.app.commit('viso neutro');
  }

  // ------------------------------------------------------------ gaze
  /** Free gaze from pad values gx (character's left +) / gy (up +) in [-1, 1]. */
  setGaze(ch, gx, gy, commit = false) {
    const rig = this.rigs.get(ch);
    if (!rig) return;
    const st = faceState(ch);
    st.gaze = [Math.round(Math.max(-1, Math.min(1, gx)) * 1000) / 1000, Math.round(Math.max(-1, Math.min(1, gy)) * 1000) / 1000];
    const wasAuto = st.lookAtCamera || st.lookAt;
    st.lookAtCamera = false; st.lookAt = null;
    if (rig.applyFreeGaze()) this.app.invalidate();
    // the lids follow a vertical gaze (part of the composed expression)
    if (wasAuto || !sameWeights(composeExpression(st), ch.expression)) this.applyExpression(ch, commit);
    this._emit(ch, 'gaze');
    if (commit) this.app.commit('sguardo');
  }

  setLookAtCamera(ch, on) {
    const rig = this.rigs.get(ch);
    if (!rig) return;
    const st = faceState(ch);
    st.lookAtCamera = !!on;
    if (on) st.lookAt = null;
    rig.sig[0] = NaN;
    if (!on && !st.lookAt) rig.applyFreeGaze();
    this.applyExpression(ch, true);
    this.app.invalidate();
    this._emit(ch, 'gaze');
    this.app.commit(on ? 'guarda la camera' : 'sguardo libero');
  }

  /** World point (THREE.Vector3 | [x,y,z]) or null to stop. */
  setLookAtPoint(ch, p) {
    const rig = this.rigs.get(ch);
    if (!rig) return;
    const st = faceState(ch);
    st.lookAt = p ? (Array.isArray(p) ? p.slice(0, 3) : [p.x, p.y, p.z]).map((x) => Math.round(x * 10000) / 10000) : null;
    if (p) st.lookAtCamera = false;
    rig.sig[0] = NaN;
    if (!p && !st.lookAtCamera) rig.applyFreeGaze();
    this.applyExpression(ch, true);
    this.app.invalidate();
    this._emit(ch, 'gaze');
    this.app.commit(p ? 'guarda un punto' : 'sguardo libero');
  }

  _gazeMoved(ch) { this.onGaze?.(ch); }

  // ------------------------------------------------------------ brows / lashes
  setBrows(ch, id) {
    if (!ch || !BROW_BY_ID.has(id)) return;
    faceState(ch).brows = id;
    this.app.invalidate();
    this._emit(ch, 'brows');
    this.app.commit('sopracciglia');
  }

  setLashes(ch, on) {
    if (!ch) return;
    faceState(ch).lashes = !!on;
    this.app.invalidate();
    this._emit(ch, 'lashes');
    this.app.commit(on ? 'ciglia' : 'senza ciglia');
  }

  _emit(ch, what) { this.app.dispatchEvent({ type: 'facechange', character: ch, what }); }
}

// ====================================================================== module
export function create(app, shell) {
  const face = new FaceController(app, shell);
  app.face = face;

  shell.registerTool({
    id: 'face', group: 'pose', label: 'Viso', icon: 'face', order: 30, title: 'Viso',
    build: (el) => buildFacePanel(el, app, shell, face),
  });

  return {
    onCharacterAdded(ch) { face.add(ch); },
    onCharacterRemoved(ch) { face.remove(ch); },
    deserializeCharacter(ch) { face.sync(ch); },
  };
}
