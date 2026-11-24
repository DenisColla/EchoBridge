// Geometry kit for procedural buildings.
//
// Builder accumulates raw vertex arrays per material role (one mesh per role
// in the end: a whole building is ~10-20 draw calls). Primitives are written
// in LOCAL coordinates and transformed by a matrix stack (push / translate /
// rotateY / pop), so a facade can be authored flat (x right, y up, +z out) and
// placed on any side of any footprint.
//
// UVs are generated in building space, in meters divided by the material's
// tile size, by planar projection on the face (u along the horizontal tangent,
// v up / up-slope), so brick courses stay continuous across parts and
// aligned with roof slopes. Materials with unit UVs (window interiors, signs)
// take explicit per-quad UVs.
import * as THREE from 'three';
import { mat as M, tileOf } from './mats.js';

export class Rand {
  constructor(seed) { this.s = (seed >>> 0) || 1; }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  chance(p) { return this.next() < p; }
  fork(k = 0) { return new Rand(((this.s ^ Math.imul(k + 1, 2654435761)) >>> 0) || 7); }
}

class Acc {
  constructor() { this.p = []; this.n = []; this.u = []; this.i = []; this.count = 0; }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _n = new THREE.Vector3(), _t = new THREE.Vector3(), _bt = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Skip flags for box faces. */
export const SKIP = { nx: 1, px: 2, ny: 4, py: 8, nz: 16, pz: 32 };

export class Builder {
  constructor() {
    this.acc = new Map(); // descriptor -> Acc
    this.m = new THREE.Matrix4();
    this.stack = [];
    this.tris = 0;
  }

  // ------------------------------------------------------------ transforms
  push() { this.stack.push(this.m.clone()); return this; }
  pop() { this.m.copy(this.stack.pop()); return this; }
  translate(x, y, z) { this.m.multiply(_m1.makeTranslation(x, y, z)); return this; }
  rotateY(a) { if (a) this.m.multiply(_m1.makeRotationY(a)); return this; }
  rotateX(a) { if (a) this.m.multiply(_m1.makeRotationX(a)); return this; }
  rotateZ(a) { if (a) this.m.multiply(_m1.makeRotationZ(a)); return this; }
  /** Facade frame: origin at (x, z) on the ground plane, local +x along (ux, uz), local +z outward. */
  frame(x, z, ux, uz) {
    _m1.set(ux, 0, -uz, x, 0, 1, 0, 0, uz, 0, ux, z, 0, 0, 0, 1);
    this.m.multiply(_m1);
    return this;
  }

  _accOf(d) {
    let a = this.acc.get(d);
    if (!a) { a = new Acc(); this.acc.set(d, a); }
    return a;
  }

  // ------------------------------------------------------------ primitives
  /**
   * Quad a,b,c,d (local [x,y,z]), counter-clockwise seen from the front.
   * want: optional local normal hint; the quad is flipped if it faces away.
   * uv: optional explicit [[u,v] x4] (unit-UV materials).
   */
  quad(d, a, b, c, e, uv = null, want = null) {
    if (!d) return;
    _a.set(a[0], a[1], a[2]).applyMatrix4(this.m);
    _b.set(b[0], b[1], b[2]).applyMatrix4(this.m);
    _c.set(c[0], c[1], c[2]).applyMatrix4(this.m);
    _d.set(e[0], e[1], e[2]).applyMatrix4(this.m);
    _n.crossVectors(_e1.subVectors(_b, _a), _e2.subVectors(_d, _a));
    if (_n.lengthSq() < 1e-14) _n.crossVectors(_e1.subVectors(_c, _b), _e2.subVectors(_a, _b));
    if (_n.lengthSq() < 1e-14) return;
    _n.normalize();
    if (want) {
      _t.set(want[0], want[1], want[2]).transformDirection(this.m);
      if (_n.dot(_t) < 0) { // flip winding
        _n.negate();
        const tmp = _b.clone(); _b.copy(_d); _d.copy(tmp);
        if (uv) uv = [uv[0], uv[3], uv[2], uv[1]];
      }
    }
    const A = this._accOf(d);
    const base = A.count;
    const pts = [_a, _b, _c, _d];
    if (uv) for (const q of uv) A.u.push(q[0], q[1]);
    else this._planarUV(d, pts, _n, A.u);
    for (const p of pts) { A.p.push(p.x, p.y, p.z); A.n.push(_n.x, _n.y, _n.z); }
    A.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    A.count += 4;
    this.tris += 2;
  }

  /** Triangle (local), CCW from the front. */
  tri(d, a, b, c, want = null) { this.quad(d, a, b, c, c, null, want); }

  /** Convex planar polygon (local points), CCW seen from the front (fan). */
  poly(d, pts, want = null) {
    for (let i = 1; i + 1 < pts.length; i++) this.tri(d, pts[0], pts[i], pts[i + 1], want);
  }

  _planarUV(d, pts, n, out) {
    const [su, sv] = tileOf(d);
    if (Math.abs(n.y) > 0.999) _t.set(1, 0, 0); else _t.crossVectors(UP, n).normalize();
    _bt.crossVectors(n, _t);
    for (const p of pts) out.push(p.dot(_t) / su, p.dot(_bt) / sv);
  }

  /** Axis-aligned box from (x0,y0,z0) to (x1,y1,z1) in local space. skip: SKIP flags. */
  box(d, x0, y0, z0, x1, y1, z1, skip = 0) {
    if (!d || x1 - x0 < 1e-5 || y1 - y0 < 1e-5 || z1 - z0 < 1e-5) return;
    if (!(skip & SKIP.pz)) this.quad(d, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    if (!(skip & SKIP.nz)) this.quad(d, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    if (!(skip & SKIP.px)) this.quad(d, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    if (!(skip & SKIP.nx)) this.quad(d, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    if (!(skip & SKIP.py)) this.quad(d, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    if (!(skip & SKIP.ny)) this.quad(d, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
  }

  /** Box centered at (cx, cy, cz) with sizes w, h, dz. */
  boxC(d, cx, cy, cz, w, h, dz, skip = 0) { this.box(d, cx - w / 2, cy - h / 2, cz - dz / 2, cx + w / 2, cy + h / 2, cz + dz / 2, skip); }

  /** Box between two points along any direction in the local XZ plane (beam, rail), square section s × h. */
  beam(d, x0, z0, x1, z1, y0, h, s) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz);
    if (L < 1e-5) return;
    this.push().translate(x0, y0, z0).rotateY(Math.atan2(-dz, dx));
    this.box(d, 0, 0, -s / 2, L, h, s / 2);
    this.pop();
  }

  /** Rod (square or n-gon prism) between two arbitrary local points. */
  rod(d, a, b, r, seg = 6) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const L = A.distanceTo(B);
    if (L < 1e-5) return;
    const q = new THREE.Quaternion().setFromUnitVectors(UP, B.clone().sub(A).normalize());
    this.push();
    this.m.multiply(_m1.compose(A, q, _one));
    this.cyl(d, 0, 0, r, r, 0, L, seg, { top: false, bottom: false, smooth: seg > 6 });
    this.pop();
  }

  /**
   * Cylinder / frustum around the local Y axis at (cx, cz). seg sides; opts:
   * {top, bottom (caps), smooth (normals), a0, a1 (arc in radians, 0 = +z), inner (normals inward)}.
   * UV: u = arc length (m), v = y (m).
   */
  cyl(d, cx, cz, r0, r1, y0, y1, seg = 16, opts = {}) {
    if (!d) return;
    const { top = true, bottom = false, smooth = true, a0 = 0, a1 = Math.PI * 2, inner = false } = opts;
    const A = this._accOf(d);
    const [su, sv] = tileOf(d);
    const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
    const slope = (r0 - r1) / Math.max(1e-6, y1 - y0); // normal tilt for frusta
    const ny0 = slope / Math.sqrt(1 + slope * slope), nr = 1 / Math.sqrt(1 + slope * slope);
    const rm = (r0 + r1) / 2;
    const ring = (i) => a0 + ((a1 - a0) * i) / seg;
    const sgn = inner ? -1 : 1;
    if (smooth) {
      const base = A.count;
      for (let i = 0; i <= seg; i++) {
        const a = ring(i), s = Math.sin(a), c = Math.cos(a);
        for (const [r, y] of [[r0, y0], [r1, y1]]) {
          _a.set(cx + s * r, y, cz + c * r).applyMatrix4(this.m);
          _n.set(s * nr * sgn, ny0 * sgn, c * nr * sgn).transformDirection(this.m);
          A.p.push(_a.x, _a.y, _a.z); A.n.push(_n.x, _n.y, _n.z);
          A.u.push((a * rm) / su, y / sv);
        }
      }
      for (let i = 0; i < seg; i++) {
        const k = base + i * 2;
        if (inner) A.i.push(k, k + 1, k + 2, k + 2, k + 1, k + 3);
        else A.i.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
      A.count += (seg + 1) * 2;
      this.tris += seg * 2;
    } else {
      for (let i = 0; i < seg; i++) {
        const aa = ring(i), ab = ring(i + 1);
        const p = (a, r, y) => [cx + Math.sin(a) * r, y, cz + Math.cos(a) * r];
        const am = (aa + ab) / 2;
        this.quad(d, p(aa, r0, y0), p(ab, r0, y0), p(ab, r1, y1), p(aa, r1, y1), null, [Math.sin(am) * sgn, 0, Math.cos(am) * sgn]);
      }
    }
    if (top && r1 > 1e-4) {
      const pts = [];
      for (let i = 0; i <= (full ? seg - 1 : seg); i++) { const a = ring(i); pts.push([cx + Math.sin(a) * r1, y1, cz + Math.cos(a) * r1]); }
      if (!full) pts.push([cx, y1, cz]);
      this.poly(d, pts, [0, 1, 0]);
    }
    if (bottom && r0 > 1e-4) {
      const pts = [];
      for (let i = 0; i <= (full ? seg - 1 : seg); i++) { const a = ring(i); pts.push([cx + Math.sin(a) * r0, y0, cz + Math.cos(a) * r0]); }
      if (!full) pts.push([cx, y0, cz]);
      this.poly(d, pts.reverse(), [0, -1, 0]);
    }
  }

  /** Surface of revolution of a profile [[r, y], ...] (bottom to top) around local Y at (cx, cz). */
  lathe(d, cx, cz, prof, seg = 16) {
    for (let k = 0; k + 1 < prof.length; k++) {
      const [ra, ya] = prof[k], [rb, yb] = prof[k + 1];
      if (Math.abs(ya - yb) < 1e-6 && Math.abs(ra - rb) < 1e-6) continue;
      if (Math.abs(ya - yb) < 1e-6) {
        // flat ring (annulus): facing up if going inward
        const up = rb < ra;
        for (let i = 0; i < seg; i++) {
          const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
          const P = (a, r) => [cx + Math.sin(a) * r, ya, cz + Math.cos(a) * r];
          this.quad(d, P(a0, ra), P(a1, ra), P(a1, rb), P(a0, rb), null, [0, up ? 1 : -1, 0]);
        }
        continue;
      }
      if (ya < yb) this.cyl(d, cx, cz, ra, rb, ya, yb, seg, { top: false, bottom: false, smooth: seg >= 10 });
      else this.cyl(d, cx, cz, rb, ra, yb, ya, seg, { top: false, bottom: false, smooth: seg >= 10, inner: true });
    }
  }

  /** Hemisphere / dome of radius r at (cx, y0, cz). rings × seg. scaleY flattens it. */
  dome(d, cx, y0, cz, r, seg = 16, rings = 6, scaleY = 1) {
    const prof = [];
    for (let i = 0; i <= rings; i++) { const a = (i / rings) * Math.PI / 2; prof.push([Math.cos(a) * r, y0 + Math.sin(a) * r * scaleY]); }
    prof[prof.length - 1][0] = 0;
    this.lathe(d, cx, cz, prof, seg);
  }

  /**
   * Vertical prism from a footprint polygon [[x, z], ...] (any orientation;
   * may be concave). sides/top/bottom: descriptor or null.
   */
  prism(pts, y0, y1, { sides = null, top = null, bottom = null } = {}) {
    const P = orient(pts);
    const n = P.length;
    if (sides) for (let i = 0; i < n; i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % n];
      this.quad(sides, [ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], null, [-(bz - az), 0, bx - ax]);
    }
    if (top || bottom) {
      const shape = P.map(([x, z]) => new THREE.Vector2(x, z));
      const tris = THREE.ShapeUtils.triangulateShape(shape, []);
      for (const [i, j, k] of tris) {
        if (top) this.tri(top, [P[i][0], y1, P[i][1]], [P[j][0], y1, P[j][1]], [P[k][0], y1, P[k][1]], [0, 1, 0]);
        if (bottom) this.tri(bottom, [P[i][0], y0, P[i][1]], [P[j][0], y0, P[j][1]], [P[k][0], y0, P[k][1]], [0, -1, 0]);
      }
    }
  }

  /**
   * Profile swept along a polygon/polyline footprint (cornices, string courses,
   * plinths, parapets, eaves). path: [[x, z], ...]; profile: [[o, y], ...] where
   * o = outward offset (m) from the path, traversed from the bottom up on the
   * outside. closed: the path is a closed footprint.
   */
  sweep(d, path, profile, closed = true) {
    if (!d) return;
    const P = closed ? orient(path) : path;
    const n = P.length;
    // outward unit normals of edges and miter vectors at vertices
    const en = [];
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % n];
      const L = Math.hypot(bx - ax, bz - az) || 1;
      en.push([-(bz - az) / L, (bx - ax) / L]);
    }
    const miter = [];
    for (let i = 0; i < n; i++) {
      let a = closed ? en[(i - 1 + n) % n] : en[Math.max(0, i - 1)], b = closed ? en[i % n] : en[Math.min(en.length - 1, i)];
      const dot = a[0] * b[0] + a[1] * b[1];
      const k = 1 / Math.max(0.2, 1 + dot);
      miter.push([(a[0] + b[0]) * k, (a[1] + b[1]) * k]);
    }
    const edges = closed ? n : n - 1;
    for (let s = 0; s + 1 < profile.length; s++) {
      const [o0, y0] = profile[s], [o1, y1] = profile[s + 1];
      for (let i = 0; i < edges; i++) {
        const j = (i + 1) % n;
        const a = [P[i][0] + miter[i][0] * o0, y0, P[i][1] + miter[i][1] * o0];
        const b = [P[j][0] + miter[j][0] * o0, y0, P[j][1] + miter[j][1] * o0];
        const c = [P[j][0] + miter[j][0] * o1, y1, P[j][1] + miter[j][1] * o1];
        const e = [P[i][0] + miter[i][0] * o1, y1, P[i][1] + miter[i][1] * o1];
        // hint: (dy, -do) in the (outward, up) profile plane
        const dy = y1 - y0, dO = o1 - o0;
        this.quad(d, a, b, c, e, null, [en[i][0] * dy, -dO, en[i][1] * dy]);
      }
    }
    if (!closed) {
      // end caps: the profile closed against the wall plane (o = 0), triangulated in 2D
      for (const [idx, sgn] of [[0, -1], [n - 1, 1]]) {
        const e = en[Math.min(en.length - 1, Math.max(0, idx - (sgn > 0 ? 1 : 0)))];
        const dir = [e[1] * sgn, -e[0] * sgn]; // along the path, out of the cap
        const pl = profile[profile.length - 1];
        const ring = [...(Math.abs(profile[0][0]) > 1e-5 ? [[0, profile[0][1]]] : []), ...profile, ...(Math.abs(pl[0]) > 1e-5 ? [[0, pl[1]]] : [])];
        const tris = THREE.ShapeUtils.triangulateShape(ring.map(([o, y]) => new THREE.Vector2(o, y)), []);
        const P3 = ([o, y]) => [P[idx][0] + miter[idx][0] * o, y, P[idx][1] + miter[idx][1] * o];
        for (const [i, j, k] of tris) this.tri(d, P3(ring[i]), P3(ring[j]), P3(ring[k]), [dir[0], 0, dir[1]]);
      }
    }
  }

  /** Bake into {roleName: [BufferGeometry]} for the props system, centered on x/z if asked. */
  finish({ center = true } = {}) {
    const out = {};
    let cx = 0, cz = 0;
    if (center) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const A of this.acc.values()) for (let i = 0; i < A.p.length; i += 3) {
        const x = A.p[i], z = A.p[i + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      if (Number.isFinite(x0)) { cx = (x0 + x1) / 2; cz = (z0 + z1) / 2; }
    }
    for (const [d, A] of this.acc) {
      if (!A.count) continue;
      const pos = new Float32Array(A.p);
      if (cx || cz) for (let i = 0; i < pos.length; i += 3) { pos[i] -= cx; pos[i + 2] -= cz; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(A.n), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(A.u), 2));
      g.setIndex(A.count > 65535 ? new THREE.Uint32BufferAttribute(A.i, 1) : new THREE.Uint16BufferAttribute(A.i, 1));
      out[d.name] = [g];
    }
    return out;
  }
}

const _m1 = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);

/** Signed area (x,z); footprints are kept with NEGATIVE area so (-dz, dx) is the outward normal. */
export function area(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length]; s += ax * bz - bx * az; }
  return s / 2;
}
export function orient(pts) { return area(pts) > 0 ? pts.slice().reverse() : pts; }

/** Rectangle footprint centered at (cx, cz): front edge first (left to right seen from +z). */
export function rect(w, d, cx = 0, cz = 0) {
  return [[cx - w / 2, cz + d / 2], [cx + w / 2, cz + d / 2], [cx + w / 2, cz - d / 2], [cx - w / 2, cz - d / 2]];
}

/** Edges of an oriented footprint as facade frames: {x, z, ux, uz, len, nx, nz, i}. */
export function edgesOf(pts) {
  const P = orient(pts), out = [];
  for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-4) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    out.push({ x: ax, z: az, ux, uz, len: L, nx: -uz, nz: ux, i });
  }
  return out;
}

/** Inset (negative = outset) of a convex/rectilinear footprint by distance t. */
export function inset(pts, t) {
  const P = orient(pts), n = P.length, out = [];
  const en = [];
  for (let i = 0; i < n; i++) {
    const [ax, az] = P[i], [bx, bz] = P[(i + 1) % n], L = Math.hypot(bx - ax, bz - az) || 1;
    en.push([-(bz - az) / L, (bx - ax) / L]);
  }
  for (let i = 0; i < n; i++) {
    const a = en[(i - 1 + n) % n], b = en[i], dot = a[0] * b[0] + a[1] * b[1], k = 1 / Math.max(0.2, 1 + dot);
    out.push([P[i][0] - (a[0] + b[0]) * k * t, P[i][1] - (a[1] + b[1]) * k * t]);
  }
  return out;
}

export { M };
