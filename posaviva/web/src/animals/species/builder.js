// Species builder (build time): collects bones, body primitives, eyes and
// teeth while a family archetype describes an animal. Coordinates: meters,
// Y up, the animal faces +Z, its LEFT side is +X (bones '*.L').
//
// Bone rest frames are world aligned (identity rotation): a bone is just a
// pivot point (head) plus a tail point used for skin weights and picking.
import { ellipsoid, sphere, cone, loft, box, V, Field } from '../engine/sdf.js';

export { V };

export class Builder {
  constructor(meta = {}) {
    this.meta = meta;
    this.bones = [];
    this.byName = new Map();
    this.prims = [];
    this.eyes = [];
    this.teeth = [];
  }

  /** Adds a bone. head/tail: [x, y, z]. */
  bone(name, parent, head, tail) {
    if (this.byName.has(name)) throw new Error('duplicate bone ' + name);
    const pi = parent ? this.byName.get(parent) : -1;
    if (parent && pi === undefined) throw new Error(`bone ${name}: unknown parent ${parent}`);
    const b = { name, parent: pi, head: [...head], tail: [...(tail || head)] };
    this.byName.set(name, this.bones.length);
    this.bones.push(b);
    return b;
  }

  get(name) { return this.bones[this.byName.get(name)]; }
  has(name) { return this.byName.has(name); }

  add(...prims) { for (const p of prims.flat()) if (p) this.prims.push(p); return prims[0]; }

  // ---- primitive shortcuts (o: {bones, part, mat, k, op, noise})
  ell(c, r, o) { return this.add(ellipsoid(c, r, o)); }
  ball(c, r, o) { return this.add(sphere(c, r, o)); }
  cone(a, b, ra, rb, o) { return this.add(cone(a, b, ra, rb, o)); }
  loft(st, o) { return this.add(loft(st, o)); }
  box(c, half, r, o) { return this.add(box(c, half, r, o)); }

  /** Calls fn(sx, S) for the left (sx = +1, S = '.L') and right (sx = -1, S = '.R') sides. */
  sym(fn) { fn(1, '.L'); fn(-1, '.R'); }

  /**
   * Eye: approximate centre, radius, gaze direction (left eye; mirrored
   * automatically). The eyeball is moved along its gaze so that it sits in
   * the head surface (o.protrude = fraction of the radius outside), then an
   * almond socket is carved around it (resolved in finalize()).
   */
  eye(c, r, dir, o = {}) { this._eyeReq = { c, r, dir, o }; }

  /** Resolves deferred features (eye placement against the finished head). */
  finalize() {
    const q = this._eyeReq;
    if (!q) return this;
    const field = new Field(this.prims.filter((p) => p.op === 'add' && (p.bones.includes('head') || p.bones.includes('jaw'))));
    const d0 = V.norm(q.dir);
    // march from outside toward the head along the gaze line through c
    let s = q.r * 8, inside = null;
    for (let i = 0; i < 400; i++) {
      const p = V.add(q.c, V.mul(d0, s));
      if (field.eval(p[0], p[1], p[2]) < 0) { inside = s; break; }
      s -= q.r * 0.04;
      if (s < -q.r * 4) break;
    }
    const surf = inside === null ? 0 : inside;
    const c = V.add(q.c, V.mul(d0, surf - q.r * (1 - (q.o.protrude ?? 0.42))));
    const o = q.o;
    for (const sx of [1, -1]) {
      const cc = [c[0] * sx, c[1], c[2]], d = V.norm([d0[0] * sx, d0[1], d0[2]]);
      this.eyes.push({ bone: o.bone || 'head', pos: cc, r: q.r, dir: d, side: sx });
      const up = o.up || [0, 1, 0];
      const side = V.norm(V.cross(up, d));
      const upv = V.cross(d, side);
      const open = o.open ?? 0.8;
      this.add(ellipsoid(V.add(cc, V.mul(d, q.r * 0.1)), [q.r * (o.wide ?? 1.02), q.r * open, q.r * 1.05], {
        op: 'sub', k: o.k ?? q.r * 0.4, axes: [side, upv, d], mat: o.lidMat || 'fur',
      }));
      // lid rim (a soft ring that frames the eyeball)
      if (o.rim !== false) this.add(ellipsoid(V.add(cc, V.mul(d, q.r * 0.55)), [q.r * 1.12 * (o.wide ?? 1.02), q.r * (open + 0.22), q.r * 0.38], { k: q.r * 0.25, axes: [side, upv, d], bones: [o.bone || 'head'], part: 'eyelid', mat: o.lidMat || 'fur', op: 'add' }));
      this.add(ellipsoid(V.add(cc, V.mul(d, q.r * 0.3)), [q.r * 0.98 * (o.wide ?? 1.02), q.r * open * 0.98, q.r * 1.1], { op: 'sub', k: q.r * 0.12, axes: [side, upv, d], mat: o.lidMat || 'fur' }));
    }
    this._eyeReq = null;
    return this;
  }

  /** Tooth (cone) attached to a bone: base, tip, radius at the base. Mirrored when o.sym. */
  tooth(bone, base, tip, r, o = {}) {
    const list = o.sym ? [1, -1] : [1];
    for (const sx of list) this.teeth.push({ bone: o.sym ? bone : bone, base: [base[0] * sx, base[1], base[2]], tip: [tip[0] * sx, tip[1], tip[2]], r });
  }
}

/** Point helpers */
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mx = (p, sx) => [p[0] * sx, p[1], p[2]];
export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// ------------------------------------------------------------------ coat helpers
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
