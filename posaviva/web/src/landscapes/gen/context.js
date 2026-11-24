// Generation context handed to each preset builder. Collects (in the local frame
// of the landscape: characters near the origin, camera towards +Z, background
// towards -Z) the terrain recipe, backdrop scatter, editable items (props /
// buildings / exteriors) and animals. Pure data: nothing is created here, so the
// same (spec, seed) can be rebuilt any time (undo, scene load).
import { clamp } from '../rand.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export class Gen {
  /**
   * o: {rng, spec (resolved), atm, chars: [{x, z, r}] local, camDist}
   */
  constructor(o) {
    Object.assign(this, o);
    this.items = [];
    this.animals = [];
    this.scatter = [];
    this.terrain = null; // {height, color, water?, roughness?, outerR?}
    this.occ = []; // reserved circles {x, z, r}
    this.rects = []; // reserved oriented rects {x, z, hx, hz, c, s}
    this.decks = []; // walkable surfaces above the terrain {x, z, hx, hz, yaw, y} (roofs, piers)
    this.sky = true;
    this.precipScale = 1;
    this.fogScale = 1;
    this.lampTypes = new Set(['es_lampione', 'lampada_terra', 'abatjour', 'sospensione', 'plafoniera', 'ls_lanterna', 'ls_insegna', 'ls_falo']);
    this.density = clamp(o.spec.density ?? 0.6, 0, 1);
    this.features = (o.spec.features || []).map(norm);
    // stage: every character + a margin
    this.stageR = Math.max(2.2, ...this.chars.map((c) => Math.hypot(c.x, c.z) + 1.4));
    this.camDist = o.camDist || 6;
  }

  /** True when the user asked for this feature (Italian keyword, accent-insensitive, prefix match). */
  want(...words) {
    for (const w of words.map(norm)) for (const f of this.features) if (f.startsWith(w.slice(0, Math.max(4, w.length - 2))) || w.startsWith(f.slice(0, Math.max(4, f.length - 2)))) return true;
    return false;
  }

  /** Count scaled by the density (0..1): ~0.45x .. 1.6x of `base`. */
  n(base, min = 0) { return Math.max(min, Math.round(base * (0.45 + this.density * 1.15))); }

  /** Terrain height (local) when a terrain is set. */
  h(x, z) { return this.terrain ? this.terrain.height(x, z) : 0; }

  /** Is the area around (x, z) with radius r free (stage, camera corridor, reserved spots)? */
  isFree(x, z, r = 0.5, { stage = true, corridor = true, occ = true } = {}) {
    if (stage) for (const c of this.chars) if (Math.hypot(x - c.x, z - c.z) < r + 1.25) return false;
    if (stage && Math.hypot(x, z) < this.stageR * 0.6 + r) return false;
    if (corridor && z > -1 && z < this.camDist + 4) {
      const half = 1.6 + this.stageR * 0.5 + Math.max(0, z) * 0.36;
      if (Math.abs(x) < half + r) return false;
    }
    if (occ) {
      for (const o of this.occ) if (Math.hypot(x - o.x, z - o.z) < r + o.r) return false;
      for (const q of this.rects) {
        const dx = x - q.x, dz = z - q.z;
        const lx = dx * q.c - dz * q.s, lz = dx * q.s + dz * q.c;
        if (Math.abs(lx) < q.hx + r && Math.abs(lz) < q.hz + r) return false;
      }
    }
    return true;
  }

  occupy(x, z, r) { this.occ.push({ x, z, r }); }
  /** Reserves an oriented rectangle (centre, half sizes, yaw). */
  occupyRect(x, z, hx, hz, yaw = 0) { this.rects.push({ x, z, hx, hz, c: Math.cos(yaw), s: Math.sin(yaw) }); }

  /**
   * Adds an editable item. o: {pos: [x, z], y?, yaw?, params?, color?, r? (footprint radius for
   * the free test, 0 = no test), free? (test options), fit?: {ax, az} (pos = that side of the
   * rotated footprint), sink?, terrain? (false: y as given)}. Returns false when the spot is taken.
   */
  add(type, o = {}) {
    const [x, z] = o.pos;
    const r = o.r ?? 0;
    if (r > 0 && !this.isFree(x, z, r, o.free)) return false;
    if (r > 0 && o.reserve !== false) this.occupy(x, z, r * (o.reserveK ?? 1));
    const y = o.y ?? (o.terrain === false ? 0 : this.h(x, z) - (o.sink || 0));
    this.items.push({ type, params: o.params || null, color: o.color || null, x, y, z, yaw: o.yaw || 0, fit: o.fit || null, lamp: o.lamp || null, tag: o.tag || null, follow: o.y === undefined && o.terrain !== false });
    return true;
  }

  /** Tries random spots from sampler() until one is free (n tries). */
  tryAdd(type, o, sampler, tries = 14) {
    for (let i = 0; i < tries; i++) {
      const [x, z, yaw] = sampler();
      if (this.add(type, { ...o, pos: [x, z], yaw: yaw ?? o.yaw })) return true;
    }
    return false;
  }

  /** Random point around the stage: angle from "behind" (-Z) in degrees (|a| <= arc), radius rMin..rMax. */
  around(rMin, rMax, arc = 150, a0 = 0) {
    // about half of the samples fall inside the first camera view (a narrow wedge behind the
    // characters on a portrait phone), so the framing shows the landscape, not empty ground
    if (a0 === 0 && this.rng() < 0.5) {
      const z = -this.rng.range(rMin, rMax), half = (this.camDist - z) * 0.32 * 1.25;
      const x = this.rng.range(-half, half);
      if (Math.hypot(x, z) >= rMin * 0.9) return [x, z, this.rng.range(-Math.PI, Math.PI)];
    }
    const a = (a0 + this.rng.range(-arc, arc)) * Math.PI / 180, r = this.rng.range(rMin, rMax);
    return [Math.sin(a) * r, -Math.cos(a) * r, this.rng.range(-Math.PI, Math.PI)];
  }

  /** Like around(), but keeps a free view cone behind the characters (|angle| < open deg within openR). */
  aroundOpen(rMin, rMax, arc = 150, open = 24, openR = 30) {
    for (let i = 0; i < 12; i++) {
      const p = this.around(rMin, rMax, arc);
      const r = Math.hypot(p[0], p[1]), a = Math.abs(Math.atan2(p[0], -p[1])) * 180 / Math.PI;
      if (r > openR || a > open) return p;
    }
    return this.around(Math.max(rMin, openR), Math.max(rMax, openR + 5), arc);
  }

  animal(species, o = {}) {
    const [x, z] = o.pos;
    if (o.r && !this.isFree(x, z, o.r, o.free)) return false;
    if (o.r) this.occupy(x, z, o.r);
    this.animals.push({ species, x, y: o.y ?? this.h(x, z), z, follow: o.y === undefined, yaw: o.yaw ?? this.rng.range(-Math.PI, Math.PI), size: o.size ?? 1, pose: o.pose || null, palette: o.palette ?? null });
    return true;
  }

  /**
   * Backdrop scatter of a species. o: {count, rMin, rMax, arc (deg, around -Z), minSep, size: [lo, hi],
   * aspect: [lo, hi] (height / width), farR (beyond: far band, no ink), avoid(x, z) -> bool,
   * maxSlope, minH (above water), colors: [hex] per instance, look, sink, cluster (0..1 noise clustering)}
   */
  scatterOf(kind, o) {
    const rng = this.rng, items = [];
    const count = Math.round(o.count);
    const farR = o.farR ?? 70;
    const sep = o.minSep ?? 0;
    const grid = new Map(), cell = Math.max(1, sep);
    const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
    const near = (x, z) => {
      if (!sep) return false;
      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const l = grid.get(`${cx + i},${cz + j}`);
        if (l) for (const p of l) if (Math.hypot(p[0] - x, p[1] - z) < sep) return true;
      }
      return false;
    };
    const arc = (o.arc ?? 180) * Math.PI / 180, a0 = (o.a0 ?? 0) * Math.PI / 180;
    for (let i = 0; i < count * 4 && items.length < count; i++) {
      // radius distributed for uniform area density (sqrt), optionally biased towards rMin
      const t = Math.pow(rng(), o.bias ?? 0.5);
      const r = o.rMin + (o.rMax - o.rMin) * t;
      const a = a0 + (rng() * 2 - 1) * arc;
      const x = Math.sin(a) * r, z = -Math.cos(a) * r;
      if (o.cluster && o.clusterFn && o.clusterFn(x, z) < rng() * o.cluster) continue;
      if (o.avoid && o.avoid(x, z)) continue;
      if (!this.isFree(x, z, o.clear ?? 1.5, { stage: true, corridor: o.corridor !== false, occ: o.occ !== false })) continue;
      const y = this.h(x, z);
      if (o.minH !== undefined && y < o.minH) continue;
      if (o.maxSlope !== undefined) {
        const e = 2, sx = (this.h(x + e, z) - this.h(x - e, z)) / (2 * e), sz = (this.h(x, z + e) - this.h(x, z - e)) / (2 * e);
        if (Math.hypot(sx, sz) > o.maxSlope) continue;
      }
      if (near(x, z)) continue;
      if (sep) { const k = key(x, z); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([x, z]); }
      const s = rng.range(o.size[0], o.size[1]);
      const asp = o.aspect ? rng.range(o.aspect[0], o.aspect[1]) : 1;
      const it = { x, y: y - (o.sink ?? 0.05) * s, z, s, rot: rng.range(-Math.PI, Math.PI), far: r > farR, c: o.colors ? rng.pick(o.colors) : null };
      if (o.aspect) { it.sx = s; it.sy = s * asp; it.sz = s * (o.depthK ? rng.range(o.depthK[0], o.depthK[1]) : 1); }
      if (o.tilt) { it.tx = rng.range(-o.tilt, o.tilt); it.tz = rng.range(-o.tilt, o.tilt); }
      items.push(it);
    }
    if (items.length) this.scatter.push({ kind, look: o.look || {}, items });
    return items;
  }
}
