// Strand growth: integrates a clump centre line from a scalp root.
//
// On the scalp the direction follows the style's flow field (combing) with
// some inertia, and every point is kept at a layer offset above the head hull;
// the offset grows with the distance travelled, so hair from far roots lies
// on top of hair from near roots (natural layering, no scalp showing). Once a
// strand drops below the hang line it falls with gravity (plus a small
// forward/backward bias) and is pushed out of the body colliders, which drapes
// long hair over shoulders and back. Points before the hang line are rigid
// (attached to the head); the rest is simulated by the GuideSolver.
import { pushHead } from './physics.js';
import { len3 } from './util.js';

const _f = [0, 0, 0], _d = [0, 0, 0], _u = [0, 0, 0], _n = [0, 0, 0], _q = [0, 0, 0], _p = [0, 0, 0];

export class Grower {
  /**
   * @param {import('./headmap.js').HeadMap} map
   * @param {object} frame headFrame()
   * @param {import('./physics.js').BodyColliders} colliders (rest pose)
   */
  constructor(map, frame, colliders) {
    this.map = map;
    this.frame = frame;
    this.col = colliders;
    this.c = [frame.c.x, frame.c.y, frame.c.z];
    this.s = frame.s;
  }

  /** Unit direction from the head centre to point p (3-array) -> out. */
  dirOf(p, out) {
    const c = this.c;
    out[0] = p[0] - c[0]; out[1] = p[1] - c[1]; out[2] = p[2] - c[2];
    const l = len3(out[0], out[1], out[2]) || 1;
    out[0] /= l; out[1] /= l; out[2] /= l;
    return out;
  }

  /** Point on the skin (raw head map) along unit u, raised by h (m) -> out. */
  surface(u, h, out) {
    const r = this.map.radius(u[0], u[1], u[2], this.map.raw);
    const c = this.c;
    out[0] = c[0] + u[0] * (r + h); out[1] = c[1] + u[1] * (r + h); out[2] = c[2] + u[2] * (r + h);
    return out;
  }

  /**
   * Grows one strand.
   * o: {K, L, lift, stiff, flow(p,u,t,out), h0, hk, hMax | height(t), hug, tipLift(t), rootDepth,
   *     hang?: {y (m below c), dir(p,out), stiff}, rad (collision radius), target?: [x,y,z]}
   * Returns {pts: Float32Array(K*3), pin}.
   */
  grow(u0, o) {
    const K = o.K, seg = o.L / (K - 1), c = this.c, map = this.map, col = this.col;
    const pts = new Float32Array(K * 3);
    const p = this.surface(u0, -(o.rootDepth ?? 0.0012 * this.s), _p);
    pts[0] = p[0]; pts[1] = p[1]; pts[2] = p[2];
    map.normal(u0, _n);
    o.flow(p, u0, 0, _f);
    // root direction: lift off the scalp + comb direction (tangent part)
    let dn = _f[0] * _n[0] + _f[1] * _n[1] + _f[2] * _n[2];
    _f[0] -= dn * _n[0]; _f[1] -= dn * _n[1]; _f[2] -= dn * _n[2];
    norm(_f);
    const lift = o.lift ?? 0.2;
    _d[0] = _n[0] * lift + _f[0] * (1 - lift); _d[1] = _n[1] * lift + _f[1] * (1 - lift); _d[2] = _n[2] * lift + _f[2] * (1 - lift);
    norm(_d);
    let pin = K, hanging = false, travel = 0, contact = false;
    const hangY = o.hang ? c[1] - o.hang.y : -1e9;
    for (let k = 1; k < K; k++) {
      const t = k / (K - 1);
      this.dirOf(p, _u);
      const wasContact = contact;
      contact = false;
      let stiff = o.stiff ?? 0.5;
      if (o.hang && !hanging && p[1] < hangY) { hanging = true; pin = Math.max(2, k); }
      if (hanging) {
        o.hang.dir(p, _f);
        stiff = o.hang.stiff ?? 0.75;
        // resting on shoulders / arms: fall off towards the drape side (front or back), never along the arm
        if (wasContact) { norm(_f); _f[2] += o.hang.drape * 2.2; _f[1] -= 0.1; _f[0] -= Math.sign(p[0]) * 1.1; stiff *= 0.35; }
      }
      else o.flow(p, _u, t, _f);
      norm(_f);
      _d[0] = _d[0] * stiff + _f[0] * (1 - stiff); _d[1] = _d[1] * stiff + _f[1] * (1 - stiff); _d[2] = _d[2] * stiff + _f[2] * (1 - stiff);
      norm(_d);
      _q[0] = p[0] + _d[0] * seg; _q[1] = p[1] + _d[1] * seg; _q[2] = p[2] + _d[2] * seg;
      const h = o.height ? o.height(t) : Math.min(o.hMax, o.h0 + o.hk * travel);
      const low = _q[1] < c[1] - 0.03 * this.s;
      for (let pass = 0; pass < 2; pass++) {
        if (o.hug && !hanging) hugHead(map, _q, h + (o.tipLift ? o.tipLift(t) : 0));
        else pushHead(map, _q[0], _q[1], _q[2], h, _q, 0);
        if ((low || hanging) && col.push(_q[0], _q[1], _q[2], o.rad ?? 0.004, _q, 0) && hanging && o.hang.drape) contact = true;
        if (pass === 0) { // keep the segment length
          let dx = _q[0] - p[0], dy = _q[1] - p[1], dz = _q[2] - p[2];
          const l = len3(dx, dy, dz) || 1;
          _q[0] = p[0] + (dx / l) * seg; _q[1] = p[1] + (dy / l) * seg; _q[2] = p[2] + (dz / l) * seg;
        }
      }
      if (o.target && k === K - 1) { _q[0] = o.target[0]; _q[1] = o.target[1]; _q[2] = o.target[2]; }
      _d[0] = _q[0] - p[0]; _d[1] = _q[1] - p[1]; _d[2] = _q[2] - p[2];
      norm(_d);
      p[0] = _q[0]; p[1] = _q[1]; p[2] = _q[2];
      pts[k * 3] = p[0]; pts[k * 3 + 1] = p[1]; pts[k * 3 + 2] = p[2];
      travel += seg;
    }
    return { pts, pin };
  }
}

/** Places q exactly at the layer offset h above the hull (short hair hugs the head shape). */
function hugHead(map, q, h) {
  const c = map.c;
  const dx = q[0] - c.x, dy = q[1] - c.y, dz = q[2] - c.z;
  const r = len3(dx, dy, dz) || 1e-9;
  const rh = map.radius(dx, dy, dz);
  if (rh <= 0) return;
  const k = (rh + h) / r;
  q[0] = c.x + dx * k; q[1] = c.y + dy * k; q[2] = c.z + dz * k;
}

function norm(v) {
  const l = len3(v[0], v[1], v[2]);
  if (l > 1e-12) { v[0] /= l; v[1] /= l; v[2] /= l; }
  return v;
}

/** Tangential part of v at unit direction u (sphere approximation), in place. */
export function tangent(v, u) {
  const d = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
  v[0] -= d * u[0]; v[1] -= d * u[1]; v[2] -= d * u[2];
  return v;
}
