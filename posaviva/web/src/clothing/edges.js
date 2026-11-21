// Edge treatments: extra geometry around the boundary loops of a garment draft
// (rolled hems with visible thickness, rib lips, shirt collars, blazer lapels)
// and small hardware (buttons, rivets, zipper pulls).
//
// Every extra vertex has a `parent` fine vertex: at runtime it moves with the
// parent's wrinkle displacement, so hems and collars follow the folds.
// Extras: {group, pos:number[], parent:number[], uv:number[], tris:number[]} with
// vertex indices local to the extras block.
import { len3 } from './mesh.js';
const PI = Math.PI;

function newExtras(group) { return { group, pos: [], parent: [], uv: [], tris: [], nrmFlat: false }; }

function loopFrames(draft, L, N) {
  const m = L.length, P = draft.P;
  const T = new Float32Array(m * 3), Bv = new Float32Array(m * 3), arc = new Float32Array(m + 1);
  for (let i = 0; i < m; i++) {
    const a = L[(i + m - 1) % m] * 3, b = L[(i + 1) % m] * 3, v = L[i] * 3;
    let tx = P[b] - P[a], ty = P[b + 1] - P[a + 1], tz = P[b + 2] - P[a + 2];
    const tl = len3(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const nx = N[v], ny = N[v + 1], nz = N[v + 2];
    // outward (away from the garment) = t x n
    let bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    const bl = len3(bx, by, bz) || 1;
    T[i * 3] = tx; T[i * 3 + 1] = ty; T[i * 3 + 2] = tz;
    Bv[i * 3] = bx / bl; Bv[i * 3 + 1] = by / bl; Bv[i * 3 + 2] = bz / bl;
    if (i > 0) { const p = L[i - 1] * 3; arc[i] = arc[i - 1] + len3(P[v] - P[p], P[v + 1] - P[p + 1], P[v + 2] - P[p + 2]); }
  }
  const l0 = L[0] * 3, lm = L[m - 1] * 3;
  arc[m] = arc[m - 1] + len3(P[l0] - P[lm], P[l0 + 1] - P[lm + 1], P[l0 + 2] - P[lm + 2]);
  return { T, B: Bv, arc };
}

/**
 * Builds rings of points around a loop and stitches them into a strip.
 * ringFn(i, v, p[3], n[3], b[3], out[3], k) fills the k-th ring point of loop vertex i.
 * open: optional [start, end) range for open strips (collars with a front gap).
 */
function strip(ex, draft, L, N, rings, ringFn, opts = {}) {
  const m = L.length;
  const { arc } = opts.frames;
  const idx = opts.range ? opts.range : null;
  const list = [];
  if (idx) { for (let i = idx[0]; i !== idx[1]; i = (i + 1) % m) list.push(i); list.push(idx[1]); } else { for (let i = 0; i < m; i++) list.push(i); list.push(0); }
  const base = ex.pos.length / 3;
  const P = draft.P, F = opts.frames;
  const p = [0, 0, 0], n = [0, 0, 0], b = [0, 0, 0], o = [0, 0, 0];
  for (let j = 0; j < list.length; j++) {
    const i = list[j], v = L[i];
    p[0] = P[v * 3]; p[1] = P[v * 3 + 1]; p[2] = P[v * 3 + 2];
    n[0] = N[v * 3]; n[1] = N[v * 3 + 1]; n[2] = N[v * 3 + 2];
    b[0] = F.B[i * 3]; b[1] = F.B[i * 3 + 1]; b[2] = F.B[i * 3 + 2];
    const u = j === list.length - 1 && !idx ? arc[m] : arc[i];
    for (let k = 0; k < rings; k++) {
      ringFn(i, v, p, n, b, o, k);
      ex.pos.push(o[0], o[1], o[2]);
      ex.parent.push(v);
      ex.uv.push(u, k * 0.01);
    }
  }
  // quads between consecutive loop samples (CCW seen from outside, see header)
  for (let j = 0; j + 1 < list.length; j++) {
    for (let k = 0; k + 1 < rings; k++) {
      const a = base + j * rings + k, c = base + (j + 1) * rings + k;
      // (E_{i+1}, E_i, A_i, A_{i+1})
      ex.tris.push(c, a, a + 1, c, a + 1, c + 1);
    }
  }
}

/** Rolled hem: the shell curls under the edge so the fabric shows its thickness. */
export function hemExtras(draft, loop, N, spec, group = 0) {
  const ex = newExtras(group);
  const L = loop.verts, frames = loopFrames(draft, L, N);
  const r = spec.r ?? Math.max(0.0012, draft.thick * 0.75);
  const depth = spec.depth ?? 0.01;
  strip(ex, draft, L, N, 4, (i, v, p, n, b, o, k) => {
    const room = Math.max(0.0006, draft.room[v] + draft.off[v] * 0.85 - 0.0012);
    const inn = Math.min(2 * r, room);
    if (k === 0) { o[0] = p[0]; o[1] = p[1]; o[2] = p[2]; return; }
    // k1: rounded tip, k2: under side, k3: back inside
    const bs = k === 1 ? r * 0.85 : k === 2 ? r * 0.35 : -depth;
    const ns = k === 1 ? -inn * 0.45 : -inn;
    o[0] = p[0] + b[0] * bs + n[0] * ns; o[1] = p[1] + b[1] * bs + n[1] * ns; o[2] = p[2] + b[2] * bs + n[2] * ns;
  }, { frames });
  return ex;
}

/**
 * Collar / lapel: optional stand rising past the edge, a fold and a flap
 * lying back over the garment. Parameters may vary around the loop:
 * spec.at(info) -> {stand, flap, lift, skip} where info = {theta (torso angle, 0 front), y, frontness}
 */
export function collarExtras(draft, loop, N, spec, bi, group = 0) {
  const ex = newExtras(group);
  const L = loop.verts, m = L.length, frames = loopFrames(draft, L, N);
  const P = draft.P;
  const prm = [];
  let gapStart = -1;
  for (let i = 0; i < m; i++) {
    const v = L[i];
    const th = draft.coords.thT[v];
    const info = { theta: th, y: P[v * 3 + 1], x: P[v * 3], z: P[v * 3 + 2], bi };
    const q = spec.at(info);
    prm.push(q);
    if (q.skip && gapStart < 0) gapStart = i;
  }
  // open strip over the non-skipped run (single gap at the front) or closed loop
  let range = null;
  if (gapStart >= 0) {
    let e = gapStart;
    while (prm[e].skip) { e = (e + 1) % m; if (e === gapStart) return null; }
    let s = gapStart;
    while (prm[(s + m - 1) % m].skip === false && (s + m - 1) % m !== e) s = (s + m - 1) % m;
    // run from e (first visible after the gap) to the last visible before the gap
    let last = (gapStart + m - 1) % m;
    while (prm[last].skip) last = (last + m - 1) % m;
    range = [e, last];
  }
  const t = spec.thickness ?? Math.max(0.0015, draft.thick);
  strip(ex, draft, L, N, 6, (i, v, p, n, b, o, k) => {
    const q = prm[i];
    const st = q.stand, fl = q.flap, lift = q.lift ?? 0.004;
    // ring layout: 0 base, 1 stand mid, 2 stand top, 3 fold, 4 flap mid, 5 flap edge
    let bs = 0, ns = 0;
    switch (k) {
      case 0: bs = 0; ns = 0; break;
      case 1: bs = st * 0.55; ns = -0.0005; break;
      case 2: bs = st; ns = 0; break;
      case 3: bs = st + t * 0.6; ns = t * 1.6; break;
      case 4: bs = st * 0.4 - fl * 0.35; ns = t * 2.2 + lift * 0.6; break;
      default: bs = -fl + st * 0.15; ns = t * 1.6 + lift * 0.25;
    }
    // stand leans slightly towards the neck axis (hugs the neck)
    const lean = k >= 1 && k <= 3 ? -st * 0.12 * (k / 3) : 0;
    o[0] = p[0] + b[0] * bs + n[0] * (ns + lean);
    o[1] = p[1] + b[1] * bs + n[1] * (ns + lean);
    o[2] = p[2] + b[2] * bs + n[2] * (ns + lean);
  }, { frames, range });
  return ex;
}

/** Small disc (button / rivet / snap) on the surface at fine vertex v. */
export function discExtras(ex, draft, v, N, radius, height, segs = 12) {
  const P = draft.P;
  const p = [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]], n = [N[v * 3], N[v * 3 + 1], N[v * 3 + 2]];
  // tangent frame
  let ax = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let tx = ax[1] * n[2] - ax[2] * n[1], ty = ax[2] * n[0] - ax[0] * n[2], tz = ax[0] * n[1] - ax[1] * n[0];
  const tl = len3(tx, ty, tz) || 1;
  tx /= tl; ty /= tl; tz /= tl;
  const sx = n[1] * tz - n[2] * ty, sy = n[2] * tx - n[0] * tz, sz = n[0] * ty - n[1] * tx;
  const base = ex.pos.length / 3;
  const lift0 = 0.0004, lift1 = height;
  // center top
  ex.pos.push(p[0] + n[0] * (lift1 + 0.0004), p[1] + n[1] * (lift1 + 0.0004), p[2] + n[2] * (lift1 + 0.0004));
  ex.parent.push(v); ex.uv.push(0, 0);
  for (let s = 0; s < segs; s++) {
    const a = (s / segs) * 2 * PI, c = Math.cos(a) * radius, si = Math.sin(a) * radius;
    for (const [h, rr] of [[lift1, 0.86], [lift1 * 0.7, 1], [lift0, 1]]) {
      ex.pos.push(p[0] + (tx * c + sx * si) * rr + n[0] * h, p[1] + (ty * c + sy * si) * rr + n[1] * h, p[2] + (tz * c + sz * si) * rr + n[2] * h);
      ex.parent.push(v); ex.uv.push(0, 0);
    }
  }
  for (let s = 0; s < segs; s++) {
    const a = base + 1 + s * 3, b = base + 1 + ((s + 1) % segs) * 3;
    ex.tris.push(base, a, b);
    ex.tris.push(a, a + 1, b + 1, a, b + 1, b);
    ex.tris.push(a + 1, a + 2, b + 2, a + 1, b + 2, b + 1);
  }
}

/** Nearest fine vertex (rest position) to a point, optionally restricted by a predicate. */
export function nearestVertex(draft, x, y, z, pred) {
  const P = draft.P;
  let best = -1, bd = Infinity;
  for (let i = 0; i < draft.nf; i++) {
    if (pred && !pred(i)) continue;
    const d = (P[i * 3] - x) ** 2 + (P[i * 3 + 1] - y) ** 2 + (P[i * 3 + 2] - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export { newExtras };
