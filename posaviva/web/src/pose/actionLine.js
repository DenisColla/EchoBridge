// "Linea d'azione": the user draws one stroke over the character and the body bends
// to follow it.
//
//  1. The stroke (screen px) is smoothed, resampled and projected on a camera-facing
//     plane through the character.
//  2. Its two ends are matched to the body: one end to a "base" (pelvis or a foot),
//     the other to a "tip" (head or a hand), so a stroke from the hips to the head
//     bends the back, one from a foot to a raised hand runs through leg, back and arm.
//  3. The chain of joints between base and tip is fitted to the curve with a damped
//     least-squares solver (Levenberg-Marquardt, numeric Jacobian) on the anatomical
//     controls (pelvis tilt, abdomen, chest, neck, head, shoulder, arm, forearm,
//     thigh, knee): bone lengths are kept by construction, anatomical limits by the
//     controls (rig.write clamps), the depth layout is kept by a soft term.
//  4. The base stays where it is (a foot base keeps the foot planted: the body moves
//     over it), the other planted feet are kept with the leg IK.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane();

const N_SAMPLES = 40;
const ROOT_MAX = 0.35; // max pelvis tilt change (rad) of one stroke
const DEPTH_W = 0.35; // weight of the "keep the depth layout" residual
/**
 * Preference for the current pose (m per rad) per part: the back and the limbs bend
 * freely, the pelvis tilt (which moves the whole body over the feet) is a last resort.
 */
const PRIOR_W = { pelvis: 0.06, abdomen: 0.012, chest: 0.012, neck: 0.02, head: 0.03, shoulder: 0.03, arm: 0.01, forearm: 0.01, thigh: 0.015, shin: 0.015 };
/** smoothness (m per rad): neighbouring back parts change together -> one fluid curve, no kink at the waist */
const SMOOTH_W = 0.035;
const SMOOTH_PAIRS = [['abdomen', 'chest'], ['chest', 'neck'], ['neck', 'head']];

/** Names used to describe the fitted chain (Italian, for the hint). */
const LABEL = { pelvis: 'bacino', head: 'testa', 'foot.L': 'piede sinistro', 'foot.R': 'piede destro', 'hand.L': 'mano sinistra', 'hand.R': 'mano destra' };
export const BASES = ['pelvis', 'foot.L', 'foot.R'];
export const TIPS = ['head', 'hand.L', 'hand.R'];

export class ActionLine {
  /** ctx: pose module context (app, rig, ik, controls, state, keepFeet, feetOnFloor, groundMode) */
  constructor(ctx) {
    this.ctx = ctx;
    this.app = ctx.app;
    const bi = (n) => ctx.rig.model.boneIndex.get(n);
    this.bi = bi;
    this.last = null; // {ch, world: Vector3[]} last stroke (faint overlay)
  }

  // ------------------------------------------------------------ joints
  /** joint point functions: [kind, bone index, t] (t: 0 head, 1 tail) */
  _spec(name) {
    const b = this.bi;
    const S = {
      pelvis: ['h', b('spine05')], sp4: ['h', b('spine04')], sp3: ['h', b('spine03')], sp2: ['h', b('spine02')], sp1: ['h', b('spine01')],
      neck: ['h', b('neck01')], neck3: ['h', b('neck03')], headBase: ['h', b('head')], headTop: ['t', b('head'), 1],
    };
    for (const sd of ['L', 'R']) {
      S['hip.' + sd] = ['h', b(`upperleg01.${sd}`)];
      S['knee.' + sd] = ['h', b(`lowerleg01.${sd}`)];
      S['ankle.' + sd] = ['h', b(`foot.${sd}`)];
      S['shoulder.' + sd] = ['h', b(`upperarm01.${sd}`)];
      S['elbow.' + sd] = ['h', b(`lowerarm01.${sd}`)];
      S['wrist.' + sd] = ['h', b(`wrist.${sd}`)];
      S['fingers.' + sd] = ['t', b(`finger3-3.${sd}`), 1];
    }
    return S[name];
  }

  _point(ch, spec, out) {
    return spec[0] === 'h' ? this.ctx.rig.worldPos(ch, spec[1], out) : this.ctx.rig.pointOnBone(ch, spec[1], spec[2], out);
  }

  /** world point of a terminal (base / tip) */
  terminal(ch, id, out = new THREE.Vector3()) {
    const n = { pelvis: 'pelvis', head: 'headTop', 'foot.L': 'ankle.L', 'foot.R': 'ankle.R', 'hand.L': 'wrist.L', 'hand.R': 'wrist.R' }[id];
    return this._point(ch, this._spec(n), out);
  }

  /** Joint names and solver parameters of the chain base -> tip. */
  chain(base, tip) {
    const joints = [], params = [];
    const P = (id, key) => params.push([id, key]);
    if (base !== 'pelvis') {
      const sd = base.slice(-1);
      joints.push('ankle.' + sd, 'knee.' + sd, 'hip.' + sd);
      P('thigh.' + sd, 'flex'); P('thigh.' + sd, 'abd'); P('shin.' + sd, 'flex');
    } else joints.push('pelvis');
    joints.push('sp4', 'sp3', 'sp2');
    P('pelvis', 'flex'); P('pelvis', 'lat');
    P('abdomen', 'flex'); P('abdomen', 'lat'); P('chest', 'flex'); P('chest', 'lat');
    if (tip === 'head') {
      joints.push('sp1', 'neck', 'neck3', 'headBase', 'headTop');
      P('neck', 'flex'); P('neck', 'lat'); P('head', 'flex'); P('head', 'lat');
    } else {
      const sd = tip.slice(-1);
      joints.push('shoulder.' + sd, 'elbow.' + sd, 'wrist.' + sd, 'fingers.' + sd);
      P('shoulder.' + sd, 'elev'); P('shoulder.' + sd, 'prot');
      P('arm.' + sd, 'flex'); P('arm.' + sd, 'abd'); P('forearm.' + sd, 'flex');
    }
    return { base, tip, joints, params };
  }

  // ------------------------------------------------------------ stroke
  /**
   * Fits the character to a stroke. pts: [{x, y}] client px (in drawing order).
   * Returns {ok, base, tip, label} or {ok:false, reason}.
   */
  fit(ch, pts) {
    const { app, rig } = this.ctx;
    const cam = app.camera;
    cam.updateMatrixWorld();
    ch.root.updateMatrixWorld(true);
    const scr = resample(smooth(pts), N_SAMPLES);
    if (!scr) return { ok: false, reason: 'short' };

    // 1) ends -> base / tip (screen distances, both orientations)
    const rect = app.canvas.getBoundingClientRect();
    const toScreen = (p) => { _v.copy(p).project(cam); return { x: rect.left + (_v.x + 1) * 0.5 * rect.width, y: rect.top + (1 - _v.y) * 0.5 * rect.height }; };
    const term = {};
    for (const id of [...BASES, ...TIPS]) term[id] = toScreen(this.terminal(ch, id, _v2));
    const A = scr[0], B = scr[scr.length - 1];
    const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
    let best = null;
    for (const b of BASES) for (const t of TIPS) {
      for (const rev of [false, true]) {
        const s0 = rev ? B : A, s1 = rev ? A : B;
        // the pelvis is the default base: a foot / hand must really be reached by the stroke
        const cost = d(s0, term[b]) + d(s1, term[t]) + (b === 'pelvis' ? 0 : 24) + (t === 'head' ? 0 : 24);
        if (!best || cost < best.cost) best = { cost, b, t, rev };
      }
    }
    const strokeScr = best.rev ? scr.slice().reverse() : scr;
    const chain = this.chain(best.b, best.t);

    // 2) stroke -> camera-facing plane through the chain middle
    const specs = chain.joints.map((n) => this._spec(n));
    const X0 = specs.map((s) => this._point(ch, s, new THREE.Vector3()));
    const mid = X0[Math.floor(X0.length / 2)];
    const n = cam.getWorldDirection(new THREE.Vector3()).normalize();
    _plane.setFromNormalAndCoplanarPoint(n, mid);
    const rc = new THREE.Raycaster();
    const W = [];
    for (const p of strokeScr) {
      _ndc.set(((p.x - rect.left) / rect.width) * 2 - 1, -((p.y - rect.top) / rect.height) * 2 + 1);
      rc.setFromCamera(_ndc, cam);
      const hit = rc.ray.intersectPlane(_plane, new THREE.Vector3());
      if (hit) W.push(hit);
    }
    if (W.length < 6) return { ok: false, reason: 'plane' };
    const arcW = cumulative(W);
    const Ls = arcW[arcW.length - 1];
    if (Ls < 1e-4) return { ok: false, reason: 'short' };

    // 3) joint targets: same arc-length fractions along the stroke, scaled to the chain
    const arcJ = cumulative(X0);
    const Lc = arcJ[arcJ.length - 1];
    const scale = Lc / Ls;
    const T = arcJ.map((a) => sampleAt(W, arcW, (a / Lc) * Ls).sub(W[0]).multiplyScalar(scale));
    const D0 = X0.map((x) => _v.subVectors(x, X0[0]).dot(n)); // depth of each joint (relative to the base)

    // 4) planted feet + anchor
    const feet = this.ctx.feetOnFloor(ch);
    const baseSide = best.b === 'pelvis' ? null : best.b.slice(-1);
    const pins = ['L', 'R'].filter((sd) => feet[sd] && sd !== baseSide).map((sd) => this.ctx.ik.pin(ch, sd));
    const anchor0 = X0[0].clone();
    const grounded = this.ctx.groundMode(ch);

    const params = chain.params.map(([id, key]) => {
      const c = this.ctx.controls.get(id); const k = c.axes.findIndex((a) => a.key === key);
      return { c, k, v0: rig.read(ch, c, k) };
    });
    const solver = new LM(this, ch, specs, T, D0, n, params);
    solver.solve(14);

    // 5) base stays put (a planted foot base: the body moves over it), other feet planted
    if (baseSide) {
      const now = this._point(ch, specs[0], new THREE.Vector3());
      _m.copy(ch.rig.matrixWorld).invert();
      const a = _v.copy(anchor0).applyMatrix4(_m), b = _v2.copy(now).applyMatrix4(_m);
      ch.rootOffset.add(a.sub(b));
      rig.refreshAll(ch);
    }
    for (const p of pins) this.ctx.ik.solvePinned(ch, p);
    if (grounded && !pins.length && !baseSide) this.ctx.settle(ch, grounded);

    this.last = { ch, world: W.map((p) => p.clone()), chain };
    return { ok: true, base: best.b, tip: best.t, label: `${LABEL[best.b]} → ${LABEL[best.t]}` };
  }

  /** Current line of action of a character (world points): stance foot -> pelvis -> back -> head. */
  bodyLine(ch, out = []) {
    // stance foot: the one closer to (under) the pelvis
    const P = this.terminal(ch, 'pelvis', _v2);
    let sd = 'L', bd = Infinity;
    for (const s of ['L', 'R']) {
      const a = this.terminal(ch, 'foot.' + s, _v);
      const dd = (a.x - P.x) ** 2 + (a.z - P.z) ** 2 + 0.1 * (a.y - P.y) ** 2;
      if (dd < bd) { bd = dd; sd = s; }
    }
    const names = ['ankle.' + sd, 'knee.' + sd, 'hip.' + sd, 'sp4', 'sp3', 'sp2', 'sp1', 'neck', 'headBase', 'headTop'];
    names.forEach((nm, i) => this._point(ch, this._spec(nm), out[i] || (out[i] = new THREE.Vector3())));
    out.length = names.length;
    return out;
  }

  clear() { this.last = null; }
}

// ---------------------------------------------------------------- solver
class LM {
  constructor(line, ch, specs, T, D0, n, params) {
    Object.assign(this, { line, ch, specs, T, D0, n, params });
    this.rig = line.ctx.rig;
    this.m = params.length;
    // smoothness pairs: same axis on neighbouring back parts
    this.pairs = [];
    for (const [a, b] of SMOOTH_PAIRS) {
      for (const key of ['flex', 'lat']) {
        const i = params.findIndex((p) => p.c.baseId === a && p.c.axes[p.k].key === key);
        const j = params.findIndex((p) => p.c.baseId === b && p.c.axes[p.k].key === key);
        if (i >= 0 && j >= 0) this.pairs.push([i, j]);
      }
    }
    // joints near the base matter less (the start of a hand-drawn stroke is the least precise)
    this.jw = specs.map((_, i) => 0.55 + 0.45 * (i / Math.max(1, specs.length - 1)));
    this.nr = (specs.length - 1) * 4 + this.m + this.pairs.length;
    this.X = specs.map(() => new THREE.Vector3());
    this.theta = params.map((p) => p.v0);
    this.prior = params.map((p) => PRIOR_W[p.c.baseId] ?? 0.02);
  }

  /** writes parameters (clamped by the anatomical limits; pelvis tilt bounded) and refreshes the skeleton */
  set(theta) {
    const { rig, ch } = this;
    for (let j = 0; j < this.m; j++) {
      const p = this.params[j];
      let v = theta[j];
      if (p.c.free) v = Math.max(p.v0 - ROOT_MAX, Math.min(p.v0 + ROOT_MAX, v));
      theta[j] = rig.write(ch, p.c, p.k, v).value;
    }
    rig.refreshAll(ch);
  }

  residual(out) {
    const { X, specs, T, n, D0 } = this;
    for (let i = 0; i < specs.length; i++) this.line._point(this.ch, specs[i], X[i]);
    let r = 0;
    for (let i = 1; i < specs.length; i++) {
      const dx = X[i].x - X[0].x, dy = X[i].y - X[0].y, dz = X[i].z - X[0].z;
      const dn = dx * n.x + dy * n.y + dz * n.z;
      // in-plane difference to the target (target lies in the plane)
      const ex = dx - dn * n.x - T[i].x, ey = dy - dn * n.y - T[i].y, ez = dz - dn * n.z - T[i].z;
      const w = this.jw[i];
      out[r++] = w * ex; out[r++] = w * ey; out[r++] = w * ez;
      out[r++] = DEPTH_W * (dn - D0[i]);
    }
    const th = this.theta, P = this.params;
    for (let j = 0; j < this.m; j++) out[r++] = this.prior[j] * (th[j] - P[j].v0);
    for (const [a, b] of this.pairs) out[r++] = SMOOTH_W * ((th[a] - P[a].v0) - (th[b] - P[b].v0));
    return out;
  }

  cost(r) { let s = 0; for (let i = 0; i < r.length; i++) s += r[i] * r[i]; return s; }

  solve(iters) {
    const m = this.m, nr = this.nr;
    const r = new Float64Array(nr), r2 = new Float64Array(nr);
    const J = new Float64Array(nr * m);
    const H = new Float64Array(m * m), g = new Float64Array(m);
    const th = this.theta.slice(), trial = new Array(m);
    this.set(th); this.theta = th;
    this.residual(r);
    let cost = this.cost(r), lambda = 1e-3;
    const h = 0.012;
    for (let it = 0; it < iters; it++) {
      // numeric Jacobian (one-sided, away from a limit)
      for (let j = 0; j < m; j++) {
        const save = th[j];
        const t2 = th.slice(); t2[j] = save + h;
        this.set(t2);
        let step = t2[j] - save;
        if (Math.abs(step) < h * 0.5) { t2[j] = save - h; this.set(t2); step = t2[j] - save; }
        this.theta = t2;
        this.residual(r2);
        for (let i = 0; i < nr; i++) J[i * m + j] = Math.abs(step) > 1e-6 ? (r2[i] - r[i]) / step : 0;
      }
      this.set(th); this.theta = th;
      // normal equations
      H.fill(0); g.fill(0);
      for (let i = 0; i < nr; i++) {
        const ri = r[i], o = i * m;
        for (let a = 0; a < m; a++) {
          const ja = J[o + a];
          if (!ja) continue;
          g[a] += ja * ri;
          for (let b = a; b < m; b++) H[a * m + b] += ja * J[o + b];
        }
      }
      for (let a = 0; a < m; a++) for (let b = 0; b < a; b++) H[a * m + b] = H[b * m + a];
      let improved = false;
      for (let tries = 0; tries < 5 && !improved; tries++) {
        const A = new Float64Array(H);
        for (let a = 0; a < m; a++) A[a * m + a] += lambda * (H[a * m + a] + 1e-6);
        const delta = solveSym(A, g, m);
        if (!delta) { lambda *= 10; continue; }
        for (let a = 0; a < m; a++) trial[a] = th[a] - Math.max(-0.5, Math.min(0.5, delta[a]));
        this.set(trial); this.theta = trial;
        this.residual(r2);
        const c2 = this.cost(r2);
        if (c2 < cost) {
          for (let a = 0; a < m; a++) th[a] = trial[a];
          r.set(r2); cost = c2; lambda = Math.max(1e-5, lambda * 0.3); improved = true;
        } else lambda *= 8;
      }
      this.set(th); this.theta = th;
      if (!improved) break;
    }
    this.residual(r);
    return cost;
  }
}

/** Solves A x = b (A symmetric, m x m, row-major) by Gaussian elimination with pivoting. */
function solveSym(A, b, m) {
  const M = new Float64Array(m * (m + 1));
  for (let i = 0; i < m; i++) { for (let j = 0; j < m; j++) M[i * (m + 1) + j] = A[i * m + j]; M[i * (m + 1) + m] = b[i]; }
  const w = m + 1;
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(M[r * w + c]) > Math.abs(M[p * w + c])) p = r;
    if (Math.abs(M[p * w + c]) < 1e-12) return null;
    if (p !== c) for (let k = 0; k < w; k++) { const t = M[c * w + k]; M[c * w + k] = M[p * w + k]; M[p * w + k] = t; }
    const d = M[c * w + c];
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = M[r * w + c] / d;
      if (!f) continue;
      for (let k = c; k < w; k++) M[r * w + k] -= f * M[c * w + k];
    }
  }
  const x = new Float64Array(m);
  for (let i = 0; i < m; i++) x[i] = M[i * w + m] / M[i * w + i];
  return x;
}

// ---------------------------------------------------------------- polyline helpers
/** moving-average smoothing of screen points (drops near-duplicates) */
function smooth(pts) {
  const out = [];
  for (const p of pts) if (!out.length || Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) > 1.5) out.push({ x: p.x, y: p.y });
  if (out.length < 3) return out;
  const res = out.map((p) => ({ ...p }));
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < out.length - 1; i++) {
      res[i].x = (out[i - 1].x + 2 * out[i].x + out[i + 1].x) / 4;
      res[i].y = (out[i - 1].y + 2 * out[i].y + out[i + 1].y) / 4;
    }
    for (let i = 1; i < out.length - 1; i++) { out[i].x = res[i].x; out[i].y = res[i].y; }
  }
  return out;
}

/** n points equally spaced along a screen polyline, or null when it is too short (< 36 px) */
export function resample(pts, n) {
  if (!pts || pts.length < 2) return null;
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const L = acc[acc.length - 1];
  if (L < 36) return null;
  const out = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const s = (k / (n - 1)) * L;
    while (j < acc.length - 1 && acc[j] < s) j++;
    const t = (s - acc[j - 1]) / Math.max(1e-6, acc[j] - acc[j - 1]);
    out.push({ x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * t, y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * t });
  }
  return out;
}

function cumulative(P) {
  const a = [0];
  for (let i = 1; i < P.length; i++) a.push(a[i - 1] + P[i].distanceTo(P[i - 1]));
  return a;
}

function sampleAt(P, acc, s) {
  let j = 1;
  while (j < acc.length - 1 && acc[j] < s) j++;
  const t = Math.max(0, Math.min(1, (s - acc[j - 1]) / Math.max(1e-9, acc[j] - acc[j - 1])));
  return new THREE.Vector3().lerpVectors(P[j - 1], P[j], t);
}
