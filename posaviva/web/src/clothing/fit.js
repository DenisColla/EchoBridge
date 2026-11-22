// Garment fitting on the coarse (body-resolution) garment surface:
//   hangFit       loose garments hang from the widest parts (chest, hips,
//                 thigh, biceps) instead of following every body concavity
//   bridgeSmooth  outward-only membrane smoothing with a minimum-offset
//                 constraint: fabric bridges cleavage, spine groove, buttocks
//                 and toes but never sinks into the body
//   smoothWeights skin weight diffusion for loose parts (no tearing)
import { LIMB_REGIONS, PART, NPART } from './body.js';
import { hull2, hullRadius, len2, len3 } from './mesh.js';

const NTH = 36; // angular bins of the hang grid
/** Torso hang direction: the radial direction with its lateral part scaled by this (towards front / back). */
const TORSO_SQUEEZE = 0.15;
const DS = 0.015; // axial bin size (m)

/**
 * Loose-fit pass. For each region with garment vertices, a cylindrical grid
 * (axial x angular) stores the outer radius the fabric must reach; it is
 * propagated "downstream" (down the torso / along the limbs) with a maximal
 * taper slope so fabric hangs straight from protrusions. Vertices below the
 * envelope move radially outward by looseness * gap.
 * c: coarse context {n, body (Int32 body vertex per coarse vertex), P0, N0, off, G, coords}
 */
export function hangFit(c, bi, opts) {
  const { innerSlope = 1.2, torsoStartY = bi.land.armpit - 0.02, fade = null, hullAmount = 0 } = opts;
  const base = { loose: opts.loose ?? 0, slope: opts.slope ?? 0.4, bridgeSlope: opts.bridgeSlope ?? 0.8 };
  const optsOf = (R) => (R === 0 ? base : (R <= 2 ? opts.arm : opts.leg) || base);
  const idle = (o) => o.loose <= 0.001 && o.bridgeSlope >= 1.9;
  if (idle(base) && hullAmount <= 0 && !(opts.membrane > 0) && !(opts.seatBridge > 0) && (!opts.arm || idle(opts.arm)) && (!opts.leg || idle(opts.leg))) return;
  const { n, P0, off, G, coords } = c;
  const span = c.span || null;
  const tmp = new Float32Array(9);
  const regions = [0, ...LIMB_REGIONS];
  const rv = new Float32Array(n), sv = new Float32Array(n), tv = new Float32Array(n), dirs = new Float32Array(n * 3);
  for (const R of regions) {
    const { loose, slope, bridgeSlope } = optsOf(R);
    // limbs: the upper segment (thigh / upper arm) may taper faster than the lower one
    // (regular jeans narrow from the thigh to the knee, then fall straight to the hem)
    const slopeUpper = R === 0 ? slope : optsOf(R).slopeUpper ?? slope;
    const seg0 = R === 0 ? Infinity : bi.limbs[R].L[0];
    if (R !== 0 && idle(optsOf(R))) continue;
    // limbs: only the limb itself seeds its envelope. Above the joint (negative
    // axial coordinate) the cross-section reaches the shoulder top / armpit wall
    // or the buttock: carried down the limb, it puffs the sleeve cap like a balloon.
    const seedMin = R === 0 ? -Infinity : R <= 2 ? 0.0 : -0.04;
    // gather member vertices
    let smin = Infinity, smax = -Infinity, count = 0;
    for (let i = 0; i < n; i++) {
      const w = R === 0 ? coords.wT[i] : (coords.limb[i] === R ? 1 - coords.wT[i] : 0);
      if (w < 0.3) { rv[i] = -1; continue; }
      const x = P0[i * 3], y = P0[i * 3 + 1], z = P0[i * 3 + 2];
      let s;
      if (R === 0) { bi.torsoCyl(x, y, z, tmp); s = -y; } else { const a = coords.aL[i]; bi.limbs[R].cyl(Math.max(0, a), x, y, z, tmp); s = bi.limbs[R].metric(a); }
      if (s < seedMin) { rv[i] = -1; continue; }
      rv[i] = tmp[1] + off[i]; sv[i] = s; tv[i] = tmp[0];
      dirs[i * 3] = tmp[5]; dirs[i * 3 + 1] = tmp[6]; dirs[i * 3 + 2] = tmp[7];
      if (s < smin) smin = s;
      if (s > smax) smax = s;
      count++;
    }
    if (count < 8) continue;
    const rows = Math.max(1, Math.ceil((smax - smin) / DS) + 1);
    const grid = new Float32Array(rows * NTH).fill(-1);
    const cell = (s, th) => {
      const r = Math.min(rows - 1, Math.max(0, Math.floor((s - smin) / DS)));
      const t = ((Math.floor(((th + Math.PI) / (2 * Math.PI)) * NTH) % NTH) + NTH) % NTH;
      return r * NTH + t;
    };
    for (let i = 0; i < n; i++) if (rv[i] >= 0) { const k = cell(sv[i], tv[i]); if (rv[i] > grid[k]) grid[k] = rv[i]; }
    // fill empty cells of each row by interpolating (around the circle) between the
    // nearest known cells on both sides — a one-sided sweep would carry the hip's
    // radius across the empty centre-back cells (a lopsided hem, a slit at the
    // back); empty rows copy the previous one
    const known = new Int32Array(NTH);
    for (let r = 0; r < rows; r++) {
      const o = r * NTH;
      let m = 0;
      for (let t = 0; t < NTH; t++) if (grid[o + t] >= 0) known[m++] = t;
      if (!m) { if (r > 0) for (let t = 0; t < NTH; t++) grid[o + t] = grid[o - NTH + t]; continue; }
      for (let q = 0; q < m; q++) {
        const a = known[q], b = known[(q + 1) % m], gap = (b - a + NTH) % NTH || NTH;
        // small holes: the larger neighbour (fabric spans them); long runs: interpolated
        for (let k = 1; k < gap; k++) grid[o + ((a + k) % NTH)] = gap <= 3 ? Math.max(grid[o + a], grid[o + b]) : grid[o + a] + ((grid[o + b] - grid[o + a]) * k) / gap;
      }
    }
    // angular spread: fabric spans over small dips around the cross-section
    const row = new Float32Array(NTH);
    for (let r = 0; r < rows; r++) {
      const o = r * NTH;
      for (let t = 0; t < NTH; t++) row[t] = grid[o + t];
      for (let t = 0; t < NTH; t++) {
        const m = Math.max(row[(t + 1) % NTH], row[(t + NTH - 1) % NTH]) * 0.985;
        if (m > grid[o + t]) grid[o + t] = m;
      }
    }
    // two envelopes propagated down the axis with a maximal taper:
    //   bridge (steep): stiff fabric cannot follow steep concavities (under the bust, behind the knee)
    //   drape (fit dependent): loose fabric hangs straight from chest / hips / thigh / biceps
    const start = R === 0 ? -torsoStartY : 0.0;
    const gridB = grid.slice();
    // torso: horizontal convex hull per row below the armpits -> woven / knit
    // fabric spans straight across the cleavage, the spine groove, the buttocks
    if (R === 0 && hullAmount > 0) {
      const rowPts = Array.from({ length: rows }, () => []);
      for (let i = 0; i < n; i++) {
        if (rv[i] < 0) continue;
        const y = -sv[i];
        if (y > bi.land.armpit - 0.025) continue;
        const r = Math.min(rows - 1, Math.max(0, Math.floor((sv[i] - smin) / DS)));
        rowPts[r].push(-Math.sin(tv[i]) * rv[i], Math.cos(tv[i]) * rv[i]);
      }
      for (let r = 0; r < rows; r++) {
        const pts = rowPts[r];
        if (pts.length < 12) continue;
        const h = hull2(pts);
        if (h.length < 3) continue;
        for (let t = 0; t < NTH; t++) {
          const th = ((t + 0.5) / NTH) * 2 * Math.PI - Math.PI;
          const rh = hullRadius(h, -Math.sin(th), Math.cos(th)) * hullAmount + gridB[r * NTH + t] * (1 - hullAmount);
          if (rh > gridB[r * NTH + t]) gridB[r * NTH + t] = rh;
        }
      }
    }
    const propagate = (g, baseLo, baseUp = baseLo) => {
      for (let r = 1; r < rows; r++) {
        const s = smin + r * DS;
        if (s < start) continue;
        const base = s < seg0 ? baseUp : baseLo;
        for (let t = 0; t < NTH; t++) {
          let sl = base;
          if (R !== 0) {
            // inner side of limbs (towards the body / other leg) may not bulge
            const th = (t + 0.5) / NTH * 2 * Math.PI - Math.PI;
            const inner = Math.max(0, -Math.cos(th));
            sl = base + (Math.max(innerSlope, base) - base) * inner * inner;
          }
          const prev = g[(r - 1) * NTH + t] - sl * DS;
          if (prev > g[r * NTH + t]) g[r * NTH + t] = prev;
        }
      }
    };
    propagate(grid, slope, slopeUpper);
    propagate(gridB, bridgeSlope);
    // move vertices outward
    for (let i = 0; i < n; i++) {
      if (rv[i] < 0) continue;
      const w = R === 0 ? coords.wT[i] : 1 - coords.wT[i];
      // bilinear lookup (row of this vertex, any angle)
      const fr = Math.max(0, Math.min(rows - 1.001, (sv[i] - smin) / DS - 0.5));
      const r0 = Math.floor(fr), r1 = Math.min(rows - 1, r0 + 1), ar = fr - r0;
      const look = (G2, th) => {
        const ft = ((th + Math.PI) / (2 * Math.PI)) * NTH - 0.5;
        const t0 = ((Math.floor(ft) % NTH) + NTH) % NTH, t1 = (t0 + 1) % NTH, at = ft - Math.floor(ft);
        return (G2[r0 * NTH + t0] * (1 - at) + G2[r0 * NTH + t1] * at) * (1 - ar) + (G2[r1 * NTH + t0] * (1 - at) + G2[r1 * NTH + t1] * at) * ar;
      };
      const target = look(grid, tv[i]), targetB = look(gridB, tv[i]);
      const f = Math.min(1, w * 1.4) * (fade ? fade[i] : 1);
      const dRaw = Math.max(Math.max(0, targetB - rv[i]), Math.max(0, target - rv[i]) * loose);
      // taut span (stiff bridging, not slack drape): wrinkle valleys stay shallow there
      if (span) { const b = Math.max(0, targetB - rv[i]) * f; if (b > span[i]) span[i] = b; }
      if (dRaw * f < 1e-5) continue;
      if (R !== 0) {
        const d = dRaw * f;
        G[i * 3] += dirs[i * 3] * d; G[i * 3 + 1] += dirs[i * 3 + 1] * d; G[i * 3 + 2] += dirs[i * 3 + 2] * d;
        continue;
      }
      // Torso: fabric hanging from a protrusion (bust, belly, shoulder blades,
      // buttocks) falls straight down in front of / behind it, so a vertex below
      // it moves forward or back, not out along the radius from the body axis
      // (that would shove the fabric under a breast sideways and leave the front
      // clinging to the under-bust). Direction: the radial one squeezed towards
      // the front-back axis; distance: where that line meets the envelope.
      const rx0 = dirs[i * 3], rz0 = dirs[i * 3 + 2];
      let ux = rx0 * TORSO_SQUEEZE, uz = rz0;
      const ul = Math.hypot(ux, uz) || 1;
      ux /= ul; uz /= ul;
      const qx = rx0 * rv[i], qz = rz0 * rv[i]; // the vertex at its garment radius, relative to the axis
      let t = dRaw / Math.max(0.35, ux * rx0 + uz * rz0);
      for (let k = 0; k < 3; k++) {
        const px = qx + ux * t, pz = qz + uz * t, r = Math.hypot(px, pz) || 1e-6;
        const th = Math.atan2(-px, pz);
        const want = Math.max(look(gridB, th), rv[i] + loose * Math.max(0, look(grid, th) - rv[i]));
        t = Math.max(0, t + (want - r) / Math.max(0.35, (ux * px + uz * pz) / r));
      }
      // never more than a generous share past the radial estimate (degenerate angles)
      t = Math.min(t, dRaw * 2.5 + 0.01) * f;
      G[i * 3] += ux * t; G[i * 3 + 2] += uz * t;
    }
  }
  if (opts.seatBridge > 0) seatHull(c, bi, opts.seatBridge, fade);
  const membrane = opts.membrane || 0, tension = opts.tension;
  depthHang(c, bi, { ...base, torsoStartY, fade, span, membrane, tension });
  // A bridged span (under the bust, over the lumbar hollow) is a near-vertical
  // sheet, but the body surface it was made from wraps around the crease below
  // the protrusion: projected onto the sheet its vertices come out folded over
  // each other. Relax them within the sheet (x, y only), then snap their depth
  // back onto the envelope.
  if (span) {
    const { adj } = c;
    const k = new Float32Array(n);
    let any = false;
    for (let i = 0; i < n; i++) if (coords.wT[i] >= 0.5 && !c.bnd[i]) { k[i] = Math.min(1, Math.max(0, (span[i] - 0.005) / 0.012)); if (k[i] > 0) any = true; }
    if (any) {
      const tmp = new Float32Array(n * 2);
      for (let it = 0; it < SPAN_RELAX; it++) {
        for (let i = 0; i < n; i++) {
          tmp[i * 2] = G[i * 3]; tmp[i * 2 + 1] = G[i * 3 + 1];
          if (!k[i]) continue;
          let ax = 0, ay = 0, m = 0;
          for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j] * 3; ax += G[u]; ay += G[u + 1]; m++; }
          if (!m) continue;
          const w = 0.5 * k[i];
          tmp[i * 2] = G[i * 3] + w * (ax / m - G[i * 3]); tmp[i * 2 + 1] = G[i * 3 + 1] + w * (ay / m - G[i * 3 + 1]);
        }
        for (let i = 0; i < n; i++) if (k[i]) { G[i * 3] = tmp[i * 2]; G[i * 3 + 1] = tmp[i * 2 + 1]; }
      }
      depthHang(c, bi, { ...base, torsoStartY, fade, span: null, membrane, tension });
    }
  }
}

/** Seat bridge band in torso coordinates T: fades in above the crotch, out over the waist. */
const SEAT_T = [0.12, 0.45, 1.35, 1.8];
/** Most a vertex moves out to the seat hull (m): the gluteal cleft, the groin V. */
const SEAT_MAX = 0.03;

/**
 * Trousers bridge the seat and the crotch with their seat / crotch seams: per
 * horizontal row between the crotch and the waist, every garment vertex (torso
 * and legs alike: the gluteal cleft and the groin lie on leg-weighted vertices of
 * two limbs, which no per-limb envelope spans) moves out towards the convex hull
 * of the row, radially from the torso axis. Downward-facing vertices (the
 * perineum) are left alone; amount 0..1.
 */
function seatHull(c, bi, amount, fade) {
  const { n, G, N0 } = c;
  const y0 = bi.yOfT(SEAT_T[0]), y1 = bi.yOfT(SEAT_T[3]);
  const rows = Math.max(1, Math.ceil((y1 - y0) / DS));
  const lists = Array.from({ length: rows }, () => []);
  for (let i = 0; i < n; i++) {
    const y = G[i * 3 + 1];
    if (y < y0 || y >= y1 || c.bnd[i]) continue;
    if (Math.abs(N0[i * 3 + 1]) > 0.7) continue;
    lists[Math.min(rows - 1, Math.floor((y - y0) / DS))].push(i);
  }
  const ramp = (t) => {
    const a = Math.min(1, Math.max(0, (t - SEAT_T[0]) / (SEAT_T[1] - SEAT_T[0]))), b = Math.min(1, Math.max(0, (SEAT_T[3] - t) / (SEAT_T[3] - SEAT_T[2])));
    return a * a * (3 - 2 * a) * b * b * (3 - 2 * b);
  };
  for (let r = 0; r < rows; r++) {
    const L = lists[r];
    if (L.length < 12) continue;
    const yc = y0 + (r + 0.5) * DS, cz = bi.cz(yc), k = amount * ramp(bi.T(yc));
    if (k <= 0) continue;
    const pts = [];
    for (const i of L) pts.push(G[i * 3], G[i * 3 + 2] - cz);
    const h = hull2(pts);
    if (h.length < 3) continue;
    for (const i of L) {
      const x = G[i * 3], z = G[i * 3 + 2] - cz, rr = len2(x, z);
      if (rr < 0.02) continue;
      const push = Math.min(SEAT_MAX, hullRadius(h, x / rr, z / rr) - rr) * k * (fade ? fade[i] : 1);
      if (push <= 0) continue;
      G[i * 3] += (x / rr) * push; G[i * 3 + 2] += (z / rr) * push;
    }
  }
}

/** Relaxation passes over bridged spans (see hangFit). */
const SPAN_RELAX = 12;

/**
 * Front / back depth maps of the torso (z per x column and height, as seen from
 * the front and from the back), propagated down each column with the bridge and
 * drape slopes: fabric falls straight down from the bust or belly apex, the
 * shoulder blades, the buttocks, whatever their distance from the body axis
 * (the cylindrical envelope smears off-axis protrusions over its angle bins).
 * Front-facing vertices move forward, back-facing ones backward.
 */
function depthHang(c, bi, o) {
  const { n, G, N0, coords } = c;
  const { loose, slope, bridgeSlope, torsoStartY, fade, span } = o;
  if (loose <= 0.001 && bridgeSlope >= 1.9 && !(o.membrane > 0)) return;
  const DX = 0.01, DY = 0.01, X0 = -0.5, NX = 100;
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < n; i++) if (coords.wT[i] >= 0.3) { const y = G[i * 3 + 1]; if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  if (!(ymax > ymin)) return;
  const rows = Math.ceil((ymax - ymin) / DY) + 1;
  for (const side of [1, -1]) {
    const M = new Float32Array(rows * NX).fill(NaN);
    // how much a vertex faces this side: the horizontal part of its normal, or
    // facing down on this side of the body (the underside of the bust, of the belly,
    // of the seat: it faces the floor, even a little inwards, yet the fabric hangs here)
    // (only on this side of the body axis: never pull the front to the back map)
    const facing = (i) => {
      const dz = side * (G[i * 3 + 2] - bi.cz(G[i * 3 + 1]));
      if (dz <= 0) return 0;
      const nx = N0[i * 3], ny = N0[i * 3 + 1], nz = N0[i * 3 + 2];
      const h = (side * nz) / Math.max(0.25, Math.hypot(nx, nz));
      const ahead = dz > 0.03 ? Math.min(1, Math.max(0, (-ny - 0.4) / 0.4)) : 0;
      return Math.max(h, ahead * 0.5);
    };
    for (let i = 0; i < n; i++) {
      if (coords.wT[i] < 0.3 || facing(i) < 0.1) continue;
      const col = Math.round((G[i * 3] - X0) / DX), row = Math.round((ymax - G[i * 3 + 1]) / DY);
      if (col < 0 || col >= NX) continue;
      const k = row * NX + col, z = G[i * 3 + 2] * side;
      if (!(M[k] >= z)) M[k] = z;
    }
    // close small gaps along each row (linear between known cells, no extrapolation)
    for (let r = 0; r < rows; r++) {
      let last = -1;
      for (let x = 0; x < NX; x++) {
        const v = M[r * NX + x];
        if (v !== v) continue;
        if (last >= 0 && x - last > 1 && x - last <= 4) for (let q = last + 1; q < x; q++) M[r * NX + q] = M[r * NX + last] + ((v - M[r * NX + last]) * (q - last)) / (x - last);
        last = x;
      }
    }
    const MB = M.slice(), MD = M.slice();
    const r0 = Math.max(1, Math.ceil((ymax - torsoStartY) / DY));
    for (let r = r0; r < rows; r++) for (let x = 0; x < NX; x++) {
      const k = r * NX + x, u = k - NX;
      const b = MB[u] - bridgeSlope * DY, d = MD[u] - slope * DY;
      // only where the column exists at this height (no fabric conjured outside the body outline)
      if (M[k] !== M[k]) continue;
      if (b > MB[k]) MB[k] = b;
      if (d > MD[k]) MD[k] = d;
    }
    if (o.membrane > 0) membraneEnvelope(MB, rows, NX, Math.max(0, Math.floor((ymax - bi.land.armpit - MEMBRANE_ABOVE) / DY)), o.membrane, o.tension ?? MEMBRANE_TENSION);
    for (let i = 0; i < n; i++) {
      if (coords.wT[i] < 0.3) continue;
      const fz = facing(i);
      if (fz < 0.1) continue;
      const cx = (G[i * 3] - X0) / DX, ry = (ymax - G[i * 3 + 1]) / DY;
      const x0 = Math.floor(cx), y0 = Math.floor(ry), ax = cx - x0, ay = ry - y0;
      if (x0 < 0 || x0 + 1 >= NX || y0 < 0 || y0 + 1 >= rows) continue;
      const look = (A) => {
        let s = 0, w = 0;
        for (const [k, kw] of [[y0 * NX + x0, (1 - ax) * (1 - ay)], [y0 * NX + x0 + 1, ax * (1 - ay)], [(y0 + 1) * NX + x0, (1 - ax) * ay], [(y0 + 1) * NX + x0 + 1, ax * ay]]) { const v = A[k]; if (v === v) { s += v * kw; w += kw; } }
        return w > 0 ? s / w : NaN;
      };
      const zb = look(MB), zd = look(MD), z = G[i * 3 + 2] * side;
      if (zb !== zb) continue;
      const fb = Math.max(0, zb - z), fd = Math.max(0, (zd === zd ? zd : z) - z) * loose;
      const k = Math.min(1, coords.wT[i] * 1.4) * Math.min(1, (fz - 0.1) / 0.3) * (fade ? fade[i] : 1);
      const dz = Math.max(fb, fd) * k;
      if (dz <= 0) continue;
      if (span && fb * k > span[i]) span[i] = fb * k;
      G[i * 3 + 2] += dz * side;
    }
  }
}

/** Rows above the armpit where the membrane starts (the clavicles anchor it), m. */
const MEMBRANE_ABOVE = 0.1;
/** Sag of the membrane over a span: K * (half span)^2 (m; 2 cm over a 20 cm span). */
const MEMBRANE_TENSION = 2.0;
/** Half spans (cells) and directions of the membrane relaxation. */
const MEMBRANE_STEPS = [1, 2, 3, 4, 6, 8, 11];
const MEMBRANE_DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];

/**
 * 2-D membrane over a depth map (in place): fabric stretched over the bust, the
 * belly, the shoulder blades spans the hollows between them in every direction
 * (cleavage, upper slope of the bust, spine groove, between the scapulae) instead
 * of following each dome. Each cell rises to the midpoint of any pair of cells
 * around it, minus a sag growing with the square of the span (a tensioned sheet,
 * not a rigid hull), a few Gauss-Seidel sweeps; the result is blended in by amount.
 * M: depth per cell (NaN = no fabric), rows x NX, rows >= rowStart may move.
 */
function membraneEnvelope(M, rows, NX, rowStart, amount, K) {
  const E = M.slice();
  const pairs = [];
  for (const [dx, dy] of MEMBRANE_DIRS) for (const s of MEMBRANE_STEPS) {
    const d = s * 0.01 * Math.hypot(dx, dy);
    pairs.push(dx * s, dy * s, K * d * d);
  }
  for (let it = 0; it < 8; it++) {
    for (let r = rowStart; r < rows; r++) for (let x = 0; x < NX; x++) {
      const k = r * NX + x;
      let best = E[k];
      if (best !== best) continue;
      for (let q = 0; q < pairs.length; q += 3) {
        const ox = pairs[q], oy = pairs[q + 1];
        const xa = x - ox, xb = x + ox, ra = r - oy, rb = r + oy;
        if (xa < 0 || xb < 0 || xa >= NX || xb >= NX || ra < 0 || rb < 0 || ra >= rows || rb >= rows) continue;
        const a = E[ra * NX + xa], b = E[rb * NX + xb];
        if (a !== a || b !== b) continue;
        const cand = (a + b) * 0.5 - pairs[q + 2];
        if (cand > best) best = cand;
      }
      E[k] = best;
    }
  }
  for (let k = 0; k < M.length; k++) if (M[k] === M[k]) M[k] += (E[k] - M[k]) * amount;
}

/**
 * Outward-only Laplacian smoothing (tangential relaxation + normal fill of
 * concavities) with the per-vertex minimum offset constraint. Boundary
 * vertices are smoothed along their loop only (straight, clean hems).
 */
export function bridgeSmooth(c, iterations, opts = {}) {
  const { n, P0, N0, off, G, adj, bnd, bprev, bnext } = c;
  const { tangential = 0.3, normal = 0.6 } = opts;
  const tmp = new Float32Array(n * 3);
  // edge-length weights: metric (not topological) smoothing, so dense vertex
  // clusters (nipples, navel) follow the surrounding surface
  const W = new Float32Array(adj.adj.length);
  for (let i = 0; i < n; i++) for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j]; W[j] = len3(P0[u * 3] - P0[i * 3], P0[u * 3 + 1] - P0[i * 3 + 1], P0[u * 3 + 2] - P0[i * 3 + 2]) + 1e-5; }
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      let ax = 0, ay = 0, az = 0, cnt = 0;
      if (bnd[i]) {
        const a = bprev[i], b = bnext[i];
        if (a >= 0 && b >= 0) { ax = G[a * 3] + G[b * 3]; ay = G[a * 3 + 1] + G[b * 3 + 1]; az = G[a * 3 + 2] + G[b * 3 + 2]; cnt = 2; }
      } else {
        for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j] * 3, w = W[j]; ax += G[u] * w; ay += G[u + 1] * w; az += G[u + 2] * w; cnt += w; }
      }
      if (!cnt) { tmp[o] = G[o]; tmp[o + 1] = G[o + 1]; tmp[o + 2] = G[o + 2]; continue; }
      const lx = ax / cnt - G[o], ly = ay / cnt - G[o + 1], lz = az / cnt - G[o + 2];
      const nx = N0[o], ny = N0[o + 1], nz = N0[o + 2];
      const ln = lx * nx + ly * ny + lz * nz;
      const tx = lx - ln * nx, ty = ly - ln * ny, tz = lz - ln * nz;
      const k = ln > 0 ? ln * normal : 0;
      const tw = bnd[i] ? tangential * 0.6 : tangential;
      tmp[o] = G[o] + tx * tw + nx * k;
      tmp[o + 1] = G[o + 1] + ty * tw + ny * k;
      tmp[o + 2] = G[o + 2] + tz * tw + nz * k;
    }
    G.set(tmp);
    enforceOffset(n, G, P0, N0, off);
    if (c.hard) enforceOffset(n, G, c.hard.P0, c.hard.N0, c.hard.offMin);
  }
}

/**
 * Final low-pass of the garment surface (edge-length weighted Laplacian,
 * interior vertices), then the offset constraints again. Removes any fabric
 * detail smaller than a couple of centimetres left by the body topology.
 */
export function metricSmooth(c, iterations) {
  const { n, P0, N0, off, G, adj, bnd } = c;
  if (iterations <= 0) return;
  const W = new Float32Array(adj.adj.length);
  for (let i = 0; i < n; i++) for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j]; W[j] = len3(P0[u * 3] - P0[i * 3], P0[u * 3 + 1] - P0[i * 3 + 1], P0[u * 3 + 2] - P0[i * 3 + 2]) + 1e-5; }
  const tmp = new Float32Array(n * 3);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      if (bnd[i]) { tmp[o] = G[o]; tmp[o + 1] = G[o + 1]; tmp[o + 2] = G[o + 2]; continue; }
      let ax = 0, ay = 0, az = 0, ws = 0;
      for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j] * 3, w = W[j]; ax += G[u] * w; ay += G[u + 1] * w; az += G[u + 2] * w; ws += w; }
      tmp[o] = G[o] * 0.5 + (ax / ws) * 0.5; tmp[o + 1] = G[o + 1] * 0.5 + (ay / ws) * 0.5; tmp[o + 2] = G[o + 2] * 0.5 + (az / ws) * 0.5;
    }
    G.set(tmp);
    enforceOffset(n, G, P0, N0, off);
    if (c.hard) enforceOffset(n, G, c.hard.P0, c.hard.N0, c.hard.offMin);
  }
}

/** G >= body + normal * off (signed distance along the body normal). */
export function enforceOffset(n, G, B, NB, off, slack = 0) {
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const d = (G[o] - B[o]) * NB[o] + (G[o + 1] - B[o + 1]) * NB[o + 1] + (G[o + 2] - B[o + 2]) * NB[o + 2];
    const need = off[i] - slack;
    if (d < need) { const k = need - d; G[o] += NB[o] * k; G[o + 1] += NB[o + 1] * k; G[o + 2] += NB[o + 2] * k; }
  }
}

/**
 * Dense skin weights over the bones used by the garment, diffused over the
 * coarse adjacency. W: Float32Array(n * nb) (in/out); amount: per-vertex 0..1.
 */
export function smoothWeights(n, nb, W, adj, iterations, amount) {
  if (iterations <= 0) return;
  const tmp = new Float32Array(W.length);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < n; i++) {
      const o = i * nb, k = amount ? amount[i] : 1;
      const deg = adj.off[i + 1] - adj.off[i];
      if (!deg || k <= 0) { for (let b = 0; b < nb; b++) tmp[o + b] = W[o + b]; continue; }
      for (let b = 0; b < nb; b++) {
        let s = 0;
        for (let j = adj.off[i]; j < adj.off[i + 1]; j++) s += W[adj.adj[j] * nb + b];
        tmp[o + b] = W[o + b] * (1 - 0.5 * k) + (s / deg) * 0.5 * k;
      }
    }
    W.set(tmp);
  }
}

/** Top-4 bone weights from dense rows. Returns {idx: Uint16Array(n*4), w: Float32Array(n*4)}. */
export function top4(n, nb, W, boneIds) {
  const idx = new Uint16Array(n * 4), w = new Float32Array(n * 4);
  const bi = [0, 0, 0, 0], bw = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    bw[0] = bw[1] = bw[2] = bw[3] = 0; bi[0] = bi[1] = bi[2] = bi[3] = 0;
    const o = i * nb;
    for (let b = 0; b < nb; b++) {
      const x = W[o + b];
      if (x <= bw[3]) continue;
      let k = 3;
      while (k > 0 && x > bw[k - 1]) { bw[k] = bw[k - 1]; bi[k] = bi[k - 1]; k--; }
      bw[k] = x; bi[k] = b;
    }
    const s = bw[0] + bw[1] + bw[2] + bw[3] || 1;
    for (let k = 0; k < 4; k++) { idx[i * 4 + k] = boneIds[bi[k]]; w[i * 4 + k] = bw[k] / s; }
  }
  return { idx, w };
}

/**
 * Shoes / socks: every foot vertex is pushed out to the convex hull of its
 * cross-section slab (perpendicular to the foot axis), so toe gaps, the arch
 * and small dips are bridged into one toe box; amount 0..1.
 */
export function footEnvelope(c, bi, amount = 1, iterations = 14) {
  const { n, adj, coords, body } = c;
  const topo = bi.topo, PW = topo.partW;
  const foot = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const o = body[i] * NPART; if ((coords.limb[i] === 3 || coords.limb[i] === 4) && PW[o + PART.footL] + PW[o + PART.footR] >= 0.3) foot[i] = 1; }
  // alternate: push out to the slab hulls, relax on the surface (untangles the
  // collapsed toe-gap walls), push again
  const tmp = new Float32Array(n * 3);
  for (let it = 0; it < iterations; it++) {
    footHull(c, bi, amount);
    const G = c.G;
    tmp.set(G);
    for (let i = 0; i < n; i++) {
      if (!foot[i] || c.bnd[i]) continue;
      let ax = 0, ay = 0, az = 0, k = 0;
      for (let j = adj.off[i]; j < adj.off[i + 1]; j++) { const u = adj.adj[j] * 3; ax += G[u]; ay += G[u + 1]; az += G[u + 2]; k++; }
      if (!k) continue;
      tmp[i * 3] = G[i * 3] * 0.4 + (ax / k) * 0.6; tmp[i * 3 + 1] = G[i * 3 + 1] * 0.4 + (ay / k) * 0.6; tmp[i * 3 + 2] = G[i * 3 + 2] * 0.4 + (az / k) * 0.6;
    }
    G.set(tmp);
  }
  footHull(c, bi, amount);
}

function footHull(c, bi, amount) {
  const { n, G, coords, body } = c;
  const topo = bi.topo, PW = topo.partW;
  for (const R of [3, 4]) {
    const L = bi.limbs[R];
    const ax = L.J[6], ay = L.J[7], az = L.J[8];
    const D = [L.D[6], L.D[7], L.D[8]], RR = [L.R[6], L.R[7], L.R[8]], Q = [L.Q[6], L.Q[7], L.Q[8]];
    const rows = new Map();
    const idx = [], uu = [], vv = [], tt = [];
    for (let i = 0; i < n; i++) {
      if (coords.limb[i] !== R) continue;
      const v = body[i], o = v * NPART;
      if (PW[o + PART.footL] + PW[o + PART.footR] < 0.3) continue;
      const x = G[i * 3] - ax, y = G[i * 3 + 1] - ay, z = G[i * 3 + 2] - az;
      const t = x * D[0] + y * D[1] + z * D[2];
      const u = x * RR[0] + y * RR[1] + z * RR[2], w = x * Q[0] + y * Q[1] + z * Q[2];
      const row = Math.round(t / 0.008);
      if (!rows.has(row)) rows.set(row, []);
      rows.get(row).push(idx.length);
      idx.push(i); uu.push(u); vv.push(w); tt.push(t);
    }
    for (const list of rows.values()) {
      if (list.length < 5) continue;
      // centre of the slab, hull of its points
      let cu = 0, cv = 0;
      for (const k of list) { cu += uu[k]; cv += vv[k]; }
      cu /= list.length; cv /= list.length;
      const pts = [];
      for (const k of list) pts.push(uu[k] - cu, vv[k] - cv);
      const h = hull2(pts);
      if (h.length < 3) continue;
      for (const k of list) {
        const du = uu[k] - cu, dv = vv[k] - cv, r = len2(du, dv);
        if (r < 1e-5) continue;
        const rh = hullRadius(h, du / r, dv / r);
        if (rh <= r) continue;
        const push = (rh - r) * amount, i = idx[k];
        const ex = (RR[0] * du + Q[0] * dv) / r, ey = (RR[1] * du + Q[1] * dv) / r, ez = (RR[2] * du + Q[2] * dv) / r;
        G[i * 3] += ex * push; G[i * 3 + 1] += ey * push; G[i * 3 + 2] += ez * push;
      }
    }
  }
}
