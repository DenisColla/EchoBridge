// Signed distance primitives and the body field of an animal (build time).
//
// A species body is a list of primitives combined in order with smooth
// unions (op 'add') and smooth subtractions (op 'sub'). Every primitive also
// carries the data the later build steps need:
//   bones  names of the skeleton bones its surface follows (skin weights)
//   part   anatomical tag used by the coat patterns ('torso', 'leg', 'ear' …)
//   mat    surface region: 'fur' | 'keratin' | 'nose' | 'mouth' | 'pad' | 'skin'
//   k      blend radius (m) of the smooth union with what came before
// Distances are in meters. All primitives return an approximate signed
// distance (exact for spheres / round cones, the usual k0*(k0-1)/k1 bound for
// ellipsoids and elliptic lofts), good enough for meshing and smooth blends.

export const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
};

export function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export function smax(a, b, k) { return -smin(-a, -b, k); }

// ------------------------------------------------------------------ noise
// Hash based 3D gradient noise (deterministic, seeded), values ~[-1, 1].
function hash3(x, y, z, s) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return h;
}
const GRAD = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function noise3(x, y, z, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = fade(xf), v = fade(yf), w = fade(zf);
  let r = 0;
  const g = (dx, dy, dz) => {
    const gr = GRAD[((hash3(xi + dx, yi + dy, zi + dz, seed) >>> 0) % 12)];
    return gr[0] * (xf - dx) + gr[1] * (yf - dy) + gr[2] * (zf - dz);
  };
  const x00 = g(0, 0, 0) + (g(1, 0, 0) - g(0, 0, 0)) * u;
  const x10 = g(0, 1, 0) + (g(1, 1, 0) - g(0, 1, 0)) * u;
  const x01 = g(0, 0, 1) + (g(1, 0, 1) - g(0, 0, 1)) * u;
  const x11 = g(0, 1, 1) + (g(1, 1, 1) - g(0, 1, 1)) * u;
  const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
  r = y0 + (y1 - y0) * w;
  return r * 1.1;
}
export function fbm(x, y, z, oct = 4, seed = 0) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f, seed + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

// ------------------------------------------------------------------ primitives
let _uid = 0;
function base(o, kind) {
  return {
    kind, id: _uid++, op: o.op || 'add', k: o.k ?? 0.01, bones: o.bones || [], part: o.part || 'body',
    mat: o.mat || 'fur', noise: o.noise || null, weight: o.weight ?? 1, tag: o.tag || null, side: o.side || 0, carve: o.carve ?? null,
    min: [0, 0, 0], max: [0, 0, 0],
  };
}

/** Orthonormal basis from a forward axis f and an approximate up u: returns [s, u', f]. */
export function frame(f, u = [0, 1, 0]) {
  f = V.norm(f);
  let up = V.sub(u, V.mul(f, V.dot(u, f)));
  if (V.len(up) < 1e-6) up = Math.abs(f[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  up = V.norm(V.sub(up, V.mul(f, V.dot(up, f))));
  const s = V.cross(up, f);
  return [s, up, f];
}

/**
 * Ellipsoid. c center, r [rx, ry, rz] radii along the basis axes; axes:
 * optional [X, Y, Z] orthonormal basis (world vectors), default world axes.
 */
export function ellipsoid(c, r, o = {}) {
  const p = base(o, 'ellipsoid');
  p.c = c; p.r = r;
  p.axes = o.axes || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const m = Math.max(r[0], r[1], r[2]);
  p.min = [c[0] - m, c[1] - m, c[2] - m]; p.max = [c[0] + m, c[1] + m, c[2] + m];
  p.dist = (x, y, z) => {
    const dx = x - c[0], dy = y - c[1], dz = z - c[2], A = p.axes;
    const qx = (dx * A[0][0] + dy * A[0][1] + dz * A[0][2]) / r[0];
    const qy = (dx * A[1][0] + dy * A[1][1] + dz * A[1][2]) / r[1];
    const qz = (dx * A[2][0] + dy * A[2][1] + dz * A[2][2]) / r[2];
    const k0 = Math.sqrt(qx * qx + qy * qy + qz * qz);
    const k1 = Math.sqrt((qx * qx) / (r[0] * r[0]) + (qy * qy) / (r[1] * r[1]) + (qz * qz) / (r[2] * r[2]));
    return k1 < 1e-9 ? -Math.min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1;
  };
  p.param = () => 0.5;
  return p;
}

export function sphere(c, r, o = {}) { return ellipsoid(c, [r, r, r], o); }

/** Round cone (capsule with different end radii) from a (radius ra) to b (radius rb). Exact SDF. */
export function cone(a, b, ra, rb, o = {}) {
  const p = base(o, 'cone');
  p.a = a; p.b = b; p.ra = ra; p.rb = rb;
  const ba = V.sub(b, a), l2 = V.dot(ba, ba), rr = ra - rb, a2 = l2 - rr * rr, il2 = 1 / l2;
  const m = Math.max(ra, rb);
  p.min = [Math.min(a[0], b[0]) - m, Math.min(a[1], b[1]) - m, Math.min(a[2], b[2]) - m];
  p.max = [Math.max(a[0], b[0]) + m, Math.max(a[1], b[1]) + m, Math.max(a[2], b[2]) + m];
  p.dist = (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2];
    const yy = pax * ba[0] + pay * ba[1] + paz * ba[2];
    const zz = yy - l2;
    const cx = pax * l2 - ba[0] * yy, cy = pay * l2 - ba[1] * yy, cz = paz * l2 - ba[2] * yy;
    const x2 = cx * cx + cy * cy + cz * cz;
    const y2 = yy * yy * l2, z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - rb;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - ra;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - ra;
  };
  p.param = (x, y, z) => Math.min(1, Math.max(0, ((x - a[0]) * ba[0] + (y - a[1]) * ba[1] + (z - a[2]) * ba[2]) * il2));
  return p;
}

/** Catmull-Rom interpolation of station values. */
function cr(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * Loft: a tube along a smooth path through stations, with an elliptic,
 * optionally egg-shaped cross section perpendicular to the path.
 *   stations: [{p:[x,y,z], w (half width along the side axis), ht (half
 *   height above the path, along `up`), hb (below; default ht)}]
 *   o.up: reference up vector of the sections (projected per station), or a
 *   function (t) -> vector; o.caps: [start, end] cap roundness (1 = round
 *   end, 0.2 = flat); o.res: samples per station interval.
 */
export function loft(stations, o = {}) {
  const p = base(o, 'loft');
  const n = stations.length;
  const res = o.res || 6;
  const S = stations.map((s) => ({ p: s.p, w: s.w, ht: s.ht ?? s.h ?? s.w, hb: s.hb ?? s.ht ?? s.h ?? s.w }));
  const at = (i) => S[Math.max(0, Math.min(n - 1, i))];
  const samples = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < res; j++) {
      const t = j / res;
      const a = at(i - 1), b = at(i), c = at(i + 1), d = at(i + 2);
      const pos = [0, 1, 2].map((k) => cr(a.p[k], b.p[k], c.p[k], d.p[k], t));
      const s = t * t * (3 - 2 * t) * 0.5 + t * 0.5; // eased radii between stations
      samples.push({ p: pos, w: b.w + (c.w - b.w) * s, ht: b.ht + (c.ht - b.ht) * s, hb: b.hb + (c.hb - b.hb) * s, u: (i + t) / (n - 1) });
    }
  }
  const L = S[n - 1];
  samples.push({ p: L.p, w: L.w, ht: L.ht, hb: L.hb, u: 1 });
  const caps = o.caps || [1, 1];
  // segment data
  const segs = [];
  for (let i = 0; i < samples.length - 1; i++) {
    const A = samples[i], B = samples[i + 1];
    const ax = V.sub(B.p, A.p), len = V.len(ax);
    if (len < 1e-7) continue;
    const T = V.mul(ax, 1 / len);
    const upA = typeof o.up === 'function' ? o.up(A.u) : (o.up || [0, 1, 0]);
    const upB = typeof o.up === 'function' ? o.up(B.u) : (o.up || [0, 1, 0]);
    const [sA, uA] = frame(T, upA), [sB, uB] = frame(T, upB);
    const mid = V.lerp(A.p, B.p, 0.5);
    const br = len / 2 + Math.max(A.w, A.ht, A.hb, B.w, B.ht, B.hb) * 1.05;
    segs.push({ A, B, T, len, sA, uA, sB, uB, mid, br, first: false, last: false });
  }
  segs[0].first = true; segs[segs.length - 1].last = true;
  p.segs = segs;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const s of samples) {
    const m = Math.max(s.w, s.ht, s.hb);
    for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], s.p[k] - m); mx[k] = Math.max(mx[k], s.p[k] + m); }
  }
  p.min = mn; p.max = mx;
  const evalSeg = (sg, x, y, z, out) => {
    const A = sg.A;
    const dx = x - A.p[0], dy = y - A.p[1], dz = z - A.p[2];
    const proj = dx * sg.T[0] + dy * sg.T[1] + dz * sg.T[2];
    let t = proj / sg.len, h = 0;
    if (t < 0) { h = proj; t = 0; } else if (t > 1) { h = proj - sg.len; t = 1; }
    const B = sg.B;
    const cx = A.p[0] + (B.p[0] - A.p[0]) * t, cy = A.p[1] + (B.p[1] - A.p[1]) * t, cz = A.p[2] + (B.p[2] - A.p[2]) * t;
    const ex = x - cx, ey = y - cy, ez = z - cz;
    // interpolated frame
    let sx = sg.sA[0] + (sg.sB[0] - sg.sA[0]) * t, sy = sg.sA[1] + (sg.sB[1] - sg.sA[1]) * t, sz = sg.sA[2] + (sg.sB[2] - sg.sA[2]) * t;
    let ux = sg.uA[0] + (sg.uB[0] - sg.uA[0]) * t, uy = sg.uA[1] + (sg.uB[1] - sg.uA[1]) * t, uz = sg.uA[2] + (sg.uB[2] - sg.uA[2]) * t;
    const ls = Math.hypot(sx, sy, sz) || 1, lu = Math.hypot(ux, uy, uz) || 1;
    const qx = (ex * sx + ey * sy + ez * sz) / ls, qy = (ex * ux + ey * uy + ez * uz) / lu;
    const w = A.w + (B.w - A.w) * t;
    const hh = qy >= 0 ? A.ht + (B.ht - A.ht) * t : A.hb + (B.hb - A.hb) * t;
    const mr = Math.min(w, hh);
    let rz;
    if (h < 0) rz = sg.first ? Math.max(0.05, caps[0]) * mr : 0.2 * mr;
    else if (h > 0) rz = sg.last ? Math.max(0.05, caps[1]) * mr : 0.2 * mr;
    else rz = mr;
    const a = qx / w, b = qy / hh, c = h / rz;
    const k0 = Math.sqrt(a * a + b * b + c * c);
    const k1 = Math.sqrt((a * a) / (w * w) + (b * b) / (hh * hh) + (c * c) / (rz * rz));
    const d = k1 < 1e-9 ? -mr : (k0 * (k0 - 1)) / k1;
    if (out) out.t = t;
    return d;
  };
  const tmp = { t: 0 };
  p.dist = (x, y, z) => {
    let best = Infinity;
    for (let i = 0; i < segs.length; i++) {
      const sg = segs[i];
      // cheap reject: distance to the segment bounding sphere (a lower bound)
      const bx = x - sg.mid[0], by = y - sg.mid[1], bz = z - sg.mid[2];
      const lb = Math.sqrt(bx * bx + by * by + bz * bz) - sg.br;
      if (lb > best) continue;
      const d = evalSeg(sg, x, y, z, null);
      if (d < best) best = d;
    }
    return best;
  };
  p.param = (x, y, z) => {
    let best = Infinity, u = 0;
    for (const sg of segs) {
      const d = evalSeg(sg, x, y, z, tmp);
      if (d < best) { best = d; u = sg.A.u + (sg.B.u - sg.A.u) * tmp.t; }
    }
    return u;
  };
  return p;
}

/** Rounded box: c center, half extents hx,hy,hz, rounding r, optional axes basis. */
export function box(c, half, r, o = {}) {
  const p = base(o, 'box');
  p.axes = o.axes || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const m = Math.hypot(half[0], half[1], half[2]);
  p.min = [c[0] - m, c[1] - m, c[2] - m]; p.max = [c[0] + m, c[1] + m, c[2] + m];
  const A = p.axes;
  p.dist = (x, y, z) => {
    const dx = x - c[0], dy = y - c[1], dz = z - c[2];
    const qx = Math.abs(dx * A[0][0] + dy * A[0][1] + dz * A[0][2]) - half[0] + r;
    const qy = Math.abs(dx * A[1][0] + dy * A[1][1] + dz * A[1][2]) - half[1] + r;
    const qz = Math.abs(dx * A[2][0] + dy * A[2][1] + dz * A[2][2]) - half[2] + r;
    const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
    return Math.hypot(ox, oy, oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
  };
  p.param = () => 0.5;
  return p;
}

/** Mirror of a primitive across the x = 0 plane (left <-> right), with bone names swapped. */
export function mirrored(prim, make) {
  return make((v) => [-v[0], v[1], v[2]], (b) => b.replace(/\.L$/, '.R'));
}

// ------------------------------------------------------------------ field
/**
 * The combined field. prims are applied in order: 'add' = smooth union,
 * 'sub' = smooth subtraction, 'inter' = smooth intersection.
 */
export class Field {
  constructor(prims) {
    this.prims = prims;
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of prims) {
      if (p.op !== 'add') continue;
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.min[k] - p.k); mx[k] = Math.max(mx[k], p.max[k] + p.k); }
      if (p.noise) for (let k = 0; k < 3; k++) { mn[k] -= p.noise.amp; mx[k] += p.noise.amp; }
    }
    this.min = mn; this.max = mx;
  }

  /** Distance of primitive p at (x,y,z) including its noise displacement. */
  primDist(p, x, y, z) {
    let d = p.dist(x, y, z);
    if (p.noise) {
      const nz = p.noise;
      if (d < nz.amp * 3 + 0.02) d -= nz.amp * fbm(x * nz.freq, y * nz.freq, z * nz.freq, nz.oct || 3, nz.seed || 1);
    }
    return d;
  }

  eval(x, y, z) {
    let d = 1e9;
    for (let i = 0; i < this.prims.length; i++) {
      const p = this.prims[i];
      // bounding box distance (lower bound) for culling
      const bx = Math.max(p.min[0] - x, 0, x - p.max[0]);
      const by = Math.max(p.min[1] - y, 0, y - p.max[1]);
      const bz = Math.max(p.min[2] - z, 0, z - p.max[2]);
      const bd = Math.sqrt(bx * bx + by * by + bz * bz) - (p.noise ? p.noise.amp : 0);
      if (p.op === 'add') {
        if (bd > d + p.k) continue;
        d = smin(d, this.primDist(p, x, y, z), p.k);
      } else if (p.op === 'sub') {
        if (bd > p.k || d > p.k * 2 + 0.05) continue;
        d = smax(d, -this.primDist(p, x, y, z), p.k);
      } else if (p.op === 'inter') {
        d = smax(d, this.primDist(p, x, y, z), p.k);
      }
    }
    return d;
  }

  grad(x, y, z, e = 1e-4) {
    const gx = this.eval(x + e, y, z) - this.eval(x - e, y, z);
    const gy = this.eval(x, y + e, z) - this.eval(x, y - e, z);
    const gz = this.eval(x, y, z + e) - this.eval(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l, l / (2 * e)];
  }
}
