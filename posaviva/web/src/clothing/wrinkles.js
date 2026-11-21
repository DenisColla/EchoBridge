// Pose-dependent wrinkles.
//
// Every garment part keeps its coarse (body resolution) rest surface with skin
// weights. After a pose change the coarse vertices are CPU-skinned and, per
// vertex, the 2D deformation gradient of the surface is fitted from the 1-ring
// (rest tangent coords -> posed edge vectors). Its right Cauchy-Green tensor
// C = F^T F gives the principal stretches: where the fabric is compressed
// (stretch < 1) folds appear, running perpendicular to the compression; where
// it is pulled (stretch > 1) thinner tension lines appear along the pull.
//
// Folds are drawn from four precomputed fold fields per fine vertex, one per
// wave direction (along the limb / torso axis = rings, around it, and two
// diagonals). Their phases come from smooth body coordinates (axial distance,
// integer fold counts around the cylinder so nothing breaks at the seam) plus
// low-frequency noise, so rings break into natural, slightly diagonal folds;
// the profile has broad rounded crests and sharp valleys. Per frame only the
// four direction weights x amplitude are computed per COARSE vertex (cheap),
// interpolated to the fine vertices and combined with the static fields:
//   disp = static * k + amp * sum_p a_p * (field_p - 0.3), clamped to the
// inward room (never into the body or a lower layer). GPU skinning moves the
// displaced rest surface; normals are recomputed on the CPU.
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { foldProfile } from './build.js';

const noiseGen = new ImprovedNoise();
/** smooth noise in [-1, 1] (approx) */
export const noise3 = (x, y, z) => noiseGen.noise(x, y, z) * 1.6;

const SQ2 = Math.SQRT1_2;

/**
 * Wrinkle runtime of one garment part.
 * src: {coarse:{n, G, adj, skin:{idx,w}, coordsFrame}, nf, parents, profiles Float32Array(nf*4),
 *       amp Float32Array(nf), room Float32Array(nf), stat Float32Array(nf)}
 */
export class WrinklePart {
  constructor(src) {
    const c = src.coarse;
    this.n = c.n;
    this.G = c.G;
    this.skinIdx = c.skin.idx;
    this.skinW = c.skin.w;
    this.adj = c.adj;
    this.nf = src.nf;
    this.pIdx = src.parents.idx;
    this.pW = src.parents.w;
    this.prof = src.profiles; // nf*4, already centered (field - bias)
    this.amp = src.amp;
    this.room = src.room;
    this.stat = src.stat;
    this.kc = src.kc ?? 1;
    this.kt = src.kt ?? 0.35;
    this.spread = src.spread ?? 4;
    this.Q = new Float32Array(this.n * 3);
    this.A = new Float32Array(this.n * 4); // per coarse vertex direction amplitudes
    this.A2 = new Float32Array(this.n * 4);
    this.disp = new Float32Array(this.nf);
    this.active = false; // any dynamic fold currently applied
    // bones influencing this part: their skin matrices are compared every
    // frame, an unchanged set means unchanged folds (posing a finger never
    // re-evaluates the trousers)
    const used = new Set();
    for (let i = 0; i < this.skinW.length; i++) if (this.skinW[i] > 0) used.add(this.skinIdx[i]);
    this.bones = Int32Array.from([...used]);
    this.lastM = new Float32Array(this.bones.length * 16).fill(NaN);
    this._precompute(c.basis);
  }

  /** True when the skin matrices of this part's bones changed since the last update. */
  _bonesMoved(M) {
    const { bones, lastM } = this;
    let moved = false;
    for (let b = 0; b < bones.length; b++) {
      const o = bones[b] * 16, l = b * 16;
      for (let k = 0; k < 12; k++) {
        const x = M[o + k];
        if (Math.abs(x - lastM[l + k]) > 1e-6 || lastM[l + k] !== lastM[l + k]) { moved = true; lastM[l + k] = x; }
      }
      lastM[l + 12] = M[o + 12]; lastM[l + 13] = M[o + 13]; lastM[l + 14] = M[o + 14];
    }
    return moved;
  }

  /** Linear blend skinning of the coarse rest surface with precomputed matrices. */
  _skin(M) {
    const { n, G, skinIdx, skinW, Q } = this;
    for (let i = 0; i < n; i++) {
      const x = G[i * 3], y = G[i * 3 + 1], z = G[i * 3 + 2];
      let ox = 0, oy = 0, oz = 0;
      for (let k = 0; k < 4; k++) {
        const w = skinW[i * 4 + k];
        if (!w) continue;
        const o = skinIdx[i * 4 + k] * 16;
        ox += w * (M[o] * x + M[o + 4] * y + M[o + 8] * z + M[o + 12]);
        oy += w * (M[o + 1] * x + M[o + 5] * y + M[o + 9] * z + M[o + 13]);
        oz += w * (M[o + 2] * x + M[o + 6] * y + M[o + 10] * z + M[o + 14]);
      }
      Q[i * 3] = ox; Q[i * 3 + 1] = oy; Q[i * 3 + 2] = oz;
    }
  }

  /** Rest tangent frames, 2D neighbour coords and the inverse second moments. */
  _precompute(basis) {
    const { n, G, adj } = this;
    const deg = adj.off[n];
    this.R2 = new Float32Array(deg * 2);
    this.Minv = new Float32Array(n * 3);
    this.E = basis; // e1(3) e2(3) per vertex
    this.Crest = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const e = i * 6;
      let m11 = 0, m12 = 0, m22 = 0;
      for (let j = adj.off[i]; j < adj.off[i + 1]; j++) {
        const u = adj.adj[j];
        const rx = G[u * 3] - G[i * 3], ry = G[u * 3 + 1] - G[i * 3 + 1], rz = G[u * 3 + 2] - G[i * 3 + 2];
        const a = rx * basis[e] + ry * basis[e + 1] + rz * basis[e + 2];
        const b = rx * basis[e + 3] + ry * basis[e + 4] + rz * basis[e + 5];
        this.R2[j * 2] = a; this.R2[j * 2 + 1] = b;
        m11 += a * a; m12 += a * b; m22 += b * b;
      }
      const det = m11 * m22 - m12 * m12;
      if (det > 1e-14) { this.Minv[i * 3] = m22 / det; this.Minv[i * 3 + 1] = -m12 / det; this.Minv[i * 3 + 2] = m11 / det; }
    }
    // rest tensor (curvature makes it slightly != identity): subtracted later
    this._tensors(G, this.Crest, null);
  }

  /** C = F^T F per coarse vertex from positions X. out: n*3 (c11, c12, c22). */
  _tensors(X, out, rest) {
    const { n, adj, R2, Minv } = this;
    for (let i = 0; i < n; i++) {
      let a1x = 0, a1y = 0, a1z = 0, a2x = 0, a2y = 0, a2z = 0;
      const ox = X[i * 3], oy = X[i * 3 + 1], oz = X[i * 3 + 2];
      for (let j = adj.off[i]; j < adj.off[i + 1]; j++) {
        const u = adj.adj[j] * 3;
        const qx = X[u] - ox, qy = X[u + 1] - oy, qz = X[u + 2] - oz;
        const r1 = R2[j * 2], r2 = R2[j * 2 + 1];
        a1x += qx * r1; a1y += qy * r1; a1z += qz * r1;
        a2x += qx * r2; a2y += qy * r2; a2z += qz * r2;
      }
      const i11 = Minv[i * 3], i12 = Minv[i * 3 + 1], i22 = Minv[i * 3 + 2];
      const f1x = a1x * i11 + a2x * i12, f1y = a1y * i11 + a2y * i12, f1z = a1z * i11 + a2z * i12;
      const f2x = a1x * i12 + a2x * i22, f2y = a1y * i12 + a2y * i22, f2z = a1z * i12 + a2z * i22;
      let c11 = f1x * f1x + f1y * f1y + f1z * f1z, c12 = f1x * f2x + f1y * f2y + f1z * f2z, c22 = f2x * f2x + f2y * f2y + f2z * f2z;
      if (rest) { c11 -= rest[i * 3] - 1; c12 -= rest[i * 3 + 1]; c22 -= rest[i * 3 + 2] - 1; }
      out[i * 3] = c11; out[i * 3 + 1] = c12; out[i * 3 + 2] = c22;
    }
  }

  /**
   * Updates the fine displacement for the character's current pose.
   * k: global x garment intensity. Returns true when the displacement changed.
   */
  update(ch, k, M = ch.updateSkinMatrices()) {
    const { n, nf, A, A2, adj } = this;
    if (!this._bonesMoved(M) && this._k === k) return false;
    this._skin(M);
    const C = this._C || (this._C = new Float32Array(n * 3));
    this._tensors(this.Q, C, this.Crest);
    const kc = this.kc, kt = this.kt;
    let maxA = 0;
    for (let i = 0; i < n; i++) {
      const a = C[i * 3], b = C[i * 3 + 1], c = C[i * 3 + 2];
      const tr = (a + c) * 0.5, dd = Math.sqrt(((a - c) * 0.5) ** 2 + b * b);
      const l1 = Math.sqrt(Math.max(0, tr - dd)), l2 = Math.sqrt(Math.max(0, tr + dd));
      const comp = 1 - l1, ten = l2 - 1;
      let amp = 0;
      // response saturates: beyond ~35% compression fabric stacks into the same folds
      if (comp > 0.015) amp += kc * Math.sqrt(Math.min(comp, 0.35) - 0.015);
      if (ten > 0.04) amp += kt * Math.sqrt(Math.min(ten, 0.3) - 0.04);
      // direction of the smallest stretch: cos/sin of twice its angle
      let c2 = 1, s2 = 0;
      if (dd > 1e-6) { c2 = -(a - c) * 0.5 / dd; s2 = -b / dd; }
      const w0 = c2 > 0 ? c2 * c2 : 0, w90 = c2 < 0 ? c2 * c2 : 0;
      const w45 = s2 > 0 ? s2 * s2 : 0, w135 = s2 < 0 ? s2 * s2 : 0;
      A[i * 4] = amp * w0; A[i * 4 + 1] = amp * w90; A[i * 4 + 2] = amp * w45; A[i * 4 + 3] = amp * w135;
      if (amp > maxA) maxA = amp;
    }
    if (maxA < 1e-3 && !this.active && this._k === k) return false;
    // spread the direction amplitudes over a few rings: fabric bunches around
    // the whole joint, not only inside the crease (max-preserving diffusion)
    let src = A, dst = A2;
    for (let pass = 0; pass < this.spread; pass++) {
      for (let i = 0; i < n; i++) {
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        const d = adj.off[i + 1] - adj.off[i];
        for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j] * 4; s0 += src[u]; s1 += src[u + 1]; s2 += src[u + 2]; s3 += src[u + 3]; }
        const o = i * 4, h = d ? 0.5 / d : 0, g = d ? 0.5 : 1;
        // keep 85% of a vertex's own amplitude so the crease stays the deepest
        dst[o] = Math.max(src[o] * 0.85, src[o] * g + s0 * h);
        dst[o + 1] = Math.max(src[o + 1] * 0.85, src[o + 1] * g + s1 * h);
        dst[o + 2] = Math.max(src[o + 2] * 0.85, src[o + 2] * g + s2 * h);
        dst[o + 3] = Math.max(src[o + 3] * 0.85, src[o + 3] * g + s3 * h);
      }
      const t = src; src = dst; dst = t;
    }
    const AF = src;
    const { pIdx, pW, prof, amp, room, stat, disp } = this;
    for (let i = 0; i < nf; i++) {
      let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
      const o4 = i * 4;
      for (let q = 0; q < 4; q++) {
        const w = pW[o4 + q];
        if (!w) continue;
        const p = pIdx[o4 + q] * 4;
        a0 += w * AF[p]; a1 += w * AF[p + 1]; a2 += w * AF[p + 2]; a3 += w * AF[p + 3];
      }
      let d = stat[i] + amp[i] * (a0 * prof[o4] + a1 * prof[o4 + 1] + a2 * prof[o4 + 2] + a3 * prof[o4 + 3]);
      d *= k;
      const r = -room[i];
      disp[i] = d < r ? r : d;
    }
    this.active = maxA >= 1e-3;
    this._k = k;
    return true;
  }

  /** Static-only displacement (rest pose / wrinkles disabled). */
  restDisp(k) {
    const { nf, stat, room, disp } = this;
    for (let i = 0; i < nf; i++) { const d = stat[i] * k, r = -room[i]; disp[i] = d < r ? r : d; }
    this.active = false;
    this._k = k;
  }
}

/**
 * Precomputes the four fold fields of a fine vertex set.
 * coords {wT, limb, sT, thT, sL, thL}; frames: {kT, NT, MT, kL[r], NL[r], ML[r]}
 * Returns Float32Array(nf*4) centered fields.
 */
export function foldFields(nf, coords, P, frames, bias = 0.3) {
  const out = new Float32Array(nf * 4);
  const f = [0, 0, 0, 0];
  const eval4 = (s, th, kAx, N, M, x, y, z, w, acc) => {
    const n1 = noise3(x * 7.3, y * 7.3, z * 7.3), n2 = noise3(x * 7.3 + 31, y * 7.3 + 7, z * 7.3 - 11);
    const n3 = noise3(x * 4.1 - 5, y * 4.1 + 13, z * 4.1 + 2);
    // gently wavy rings (chevrons) + jittered diagonals
    const ring = kAx * s + 1.7 * n1 + 0.55 * Math.sin(th * 2 + 2.5 * n3);
    acc[0] += w * (foldProfile(ring) - bias);
    acc[1] += w * (foldProfile(N * th + 1.5 * n2 + 0.8 * Math.sin(kAx * 0.35 * s)) - bias);
    acc[2] += w * (foldProfile(kAx * SQ2 * s + M * th + 1.6 * n3) - bias);
    acc[3] += w * (foldProfile(kAx * SQ2 * s - M * th + 1.6 * n1) - bias);
  };
  for (let i = 0; i < nf; i++) {
    f[0] = f[1] = f[2] = f[3] = 0;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    const wT = coords.limb[i] ? coords.wT[i] : 1;
    if (wT > 0.02) eval4(coords.sT[i], coords.thT[i], frames.kT, frames.NT, frames.MT, x, y, z, wT, f);
    const L = coords.limb[i];
    if (L && wT < 0.98) eval4(coords.sL[i], coords.thL[i], frames.kL[L], frames.NL[L], frames.ML[L], x, y, z, 1 - wT, f);
    out[i * 4] = f[0]; out[i * 4 + 1] = f[1]; out[i * 4 + 2] = f[2]; out[i * 4 + 3] = f[3];
  }
  return out;
}
