// Skin-bound shell over a masked region of the body (scalp cap, beard base).
//
// Body faces touching the region are copied; faces crossing the region border
// are subdivided (sub x sub bilinear grid) and every sub-quad crossing the
// border is clipped exactly at the zero line of the mask (marching squares
// with linear interpolation), so the border is a clean, smooth line. Every
// shell vertex is bound to its body face with bilinear coordinates: refitting
// to a new shape or expression is a cheap re-interpolation (fit()). The
// thickness grows from a hair's breadth at the border to the full offset
// `edge` mask units inside.
import { smoothstep, len3 } from './util.js';

export class SkinPatch {
  /**
   * @param {import('../core/HumanModel.js').HumanModel} model
   * @param {Float32Array} P rest positions used to evaluate the mask
   * @param {{mask:(x:number,y:number,z:number)=>number, edge:number, sub?:number, faces?:Iterable<number>}} opts
   *   mask > 0 inside (any unit); edge = mask value where the full thickness is reached.
   */
  constructor(model, P, opts) {
    this.model = model;
    const sub = opts.sub || 4, edge = opts.edge;
    const F = model.faceV;
    const corners = [], st = [], mval = [], index = [];
    const mAt = (a, b, c, d, s, t) => {
      const w0 = (1 - s) * (1 - t), w1 = s * (1 - t), w2 = s * t, w3 = (1 - s) * t;
      const x = w0 * P[a * 3] + w1 * P[b * 3] + w2 * P[c * 3] + w3 * P[d * 3];
      const y = w0 * P[a * 3 + 1] + w1 * P[b * 3 + 1] + w2 * P[c * 3 + 1] + w3 * P[d * 3 + 1];
      const z = w0 * P[a * 3 + 2] + w1 * P[b * 3 + 2] + w2 * P[c * 3 + 2] + w3 * P[d * 3 + 2];
      return opts.mask(x, y, z);
    };
    const vert = (a, b, c, d, s, t, m) => { corners.push(a, b, c, d); st.push(s, t); mval.push(m); return mval.length - 1; };
    const poly = [];
    const faces = opts.faces || model.groupFaces[0];
    for (const f of faces) {
      const a = F[f * 4], b = F[f * 4 + 1], c = F[f * 4 + 2];
      let d = F[f * 4 + 3];
      if (d === 0xffff) d = c; // triangle as degenerate quad
      const m0 = mAt(a, b, c, d, 0, 0), m1 = mAt(a, b, c, d, 1, 0), m2 = mAt(a, b, c, d, 1, 1), m3 = mAt(a, b, c, d, 0, 1);
      if (Math.max(m0, m1, m2, m3) <= 0 && Math.max(m0, m1, m2, m3) < -0.6 * edge) continue;
      const n = Math.min(m0, m1, m2, m3) >= edge ? 1 : sub; // interior faces stay single quads
      const base = mval.length;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const s = i / n, t = j / n;
        vert(a, b, c, d, s, t, n === 1 ? [m0, m1, m3, m2][j * 2 + i] : mAt(a, b, c, d, s, t));
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const q = [base + j * (n + 1) + i, base + j * (n + 1) + i + 1, base + (j + 1) * (n + 1) + i + 1, base + (j + 1) * (n + 1) + i];
        const inside = q.filter((v) => mval[v] > 0).length;
        if (inside === 0) continue;
        if (inside === 4) { index.push(q[0], q[1], q[2], q[0], q[2], q[3]); continue; }
        // clip the sub-quad polygon at mask = 0
        poly.length = 0;
        for (let k = 0; k < 4; k++) {
          const v = q[k], w = q[(k + 1) % 4];
          const mv = mval[v], mw = mval[w];
          if (mv > 0) poly.push(v);
          if ((mv > 0) !== (mw > 0)) {
            const u = mv / (mv - mw);
            poly.push(vert(a, b, c, d, st[v * 2] + (st[w * 2] - st[v * 2]) * u, st[v * 2 + 1] + (st[w * 2 + 1] - st[v * 2 + 1]) * u, 0));
          }
        }
        for (let k = 1; k + 1 < poly.length; k++) index.push(poly[0], poly[k], poly[k + 1]);
      }
    }
    this.count = mval.length;
    this.corners = Uint32Array.from(corners);
    this.st = Float32Array.from(st);
    this.mask = Float32Array.from(mval);
    this.index = Uint32Array.from(index);
    this.edge = edge;
    this.pos = new Float32Array(this.count * 3);
    this.nor = new Float32Array(this.count * 3);
    this._skin();
  }

  /** Per-vertex skin weights: bilinear blend of the corner weights, best 4 kept. */
  _skin() {
    const m = this.model, NB = m.bones.length;
    const acc = new Float32Array(NB);
    const touched = [];
    const w = [0, 0, 0, 0];
    this.skinIndex = new Uint16Array(this.count * 4);
    this.skinWeight = new Float32Array(this.count * 4);
    for (let v = 0; v < this.count; v++) {
      const s = this.st[v * 2], t = this.st[v * 2 + 1];
      w[0] = (1 - s) * (1 - t); w[1] = s * (1 - t); w[2] = s * t; w[3] = (1 - s) * t;
      touched.length = 0;
      for (let k = 0; k < 4; k++) {
        const cv = this.corners[v * 4 + k];
        for (let q = 0; q < 4; q++) {
          const b = m.skinIndex[cv * 4 + q], ww = m.skinWeight[cv * 4 + q] * w[k];
          if (!ww) continue;
          if (!acc[b]) touched.push(b);
          acc[b] += ww;
        }
      }
      touched.sort((x, y) => acc[y] - acc[x]);
      let sum = 0;
      for (let q = 0; q < 4 && q < touched.length; q++) sum += acc[touched[q]];
      for (let q = 0; q < 4; q++) {
        const b = touched[q];
        this.skinIndex[v * 4 + q] = b === undefined ? 0 : b;
        this.skinWeight[v * 4 + q] = b === undefined ? 0 : acc[b] / (sum || 1);
      }
      for (const b of touched) acc[b] = 0;
    }
  }

  /**
   * Re-evaluates positions / normals from body rest positions P and normals N.
   * offset: full thickness (m); rim: thickness at the border (m).
   * thickness: optional per-vertex multiplier array.
   */
  fit(P, N, offset, rim = 0.00035, thickness = null) {
    const { corners, st, mask, pos, nor, edge } = this;
    for (let v = 0; v < this.count; v++) {
      const s = st[v * 2], t = st[v * 2 + 1];
      const w0 = (1 - s) * (1 - t), w1 = s * (1 - t), w2 = s * t, w3 = (1 - s) * t;
      const a = corners[v * 4] * 3, b = corners[v * 4 + 1] * 3, c = corners[v * 4 + 2] * 3, d = corners[v * 4 + 3] * 3;
      let nx = w0 * N[a] + w1 * N[b] + w2 * N[c] + w3 * N[d];
      let ny = w0 * N[a + 1] + w1 * N[b + 1] + w2 * N[c + 1] + w3 * N[d + 1];
      let nz = w0 * N[a + 2] + w1 * N[b + 2] + w2 * N[c + 2] + w3 * N[d + 2];
      const l = len3(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const h = rim + (offset * (thickness ? thickness[v] : 1) - rim) * smoothstep(0, edge, mask[v]);
      pos[v * 3] = w0 * P[a] + w1 * P[b] + w2 * P[c] + w3 * P[d] + nx * h;
      pos[v * 3 + 1] = w0 * P[a + 1] + w1 * P[b + 1] + w2 * P[c + 1] + w3 * P[d + 1] + ny * h;
      pos[v * 3 + 2] = w0 * P[a + 2] + w1 * P[b + 2] + w2 * P[c + 2] + w3 * P[d + 2] + nz * h;
      nor[v * 3] = nx; nor[v * 3 + 1] = ny; nor[v * 3 + 2] = nz;
    }
    return this;
  }
}
