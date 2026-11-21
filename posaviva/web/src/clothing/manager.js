// Outfit manager: per-character garment state, layered (inner -> outer) build
// queue processed in small time slices from the render loop, wrinkle updates
// after pose changes (at most once per frame and only for characters whose
// pose changed), skin hiding under garments, materials per render style and
// (de)serialization through ch.data.clothing.
import * as THREE from 'three';
import { BodyTopo, BodyInfo } from './body.js';
import { GARMENT_BY_ID, SLOTS, newItem, defaultOutfit } from './catalog.js';
import { buildGarment } from './garment.js';
import { FABRICS, weaveNormal, detailMap, HARDWARE } from './fabrics.js';

const SLOT_ORDER = new Map(SLOTS.map((s, i) => [s, i]));
const BUILD_BUDGET_MS = 28;
const SHAPE_DEBOUNCE_MS = 220;

/** Normalizes ch.data.clothing (missing fields, unknown ids, one item per slot). */
export function normalizeOutfit(data, sex) {
  const items = [];
  const seen = new Set();
  for (const it of data?.items || []) {
    const def = GARMENT_BY_ID.get(it?.id);
    if (!def || seen.has(def.slot) || (def.sex && def.sex !== sex)) continue;
    seen.add(def.slot);
    items.push({ id: def.id, color: typeof it.color === 'string' ? it.color : def.color, fit: clamp01(it.fit ?? 0.5), wrinkles: Math.max(0, Math.min(2, it.wrinkles ?? 1)) });
  }
  // a dress replaces top + bottom
  if (seen.has('full')) for (let i = items.length - 1; i >= 0; i--) { const s = GARMENT_BY_ID.get(items[i].id).slot; if (s === 'top' || s === 'bottom') items.splice(i, 1); }
  return { items };
}
const clamp01 = (x) => Math.max(0, Math.min(1, +x || 0));

/** Build order: layer, then slot. */
function orderOf(it) { const d = GARMENT_BY_ID.get(it.id); return d.layer * 10 + (SLOT_ORDER.get(d.slot) ?? 0); }

export class ClothingManager extends THREE.EventDispatcher {
  constructor(app) {
    super();
    this.app = app;
    this.topo = BodyTopo.of(app.model);
    this.states = new Map();
    this.intensity = 1; // global wrinkle intensity ("Pieghe")
    this._idle = [];
    app.addRenderHook(() => this._frame());
    app.materials.addEventListener('style', () => { for (const st of this.states.values()) for (const g of st.garments) this._applyMaterials(g); this.app.invalidate(); });
  }

  // ------------------------------------------------------------ characters
  add(ch) {
    if (this.states.has(ch)) return this.states.get(ch);
    const st = {
      ch, bi: new BodyInfo(this.topo), shapeV: 0, garments: [], queue: false, poseDirty: true,
      shapeTimer: 0, hiddenKey: '', listeners: [],
    };
    this.states.set(ch, st);
    st.bi.update(ch);
    const on = (type, fn) => { ch.addEventListener(type, fn); st.listeners.push([type, fn]); };
    on('pose', () => { st.poseDirty = true; });
    on('shape', () => {
      clearTimeout(st.shapeTimer);
      st.shapeTimer = setTimeout(() => { if (!this.states.has(ch)) return; st.bi.update(ch); st.shapeV++; this.sync(ch); }, SHAPE_DEBOUNCE_MS);
    });
    // new characters are never nude: default casual outfit (json data wins)
    if (!ch.data.clothing) ch.data.clothing = { items: defaultOutfit(ch.sex) };
    this.sync(ch);
    return st;
  }

  remove(ch) {
    const st = this.states.get(ch);
    if (!st) return;
    clearTimeout(st.shapeTimer);
    for (const [t, fn] of st.listeners) ch.removeEventListener(t, fn);
    for (const g of st.garments) this._dropMesh(st, g);
    this.states.delete(ch);
  }

  // ------------------------------------------------------------ outfit API
  items(ch) { return (ch.data.clothing?.items || []).map((x) => ({ ...x })); }

  /** Replaces the outfit (array of items or ids). */
  setItems(ch, items) {
    ch.data.clothing = normalizeOutfit({ items: items.map((x) => (typeof x === 'string' ? newItem(x, ch.sex) : x)) }, ch.sex);
    this.sync(ch);
  }

  /** Wears a garment (replacing the one in its slot; dress <-> top/bottom). */
  wear(ch, id, patch = {}) {
    const def = GARMENT_BY_ID.get(id);
    if (!def) return null;
    const cur = this.items(ch);
    const prev = cur.find((x) => GARMENT_BY_ID.get(x.id).slot === def.slot);
    let list = cur.filter((x) => GARMENT_BY_ID.get(x.id).slot !== def.slot);
    if (def.slot === 'full') list = list.filter((x) => !['top', 'bottom'].includes(GARMENT_BY_ID.get(x.id).slot));
    if (def.slot === 'top' || def.slot === 'bottom') list = list.filter((x) => GARMENT_BY_ID.get(x.id).slot !== 'full');
    const it = { ...newItem(id, ch.sex), ...(prev && prev.id === id ? prev : {}), ...patch };
    list.push(it);
    this.setItems(ch, list);
    return it;
  }

  takeOff(ch, id) { this.setItems(ch, this.items(ch).filter((x) => x.id !== id)); }

  /** Updates fields of a worn item: {color, fit, wrinkles}. */
  update(ch, id, patch) {
    const list = this.items(ch);
    const it = list.find((x) => x.id === id);
    if (!it) return;
    Object.assign(it, patch);
    this.setItems(ch, list);
  }

  setIntensity(k) {
    this.intensity = Math.max(0, Math.min(2, k));
    for (const st of this.states.values()) st.poseDirty = true;
    this.app.invalidate();
  }

  /** Resolves when no build is pending. */
  whenIdle() {
    if (![...this.states.values()].some((s) => s.queue)) return Promise.resolve();
    return new Promise((r) => this._idle.push(r));
  }

  // ------------------------------------------------------------ diff & queue
  /** Brings the built garments in line with ch.data.clothing (cheap when unchanged). */
  sync(ch) {
    const st = this.states.get(ch);
    if (!st) return;
    const want = normalizeOutfit(ch.data.clothing, ch.sex).items.sort((a, b) => orderOf(a) - orderOf(b));
    ch.data.clothing = { ...(ch.data.clothing || {}), items: want.map((x) => ({ ...x })) };
    const old = st.garments;
    const next = [];
    let dirtyFrom = Infinity;
    want.forEach((it, i) => {
      const geoKey = `${it.id}|${it.fit.toFixed(3)}|${ch.sex}|${st.shapeV}`;
      const prev = old.find((g) => g.item.id === it.id);
      if (prev) {
        const g = prev;
        const colorChanged = g.item.color !== it.color;
        g.item = { ...it };
        if (colorChanged) this._applyMaterials(g);
        if (g.geoKey !== geoKey || !g.runtime) { g.geoKey = geoKey; g.stale = true; dirtyFrom = Math.min(dirtyFrom, i); }
        next.push(g);
      } else {
        next.push({ item: { ...it }, def: GARMENT_BY_ID.get(it.id), geoKey, stale: true, mesh: null, runtime: null, hidden: null, occOut: null });
        dirtyFrom = Math.min(dirtyFrom, i);
      }
    });
    // removed garments: drop, and rebuild what was layered over them
    let minLayer = Infinity;
    for (const g of old) if (!next.includes(g)) { this._dropMesh(st, g); minLayer = Math.min(minLayer, g.def.layer); }
    if (dirtyFrom < Infinity) minLayer = Math.min(minLayer, next[dirtyFrom].def.layer);
    for (const g of next) if (g.def.layer > minLayer) g.stale = true;
    st.garments = next;
    if (next.some((g) => g.stale)) st.queue = true;
    this._updateHidden(st);
    st.poseDirty = true;
    this.app.invalidate();
    this.dispatchEvent({ type: 'change', character: ch });
  }

  _frame() {
    let busy = false;
    const t0 = performance.now();
    for (const st of this.states.values()) {
      if (!st.queue) continue;
      busy = true;
      while (performance.now() - t0 < BUILD_BUDGET_MS) {
        const i = st.garments.findIndex((g) => g.stale);
        if (i < 0) { st.queue = false; this.dispatchEvent({ type: 'built', character: st.ch }); break; }
        this._build(st, i);
      }
      if (performance.now() - t0 >= BUILD_BUDGET_MS) break;
    }
    // wrinkles: only characters whose pose (or intensity) changed
    for (const st of this.states.values()) {
      if (!st.poseDirty) continue;
      st.poseDirty = false;
      let changed = false;
      const M = st.garments.some((g) => g.runtime) ? st.ch.updateSkinMatrices() : null;
      const covered = coveredIds(st.garments);
      for (const g of st.garments) {
        if (!g.runtime || covered.has(g.item.id)) continue;
        changed = g.runtime.update(st.ch, this.intensity * (g.item.wrinkles ?? 1), M) || changed;
      }
      if (changed) this.app.invalidate();
    }
    if (!busy && this._idle.length && ![...this.states.values()].some((s) => s.queue)) { const r = this._idle; this._idle = []; r.forEach((f) => f()); }
    return busy;
  }

  _build(st, i) {
    const g = st.garments[i];
    const prevOcc = i > 0 ? st.garments[i - 1].occOut : null;
    let res = null;
    try {
      res = buildGarment({ topo: this.topo, bi: st.bi, occ: prevOcc, sex: st.ch.sex, ch: st.ch }, g.def, g.item);
    } catch (e) {
      console.error('[clothing] build failed', g.item.id, e);
    }
    g.stale = false;
    this._dropMesh(st, g);
    if (!res) { g.occOut = prevOcc ? prevOcc.slice() : new Float32Array(this.topo.nv).fill(-1); return; }
    g.runtime = res.runtime;
    g.hidden = res.hidden;
    g.occOut = res.occ;
    const mesh = new THREE.SkinnedMesh(res.runtime.geometry, []);
    mesh.name = 'garment:' + g.item.id;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.garment = g.item.id;
    mesh.userData.clothing = true;
    g.mesh = mesh;
    this._applyMaterials(g);
    st.ch.addAttachment(mesh);
    g.runtime.update(st.ch, this.intensity * (g.item.wrinkles ?? 1), st.ch.updateSkinMatrices());
    // outer layers must be rebuilt over this one
    for (let j = i + 1; j < st.garments.length; j++) if (st.garments[j].def.layer > g.def.layer) st.garments[j].stale = true;
    this._updateHidden(st);
    this.app.invalidate();
  }

  _dropMesh(st, g) {
    if (g.mesh) {
      st.ch.removeAttachment(g.mesh); // disposes the geometry
      g.mesh = null;
    }
    g.runtime = null;
  }

  _updateHidden(st) {
    const masks = st.garments.filter((g) => g.hidden && g.mesh).map((g) => g.hidden);
    const key = st.garments.filter((g) => g.hidden && g.mesh).map((g) => g.geoKey).join(',');
    if (key === st.hiddenKey) return;
    st.hiddenKey = key;
    if (!masks.length) { st.ch.setHiddenBodyFaces(null); return; }
    const out = new Uint8Array(this.app.model.faceCount);
    for (const m of masks) for (let f = 0; f < out.length; f++) if (m[f]) out[f] = 1;
    st.ch.setHiddenBodyFaces(out);
  }

  // ------------------------------------------------------------ materials
  _applyMaterials(g) {
    if (!g.mesh) return;
    const style = this.app.materials.style;
    const def = g.def, fab = FABRICS[def.fabric] || FABRICS.jersey;
    const detailed = style === 'realistic' || style === 'clay';
    const nm = detailed ? weaveNormal(def.fabric) : null;
    const map = style === 'realistic' || style === 'toon' ? detailMap(def.details) : null;
    const color = g.item.color;
    const main = { kind: 'cloth', color, roughness: fab.roughness, sheen: fab.sheen, side: 'double' };
    if (nm) { main.normalMap = nm; main.normalScale = fab.ns; }
    if (map) main.map = map;
    const trimColor = def.trim || shade(color, def.fabric === 'denim' ? 0.92 : 0.96);
    const trim = { kind: 'cloth', color: trimColor, roughness: Math.min(1, fab.roughness + 0.04), sheen: fab.sheen, side: 'double' };
    if (detailed) { trim.normalMap = weaveNormal(def.fabric === 'leather' || def.fabric === 'sneaker' ? def.fabric : 'rib'); trim.normalScale = 0.7; }
    let hw;
    if (def.sole) hw = { kind: 'prop', color: def.sole.color, roughness: 0.75, metalness: 0 };
    else {
      const k = def.hardware?.shirtButtons ? 'shirt' : def.hardware?.blazerButtons ? 'blazer' : def.hardware?.zipper ? 'zipper' : 'metal';
      const h = HARDWARE[k];
      hw = { kind: 'prop', color: h.color, roughness: h.roughness, metalness: h.metalness };
    }
    this.app.materials.apply(g.mesh, [main, trim, hw]);
  }
}

/** Garments fully hidden by outer layers: their folds are never seen, skip the update. */
const LEG_BOTTOMS = new Set(['jeans', 'trousers', 'sweatpants', 'cargo', 'leggings']);
function coveredIds(garments) {
  const ids = new Set(garments.map((g) => g.item.id));
  const out = new Set();
  const top = garments.some((g) => g.def.slot === 'top' || g.def.slot === 'outer' || g.def.slot === 'full');
  const pants = [...ids].some((id) => LEG_BOTTOMS.has(id));
  if (ids.has('underwear') && pants && top) out.add('underwear');
  if (ids.has('socks') && ids.has('boots')) out.add('socks');
  return out;
}

/** Multiplies a hex color's lightness. */
function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return '#' + c.getHexString();
}
