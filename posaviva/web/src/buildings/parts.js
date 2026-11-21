// Facade parts, authored in a FACADE frame: x along the wall (0 = left end
// seen from outside), y up, z outward (wall surface at z = 0). The Builder's
// matrix stack places the frame on a footprint edge.
//
// wallWithHoles() builds the wall surface around rectangular openings; every
// opening then gets real depth: reveals, a glass plane at the back, frames,
// mullions, a protruding sill, optional surrounds / pediments, shutters,
// balconies with railings… All small parts use "detail" materials (LOD).
import { SKIP } from './kit.js';
import { signCell } from './textures.js';

// ---------------------------------------------------------------- layout helpers
/** n bay centers evenly spread over [m, L - m]. */
export function bays(L, n, m = 0) {
  if (n <= 0) return [];
  const step = (L - 2 * m) / n;
  return Array.from({ length: n }, (_, i) => m + step * (i + 0.5));
}
/** Number of bays of pitch ~p that fit in L. */
export function bayCount(L, p, min = 1) { return Math.max(min, Math.round(L / p)); }

// ---------------------------------------------------------------- wall surface
/**
 * Wall rectangle [x0,x1] × [y0,y1] at z, minus rectangular holes [{x0,x1,y0,y1}].
 * Grid subtraction + greedy merging keeps the quad count low.
 */
export function wallWithHoles(b, d, x0, x1, y0, y1, holes = [], z = 0) {
  const xs = new Set([x0, x1]), ys = new Set([y0, y1]);
  const H = [];
  for (const h of holes) {
    const a = Math.max(x0, h.x0), c = Math.min(x1, h.x1), e = Math.max(y0, h.y0), f = Math.min(y1, h.y1);
    if (c - a < 1e-4 || f - e < 1e-4) continue;
    H.push([a, c, e, f]); xs.add(a); xs.add(c); ys.add(e); ys.add(f);
  }
  const X = [...xs].sort((p, q) => p - q), Y = [...ys].sort((p, q) => p - q);
  const nx = X.length - 1, ny = Y.length - 1;
  const filled = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const cy = (Y[j] + Y[j + 1]) / 2;
    for (let i = 0; i < nx; i++) {
      const cx = (X[i] + X[i + 1]) / 2;
      filled[j * nx + i] = H.some(([a, c, e, f]) => cx > a && cx < c && cy > e && cy < f) ? 0 : 1;
    }
  }
  // horizontal runs, then grow runs downward/upward while identical
  const used = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!filled[j * nx + i] || used[j * nx + i]) continue;
      let i2 = i;
      while (i2 + 1 < nx && filled[j * nx + i2 + 1] && !used[j * nx + i2 + 1]) i2++;
      let j2 = j;
      for (;;) {
        if (j2 + 1 >= ny) break;
        let ok = true;
        for (let k = i; k <= i2; k++) if (!filled[(j2 + 1) * nx + k] || used[(j2 + 1) * nx + k]) { ok = false; break; }
        if (!ok) break;
        j2++;
      }
      for (let jj = j; jj <= j2; jj++) for (let k = i; k <= i2; k++) used[jj * nx + k] = 1;
      const a = X[i], c = X[i2 + 1], e = Y[j], f = Y[j2 + 1];
      b.quad(d, [a, e, z], [c, e, z], [c, f, z], [a, f, z]);
    }
  }
}

/** Reveal (the 4 inner faces of a rectangular opening) from z = 0 to -depth. */
export function reveal(b, d, x0, y0, x1, y1, depth, { bottom = true } = {}) {
  const z = -depth;
  b.quad(d, [x0, y0, z], [x0, y0, 0], [x0, y1, 0], [x0, y1, z], null, [1, 0, 0]);
  b.quad(d, [x1, y0, 0], [x1, y0, z], [x1, y1, z], [x1, y1, 0], null, [-1, 0, 0]);
  b.quad(d, [x0, y1, z], [x0, y1, 0], [x1, y1, 0], [x1, y1, z], null, [0, -1, 0]);
  if (bottom) b.quad(d, [x0, y0, 0], [x0, y0, z], [x1, y0, z], [x1, y0, 0], null, [0, 1, 0]);
}

/** Glass quad with one random interior cell of the 4 × 4 atlas. */
export function glassPane(b, d, x0, y0, x1, y1, z, cell) {
  const i = cell % 4, j = (cell >> 2) % 4, e = 0.012;
  const u0 = i / 4 + e, u1 = (i + 1) / 4 - e, v0 = j / 4 + e, v1 = (j + 1) / 4 - e;
  b.quad(d, [x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], [0, 0, 1]);
}

/** Rectangular frame ring (4 boxes) of width fw between z0 and z1, plus mullions. */
export function frameRing(b, d, x0, y0, x1, y1, z0, z1, fw, { mullions = 0, transoms = [] } = {}) {
  b.box(d, x0, y0, z0, x1, y0 + fw, z1, SKIP.nz | SKIP.ny);
  b.box(d, x0, y1 - fw, z0, x1, y1, z1, SKIP.nz | SKIP.py);
  b.box(d, x0, y0 + fw, z0, x0 + fw, y1 - fw, z1, SKIP.nz | SKIP.nx | SKIP.py | SKIP.ny);
  b.box(d, x1 - fw, y0 + fw, z0, x1, y1 - fw, z1, SKIP.nz | SKIP.px | SKIP.py | SKIP.ny);
  const mw = fw * 0.75;
  for (let k = 1; k <= mullions; k++) {
    const x = x0 + ((x1 - x0) * k) / (mullions + 1);
    b.box(d, x - mw / 2, y0 + fw, z0, x + mw / 2, y1 - fw, z1 - 0.005, SKIP.nz | SKIP.py | SKIP.ny);
  }
  for (const t of transoms) {
    const y = y0 + (y1 - y0) * t;
    b.box(d, x0 + fw, y - mw / 2, z0, x1 - fw, y + mw / 2, z1 - 0.005, SKIP.nz | SKIP.px | SKIP.nx);
  }
}

// ---------------------------------------------------------------- windows
/**
 * One window opening. o = {x, y, w, h, type, depth, surround, shutters, grille, sill}
 * type: 'casement' (2 leaves + transom), 'modern' (single pane), 'french' (to the floor),
 *       'square' (small), 'ribbon' (horizontal strip), 'arched' (round head), 'slit'.
 * P = palette {wall, reveal?, frame, glass, glassLit, sill, trim, shutter, rolling, metal, rand, lights, wear}
 */
export function windowAt(b, P, o) {
  const { x, y, w, h } = o;
  const depth = o.depth ?? 0.2;
  const x1 = x + w, y1 = y + h, R = P.rand;
  if (o.type === 'simple') {
    // light window for towers: reveal, glass, a mullion (no sill, no frame ring)
    reveal(b, P.reveal || P.wall, x, y, x1, y1, depth);
    const lit = R.chance(P.lights || 0);
    glassPane(b, lit ? P.glassLit : P.glass, x, y, x1, y1, -depth + 0.02, R.int(0, 15));
    if (o.mullion !== false) b.box(P.frame, x + w / 2 - 0.03, y, -depth + 0.02, x + w / 2 + 0.03, y1, -depth + 0.08, SKIP.nz | SKIP.ny | SKIP.py);
    return;
  }
  const arched = o.type === 'arched';
  const rv = P.reveal || P.wall;
  if (arched) archOpening(b, P, o);
  else reveal(b, rv, x, y, x1, y1, depth, { bottom: !(o.sill ?? true) });
  // glass + frame
  const fz0 = -depth, fz1 = -depth + 0.07;
  const lit = R.chance(P.lights || 0);
  const cell = R.int(0, 15);
  // state of the opening (closed shutters / boarded when worn)
  let closed = false;
  if (o.shutters === 'louver' && R.chance(P.wear > 1 ? 0.35 : 0.18)) closed = true;
  const boarded = P.wear > 1 && !arched && o.type !== 'ribbon' && R.chance(0.06);
  if (!arched) glassPane(b, lit ? P.glassLit : P.glass, x, y, x1, y1, fz0 + 0.02, cell);
  if (boarded) {
    for (let k = 0, n = Math.max(2, Math.round(h / 0.22)); k < n; k++) {
      const yy = y + (h * (k + 0.5)) / n;
      b.push().translate(x + w / 2, yy, -0.02).rotateZ((R.next() - 0.5) * 0.12);
      b.box(P.boards || P.door, -w / 2 - 0.04, -0.09, -0.01, w / 2 + 0.04, 0.09, 0.015);
      b.pop();
    }
  } else if (!arched) {
    const fw = o.type === 'modern' || o.type === 'ribbon' ? 0.05 : 0.065;
    const mull = o.type === 'ribbon' ? Math.max(1, Math.round(w / 1.4) - 1) : o.type === 'modern' || o.type === 'square' || o.type === 'slit' ? (w > 1.6 ? 1 : 0) : w > 0.7 ? 1 : 0;
    const transoms = o.type === 'casement' && h > 1.3 ? [0.76] : o.type === 'french' ? [0.8] : [];
    frameRing(b, P.frame, x, y, x1, y1, fz0, fz1, fw, { mullions: mull, transoms });
  }
  // sill
  if (o.sill ?? true) {
    const sm = P.sill || P.trim;
    const deep = o.surround ? 0.08 : 0.06;
    b.box(sm, x - 0.06, y - 0.06, -depth + 0.06, x1 + 0.06, y, deep, 0);
    if (o.surround === 'pediment' || o.surround === 'cornice') { // little corbels under the sill
      for (const cx of [x + 0.08, x1 - 0.08]) b.box(sm, cx - 0.05, y - 0.2, 0, cx + 0.05, y - 0.06, 0.06, SKIP.nz);
    }
  }
  // surrounds (historic)
  if (o.surround && !arched) surround(b, P, x, y, x1, y1, o.surround);
  // shutters
  if (o.shutters === 'louver' && !boarded) {
    const sz = o.surround ? 0.032 : 0;
    const ang = closed ? 0 : P.wear > 0 && R.chance(0.25) ? Math.PI * R.range(0.45, 0.8) : Math.PI * 0.985;
    const ang2 = closed ? 0 : P.wear > 0 && R.chance(0.2) ? Math.PI * R.range(0.4, 0.8) : Math.PI * 0.985;
    const lw = w / 2, t = 0.035;
    // left leaf hinged at x, right leaf at x1
    b.push().translate(x, y, closed ? -0.005 : sz).rotateY(-ang);
    b.box(P.shutter, 0.005, 0, -t - 0.004, lw - 0.004, h, -0.004);
    b.pop();
    b.push().translate(x1, y, closed ? -0.005 : sz).rotateY(ang2);
    b.box(P.shutter, -lw + 0.004, 0, -t - 0.004, -0.005, h, -0.004);
    b.pop();
  } else if (o.shutters === 'rolling' && !boarded) {
    const down = R.pick([0.1, 0.25, 0.4, 0.5, 0.75, 1, 0.08]);
    b.box(P.rolling, x + 0.01, y1 - h * down, -0.075, x1 - 0.01, y1, -0.05, SKIP.nz);
  } else if (o.shutters === 'panel' && !boarded) {
    // solid wooden panels folded into the reveal (rustic)
    b.box(P.shutter, x - 0.002, y, -0.06, x + 0.05, y1, -depth + 0.08, 0);
    b.box(P.shutter, x1 - 0.05, y, -0.06, x1 + 0.002, y1, -depth + 0.08, 0);
  }
  if (P.acChance && o.sill !== false && y > 2.5 && !boarded && R.chance(P.acChance)) {
    // split AC unit hanging beside / under the window
    const side = R.chance(0.5) ? x - 0.95 : x1 + 0.15;
    const ay = y - 0.15 + R.range(-0.1, 0.4);
    b.box(P.unit, side, ay, 0, side + 0.8, ay + 0.55, 0.28, SKIP.nz);
    b.push().translate(side + 0.52, ay + 0.275, 0.28).rotateX(Math.PI / 2); // fan grille facing out
    b.cyl(P.darkMetal || P.metal, 0, 0, 0.2, 0.2, 0, 0.015, 10, { top: true });
    b.pop();
    b.box(P.darkMetal || P.metal, side + 0.05, ay - 0.06, 0, side + 0.75, ay, 0.2, SKIP.nz);
  }
  if (o.grille) {
    const gz = -0.04;
    for (let gx = x + 0.1; gx < x1 - 0.05; gx += 0.12) b.box(P.metal, gx - 0.008, y, gz - 0.008, gx + 0.008, y1, gz + 0.008, SKIP.ny | SKIP.py);
    for (const gy of [y + 0.12, y1 - 0.12]) b.box(P.metal, x, gy - 0.012, gz - 0.012, x1, gy + 0.012, gz + 0.012, SKIP.nx | SKIP.px);
  }
}

/** Historic window surrounds: flat band, cornice on top, triangular / segmental pediment. */
export function surround(b, P, x0, y0, x1, y1, kind) {
  const T = P.trim, bw = 0.13, t = 0.035;
  b.box(T, x0 - bw, y0, 0, x0, y1 + bw, t, SKIP.nz | SKIP.ny);
  b.box(T, x1, y0, 0, x1 + bw, y1 + bw, t, SKIP.nz | SKIP.ny);
  b.box(T, x0, y1, 0, x1, y1 + bw, t, SKIP.nz | SKIP.ny);
  if (kind === 'band') return;
  // frieze + cornice slab
  const cy = y1 + bw;
  b.box(T, x0 - bw - 0.02, cy, 0, x1 + bw + 0.02, cy + 0.14, t + 0.01, SKIP.nz);
  b.box(T, x0 - bw - 0.08, cy + 0.14, 0, x1 + bw + 0.08, cy + 0.22, 0.13, SKIP.nz);
  if (kind === 'pediment') {
    const L = x0 - bw - 0.08, Rr = x1 + bw + 0.08, top = cy + 0.22 + (Rr - L) * 0.2, mid = (L + Rr) / 2, z = 0.12;
    // tympanum (front triangle) + sloped top faces
    b.tri(T, [L + 0.06, cy + 0.22, z - 0.03], [Rr - 0.06, cy + 0.22, z - 0.03], [mid, top - 0.06, z - 0.03], [0, 0, 1]);
    const s = 0.07;
    b.quad(T, [L, cy + 0.22, z], [mid, top, z], [mid, top, 0], [L, cy + 0.22, 0], null, [-0.3, 1, 0]);
    b.quad(T, [mid, top, z], [Rr, cy + 0.22, z], [Rr, cy + 0.22, 0], [mid, top, 0], null, [0.3, 1, 0]);
    b.quad(T, [L, cy + 0.22, z], [L + s, cy + 0.22, z], [mid, top - s * 0.6, z], [mid, top, z], null, [0, 0, 1]);
    b.quad(T, [mid, top, z], [mid, top - s * 0.6, z], [Rr - s, cy + 0.22, z], [Rr, cy + 0.22, z], null, [0, 0, 1]);
  } else if (kind === 'segment') {
    const L = x0 - bw - 0.08, Rr = x1 + bw + 0.08, mid = (L + Rr) / 2, r = (Rr - L) / 2, seg = 8, base = cy + 0.22;
    for (let i = 0; i < seg; i++) {
      const a0 = Math.PI * (i / seg), a1 = Math.PI * ((i + 1) / seg);
      const p0 = [mid + Math.cos(a0) * r, base + Math.sin(a0) * r * 0.35], p1 = [mid + Math.cos(a1) * r, base + Math.sin(a1) * r * 0.35];
      b.quad(T, [p0[0], p0[1], 0.12], [p1[0], p1[1], 0.12], [p1[0], p1[1], 0], [p0[0], p0[1], 0], null, [0, 1, 0]);
      b.tri(T, [mid, base, 0.12], [p1[0], p1[1], 0.12], [p0[0], p0[1], 0.12], [0, 0, 1]);
    }
  }
}

/**
 * Round-headed opening: wall infill above the arc, curved reveal, arched glass
 * with a radial frame, keystone. Rect hole must be [x, x+w] × [y, y+h].
 */
export function archOpening(b, P, o, { glass = true, frame = true } = {}) {
  const { x, y, w, h } = o, depth = o.depth ?? 0.22;
  const r = w / 2, cx = x + r, ys = y + h - r, seg = 10, z = -depth;
  const W = P.wall, rv = P.reveal || P.wall;
  const arc = [];
  for (let i = 0; i <= seg; i++) { const a = Math.PI - (Math.PI * i) / seg; arc.push([cx + Math.cos(a) * r, ys + Math.sin(a) * r]); }
  // infill: left and right curved triangles between the arc and the rect top corners
  const top = y + h;
  for (let i = 0; i < seg; i++) {
    const [ax, ay] = arc[i], [bx, by] = arc[i + 1];
    const corner = i < seg / 2 ? [x, top] : [x + w, top];
    b.tri(W, [corner[0], corner[1], 0], [ax, ay, 0], [bx, by, 0], [0, 0, 1]);
  }
  // reveal: jambs up to the spring line + curved soffit
  b.quad(rv, [x, y, z], [x, y, 0], [x, ys, 0], [x, ys, z], null, [1, 0, 0]);
  b.quad(rv, [x + w, y, 0], [x + w, y, z], [x + w, ys, z], [x + w, ys, 0], null, [-1, 0, 0]);
  for (let i = 0; i < seg; i++) {
    const [ax, ay] = arc[i], [bx, by] = arc[i + 1];
    const mx = (ax + bx) / 2 - cx, my = (ay + by) / 2 - ys;
    b.quad(rv, [ax, ay, z], [ax, ay, 0], [bx, by, 0], [bx, by, z], null, [-mx, -my, 0]);
  }
  if (o.sill === false) b.quad(rv, [x, y, 0], [x, y, z], [x + w, y, z], [x + w, y, 0], null, [0, 1, 0]);
  if (glass) {
    const R = P.rand, lit = R.chance(P.lights || 0), cell = R.int(0, 15), gz = z + 0.02;
    const gd = lit ? P.glassLit : P.glass;
    glassPane(b, gd, x, y, x + w, ys, gz, cell);
    const i = cell % 4, j = (cell >> 2) % 4, uv = (px, py) => [(i + 0.05 + 0.9 * (px - x) / w) / 4, (j + 0.05 + 0.9 * Math.min(1, (py - y) / (h || 1))) / 4];
    for (let k = 0; k < seg; k++) b.tri(gd, [cx, ys, gz], [arc[k + 1][0], arc[k + 1][1], gz], [arc[k][0], arc[k][1], gz], [0, 0, 1]);
    void uv;
  }
  if (frame) {
    const fz0 = z, fz1 = z + 0.07, fw = 0.06, F = P.frame;
    b.box(F, x, y, fz0, x + w, y + fw, fz1, SKIP.nz);
    b.box(F, x, y, fz0, x + fw, ys, fz1, SKIP.nz);
    b.box(F, x + w - fw, y, fz0, x + w, ys, fz1, SKIP.nz);
    b.box(F, cx - 0.025, y, fz0, cx + 0.025, ys + r, fz1 - 0.005, SKIP.nz);
    b.box(F, x, ys - 0.025, fz0, x + w, ys + 0.025, fz1 - 0.005, SKIP.nz);
    for (let i = 0; i < seg; i++) {
      const [ax, ay] = arc[i], [bx, by] = arc[i + 1];
      const L = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax);
      b.push().translate(ax, ay, 0).rotateZ(ang);
      b.box(F, 0, -fw, fz0, L, 0, fz1, SKIP.nz);
      b.pop();
    }
  }
  if (o.keystone !== false && P.trim) {
    const T = P.trim;
    b.box(T, cx - 0.09, ys + r - 0.04, 0, cx + 0.09, ys + r + 0.22, 0.05, SKIP.nz);
    // archivolt band
    for (let i = 0; i < seg; i++) {
      const [ax, ay] = arc[i], [bx, by] = arc[i + 1];
      const L = Math.hypot(bx - ax, by - ay) + 0.01, ang = Math.atan2(by - ay, bx - ax);
      b.push().translate(ax, ay, 0).rotateZ(ang);
      b.box(T, -0.005, 0, 0, L, 0.12, 0.03, SKIP.nz);
      b.pop();
    }
  }
}

// ---------------------------------------------------------------- doors
/**
 * Door opening. o = {x, w, h, y=0, type: 'portone'|'single'|'glass'|'garage'|'barn', arched, depth, canopy, steps}
 */
export function doorAt(b, P, o) {
  const { x, w, h } = o, y = o.y ?? 0, depth = o.depth ?? 0.25, x1 = x + w, y1 = y + h, R = P.rand;
  const z = -depth;
  if (o.arched) archOpening(b, P, { x, y, w, h, depth, sill: false, keystone: true }, { glass: false, frame: false });
  else reveal(b, P.reveal || P.wall, x, y, x1, y1, depth, { bottom: false });
  const top = o.arched ? y1 - w / 2 : y1;
  const D = P.door;
  if (o.type === 'garage') {
    b.quad(P.garage || P.metal, [x, y, z + 0.05], [x1, y, z + 0.05], [x1, y1, z + 0.05], [x, y1, z + 0.05], null, [0, 0, 1]);
    return;
  }
  if (o.type === 'glass') {
    glassPane(b, R.chance(P.lights > 0 ? 0.7 : 0) ? P.glassLit : P.glass, x, y, x1, y1, z + 0.02, R.int(0, 15));
    frameRing(b, P.darkFrame || P.metal, x, y, x1, y1, z, z + 0.08, 0.06, { mullions: w > 1.6 ? 1 : 0, transoms: h > 2.6 ? [0.78] : [] });
    // push bars
    for (const hx of w > 1.6 ? [x + w / 2 - 0.12, x + w / 2 + 0.12] : [x + w * 0.75]) b.box(P.metal, hx - 0.015, y + 0.9, z + 0.08, hx + 0.015, y + 1.3, z + 0.14, 0);
  } else {
    // panelled wooden door (double leaf when wide), with transom glass for tall openings
    const leafTop = o.arched || o.full ? top : Math.min(y1, y + 2.3);
    b.quad(D, [x, y, z + 0.04], [x1, y, z + 0.04], [x1, leafTop, z + 0.04], [x, leafTop, z + 0.04], null, [0, 0, 1]);
    const leaves = w > 1.25 ? 2 : 1, lw = w / leaves;
    for (let k = 0; k < leaves; k++) {
      const lx = x + k * lw;
      const rows = o.type === 'barn' ? 1 : 2;
      for (let r = 0; r < rows; r++) {
        const py0 = y + 0.18 + r * ((leafTop - y - 0.3) / rows), py1 = py0 + (leafTop - y - 0.3) / rows - 0.14;
        b.box(D, lx + 0.1, py0, z + 0.04, lx + lw - 0.1, py1, z + 0.075, SKIP.nz);
      }
      if (o.type === 'barn') { // diagonal brace
        b.push().translate(lx + lw / 2, y + (leafTop - y) / 2, z + 0.08).rotateZ(Math.atan2(leafTop - y - 0.3, lw - 0.2));
        b.box(D, -Math.hypot(lw, leafTop - y) / 2 + 0.15, -0.07, 0, Math.hypot(lw, leafTop - y) / 2 - 0.15, 0.07, 0.03);
        b.pop();
      }
      const hx = leaves === 2 ? (k ? lx + 0.12 : lx + lw - 0.12) : lx + lw - 0.12;
      b.box(P.brass || P.metal, hx - 0.02, y + 1.0, z + 0.075, hx + 0.02, y + 1.14, z + 0.11, 0);
    }
    if (leaves === 2) b.box(D, x + w / 2 - 0.015, y, z + 0.04, x + w / 2 + 0.015, leafTop, z + 0.085, SKIP.nz);
    if (!o.arched && leafTop < y1 - 0.15) { // transom light
      glassPane(b, P.glass, x + 0.06, leafTop + 0.06, x1 - 0.06, y1 - 0.06, z + 0.03, R.int(0, 15));
      frameRing(b, P.frame, x, leafTop, x1, y1, z, z + 0.08, 0.06, { mullions: Math.max(0, Math.round(w / 0.5) - 1) });
    } else if (o.arched) {
      // fanlight in the arch
      const r = w / 2, cx = x + r, seg = 10;
      for (let i = 0; i < seg; i++) {
        const a0 = Math.PI - (Math.PI * i) / seg, a1 = Math.PI - (Math.PI * (i + 1)) / seg;
        b.tri(P.glass, [cx, top, z + 0.03], [cx + Math.cos(a1) * r, top + Math.sin(a1) * r, z + 0.03], [cx + Math.cos(a0) * r, top + Math.sin(a0) * r, z + 0.03], [0, 0, 1]);
      }
      b.box(P.frame, x, top - 0.04, z, x1, top + 0.03, z + 0.08, SKIP.nz);
    }
  }
  if (o.steps) {
    const n = Math.max(1, Math.round(y / 0.16));
    for (let s = 0; s < n; s++) b.box(P.sill || P.trim, x - 0.2, 0, 0, x1 + 0.2, y - s * (y / n), 0.3 * (s + 1), SKIP.ny | SKIP.nz);
  }
  if (o.canopy) { // modern slab canopy / pensilina
    const c = o.canopy;
    b.box(c.mat || P.trim, x - 0.5, y1 + 0.15, 0, x1 + 0.5, y1 + 0.3, c.depth || 1.2, SKIP.nz);
  }
  if (o.surround) surround(b, P, x, y, x1, y1, o.surround);
}

// ---------------------------------------------------------------- shop fronts
/**
 * Shop front in [x, x+w] on the ground floor: glazed front with stall riser,
 * mullions, door, fascia sign with lettering and optional awning.
 * o = {x, w, h, sign (text), awning (descriptor|null), signMat, frameMat}
 */
export function shopfront(b, P, o) {
  const { x, w, h } = o, depth = 0.16, x1 = x + w, R = P.rand;
  const z = -depth, F = o.frameMat || P.darkFrame || P.metal;
  reveal(b, P.reveal || P.wall, x, 0, x1, h, depth, { bottom: false });
  // stall riser
  const riser = 0.45;
  b.box(o.riserMat || P.trim, x, 0, z, x1, riser, z + 0.1, SKIP.nz | SKIP.ny);
  // door position
  const dw = 1.0, dx = w > 3 ? x + (R.chance(0.5) ? (w - dw) / 2 : w - dw - 0.3) : x + w - dw - 0.15;
  const lit = R.chance(Math.min(1, (P.lights || 0) * 1.6));
  const gl = lit ? P.glassLit : P.glass;
  // glazing left / right of the door
  const panes = [[x, dx], [dx + dw, x1]];
  for (const [a, c] of panes) {
    if (c - a < 0.2) continue;
    glassPane(b, gl, a, riser, c, h, z + 0.05, R.int(0, 15));
    const n = Math.max(0, Math.round((c - a) / 1.6) - 1);
    frameRing(b, F, a, riser, c, h, z + 0.03, z + 0.1, 0.05, { mullions: n, transoms: [0.82] });
  }
  // door
  glassPane(b, gl, dx, 0, dx + dw, h, z + 0.03, R.int(0, 15));
  frameRing(b, F, dx, 0, dx + dw, h, z + 0.02, z + 0.09, 0.07, { transoms: [(2.3) / h] });
  b.box(P.metal, dx + dw - 0.2, 0.95, z + 0.09, dx + dw - 0.16, 1.35, z + 0.14, 0);
  // fascia sign
  if (o.sign !== false) sign(b, P, x - 0.05, h + 0.12, w + 0.1, 0.62, o.sign || R.pick(['BAR', 'PIZZERIA', 'FARMACIA', 'PANETTERIA', 'TABACCHI', 'CAFFÈ', 'ALIMENTARI', 'LIBRERIA', 'FIORI', 'OTTICA', 'GELATERIA', 'MACELLERIA', 'BOUTIQUE', 'TRATTORIA']), o.signMat);
  if (o.awning) awning(b, P, x - 0.05, x1 + 0.05, h + 0.08, o.awningDepth ?? 1.4, o.awning);
}

/** Fascia board with lettering (front face mapped to one cell of the sign atlas). */
export function sign(b, P, x, y, w, h, text, frameMat) {
  const cell = signCell(text);
  const t = 0.08, F = frameMat || P.darkFrame || P.metal;
  b.box(F, x, y, 0, x + w, y + h, t, SKIP.nz | SKIP.pz);
  // letters keep their aspect: center a 4:1 panel, the rest is the board color
  const pw = Math.min(w - 0.1, (h - 0.1) * 4), px = x + (w - pw) / 2, ph = pw / 4, py = y + (h - ph) / 2;
  const [u0, v0, u1, v1] = cell, e = 0.002;
  if (pw < w - 0.12) {
    // board margins share the sign's background via the cell's edge texels
    const ue = u0 + e;
    b.quad(P.signs, [x, y, t], [px, y, t], [px, y + h, t], [x, y + h, t], [[ue, v0 + e], [ue, v0 + e], [ue, v1 - e], [ue, v1 - e]]);
    b.quad(P.signs, [px + pw, y, t], [x + w, y, t], [x + w, y + h, t], [px + pw, y + h, t], [[ue, v0 + e], [ue, v0 + e], [ue, v1 - e], [ue, v1 - e]]);
  }
  if (ph < h - 0.02) {
    b.quad(P.signs, [px, y, t], [px + pw, y, t], [px + pw, py, t], [px, py, t], [[u0 + e, v0 + e], [u1 - e, v0 + e], [u1 - e, v0 + e], [u0 + e, v0 + e]]);
    b.quad(P.signs, [px, py + ph, t], [px + pw, py + ph, t], [px + pw, y + h, t], [px, y + h, t], [[u0 + e, v1 - e], [u1 - e, v1 - e], [u1 - e, v1 - e], [u0 + e, v1 - e]]);
  }
  b.quad(P.signs, [px, py, t], [px + pw, py, t], [px + pw, py + ph, t], [px, py + ph, t], [[u0 + e, v0 + e], [u1 - e, v0 + e], [u1 - e, v1 - e], [u0 + e, v1 - e]]);
}

/** Retractable striped awning with valance and side arms. */
export function awning(b, P, x0, x1, y, depth, d) {
  const drop = depth * 0.42, val = 0.24;
  const A = d;
  // fabric (double sided)
  b.quad(A, [x0, y - drop, depth], [x1, y - drop, depth], [x1, y, 0.02], [x0, y, 0.02], null, [0, 1, 0.4]);
  b.quad(A, [x0, y - drop, depth], [x1, y - drop, depth], [x1, y - drop - val, depth + 0.01], [x0, y - drop - val, depth + 0.01], null, [0, 0, 1]);
  // scalloped edge hint: small teeth
  const n = Math.max(2, Math.round((x1 - x0) / 0.3));
  for (let i = 0; i < n; i++) {
    const a = x0 + ((x1 - x0) * i) / n, c = x0 + ((x1 - x0) * (i + 1)) / n;
    b.tri(A, [a, y - drop - val, depth + 0.01], [c, y - drop - val, depth + 0.01], [(a + c) / 2, y - drop - val - 0.06, depth + 0.01], [0, 0, 1]);
  }
  // arms
  for (const ax of [x0 + 0.05, x1 - 0.05]) b.rod(P.metal, [ax, y - 0.9, 0.02], [ax, y - drop + 0.02, depth - 0.05], 0.018, 4);
  b.box(P.metal, x0, y - 0.05, 0, x1, y + 0.06, 0.12, SKIP.nz);
}

// ---------------------------------------------------------------- balconies & railings
/**
 * Balcony slab [x0, x1] at floor level fy projecting `dep`, with railing.
 * rail: 'bars' | 'solid' | 'glass' | 'balusters' | 'wood' | 'none'; consoles: historic corbels.
 */
export function balcony(b, P, x0, x1, fy, dep, rail = 'bars', { consoles = false, slab = null, sides = true } = {}) {
  const S = slab || P.slab || P.trim;
  const th = rail === 'balusters' ? 0.2 : 0.16;
  b.box(S, x0, fy - th, 0, x1, fy, dep, SKIP.nz);
  if (consoles) {
    const n = Math.max(2, Math.round((x1 - x0) / 1.1) + 1);
    for (let i = 0; i < n; i++) {
      const cx = x0 + 0.12 + ((x1 - x0 - 0.24) * i) / (n - 1);
      b.box(S, cx - 0.07, fy - th - 0.32, 0, cx + 0.07, fy - th, dep * 0.75, SKIP.nz | SKIP.py);
      b.box(S, cx - 0.07, fy - th - 0.5, 0, cx + 0.07, fy - th - 0.32, dep * 0.35, SKIP.nz | SKIP.py);
    }
  }
  railing(b, P, [[x0 + 0.03, dep - 0.03], [x1 - 0.03, dep - 0.03]], fy, rail, sides ? { left: [x0 + 0.03, 0], right: [x1 - 0.03, 0] } : null);
  // flower pots (some balconies)
  if (P.plants && P.rand.chance(P.plants)) {
    const n = 1 + P.rand.int(0, Math.min(3, Math.floor((x1 - x0) / 0.9)));
    for (let i = 0; i < n; i++) {
      const px = x0 + 0.35 + P.rand.range(0, Math.max(0.01, x1 - x0 - 0.7)), pz = dep - 0.28;
      b.cyl(P.pot, px, pz, 0.13, 0.17, fy, fy + 0.28, 8, { top: true });
      b.dome(P.rand.chance(0.5) ? P.plant : P.plantDark, px, fy + 0.26, pz, 0.24, 7, 3, 1.2);
    }
  }
}

/** Rain downpipes at the 4 corners of a W × D box from the eaves to the ground. */
export function downpipes(b, P, W, D, top, cx = 0, cz = 0) {
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x = cx + sx * (W / 2 - 0.12), z = cz + sz * (D / 2 + 0.09);
    b.cyl(P.gutter, x, z, 0.05, 0.05, 0.25, top - 0.05, 6, { top: false });
    b.cyl(P.gutter, x, z, 0.065, 0.065, 0.0, 0.3, 6, { top: true });
  }
}

/**
 * Railing along a polyline in the facade's (x, z) plane at height y0.
 * ends {left: [x, z], right: [x, z]} adds side returns back to the wall.
 */
export function railing(b, P, line, y0, kind = 'bars', ends = null) {
  if (kind === 'none') return;
  const segs = [];
  if (ends) segs.push([ends.left, line[0]]);
  for (let i = 0; i + 1 < line.length; i++) segs.push([line[i], line[i + 1]]);
  if (ends) segs.push([line[line.length - 1], ends.right]);
  const H = kind === 'solid' ? 1.0 : 1.02;
  for (const [[ax, az], [bx, bz]] of segs) {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.02) continue;
    const ang = Math.atan2(-(bz - az), bx - ax);
    b.push().translate(ax, y0, az).rotateY(ang);
    if (kind === 'solid') {
      b.box(P.parapet || P.wall, 0, 0, -0.06, L, H, 0.04, 0);
      if (P.metal) b.box(P.metal, -0.01, H, -0.05, L + 0.01, H + 0.04, 0.03, SKIP.ny);
    } else if (kind === 'glass') {
      b.box(P.railGlass || P.glass, 0.02, 0.06, -0.012, L - 0.02, H - 0.04, 0.012, 0);
      b.box(P.metal, -0.01, H - 0.04, -0.025, L + 0.01, H, 0.025, 0);
      for (const px of [0.02, L - 0.02]) b.box(P.metal, px - 0.02, 0, -0.02, px + 0.02, H - 0.04, 0.02, SKIP.ny);
    } else if (kind === 'balusters') {
      const S = P.trim;
      b.box(S, -0.02, 0, -0.1, L + 0.02, 0.12, 0.1, SKIP.ny);
      b.box(S, -0.04, 0.88, -0.12, L + 0.04, 0.98, 0.12, 0);
      const n = Math.max(2, Math.floor(L / 0.17));
      for (let i = 0; i < n; i++) {
        const cx = (L * (i + 0.5)) / n;
        b.lathe(S, cx, 0, [[0.045, 0.12], [0.045, 0.2], [0.03, 0.26], [0.06, 0.45], [0.06, 0.55], [0.03, 0.74], [0.045, 0.8], [0.045, 0.88]], 6);
      }
    } else if (kind === 'wood') {
      const W = P.woodRail || P.shutter;
      b.box(W, -0.03, H - 0.08, -0.04, L + 0.03, H, 0.04, 0);
      b.box(W, 0, 0.05, -0.03, L, 0.13, 0.03, 0);
      const n = Math.max(2, Math.floor(L / 0.16));
      for (let i = 0; i < n; i++) {
        const cx = (L * (i + 0.5)) / n;
        b.box(W, cx - 0.05, 0.13, -0.012, cx + 0.05, H - 0.08, 0.012, SKIP.ny | SKIP.py);
      }
    } else { // bars
      const M = P.metal;
      b.box(M, -0.01, H - 0.04, -0.022, L + 0.01, H, 0.022, 0);
      b.box(M, 0, 0.08, -0.012, L, 0.11, 0.012, 0);
      const n = Math.max(2, Math.floor(L / 0.115));
      for (let i = 0; i <= n; i++) {
        const cx = (L * i) / n;
        const s = i === 0 || i === n ? 0.022 : 0.009;
        b.box(M, cx - s, 0, -s, cx + s, H - 0.04, s, SKIP.ny | SKIP.py);
      }
    }
    b.pop();
  }
}

/**
 * Round window (oculus / rose window) of radius r centered at (cx, cy): the
 * square hole [cx-r, cx+r] × [cy-r, cy+r] must be in the wall's hole list.
 * Wall infill in the corners, cylindrical reveal, glass disc, tracery spokes, frame ring.
 */
export function roundOpening(b, P, cx, cy, r, { depth = 0.3, spokes = 8, seg = 24 } = {}) {
  const W = P.wall, rv = P.reveal || P.wall, z = -depth;
  const pt = (i) => { const a = (i / seg) * Math.PI * 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; };
  for (let i = 0; i < seg; i++) {
    const [ax, ay] = pt(i), [bx, by] = pt(i + 1);
    const am = ((i + 0.5) / seg) * Math.PI * 2;
    const corner = [cx + Math.sign(Math.cos(am)) * r, cy + Math.sign(Math.sin(am)) * r];
    b.tri(W, [corner[0], corner[1], 0], [bx, by, 0], [ax, ay, 0], [0, 0, 1]);
    b.quad(rv, [ax, ay, 0], [bx, by, 0], [bx, by, z], [ax, ay, z], null, [cx - (ax + bx) / 2, cy - (ay + by) / 2, 0]);
  }
  // corner wedges at the 4 diagonal gaps (between arc segments and square corners): covered above
  const R = P.rand, lit = R.chance(P.lights || 0), cell = R.int(0, 15);
  const gd = P.stained || (lit ? P.glassLit : P.glass), i0 = cell % 4, j0 = (cell >> 2) % 4;
  const uv = (x, y) => [(i0 + 0.5 + 0.45 * (x - cx) / r) / 4, (j0 + 0.5 + 0.45 * (y - cy) / r) / 4];
  for (let i = 0; i < seg; i++) {
    const [ax, ay] = pt(i), [bx, by] = pt(i + 1);
    b.quad(gd, [cx, cy, z + 0.02], [ax, ay, z + 0.02], [bx, by, z + 0.02], [bx, by, z + 0.02], [uv(cx, cy), uv(ax, ay), uv(bx, by), uv(bx, by)], [0, 0, 1]);
  }
  const F = P.trim || P.frame;
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    b.push().translate(cx, cy, z + 0.02).rotateZ(a);
    b.box(F, 0, -0.035, 0, r, 0.035, 0.08, SKIP.nz);
    b.pop();
  }
  // inner ring at the glass + outer molding around the opening
  b.push().translate(cx, cy, 0).rotateX(Math.PI / 2); // local +y = facade +z
  b.cyl(F, 0, 0, r * 0.3, r * 0.3, -depth + 0.02, -depth + 0.1, seg, { top: true, bottom: false });
  b.lathe(F, 0, 0, [[r + 0.18, 0], [r + 0.18, 0.06], [r, 0.06]], seg);
  b.pop();
}
