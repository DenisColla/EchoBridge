// Roofs for rectangular footprints (gable, hip, pyramid, mansard with dormers,
// shed) and any footprint (flat roof with parapet). Pitched roofs are real
// slabs: tiled top, soffit underneath, fascia / rake boards on the edges,
// gable walls in the facade material, ridge caps. Rooftop clutter is in
// rooftop.js.
import { inset } from './kit.js';
import { wallWithHoles, windowAt } from './parts.js';

const DEG = Math.PI / 180;

/**
 * o = {cx, cz, W, D, y (wall top), pitch (deg), oh (eave overhang), rake (gable overhang),
 *      axis: 'x' (ridge along x) | 'z', t (thickness)}
 * M = {top, under, edge, gable, ridge}
 * Returns the ridge height.
 */
export function gableRoof(b, M, o) {
  const alongX = (o.axis || (o.W >= o.D ? 'x' : 'z')) === 'x';
  const A = (alongX ? o.W : o.D) / 2, B = (alongX ? o.D : o.W) / 2;
  const p = (o.pitch ?? 30) * DEG, tp = Math.tan(p), t = o.t ?? 0.22, tt = t / Math.cos(p);
  const oh = o.oh ?? 0.5, rake = o.rake ?? 0.35, y = o.y;
  b.push().translate(o.cx || 0, 0, o.cz || 0).rotateY(alongX ? 0 : Math.PI / 2);
  const ze = B + oh, xe = A + rake, yE = y - oh * tp, yR = y + B * tp;
  for (const s of [1, -1]) {
    b.quad(M.top, [-xe, yE + tt, s * ze], [xe, yE + tt, s * ze], [xe, yR + tt, 0], [-xe, yR + tt, 0], null, [0, 1, s * tp]);
    b.quad(M.under, [-xe, yE, s * ze], [xe, yE, s * ze], [xe, yR, 0], [-xe, yR, 0], null, [0, -1, -s * tp]);
    b.quad(M.edge, [-xe, yE, s * ze], [xe, yE, s * ze], [xe, yE + tt, s * ze], [-xe, yE + tt, s * ze], null, [0, 0, s]);
    for (const e of [1, -1]) b.quad(M.edge, [e * xe, yE, s * ze], [e * xe, yR, 0], [e * xe, yR + tt, 0], [e * xe, yE + tt, s * ze], null, [e, 0, 0]);
  }
  if (M.gable) for (const e of [1, -1]) b.tri(M.gable, [e * A, y - 0.001, B], [e * A, y - 0.001, -B], [e * A, yR, 0], [e, 0, 0]);
  if (M.ridge) {
    b.push().translate(0, yR + tt - 0.03, 0).rotateX(Math.PI / 4);
    b.box(M.ridge, -xe - 0.02, -0.1, -0.1, xe + 0.02, 0.1, 0.1, 0);
    b.pop();
  }
  if (M.gutter) for (const s of [1, -1]) b.box(M.gutter, -xe, yE - 0.06, s * ze - (s > 0 ? 0 : 0.12), xe, yE + 0.06, s * ze + (s > 0 ? 0.12 : 0), 0);
  b.pop();
  return yR + tt;
}

/** Hip roof (4 slopes; pyramid when W == D). Same o / M as gableRoof. Returns the ridge height. */
export function hipRoof(b, M, o) {
  const alongX = o.W >= o.D;
  const A = (alongX ? o.W : o.D) / 2, B = (alongX ? o.D : o.W) / 2;
  const p = (o.pitch ?? 28) * DEG, tp = Math.tan(p), t = o.t ?? 0.22, tt = t / Math.cos(p);
  const oh = o.oh ?? 0.5, y = o.y, r = Math.max(0, A - B);
  b.push().translate(o.cx || 0, 0, o.cz || 0).rotateY(alongX ? 0 : Math.PI / 2);
  const ze = B + oh, xe = A + oh, yE = y - oh * tp, yR = y + B * tp;
  for (const [layer, dy, sgn] of [[M.top, tt, 1], [M.under, 0, -1]]) {
    for (const s of [1, -1]) {
      b.quad(layer, [-xe, yE + dy, s * ze], [xe, yE + dy, s * ze], [r, yR + dy, 0], [-r, yR + dy, 0], null, [0, sgn, sgn * s * tp]);
      b.tri(layer, [s * xe, yE + dy, ze], [s * xe, yE + dy, -ze], [s * r, yR + dy, 0], [sgn * s * tp, sgn, 0]);
    }
  }
  for (const s of [1, -1]) {
    b.quad(M.edge, [-xe, yE, s * ze], [xe, yE, s * ze], [xe, yE + tt, s * ze], [-xe, yE + tt, s * ze], null, [0, 0, s]);
    b.quad(M.edge, [s * xe, yE, -ze], [s * xe, yE, ze], [s * xe, yE + tt, ze], [s * xe, yE + tt, -ze], null, [s, 0, 0]);
  }
  if (M.ridge) {
    const ry = yR + tt - 0.03;
    if (r > 0.05) { b.push().translate(0, ry, 0).rotateX(Math.PI / 4); b.box(M.ridge, -r, -0.09, -0.09, r, 0.09, 0.09, 0); b.pop(); }
    // hip caps along the 4 hips
    for (const sx of [1, -1]) for (const sz of [1, -1]) {
      const a = [sx * xe, yE + tt - 0.02, sz * ze], c = [sx * r, ry, 0];
      b.rod(M.ridge, a, c, 0.08, 4);
    }
  }
  if (M.gutter) for (const s of [1, -1]) {
    b.box(M.gutter, -xe, yE - 0.06, s * ze - (s > 0 ? 0 : 0.12), xe, yE + 0.06, s * ze + (s > 0 ? 0.12 : 0), 0);
  }
  b.pop();
  return yR + tt;
}

/**
 * Mansard: steep lower slopes (with dormers) + low hip on top.
 * o adds {hm (lower slope height), inset (plan inset), dormers: [{side: 'front'|'back'|'left'|'right', x (along side, from its left end), w}]}
 * Mw: {slate, top, edge, dormer, trim} + window palette P for dormer windows.
 */
export function mansardRoof(b, M, o, P) {
  const { W, D, y } = o, cx = o.cx || 0, cz = o.cz || 0;
  const hm = o.hm ?? 3.0, m = o.inset ?? 1.0, t = 0.12;
  const x0 = cx - W / 2, x1 = cx + W / 2, z0 = cz - D / 2, z1 = cz + D / 2;
  const ix0 = x0 + m, ix1 = x1 - m, iz0 = z0 + m, iz1 = z1 - m, yt = y + hm;
  // lower slopes (slightly kicked out at the bottom)
  const kick = 0.18;
  const sides = [
    [[x0 - kick, y, z1 + kick], [x1 + kick, y, z1 + kick], [ix1, yt, iz1], [ix0, yt, iz1], [0, m, hm]],
    [[x1 + kick, y, z0 - kick], [x0 - kick, y, z0 - kick], [ix0, yt, iz0], [ix1, yt, iz0], [0, m, -hm]],
    [[x1 + kick, y, z1 + kick], [x1 + kick, y, z0 - kick], [ix1, yt, iz0], [ix1, yt, iz1], [hm, m, 0]],
    [[x0 - kick, y, z0 - kick], [x0 - kick, y, z1 + kick], [ix0, yt, iz1], [ix0, yt, iz0], [-hm, m, 0]],
  ];
  for (const [a, bb, c, d, n] of sides) b.quad(M.slate, a, bb, c, d, null, n);
  // eave edge
  b.sweep(M.edge, [[x0, z1], [x1, z1], [x1, z0], [x0, z0]], [[0, y - 0.12], [kick + 0.06, y - 0.12], [kick + 0.06, y + 0.02], [kick, y + 0.02]]);
  // cornice band at the break
  b.sweep(M.edge, [[ix0, iz1], [ix1, iz1], [ix1, iz0], [ix0, iz0]], [[0, yt - 0.02], [0.12, yt - 0.02], [0.12, yt + t], [0, yt + t]]);
  // upper low hip
  const top = hipRoof(b, { top: M.top, under: M.top, edge: M.edge, ridge: M.ridge }, { cx, cz, W: ix1 - ix0, D: iz1 - iz0, y: yt + t, pitch: 16, oh: 0.05, t: 0.08 });
  // dormers
  const slope = m / hm; // horizontal inset per meter of height
  for (const dm of o.dormers || []) {
    const fr = { front: [x0, z1, 1, 0, W], back: [x1, z0, -1, 0, W], right: [x1, z1, 0, -1, D], left: [x0, z0, 0, 1, D] }[dm.side];
    if (!fr) continue;
    const [fx, fz, ux, uz] = fr;
    b.push().frame(fx, fz, ux, uz);
    dormer(b, P, M, dm.x, dm.w ?? 1.1, y, hm, slope, kick);
    b.pop();
  }
  return top;
}

/** Dormer in a facade frame: front at z = -zIn, rising from y0 + 0.35, cut by a slope of `slope` m/m. */
function dormer(b, P, M, xc, w, y0, hm, slope, kick) {
  const zf = -0.05 + kick * 0.2, yb = y0 + 0.15, h = Math.min(hm - 0.55, 2.0), yt = yb + h, ww = w + 0.36;
  const x0 = xc - ww / 2, x1 = xc + ww / 2;
  const back = -(yt - y0 + 0.4) * slope - 0.4; // deep enough to meet the slope
  const D = M.dormer || P.trim;
  // front wall with window hole
  const wx = xc - w / 2, wy = yb + 0.3, wh = h - 0.55;
  b.push().translate(0, 0, zf);
  wallWithHoles(b, D, x0, x1, yb, yt, [{ x0: wx, x1: wx + w, y0: wy, y1: wy + wh }]);
  windowAt(b, P, { x: wx, y: wy, w, h: wh, type: 'casement', depth: 0.12, surround: null, shutters: null });
  b.pop();
  // cheeks
  for (const [x, s] of [[x0, -1], [x1, 1]]) b.quad(D, [x, yb, back], [x, yb, zf], [x, yt, zf], [x, yt, back], null, [s, 0, 0]);
  // little gable roof over it (ridge along z)
  const ry = yt + ww * 0.32;
  for (const s of [-1, 1]) {
    const ex = xc + s * (ww / 2 + 0.12);
    b.quad(M.slate, [ex, yt - 0.06, zf + 0.15], [xc, ry, zf + 0.15], [xc, ry, back], [ex, yt - 0.06, back], null, [s * 0.6, 1, 0]);
  }
  b.tri(D, [x0, yt, zf], [x1, yt, zf], [xc, ry - 0.05, zf], [0, 0, 1]);
  b.box(M.edge, xc - ww / 2 - 0.14, yt - 0.1, zf + 0.1, xc + ww / 2 + 0.14, yt - 0.02, zf + 0.18, 0);
}

/** Mono-pitch roof rising from the front (yLow) to the back (yHigh); side walls filled. */
export function shedRoof(b, M, o) {
  const { W, D } = o, cx = o.cx || 0, cz = o.cz || 0, oh = o.oh ?? 0.4, t = o.t ?? 0.25;
  const yf = o.y, yb = o.y + D * Math.tan((o.pitch ?? 12) * DEG);
  const k = (yb - yf) / D;
  const x0 = cx - W / 2 - oh, x1 = cx + W / 2 + oh, zf = cz + D / 2 + oh, zb = cz - D / 2 - oh;
  const yF = yf - oh * k, yB = yb + oh * k;
  b.quad(M.top, [x0, yF + t, zf], [x1, yF + t, zf], [x1, yB + t, zb], [x0, yB + t, zb], null, [0, 1, k]);
  b.quad(M.under, [x0, yF, zf], [x1, yF, zf], [x1, yB, zb], [x0, yB, zb], null, [0, -1, -k]);
  b.quad(M.edge, [x0, yF, zf], [x1, yF, zf], [x1, yF + t, zf], [x0, yF + t, zf], null, [0, 0, 1]);
  b.quad(M.edge, [x1, yB, zb], [x0, yB, zb], [x0, yB + t, zb], [x1, yB + t, zb], null, [0, 0, -1]);
  for (const [x, s] of [[x0, -1], [x1, 1]]) b.quad(M.edge, [x, yF, zf], [x, yB, zb], [x, yB + t, zb], [x, yF + t, zf], null, [s, 0, 0]);
  if (M.gable) for (const [x, s] of [[cx - W / 2, -1], [cx + W / 2, 1]]) b.tri(M.gable, [x, yf, cz + D / 2], [x, yf, cz - D / 2], [x, yb, cz - D / 2], [s, 0, 0]);
  if (M.back) b.quad(M.back, [cx + W / 2, yf, cz - D / 2], [cx - W / 2, yf, cz - D / 2], [cx - W / 2, yb, cz - D / 2], [cx + W / 2, yb, cz - D / 2], null, [0, 0, -1]);
  return yB + t;
}

/**
 * Flat roof on any footprint: membrane slab + parapet (outer face in the wall
 * material, coping, inner face). Returns the inner roof level.
 */
export function flatRoof(b, M, path, y, { ph = 0.9, t = 0.24, coping = true } = {}) {
  if (ph > 0.01) {
    b.sweep(M.wall, path, [[0, y - 0.001], [0, y + ph]]);
    if (coping) b.sweep(M.coping, path, [[0, y + ph], [0.04, y + ph], [0.04, y + ph + 0.07], [-t - 0.04, y + ph + 0.07], [-t - 0.04, y + ph], [-t, y + ph]]);
    b.sweep(M.inner || M.wall, path, [[-t, y + ph], [-t, y]]);
    b.prism(inset(path, t), y - 0.2, y, { top: M.roof });
  } else {
    b.prism(path, y - 0.2, y, { top: M.roof });
    if (coping) b.sweep(M.coping, path, [[0, y], [0.05, y], [0.05, y + 0.08], [-0.2, y + 0.08]]);
  }
  return y;
}

/** Cone / spire roof over a circle (or polygon with seg sides). */
export function coneRoof(b, d, cx, cz, r, y, h, seg = 16, { oh = 0.25, edge = null } = {}) {
  b.cyl(d, cx, cz, r + oh, 0.001, y - oh * (h / r), y + h, seg, { top: false, bottom: false, smooth: seg >= 12 });
  if (edge) b.cyl(edge, cx, cz, r + oh, r + oh, y - oh * (h / r) - 0.12, y - oh * (h / r), seg, { top: false, bottom: true, smooth: seg >= 12 });
  else b.cyl(d, cx, cz, r + oh, r + oh, y - oh * (h / r) - 0.001, y - oh * (h / r), seg, { top: false, bottom: true, smooth: false });
  return y + h;
}

export { DEG };
