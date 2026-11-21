// Outfit manager: per-character garment state, layered (inner -> outer) build
// queue processed in small time slices from the render loop, wrinkle updates
// after pose changes (at most once per frame and only for characters whose
// pose changed), skin hiding under garments, materials per render style and
// (de)serialization through ch.data.clothing.
import * as THREE from 'three';
import { BodyTopo, BodyInfo } from './body.js';
import { GARMENT_BY_ID, SLOTS, newItem, defaultOutfit } from './catalog.js';
import { buildGarmentSteps } from './garment.js';
import { FABRICS, weaveNormal, detailMap, HARDWARE } from './fabrics.js';

const SLOT_ORDER = new Map(SLOTS.map((s, i) => [s, i]));
/** build work per frame (ms): a new build stage starts only while below it (one stage can take ~10-40 ms) */
const BUILD_BUDGET_MS = 12;
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
      ch, bi: new BodyInfo(this.topo), shapeV: 0, garments: [], queue: false, job: null, poseDirty: true,
      shapeTimer: 0, hiddenKey: '', listeners: [], covered: new Set(), seenData: ch.data, seenSex: ch.sex,
    };
    this.states.set(ch, st);
    st.bi.update(ch);
    const on = (type, fn) => { ch.addEventListener(type, fn); st.listeners.push([type, fn]); };
    on('pose', () => { st.poseDirty = true; });
    on('shape', () => {
      // Corpo > Sesso: an outfit still equal to the old sex's default becomes the new sex's
      // default. Only for edits of this character (fromJSON replaces ch.data: undo / load).
      if (ch.data === st.seenData && ch.sex !== st.seenSex && !this.app.history?.restoring) this._sexChanged(ch, st.seenSex);
      st.seenData = ch.data; st.seenSex = ch.sex;
      // the built garments ride the bones (frozen bind inverses) until this rebuild
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
    st.job = null;
    for (const [t, fn] of st.listeners) ch.removeEventListener(t, fn);
    for (const g of st.garments) this._dropMesh(st, g);
    this.states.delete(ch);
    this._resolveIdle();
  }

  /** The default outfit of the old sex (same ids, colours, fit) becomes the new sex's default. */
  _sexChanged(ch, oldSex) {
    const key = (items) => JSON.stringify((items || []).map((x) => [x.id, String(x.color).toLowerCase(), +(+x.fit).toFixed(3), +(+(x.wrinkles ?? 1)).toFixed(3)]).sort());
    if (key(ch.data.clothing?.items) !== key(normalizeOutfit({ items: defaultOutfit(oldSex) }, oldSex).items)) return;
    // the data only: the debounced shape sync builds it once, on the new body
    ch.data.clothing = { ...(ch.data.clothing || {}), items: defaultOutfit(ch.sex) };
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

  /**
   * Height (m, along the rest normal) of the outermost garment surface over each
   * body vertex of the character's rest shape (0 where no garment covers it),
   * or null while nothing is built.
   * Used by the hair to drape over the clothes.
   */
  outerOffsets(ch) {
    const st = this.states.get(ch);
    if (!st) return null;
    // build order is inner -> outer and the heights accumulate: the last one has them all
    let surf = null;
    for (const g of st.garments) if (g.runtime && g.surfOut) surf = g.surfOut;
    return surf;
  }

  // ------------------------------------------------------------ diff & queue
  /** Brings the built garments in line with ch.data.clothing (cheap when unchanged). */
  sync(ch) {
    const st = this.states.get(ch);
    if (!st) return;
    const want = normalizeOutfit(ch.data.clothing, ch.sex).items.sort((a, b) => orderOf(a) - orderOf(b));
    ch.data.clothing = { ...(ch.data.clothing || {}), items: want.map((x) => ({ ...x })) };
    st.seenData = ch.data;
    // a dress hides the bra straps (they would show beside its own straps)
    const full = want.some((it) => GARMENT_BY_ID.get(it.id).slot === 'full');
    const old = st.garments;
    const next = [];
    let dirtyFrom = Infinity;
    const job = st.job;
    want.forEach((it, i) => {
      const def = GARMENT_BY_ID.get(it.id);
      const geoKey = `${it.id}|${it.fit.toFixed(3)}|${ch.sex}|${st.shapeV}${full && def.slot === 'underwear' ? '|full' : ''}`;
      const prev = old.find((g) => g.item.id === it.id);
      if (prev) {
        const g = prev;
        const colorChanged = g.item.color !== it.color;
        g.item = { ...it };
        if (colorChanged) this._applyMaterials(g);
        // (a garment the running build job is making is not dirty: only a new key restarts it)
        if (g.geoKey !== geoKey || (!g.runtime && !(job && job.g === g))) { g.geoKey = geoKey; g.stale = true; dirtyFrom = Math.min(dirtyFrom, i); }
        next.push(g);
      } else {
        next.push({ item: { ...it }, def, geoKey, stale: true, mesh: null, runtime: null, hidden: null, occOut: null, surfOut: null, sole: null });
        dirtyFrom = Math.min(dirtyFrom, i);
      }
    });
    // removed garments: drop, and rebuild what was layered over them
    let minLayer = Infinity;
    for (const g of old) if (!next.includes(g)) { this._dropMesh(st, g); minLayer = Math.min(minLayer, g.def.layer); }
    if (dirtyFrom < Infinity) minLayer = Math.min(minLayer, next[dirtyFrom].def.layer);
    for (const g of next) if (g.def.layer > minLayer) g.stale = true;
    st.garments = next;
    st.noStraps = full;
    st.covered = coveredIds(next);
    // a build in flight that is now out of date (its garment, its key or a layer below it
    // changed) restarts from the first stale garment; colour edits do not interrupt it
    if (job && (dirtyFrom <= job.i || next[job.i] !== job.g || job.g.geoKey !== job.geoKey)) st.job = null;
    if (next.some((g) => g.stale)) st.queue = true;
    this._updateHidden(st);
    this._updateClearance(st);
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
      // builds advance in stages (drafts, assembly) within the frame budget
      do {
        if (!st.job) {
          const i = st.garments.findIndex((g) => g.stale);
          if (i < 0) { st.queue = false; this._drained(st); break; }
          st.job = this._startJob(st, i);
        }
        this._step(st);
      } while (performance.now() - t0 < BUILD_BUDGET_MS);
      if (performance.now() - t0 >= BUILD_BUDGET_MS) break;
    }
    // wrinkles: only characters whose pose (or intensity) changed
    for (const st of this.states.values()) {
      if (!st.poseDirty) continue;
      st.poseDirty = false;
      let changed = false, any = false;
      for (const g of st.garments) if (g.runtime) { any = true; break; }
      const M = any ? st.ch.updateSkinMatrices() : null;
      const covered = st.covered;
      // inner layers first: a garment is pushed out by the layers below it
      let innerMoved = false;
      for (const g of st.garments) {
        if (!g.runtime || covered.has(g.item.id)) continue;
        const c = g.runtime.update(st.ch, this.intensity * (g.item.wrinkles ?? 1), M, true, innerMoved);
        innerMoved = innerMoved || c;
        changed = c || changed;
      }
      if (changed) this.app.invalidate();
    }
    if (!busy) this._resolveIdle();
    return busy;
  }

  _resolveIdle() {
    if (!this._idle.length) return;
    for (const s of this.states.values()) if (s.queue) return;
    const r = this._idle; this._idle = []; r.forEach((f) => f());
  }

  /** Build queue drained: drop build-time caches, tell listeners (hair drapes over the outfit). */
  _drained(st) {
    st.bi.releaseCaches?.();
    this.dispatchEvent({ type: 'built', character: st.ch });
  }

  _startJob(st, i) {
    const g = st.garments[i];
    const prevOcc = i > 0 ? st.garments[i - 1].occOut : null;
    const prevSurf = i > 0 ? st.garments[i - 1].surfOut : null;
    const ctx = { topo: this.topo, bi: st.bi, occ: prevOcc, surf: prevSurf, sex: st.ch.sex, ch: st.ch, noStraps: st.noStraps };
    return { g, i, geoKey: g.geoKey, prevOcc, prevSurf, gen: buildGarmentSteps(ctx, g.def, g.item) };
  }

  /** Runs one stage of the current build; finishes the garment after its last stage. */
  _step(st) {
    const job = st.job;
    let r = null;
    try {
      r = job.gen.next();
    } catch (e) {
      console.error('[clothing] build failed', job.g.item.id, e);
      r = { done: true, value: null };
    }
    if (!r.done) return;
    st.job = null;
    this._finish(st, job, r.value);
  }

  _finish(st, job, res) {
    const { g, i, prevOcc, prevSurf } = job;
    g.stale = false;
    this._dropMesh(st, g);
    if (!res) { g.occOut = prevOcc ? prevOcc.slice() : new Float32Array(this.topo.nv).fill(-1); g.surfOut = prevSurf ? prevSurf.slice() : new Float32Array(this.topo.nv); return; }
    const ch = st.ch;
    g.runtime = res.runtime;
    g.hidden = res.hidden;
    g.occOut = res.occ;
    g.surfOut = res.surf;
    const mesh = new THREE.SkinnedMesh(res.runtime.geometry, []);
    mesh.name = 'garment:' + g.item.id;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.garment = g.item.id;
    mesh.userData.clothing = true;
    // shoes are what touches the floor (see ARCHITECTURE: groundContact)
    if (g.def.sole) mesh.userData.groundContact = true;
    g.mesh = mesh;
    this._applyMaterials(g);
    ch.addAttachment(mesh);
    // own skeleton with the bind inverses of THIS body shape: while a body slider is
    // dragged (before the debounced rebuild) the garment rides the moving bones
    // instead of staying where the old body was
    mesh.bind(new THREE.Skeleton(ch.bones, ch.skeleton.boneInverses.map((m) => m.clone())), new THREE.Matrix4());
    mesh.userData.ownSkeleton = true;
    // stay over the garments below (shoes are rigid: never pushed; underwear is
    // skin tight with the body's own weights: nothing to correct, not worth the cost)
    if (g.def.slot !== 'shoes') g.runtime.bindLayers(st.garments.slice(0, i).filter((x) => x.def.slot !== 'underwear').map((x) => x.runtime));
    // fine adjacency is only needed by the layer pass
    if (!g.runtime.layers && g.runtime.fine) g.runtime.fine.adj = null;
    // loose fabric lies on the floor (shoes define the contact themselves)
    g.runtime.floor = !g.def.sole;
    g.runtime.update(ch, this.intensity * (g.item.wrinkles ?? 1), ch.updateSkinMatrices());
    if (g.def.sole) { g.sole = soleDepth(ch, mesh); this._updateClearance(st); }
    // outer layers must be rebuilt over this one
    for (let j = i + 1; j < st.garments.length; j++) if (st.garments[j].def.layer > g.def.layer) st.garments[j].stale = true;
    this._updateHidden(st);
    this.app.invalidate();
  }

  /**
   * Shoe soles: the body is raised by the outsole depth measured on the built shoe
   * (its lowest rest point below the lowest skin point), so the soles rest on the
   * floor. Until the shoe is built the previous value (or the catalog estimate) is kept.
   */
  _updateClearance(st) {
    const shoe = st.garments.find((g) => g.def.sole);
    let lift = 0;
    if (shoe) lift = shoe.mesh && shoe.sole !== null ? shoe.sole : st.ch.groundClearance > 0 ? st.ch.groundClearance : (shoe.def.sole.below || 0) + 0.002;
    st.ch.setGroundClearance?.(lift);
  }

  _dropMesh(st, g) {
    if (g.mesh) {
      const sk = g.mesh.userData.ownSkeleton ? g.mesh.skeleton : null;
      st.ch.removeAttachment(g.mesh); // disposes the geometry
      sk?.dispose();
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

/** Outsole depth of a built shoe: lowest rest point of the mesh below the lowest skin point (m). */
function soleDepth(ch, mesh) {
  const pos = mesh.geometry.attributes.position.array;
  let shoe = Infinity;
  for (let i = 1; i < pos.length; i += 3) if (pos[i] < shoe) shoe = pos[i];
  const R = ch.restPositions;
  let skin = Infinity;
  for (const v of ch.model.groupVertices[0]) if (R[v * 3 + 1] < skin) skin = R[v * 3 + 1];
  return Number.isFinite(shoe) && Number.isFinite(skin) ? Math.max(0, Math.min(0.03, skin - shoe)) : 0;
}

/** Multiplies a hex color's lightness. */
function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return '#' + c.getHexString();
}
