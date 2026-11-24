// Practical lights: lamps, candles, screens, street lamps, lanterns, neon signs,
// bonfires and fireplaces in the scene cast real light, and windows let the
// light of the sky in (sun patch with the shadow of the frame, cool bounce near
// the window, bright backplate outside).
//
// app.practicals (this class) — contract shared with the objects / touch workstreams:
//   isSource(prop) -> bool              lamp-like source or a prop with a window opening
//   hitsSource(prop, point) -> bool     a long press at that world point concerns the light (rooms and
//                                       walls: only near the window opening; their floor is "space")
//   state(prop) -> {on, intensity 0..2, color, kind: 'lamp'|'window', mode?, setting?, label}
//   set(prop, patch {on?, intensity?, color?, mode?}, commit = true)
//   solo(prop) / mix(prop)              'Accendi solo questa' / 'Combina con la luce di studio'
//   setSceneOnly(bool)                  'Solo luci della scena' (studio rig down to a faint fill)
//   menuSection(prop) -> {body: Node|null, items: [...kit.stageMenu items]}
//   openMenu(prop, x, y), ambientMenu(x, y)
//   windowState(prop) -> {mode, setting, intensity, openings} | null
//   sources() -> [{prop, kind, state, active, lit}]  (list of the scene, for the Luci panel)
//   events: 'change' {what: 'state'|'list'|'mode'}
//
// Per-prop state lives on prop.light (serialized with the prop JSON); the scene-level
// mode (mix / solo / scene) is serialized by the scene module (serializeScene().practicals).
//
// Budget (render quality preset, render/device.js): alta 8 lights + the strongest casts a
// shadow, media 3 without shadows, bassa 2. Farther / weaker sources are culled (their
// bulbs still glow). Lights are pooled with a FIXED size per quality preset (alta 6 point +
// 3 spot slots, media 3 + 1, bassa 2 + 1), created with the first lamp of the session and
// kept (lit or not, even when lamps are deleted): switching, adding or removing lamps never
// changes the number of lights in the shaders (each change would recompile ~20 programs: a
// visible hitch), only intensities and positions. The shadow-capable slots (alta: point 0
// and spot 0, windows: the nearest sun) keep castShadow; an idle one skips its shadow map
// render (shadow.autoUpdate false) and casts nothing (shadow.intensity 0).
// Idle or out-of-range lights are almost free on the GPU: the light loop of every material
// skips the BRDF of a light whose colour reaching the point is zero (patchLightLoop below).
import * as THREE from 'three';
import { setColorFromKelvin, kelvinToHex } from './color.js';
import { ROLES, TYPE_BY_ID } from '../props/catalog.js';
import { partSpec } from '../props/models.js';
import { screen as screenPicture } from '../props/textures.js';
import { sourceOf, sourceOfProp, val, windowsOf, isWindowType } from './practicalSources.js';
import { buildMenuSection, openAmbientMenu, openPracticalMenu } from './practicalsUI.js';

const DEG = Math.PI / 180;
/** max: lights lit at once; point / spot: pooled slots of each kind (fixed per preset) */
const BUDGET = {
  alta: { max: 8, point: 6, spot: 3, shadows: 1, pointMap: 512, spotMap: 1024, windows: 2, windowMap: 1024, bounce: true },
  media: { max: 3, point: 3, spot: 1, shadows: 0, pointMap: 256, spotMap: 512, windows: 1, windowMap: 1024, bounce: false },
  bassa: { max: 2, point: 2, spot: 1, shadows: 0, pointMap: 256, spotMap: 512, windows: 1, windowMap: 512, bounce: false },
};
/** light-map size of a window's sun (the opening's shape: nothing lit outside the window) */
const COOKIE_PX = 128;

// ------------------------------------------------------------------ shader: idle lights skipped
const RE_CALL = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
let _loopPatched = null;
/**
 * The point and spot light loops of three.js call the material's BRDF for every light, even
 * one whose colour at the point is zero (switched off, out of its range, outside its cone).
 * The pooled practical lights are often idle: the BRDF is skipped for them (a dynamically
 * uniform branch: nearly free on the GPU). Edits THREE.ShaderChunk once (idempotent);
 * materials compiled before are disposed so they recompile. Returns true when in use.
 */
export function patchLightLoop(app) {
  if (_loopPatched !== null) return _loopPatched;
  let src = THREE.ShaderChunk.lights_fragment_begin;
  const wrap = (start) => {
    const i = src.indexOf(start), j = i < 0 ? -1 : src.indexOf(RE_CALL, i), k = i < 0 ? -1 : src.indexOf('#pragma unroll_loop_end', i);
    if (i < 0 || j < 0 || j > k) return false;
    src = src.slice(0, j) + `if ( directLight.visible ) { ${RE_CALL} }` + src.slice(j + RE_CALL.length);
    return true;
  };
  // only the exact code we know (a different three.js keeps its own loop)
  if (!wrap('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )') || !wrap('#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )')) { _loopPatched = false; return false; }
  THREE.ShaderChunk.lights_fragment_begin = src;
  app?.scene?.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
  });
  _loopPatched = true;
  return true;
}
/** studio rig scale while only the scene's own lights should be on (faint fill) */
const FAINT = { lights: 0, ambient: 0.22 };
/** practical lights are pushed a little when they are alone (the eye adapts) */
const ALONE_GAIN = 1.5;

/** Window light per mode: sun illuminance at the opening, elevation, colour, bounce fill, backplate sky. */
export const WINDOW_MODES = {
  giorno: { label: 'Giorno', E: 3.4, el: 36, kelvin: 5600, soft: 0.1, bounce: 0.55, bounceK: 9500, sky: ['#7fb2e8', '#cfe3f6', '#f4f8fb'] },
  tramonto: { label: 'Tramonto', E: 2.9, el: 15, kelvin: 2100, soft: 0.18, bounce: 0.3, bounceColor: '#a99ad8', sky: ['#3d4c86', '#d98a6a', '#ffc27a'] },
  notte: { label: 'Notte', E: 0.95, el: 48, kelvin: 11000, soft: 0.35, bounce: 0.08, bounceColor: '#5b6fb8', sky: ['#060b1c', '#121c3a', '#24315a'] },
  chiusa: { label: 'Chiusa', E: 0, el: 30, kelvin: 5600, soft: 0.2, bounce: 0, sky: null },
};
const TIME_TO_MODE = { alba: 'tramonto', mattino: 'giorno', mezzogiorno: 'giorno', tramonto: 'tramonto', sera: 'notte', notte: 'notte' };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _n = new THREE.Vector3();
const _m3 = new THREE.Matrix3(), _m4 = new THREE.Matrix4(), _box = new THREE.Box3(), _c = new THREE.Color(), _c2 = new THREE.Color();

let _skyCache = new Map();
function skyTexture(cols) {
  const key = cols.join();
  let t = _skyCache.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 64);
  gr.addColorStop(0, cols[0]); gr.addColorStop(0.62, cols[1]); gr.addColorStop(1, cols[2]);
  g.fillStyle = gr; g.fillRect(0, 0, 4, 64);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  _skyCache.set(key, t);
  return t;
}

const noRaycast = () => {};

export class Practicals extends THREE.EventDispatcher {
  constructor(app, rig) {
    super();
    patchLightLoop(app);
    this.app = app;
    this.rig = rig;
    this.group = new THREE.Group();
    this.group.name = 'pvPracticals';
    app.scene.add(this.group);
    /** pooled three.js lights: {point: PointLight[], spot: SpotLight[]} */
    this.pool = { point: [], spot: [] };
    /** window lights: [{sun: SpotLight, bounce: SpotLight}] and backplates per opening */
    this.winLights = [];
    this.plates = [];
    /** scene-level mode: 'mix' (studio + practicals), 'solo' (one source), 'scene' (practicals and windows only) */
    this.mode = 'mix';
    this.soloId = null;
    /** prop -> source entry */
    this.entries = new Map();
    this._listKey = '';
    this._dirty = true;
    this._scanDirty = true;
    this._sig = NaN;
    this._lastRank = 0;
    this._active = []; // ranked active sources of the last assignment
    this._stats = { sources: 0, lit: 0, lights: 0, shadows: 0, windows: 0 };
    this._focus = [];
    this._bindEvents();
  }

  // ================================================================== public API
  /** True for light sources (lamps, screens, flames...) and props with a window opening. */
  isSource(prop) {
    if (!prop?.type) return false;
    if (sourceOfProp(prop)) return true;
    return isWindowType(prop.type) && windowsOf(prop).length > 0;
  }

  isWindow(prop) { return !!prop?.type && !sourceOfProp(prop) && isWindowType(prop.type) && windowsOf(prop).length > 0; }

  /**
   * True when a long press at `point` (world) on `prop` is about its light: any part of a lamp
   * or of a window prop; on a room (Stanza) or a wall only near its window opening (their floor
   * and walls are the empty space of the set: the long press there is the ambient light).
   */
  hitsSource(prop, point) {
    if (!this.isSource(prop)) return false;
    if (!this.isWindow(prop) || !point || (prop.type.variantOf || prop.type.id) === 'finestra') return true;
    prop.pivot.updateWorldMatrix(true, false);
    const q = _v.copy(point).applyMatrix4(_m4.copy(prop.pivot.matrixWorld).invert());
    for (const o of windowsOf(prop)) {
      const d = _v2.subVectors(q, o.c);
      if (Math.abs(d.dot(o.n)) > 0.4) continue;
      const along = Math.abs(d.dot(_v3.set(0, 1, 0).cross(o.n).normalize()));
      if (along < o.w / 2 + 0.3 && Math.abs(d.y) < o.h / 2 + 0.3) return true;
    }
    return false;
  }

  /** Current state of a source (defaults resolved). */
  state(prop) {
    if (!this.isSource(prop)) return null;
    const L = prop.light || {};
    if (this.isWindow(prop)) {
      const setting = L.mode || 'auto';
      const mode = setting === 'auto' ? this._autoWindowMode() : setting;
      const label = (prop.type.variantOf || prop.type.id) === 'finestra' ? prop.type.label : `Finestra · ${prop.type.label}`;
      return { kind: 'window', on: mode !== 'chiusa', mode, setting, intensity: L.intensity ?? 1, color: null, label, explicit: !!prop.light };
    }
    const src = sourceOfProp(prop), p = prop.params;
    let on;
    if (src.onParam && src.onParam in p) on = !!p[src.onParam];
    else if (typeof L.on === 'boolean') on = L.on;
    else on = this._defaultOn(src);
    if (src.offWhen?.(p)) on = false;
    return { kind: 'lamp', on, intensity: L.intensity ?? 1, color: L.color || this._defaultHex(src, p), customColor: !!L.color, label: val(src.label, p) || prop.type.label, explicit: !!prop.light };
  }

  /**
   * Changes a source. patch: {on, intensity (0..2), color (hex | null = default), mode (windows:
   * 'auto'|'giorno'|'tramonto'|'notte'|'chiusa')}. commit = undo label or true ('luce') / false (live).
   */
  set(prop, patch = {}, commit = true) {
    if (!this.isSource(prop)) return false;
    const src = sourceOfProp(prop);
    const L = { ...(prop.light || {}) };
    if ('intensity' in patch) L.intensity = Math.max(0, Math.min(2, +patch.intensity || 0));
    if ('color' in patch) { if (patch.color) L.color = patch.color; else delete L.color; }
    if ('mode' in patch) L.mode = patch.mode;
    if ('on' in patch && this.isWindow(prop)) {
      if (!('mode' in patch)) L.mode = patch.on ? (L.mode && L.mode !== 'chiusa' ? L.mode : 'auto') : 'chiusa';
      if (!patch.on && this.mode === 'solo' && this.soloId === prop.id) this._setMode('mix', null);
    } else if ('on' in patch) {
      const on = !!patch.on;
      if (src?.onParam && src.onParam in prop.params) {
        if (prop.params[src.onParam] !== on) this.app.props?.setParams?.(prop, { [src.onParam]: on });
      } else L.on = on;
      // screens that are blank by their own parameter: switch them on with their default content
      if (on && src?.offWhen?.(prop.params) && 'content' in prop.params) this.app.props?.setParams?.(prop, { content: prop.type.params.find((d) => d.id === 'content')?.default || 'video' });
      if (!on && this.mode === 'solo' && this.soloId === prop.id) this._setMode('mix', null);
      // the landscape lights the nearest street lamps through rig extras: keep them in step
      this._syncClaimed(prop, on);
    }
    prop.light = L;
    this._changed('state');
    if (commit) this.app.commit(typeof commit === 'string' ? commit : 'luce');
    return true;
  }

  /** 'Accendi solo questa': this source on, the others off, the studio rig down to a faint fill. */
  solo(prop) {
    if (!this.isSource(prop)) return;
    this.app.history.batch('accendi solo questa', () => {
      const st = this.state(prop);
      if (!st.on) this.set(prop, this.isWindow(prop) ? { mode: 'auto' } : { on: true }, false);
      if (this.isWindow(prop) && this.state(prop).mode === 'chiusa') this.set(prop, { mode: 'giorno' }, false);
      this._setMode('solo', prop.id);
      this.app.commit('accendi solo questa');
    });
  }

  /** 'Combina con la luce di studio': this source on together with the studio rig and the other sources. */
  mix(prop) {
    this.app.history.batch('combina con lo studio', () => {
      if (prop && this.isSource(prop) && !this.state(prop).on) this.set(prop, this.isWindow(prop) ? { mode: 'auto' } : { on: true }, false);
      this._setMode('mix', null);
      this.app.commit('combina con lo studio');
    });
  }

  /** 'Solo luci della scena': only the practicals and windows light the scene (studio rig faint). */
  setSceneOnly(on, commit = true) {
    this._setMode(on ? 'scene' : 'mix', null);
    if (commit) this.app.commit(on ? 'solo luci della scena' : 'luce di studio');
  }

  get sceneOnly() { return this.mode === 'scene'; }

  windowState(prop) {
    if (!this.isWindow(prop)) return null;
    const st = this.state(prop);
    return { mode: st.mode, setting: st.setting, intensity: st.intensity, openings: windowsOf(prop).length };
  }

  /** Sources of the scene (Luci panel list). */
  sources() {
    const out = [];
    for (const p of this.app.props?.props || []) {
      if (!this.isSource(p)) continue;
      const e = this.entries.get(p);
      out.push({ prop: p, kind: this.isWindow(p) ? 'window' : 'lamp', state: this.state(p), lit: !!e?.lit, culled: !!e && e.wantLight && !e.lit });
    }
    return out;
  }

  menuSection(prop) { return buildMenuSection(this, prop); }
  openMenu(prop, x, y) { return openPracticalMenu(this, prop, x, y); }
  ambientMenu(x, y) { return openAmbientMenu(this, x, y); }

  /** Scene-level state (scene module JSON). */
  getState() { return { v: 1, mode: this.mode, solo: this.soloId }; }
  setState(s) {
    const mode = s && ['mix', 'solo', 'scene'].includes(s.mode) ? s.mode : 'mix';
    const solo = mode === 'solo' ? s.solo || null : null;
    // undo / load: open menus and the Luci panel follow (only when something changed)
    this._setMode(mode, solo, mode !== this.mode || solo !== this.soloId);
  }

  /** Diagnostics / tests: counts of the last assignment. */
  get stats() { return { ...this._stats, mode: this.mode }; }

  // ================================================================== modes
  _setMode(mode, soloId, emit = true) {
    this.mode = mode;
    this.soloId = mode === 'solo' ? soloId : null;
    const alone = mode !== 'mix';
    this.rig.setStudioScale(alone ? FAINT.lights : 1, alone ? FAINT.ambient : 1);
    this._dirty = true;
    this.app.invalidate();
    if (emit) this._emit('mode');
  }

  /** Time of the landscape or of the rig preset -> window mode. */
  _autoWindowMode() {
    const time = this.app.landscapes?.current?.resolved?.time;
    if (time && TIME_TO_MODE[time]) return TIME_TO_MODE[time];
    const pr = this.rig.state.preset;
    if (pr === 'night' || pr === 'horror') return 'notte';
    if (pr === 'sunset') return 'tramonto';
    return 'giorno';
  }

  /** Night context: landscape at evening / night (or rain indoors), or the rig's night preset. */
  _isNight() {
    const r = this.app.landscapes?.current?.resolved;
    if (r?.time) return r.time === 'sera' || r.time === 'notte';
    return this.rig.state.preset === 'night';
  }

  _defaultOn(src) {
    if (src.defaultOn === false) return false;
    const landscape = !!this.app.landscapes?.current;
    if (landscape) return this._isNight() || !!src.day || (src.night ? false : this.app.landscapes.current.resolved?.weather === 'pioggia');
    return true;
  }

  _defaultHex(src, params) {
    const c = val(src.color, params);
    return c || kelvinToHex(val(src.kelvin, params) || 2700);
  }

  // ================================================================== events
  /** Listens to modules created after the scene module (props, landscapes). Idempotent. */
  _hookModules() {
    const app = this.app, M = app.props, Ls = app.landscapes;
    if (M && M !== this._hookedProps) {
      this._hookedProps = M;
      M.addEventListener('list', () => { this._scanDirty = true; this._dirty = true; app.invalidate(); });
      M.addEventListener('change', () => { this._scanDirty = true; this._dirty = true; });
    }
    if (Ls?.addEventListener && Ls !== this._hookedLs) {
      this._hookedLs = Ls;
      Ls.addEventListener('change', () => { this._dirty = true; this._emit('state'); });
      Ls.addEventListener('generated', () => { this._scanDirty = true; this._dirty = true; this._emit('list'); });
      Ls.addEventListener('cleared', () => { this._dirty = true; this._emit('state'); });
    }
  }

  _bindEvents() {
    const app = this.app;
    this._hookModules();
    app.addEventListener('ready', () => this._hookModules());
    app.addEventListener('loaded', () => { this._scanDirty = true; this._dirty = true; });
    app.addEventListener('characters', () => { this._dirty = true; });
    app.addEventListener('renderstyle', () => { this._dirty = true; this._glowCheck = true; });
    this.rig.addEventListener('change', (e) => {
      if (e.what === 'live' || e.what === 'select' || e.what === 'handles' || e.what === 'studio') return;
      this._dirty = true; // includes 'quality': the budget follows the render quality preset
    });
    app.materials?.addEventListener?.('refresh', () => { this._glowCheck = true; this._dirty = true; app.invalidate(); });
  }

  _changed(what) {
    this._dirty = true;
    this.app.invalidate();
    this._emit(what);
  }

  _emit(what) { this.dispatchEvent({ type: 'change', what }); }

  // ================================================================== per frame
  /** Render hook (scene module): rescans, follows moving sources, assigns the pooled lights. */
  onFrame(now) {
    const M = this.app.props;
    if (!M) return;
    if (!this._hookedProps || (!this._hookedLs && this.app.landscapes)) this._hookModules();
    if (this._scanDirty) { this._scanDirty = false; this._scan(); }
    if (!this.entries.size && !this.pool.point.length && !this.pool.spot.length && !this.winLights.length) return;
    // moving sources (drags, held lanterns, posing): cheap signature of their world matrices
    if (this.entries.size) {
      let s = 0, k = 1;
      for (const e of this.entries.values()) {
        const r = e.prop.root;
        r.updateWorldMatrix(true, false);
        const m = r.matrixWorld.elements;
        s += k++ * (m[12] * 1.3 + m[13] * 2.1 + m[14] * 3.7 + m[0] * 5.1 + m[2] * 7.3 + m[8] * 11.1 + m[5] * 0.7);
      }
      if (s !== this._sig) { this._sig = s; this._dirty = true; }
    }
    // ranking depends on the characters / view when there are more sources than lights
    if (!this._dirty && this._overBudget && now - this._lastRank > 400) this._dirty = true;
    if (!this._dirty) return;
    this._dirty = false;
    this._lastRank = now;
    this._assign();
    this.app.invalidate();
  }

  // ================================================================== scanning
  _scan() {
    const M = this.app.props, seen = new Set();
    for (const p of M.props) {
      const src = sourceOfProp(p);
      const win = !src && isWindowType(p.type) ? windowsOf(p) : null;
      if (!src && !win?.length) continue;
      seen.add(p);
      let e = this.entries.get(p);
      const meshKey = p.meshes[0] || null;
      if (e && e.meshKey === meshKey && e.paramKey === p._geoKey && e.loading === p.loading) continue;
      e = { prop: p, src, win: win || null, meshKey, paramKey: p._geoKey, loading: p.loading, lit: false, wantLight: false, glowKey: '' };
      if (src) this._locate(e);
      else this._prepareWindow(e);
      this.entries.set(p, e);
    }
    for (const p of [...this.entries.keys()]) if (!seen.has(p)) this._forget(p);
    // a solo source that is not in the scene (deleted, or a scene loaded without it): back to the studio
    if (this.mode === 'solo' && ![...this.entries.keys()].some((p) => p.id === this.soloId)) this._setMode('mix', null);
    const key = [...this.entries.keys()].map((p) => p.id).join();
    if (key !== this._listKey) { this._listKey = key; this._emit('list'); }
    this._glowCheck = true;
  }

  _forget(p) {
    this.entries.delete(p);
    if (this.soloId === p.id) this._setMode('mix', null);
  }

  /** Bulb position / direction in pivot space, glowing and hidden meshes of a source. */
  _locate(e) {
    const p = e.prop, src = e.src, params = p.params;
    e.kind = val(src.kind, params) || 'point';
    let at = val(src.at, params, p);
    const pos = src.pos ? val(src.pos, params, p) : null;
    const bulb = new THREE.Vector3();
    let atMesh = null;
    if (pos) bulb.fromArray(pos);
    else if (typeof at === 'string') {
      atMesh = p.meshes.find((m) => m.userData.role === at) || null;
      if (atMesh) {
        if (atMesh.matrixAutoUpdate) atMesh.updateMatrix();
        if (!atMesh.geometry.boundingBox) atMesh.geometry.computeBoundingBox();
        _box.copy(atMesh.geometry.boundingBox).applyMatrix4(atMesh.matrix).getCenter(bulb);
      } else at = [0.5, 0.8, 0.5];
    }
    if (!pos && Array.isArray(at)) {
      const b = p.geoBox.isEmpty() ? _box.set(_v.set(-0.1, 0, -0.1), _v2.set(0.1, 0.4, 0.1)) : p.geoBox;
      bulb.set(b.min.x + (b.max.x - b.min.x) * at[0], b.min.y + (b.max.y - b.min.y) * at[1], b.min.z + (b.max.z - b.min.z) * at[2]);
    }
    const off = val(src.offset, params);
    if (off) bulb.add(_v.fromArray(off));
    e.bulb = bulb;
    // spot direction (pivot space); screens shine along their surface normal
    e.dir = new THREE.Vector3(0, -1, 0);
    if (e.kind === 'screen') {
      const n = atMesh?.geometry.attributes.normal;
      if (n) e.dir.set(n.getX(0), n.getY(0), n.getZ(0)).applyMatrix3(_m3.getNormalMatrix(atMesh.matrix)).normalize();
      else e.dir.set(0, 0, 1);
      bulb.addScaledVector(e.dir, 0.05);
    } else if (src.dir) e.dir.fromArray(val(src.dir, params)).normalize();
    // glowing parts: listed roles; realistic models: the parts around the bulb
    const glow = new Set(val(src.glow, params) || []);
    e.glow = [];
    e.hide = [];
    const hide = new Set(src.hideOff || []);
    if (p.type.model && !p.loading) {
      const diag = p.geoBox.isEmpty() ? 0.5 : p.geoBox.getSize(_v).length();
      const vol = (b) => { const s = b.getSize(_v3); return Math.max(1e-6, s.x * s.y * s.z); };
      const vAll = p.geoBox.isEmpty() ? 1 : vol(p.geoBox);
      for (const m of p.meshes) {
        const part = m.userData.part;
        if (!part) continue;
        const b = part.box, mat = part.mat || {};
        const contains = _box.copy(b).expandByScalar(0.02).containsPoint(bulb);
        const near = b.distanceToPoint(bulb) < diag * 0.06;
        const light = _c.set(mat.color || '#ffffff').getHSL({}).l > 0.6;
        if ((contains && vol(b) < vAll * 0.45) || (mat.transparent && near) || (near && light && vol(b) < vAll * 0.2)) e.glow.push(m);
      }
    } else {
      for (const m of p.meshes) {
        if (glow.has(m.userData.role)) e.glow.push(m);
        if (hide.has(m.userData.role)) e.hide.push(m);
      }
    }
    // the parts around the bulb never block its own light
    for (const m of e.glow) m.castShadow = false;
    for (const m of e.hide) m.castShadow = false;
    e.glowKey = '';
  }

  _prepareWindow(e) {
    // glass never blocks the sun (it would cast a full shadow)
    for (const m of e.prop.meshes) if (m.userData.role === 'glass') m.castShadow = false;
  }

  // ================================================================== assignment
  _budget() {
    const q = this.app.modules?.render?.quality?.id || 'alta';
    return BUDGET[q] || BUDGET.alta;
  }

  /** Points the light budget favours: the visible characters (chest height), else the orbit target. */
  _focusPoints() {
    const f = this._focus;
    let n = 0;
    for (const ch of this.app.characters) {
      if (!ch.root.visible) continue;
      const v = f[n] || (f[n] = new THREE.Vector3());
      v.copy(ch.root.position); v.y += 1.1;
      n++;
    }
    if (!n) { (f[0] || (f[0] = new THREE.Vector3())).copy(this.app.controls.target); n = 1; }
    f.length = n;
    return f;
  }

  _assign() {
    const app = this.app, budget = this._budget();
    const focus = this._focusPoints();
    const alone = this.mode !== 'mix';
    const gain = alone ? ALONE_GAIN : 1;
    const ranked = [];
    let lit = 0;
    for (const e of this.entries.values()) {
      if (!e.src) continue;
      const p = e.prop, st = this.state(p);
      let on = st.on;
      if (this.mode === 'solo') on = p.id === this.soloId && on;
      if (!p.root.visible) on = false;
      e.on = on;
      e.lit = false;
      e.wantLight = false;
      // glow + hidden flames follow the switch (and the colour / intensity)
      this._applyGlow(e, on, st);
      if (!on || st.intensity <= 0.001) continue;
      lit++;
      const params = p.params;
      const cd = (+val(e.src.cd, params) || 1) * st.intensity * gain;
      // world position / direction
      p.pivot.updateWorldMatrix(true, false);
      const W = p.pivot.matrixWorld;
      e.wpos = (e.wpos || new THREE.Vector3()).copy(e.bulb).applyMatrix4(W);
      e.wdir = (e.wdir || new THREE.Vector3()).copy(e.dir).transformDirection(W);
      const sc = p.root.getWorldScale(_v).x;
      e.cd = cd * sc * sc;
      e.range = (+val(e.src.range, params) || 8) * Math.max(0.5, sc);
      // already lit by a rig extra (landscape street lamps at night): only glow
      if (!alone && this._claimedBy(e)) continue;
      e.wantLight = true;
      let d2 = Infinity;
      for (const f of focus) d2 = Math.min(d2, f.distanceToSquared(e.wpos));
      e.score = e.cd / Math.max(0.3, d2);
      e.color = st.color;
      ranked.push(e);
    }
    ranked.sort((a, b) => b.score - a.score);
    // the pool: the preset's fixed slots, from the first lamp of the session on (lit or not,
    // kept when lamps are deleted): lamps switched, added or removed never recompile the
    // shaders. Only a new quality preset resizes it.
    if (!this._poolOn && [...this.entries.values()].some((e) => e.src)) this._poolOn = true;
    for (const kind of ['point', 'spot']) this._resizePool(kind, this._poolOn ? budget[kind] : 0);
    // the strongest sources, within the preset's total and the slots of each kind
    const chosen = [], used = { point: 0, spot: 0 };
    for (const e of ranked) {
      if (chosen.length >= budget.max) break;
      const kind = e.kind === 'point' ? 'point' : 'spot';
      if (used[kind] >= this.pool[kind].length) continue;
      used[kind]++;
      chosen.push(e);
    }
    this._overBudget = chosen.length < ranked.length;
    // shadows (alta): slot 0 of each kind is shadow-capable for good (a stable program); the
    // strongest source casts, the other slot 0 (if lit) casts nothing and renders no map
    const shadowsOn = app.renderer.shadowMap.enabled && budget.shadows > 0;
    const caster = shadowsOn && chosen.length ? chosen[0] : null;
    const slots = { point: 0, spot: 0 };
    for (const e of chosen) {
      const kind = e.kind === 'point' ? 'point' : 'spot';
      const L = this.pool[kind][slots[kind]++];
      this._setupLight(L, e, kind, budget);
      e.lit = true;
      e.light = L;
    }
    let shadows = 0;
    for (const kind of ['point', 'spot']) {
      const pool = this.pool[kind];
      for (let i = slots[kind]; i < pool.length; i++) pool[i].intensity = 0;
      for (let i = 0; i < pool.length; i++) {
        const L = pool[i], capable = shadowsOn && i === 0;
        if (L.castShadow !== capable) { L.castShadow = capable; app.refreshShadows?.(); }
        const on = capable && !!caster && caster.light === L && L.intensity > 0;
        L.shadow.intensity = on ? 1 : 0;
        if (L.shadow.autoUpdate !== on) { L.shadow.autoUpdate = on; if (on) app.refreshShadows?.(); }
        // a shadow-capable light needs a map, even idle (the core redraws every shadow map
        // while one is missing): an idle one draws it once
        if (capable && !L.shadow.map) L.shadow.needsUpdate = true;
        if (on) shadows++;
      }
    }
    const nWin = this._assignWindows(budget, alone);
    this._stats = {
      sources: [...this.entries.values()].filter((e) => e.src).length, lit, lights: chosen.length,
      shadows, windows: nWin, pool: this.pool.point.length + this.pool.spot.length,
    };
    this._glowCheck = false;
  }

  _resizePool(kind, size) {
    const pool = this.pool[kind];
    if (pool.length === size) return;
    while (pool.length > size) {
      const L = pool.pop();
      this.group.remove(L);
      if (L.target) this.group.remove(L.target);
      L.dispose();
    }
    while (pool.length < size) {
      const L = kind === 'point' ? new THREE.PointLight(0xffffff, 0, 8, 2) : new THREE.SpotLight(0xffffff, 0, 8, Math.PI / 4, 0.5, 2);
      L.name = `pv-practical-${kind}`;
      L.castShadow = false;
      L.shadow.camera.near = 0.04;
      L.shadow.bias = -0.0006;
      L.shadow.normalBias = 0.02;
      L.shadow.radius = 3;
      L.userData.pvPractical = true;
      this.group.add(L);
      if (L.target) this.group.add(L.target);
      pool.push(L);
    }
    this.app.refreshShadows?.();
  }

  _setupLight(L, e, kind, budget) {
    L.position.copy(e.wpos);
    const src = e.src, params = e.prop.params;
    if (e.color) L.color.set(e.color); else setColorFromKelvin(L.color, val(src.kelvin, params) || 2700);
    L.intensity = e.cd;
    L.distance = e.range;
    L.decay = 2;
    if (kind === 'spot') {
      L.target.position.copy(e.wpos).add(e.wdir);
      L.target.updateMatrixWorld();
      const ang = (+val(src.angle, params) || (e.kind === 'screen' ? 150 : 90)) * 0.5 * DEG;
      L.angle = Math.min(Math.PI / 2 - 0.01, ang);
      L.penumbra = +val(src.penumbra, params) || 0.5;
      // a spot's illuminance along its axis (intensity is in candela): screens light less to the side
    }
    const size = kind === 'point' ? budget.pointMap : budget.spotMap;
    if (L.shadow.mapSize.x !== size) { L.shadow.mapSize.set(size, size); if (L.shadow.map) { L.shadow.map.dispose(); L.shadow.map = null; } }
    L.shadow.camera.far = Math.max(1, e.range);
    L.shadow.camera.updateProjectionMatrix();
    L.updateMatrixWorld();
  }

  /** True when a rig extra point light already sits at this source (landscape street lamps). */
  _claimedBy(e) {
    for (const d of this.rig.lights) {
      if (d.role !== 'extra' || d.type !== 'point' || !d.on) continue;
      const c = Math.cos(d.el);
      _v.set(d.target[0] + Math.sin(d.az) * c * d.dist, d.target[1] + Math.sin(d.el) * d.dist, d.target[2] + Math.cos(d.az) * c * d.dist);
      if (_v.distanceToSquared(e.wpos) < 0.9 * 0.9) return d;
    }
    return null;
  }

  /** Switching a source also switches the rig extra standing in for it (landscape lamps). */
  _syncClaimed(prop, on) {
    const e = this.entries.get(prop);
    if (!e?.wpos) return;
    for (const d of this.rig.lights) {
      if (d.role !== 'extra' || d.type !== 'point') continue;
      const c = Math.cos(d.el);
      _v.set(d.target[0] + Math.sin(d.az) * c * d.dist, d.target[1] + Math.sin(d.el) * d.dist, d.target[2] + Math.cos(d.az) * c * d.dist);
      if (_v.distanceToSquared(e.wpos) < 0.9 * 0.9 && d.on !== on) this.rig.set(d.id, { on }, { keepPreset: true });
    }
  }

  // ================================================================== glow
  _baseSpec(prop, mesh) {
    const u = mesh.userData;
    if (u.part) return partSpec(u.part, prop.color);
    if (u.spec) return typeof u.spec === 'function' ? u.spec(prop.color) : u.spec;
    return (ROLES[u.role] || ROLES.main)(prop.color);
  }

  _applyGlow(e, on, st) {
    const key = `${on ? 1 : 0}|${st.color}|${st.intensity.toFixed(2)}`;
    if (key === e.glowKey && !this._glowCheck) {
      // a rebuild / colour change / style switch replaced the material: re-apply
      let ok = true;
      for (const m of e.glow) if (m.material !== m.userData.pvGlowMat) { ok = false; break; }
      if (ok) return;
    }
    e.glowKey = key;
    const mats = this.app.materials;
    const k = Math.max(0.25, Math.min(1.6, st.intensity));
    for (const m of e.glow) {
      const base = this._baseSpec(e.prop, m);
      let spec = base;
      if (e.src.keepEmissive) {
        if (!on) { spec = { ...base }; delete spec.emissive; delete spec.emissiveMap; delete spec.emissiveIntensity; }
        else spec = { ...base, emissiveIntensity: (base.emissiveIntensity ?? 1) * k };
      } else if (e.src.screenMap && !base.map) {
        // screens built into furniture: a picture while on, dark glass while off
        const pic = screenPicture(val(e.src.screenMap, e.prop.params));
        spec = on ? { ...base, color: '#ffffff', map: pic, emissive: '#ffffff', emissiveMap: pic, emissiveIntensity: 0.9 * k, metalness: 0 } : { ...base, color: '#0d0f13', roughness: 0.12 };
      } else if (on) {
        const role = m.userData.role || '';
        if (e.kind === 'screen' && base.map) spec = { ...base, emissive: '#ffffff', emissiveMap: base.map, emissiveIntensity: 0.95 * k };
        else if (/flame/i.test(role)) {
          // flames: saturated orange core, never blown out to white
          spec = { ...base, color: '#ff9a3c', emissive: '#' + _c.set(st.color).lerp(_c2.set('#ff5a0a'), 0.65).getHexString(), emissiveIntensity: 0.85 * k };
        } else {
          const strong = /bulb|lampGlass|diffuser|lamp/i.test(role) || !!m.userData.part;
          spec = { ...base, emissive: st.color, emissiveIntensity: (strong ? 2.4 : 0.85) * k };
        }
      }
      mats.apply(m, spec);
      m.userData.pvGlowMat = m.material;
    }
    for (const m of e.hide) m.visible = on;
  }

  // ================================================================== windows
  _assignWindows(budget, alone) {
    const app = this.app;
    const wins = [];
    for (const e of this.entries.values()) {
      if (e.src) continue;
      const p = e.prop;
      if (!p.root.visible) continue;
      const st = this.state(p);
      let mode = st.mode;
      if (this.mode === 'solo' && p.id !== this.soloId) mode = 'chiusa';
      const ops = windowsOf(p);
      p.pivot.updateWorldMatrix(true, false);
      const W = p.pivot.matrixWorld;
      const sc = p.root.getWorldScale(_v).x;
      for (const o of ops) {
        const c = o.c.clone().applyMatrix4(W);
        const n = o.n.clone().transformDirection(W);
        let inside = o.inside;
        const f = this._focusPoints();
        if (!inside) {
          // the side of the characters (or of the camera) is the room
          let s = 0;
          for (const q of f) s += Math.sign(_v.subVectors(q, c).dot(n));
          if (!s) s = Math.sign(_v.subVectors(app.camera.position, c).dot(n)) || 1;
          inside = s >= 0 ? 1 : -1;
        }
        const nIn = n.multiplyScalar(inside);
        let d2 = Infinity;
        for (const q of f) d2 = Math.min(d2, q.distanceToSquared(c));
        wins.push({ e, prop: p, c, nIn, w: o.w * sc, h: o.h * sc, mode, intensity: st.intensity, d2 });
      }
    }
    wins.sort((a, b) => a.d2 - b.d2);
    const want = wins.length ? Math.min(budget.windows, wins.length) : 0;
    // light objects: one sun (+ one bounce on 'alta') per lit window, kept while windows exist (no recompiles)
    const dropWin = (w) => { for (const L of [w.sun, w.bounce]) if (L) { this.group.remove(L, L.target); L.map?.dispose(); L.dispose(); } };
    if (this.winLights.length && !!this.winLights[0].bounce !== !!budget.bounce) while (this.winLights.length) dropWin(this.winLights.pop());
    while (this.winLights.length > want) dropWin(this.winLights.pop());
    while (this.winLights.length < want) {
      const sun = new THREE.SpotLight(0xffffff, 0, 0, Math.PI / 8, 0.25, 2);
      sun.name = 'pv-window-sun';
      sun.castShadow = false;
      sun.shadow.bias = -0.0005;
      sun.shadow.normalBias = 0.012;
      // a cookie (light map) shaped like the opening: the sun only passes through the window,
      // the outside of the wall around it stays in shade (the wall cannot shadow its own face)
      const cv = document.createElement('canvas');
      cv.width = cv.height = COOKIE_PX;
      sun.map = new THREE.CanvasTexture(cv);
      sun.userData.cookie = { cv, key: '' };
      const bounce = budget.bounce ? new THREE.SpotLight(0xffffff, 0, 7, Math.PI * 0.42, 1, 2) : null;
      if (bounce) bounce.name = 'pv-window-bounce';
      for (const L of [sun, bounce]) if (L) { L.userData.pvPractical = true; this.group.add(L, L.target); }
      this.winLights.push({ sun, bounce });
      app.refreshShadows?.();
    }
    // backplates: one per opening (also for windows over the light budget)
    this._syncPlates(wins);
    const shadowsOn = app.renderer.shadowMap.enabled;
    let lit = 0;
    for (let i = 0; i < this.winLights.length; i++) {
      const { sun, bounce } = this.winLights[i], w = wins[i];
      const M = WINDOW_MODES[w.mode] || WINDOW_MODES.giorno;
      const k = w.intensity * (alone ? 1.25 : 1);
      // the nearest window's sun keeps castShadow whatever its mode (a stable program: a
      // closed / dimmed window never recompiles the shaders); off, it renders no shadow map
      const cast = shadowsOn && i === 0;
      if (sun.castShadow !== cast) { sun.castShadow = cast; app.refreshShadows?.(); }
      const on = !!M.E && k > 0.001;
      if (sun.shadow.autoUpdate !== on) { sun.shadow.autoUpdate = on; if (on && cast) app.refreshShadows?.(); }
      if (cast && !sun.shadow.map) sun.shadow.needsUpdate = true; // (an idle caster draws its map once)
      if (!on) {
        sun.intensity = 0;
        if (bounce) bounce.intensity = 0;
        continue;
      }
      lit++;
      const dir = this._sunDir(w, M, _v2); // from the window towards the sun (outside)
      const D = 7;
      sun.position.copy(w.c).addScaledVector(dir, D);
      sun.target.position.copy(w.c).addScaledVector(dir, -1);
      // the cone just covers the opening (walls without a ceiling must not let it pass over them):
      // the walls' shadow cuts the exact shape of the window, frame and mullions
      const half = 0.5 * Math.hypot(w.w, w.h);
      sun.angle = Math.min(1.2, Math.atan((half * 1.06) / D));
      sun.penumbra = 0.12;
      sun.distance = 0;
      sun.decay = 2;
      setColorFromKelvin(sun.color, M.kelvin);
      sun.intensity = M.E * k * D * D;
      const ms = budget.windowMap;
      if (sun.shadow.mapSize.x !== ms) { sun.shadow.mapSize.set(ms, ms); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
      sun.shadow.camera.near = D - 1.5;
      sun.shadow.camera.far = D + 14;
      sun.shadow.radius = 1.5 + M.soft * 10;
      sun.shadow.camera.updateProjectionMatrix();
      // soft cool fill coming off the window into the room
      if (bounce) {
        bounce.position.copy(w.c).addScaledVector(w.nIn, 0.45);
        bounce.target.position.copy(w.c).addScaledVector(w.nIn, 2.5).y -= 0.7;
        bounce.angle = Math.PI * 0.36;
        if (M.bounceColor) bounce.color.set(M.bounceColor); else setColorFromKelvin(bounce.color, M.bounceK || 9000);
        bounce.intensity = M.bounce * k * 2.2 * (Math.max(0.3, w.w * w.h) / 1.5);
        bounce.distance = 7;
        bounce.penumbra = 1;
      }
      for (const L of [sun, bounce]) if (L) { L.updateMatrixWorld(); L.target.updateMatrixWorld(); }
      this._drawCookie(sun, w);
    }
    return lit;
  }

  /** the opening seen from the sun light, white on black, in its light-map space */
  _drawCookie(sun, w) {
    const ck = sun.userData.cookie;
    if (!ck || !sun.map) return;
    sun.shadow.updateMatrices(sun);
    const up = _v3.set(0, 1, 0);
    const right = _n.crossVectors(w.nIn, up);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0); else right.normalize();
    up.crossVectors(right, w.nIn).normalize();
    const S = COOKIE_PX, pts = [];
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      _v.copy(w.c).addScaledVector(right, a * w.w * 0.52).addScaledVector(up, b * w.h * 0.52).applyMatrix4(sun.shadow.matrix);
      pts.push(_v.x * S, (1 - _v.y) * S);
    }
    const key = pts.map((v) => Math.round(v * 4)).join();
    if (key === ck.key) return;
    ck.key = key;
    const g = ck.cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#fff';
    g.beginPath();
    for (let i = 0; i < 8; i += 2) { if (i) g.lineTo(pts[i], pts[i + 1]); else g.moveTo(pts[i], pts[i + 1]); }
    g.closePath(); g.fill();
    sun.map.needsUpdate = true;
  }

  /** Sun direction for a window: the landscape's sun when it shines on that side, else a mode default. */
  _sunDir(w, M, out) {
    const nOut = _n.copy(w.nIn).negate();
    const key = this.rig.lights.find((d) => d.role === 'key' && d.type === 'sun' && d.on);
    if (this.app.landscapes?.current && key && w.mode !== 'notte') {
      const c = Math.cos(key.el);
      out.set(Math.sin(key.az) * c, Math.sin(key.el), Math.cos(key.az) * c);
      if (out.dot(nOut) > 0.2 && out.y > 0.05) return out;
    }
    // default: from outside, 25° to the side, mode elevation
    const az = Math.atan2(nOut.x, nOut.z) + 25 * DEG, el = M.el * DEG;
    return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  }

  _syncPlates(wins) {
    while (this.plates.length > wins.length) {
      const m = this.plates.pop();
      this.group.remove(m);
      m.geometry.dispose(); m.material.dispose();
    }
    while (this.plates.length < wins.length) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }));
      m.renderOrder = -1;
      m.name = 'pv-window-sky';
      m.castShadow = m.receiveShadow = false;
      // classified with the grounds by the render pipeline (sky behind the window, never inked)
      m.userData.isGround = true;
      m.userData.noBounds = true;
      m.userData.pvPractical = true;
      m.raycast = noRaycast;
      this.group.add(m);
      this.plates.push(m);
    }
    // render style: line art keeps the paper (no sky), the mannequin style a neutral grey sky
    const style = this.app.modules?.render?.getSettings?.().style || 'realistic';
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i], m = this.plates[i];
      const M = WINDOW_MODES[w.mode] || WINDOW_MODES.giorno;
      m.visible = !!M.sky && style !== 'lines';
      if (!m.visible) continue;
      const sky = style === 'clay' ? (w.mode === 'notte' ? ['#2a2c30', '#3a3d42', '#4a4d52'] : ['#a3a7ac', '#c8cacd', '#e4e5e6']) : M.sky;
      if (m.material.map !== skyTexture(sky)) { m.material.map = skyTexture(sky); m.material.needsUpdate = true; }
      const k = Math.max(0.35, Math.min(1.2, 0.6 + 0.4 * w.intensity));
      m.material.color.setScalar(w.mode === 'notte' ? 1 : k);
      // in the opening, just outside the outer face of a 12 cm wall: never visible around the window
      m.position.copy(w.c).addScaledVector(w.nIn, -0.085);
      m.lookAt(_v.copy(w.c).add(w.nIn));
      m.scale.set(w.w + 0.16, w.h + 0.16, 1);
      m.updateMatrixWorld();
    }
  }
}

/** Lookup used by tests / other modules: the source description of a prop type id. */
export function sourceOfType(id) { return sourceOf(TYPE_BY_ID.get(id)); }
