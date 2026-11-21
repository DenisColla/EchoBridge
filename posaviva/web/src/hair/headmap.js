// Head analysis for hair fitting.
//
// HeadFrame: landmarks of the current head shape (rig rest space) derived from
// the mesh (eyes, ears, mouth from the teeth groups, nose tip, chin) and a head
// centre `c` from which the head surface is star-shaped.
//
// HeadMap: radial distance map r(direction) of the outer head surface seen from
// `c` (skin triangles of the head and upper neck rasterised in a lat-long grid
// whose poles point at the ears, where no hair grows). It is used as:
//   - the hull hair is combed over (strands are pushed to r + layer offset)
//   - the head collider of the hair solver (cheap point-outside test)
// The longitude seam (phi = +-pi) points straight down through the neck.
import { clamp } from './util.js';

const TAU = Math.PI * 2;

/** Landmarks of one character's head (rig rest space, meters). */
export function headFrame(ch) {
  const m = ch.model, P = ch.shapePositions;
  const J = (n) => ch.jointPositions.get(n);
  const eyeL = J('eye.L____head'), eyeR = J('eye.R____head');
  const hh = J('head____head'), ht = J('head____tail');
  const s = hh.distanceTo(ht) / 0.144; // 1 = f_normal head
  const eyeY = (eyeL.y + eyeR.y) / 2, eyeZ = (eyeL.z + eyeR.z) / 2;
  const headBone = m.boneIndex.get('head');
  const SI = m.skinIndex, SW = m.skinWeight;
  const headW = (v) => { let w = 0; for (let k = 0; k < 4; k++) if (SI[v * 4 + k] === headBone) w += SW[v * 4 + k]; return w; };

  let earX = 0, earY = eyeY, earZ = eyeZ - 0.08 * s, top = -1e9, chinY = 1e9, chinZ = eyeZ, noseZ = -1e9, noseY = eyeY - 0.035 * s;
  for (const v of m.groupVertices[0]) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    if (y > eyeY - 0.08 * s && y < eyeY && Math.abs(x) < 0.006 * s && z > noseZ) { noseZ = z; noseY = y; }
    if (headW(v) < 0.5) continue;
    if (y > top) top = y;
    if (x > earX) { earX = x; earY = y; earZ = z; }
    if (z > eyeZ - 0.03 * s && Math.abs(x) < 0.02 * s && y < chinY) { chinY = y; chinZ = z; }
  }
  // mouth from the teeth (stable across expressions of the rest shape)
  let ty = 0, tn = 0, tz = -1e9, tw = 0;
  for (const g of [7, 8]) for (const v of m.groupVertices[g]) { ty += P[v * 3 + 1]; tn++; tz = Math.max(tz, P[v * 3 + 2]); tw = Math.max(tw, Math.abs(P[v * 3])); }
  const mouthY = tn ? ty / tn : eyeY - 0.065 * s;
  const mouthZ = (tn ? tz : eyeZ) + 0.012 * s;
  const c = { x: 0, y: eyeY + 0.006 * s, z: earZ + 0.008 * s };
  return {
    s, c, eyeY, eyeZ, eyeX: Math.abs(eyeL.x - eyeR.x) / 2, top,
    ear: { x: earX, y: earY, z: earZ },
    mouth: { y: mouthY, z: mouthZ, halfW: Math.min(tw, 0.034 * s) * 0.72 },
    nose: { y: noseY, z: noseZ, baseY: noseY - 0.4 * (noseY - mouthY) },
    chin: { y: chinY, z: chinZ },
    headBone,
  };
}

export class HeadMap {
  constructor(nu = 144, nv = 72) {
    this.nu = nu; this.nv = nv;
    this.raw = new Float32Array(nu * nv);
    this.hull = new Float32Array(nu * nv);
    this._tmp = new Float32Array(nu * nv);
    /** outward hull normals per cell (3 floats) */
    this.nrm = new Float32Array(nu * nv * 3);
    this.c = { x: 0, y: 0, z: 0 };
  }

  /**
   * Rasterises the head skin triangles of positions P (rig space) around frame.c.
   * Faces whose vertices are all above frame.chin.y - 4 cm are used (head + upper neck).
   */
  build(model, P, frame) {
    const { nu, nv, raw } = this;
    const c = this.c; c.x = frame.c.x; c.y = frame.c.y; c.z = frame.c.z;
    this.scale = frame.s;
    raw.fill(0);
    const cutY = frame.chin.y - 0.04 * frame.s;
    const F = model.faceV;
    const fu = [0, 0, 0], fv = [0, 0, 0], px = [0, 0, 0], py = [0, 0, 0], pz = [0, 0, 0];
    const tri = (a, b, d) => {
      const vs = [a, b, d];
      for (let k = 0; k < 3; k++) {
        const v = vs[k] * 3;
        const x = P[v] - c.x, y = P[v + 1] - c.y, z = P[v + 2] - c.z;
        px[k] = P[v]; py[k] = P[v + 1]; pz[k] = P[v + 2];
        const l = Math.hypot(x, y, z) || 1e-9;
        fu[k] = ((Math.atan2(-z, y) + Math.PI) / TAU) * nu - 0.5;
        fv[k] = ((Math.asin(clamp(x / l, -1, 1)) + Math.PI / 2) / Math.PI) * nv - 0.5;
        // vertex splat (thin triangles may miss every cell centre)
        const iu = ((Math.round(fu[k]) % nu) + nu) % nu, iv = clamp(Math.round(fv[k]), 0, nv - 1);
        if (l > raw[iv * nu + iu]) raw[iv * nu + iu] = l;
      }
      // unwrap longitude around the first vertex; skip triangles around a pole
      for (let k = 1; k < 3; k++) { if (fu[k] - fu[0] > nu / 2) fu[k] -= nu; else if (fu[0] - fu[k] > nu / 2) fu[k] += nu; }
      const u0 = Math.min(fu[0], fu[1], fu[2]), u1 = Math.max(fu[0], fu[1], fu[2]);
      if (u1 - u0 > nu / 4) return;
      const v0 = Math.min(fv[0], fv[1], fv[2]), v1 = Math.max(fv[0], fv[1], fv[2]);
      const det = (fu[1] - fu[0]) * (fv[2] - fv[0]) - (fu[2] - fu[0]) * (fv[1] - fv[0]);
      if (Math.abs(det) < 1e-12) return;
      for (let j = Math.max(0, Math.ceil(v0)); j <= Math.min(nv - 1, Math.floor(v1)); j++) {
        for (let i = Math.ceil(u0); i <= Math.floor(u1); i++) {
          const b1 = ((i - fu[0]) * (fv[2] - fv[0]) - (fu[2] - fu[0]) * (j - fv[0])) / det;
          const b2 = ((fu[1] - fu[0]) * (j - fv[0]) - (i - fu[0]) * (fv[1] - fv[0])) / det;
          const b0 = 1 - b1 - b2;
          if (b0 < -1e-4 || b1 < -1e-4 || b2 < -1e-4) continue;
          const x = b0 * px[0] + b1 * px[1] + b2 * px[2] - c.x;
          const y = b0 * py[0] + b1 * py[1] + b2 * py[2] - c.y;
          const z = b0 * pz[0] + b1 * pz[1] + b2 * pz[2] - c.z;
          const r = Math.hypot(x, y, z);
          const cell = j * nu + (((i % nu) + nu) % nu);
          if (r > raw[cell]) raw[cell] = r;
        }
      }
    };
    for (const f of model.groupFaces[0]) {
      const a = F[f * 4], b = F[f * 4 + 1], cc = F[f * 4 + 2], d = F[f * 4 + 3];
      if (P[a * 3 + 1] < cutY || P[b * 3 + 1] < cutY || P[cc * 3 + 1] < cutY || (d !== 0xffff && P[d * 3 + 1] < cutY)) continue;
      tri(a, b, cc);
      if (d !== 0xffff) tri(a, cc, d);
    }
    this._fillHoles(raw, 5);
    // hull = max(raw, blurred raw): smooth enough to comb over, never inside the skin
    this._blur(raw, this.hull, 2);
    const hull = this.hull;
    for (let i = 0; i < hull.length; i++) hull[i] = raw[i] > 0 ? Math.max(raw[i], hull[i]) : 0;
    this._normals();
    return this;
  }

  /** Unit direction of cell (i, j). */
  _dir(i, j, out) {
    const ph = ((i + 0.5) / this.nu) * TAU - Math.PI, th = ((j + 0.5) / this.nv) * Math.PI - Math.PI / 2;
    out[0] = Math.sin(th); out[1] = Math.cos(th) * Math.cos(ph); out[2] = -Math.cos(th) * Math.sin(ph);
    return out;
  }

  _normals() {
    const { nu, nv, hull, nrm } = this;
    const u = [0, 0, 0], a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], d = [0, 0, 0];
    const S = (i, j, o) => {
      const ii = ((i % nu) + nu) % nu, jj = Math.max(0, Math.min(nv - 1, j));
      this._dir(ii, jj, o);
      const r = hull[jj * nu + ii];
      o[0] *= r; o[1] *= r; o[2] *= r;
      return r > 0;
    };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const q = (j * nu + i) * 3;
      this._dir(i, j, u);
      let nx = u[0], ny = u[1], nz = u[2];
      if (hull[j * nu + i] > 0 && S(i + 1, j, a) && S(i - 1, j, b) && S(i, j + 1, c) && S(i, j - 1, d)) {
        const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2], vx = c[0] - d[0], vy = c[1] - d[1], vz = c[2] - d[2];
        let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
        if (x * u[0] + y * u[1] + z * u[2] < 0) { x = -x; y = -y; z = -z; }
        const l = Math.hypot(x, y, z);
        if (l > 1e-12) { nx = x / l; ny = y / l; nz = z / l; }
      }
      nrm[q] = nx; nrm[q + 1] = ny; nrm[q + 2] = nz;
    }
  }

  /**
   * Hull radius along (dx,dy,dz) and the interpolated outward normal there (-> n, 3-array).
   * Returns 0 where the map has no surface.
   */
  sample(dx, dy, dz, n) {
    const { nu, nv, hull, nrm } = this;
    const l = Math.hypot(dx, dy, dz) || 1e-9;
    const fu = ((Math.atan2(-dz, dy) + Math.PI) / TAU) * nu - 0.5;
    let fv = ((Math.asin(dx / l > 1 ? 1 : dx / l < -1 ? -1 : dx / l) + Math.PI / 2) / Math.PI) * nv - 0.5;
    if (fv < 0) fv = 0; else if (fv > nv - 1) fv = nv - 1;
    const i0 = Math.floor(fu), j0 = Math.min(nv - 2, Math.floor(fv));
    const tu = fu - i0, tv = fv - j0;
    const ia = ((i0 % nu) + nu) % nu, ib = (ia + 1) % nu;
    const c00 = j0 * nu + ia, c10 = j0 * nu + ib, c01 = (j0 + 1) * nu + ia, c11 = (j0 + 1) * nu + ib;
    const w00 = (1 - tu) * (1 - tv), w10 = tu * (1 - tv), w01 = (1 - tu) * tv, w11 = tu * tv;
    let nx = 0, ny = 0, nz = 0;
    for (const [c, w] of [[c00, w00], [c10, w10], [c01, w01], [c11, w11]]) { nx += nrm[c * 3] * w; ny += nrm[c * 3 + 1] * w; nz += nrm[c * 3 + 2] * w; }
    const nl = Math.hypot(nx, ny, nz) || 1;
    n[0] = nx / nl; n[1] = ny / nl; n[2] = nz / nl;
    return this.radius(dx, dy, dz);
  }

  _fillHoles(a, passes) {
    const { nu, nv } = this, t = this._tmp;
    for (let p = 0; p < passes; p++) {
      t.set(a);
      let changed = 0;
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        if (a[j * nu + i] > 0) continue;
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= nv) continue;
          for (let di = -1; di <= 1; di++) {
            const r = a[jj * nu + (((i + di) % nu) + nu) % nu];
            if (r > 0) { s += r; n++; }
          }
        }
        if (n >= 3) { t[j * nu + i] = s / n; changed++; }
      }
      a.set(t);
      if (!changed) break;
    }
  }

  _blur(src, dst, passes) {
    const { nu, nv } = this, t = this._tmp;
    dst.set(src);
    for (let p = 0; p < passes; p++) {
      t.set(dst);
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        if (src[j * nu + i] <= 0) continue;
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          const jj = j + dj;
          if (jj < 0 || jj >= nv) continue;
          for (let di = -1; di <= 1; di++) {
            const r = t[jj * nu + (((i + di) % nu) + nu) % nu];
            if (r > 0) { s += r; n++; }
          }
        }
        dst[j * nu + i] = s / n;
      }
    }
  }

  /** Hull radius along the direction (dx,dy,dz) from c (any length). 0 = no surface there. */
  radius(dx, dy, dz, map = this.hull) {
    const { nu, nv } = this;
    const l = Math.hypot(dx, dy, dz) || 1e-9;
    let fu = ((Math.atan2(-dz, dy) + Math.PI) / TAU) * nu - 0.5;
    let fv = ((Math.asin(dx / l > 1 ? 1 : dx / l < -1 ? -1 : dx / l) + Math.PI / 2) / Math.PI) * nv - 0.5;
    if (fv < 0) fv = 0; else if (fv > nv - 1) fv = nv - 1;
    const i0 = Math.floor(fu), j0 = Math.min(nv - 2, Math.floor(fv));
    const tu = fu - i0, tv = fv - j0;
    const ia = ((i0 % nu) + nu) % nu, ib = (ia + 1) % nu;
    const r00 = map[j0 * nu + ia], r10 = map[j0 * nu + ib], r01 = map[(j0 + 1) * nu + ia], r11 = map[(j0 + 1) * nu + ib];
    if (r00 > 0 && r10 > 0 && r01 > 0 && r11 > 0) return (r00 * (1 - tu) + r10 * tu) * (1 - tv) + (r01 * (1 - tu) + r11 * tu) * tv;
    // border of the covered area: average of the valid corners, fading out continuously
    // (a discontinuous border makes colliding points jump back and forth)
    const w00 = r00 > 0 ? (1 - tu) * (1 - tv) : 0, w10 = r10 > 0 ? tu * (1 - tv) : 0, w01 = r01 > 0 ? (1 - tu) * tv : 0, w11 = r11 > 0 ? tu * tv : 0;
    const W = w00 + w10 + w01 + w11;
    if (W < 1e-6) return 0;
    const r = (w00 * r00 + w10 * r10 + w01 * r01 + w11 * r11) / W;
    const f = W >= 0.75 ? 1 : W <= 0.25 ? 0 : (W - 0.25) / 0.5;
    return r * f * f * (3 - 2 * f);
  }

  /**
   * Outward surface normal of the hull along direction u (unit 3-array) -> out (3-array).
   * Finite differences of the star-shaped surface S(u) = c + r(u) u.
   */
  normal(u, out) {
    // tangent basis
    const ax = Math.abs(u[0]) < 0.9 ? 1 : 0, ay = 1 - ax;
    let t1x = ay * u[2] - 0 * u[1], t1y = 0 * u[0] - ax * u[2], t1z = ax * u[1] - ay * u[0];
    let l = Math.hypot(t1x, t1y, t1z); t1x /= l; t1y /= l; t1z /= l;
    const t2x = u[1] * t1z - u[2] * t1y, t2y = u[2] * t1x - u[0] * t1z, t2z = u[0] * t1y - u[1] * t1x;
    const e = 0.04;
    const S = (sa, sb, o) => {
      const dx = u[0] + (t1x * sa + t2x * sb) * e, dy = u[1] + (t1y * sa + t2y * sb) * e, dz = u[2] + (t1z * sa + t2z * sb) * e;
      const ll = Math.hypot(dx, dy, dz), r = this.radius(dx, dy, dz);
      o[0] = dx / ll * r; o[1] = dy / ll * r; o[2] = dz / ll * r;
    };
    const a = _a, b = _b, cc = _c, d = _d;
    S(1, 0, a); S(-1, 0, b); S(0, 1, cc); S(0, -1, d);
    const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2];
    const vx = cc[0] - d[0], vy = cc[1] - d[1], vz = cc[2] - d[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * u[0] + ny * u[1] + nz * u[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) { out[0] = u[0]; out[1] = u[1]; out[2] = u[2]; return out; }
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
    return out;
  }
}
const _a = [0, 0, 0], _b = [0, 0, 0], _c = [0, 0, 0], _d = [0, 0, 0];
