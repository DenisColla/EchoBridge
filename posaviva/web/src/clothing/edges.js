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
    // normals: per loop sample (smoothed frames) or per fine vertex
    const q = opts.loopN ? i : v;
    n[0] = N[q * 3]; n[1] = N[q * 3 + 1]; n[2] = N[q * 3 + 2];
    b[0] = F.B[i * 3]; b[1] = F.B[i * 3 + 1]; b[2] = F.B[i * 3 + 2];
    const u = j === list.length - 1 && !idx ? arc[m] : arc[i];
    // uv: arc length along the loop x arc length across the rings (metric, like the main surface)
    let vv = 0, px = 0, py = 0, pz = 0;
    for (let k = 0; k < rings; k++) {
      ringFn(i, v, p, n, b, o, k);
      if (k > 0) vv += len3(o[0] - px, o[1] - py, o[2] - pz);
      px = o[0]; py = o[1]; pz = o[2];
      ex.pos.push(o[0], o[1], o[2]);
      ex.parent.push(v);
      ex.uv.push(u, vv);
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

/** Deepest turn-up of a rolled hem (m): see hemExtras. */
const HEM_TURN_MAX = 0.007;

/**
 * Rolled hem: the shell curls under the edge so the fabric shows its thickness
 * (rings: edge, rounded tip, under side, turn-up inside). The whole strip rides
 * its edge vertex (rigid offsets from it, frames smoothed along the loop): a
 * turn-up reaching centimetres inside and parented to vertices up there twisted
 * the strip through the outer surface whenever the edge and those vertices moved
 * differently (a hem lying on trousers: light / dark teeth while walking). The
 * turn-up stays within a few millimetres of the edge, where the main surface
 * moves with the edge (folds fade out at a hem).
 */
export function hemExtras(draft, loop, N, spec, group = 0) {
  const ex = newExtras(group);
  const L = loop.verts, F = smoothLoop(draft, L, N, 3, () => 0);
  const frames = { T: F.T, B: F.B, arc: F.arc, N: F.N };
  const r = spec.r ?? Math.max(0.0012, draft.thick * 0.75);
  const depth = Math.min(spec.depth ?? 0.01, Math.max(HEM_TURN_MAX * 0.6, 2.5 * r), HEM_TURN_MAX);
  strip(ex, draft, L, F.N, 4, (i, v, p, n, b, o, k) => {
    const room = Math.max(0.0006, draft.room[v] + draft.off[v] * 0.85 - 0.0012);
    const inn = Math.min(2 * r, room);
    if (k === 0) { o[0] = p[0]; o[1] = p[1]; o[2] = p[2]; return; }
    // k1: rounded tip, k2: under side, k3: back inside
    const bs = k === 1 ? r * 0.85 : k === 2 ? r * 0.35 : -depth;
    const ns = k === 1 ? -inn * 0.45 : -inn;
    o[0] = p[0] + b[0] * bs + n[0] * ns; o[1] = p[1] + b[1] * bs + n[1] * ns; o[2] = p[2] + b[2] * bs + n[2] * ns;
  }, { frames, loopN: true });
  return ex;
}

/**
 * Loop samples smoothed along the loop: positions (Taubin pairs: no shrinking),
 * normals, tangents and the outward direction b = t x n (re-orthogonalised).
 * The fine boundary zigzags a little; a collar or lapel built on the raw frames
 * amplifies that into a torn outer edge (a 5 cm flap turns a 10 degree wobble
 * of b into a 9 mm tooth). keep(i) 0..1: share of the smoothing loop vertex i
 * takes (0 = stays on the loop: the sharp bottom of a V neck).
 */
function smoothLoop(draft, L, N, passes, keep) {
  const m = L.length, P = draft.P;
  const S = new Float32Array(m * 3), Nn = new Float32Array(m * 3), tmp = new Float32Array(m * 3);
  for (let i = 0; i < m; i++) for (let c = 0; c < 3; c++) { S[i * 3 + c] = P[L[i] * 3 + c]; Nn[i * 3 + c] = N[L[i] * 3 + c]; }
  for (let it = 0; it < passes * 2; it++) {
    const k = it & 1 ? -0.53 : 0.5;
    for (let i = 0; i < m; i++) {
      const a = ((i + m - 1) % m) * 3, b = ((i + 1) % m) * 3, o = i * 3;
      for (let c = 0; c < 3; c++) tmp[o + c] = S[o + c] + k * ((S[a + c] + S[b + c]) * 0.5 - S[o + c]);
    }
    S.set(tmp);
  }
  for (let it = 0; it < passes; it++) {
    for (let i = 0; i < m; i++) {
      const a = ((i + m - 1) % m) * 3, b = ((i + 1) % m) * 3, o = i * 3;
      for (let c = 0; c < 3; c++) tmp[o + c] = Nn[o + c] * 0.5 + (Nn[a + c] + Nn[b + c]) * 0.25;
    }
    for (let i = 0; i < m; i++) { const o = i * 3, l = len3(tmp[o], tmp[o + 1], tmp[o + 2]) || 1; Nn[o] = tmp[o] / l; Nn[o + 1] = tmp[o + 1] / l; Nn[o + 2] = tmp[o + 2] / l; }
  }
  if (keep) for (let i = 0; i < m; i++) { const w = keep(i), v = L[i] * 3; for (let c = 0; c < 3; c++) S[i * 3 + c] = P[v + c] + (S[i * 3 + c] - P[v + c]) * w; }
  const T = new Float32Array(m * 3), B = new Float32Array(m * 3), arc = new Float32Array(m + 1);
  for (let i = 0; i < m; i++) {
    const a = ((i + m - 1) % m) * 3, b = ((i + 1) % m) * 3, o = i * 3;
    let tx = S[b] - S[a], ty = S[b + 1] - S[a + 1], tz = S[b + 2] - S[a + 2];
    const tl = len3(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const nx = Nn[o], ny = Nn[o + 1], nz = Nn[o + 2];
    let bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
    const bl = len3(bx, by, bz) || 1;
    bx /= bl; by /= bl; bz /= bl;
    T[o] = tx; T[o + 1] = ty; T[o + 2] = tz;
    B[o] = bx; B[o + 1] = by; B[o + 2] = bz;
    // n = b x t (unit, orthogonal to both)
    Nn[o] = by * tz - bz * ty; Nn[o + 1] = bz * tx - bx * tz; Nn[o + 2] = bx * ty - by * tx;
    if (i > 0) arc[i] = arc[i - 1] + len3(S[o] - S[o - 3], S[o + 1] - S[o - 2], S[o + 2] - S[o - 1]);
  }
  arc[m] = arc[m - 1] + len3(S[0] - S[(m - 1) * 3], S[1] - S[(m - 1) * 3 + 1], S[2] - S[(m - 1) * 3 + 2]);
  return { S, T, B, N: Nn, arc };
}

/** Spatial hash of the fine vertices of a draft (cached on the draft). */
const GRID_CELL = 0.035;
const gridKey = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
function surfaceGrid(draft) {
  if (draft._sgrid) return draft._sgrid;
  const P = draft.P, map = new Map();
  for (let i = 0; i < draft.nf; i++) {
    const k = gridKey(Math.floor(P[i * 3] / GRID_CELL), Math.floor(P[i * 3 + 1] / GRID_CELL), Math.floor(P[i * 3 + 2] / GRID_CELL));
    let a = map.get(k);
    if (!a) map.set(k, (a = []));
    a.push(i);
  }
  draft._sgrid = map;
  return map;
}

/**
 * Fine vertex of the garment surface closest to point x (within maxD), whose
 * normal agrees with n (not the far side of a sleeve or of the neck opening).
 */
function nearestSurface(draft, N, x, y, z, nx, ny, nz, maxD = GRID_CELL) {
  const map = surfaceGrid(draft), P = draft.P;
  const cx = Math.floor(x / GRID_CELL), cy = Math.floor(y / GRID_CELL), cz = Math.floor(z / GRID_CELL);
  let best = maxD * maxD, bi = -1;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const a = map.get(gridKey(cx + dx, cy + dy, cz + dz));
    if (!a) continue;
    for (const i of a) {
      const ex = P[i * 3] - x, ey = P[i * 3 + 1] - y, ez = P[i * 3 + 2] - z;
      const d2 = ex * ex + ey * ey + ez * ez;
      if (d2 >= best || N[i * 3] * nx + N[i * 3 + 1] * ny + N[i * 3 + 2] * nz < 0.25) continue;
      best = d2; bi = i;
    }
  }
  return bi;
}

const smooth01 = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Stand lean towards the neck (m per m of stand height): the band hugs the neck. */
const STAND_LEAN = 0.08;
/** Share of the stand direction turned from the surface tangent to the vertical (collars rise along the neck). */
const STAND_UP = 0.75;
/** Flap samples (share of the flap length from the fold). */
const FLAP_U = [0.4, 0.75, 1];

/**
 * Collar / lapel: a stand rising past the edge, a fold and a flap lying back
 * over the garment, built as ONE closed profile of fabric with thickness
 * (stand outside -> fold inside -> flap underside -> flap edge -> flap top ->
 * fold outside -> stand inside, tucked under the edge), so every face that can
 * be seen is a front face with an outward normal (an inside-out flap reads
 * dark: the shadow lookup is offset along the vertex normal, into the cloth).
 * The flap lies ON the garment: points beyond the edge are projected onto the
 * surface under them (+ a small gap) and move with that surface (its folds and
 * skin), so a lapel follows the chest instead of cutting through it.
 * Parameters may vary around the loop:
 * spec.at(info) -> {stand, flap, lift, skip} where info = {theta (torso angle, 0 front), y, x, z, bi}
 * spec: {thickness, roll (fold radius, m), smooth (passes over the parameters)}
 * stand 0 everywhere and no flap: a plain stand-up collar (funnel neck).
 */
export function collarExtras(draft, loop, N, spec, bi, group = 0) {
  const ex = newExtras(group);
  const L = loop.verts, m = L.length;
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
    let last = (gapStart + m - 1) % m;
    while (prm[last].skip) last = (last + m - 1) % m;
    range = [e, last];
  }
  // parameters smoothed along the loop (the boundary wanders a little in height)
  const st = new Float32Array(m), fl = new Float32Array(m), lf = new Float32Array(m), tmp = new Float32Array(m);
  for (let i = 0; i < m; i++) { st[i] = prm[i].stand || 0; fl[i] = prm[i].flap || 0; lf[i] = prm[i].lift ?? 0.004; }
  for (let pass = 0, np = spec.smooth ?? 2; pass < np; pass++) {
    for (const a of [st, fl, lf]) {
      for (let i = 0; i < m; i++) {
        const p = (i + m - 1) % m, q = (i + 1) % m;
        tmp[i] = prm[i].skip ? a[i] : a[i] * 0.5 + ((prm[p].skip ? a[i] : a[p]) + (prm[q].skip ? a[i] : a[q])) * 0.25;
      }
      a.set(tmp);
    }
  }
  let maxFl = 0;
  for (let i = 0; i < m; i++) if (!prm[i].skip && fl[i] > maxFl) maxFl = fl[i];
  const fold = maxFl > 0.004;
  const t = spec.thickness ?? Math.max(0.0015, draft.thick);
  const rF0 = Math.max(0.0018, t * 0.9, spec.roll || 0);
  const F = smoothLoop(draft, L, N, 6, (i) => Math.min(1, (st[i] + fl[i]) / 0.03));
  const list = [];
  if (range) { for (let i = range[0]; i !== range[1]; i = (i + 1) % m) list.push(i); list.push(range[1]); } else { for (let i = 0; i < m; i++) list.push(i); list.push(0); }
  const nr = fold ? 9 + 2 * FLAP_U.length : 7;
  const base = ex.pos.length / 3;
  const R = new Float32Array(nr * 3), RP = new Int32Array(nr);
  const O = [0, 0, 0], Bd = [0, 0, 0], Nd = [0, 0, 0];
  const at = (b, n, k, par) => {
    R[k * 3] = O[0] + Bd[0] * b + Nd[0] * n; R[k * 3 + 1] = O[1] + Bd[1] * b + Nd[1] * n; R[k * 3 + 2] = O[2] + Bd[2] * b + Nd[2] * n;
    RP[k] = par;
  };
  const Q = [0, 0, 0], up = [0, 0, 0];
  for (let j = 0; j < list.length; j++) {
    const i = list[j], v = L[i], o = i * 3;
    const s = st[i], f = fl[i], lift = lf[i];
    const tx = F.T[o], ty = F.T[o + 1], tz = F.T[o + 2];
    O[0] = F.S[o]; O[1] = F.S[o + 1]; O[2] = F.S[o + 2];
    // stand direction: from the surface tangent b towards the vertical (a
    // collar band rises along the neck; a lapel, with no stand, folds over
    // the chest along -b)
    const al = STAND_UP * smooth01(0, 0.02, s);
    let ux = -ty * tx, uy = 1 - ty * ty, uz = -ty * tz;
    const ul = len3(ux, uy, uz);
    if (ul > 0.2) { ux /= ul; uy /= ul; uz /= ul; } else { ux = F.B[o]; uy = F.B[o + 1]; uz = F.B[o + 2]; }
    if (ux * F.B[o] + uy * F.B[o + 1] + uz * F.B[o + 2] < 0) { ux = F.B[o]; uy = F.B[o + 1]; uz = F.B[o + 2]; }
    Bd[0] = F.B[o] * (1 - al) + ux * al; Bd[1] = F.B[o + 1] * (1 - al) + uy * al; Bd[2] = F.B[o + 2] * (1 - al) + uz * al;
    const bl = len3(Bd[0], Bd[1], Bd[2]) || 1;
    Bd[0] /= bl; Bd[1] /= bl; Bd[2] /= bl;
    // n' = b' x t
    Nd[0] = Bd[1] * tz - Bd[2] * ty; Nd[1] = Bd[2] * tx - Bd[0] * tz; Nd[2] = Bd[0] * ty - Bd[1] * tx;
    const nl = len3(Nd[0], Nd[1], Nd[2]) || 1;
    Nd[0] /= nl; Nd[1] /= nl; Nd[2] /= nl;
    const room = draft.room ? Math.max(0.0006, draft.room[v] + draft.off[v] * 0.85 - 0.0012) : t;
    const tIn = Math.min(t, room);
    const lean = (b) => -STAND_LEAN * b;
    const top = lean(s);
    // stand, outside (ring 0 is the garment edge itself: no gap at the seam)
    R[0] = P[v * 3]; R[1] = P[v * 3 + 1]; R[2] = P[v * 3 + 2]; RP[0] = v;
    at(s * 0.5, lean(s * 0.5), 1, v);
    at(s, top, 2, v);
    let k = 3;
    if (fold) {
      const rF = rF0;
      at(s + rF, top + rF, k++, v); // inside of the fold
      // flap underside (u = share of the flap from the fold), then its edge and its top
      const under = [], ups = [], pars = [];
      for (const u of FLAP_U) {
        const b = s - f * u;
        const n = (b >= 0 ? lean(b) : 0) + 2 * rF;
        Q[0] = O[0] + Bd[0] * b + Nd[0] * n; Q[1] = O[1] + Bd[1] * b + Nd[1] * n; Q[2] = O[2] + Bd[2] * b + Nd[2] * n;
        up[0] = Nd[0]; up[1] = Nd[1]; up[2] = Nd[2];
        let par = v;
        const w = smooth01(0.002, 0.015, -b);
        if (w > 0) {
          // lay it on the garment surface under it
          const sv = nearestSurface(draft, N, Q[0], Q[1], Q[2], Nd[0], Nd[1], Nd[2]);
          if (sv >= 0) {
            const nx = N[sv * 3], ny = N[sv * 3 + 1], nz = N[sv * 3 + 2];
            const h = (Q[0] - P[sv * 3]) * nx + (Q[1] - P[sv * 3 + 1]) * ny + (Q[2] - P[sv * 3 + 2]) * nz;
            const gap = 0.0012 + lift * 0.4 * (1 - u);
            Q[0] += nx * (gap - h) * w; Q[1] += ny * (gap - h) * w; Q[2] += nz * (gap - h) * w;
            up[0] = Nd[0] * (1 - w) + nx * w; up[1] = Nd[1] * (1 - w) + ny * w; up[2] = Nd[2] * (1 - w) + nz * w;
            const l = len3(up[0], up[1], up[2]) || 1;
            up[0] /= l; up[1] /= l; up[2] /= l;
            if (w > 0.5) par = sv;
          }
        }
        under.push(Q[0], Q[1], Q[2]); ups.push(up[0], up[1], up[2]); pars.push(par);
      }
      const nu = FLAP_U.length;
      for (let q = 0; q < nu; q++) { R[k * 3] = under[q * 3]; R[k * 3 + 1] = under[q * 3 + 1]; R[k * 3 + 2] = under[q * 3 + 2]; RP[k++] = pars[q]; }
      // rounded flap edge: half a thickness past the last sample, mid-height
      {
        const a = (nu - 2) * 3, b = (nu - 1) * 3;
        let dx = under[b] - under[a], dy = under[b + 1] - under[a + 1], dz = under[b + 2] - under[a + 2];
        const dl = len3(dx, dy, dz) || 1;
        dx /= dl; dy /= dl; dz /= dl;
        R[k * 3] = under[b] + dx * t * 0.5 + ups[b] * t * 0.5; R[k * 3 + 1] = under[b + 1] + dy * t * 0.5 + ups[b + 1] * t * 0.5; R[k * 3 + 2] = under[b + 2] + dz * t * 0.5 + ups[b + 2] * t * 0.5;
        RP[k++] = pars[nu - 1];
      }
      for (let q = nu - 1; q >= 0; q--) {
        R[k * 3] = under[q * 3] + ups[q * 3] * t; R[k * 3 + 1] = under[q * 3 + 1] + ups[q * 3 + 1] * t; R[k * 3 + 2] = under[q * 3 + 2] + ups[q * 3 + 2] * t;
        RP[k++] = pars[q];
      }
      at(s + rF + t, top + rF, k++, v); // outside of the fold
    } else at(s + t * 0.5, top - t * 0.5, k++, v); // rounded top of a plain stand
    // stand, inside (facing the neck), tucked under the garment edge
    at(s, top - t, k++, v);
    at(s * 0.5, lean(s * 0.5) - t, k++, v);
    at(0, -tIn, k++, v);
    // emit the ring (uv: arc length along the loop x arc length across the profile)
    const uu = j === list.length - 1 && !range ? F.arc[m] : F.arc[i];
    let vv = 0;
    for (let q = 0; q < nr; q++) {
      if (q > 0) vv += len3(R[q * 3] - R[q * 3 - 3], R[q * 3 + 1] - R[q * 3 - 2], R[q * 3 + 2] - R[q * 3 - 1]);
      ex.pos.push(R[q * 3], R[q * 3 + 1], R[q * 3 + 2]);
      ex.parent.push(RP[q]);
      ex.uv.push(uu, vv);
    }
  }
  // quads between consecutive samples: the profile runs clockwise in the
  // (b, n) plane, so the winding of strip() puts every normal outside
  for (let j = 0; j + 1 < list.length; j++) {
    for (let k = 0; k + 1 < nr; k++) {
      const a = base + j * nr + k, c = base + (j + 1) * nr + k;
      ex.tris.push(c, a, a + 1, c, a + 1, c + 1);
    }
  }
  // an open collar (shirt points) is closed at both ends
  if (range) {
    capProfile(ex, base, nr, -1, F.T, list[0] * 3);
    capProfile(ex, base + (list.length - 1) * nr, nr, 1, F.T, list[list.length - 1] * 3);
  }
  return ex;
}

/** Closes the profile polygon of ring block r0 (nr points) with a fan facing sign * t. */
function capProfile(ex, r0, nr, sign, T, o) {
  const pos = ex.pos;
  let cx = 0, cy = 0, cz = 0;
  for (let k = 0; k < nr; k++) { cx += pos[(r0 + k) * 3]; cy += pos[(r0 + k) * 3 + 1]; cz += pos[(r0 + k) * 3 + 2]; }
  cx /= nr; cy /= nr; cz /= nr;
  const c = pos.length / 3;
  pos.push(cx, cy, cz);
  ex.parent.push(ex.parent[r0]);
  ex.uv.push(ex.uv[r0 * 2], ex.uv[r0 * 2 + 1]);
  // orientation of the fan (Newell): flip to face along sign * t
  let nx = 0, ny = 0, nz = 0;
  for (let k = 0; k < nr; k++) {
    const a = (r0 + k) * 3, b = (r0 + ((k + 1) % nr)) * 3;
    nx += (pos[a + 1] - pos[b + 1]) * (pos[a + 2] + pos[b + 2]);
    ny += (pos[a + 2] - pos[b + 2]) * (pos[a] + pos[b]);
    nz += (pos[a] - pos[b]) * (pos[a + 1] + pos[b + 1]);
  }
  const flip = (nx * T[o] + ny * T[o + 1] + nz * T[o + 2]) * sign < 0;
  for (let k = 0; k < nr; k++) {
    const a = r0 + k, b = r0 + ((k + 1) % nr);
    if (flip) ex.tris.push(c, b, a); else ex.tris.push(c, a, b);
  }
}

/**
 * Points along the garment surface where it crosses the vertical plane x = x0
 * on the front of the torso, from height yTop down to yBot, about `step` m
 * apart (crossings binned by height, then smoothed). Returns [[x, y, z], ...].
 */
export function frontLine(draft, x0, yTop, yBot, step = 0.015) {
  const P = draft.P, Q = draft.quads, nq = Q.length >> 2, N = draft.N;
  const nb = Math.max(2, Math.ceil((yTop - yBot) / step));
  const acc = new Float64Array(nb * 4);
  for (let q = 0; q < nq; q++) for (let k = 0; k < 4; k++) {
    const a = Q[q * 4 + k], b = Q[q * 4 + ((k + 1) & 3)];
    if (a > b) continue; // each edge once (both quads list it)
    const xa = P[a * 3] - x0, xb = P[b * 3] - x0;
    if ((xa < 0) === (xb < 0)) continue;
    if (N[a * 3 + 2] + N[b * 3 + 2] < 0.6) continue; // the front only
    const t = xa / (xa - xb);
    const y = P[a * 3 + 1] + (P[b * 3 + 1] - P[a * 3 + 1]) * t;
    if (y > yTop || y < yBot) continue;
    const bin = Math.min(nb - 1, Math.floor((yTop - y) / step));
    acc[bin * 4] += x0; acc[bin * 4 + 1] += y; acc[bin * 4 + 2] += P[a * 3 + 2] + (P[b * 3 + 2] - P[a * 3 + 2]) * t; acc[bin * 4 + 3]++;
  }
  const pts = [];
  for (let i = 0; i < nb; i++) if (acc[i * 4 + 3]) pts.push([acc[i * 4] / acc[i * 4 + 3], acc[i * 4 + 1] / acc[i * 4 + 3], acc[i * 4 + 2] / acc[i * 4 + 3]]);
  for (let it = 0; it < 2; it++) for (let i = 1; i + 1 < pts.length; i++) pts[i][2] = pts[i][2] * 0.5 + (pts[i - 1][2] + pts[i + 1][2]) * 0.25;
  return pts;
}

/**
 * Raised band lying on the garment along a surface polyline (shirt placket,
 * the overlapping front edge of a jacket): a flat top `height` above the
 * surface, `width` wide, bevelled sides. Every point is laid on the surface
 * under it and moves with that vertex (its folds and skin), like the lapels.
 */
export function ridgeExtras(ex, draft, N, pts, width, height) {
  const m = pts.length;
  if (m < 2) return;
  const P = draft.P, hw = width * 0.5, bev = Math.min(hw * 0.5, height * 1.5 + 0.0008);
  const prof = [[-hw, 0], [-hw + bev, height], [hw - bev, height], [hw, 0]];
  const nr = prof.length, base = ex.pos.length / 3;
  let arc = 0;
  for (let j = 0; j < m; j++) {
    const c = pts[j], a = pts[Math.max(0, j - 1)], b = pts[Math.min(m - 1, j + 1)];
    if (j > 0) arc += len3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = len3(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    const sv = nearestSurface(draft, N, c[0], c[1], c[2], 0, 0, 1, 0.03);
    let nx = 0, ny = 0, nz = 1;
    if (sv >= 0) { nx = N[sv * 3]; ny = N[sv * 3 + 1]; nz = N[sv * 3 + 2]; }
    // side direction d = t x n (the profile runs along +d: outward normals, see strip())
    let dx = ty * nz - tz * ny, dy = tz * nx - tx * nz, dz = tx * ny - ty * nx;
    const dl = len3(dx, dy, dz) || 1;
    dx /= dl; dy /= dl; dz /= dl;
    let vv = 0, px = 0, py = 0, pz = 0;
    for (let k = 0; k < nr; k++) {
      const [s, h] = prof[k];
      let x = c[0] + dx * s, y = c[1] + dy * s, z = c[2] + dz * s;
      const q = nearestSurface(draft, N, x, y, z, nx, ny, nz, 0.03);
      const par = q >= 0 ? q : sv >= 0 ? sv : nearestVertex(draft, x, y, z);
      if (par >= 0) {
        const qx = N[par * 3], qy = N[par * 3 + 1], qz = N[par * 3 + 2];
        const d = (x - P[par * 3]) * qx + (y - P[par * 3 + 1]) * qy + (z - P[par * 3 + 2]) * qz;
        x += qx * (h + 0.0003 - d); y += qy * (h + 0.0003 - d); z += qz * (h + 0.0003 - d);
      }
      if (k > 0) vv += len3(x - px, y - py, z - pz);
      px = x; py = y; pz = z;
      ex.pos.push(x, y, z);
      ex.parent.push(par);
      ex.uv.push(vv, arc);
    }
  }
  for (let j = 0; j + 1 < m; j++) for (let k = 0; k + 1 < nr; k++) {
    const a = base + j * nr + k, c = base + (j + 1) * nr + k;
    ex.tris.push(c, a, a + 1, c, a + 1, c + 1);
  }
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
