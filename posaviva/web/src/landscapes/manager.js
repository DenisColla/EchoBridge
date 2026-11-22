// LandscapeManager (app.landscapes): generates a complete environment around the
// characters from a preset + random seed, every time different, and keeps it
// editable: every generated object is a normal prop / building / exterior /
// animal (grouped, so the props tools can move or delete them together), while
// sky, terrain, water, far scatter, weather and fog are an environment layer
// rebuilt from {spec, seed} on undo and scene load.
//
// API (see ARCHITECTURE.md "landscapes"):
//   presets: [{id, label, group, tags}]
//   generate(spec) -> Promise<{id, seed, spec}>   spec = {preset?, place?, time?, weather?, season?, density?, features?, seed?}
//   regenerate() -> same spec, new seed;  clear();  current;  serialize() / deserialize(obj)
//   heightAt(x, z) terrain height;  applySaved(data) restores a saved landscape (projects)
//   events: 'generated' {id, seed, spec, resolved, ms}, 'cleared', 'change', 'progress' {done, total}
import * as THREE from 'three';
import { TYPE_BY_ID, defaultParams, cleanParams } from '../props/catalog.js';
import { characterBounds } from '../scene/bounds.js';
import { makeRng, freshSeed, hashStr } from './rand.js';
import { atmosphere } from './atmos.js';
import { Gen } from './gen/context.js';
import { applyFeatures } from './gen/features.js';
import { Environment } from './env/index.js';
import { rigState } from './lighting.js';
import { PRESET_BY_ID, resolve, cleanSpec, publicPresets } from './presets/index.js';
import { smooth } from './rand.js';

const LS_RECENT = 'posaviva.landscapes.recent';
const DEG = Math.PI / 180;
const _box = new THREE.Box3(), _b2 = new THREE.Box3(), _v = new THREE.Vector3();
const LAMP_TYPES = new Set(['es_lampione', 'lampada_terra', 'abatjour', 'sospensione', 'plafoniera', 'ls_lanterna', 'ls_falo', 'ls_insegna', 'ph_industrial_wall_lamp']);
const NEON_HEX = { rosa: '#ff4fb8', blu: '#43b6ff', verde: '#55ff8a', rosso: '#ff3b3b', giallo: '#ffd23f', viola: '#b467ff' };
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

const loadRecent = () => { try { const v = JSON.parse(localStorage.getItem(LS_RECENT) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const saveRecent = (v) => { try { localStorage.setItem(LS_RECENT, JSON.stringify(v.slice(0, 16))); } catch { /* private mode */ } };

export class LandscapeManager extends THREE.EventDispatcher {
  constructor(app) {
    super();
    this.app = app;
    this.env = new Environment(app);
    this.presets = publicPresets();
    /** active landscape: {id, seed, spec, resolved, frame, group, animals, prevLights, ms, items} | null */
    this.current = null;
    this.busy = false;
    this._token = 0;
    const restyle = () => { this.env.applyStyle(); };
    app.materials.addEventListener('style', restyle);
    app.addEventListener('renderstyle', () => this.env.hideStudioFloor());
  }

  /**
   * Height of the landscape ground at world (x, z): terrain, or a walkable deck
   * (skyscraper roof, pier) above it. 0 without a landscape / terrain.
   */
  heightAt(x, z) {
    if (!this.env.active || !this.env.terrain.cfg) return 0;
    let h = this.env.terrain.heightAt(x, z);
    const f = this.env.terrain.frame;
    if (this._decks?.length && f) {
      const [lx, lz] = this._toLocal(f, x, z);
      for (const d of this._decks) {
        const dx = lx - d.x, dz = lz - d.z, c = Math.cos(d.yaw || 0), s = Math.sin(d.yaw || 0);
        if (Math.abs(dx * c - dz * s) <= d.hx && Math.abs(dx * s + dz * c) <= d.hz) h = Math.max(h, d.y);
      }
    }
    return h;
  }

  // ------------------------------------------------------------------ frame & resolution
  /** Landscape frame: centre between the visible characters, "front" towards the camera (15 deg steps). */
  _frame() {
    const app = this.app;
    const chars = app.characters.filter((c) => c.root.visible);
    let x = app.controls.target.x, z = app.controls.target.z;
    if (chars.length) { x = 0; z = 0; for (const c of chars) { x += c.root.position.x; z += c.root.position.z; } x /= chars.length; z /= chars.length; }
    const cam = app.camera.position;
    const az = Math.abs(cam.x - x) + Math.abs(cam.z - z) < 1e-3 ? 0 : Math.atan2(cam.x - x, cam.z - z);
    const yaw = Math.round(az / (15 * DEG)) * 15 * DEG;
    return { x: +x.toFixed(3), z: +z.toFixed(3), yaw: +yaw.toFixed(5) };
  }

  _toLocal(f, x, z) { const dx = x - f.x, dz = z - f.z, c = Math.cos(f.yaw), s = Math.sin(f.yaw); return [dx * c - dz * s, dx * s + dz * c]; }
  _toWorld(f, x, z) { const c = Math.cos(f.yaw), s = Math.sin(f.yaw); return [f.x + x * c + z * s, f.z - x * s + z * c]; }

  /** Runs the preset builder (pure): terrain recipe, scatter, items, animals. */
  _build(resolved, seed, frame, savedChars = null) {
    const preset = PRESET_BY_ID.get(resolved.preset);
    const rng = makeRng(seed ^ hashStr(resolved.preset));
    const atm = atmosphere(resolved, rng.fork('atm'));
    // stage = where the characters stood at generation (stored: rebuilds are exact even if they moved since)
    const chars = savedChars ? savedChars.map(([x, z]) => ({ x, z })) : this.app.characters.filter((c) => c.root.visible).map((c) => {
      const [x, z] = this._toLocal(frame, c.root.position.x, c.root.position.z);
      return { x: +x.toFixed(3), z: +z.toFixed(3) };
    });
    if (!chars.length) chars.push({ x: 0, z: 0 });
    const g = new Gen({ rng: rng.fork('gen'), spec: resolved, atm, chars, camDist: 6 });
    preset.build(g);
    applyFeatures(g, preset.group);
    // the characters' spot is always exactly flat (they stand at y = 0)
    if (g.terrain && g.flatStage !== false) {
      const raw = g.terrain.height, R0 = g.stageR + 0.4;
      const flat = (x, z) => { const r = Math.hypot(x, z); return r < R0 ? 0 : raw(x, z) * smooth(R0, R0 + 4, r); };
      g.terrain.height = flat;
      // objects placed on the raw relief follow the flattened one
      const fix = (it) => { if (Math.hypot(it.x, it.z) < R0 + 4.5) it.y += flat(it.x, it.z) - raw(it.x, it.z); };
      for (const it of g.items) if (it.follow) fix(it);
      for (const a of g.animals) if (a.follow) fix(a);
      for (const e of g.scatter) for (const it of e.items) fix(it);
    }
    return { preset, atm, g, chars: chars.map((c) => [c.x, c.z]) };
  }

  _envDesc(b, seed, frame) {
    const { g, atm } = b;
    this._decks = g.decks || [];
    return {
      atm, frame, seed,
      terrain: g.terrain ? { ...g.terrain, outerR: 1500 } : null,
      scatter: g.scatter,
      precip: g.noPrecip ? null : atm.rain ? 'rain' : atm.snow ? 'snow' : null,
      sky: g.sky !== false,
      fogScale: g.fogScale ?? 1,
      below: atm.fog.color,
    };
  }

  // ------------------------------------------------------------------ novelty
  _signature(r) { return { p: r.preset, t: r.time, w: r.weather, s: r.season, v: r.variant, d: Math.round(r.density * 3) }; }
  _novelty(r, recent) {
    const sig = this._signature(r);
    let min = Infinity;
    for (const o of recent.slice(0, 6)) {
      let d = 0;
      if (o.p !== sig.p) d += 3;
      if (o.t !== sig.t) d += 1;
      if (o.w !== sig.w) d += 1;
      if (o.s !== sig.s) d += 0.8;
      if (o.v !== sig.v) d += 1.2;
      if (o.d !== sig.d) d += 0.4;
      min = Math.min(min, d);
    }
    return min;
  }

  // ------------------------------------------------------------------ generate
  /**
   * Generates a landscape. Without an explicit seed every call is a new
   * variant: a fresh seed is drawn and re-drawn (up to 12 times) until the
   * free choices differ enough from the last generations on this device.
   */
  async generate(spec = {}) {
    const app = this.app;
    const token = ++this._token;
    const t0 = performance.now();
    this._sliceT0 = t0;
    const clean = cleanSpec(spec);
    let seed = clean.seed ?? null, resolved;
    if (seed === null) {
      const recent = loadRecent();
      let best = null;
      for (let i = 0; i < 12; i++) {
        const s = freshSeed(), r = resolve(clean, s), n = this._novelty(r, recent);
        if (!best || n > best.n) best = { s, r, n };
        if (n >= 2.2) break;
      }
      seed = best.s; resolved = best.r;
    } else resolved = resolve(clean, seed);
    const { seed: _drop, ...userSpec } = clean;
    void _drop;
    this.busy = true;
    this.dispatchEvent({ type: 'progress', done: 0, total: 1 });
    // no intermediate frames while the objects are built (the UI stays responsive:
    // the work is split across animation frames); one complete frame at the end
    app.holdRendering(true);
    this._work = 0;
    try {
      // replace the previous landscape (its props, animals, environment)
      const prevLights = this.current?.prevLights || app.lightRig?.getState?.() || null;
      this._removeItems(this.current);
      const frame = this._frame();
      const b = this._build(resolved, seed, frame);
      this.env.build(this._envDesc(b, seed, frame));
      const id = `ls${Date.now().toString(36)}`;
      const group = `L${id}`;
      const made = await this._instantiate(b, frame, group, token);
      if (token !== this._token) return { id, seed, spec: userSpec, aborted: true };
      // characters onto the ground pieces under them (sidewalks), lights, camera
      for (const ch of app.characters) app.city?.liftCharacter?.(ch);
      this._applyLights(b, frame, made.lamps);
      this._frameCamera(b, frame);
      const ms = Math.round(performance.now() - t0);
      this.lastStats = { ms, work: Math.round(this._work + (performance.now() - this._sliceT0)), items: made.count, animals: made.animals.length, scatter: b.g.scatter.reduce((a, e) => a + e.items.length, 0) };
      this.current = { id, seed, spec: userSpec, resolved, frame, chars: b.chars, group, animals: made.animals, prevLights, ms, items: made.count };
      this._remember(resolved);
      app.commit('paesaggio');
      this.dispatchEvent({ type: 'generated', id, seed, spec: userSpec, resolved, ms });
      this.dispatchEvent({ type: 'change' });
      return { id, seed, spec: userSpec };
    } finally {
      if (token === this._token) this.busy = false;
      app.holdRendering(false);
    }
  }

  /** Same spec, new seed (a new variant of the same request). */
  regenerate() {
    const c = this.current;
    return this.generate(c ? { ...c.spec } : {});
  }

  /** Removes the landscape (its objects, animals and environment) and restores the previous lights. */
  clear({ commit = true, lights = true } = {}) {
    ++this._token;
    const c = this.current;
    this._removeItems(c);
    this.env.clear(true);
    if (lights && c?.prevLights && this.app.lightRig?.setState) this.app.lightRig.setState(c.prevLights);
    for (const ch of this.app.characters) this.app.city?.liftCharacter?.(ch);
    this.current = null;
    this.busy = false;
    if (commit && c) this.app.commit('svuota paesaggio');
    this.dispatchEvent({ type: 'cleared' });
    this.dispatchEvent({ type: 'change' });
  }

  _removeItems(c) {
    if (!c) return;
    const M = this.app.props;
    if (M) {
      const list = M.props.filter((p) => p.group === c.group);
      if (list.length) M.removeGroup(list[0]);
    }
    const A = this.app.animals;
    if (A && c.animals?.length) for (const a of [...A.animals]) if (c.animals.includes(a.id)) A.remove(a);
  }

  _remember(r) {
    const recent = loadRecent();
    recent.unshift(this._signature(r));
    saveRecent(recent);
  }

  // ------------------------------------------------------------------ objects
  async _instantiate(b, frame, group, token) {
    const app = this.app, M = app.props, g = b.g;
    const out = { count: 0, lamps: [], animals: [] };
    if (!M) return out;
    const total = g.items.length + g.animals.length;
    let t0 = performance.now(), done = 0;
    this._sliceT0 = this._sliceT0 || t0;
    for (const it of g.items) {
      if (token !== this._token) return out;
      const type = TYPE_BY_ID.get(it.type);
      if (!type) continue;
      if (performance.now() - t0 > 14) {
        M._meshesDirty = true;
        this.dispatchEvent({ type: 'progress', done, total });
        this._work += performance.now() - this._sliceT0;
        await nextFrame();
        t0 = this._sliceT0 = performance.now();
        if (token !== this._token) return out;
      }
      done++;
      const params = cleanParams(type, { ...defaultParams(type), ...(it.params || {}) });
      const yaw = it.yaw + frame.yaw;
      let [wx, wz] = this._toWorld(frame, it.x, it.z);
      let p;
      try { p = M.create({ type: it.type, params, color: it.color || type.color, group, pos: [wx, it.y, wz], rot: [0, yaw, 0] }); }
      catch (e) { console.warn('[landscapes] item failed', it.type, e); continue; }
      if (it.fit) {
        // anchor a side of the footprint on the given point
        const lb = p.localBox;
        if (!lb.isEmpty()) {
          let ax, az;
          if (it.fit.front) { ax = (lb.min.x + lb.max.x) / 2 * p.scale; az = lb.max.z * p.scale; }
          else {
            // ax/az in the landscape frame: footprint corners rotated by the item yaw
            const cy = Math.cos(it.yaw), sy = Math.sin(it.yaw);
            let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
            for (const [bx, bz] of [[lb.min.x, lb.min.z], [lb.max.x, lb.min.z], [lb.min.x, lb.max.z], [lb.max.x, lb.max.z]]) {
              const rx = bx * cy + bz * sy, rz = -bx * sy + bz * cy;
              x0 = Math.min(x0, rx); x1 = Math.max(x1, rx); z0 = Math.min(z0, rz); z1 = Math.max(z1, rz);
            }
            const fx = it.fit.ax < 0 ? x0 : it.fit.ax > 0 ? x1 : (x0 + x1) / 2, fz = it.fit.az < 0 ? z0 : it.fit.az > 0 ? z1 : (z0 + z1) / 2;
            // back to the item's own frame so the common transform below applies
            ax = fx * Math.cos(-it.yaw) + fz * Math.sin(-it.yaw); az = -fx * Math.sin(-it.yaw) + fz * Math.cos(-it.yaw);
          }
          const cy = Math.cos(it.yaw), sy = Math.sin(it.yaw);
          const lx = it.x - (ax * cy + az * sy), lz = it.z - (-ax * sy + az * cy);
          [wx, wz] = this._toWorld(frame, lx, lz);
          p.root.position.set(wx, it.y, wz);
        }
      }
      out.count++;
      if (it.lamp || g.lampTypes.has(it.type)) {
        if (it.lamp) p.root.userData.lsLamp = it.lamp;
        const L = this._lampOf(p);
        if (L) out.lamps.push(L);
      }
    }
    M._meshesDirty = true;
    if (typeof M._changed === 'function') M._changed(null, 'list'); else M.dispatchEvent({ type: 'list' });
    // animals (species data loads asynchronously)
    if (app.animals && g.animals.length) {
      await app.animals.ready;
      for (const a of g.animals) {
        if (token !== this._token) return out;
        const entry = app.animals.entry(a.species);
        if (!entry) continue;
        const [wx, wz] = this._toWorld(frame, a.x, a.z);
        try {
          const pal = entry.palettes?.length ? entry.palettes[Math.floor(Math.abs(Math.sin(a.x * 12.9 + a.z * 78.2)) * entry.palettes.length) % entry.palettes.length].id : undefined;
          const an = await app.animals.add(a.species, { position: [wx, a.y, wz], rotationY: a.yaw + frame.yaw, select: false, size: a.size, palette: pal });
          if (token !== this._token) { app.animals.remove(an); return out; }
          out.animals.push(an.id);
        } catch (e) { console.warn('[landscapes] animal failed', a.species, e); }
      }
    }
    this.dispatchEvent({ type: 'progress', done: total, total });
    return out;
  }

  /** Light source of a lamp-like prop (world head position + colour), or null. */
  _lampOf(p) {
    const t = p.type.id, L = p.root.userData.lsLamp || null;
    const lampish = L || LAMP_TYPES.has(t);
    if (!lampish) return null;
    if ((t === 'ls_lanterna' || t === 'ls_falo') && !p.params.lit) return null;
    p.worldBox(_box);
    let y = _box.max.y - (L?.y ?? 0.25);
    if (t === 'es_lampione') y = p.root.position.y + p.params.height - 0.4;
    else if (t === 'sospensione') y = _box.min.y + 0.15;
    else if (t === 'ls_insegna' || t === 'ph_industrial_wall_lamp') y = (_box.min.y + _box.max.y) / 2;
    return { x: (_box.min.x + _box.max.x) / 2, y, z: (_box.min.z + _box.max.z) / 2, color: L?.color || (t === 'ls_insegna' ? NEON_HEX[p.params.color] : null), kelvin: L?.kelvin || (t === 'plafoniera' ? 4000 : t === 'ls_falo' || t === 'ls_lanterna' ? 1900 : 2500), intensity: L?.intensity, name: L?.name || (t === 'es_lampione' ? 'Lampione' : t === 'ls_falo' ? 'Falò' : t === 'ls_insegna' ? 'Neon' : 'Lampada') };
  }

  /**
   * Changes time of day / weather / season of the active landscape in place:
   * environment, lights, lit windows and lanterns, tree seasons. The user's edits
   * to the objects are kept. patch: {time?, weather?, season?}
   */
  setAtmosphere(patch = {}) {
    const c = this.current;
    if (!c) return false;
    const p2 = cleanSpec(patch);
    const resolved = { ...c.resolved }, spec = { ...c.spec };
    for (const k of ['time', 'weather', 'season']) if (p2[k]) { resolved[k] = p2[k]; spec[k] = p2[k]; } else if (k in patch && !patch[k]) delete spec[k];
    ++this._token;
    const b = this._build(resolved, c.seed, c.frame, c.chars);
    this.env.build(this._envDesc(b, c.seed, c.frame));
    const M = this.app.props, nightOn = b.atm.night || b.atm.dusk, lamps = [];
    const SEAS = { primavera: 'estate', estate: 'estate', autunno: 'autunno', inverno: 'inverno' };
    for (const p of M ? M.props.filter((q) => q.group === c.group) : []) {
      const ids = new Set(p.type.params.map((d) => d.id)), q = {};
      if (ids.has('night') && p.params.night !== nightOn) q.night = nightOn;
      if (ids.has('lit') && (p.type.id === 'ls_lanterna' || p.type.id === 'ls_falo')) { const lit = nightOn || resolved.weather === 'nebbia'; if (p.params.lit !== lit) q.lit = lit; }
      if (ids.has('season') && ['es_quercia', 'es_latifoglia', 'es_betulla', 'es_salice'].includes(p.type.id) && p.params.season !== 'fiori') { const s = SEAS[resolved.season]; if (p.params.season !== s) q.season = s; }
      if (p.type.id === 'ls_fontana' && p.params.water !== (resolved.weather !== 'neve')) q.water = resolved.weather !== 'neve';
      if (Object.keys(q).length) M.setParams(p, q);
      const L = this._lampOf(p);
      if (L) lamps.push(L);
    }
    this._applyLights(b, c.frame, lamps);
    this.current = { ...c, spec, resolved };
    this.app.commit('atmosfera');
    this.dispatchEvent({ type: 'change' });
    return true;
  }

  _target() {
    const chars = this.app.characters.filter((c) => c.root.visible);
    if (!chars.length) return this.app.controls.target.clone().setY(1);
    _box.makeEmpty();
    for (const ch of chars) _box.union(characterBounds(ch, _b2));
    const t = _box.getCenter(new THREE.Vector3());
    t.y = _box.min.y + (_box.max.y - _box.min.y) * 0.6;
    return t;
  }

  _applyLights(b, frame, lamps) {
    const rig = this.app.lightRig;
    if (!rig?.setState) return;
    const t = this._target();
    lamps.sort((p, q) => Math.hypot(p.x - t.x, p.z - t.z) - Math.hypot(q.x - t.x, q.z - t.z));
    const near = lamps.filter((l) => Math.hypot(l.x - t.x, l.z - t.z) < 16);
    const atm = b.g.indoor ? { ...b.atm, lamps: b.atm.lamps || b.atm.night || b.atm.dusk || b.atm.weather === 'pioggia' } : b.atm;
    if (b.g.indoor) atm.ambient = { ...atm.ambient, intensity: Math.max(atm.ambient.intensity, 0.55) };
    rig.setState(rigState(atm, frame, t.toArray().map((v) => +v.toFixed(3)), near, rig.state?.handles !== false));
  }

  /** Frames the characters with the landscape behind them (camera from the "front" of the frame). */
  _frameCamera(b, frame) {
    const app = this.app, cam = app.sceneTools?.camera;
    const chars = app.characters.filter((c) => c.root.visible);
    _box.makeEmpty();
    for (const ch of chars) _box.union(characterBounds(ch, _b2));
    if (_box.isEmpty()) _box.setFromCenterAndSize(new THREE.Vector3(frame.x, 0.9, frame.z), new THREE.Vector3(0.6, 1.8, 0.4));
    const view = b.g.view || {};
    const f = view.focal || 30;
    const aspect = app.camera.aspect || 0.5;
    const tanY = (35 / (2 * f * Math.max(aspect, 1))), tanX = tanY * aspect;
    const size = _box.getSize(new THREE.Vector3()), C = _box.getCenter(new THREE.Vector3());
    const k = view.fill || (b.g.indoor ? 0.5 : 0.4); // fraction of the frame height used by the subject
    let d = Math.max((size.y / 2) / (k * tanY), (size.x / 2 + 0.4) / (0.85 * tanX)) + size.z / 2;
    d *= view.dist || 1;
    d = Math.min(Math.max(d, 2.5), 30);
    const el = (view.el ?? 3) * DEG, az = frame.yaw + (view.az || 0) * DEG;
    // eye-level camera aimed at the chest: horizon around the middle, the landscape above the characters
    const target = new THREE.Vector3(C.x, _box.min.y + size.y * 0.62, C.z);
    const p = new THREE.Vector3(target.x + Math.sin(az) * Math.cos(el) * d, Math.max(0.5, _box.min.y + size.y * 0.8 + Math.sin(el) * d), target.z + Math.cos(az) * Math.cos(el) * d);
    if (cam?.applyView) {
      cam.applyView({ p: p.toArray(), t: target.toArray(), f, r: 0 }, { animate: false });
      cam.crev = (cam.crev || 0) + 1; // the generation's undo step also restores the camera
    } else {
      app.controls.target.copy(target); app.camera.position.copy(p); app.controls.update();
    }
    app.modules?.ui?.viewOffset?.update?.({ keepIfVisible: true });
    app.invalidate();
  }

  // ------------------------------------------------------------------ persistence
  serialize() {
    const c = this.current;
    if (!c) return { v: 1, cur: null };
    return { v: 1, cur: { id: c.id, seed: c.seed, spec: c.spec, resolved: c.resolved, frame: c.frame, chars: c.chars, group: c.group, animals: c.animals, prevLights: c.prevLights, ms: c.ms, items: c.items } };
  }

  /** Idempotent: rebuilds the environment only when the landscape changed (undo / load). */
  deserialize(obj) {
    this._sawScene = true;
    const cur = obj?.cur;
    if (!cur || !cur.id || !PRESET_BY_ID.has(cur.resolved?.preset)) {
      if (this.current || this.env.active) { ++this._token; this.env.clear(true); this.current = null; this.dispatchEvent({ type: 'change' }); }
      return;
    }
    const key = (c) => JSON.stringify([c.id, c.seed, c.resolved, c.frame]);
    const same = this.current && this.env.active && key(this.current) === key(cur);
    this.current = { ...cur, animals: [...(cur.animals || [])] };
    if (!same) {
      ++this._token;
      const b = this._build(cur.resolved, cur.seed, cur.frame, cur.chars);
      this.env.build(this._envDesc(b, cur.seed, cur.frame));
    }
    this.dispatchEvent({ type: 'change' });
  }

  /** Saved landscape data (for app.projects.saveItem): recipe + the current objects. */
  exportData() {
    const c = this.current;
    if (!c) return null;
    const items = (this.app.props?.props || []).filter((p) => p.group === c.group).map((p) => p.toJSON());
    const animals = (this.app.animals?.animals || []).filter((a) => c.animals.includes(a.id)).map((a) => a.toJSON());
    return { v: 1, landscape: this.serialize().cur, items, animals };
  }

  /** Re-applies a saved landscape (exportData) to the current scene. */
  async applySaved(data) {
    if (!data?.landscape) return false;
    const app = this.app;
    this._removeItems(this.current);
    const cur = { ...data.landscape, id: `ls${Date.now().toString(36)}` };
    cur.group = `L${cur.id}`;
    const b = this._build(cur.resolved, cur.seed, cur.frame, cur.chars);
    this.env.build(this._envDesc(b, cur.seed, cur.frame));
    const M = app.props;
    if (M) for (const j of data.items || []) { if (!TYPE_BY_ID.has(j.type)) continue; const q = { ...j, group: cur.group }; delete q.id; delete q.hold; M.create(q); }
    if (M) { M._meshesDirty = true; M._changed?.(null, 'list'); }
    cur.animals = [];
    if (app.animals) for (const j of data.animals || []) { try { const { id, ...rest } = j; void id; const a = await app.animals.add(j.species, { ...rest, position: j.position, rotationY: j.rotationY, select: false }); a.fromJSON?.({ ...rest, id: a.id }); cur.animals.push(a.id); } catch (e) { console.warn('[landscapes] animal restore failed', e); } }
    this.current = { ...cur, prevLights: this.current?.prevLights || app.lightRig?.getState?.() || null };
    this._applyLights(b, cur.frame, []);
    app.commit('paesaggio salvato');
    this.dispatchEvent({ type: 'generated', id: cur.id, seed: cur.seed, spec: cur.spec, resolved: cur.resolved, ms: 0 });
    this.dispatchEvent({ type: 'change' });
    return true;
  }
}
