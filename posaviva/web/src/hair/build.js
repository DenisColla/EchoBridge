// Hair assembly: runs a style recipe (styles.js) against one character's head
// and produces everything the runtime needs:
//   strands  clump centre lines (rest, rig space) + render parameters
//   patch    scalp cap (skin-bound shell); solids (afro puffs, hair ties)
//   dyn      simulated components: guide polylines, solver setup and the
//            binding of every hanging clump to (up to) 3 guides
import { Grower, tangent } from './grow.js';
import { StrandSet } from './strands.js';
import { SkinPatch } from './patch.js';
import { makeMask, sampleRoots, tangentBasis } from './scalp.js';
import { shapeProfile, GuideSolver, pushHead } from './physics.js';
import { rng, clamp, lerp, smoothstep } from './util.js';

const _u = [0, 0, 0], _t1 = [0, 0, 0], _t2 = [0, 0, 0];

/** Part line position (u.x on the unit head sphere) for each parting option. Character's left = +X. */
export const PART_X = { left: 0.34, center: 0, right: -0.34 };

/** Resamples polyline pts (K points) to K points spanning arc length [0, cut]. */
export function truncate(pts, K, cut) {
  const A = new Float32Array(K);
  for (let k = 1; k < K; k++) A[k] = A[k - 1] + Math.hypot(pts[k * 3] - pts[k * 3 - 3], pts[k * 3 + 1] - pts[k * 3 - 2], pts[k * 3 + 2] - pts[k * 3 - 1]);
  cut = Math.min(cut, A[K - 1]);
  const out = new Float32Array(K * 3);
  let j = 0;
  for (let k = 0; k < K; k++) {
    const s = (cut * k) / (K - 1);
    while (j < K - 2 && A[j + 1] < s) j++;
    const t = A[j + 1] > A[j] ? clamp((s - A[j]) / (A[j + 1] - A[j]), 0, 1) : 0;
    for (let q = 0; q < 3; q++) out[k * 3 + q] = pts[j * 3 + q] + (pts[j * 3 + 3 + q] - pts[j * 3 + q]) * t;
  }
  return out;
}

export class HairBuilder {
  /**
   * @param {{ch, model, frame, map, colliders, seed:number}} env
   * @param {{style:string, length:number, volume:number, parting:string, bangs:boolean}} state
   */
  constructor(env, state) {
    this.env = env;
    this.state = state;
    this.frame = env.frame;
    this.map = env.map;
    this.col = env.colliders;
    this.s = env.frame.s;
    this.c = [env.frame.c.x, env.frame.c.y, env.frame.c.z];
    this.sex = env.ch.sex;
    this.grower = new Grower(env.map, env.frame, env.colliders);
    this.strands = new StrandSet();
    this.solids = [];
    this.comps = [];
    this.patch = null;
    this.capOffset = 0;
    this.rnd = rng(env.seed);
    /** volume factor 0.55 .. 1.6 (default 1) */
    this.V = state.volume <= 0.5 ? lerp(0.55, 1, state.volume / 0.5) : lerp(1, 1.6, (state.volume - 0.5) / 0.5);
    this.partX = PART_X[state.parting] ?? 0;
    this.rootR = 0.092 * this.s; // typical head radius
  }

  /** Length helper: style range [a, b] (m at the f_normal head scale), mapped by the Lunghezza slider. */
  len(a, b) { return lerp(a, b, clamp(this.state.length, 0, 1)) * this.s; }

  mask(kind = 'natural', opts = {}) { return makeMask(kind, { sex: this.sex, ...opts }); }

  /** Unit direction from the head centre to point p. */
  dirOf(p, out = [0, 0, 0]) { return this.grower.dirOf(p, out); }

  /** Scalp cap (shell over the hair-bearing skin). offset in m (f_normal scale). */
  cap(offset, mask = this.mask()) {
    const c = this.c;
    this.capMask = mask;
    this.patch = new SkinPatch(this.env.model, this.env.ch.shapePositions, {
      mask: (x, y, z) => {
        _u[0] = x - c[0]; _u[1] = y - c[1]; _u[2] = z - c[2];
        const l = Math.hypot(_u[0], _u[1], _u[2]) || 1;
        _u[0] /= l; _u[1] /= l; _u[2] /= l;
        return mask(_u);
      },
      edge: 4.5, sub: 4,
    });
    this.capOffset = offset * this.s;
    return this.patch;
  }

  /**
   * Grows a layer of clumps from roots sampled in `mask`.
   * o: {mask, count, K, margin, len(u, root) -> m, flow(p,u,t,out,root), lift(u,root)|number, stiff,
   *     h0, hk, hMax (m at f_normal scale, x volume unless volume:false) | height(t, root) -> m,
   *     hug, tipLift(t) -> m, hang:{y, dir(p,out,root), stiff}, target(u, root) -> point,
   *     clip:{mask?, margin?, y?(root) -> absolute cut height}, post(pts, root),
   *     width, widthAt(u,root), flat, taper0, tipW, rootW, tone, samples, sides, spread, bias,
   *     detail(u, root, L) -> detail|null, axis(u, root) -> fixed thin axis | null,
   *     filter(u, root) -> bool, layerRad, rigid, dyn:{guides, shapeNear, shapeFar, shapeSpan, bend}, seed}
   * Returns the indices of the strands added.
   */
  layer(o) {
    const g = this.grower, s = this.s, V = o.volume === false ? 1 : this.V;
    const rnd = rng((this.env.seed ^ (o.seed || 0x9e37)) >>> 0);
    const { dirs, spacing } = sampleRoots(o.mask, o.count, (this.env.seed + (o.seed || 7)) >>> 0, o.margin ?? 1.5);
    const added = [];
    const baseW = spacing * this.rootR * (o.width ?? 1.0);
    const root = { u: [0, 0, 0], i: 0, r: 0, r2: 0 };
    const uq = [0, 0, 0];
    for (let i = 0; i < dirs.length / 3; i++) {
      const u = root.u; u[0] = dirs[i * 3]; u[1] = dirs[i * 3 + 1]; u[2] = dirs[i * 3 + 2];
      root.i = i; root.r = rnd(); root.r2 = rnd();
      if (o.filter && !o.filter(u, root)) continue;
      let L = o.len(u, root);
      if (L < 0.004 * s) continue;
      const res = g.grow(u, {
        K: o.K, L,
        lift: typeof o.lift === 'function' ? o.lift(u, root) : o.lift ?? 0.2,
        stiff: o.stiff ?? 0.5,
        flow: (p, uu, t, out) => o.flow(p, uu, t, out, root),
        h0: (o.h0 ?? 0.002) * s * V, hk: (o.hk ?? 0.08) * V, hMax: (o.hMax ?? 0.015) * s * V,
        height: o.height ? (t) => o.height(t, root) * s * V : null,
        hug: o.hug, tipLift: o.tipLift ? (t) => o.tipLift(t, root) * s * V : null,
        hang: o.hang ? { y: o.hang.y * s, stiff: o.hang.stiff, dir: (p, out) => o.hang.dir(p, out, root), drape: o.hang.drape ? o.hang.drape(root) : 0 } : null,
        rad: (o.layerRad ?? 0.004) * s,
        target: o.target ? o.target(u, root) : null,
        rootDepth: o.rootDepth,
      });
      let pts = res.pts, pin = o.rigid ? o.K : res.pin;
      // clipping (stay near the hairline / blunt cut at a height)
      if (o.clip) {
        let cut = -1, acc = 0;
        const cy = o.clip.y ? o.clip.y(root) : -1e9;
        for (let k = 1; k < o.K; k++) {
          const seg = Math.hypot(pts[k * 3] - pts[k * 3 - 3], pts[k * 3 + 1] - pts[k * 3 - 2], pts[k * 3 + 2] - pts[k * 3 - 1]);
          let out = false, f = 1;
          if (pts[k * 3 + 1] < cy) { out = true; f = clamp((pts[k * 3 - 2] - cy) / (pts[k * 3 - 2] - pts[k * 3 + 1] || 1), 0, 1); }
          else if (o.clip.mask) {
            uq[0] = pts[k * 3]; uq[1] = pts[k * 3 + 1]; uq[2] = pts[k * 3 + 2];
            if (o.clip.mask(this.dirOf(uq, uq)) < -(o.clip.margin ?? 3)) out = true;
          }
          if (out) { cut = acc + seg * f; break; }
          acc += seg;
        }
        if (cut >= 0) {
          if (cut < 0.006 * s) continue;
          const total = acc + 1e-9;
          pts = truncate(pts, o.K, cut);
          if (pin < o.K) pin = Math.max(2, Math.min(o.K, Math.round(pin * Math.min(1, total / cut))));
          L = cut;
        }
      }
      root.pin = pin;
      if (o.post) o.post(pts, root);
      const def = {
        pts, pin,
        w: baseW * (o.wJitter === false ? 1 : 0.85 + 0.3 * rnd()) * (o.widthAt ? o.widthAt(u, root) : 1),
        flat: o.flat ?? 0.36, rootW: o.rootW ?? 0.7, taper0: o.taper0 ?? 0.55, tipW: o.tipW ?? 0.12,
        tone: (o.tone ?? 1) * (0.9 + 0.18 * rnd()),
        samples: o.samples, sides: o.sides,
        detail: o.detail ? o.detail(u, root, L) : null,
        axis: o.axis ? o.axis(u, root) : null,
        bias: o.bias, spread: o.spread || 0,
        layer: (o.layerRad ?? 0.004) * s,
        drape: o.hang?.drape ? o.hang.drape(root) : 0,
      };
      added.push(this.strands.add(def));
    }
    if (o.dyn) {
      const dyn = added.filter((i) => this.strands.list[i].pin < o.K);
      if (dyn.length) this.comps.push({ strands: dyn, K: o.K, ...o.dyn });
    }
    return added;
  }

  /** Arc length estimate along the head between root direction u and point G (for gathered strands). */
  arcTo(u, G) {
    const gu = this.dirOf(G, [0, 0, 0]);
    const ang = Math.acos(clamp(u[0] * gu[0] + u[1] * gu[1] + u[2] * gu[2], -1, 1));
    const r = (this.map.radius(u[0], u[1], u[2]) + this.map.radius(gu[0], gu[1], gu[2])) / 2;
    return ang * r * 1.1 + 0.004 * this.s;
  }

  /**
   * Hair pulled tight towards gather point(s): layer() with a flow towards the
   * target and the last point snapped on it.
   * o: layer options + {target(u) -> G point}
   */
  gathered(o) {
    const tgt = o.targetOf;
    return this.layer({
      K: 14, hug: true, stiff: 0.35, lift: 0.08, h0: 0.0018, hk: 0.035, hMax: 0.008,
      len: (u) => this.arcTo(u, tgt(u)),
      flow: (p, u, t, out, root) => {
        const G = tgt(root.u);
        const gu = this.dirOf(G, _t1);
        return this.tan(out, u, gu[0] - u[0], gu[1] - u[1] - 0.05, gu[2] - u[2]);
      },
      target: (u) => tgt(u),
      width: 1.0, flat: 0.32, taper0: 0.55, tipW: 0.45, rootW: 0.75, rigid: true,
      ...o,
    });
  }

  /**
   * Hanging bundle of clumps from a tie (ponytail, pigtail, stub).
   * o: {G, dir0, L, R (radius at the tie, m), count, K, flare, stiff, detail(i,rnd), seed, dyn, tone, spread}
   * Returns the axis polyline.
   */
  tail(o) {
    const s = this.s, K = o.K || 18, rnd = rng((this.env.seed ^ (o.seed || 0x77)) >>> 0);
    const L = o.L, seg = L / (K - 1), R = o.R;
    const axis = new Float32Array(K * 3);
    const p = [o.G[0], o.G[1], o.G[2]];
    const d = o.dir0.slice(); norm(d);
    axis.set(p, 0);
    const q = [0, 0, 0];
    const gx = o.gravity || [0, -1, 0];
    for (let k = 1; k < K; k++) {
      const t = k / (K - 1);
      const st = lerp(o.stiff ?? 0.8, 0.45, smoothstep(0, 0.5, t));
      d[0] = d[0] * st + gx[0] * (1 - st); d[1] = d[1] * st + gx[1] * (1 - st); d[2] = d[2] * st + gx[2] * (1 - st);
      norm(d);
      q[0] = p[0] + d[0] * seg; q[1] = p[1] + d[1] * seg; q[2] = p[2] + d[2] * seg;
      // collide, then restore the segment length (every pass: no kinks in the axis)
      for (let pass = 0; pass < 3; pass++) {
        this._pushHead(q, R * 1.1);
        this.col.push(q[0], q[1], q[2], R * 0.9, q, 0);
        const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2], l = Math.hypot(dx, dy, dz) || 1;
        q[0] = p[0] + (dx / l) * seg; q[1] = p[1] + (dy / l) * seg; q[2] = p[2] + (dz / l) * seg;
      }
      d[0] = q[0] - p[0]; d[1] = q[1] - p[1]; d[2] = q[2] - p[2]; norm(d);
      p[0] = q[0]; p[1] = q[1]; p[2] = q[2];
      axis.set(p, k * 3);
    }
    const F = frames1(axis, K, this.c);
    const n = o.count ?? 24, added = [];
    const flare = o.flare ?? 1.1;
    for (let i = 0; i < n; i++) {
      const th = i * 2.399963 + rnd() * 0.4, rho = Math.sqrt((i + 0.5) / n) * (0.85 + 0.15 * rnd());
      const pts = new Float32Array(K * 3);
      for (let k = 0; k < K; k++) {
        const t = k / (K - 1);
        const Rk = R * (1 + flare * smoothstep(0, 0.3, t)) * (1 - 0.6 * smoothstep(0.55, 1, t)) * (o.taperAll ? 1 - 0.5 * t : 1);
        const tw = (o.twist || 0) * t;
        const cx = Math.cos(th + tw), sx = Math.sin(th + tw), o3 = k * 3;
        for (let qd = 0; qd < 3; qd++) pts[o3 + qd] = axis[o3 + qd] + (F.N[o3 + qd] * cx + F.B[o3 + qd] * sx) * rho * Rk;
      }
      const cut = L * (1 - 0.16 * rnd() * rho);
      const def = {
        pts: cut < L * 0.999 ? truncate(pts, K, cut) : pts, pin: 2,
        w: R * (o.width ?? 0.55) * (0.85 + 0.3 * rnd()), flat: o.flat ?? 0.45, rootW: 0.8, taper0: o.taper0 ?? 0.55, tipW: o.tipW ?? 0.14,
        tone: (o.tone ?? 1) * (0.9 + 0.18 * rnd()), samples: o.samples, sides: o.sides, bias: o.bias ?? 0.35,
        detail: o.detail ? o.detail(i, rnd) : null, layer: R * 0.5, spread: o.spread || 0,
      };
      added.push(this.strands.add(def));
    }
    if (o.dyn !== false) this.comps.push({ strands: added, K, guideCurves: [{ pts: axis, pin: 2, rad: R * 0.9 }], shapeNear: o.shapeNear ?? 0.2, shapeFar: o.shapeFar ?? 0, shapeSpan: 0.2, bend: o.bend ?? 0.6 });
    else for (const i of added) this.strands.list[i].pin = K;
    return axis;
  }

  /**
   * Three-strand braid hanging from G, ending in a tie and a short loose tail.
   * o: {G, dir0, L, W (half width of the braid), K}
   */
  braid(o) {
    const K = o.K || 56, W = o.W, L = o.L;
    const axis = this.tail({ G: o.G, dir0: o.dir0, L, R: W * 0.6, count: 0, K, dyn: false, stiff: 0.85 });
    const F = frames1(axis, K, this.c);
    const added = [];
    const plaitEnd = 0.84; // braided part, then tie + loose end
    const A = new Float32Array(K);
    for (let k = 1; k < K; k++) A[k] = A[k - 1] + Math.hypot(axis[k * 3] - axis[k * 3 - 3], axis[k * 3 + 1] - axis[k * 3 - 2], axis[k * 3 + 2] - axis[k * 3 - 1]);
    const period = W * 3.1; // one full plait cycle
    const end = Math.round((K - 1) * plaitEnd);
    for (let j = 0; j < 3; j++) {
      const pts = new Float32Array(K * 3);
      const ph0 = (j * 2 * Math.PI) / 3;
      for (let k = 0; k < K; k++) {
        // K samples spanning the plaited part of the axis (arc 0 .. A[end])
        const a = (A[end] * k) / (K - 1);
        let i0 = 0;
        while (i0 < K - 2 && A[i0 + 1] < a) i0++;
        const f = clamp((a - A[i0]) / (A[i0 + 1] - A[i0] || 1), 0, 1);
        const t = a / A[K - 1];
        const wk = W * (1 - 0.35 * smoothstep(0, plaitEnd, t)) * (0.55 + 0.45 * smoothstep(0, 0.08, t));
        const fade = 1 - smoothstep(plaitEnd - 0.06, plaitEnd, t) * 0.85; // gathered at the tie
        const ph = (a / period) * 2 * Math.PI + ph0;
        const x = Math.sin(ph) * wk * fade, z = 0.5 * Math.sin(2 * ph) * wk * 0.8 * fade;
        for (let q = 0; q < 3; q++) {
          const o0 = i0 * 3 + q, o1 = o0 + 3;
          const ax = axis[o0] + (axis[o1] - axis[o0]) * f, bb = F.B[o0] + (F.B[o1] - F.B[o0]) * f, nn = F.N[o0] + (F.N[o1] - F.N[o0]) * f;
          pts[k * 3 + q] = ax + bb * x + nn * z;
        }
      }
      added.push(this.strands.add({
        pts, pin: 2, w: W * 0.62, flat: 0.62, rootW: 0.7, taper0: 0.9, tipW: 0.55,
        tone: 1 - 0.05 * j, samples: K * 2, sides: 8, bias: 0.25, layer: W * 0.3,
      }));
    }
    // loose end below the tie
    // elastic band at the end of the plait: a short dark tube that follows the braid axis
    const band = new Float32Array(K * 3), bandL = W * 0.55;
    for (let k = 0; k < K; k++) {
      const a = A[end] - bandL * 0.5 + (bandL * k) / (K - 1);
      let i0 = 0;
      while (i0 < K - 2 && A[i0 + 1] < a) i0++;
      const f = clamp((a - A[i0]) / (A[i0 + 1] - A[i0] || 1), 0, 1);
      for (let q = 0; q < 3; q++) band[k * 3 + q] = axis[i0 * 3 + q] + (axis[i0 * 3 + 3 + q] - axis[i0 * 3 + q]) * f;
    }
    added.push(this.strands.add({ pts: band, pin: 0, w: W * 0.5, flat: 1, rootW: 1, taper0: 0.98, tipW: 1, tone: 0.32, samples: K, sides: 10, bias: 0, layer: 0, arc0: A[end] - bandL * 0.5 }));
    // the loose end follows the braid axis (same guide); built as short clumps around it
    const n = 12, rnd = rng(this.env.seed ^ 0xb4a1);
    for (let i = 0; i < n; i++) {
      const th = i * 2.399963, rho = Math.sqrt((i + 0.5) / n);
      const pts = new Float32Array(K * 3);
      for (let k = 0; k < K; k++) {
        const kk = end + ((K - 1 - end) * k) / (K - 1);
        const k0 = Math.min(K - 2, Math.floor(kk)), f = kk - k0;
        const t = k / (K - 1);
        const Rk = W * 0.45 * (1 + 1.2 * smoothstep(0, 0.4, t)) * (1 - 0.5 * smoothstep(0.6, 1, t));
        for (let q = 0; q < 3; q++) {
          const a = axis[k0 * 3 + q] + (axis[k0 * 3 + 3 + q] - axis[k0 * 3 + q]) * f;
          const nn = F.N[k0 * 3 + q], bb = F.B[k0 * 3 + q];
          pts[k * 3 + q] = a + (nn * Math.cos(th) + bb * Math.sin(th)) * rho * Rk;
        }
      }
      added.push(this.strands.add({ pts, pin: 0, w: W * 0.32, flat: 0.5, rootW: 0.8, taper0: 0.4, tipW: 0.1, tone: 0.95 + 0.1 * rnd(), bias: 0.3, layer: W * 0.3, arc0: A[end] }));
    }
    // the whole braid follows its axis guide: the loose end is bound by index too (its points are
    // re-expressed against the axis point with the same index in the rest pose, which stays valid)
    this.comps.push({ strands: added, K, guideCurves: [{ pts: axis, pin: 2, rad: W * 0.75 }], shapeNear: 0.2, shapeFar: 0, shapeSpan: 0.15, bend: 0.8, rigidFollow: true });
    return axis;
  }

  /**
   * Coiled bun sitting on the head at G (rigid).
   * o: {G, R1 (ring radius), R2 (tube radius), count, K}
   */
  bun(o) {
    const n = this.map.normal(this.dirOf(o.G, [0, 0, 0]), [0, 0, 0]);
    tangentBasis(n, _t1, _t2);
    const e1 = _t1.slice(), e2 = _t2.slice();
    const C = [o.G[0] + n[0] * o.R2 * 0.85, o.G[1] + n[1] * o.R2 * 0.85, o.G[2] + n[2] * o.R2 * 0.85];
    const K = o.K || 44, cnt = o.count || 7, rnd = rng(this.env.seed ^ 0xb0b);
    for (let i = 0; i < cnt; i++) {
      const pts = new Float32Array(K * 3);
      const ph = (i / cnt) * Math.PI * 2;
      for (let k = 0; k < K; k++) {
        const t = k / (K - 1);
        const a = ph + t * Math.PI * 2 * 1.08;
        const b = ph * 1.7 + t * Math.PI * 2 * 2.3;
        const rr = o.R1 + o.R2 * Math.cos(b) * 0.9;
        const hh = o.R2 * Math.sin(b) * 0.8;
        for (let q = 0; q < 3; q++) pts[k * 3 + q] = C[q] + (e1[q] * Math.cos(a) + e2[q] * Math.sin(a)) * rr + n[q] * hh;
      }
      this.strands.add({ pts, pin: K, w: o.R2 * 0.7, flat: 0.55, rootW: 0.5, taper0: 0.8, tipW: 0.35, tone: 0.95 + 0.1 * rnd(), samples: K, sides: 7, bias: 0.4, axis: null });
    }
    // dark core fills the centre of the coil
    this.solid(sphereSolid(C, o.R1 * 0.95, 0.55, 2));
    return C;
  }

  /** Elastic hair tie: small dark torus around direction d at point G. */
  tie(G, d, r) {
    const dd = d.slice(); norm(dd);
    this.solid(torusSolid(G, dd, r, r * 0.3, 0.35));
  }

  /**
   * Afro: many perturbed blobs filling a rounded volume above the scalp (rigid).
   * o: {mask, size (outer offset m), R (blob radius m), count}
   */
  puffs(o) {
    const s = this.s, rnd = rng(this.env.seed ^ 0xaf20);
    const layers = [{ count: o.count, f: 1, r: 1 }, { count: Math.round(o.count * 0.55), f: 0.55, r: 0.95 }];
    for (const Ly of layers) {
      const { dirs } = sampleRoots(o.mask, Ly.count, (this.env.seed + Ly.count) >>> 0, -2);
      for (let i = 0; i < dirs.length / 3; i++) {
        const u = [dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]];
        const m = o.mask(u);
        const shape = smoothstep(-2, 26, m);
        const Rb = o.R * Ly.r * (0.75 + 0.45 * rnd()) * (0.55 + 0.45 * shape);
        const h = Math.max(Rb * 0.3, o.size * Ly.f * (0.35 + 0.65 * shape) - Rb * 0.7);
        const C = this.point(u, h);
        this.solid(sphereSolid(C, Rb, 0.9 + 0.15 * rnd(), 1, rnd, u, 0.72));
      }
    }
  }

  _pushHead(q, margin) { pushHead(this.map, q[0], q[1], q[2], margin, q, 0); }

  /** Registers a dynamic component for strands added by add(). */
  dynamic(indices, K, opts) { if (indices.length) this.comps.push({ strands: indices, K, ...opts }); }

  /** Adds a precomputed strand. */
  add(def) { return this.strands.add(def); }

  /** Rigid solid mesh in rest space: {pos, nor, tone, index, uv?}. */
  solid(m) { this.solids.push(m); }

  /** Sets out = tangential component of (x,y,z) at u. */
  tan(out, u, x, y, z) { out[0] = x; out[1] = y; out[2] = z; return tangent(out, u); }

  /** Point on the skin along unit u raised by h (m) -> new array. */
  point(u, h = 0) { return this.grower.surface(u, h, [0, 0, 0]); }

  /** Unit vector (normalised copy). */
  dir(x, y, z) { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; }

  // ---------------------------------------------------------------- dynamic setup
  /** Builds the solver input and clump bindings for all dynamic components. */
  finishDynamics() {
    if (!this.comps.length) return null;
    const list = this.strands.list;
    const guides = [];
    const curves = [];
    let total = 0;
    for (const comp of this.comps) {
      comp.guideIds = [];
      const K = comp.K;
      const mk = (pts, pin, rad, drape = 0) => {
        const gd = { start: total, K, pin: Math.max(1, Math.min(K - 1, pin)), rad, bend: comp.bend ?? 0.6, head: comp.head !== false, drape };
        gd.shape = shapeProfile(K, gd.pin, comp.shapeNear ?? 0.15, comp.shapeFar ?? 0, comp.shapeSpan ?? 0.5);
        total += K;
        comp.guideIds.push(guides.length);
        guides.push(gd);
        curves.push(pts);
      };
      if (comp.guideCurves) { for (const gc of comp.guideCurves) mk(gc.pts, gc.pin, gc.rad); continue; }
      // guides are picked per drape group (hair falling in front of the shoulders vs behind):
      // clumps only follow guides of their own group
      const groups = new Map();
      for (const si of comp.strands) { const d = list[si].drape || 0; (groups.get(d) || groups.set(d, []).get(d)).push(si); }
      const Gtot = comp.guides || 40, ntot = comp.strands.length;
      comp.groupGuides = new Map();
      for (const [d, idx] of groups) {
        const n = idx.length;
        const G = Math.min(n, Math.max(Math.min(n, 6), Math.round((Gtot * n) / ntot)));
        // farthest point sampling on (root + first free point) positions
        const keys = idx.map((si) => { const st = list[si], k1 = Math.min(K - 1, st.pin + 1) * 3, p = st.pts; return [p[0], p[1], p[2], p[k1], p[k1 + 1], p[k1 + 2]]; });
        const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) + Math.hypot(a[3] - b[3], a[4] - b[4], a[5] - b[5]);
        const chosen = [0];
        const dmin = new Float32Array(n).fill(1e9);
        for (let gi = 1; gi < G; gi++) {
          const last = keys[chosen[gi - 1]];
          let best = -1, bd = -1;
          for (let i = 0; i < n; i++) {
            const dd = dist(keys[i], last);
            if (dd < dmin[i]) dmin[i] = dd;
            if (dmin[i] > bd) { bd = dmin[i]; best = i; }
          }
          chosen.push(best);
        }
        const ids = [];
        for (const ci of chosen) { const st = list[idx[ci]]; ids.push(guides.length); mk(st.pts, st.pin, (st.layer || 0.004) + st.w * (st.flat ?? 0.36), d); }
        comp.groupGuides.set(d, ids);
      }
    }
    const grown = new Float32Array(total * 3);
    guides.forEach((gd, i) => grown.set(curves[i], gd.start * 3));
    // settle the guides in the rest pose: the runtime solver then starts at equilibrium and
    // every pose change only moves the hair by the difference it makes
    this.map.scale = this.s;
    const solver = new GuideSolver(grown, guides, this.map, this.col);
    for (let it = 0; it < 40; it += 4) { solver.iterate(4); if (solver.meanMove < 0.00025) break; }
    const rest = solver.cur;
    const frames = guideFrames(rest, guides, this.c, null);
    const { T, N, B } = frames;
    const binds = [];
    const tmp = [0, 0, 0];
    for (const comp of this.comps) {
      const K = comp.K;
      for (const si of comp.strands) {
        const st = list[si], r = st.pts;
        const gids = comp.groupGuides?.get(st.drape || 0) || comp.guideIds;
        const k1 = Math.min(K - 1, st.pin + 1) * 3;
        const near = gids.map((gid) => {
          const q = rest.subarray(guides[gid].start * 3);
          return { gid, d: Math.hypot(r[0] - q[0], r[1] - q[1], r[2] - q[2]) + Math.hypot(r[k1] - q[k1], r[k1 + 1] - q[k1 + 1], r[k1 + 2] - q[k1 + 2]) };
        }).sort((a, b) => a.d - b.d).slice(0, 3);
        let ws = near.map((x) => 1 / Math.pow(x.d + 0.003, 3));
        if (near[0].d < 1e-6) ws = near.map((_, i) => (i === 0 ? 1 : 0));
        const sw = ws.reduce((a, b) => a + b, 0);
        const b = { strand: si, K, g: new Int32Array(3), w: new Float32Array(3), off: new Float32Array(3 * K * 3), beta: new Float32Array(K), rad: st.layer * 0.5 + st.w * (st.flat ?? 0.36) };
        near.forEach((x, j) => { b.g[j] = x.gid; b.w[j] = ws[j] / sw; });
        for (let j = near.length; j < 3; j++) { b.g[j] = near[0].gid; b.w[j] = 0; }
        for (let k = 0; k < K; k++) b.beta[k] = comp.rigidFollow ? (k < st.pin ? 0 : 1) : smoothstep(st.pin - 1.5, st.pin + 1.5, k);
        // carry the clump along with its guides' settling
        for (let k = st.pin > 0 ? 1 : 0; k < K; k++) {
          if (!b.beta[k]) continue;
          let dx = 0, dy = 0, dz = 0;
          for (let j = 0; j < 3; j++) {
            const o = (guides[b.g[j]].start + k) * 3, w = b.w[j] * b.beta[k];
            dx += w * (rest[o] - grown[o]); dy += w * (rest[o + 1] - grown[o + 1]); dz += w * (rest[o + 2] - grown[o + 2]);
          }
          this.col.push(r[k * 3] + dx, r[k * 3 + 1] + dy, r[k * 3 + 2] + dz, b.rad * 0.7, tmp, 0);
          r[k * 3] = tmp[0]; r[k * 3 + 1] = tmp[1]; r[k * 3 + 2] = tmp[2];
        }
        // bind by projection: clump point k follows the closest point of each guide (searched
        // monotonically along the guide), so offsets stay lateral for straight, wavy and plaited
        // strands alike: no long tangential lever arms when the guide bends
        b.at = new Float32Array(3 * K);
        const prevI = [-1, -1, -1];
        for (let k = 0; k < K; k++) {
          for (let j = 0; j < 3; j++) {
            const gd = guides[b.g[j]];
            const px = r[k * 3], py = r[k * 3 + 1], pz = r[k * 3 + 2];
            const lo = prevI[j] < 0 ? 0 : Math.max(0, prevI[j] - 1), hi = prevI[j] < 0 ? K - 2 : Math.min(K - 2, prevI[j] + 8);
            let i0 = lo, f = 0, best = Infinity;
            for (let i = lo; i <= hi; i++) {
              const a = (gd.start + i) * 3;
              const ex = rest[a + 3] - rest[a], ey = rest[a + 4] - rest[a + 1], ez = rest[a + 5] - rest[a + 2];
              const l2 = ex * ex + ey * ey + ez * ez || 1e-12;
              // the last segment may be extrapolated a little (clumps slightly longer than their guide)
              const ff = clamp(((px - rest[a]) * ex + (py - rest[a + 1]) * ey + (pz - rest[a + 2]) * ez) / l2, 0, i === K - 2 ? 1.6 : 1);
              const d = Math.hypot(px - rest[a] - ex * ff, py - rest[a + 1] - ey * ff, pz - rest[a + 2] - ez * ff);
              if (d < best - 1e-7) { best = d; i0 = i; f = ff; }
            }
            prevI[j] = i0;
            const u = i0 + f;
            b.at[j * K + k] = u;
            const o0 = (gd.start + i0) * 3, o1 = o0 + 3;
            const gx = rest[o0] + (rest[o1] - rest[o0]) * f, gy = rest[o0 + 1] + (rest[o1 + 1] - rest[o0 + 1]) * f, gz = rest[o0 + 2] + (rest[o1 + 2] - rest[o0 + 2]) * f;
            const fr = Math.min(1, f);
            const tx = T[o0] + (T[o1] - T[o0]) * fr, ty = T[o0 + 1] + (T[o1 + 1] - T[o0 + 1]) * fr, tz = T[o0 + 2] + (T[o1 + 2] - T[o0 + 2]) * fr;
            const nx = N[o0] + (N[o1] - N[o0]) * fr, ny = N[o0 + 1] + (N[o1 + 1] - N[o0 + 1]) * fr, nz = N[o0 + 2] + (N[o1 + 2] - N[o0 + 2]) * fr;
            const bx = B[o0] + (B[o1] - B[o0]) * fr, by = B[o0 + 1] + (B[o1 + 1] - B[o0 + 1]) * fr, bz = B[o0 + 2] + (B[o1 + 2] - B[o0 + 2]) * fr;
            const dx = r[k * 3] - gx, dy = r[k * 3 + 1] - gy, dz = r[k * 3 + 2] - gz;
            const q = (j * K + k) * 3;
            b.off[q] = dx * tx + dy * ty + dz * tz;
            b.off[q + 1] = dx * nx + dy * ny + dz * nz;
            b.off[q + 2] = dx * bx + dy * by + dz * bz;
          }
        }
        binds.push(b);
      }
    }
    // segment lengths come from the grown curves (the settled ones may carry collision stretch)
    return { rest, guides, binds, lengths: grown };
  }

  finish() {
    return { strands: this.strands, patch: this.patch, capOffset: this.capOffset, solids: this.solids, dyn: this.finishDynamics() };
  }
}

function norm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; }

/** Frames of a single polyline (see guideFrames). */
function frames1(pts, K, c) { return guideFrames(pts, [{ start: 0, K }], c, null); }

/**
 * Parallel-transport frames (T, N, B) of every guide point.
 * Root frame: tangent of the first segment, N = outward from the head centre c.
 * out: optional {T,N,B} Float32Arrays to reuse.
 */
export function guideFrames(P, guides, c, out) {
  const n = P.length;
  const F = out || { T: new Float32Array(n), N: new Float32Array(n), B: new Float32Array(n) };
  const { T, N, B } = F;
  for (const gd of guides) {
    const s0 = gd.start, K = gd.K;
    for (let k = 0; k < K; k++) {
      const a = (s0 + Math.max(0, k - 1)) * 3, b = (s0 + Math.min(K - 1, k + 1)) * 3, o = (s0 + k) * 3;
      const x = P[b] - P[a], y = P[b + 1] - P[a + 1], z = P[b + 2] - P[a + 2];
      const l = Math.hypot(x, y, z) || 1;
      T[o] = x / l; T[o + 1] = y / l; T[o + 2] = z / l;
    }
    let o = s0 * 3;
    let nx = P[o] - c[0], ny = P[o + 1] - c[1], nz = P[o + 2] - c[2];
    let d = nx * T[o] + ny * T[o + 1] + nz * T[o + 2];
    nx -= d * T[o]; ny -= d * T[o + 1]; nz -= d * T[o + 2];
    let l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) { nx = 0; ny = 0; nz = 1; d = T[o + 2]; nx -= d * T[o]; ny -= d * T[o + 1]; nz -= d * T[o + 2]; l = Math.hypot(nx, ny, nz) || 1; }
    N[o] = nx / l; N[o + 1] = ny / l; N[o + 2] = nz / l;
    for (let k = 1; k < K; k++) {
      const p = (s0 + k - 1) * 3, q = p + 3;
      // double reflection (rotation minimising frame)
      const v1x = P[q] - P[p], v1y = P[q + 1] - P[p + 1], v1z = P[q + 2] - P[p + 2];
      const c1 = v1x * v1x + v1y * v1y + v1z * v1z || 1e-12;
      let k1 = (2 / c1) * (v1x * N[p] + v1y * N[p + 1] + v1z * N[p + 2]);
      const rLx = N[p] - k1 * v1x, rLy = N[p + 1] - k1 * v1y, rLz = N[p + 2] - k1 * v1z;
      k1 = (2 / c1) * (v1x * T[p] + v1y * T[p + 1] + v1z * T[p + 2]);
      const tLx = T[p] - k1 * v1x, tLy = T[p + 1] - k1 * v1y, tLz = T[p + 2] - k1 * v1z;
      const v2x = T[q] - tLx, v2y = T[q + 1] - tLy, v2z = T[q + 2] - tLz;
      const c2 = v2x * v2x + v2y * v2y + v2z * v2z;
      let rx = rLx, ry = rLy, rz = rLz;
      if (c2 > 1e-12) { const k2 = (2 / c2) * (v2x * rLx + v2y * rLy + v2z * rLz); rx -= k2 * v2x; ry -= k2 * v2y; rz -= k2 * v2z; }
      d = rx * T[q] + ry * T[q + 1] + rz * T[q + 2];
      rx -= d * T[q]; ry -= d * T[q + 1]; rz -= d * T[q + 2];
      l = Math.hypot(rx, ry, rz) || 1;
      N[q] = rx / l; N[q + 1] = ry / l; N[q + 2] = rz / l;
    }
    for (let k = 0; k < K; k++) {
      o = (s0 + k) * 3;
      B[o] = T[o + 1] * N[o + 2] - T[o + 2] * N[o + 1];
      B[o + 1] = T[o + 2] * N[o] - T[o] * N[o + 2];
      B[o + 2] = T[o] * N[o + 1] - T[o + 1] * N[o];
    }
  }
  return F;
}

// ---------------------------------------------------------------- solids
/** UV sphere-ish blob (icosahedron subdivided), radius r, tone, optional noise and outward bias u. */
function sphereSolid(C, r, tone, sub = 1, rnd = null, u = null, squash = 1) {
  const t = (1 + Math.sqrt(5)) / 2;
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => norm(v));
  let Fc = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let sd = 0; sd < sub; sd++) {
    const cache = new Map(), F2 = [];
    const mid = (a, b) => { const k = a < b ? a * 9999 + b : b * 9999 + a; if (!cache.has(k)) { V.push(norm([(V[a][0] + V[b][0]) / 2, (V[a][1] + V[b][1]) / 2, (V[a][2] + V[b][2]) / 2])); cache.set(k, V.length - 1); } return cache.get(k); };
    for (const [a, b, c] of Fc) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); F2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    Fc = F2;
  }
  const n = V.length, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), tn = new Float32Array(n).fill(tone);
  for (let i = 0; i < n; i++) {
    const v = V[i];
    const k = rnd ? 1 + (rnd() - 0.5) * 0.22 : 1;
    // optional squash along u (puffs flattened against the volume: smoother outer surface)
    const du = u && squash !== 1 ? (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) * (squash - 1) : 0;
    const vx = v[0] + (u ? u[0] * du : 0), vy = v[1] + (u ? u[1] * du : 0), vz = v[2] + (u ? u[2] * du : 0);
    pos[i * 3] = C[0] + vx * r * k; pos[i * 3 + 1] = C[1] + vy * r * k; pos[i * 3 + 2] = C[2] + vz * r * k;
    // puffs of a volume (afro) shade mostly like the volume itself: normals bent towards u
    let nx = v[0], ny = v[1], nz = v[2];
    if (u) { nx = v[0] * 0.45 + u[0]; ny = v[1] * 0.45 + u[1]; nz = v[2] * 0.45 + u[2]; }
    const l = Math.hypot(nx, ny, nz) || 1;
    nor[i * 3] = nx / l; nor[i * 3 + 1] = ny / l; nor[i * 3 + 2] = nz / l;
    if (u && v[0] * u[0] + v[1] * u[1] + v[2] * u[2] < -0.3) tn[i] = tone * 0.82; // underside darker
  }
  const index = new Uint32Array(Fc.length * 3);
  Fc.forEach((f, i) => { index[i * 3] = f[0]; index[i * 3 + 1] = f[1]; index[i * 3 + 2] = f[2]; });
  return { pos, nor, tone: tn, index };
}

/** Torus around axis d through C (major radius R, minor r). */
function torusSolid(C, d, R, r, tone) {
  const e1 = [0, 0, 0], e2 = [0, 0, 0];
  tangentBasis(d, e1, e2);
  const nu = 20, nv = 8, pos = [], nor = [], index = [];
  for (let i = 0; i <= nu; i++) {
    const a = (i / nu) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    const rx = e1[0] * ca + e2[0] * sa, ry = e1[1] * ca + e2[1] * sa, rz = e1[2] * ca + e2[2] * sa;
    for (let j = 0; j <= nv; j++) {
      const b = (j / nv) * Math.PI * 2, cb = Math.cos(b), sb = Math.sin(b);
      const nx = rx * cb + d[0] * sb, ny = ry * cb + d[1] * sb, nz = rz * cb + d[2] * sb;
      pos.push(C[0] + rx * R + nx * r, C[1] + ry * R + ny * r, C[2] + rz * R + nz * r);
      nor.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + nv + 1;
    index.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return { pos: Float32Array.from(pos), nor: Float32Array.from(nor), tone: new Float32Array(pos.length / 3).fill(tone), index: Uint32Array.from(index) };
}
