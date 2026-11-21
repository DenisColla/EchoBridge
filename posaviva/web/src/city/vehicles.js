// Procedural vehicles (believable proportions, real dimensions in meters).
// Cars, vans and pick-ups share a lofted body: a lower body (rounded section
// swept along the length, with wheel arches cut into its bottom line) and a
// greenhouse (tapered cabin). Every quad of the loft is routed to a material
// role by where it is (windows, pillars, roof, cladding, livery stripes), so
// windows and pillars need no overlays (no z-fighting) and get crisp borders.
// Buses and trucks are built from boxes; two-wheelers from tubes.
// Front = +Z, origin on the floor at the footprint center, X = width.
import * as THREE from 'three';
import { box, cylinder, rod, sphere, tube, latheX, cylX, rng, DEG, place } from './util.js';
import { seed as seedParam, seg, range, flag } from '../props/params.js';

const PAINTS = ['#c9ccd1', '#1d1f22', '#f2f2ef', '#8c1c1c', '#1f3a6b', '#5d6066', '#2f4f3a', '#d9b23a', '#7a2f1f', '#4a6d8c', '#b8b2a6', '#3b4a5c'];
export const VEHICLE_COLORS = PAINTS;

// ------------------------------------------------------------------ loft with per-quad roles
/**
 * rings: array (stations) of arrays of [x, y, z]; closed ring or open strip.
 * classify(i, j) -> role for the quad between stations i, i+1 and points j, j+1.
 * Smooth normals come from the whole loft, so the role split keeps the shading continuous.
 */
function loftRoles(rings, { closed, classify, out, flipCheck }) {
  const n = rings.length, m = rings[0].length;
  const M = closed ? m : m - 1; // segments per ring
  const pos = new Float32Array(n * m * 3);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const p = rings[i][j], k = (i * m + j) * 3; pos[k] = p[0]; pos[k + 1] = p[1]; pos[k + 2] = p[2]; }
  const idx = [];
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < M; j++) {
    const a = i * m + j, b = i * m + ((j + 1) % m), c = a + m, d = b + m;
    idx.push(a, c, b, b, c, d);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // orientation check: the given vertex must have a normal along the given direction
  if (flipCheck) {
    const [vi, dir] = flipCheck;
    const nn = g.attributes.normal;
    if (nn.getX(vi) * dir[0] + nn.getY(vi) * dir[1] + nn.getZ(vi) * dir[2] < 0) {
      for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
      g.setIndex(idx);
      g.computeVertexNormals();
    }
  }
  const nor = g.attributes.normal.array;
  const buckets = new Map();
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < M; j++) {
    const role = classify(i, j);
    if (!role) continue;
    let b = buckets.get(role);
    if (!b) { b = { p: [], n: [] }; buckets.set(role, b); }
    const t0 = (i * M + j) * 6;
    for (let t = 0; t < 6; t++) {
      const v = idx[t0 + t];
      b.p.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      b.n.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
    }
  }
  g.dispose();
  for (const [role, b] of buckets) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((b.p.length / 3) * 2), 2));
    (out[role] ||= []).push(geo);
  }
}

/** End cap fan of a closed ring (flat), normal along dir. */
function capFan(ring, dir, role, out) {
  const n = ring.length;
  let cx = 0, cy = 0, cz = 0;
  for (const p of ring) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= n; cy /= n; cz /= n;
  const pos = [];
  for (let j = 0; j < n; j++) {
    const a = ring[j], b = ring[(j + 1) % n];
    pos.push(cx, cy, cz, a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const nn = g.attributes.normal;
  if (nn.count && nn.getX(0) * dir[0] + nn.getY(0) * dir[1] + nn.getZ(0) * dir[2] < 0) {
    for (let k = 0; k < pos.length; k += 9) for (let q = 0; q < 3; q++) { const t = pos[k + 3 + q]; pos[k + 3 + q] = pos[k + 6 + q]; pos[k + 6 + q] = t; }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
  }
  (out[role] ||= []).push(g);
}

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const lerp = (a, b, t) => a + (b - a) * t;

/** Vertex-colored box (lights, plates). */
function vcBox(w, h, d, t, hex) {
  const g = box(w, h, d, t);
  const c = new THREE.Color(hex).convertSRGBToLinear();
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function vc(g, hex) {
  const c = new THREE.Color(hex).convertSRGBToLinear();
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// ------------------------------------------------------------------ wheels
function wheel(out, x, y, z, R, tw, { side = 1, style = 'spokes', dual = false, rimRole = 'c:rim' } = {}) {
  const Rr = R * (style === 'steel' ? 0.6 : 0.66);
  const prof = [[Rr, -tw / 2], [R - 0.035, -tw / 2], [R - 0.008, -tw / 2 + 0.012], [R, -tw / 2 + 0.035], [R, tw / 2 - 0.035], [R - 0.008, tw / 2 - 0.012], [R - 0.035, tw / 2], [Rr, tw / 2]];
  (out['c:tire'] ||= []).push(latheX(prof, x, y, z, 28));
  // rim face slightly inset from the tire's outer sidewall
  const fx = x + side * (tw / 2 - 0.025);
  const rim = [];
  rim.push(cylX(Rr * 0.98, tw * 0.8, x, y, z, 24)); // barrel (closes the tire inside)
  const lip = new THREE.TorusGeometry(Rr * 0.97, 0.012, 6, 28); lip.rotateY(Math.PI / 2); lip.translate(fx, y, z); rim.push(lip);
  rim.push(cylX(R * 0.14, 0.05, fx - side * 0.01, y, z, 14)); // hub
  if (style === 'steel') {
    const disc = cylX(Rr * 0.92, 0.02, fx - side * 0.025, y, z, 24); rim.push(disc);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; const h = cylX(0.022, 0.03, fx - side * 0.012, y + Math.sin(a) * Rr * 0.55, z + Math.cos(a) * Rr * 0.55, 8); rim.push(h); }
  } else {
    const n = style === 'multi' ? 10 : 5;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.3;
      const sp = new THREE.BoxGeometry(0.03, Rr * 0.9, style === 'multi' ? 0.022 : 0.045);
      sp.translate(0, Rr * 0.47, 0);
      sp.rotateX(a);
      sp.translate(fx - side * 0.012, y, z);
      rim.push(sp);
    }
    // brake disc + caliper behind the spokes
    (out['c:trim'] ||= []).push(cylX(Rr * 0.8, 0.02, fx - side * 0.06, y, z, 20));
  }
  (out[rimRole] ||= []).push(...rim);
  if (dual) { // inner twin tire (trucks)
    (out['c:tire'] ||= []).push(latheX(prof, x - side * (tw + 0.02), y, z, 28));
  }
}

// ------------------------------------------------------------------ lofted car body
/**
 * Car specs (s = distance from the front bumper, meters):
 *  L W H wb fo R tw clr  length, width, height, wheelbase, front overhang, wheel radius / width, sill height
 *  nose [bottom, top] at the bumper, cowl (hood height at the windshield), belt, beltRise (to the rear),
 *  tail [bottom, top], sA sB sC sD windshield base / top, rear window top / base, roofCab (windshield top y),
 *  tumble, bp (B pillar s or null), cw (rear side window end), doors, clad (black cladding height),
 *  box (s where the cargo box starts at full height, vans), bed (pick-up bed start).
 */
const SPECS = {
  utilitaria: { L: 3.65, W: 1.64, H: 1.54, wb: 2.30, fo: 0.68, R: 0.29, tw: 0.175, clr: 0.17, nose: [0.27, 0.69], cowl: 0.93, belt: 0.95, beltRise: 0.04, tail: [0.32, 0.99],
    sA: 0.98, sB: 1.62, sC: 3.12, sD: 3.58, roofCab: 1.53, tumble: 0.13, bp: 2.08, cw: 2.95, cr: 0.28, hood: 0.06 },
  berlina: { L: 4.68, W: 1.84, H: 1.45, wb: 2.82, fo: 0.9, R: 0.33, tw: 0.215, clr: 0.16, nose: [0.27, 0.7], cowl: 0.96, belt: 0.97, beltRise: 0.05, tail: [0.35, 1.03],
    sA: 1.62, sB: 2.35, sC: 3.38, sD: 4.0, roofCab: 1.44, tumble: 0.17, bp: 2.72, cw: 3.42, cr: 0.3, trunk: 1.04, hood: 0.05 },
  wagon: { L: 4.72, W: 1.84, H: 1.48, wb: 2.82, fo: 0.9, R: 0.33, tw: 0.215, clr: 0.16, nose: [0.27, 0.7], cowl: 0.96, belt: 0.97, beltRise: 0.05, tail: [0.35, 1.04],
    sA: 1.62, sB: 2.35, sC: 4.35, sD: 4.66, roofCab: 1.46, tumble: 0.15, bp: 2.72, cw: 3.55, cw2: 4.3, cr: 0.3, hood: 0.05 },
  suv: { L: 4.58, W: 1.88, H: 1.7, wb: 2.70, fo: 0.9, R: 0.365, tw: 0.235, clr: 0.21, nose: [0.36, 0.9], cowl: 1.12, belt: 1.13, beltRise: 0.04, tail: [0.42, 1.15],
    sA: 1.45, sB: 2.1, sC: 4.12, sD: 4.5, roofCab: 1.68, tumble: 0.13, bp: 2.55, cw: 3.55, cw2: 4.05, cr: 0.26, clad: 0.4, hood: 0.04, rails: true },
  sportiva: { L: 4.45, W: 1.93, H: 1.22, wb: 2.56, fo: 1.0, R: 0.34, tw: 0.26, clr: 0.12, nose: [0.2, 0.56], cowl: 0.86, belt: 0.88, beltRise: 0.06, tail: [0.3, 0.95],
    sA: 1.9, sB: 2.62, sC: 3.0, sD: 4.12, roofCab: 1.2, tumble: 0.22, bp: null, cw: 3.28, cr: 0.4, doors: 2, hood: 0.07, spoiler: true },
  pickup: { L: 5.35, W: 1.93, H: 1.84, wb: 3.25, fo: 0.95, R: 0.39, tw: 0.25, clr: 0.23, nose: [0.42, 1.03], cowl: 1.2, belt: 1.22, beltRise: 0.0, tail: [0.55, 0.86],
    sA: 1.75, sB: 2.32, sC: 3.18, sD: 3.24, roofCab: 1.82, tumble: 0.13, bp: 2.72, cw: 3.12, cr: 0.22, clad: 0.48, bed: 3.32, bedTop: 1.24, hood: 0.03 },
  furgone: { L: 5.41, W: 2.05, H: 2.42, wb: 3.45, fo: 0.95, R: 0.34, tw: 0.225, clr: 0.19, nose: [0.36, 0.98], cowl: 1.22, belt: 1.24, beltRise: 0.0, tail: [0.42, 2.4],
    sA: 1.08, sB: 1.72, sC: 5.3, sD: 5.41, roofCab: 2.02, tumble: 0.1, bp: null, cw: 2.1, cr: 0.24, box: 2.18, hood: 0.03, clad: 0.4, tailBand: [0.62, 1.15], tailX: 0.13 },
};

/** Builds the lofted body of spec S into `out` (role -> geometries). opts: {stripe:[y0,y1,role], sunroof, livery} */
function carBody(S, out, opts = {}) {
  const { L, W } = S, hw0 = W / 2;
  const zOf = (s) => L / 2 - s;
  const axF = S.fo, axR = S.fo + S.wb;
  const Ra = S.R + 0.055; // arch radius
  const archY0 = S.R + 0.01;
  // ---- profile functions
  const cr = S.cr; // plan-view corner radius
  const plan = (s) => {
    let k = 0;
    if (s < cr) k = cr - Math.sqrt(Math.max(0, cr * cr - (cr - s) ** 2));
    else if (s > L - cr) k = cr - Math.sqrt(Math.max(0, cr * cr - (s - (L - cr)) ** 2));
    return hw0 - k;
  };
  const sCabEnd = S.box ?? S.bed ?? S.sD;
  const beltAt = (s) => S.belt + S.beltRise * clamp01((s - S.sA) / (L - S.sA));
  const top = (s) => { // upper line of the lower body
    if (s <= S.sA) { // hood: rounded nose, gently rising
      const t = s / S.sA;
      return lerp(S.nose[1], S.cowl, 1 - (1 - t) ** 1.6) + S.hood * Math.sin(Math.PI * t) * 0.5;
    }
    if (S.box && s >= S.box) return S.H - 0.01;
    if (S.bed && s >= S.bed) return S.bedFloor ?? 0.95;
    if (s <= S.sD || !S.trunk) {
      if (s <= S.sD) return lerp(S.cowl, beltAt(s), clamp01((s - S.sA) / 0.15));
    }
    // rear deck / tail
    const t = clamp01((s - S.sD) / Math.max(0.05, L - S.sD));
    const deck = S.trunk ?? S.tail[1];
    return lerp(beltAt(S.sD), deck, smooth(Math.min(1, t * 3))) - (S.trunk ? 0.03 * t : 0);
  };
  const bottom = (s) => {
    // bumpers rise at the overhangs, arches over the wheels
    let y = S.clr;
    if (s < axF - Ra) y = lerp(S.nose[0], S.clr, smooth(clamp01(s / (axF - Ra))));
    if (s > axR + Ra) y = lerp(S.clr, S.tail[0], smooth(clamp01((s - axR - Ra) / (L - axR - Ra))));
    for (const ax of [axF, axR]) {
      const d = Math.abs(s - ax);
      if (d < Ra) y = Math.max(y, archY0 + Math.sqrt(Ra * Ra - d * d) * 0.98);
      else if (d < Ra + 0.05) y = Math.max(y, lerp(archY0, y, (d - Ra) / 0.05));
    }
    return y;
  };
  const roofY = (s) => { // greenhouse top
    if (s <= S.sA) return beltAt(s);
    if (s <= S.sB) { const t = (s - S.sA) / (S.sB - S.sA); return lerp(S.cowl, S.roofCab, t * (1.22 - 0.22 * t)); }
    if (S.box) return lerp(S.roofCab, S.H - 0.01, smooth(clamp01((s - S.sB) / (S.box - S.sB))));
    if (s <= S.sC) { const u = (s - S.sB) / (S.sC - S.sB); return lerp(S.roofCab, S.H, smooth(clamp01((s - S.sB) / 0.3))) - 0.012 + 0.012 * Math.sin(Math.PI * u); }
    if (s <= S.sD) { const t = (s - S.sC) / Math.max(0.01, S.sD - S.sC); const yEnd = top(S.sD) - 0.015; return lerp(S.H - 0.012, yEnd, t ** 1.25); }
    return beltAt(s);
  };
  // ---- stations
  const st = new Set();
  for (let s = 0; s <= L + 1e-6; s += 0.1) st.add(+s.toFixed(4));
  for (const s of [0.004, 0.015, 0.035, 0.06, L - 0.004, L - 0.015, L - 0.035, L - 0.06]) st.add(s);
  for (let k = 0; k <= 8; k++) { const t = cr * (k / 8); st.add(+t.toFixed(4)); st.add(+(L - t).toFixed(4)); }
  for (const ax of [axF, axR]) for (let k = -12; k <= 12; k++) st.add(+(ax + (Ra + 0.05) * (k / 12)).toFixed(4));
  const keys = [S.sA, S.sA + 0.12, S.sB, S.sC, S.sD, S.cw, S.cw2, S.bp, S.bp ? S.bp - 0.05 : null, S.bp ? S.bp + 0.05 : null, S.box, S.box ? S.box - 0.004 : null, S.bed, S.bed ? S.bed - 0.004 : null];
  for (const k of keys) if (k != null && k > 0 && k < L) st.add(+k.toFixed(4));
  for (let s = S.sA; s <= S.sB; s += (S.sB - S.sA) / 8) st.add(+s.toFixed(4));
  for (let s = S.sC; s <= S.sD; s += Math.max(0.02, (S.sD - S.sC) / 6)) st.add(+s.toFixed(4));
  const ss = [...st].filter((s) => s >= 0 && s <= L).sort((a, b) => a - b);
  // ---- lower body rings (side points include exact key heights: crisp lamp / stripe / cladding borders)
  const stripe = opts.stripe;
  const clad = S.clad || 0;
  const lampF = { s: cr * 0.95 + 0.02, y0: S.nose[1] - 0.16, y1: S.nose[1] - 0.045, x: hw0 - cr - 0.12 };
  const tb = S.tailBand || [(S.trunk ?? S.tail[1]) - 0.2, (S.trunk ?? S.tail[1]) - 0.075];
  const lampR = { s: S.tailX ?? cr * 0.8 + 0.02, y0: tb[0], y1: tb[1], x: S.tailX ? hw0 - 0.2 : hw0 - cr - 0.1 };
  const keyH = [lampF.y0, lampF.y1, tb[0], tb[1], ...(stripe ? [stripe[0], stripe[1]] : []), ...(clad ? [clad] : [])];
  const bulge = (y, x) => x * (1 - 0.05 * ((y - (S.belt * 0.62)) / S.H) ** 2);
  const lowerRings = [];
  const endShrink = (s) => { const e = Math.min(s, L - s); return e < 0.06 ? (1 - e / 0.06) ** 2 : 0; };
  for (const s of ss) {
    const k = endShrink(s);
    let hw = plan(s) - 0.035 * k;
    let yb = bottom(s) + 0.04 * k, yt = top(s) - 0.04 * k;
    if (yt - yb < 0.06) yt = yb + 0.06;
    const h = yt - yb;
    const rb = Math.min(0.07, h * 0.25, hw * 0.3), rt = Math.min(S.box && s > S.box ? 0.1 : 0.085, h * 0.3, hw * 0.3);
    const right = [];
    right.push([0, yb], [(hw - rb) * 0.5, yb], [hw - rb, yb]);
    for (let a = 1; a <= 4; a++) { const t = -Math.PI / 2 + (a / 4) * (Math.PI / 2); right.push([hw - rb + Math.cos(t) * rb, yb + rb + Math.sin(t) * rb]); }
    const lo = yb + rb + 0.002, hi = yt - rt - 0.002;
    const sideY = [0.2, 0.4, 0.6, 0.8].map((t) => lerp(lo, hi, t)).concat(keyH.map((y) => Math.min(hi, Math.max(lo, y)))).sort((a, b) => a - b);
    for (const y of sideY) right.push([hw, y]);
    for (let a = 0; a <= 4; a++) { const t = (a / 4) * (Math.PI / 2); right.push([hw - rt + Math.cos(t) * rt, yt - rt + Math.sin(t) * rt]); }
    right.push([(hw - rt) * 0.5, yt + 0.004], [0, yt + 0.006]);
    const z = zOf(s);
    const ring = right.map(([x, y]) => [bulge(y, x), y, z]);
    for (let j = right.length - 2; j >= 1; j--) { const [x, y] = right[j]; ring.push([-bulge(y, x), y, z]); }
    lowerRings.push(ring);
  }
  const RIGHT_N = 3 + 4 + 4 + keyH.length + 5 + 2; // points of the right half (incl. both centers)
  loftRoles(lowerRings, {
    closed: true,
    flipCheck: [Math.floor(ss.length / 2) * lowerRings[0].length + RIGHT_N - 1, [0, 1, 0]],
    classify: (i, j) => {
      const a = lowerRings[i][j], b = lowerRings[i + 1][(j + 1) % lowerRings[i].length];
      const ym = (a[1] + b[1]) / 2, xm = Math.abs(a[0] + b[0]) / 2, sm = (ss[i] + ss[i + 1]) / 2;
      const side = Math.abs(a[0]) > hw0 * 0.6 && Math.abs(b[0]) > hw0 * 0.6;
      if (sm < lampF.s && ym > lampF.y0 && ym < lampF.y1 && xm > lampF.x) return 'c:headlight';
      if (sm > L - lampR.s && ym > lampR.y0 && ym < lampR.y1 && xm > lampR.x) return 'c:taillight';
      if (clad && ym < clad) return 'c:trim';
      if (stripe && side && ym > stripe[0] && ym < stripe[1]) return stripe[2];
      return 'c:paintMain';
    },
    out,
  });
  capFan(lowerRings[0], [0, 0, 1], 'c:paintMain', out);
  capFan(lowerRings[lowerRings.length - 1], [0, 0, -1], 'c:paintMain', out);
  if (clad) { // black bumper skirts on the flat end caps
    const hF = clad - S.nose[0] - 0.02, hR = clad - S.tail[0] - 0.02;
    if (hF > 0.04) (out['c:trim'] ||= []).push(box(2 * plan(0) - 0.08, hF, 0.03, { y: S.nose[0] + 0.04 + hF / 2, z: L / 2 - 0.008, r: 0.01 }));
    if (hR > 0.04) (out['c:trim'] ||= []).push(box(2 * plan(L) - 0.08, hR, 0.03, { y: S.tail[0] + 0.04 + hR / 2, z: -L / 2 + 0.008, r: 0.01 }));
  }

  // ---- greenhouse (open strip over the top), between sA and the cab end
  const gs = ss.filter((s) => s >= S.sA && s <= (S.box ? S.box : S.bed ? S.sD : S.sD));
  const ghRings = [];
  for (const s of gs) {
    const yb = top(s) - 0.02, yr = Math.max(yb + 0.002, roofY(s));
    const hwb = plan(s) * (1 - 0.05 * ((yb - S.belt * 0.62) / S.H) ** 2) - 0.045;
    const hwt = hwb - S.tumble * clamp01((yr - yb) / Math.max(0.2, S.roofCab - S.belt));
    const hg = yr - yb;
    const rg = Math.max(0.002, Math.min(0.075, hg * 0.4, hwt * 0.3));
    const right = [];
    for (let a = 0; a <= 4; a++) { const t = a / 4; right.push([lerp(hwb, hwt, t * (hg - rg) / Math.max(1e-4, hg)), lerp(yb, yr - rg, t)]); }
    for (let a = 1; a <= 3; a++) { const t = (a / 3) * (Math.PI / 2); right.push([hwt - rg + Math.cos(t) * rg, yr - rg + Math.sin(t) * rg]); }
    right.push([(hwt - rg) * 0.5, yr + 0.003], [0, yr + 0.004]);
    const z = zOf(s);
    const ring = right.map(([x, y]) => [x, y, z]);
    for (let j = right.length - 2; j >= 0; j--) ring.push([-right[j][0], right[j][1], z]);
    ghRings.push(ring);
  }
  const GR = 5 + 3 + 2; // right half points incl. center
  const regionOf = (j) => { // segment j -> j+1 of the open strip
    const jr = j < GR - 1 ? j : (2 * GR - 2) - j - 1; // mirror to the right-half index
    if (jr < 4) return 'side';
    if (jr < 7) return 'corner';
    return 'top';
  };
  const wins = [];
  const f0 = S.sA + 0.12;
  if (S.box) wins.push([f0, S.box - 0.06]);
  else if (S.bp == null) wins.push([f0, S.cw]);
  else { wins.push([f0, S.bp - 0.05]); wins.push([S.bp + 0.05, S.cw]); if (S.cw2) wins.push([S.cw + 0.07, S.cw2]); }
  const inWin = (s) => wins.some(([a, b]) => s >= a && s <= b);
  const sunroof = opts.sunroof && !S.box ? [S.sB + 0.3, S.sB + 0.85] : null;
  if (ghRings.length > 1) {
    loftRoles(ghRings, {
      closed: false,
      flipCheck: [Math.floor(gs.length / 2) * ghRings[0].length + GR - 1, [0, 1, 0]],
      classify: (i, j) => {
        const sm = (gs[i] + gs[i + 1]) / 2, r = regionOf(j);
        if (r === 'top') {
          if (sm < S.sB - 0.005) return 'c:glass';
          if (!S.box && sm > S.sC + 0.01) return 'c:glass';
          if (sunroof && sm > sunroof[0] && sm < sunroof[1] && Math.abs(ghRings[i][j][0] + ghRings[i][j + 1][0]) / 2 < 0.36) return 'c:glass';
          return 'c:paintMain';
        }
        if (r === 'corner') return sm < S.sB && S.blackA ? 'c:trim' : 'c:paintMain';
        if (inWin(sm)) return 'c:glass';
        if (S.bp != null && Math.abs(sm - S.bp) < 0.06) return 'c:trim';
        return 'c:paintMain';
      },
      out,
    });
  }
  return { plan, top, bottom, roofY, beltAt, zOf, axF, axR, Ra };
}

/** Details shared by lofted cars: wheels, liners, lights, grille, plates, mirrors, handles, seams. */
function carDetails(S, B, out, rnd, opts = {}) {
  const { L, W, R, tw } = S;
  const { plan, top, bottom, zOf, axF, axR, Ra } = B;
  const style = opts.rim || 'spokes';
  // wheels + wheel-well liners
  for (const ax of [axF, axR]) for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - tw / 2 - 0.035);
    wheel(out, x, R, zOf(ax), R, tw, { side: sx, style });
    const liner = new THREE.CylinderGeometry(Ra - 0.012, Ra - 0.012, 0.34, 20, 1, true, -Math.PI * 0.08, Math.PI * 1.16);
    liner.rotateZ(Math.PI / 2);
    liner.translate(sx * (W / 2 - 0.2), S.R + 0.01, zOf(ax));
    (out['c:trimD'] ||= []).push(liner);
  }
  // ---- front
  const zf = L / 2;
  const hwF = plan(0.08);
  const ylamp = S.nose[1] - 0.1;
  out['c:lightsVC'] ||= [];
  for (const sx of [-1, 1]) {
    // fog lights in the bumper (flat front cap)
    out['c:lightsVC'].push(vc(cylinder(0.038, 0.038, 0.03, { rx: 90, x: sx * Math.max(0.2, plan(0) - 0.16), y: S.nose[0] + 0.1, z: zf - 0.012, seg: 12 }), '#d8dcdc'));
  }
  // grille + lower intake
  const gw = Math.max(0.3, (W / 2 - S.cr - 0.17) * 2);
  (out['c:trim'] ||= []).push(box(gw, 0.11, 0.08, { y: ylamp - 0.03, z: zf - 0.033, r: 0.02 }));
  out['c:trim'].push(box(Math.min(gw + 0.25, 2 * plan(0) - 0.1), 0.08, 0.06, { y: S.nose[0] + 0.13, z: zf - 0.022, r: 0.015 }));
  // plates
  (out['c:lightsVC']).push(vcBox(0.52, 0.11, 0.012, { y: S.nose[0] + 0.24, z: zf + 0.002, r: 0.004 }, '#f2f2f0'));
  (out['c:lightsVC']).push(vcBox(0.04, 0.105, 0.014, { x: -0.24, y: S.nose[0] + 0.24, z: zf + 0.002, r: 0.002 }, '#1f3fa0'));
  // ---- rear
  const zr = -L / 2;
  const hwR = plan(L - 0.08);
  const ytail = (S.bed ? S.tail[1] : top(L - 0.1)) - 0.13;
  (out['c:lightsVC']).push(vcBox(0.52, 0.11, 0.012, { y: S.tail[0] + 0.2, z: zr - 0.002, r: 0.004 }, '#f2f2f0'));
  out['c:trim'].push(box(Math.min(W - 0.3, 2 * plan(L) - 0.1), 0.09, 0.05, { y: S.tail[0] + 0.06, z: zr + 0.018, r: 0.015 }));
  // exhaust
  (out['c:rimDark'] ||= []).push(cylinder(0.035, 0.035, 0.12, { rx: -90, x: -0.45, y: S.tail[0] - 0.02, z: zr + 0.06, seg: 12 }));
  // ---- mirrors
  if (!opts.noMirrors) for (const sx of [-1, 1]) {
    const s = S.sA + 0.2, y = top(s) + 0.075, x0 = plan(s) - 0.06;
    (out['c:paintMain'] ||= []).push(box(0.18, 0.11, 0.09, { x: sx * (x0 + 0.17), y, z: zOf(s) - 0.02, r: 0.035 }));
    (out['c:trim']).push(box(0.12, 0.05, 0.06, { x: sx * (x0 + 0.05), y: y - 0.02, z: zOf(s), r: 0.015 }));
    (out['c:glass'] ||= []).push(box(0.15, 0.08, 0.01, { x: sx * (x0 + 0.17), y, z: zOf(s) - 0.067, r: 0.003 }));
  }
  // ---- door seams + handles (thin dark ribbons on the side surface)
  const seam = (s, y0, y1) => {
    for (const sx of [-1, 1]) {
      const pts = [];
      for (let k = 0; k <= 4; k++) {
        const y = lerp(y0, y1, k / 4);
        const x = plan(s) * (1 - 0.05 * ((y - S.belt * 0.62) / S.H) ** 2) + 0.0025;
        pts.push([sx * x, y, zOf(s)]);
      }
      const pos = [];
      for (let k = 0; k < 4; k++) {
        const a = pts[k], b = pts[k + 1], h = 0.004;
        pos.push(a[0], a[1], a[2] - h, b[0], b[1], b[2] - h, a[0], a[1], a[2] + h, a[0], a[1], a[2] + h, b[0], b[1], b[2] - h, b[0], b[1], b[2] + h);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const nrm = g.attributes.normal;
      if (nrm.getX(0) * sx < 0) { for (let k = 0; k < pos.length; k += 9) for (let q = 0; q < 3; q++) { const t = pos[k + 3 + q]; pos[k + 3 + q] = pos[k + 6 + q]; pos[k + 6 + q] = t; } g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); }
      out['c:trim'].push(g);
    }
  };
  const doors = S.doors ?? 4;
  const yS0 = bottom(S.sA + 0.3) + 0.03;
  if (!S.box) {
    const fFront = Math.max(axF + Ra + 0.04, S.sA + 0.05);
    seam(fFront, yS0, top(fFront) - 0.01);
    const handles = [];
    if (doors === 4 && S.bp) {
      seam(S.bp, yS0, top(S.bp) - 0.01);
      const rEnd = Math.min(axR - Ra - 0.02, S.cw + 0.02);
      seam(rEnd, bottom(rEnd) + 0.03, top(rEnd) - 0.01);
      handles.push(S.bp - 0.14, rEnd - 0.14);
    } else {
      const e = Math.min(axR - Ra - 0.04, (S.cw ?? S.sD) - 0.05);
      seam(e, bottom(e) + 0.03, top(e) - 0.01);
      handles.push(e - 0.16);
    }
    for (const s of handles) for (const sx of [-1, 1]) {
      const y = top(s) - 0.09, x = plan(s) * (1 - 0.05 * ((y - S.belt * 0.62) / S.H) ** 2);
      out['c:trim'].push(box(0.03, 0.025, 0.13, { x: sx * (x + 0.006), y, z: zOf(s), r: 0.008 }));
    }
  } else {
    // van: cab door + sliding door seams
    const fFront = Math.max(axF + Ra + 0.04, S.sA + 0.05);
    seam(fFront, yS0, top(fFront) - 0.01);
    seam(S.box - 0.04, yS0, S.box - 0.04 < S.box ? top(S.box - 0.05) - 0.01 : 1.2);
    for (const sx of [-1, 1]) {
      seam(S.box + 0.06, bottom(S.box + 0.1) + 0.03, S.H - 0.25);
      seam(S.box + 1.25, bottom(S.box + 1.3) + 0.03, S.H - 0.25);
      break;
    }
    // rear doors split + rear windows
    out['c:trim'].push(box(0.012, S.H - 0.6, 0.01, { y: (S.H + 0.45) / 2, z: zr - 0.003 }));
    for (const sx of [-1, 1]) (out['c:glass'] ||= []).push(box(0.6, 0.42, 0.012, { x: sx * 0.38, y: S.H - 0.55, z: zr - 0.004, r: 0.04 }));
  }
  // windshield wipers
  for (const sx of [-1, 0.15]) out['c:trim'].push(rod([sx * 0.55, top(S.sA) + 0.03, zOf(S.sA + 0.02)], [sx * 0.55 + 0.42, top(S.sA) + 0.08, zOf(S.sA + 0.12)], 0.008, { seg: 5 }));
  // roof rails
  if (S.rails) for (const sx of [-1, 1]) {
    const x = sx * (plan(3) - 0.045 - S.tumble - 0.06);
    out['c:trim'].push(rod([x, S.H + 0.03, zOf(S.sB + 0.15)], [x, S.H + 0.03, zOf(S.sC - 0.1)], 0.018, { seg: 8 }));
    for (const s of [S.sB + 0.2, S.sC - 0.15]) out['c:trim'].push(box(0.05, 0.05, 0.08, { x, y: S.H + 0.005, z: zOf(s) }));
  }
  if (S.spoiler) {
    out['c:paintMain'].push(box(1.3, 0.025, 0.2, { y: S.tail[1] + 0.08, z: zr + 0.16, rx: -6, r: 0.01 }));
    for (const sx of [-1, 1]) out['c:trim'].push(box(0.03, 0.08, 0.06, { x: sx * 0.45, y: S.tail[1] + 0.035, z: zr + 0.17 }));
  }
}

// ------------------------------------------------------------------ car types
function car(kind, p) {
  const rnd = rng(p.seed || 1);
  let S = { ...SPECS[kind === 'taxi' || kind === 'polizia' ? (p.body === 'wagon' ? 'wagon' : 'berlina') : kind === 'ambulanza' ? 'furgone' : kind === 'berlina' && p.body === 'wagon' ? 'wagon' : kind] };
  if (kind === 'utilitaria' && p.doors === '3') { S.doors = 2; S.bp = null; S.cw = 2.85; }
  if (kind === 'ambulanza') { S.H = 2.55; S.roofCab = 2.02; }
  const out = {};
  const opts = { sunroof: rnd() < 0.25 && (kind === 'berlina' || kind === 'suv'), rim: ['spokes', 'multi', 'spokes'][rnd.int(0, 2)] };
  if (kind === 'furgone' || kind === 'ambulanza') opts.rim = 'steel';
  if (kind === 'polizia') opts.stripe = [S.belt - 0.33, S.belt - 0.22, 'c:white'];
  if (kind === 'ambulanza') opts.stripe = [0.62, 0.8, 'c:orange'];
  if (kind === 'taxi') opts.sunroof = false;
  const B = carBody(S, out, opts);
  carDetails(S, B, out, rnd, opts);
  const { zOf, top, plan } = B;
  const L = S.L;
  // ---- pick-up bed
  if (S.bed) {
    const z0 = zOf(S.bed), z1 = -L / 2 + 0.02, bw = plan(4.2) - 0.02, wall = 0.05, yf = S.bedFloor ?? 0.95, yt = S.bedTop;
    out['c:paintMain'].push(box(wall, yt - yf + 0.02, z0 - z1, { x: bw - wall / 2, y: (yt + yf) / 2, z: (z0 + z1) / 2, r: 0.012 }));
    out['c:paintMain'].push(box(wall, yt - yf + 0.02, z0 - z1, { x: -bw + wall / 2, y: (yt + yf) / 2, z: (z0 + z1) / 2, r: 0.012 }));
    out['c:paintMain'].push(box(bw * 2, yt - yf + 0.02, wall, { y: (yt + yf) / 2, z: z1 + wall / 2, r: 0.012 }));
    out['c:paintMain'].push(box(bw * 2, yt - yf + 0.02, wall, { y: (yt + yf) / 2, z: z0 - wall / 2, r: 0.012 }));
    (out['c:trimD'] ||= []).push(box(bw * 2 - 0.08, 0.02, z0 - z1 - 0.08, { y: yf + 0.01, z: (z0 + z1) / 2 }));
    // bed rails
    for (const sx of [-1, 1]) out['c:trim'].push(box(0.07, 0.015, z0 - z1, { x: sx * (bw - wall / 2), y: yt + 0.012, z: (z0 + z1) / 2, r: 0.005 }));
  }
  // ---- roof equipment
  if (kind === 'taxi') {
    out['c:decalTaxi'] = [box(0.56, 0.15, 0.2, { y: S.H + 0.08, z: zOf(S.sB + 0.45), r: 0.025 })];
    out['c:trim'].push(box(0.5, 0.025, 0.16, { y: S.H + 0.002, z: zOf(S.sB + 0.45), r: 0.008 }));
  }
  if (kind === 'polizia') {
    const z = zOf(S.sB + 0.42);
    out['c:trim'].push(box(1.05, 0.04, 0.26, { y: S.H + 0.02, z, r: 0.012 }));
    out['c:lightsVC'].push(vcBox(0.44, 0.08, 0.22, { x: -0.27, y: S.H + 0.08, z, r: 0.03 }, '#2e6bff'), vcBox(0.44, 0.08, 0.22, { x: 0.27, y: S.H + 0.08, z, r: 0.03 }, '#2e6bff'));
    // POLIZIA on the front doors
    for (const sx of [-1, 1]) {
      const g = new THREE.PlaneGeometry(0.9, 0.17);
      g.rotateY(sx * Math.PI / 2);
      const s = S.bp ? S.bp - 0.45 : 2.4;
      const y = S.belt - 0.15;
      const x = plan(s) * (1 - 0.05 * ((y - S.belt * 0.62) / S.H) ** 2) + 0.006;
      g.translate(sx * x, y, zOf(s));
      (out['c:decalPolizia'] ||= []).push(g);
    }
  }
  if (kind === 'ambulanza') {
    const z = zOf(S.sB + 0.2);
    out['c:lightsVC'].push(vcBox(1.4, 0.1, 0.25, { y: S.H + 0.05, z: z + 0.02, r: 0.03 }, '#2e6bff'));
    out['c:lightsVC'].push(vcBox(0.25, 0.12, 0.08, { x: 0.8, y: S.H - 0.1, z: -L / 2 + 0.02, r: 0.03 }, '#2e6bff'), vcBox(0.25, 0.12, 0.08, { x: -0.8, y: S.H - 0.1, z: -L / 2 + 0.02, r: 0.03 }, '#2e6bff'));
    for (const sx of [-1, 1]) {
      const g = new THREE.PlaneGeometry(2.0, 0.36);
      g.rotateY(sx * Math.PI / 2);
      const s = 3.7, y = 1.15, x = plan(s) * (1 - 0.05 * ((y - S.belt * 0.62) / S.H) ** 2) + 0.006;
      g.translate(sx * x, y, zOf(s));
      (out['c:decalAmbu'] ||= []).push(g);
    }
    const hood = new THREE.PlaneGeometry(1.1, 0.2);
    hood.rotateX(-Math.PI / 2 + 0.25);
    hood.rotateY(Math.PI);
    hood.translate(0, top(0.55) + 0.012, zOf(0.55));
    (out['c:decalAmbuM'] ||= []).push(hood);
  }
  return out;
}

// ------------------------------------------------------------------ box vehicles
function autobus(p) {
  const L = p.length, W = 2.55, H = 3.05, R = 0.5, tw = 0.3, y0 = 0.32;
  const out = { 'c:paintMain': [], 'c:glass': [], 'c:trim': [], 'c:lightsVC': [], 'c:white': [] };
  const fo = 2.7, axF = L / 2 - fo, axR = -L / 2 + 3.3;
  const zA = (z) => Math.abs(z - axF) < R + 0.12 || Math.abs(z - axR) < R + 0.12;
  // upper body (above the wheels) and lower skirts between arches
  const yu = 1.12;
  out['c:paintMain'].push(box(W, H - yu, L, { y: (H + yu) / 2, r: 0.12 }));
  const segs = [[-L / 2, axR - R - 0.12], [axR + R + 0.12, axF - R - 0.12], [axF + R + 0.12, L / 2]];
  for (const [a, b] of segs) out['c:paintMain'].push(box(W, yu - y0 + 0.02, b - a, { y: (yu + y0) / 2, z: (a + b) / 2, r: 0.06 }));
  // arch tops (thin) and liners
  for (const az of [axF, axR]) {
    out['c:paintMain'].push(box(W, 0.06, 2 * (R + 0.12), { y: yu + 0.0, z: az, r: 0.02 }));
    const liner = new THREE.CylinderGeometry(R + 0.1, R + 0.1, W - 0.1, 20, 1, true, -Math.PI * 0.05, Math.PI * 1.1);
    liner.rotateZ(Math.PI / 2); liner.translate(0, R + 0.02, az);
    (out['c:trimD'] ||= []).push(liner);
    for (const sx of [-1, 1]) wheel(out, sx * (W / 2 - tw / 2 - 0.08), R, az, R, tw, { side: sx, style: 'steel', dual: az === axR });
  }
  // windows: side band with pillars, doors on the right side (-X)
  const yw0 = 1.22, yw1 = H - 0.42;
  const nWin = Math.max(3, Math.round((L - 3.2) / 1.25));
  const z0 = -L / 2 + 0.35, z1 = L / 2 - 1.6, step = (z1 - z0) / nWin;
  for (const sx of [-1, 1]) {
    for (let k = 0; k < nWin; k++) {
      const a = z0 + k * step + 0.05, b = a + step - 0.1;
      out['c:glass'].push(box(0.02, yw1 - yw0, b - a, { x: sx * (W / 2 + 0.003), y: (yw0 + yw1) / 2, z: (a + b) / 2, r: 0.006 }));
    }
    // driver side window
    out['c:glass'].push(box(0.02, yw1 - yw0 + 0.2, 1.15, { x: sx * (W / 2 + 0.003), y: (yw0 + yw1) / 2 + 0.1, z: L / 2 - 0.85, r: 0.006 }));
  }
  // doors (right side = -X): glass doors from the floor
  for (const dz of [L / 2 - 1.05, -0.2, ...(L > 14 ? [-L / 4] : [])]) {
    out['c:glass'].push(box(0.03, 2.3, 1.15, { x: -(W / 2 + 0.008), y: y0 + 1.2, z: dz, r: 0.01 }));
    out['c:trim'].push(box(0.035, 2.3, 0.03, { x: -(W / 2 + 0.01), y: y0 + 1.2, z: dz }));
  }
  // front: big windshield + destination sign; rear window
  out['c:glass'].push(box(W - 0.2, 1.55, 0.03, { y: 1.95, z: L / 2 + 0.004, r: 0.04 }));
  out['c:decalBus'] = [box(1.6, 0.22, 0.02, { y: H - 0.24, z: L / 2 + 0.006 })];
  out['c:glass'].push(box(W - 0.6, 0.8, 0.03, { y: H - 0.85, z: -L / 2 - 0.004, r: 0.04 }));
  // livery band
  out['c:white'].push(box(W + 0.012, 0.16, L - 0.3, { y: 0.95, r: 0.02 }));
  // lights, bumpers, mirrors
  for (const sx of [-1, 1]) {
    out['c:lightsVC'].push(vcBox(0.32, 0.14, 0.05, { x: sx * (W / 2 - 0.3), y: 0.72, z: L / 2 + 0.01, r: 0.03 }, '#eef0ee'));
    out['c:lightsVC'].push(vcBox(0.22, 0.4, 0.05, { x: sx * (W / 2 - 0.2), y: 0.95, z: -L / 2 - 0.01, r: 0.03 }, '#a0141c'));
    out['c:trim'].push(rod([sx * (W / 2 - 0.05), H - 0.35, L / 2 - 0.1], [sx * (W / 2 + 0.25), H - 0.45, L / 2 + 0.2], 0.02, { seg: 6 }));
    out['c:trim'].push(box(0.12, 0.32, 0.06, { x: sx * (W / 2 + 0.28), y: H - 0.65, z: L / 2 + 0.22, r: 0.03 }));
  }
  out['c:trim'].push(box(W + 0.04, 0.3, 0.12, { y: 0.45, z: L / 2 + 0.02, r: 0.04 }), box(W + 0.04, 0.3, 0.12, { y: 0.45, z: -L / 2 - 0.02, r: 0.04 }));
  out['c:lightsVC'].push(vcBox(0.55, 0.12, 0.012, { y: 0.45, z: L / 2 + 0.085 }, '#f2f2f0'));
  return out;
}

function camion(p) {
  const out = { 'c:paintMain': [], 'c:glass': [], 'c:trim': [], 'c:lightsVC': [], 'c:white': [], 'c:rimDark': [] };
  const W = 2.5, cabL = 2.25, R = 0.5, tw = 0.31;
  const L = p.length, zf = L / 2, cabZ = zf - cabL / 2;
  const axF = zf - 1.35, axR = -L / 2 + 1.7;
  // chassis rails
  for (const sx of [-1, 1]) out['c:trim'].push(box(0.12, 0.3, L - 0.6, { x: sx * 0.45, y: 0.8, z: -0.1 }));
  // cab: rounded box with sloped windshield face
  const cabY0 = 0.95, cabH = 2.1;
  out['c:paintMain'].push(box(W, cabH, cabL, { y: cabY0 + cabH / 2, z: cabZ, r: 0.14 }));
  out['c:paintMain'].push(box(W - 0.05, 0.55, cabL - 0.3, { y: cabY0 - 0.25, z: cabZ + 0.1, r: 0.06 }));
  out['c:glass'].push(box(W - 0.3, 0.95, 0.03, { y: cabY0 + 1.42, z: zf + 0.004, r: 0.05 }));
  for (const sx of [-1, 1]) out['c:glass'].push(box(0.03, 0.75, 0.95, { x: sx * (W / 2 + 0.003), y: cabY0 + 1.45, z: zf - 0.6, r: 0.05 }));
  // grille, bumper, lights
  out['c:trim'].push(box(1.5, 0.55, 0.04, { y: cabY0 + 0.45, z: zf + 0.01, r: 0.03 }));
  out['c:trim'].push(box(W + 0.02, 0.32, 0.18, { y: 0.62, z: zf + 0.02, r: 0.05 }));
  for (const sx of [-1, 1]) {
    out['c:lightsVC'].push(vcBox(0.3, 0.14, 0.05, { x: sx * (W / 2 - 0.3), y: 0.68, z: zf + 0.12, r: 0.03 }, '#eef0ee'));
    out['c:trim'].push(rod([sx * (W / 2 - 0.02), cabY0 + 1.75, zf - 0.25], [sx * (W / 2 + 0.25), cabY0 + 1.7, zf - 0.1], 0.02, { seg: 6 }));
    out['c:trim'].push(box(0.1, 0.4, 0.06, { x: sx * (W / 2 + 0.28), y: cabY0 + 1.45, z: zf - 0.08, r: 0.02 }));
    // steps + fuel tank
    out['c:trim'].push(box(0.35, 0.05, 0.6, { x: sx * (W / 2 - 0.1), y: 0.55, z: zf - 1.05 }));
  }
  out['c:rimDark'].push(cylinder(0.27, 0.27, 0.75, { rz: 90, x: -0.45, y: 0.72, z: cabZ - 1.75, seg: 20 }));
  // cargo
  const cz0 = zf - cabL - 0.15, cz1 = -L / 2 + 0.05, cargo = p.cargo;
  if (cargo === 'cisterna') {
    const len = cz0 - cz1;
    const g = new THREE.CapsuleGeometry(1.05, len - 2.1, 8, 24); g.rotateX(Math.PI / 2); g.translate(0, 2.05, (cz0 + cz1) / 2);
    out['c:white'].push(g);
    out['c:trim'].push(box(1.9, 0.12, len - 0.4, { y: 1.0, z: (cz0 + cz1) / 2 }));
    out['c:steelT'] = [box(0.5, 0.06, len * 0.6, { y: 3.12, z: (cz0 + cz1) / 2 })];
  } else {
    const ch = cargo === 'telone' ? 2.75 : 2.85, cy0 = 1.0;
    out[cargo === 'telone' ? 'c:mainShadeT' : 'c:white'] = [box(W, ch, cz0 - cz1, { y: cy0 + ch / 2, z: (cz0 + cz1) / 2, r: cargo === 'telone' ? 0.08 : 0.03 })];
    if (cargo === 'telone') for (let z = cz1 + 0.6; z < cz0 - 0.3; z += 1.2) for (const sx of [-1, 1]) out['c:trim'].push(box(0.02, ch - 0.1, 0.05, { x: sx * (W / 2 + 0.01), y: cy0 + ch / 2, z }));
    else {
      for (const sx of [-1, 1]) out['c:trim'].push(box(0.02, 0.06, cz0 - cz1, { x: sx * (W / 2 + 0.008), y: cy0 + 0.05, z: (cz0 + cz1) / 2 }));
      out['c:trim'].push(box(0.03, ch - 0.1, 0.02, { y: cy0 + ch / 2, z: cz1 - 0.012 }));
    }
    out['c:trim'].push(box(W - 0.05, 0.12, cz0 - cz1, { y: cy0 - 0.06, z: (cz0 + cz1) / 2 }));
  }
  // rear lights + bumper bar
  for (const sx of [-1, 1]) out['c:lightsVC'].push(vcBox(0.3, 0.12, 0.05, { x: sx * (W / 2 - 0.25), y: 0.75, z: -L / 2 + 0.02, r: 0.02 }, '#a0141c'));
  out['c:trim'].push(box(W - 0.3, 0.12, 0.1, { y: 0.55, z: -L / 2 + 0.1 }));
  // wheels: single front, dual rear (two axles when long)
  const rearAx = L > 8.5 ? [axR, axR + 1.35] : [axR];
  for (const sx of [-1, 1]) {
    wheel(out, sx * (W / 2 - tw / 2 - 0.05), R, axF, R, tw, { side: sx, style: 'steel', rimRole: 'c:rim' });
    for (const az of rearAx) wheel(out, sx * (W / 2 - tw / 2 - 0.05), R, az, R, tw, { side: sx, style: 'steel', dual: true });
  }
  // fenders over the rear wheels
  for (const az of rearAx) for (const sx of [-1, 1]) {
    const f = new THREE.CylinderGeometry(R + 0.1, R + 0.1, tw * 2 + 0.1, 16, 1, true, 0, Math.PI); f.rotateZ(Math.PI / 2);
    f.translate(sx * (W / 2 - tw), R, az);
    (out['c:trimD'] ||= []).push(f);
  }
  return out;
}

// ------------------------------------------------------------------ two-wheelers
function thinWheel(out, z, y, R, w, { spokes = 0, disc = true, role = 'c:rim' } = {}) {
  const prof = [[R - 0.06, -w / 2], [R - 0.012, -w / 2], [R, -w / 4], [R, w / 4], [R - 0.012, w / 2], [R - 0.06, w / 2]];
  (out['c:tire'] ||= []).push(latheX(prof, 0, y, z, 32));
  const rim = new THREE.TorusGeometry(R - 0.065, 0.014, 6, 32); rim.rotateY(Math.PI / 2); rim.translate(0, y, z);
  (out[role] ||= []).push(rim, cylX(0.04, w + 0.04, 0, y, z, 12));
  if (spokes) {
    for (let k = 0; k < spokes; k++) {
      const a = (k / spokes) * Math.PI * 2, s = k % 2 ? 1 : -1;
      out[role].push(rod([s * 0.025, y, z], [s * 0.006, y + Math.sin(a) * (R - 0.07), z + Math.cos(a) * (R - 0.07)], 0.0016, { seg: 3 }));
    }
  } else {
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const sp = new THREE.BoxGeometry(0.02, R - 0.08, 0.03); sp.translate(0, (R - 0.08) / 2, 0); sp.rotateX(a); sp.translate(0, y, z);
      out[role].push(sp);
    }
    if (disc) (out['c:steel'] ||= []).push(cylX(R * 0.45, 0.006, 0.05, y, z, 20));
  }
}

function moto(p) {
  const out = { 'c:paintMain': [], 'c:trim': [], 'c:steel': [], 'c:lightsVC': [], 'c:seat': [] };
  const R = 0.31, wb = 1.42, zf = wb / 2, zr = -wb / 2;
  thinWheel(out, zf, R, R, 0.12);
  thinWheel(out, zr, R, R, 0.16);
  // fork + triple clamp + handlebar
  const head = [0, 0.98, zf - 0.22];
  for (const sx of [-1, 1]) out['c:steel'].push(rod([sx * 0.09, R, zf], [sx * 0.09, head[1], head[2]], 0.022, { seg: 10 }));
  out['c:trim'].push(box(0.24, 0.05, 0.08, { y: head[1], z: head[2] }));
  out['c:trim'].push(tube([[-0.38, 1.06, head[2] - 0.12], [-0.2, 1.03, head[2] - 0.02], [0, 1.02, head[2]], [0.2, 1.03, head[2] - 0.02], [0.38, 1.06, head[2] - 0.12]], 0.012, { segs: 16, rs: 6 }));
  for (const sx of [-1, 1]) out['c:trim'].push(cylinder(0.02, 0.02, 0.12, { rz: 90, x: sx * 0.42, y: 1.07, z: head[2] - 0.14, seg: 8 }));
  // headlight + mirrors
  out['c:lightsVC'].push(vc(cylinder(0.085, 0.09, 0.1, { rx: 90, y: 0.9, z: head[2] + 0.12, seg: 20 }), '#e9ece9'));
  for (const sx of [-1, 1]) { out['c:trim'].push(rod([sx * 0.25, 1.04, head[2] - 0.05], [sx * 0.3, 1.22, head[2] - 0.08], 0.006, { seg: 5 })); out['c:trim'].push(box(0.1, 0.06, 0.02, { x: sx * 0.31, y: 1.24, z: head[2] - 0.08, r: 0.01 })); }
  // frame
  out['c:trim'].push(rod([0, head[1] - 0.05, head[2] - 0.03], [0, 0.48, -0.05], 0.03, { seg: 10 }), rod([0, 0.48, -0.05], [0, R + 0.02, zr], 0.025, { seg: 8 }));
  for (const sx of [-1, 1]) out['c:steel'].push(rod([sx * 0.1, 0.45, -0.1], [sx * 0.1, R, zr], 0.018, { seg: 8 }));
  // engine + exhaust
  out['c:steel'].push(box(0.3, 0.32, 0.42, { y: 0.45, z: 0.08, r: 0.06 }));
  out['c:trim'].push(box(0.34, 0.12, 0.3, { y: 0.66, z: 0.05, r: 0.04 }));
  out['c:steel'].push(tube([[0.12, 0.35, 0.2], [0.2, 0.28, 0.0], [0.2, 0.33, -0.4], [0.22, 0.45, -0.75]], 0.03, { segs: 20, rs: 8 }));
  out['c:steel'].push(cylinder(0.055, 0.05, 0.4, { rx: -75, x: 0.22, y: 0.42, z: -0.6, seg: 14 }));
  // tank, seat, tail
  const tank = sphere(0.2, { ws: 24, hs: 14 }); tank.scale(0.95, 0.62, 1.25); tank.translate(0, 0.92, 0.2);
  out['c:paintMain'].push(tank);
  out['c:seat'].push(box(0.28, 0.09, 0.58, { y: 0.86, z: -0.28, rx: -4, r: 0.04 }));
  out['c:paintMain'].push(box(0.22, 0.12, 0.38, { y: 0.86, z: -0.68, rx: -12, r: 0.04 }));
  out['c:lightsVC'].push(vcBox(0.12, 0.05, 0.03, { y: 0.88, z: -0.88, r: 0.01 }, '#a0141c'));
  // fenders
  const ff = new THREE.CylinderGeometry(R + 0.04, R + 0.04, 0.13, 16, 1, true, 0.2, 2.0); ff.rotateZ(Math.PI / 2); ff.translate(0, R, zf);
  (out['c:paintMainD'] ||= []).push(ff);
  // side stand
  out['c:trim'].push(rod([0.12, 0.42, -0.1], [0.32, 0.01, -0.05], 0.012, { seg: 5 }));
  return out;
}

function scooter(p) {
  const out = { 'c:paintMain': [], 'c:trim': [], 'c:steel': [], 'c:lightsVC': [], 'c:seat': [] };
  const R = 0.2, zf = 0.66, zr = -0.6;
  thinWheel(out, zf, R, R, 0.1, { disc: false, role: 'c:rimDark' });
  thinWheel(out, zr, R, R, 0.11, { disc: false, role: 'c:rimDark' });
  // leg shield (curved), floorboard, rear body (Vespa-like)
  const shield = new THREE.CylinderGeometry(0.27, 0.22, 0.72, 20, 1, true, -1.35, 2.7); shield.rotateX(-0.22); shield.translate(0, 0.7, zf - 0.38);
  (out['c:paintMainD'] ||= []).push(shield);
  out['c:paintMain'].push(box(0.34, 0.08, 0.62, { y: 0.3, z: 0.05, r: 0.03 }));
  const rear = sphere(0.3, { ws: 24, hs: 16 }); rear.scale(0.95, 0.8, 1.35); rear.translate(0, 0.5, -0.45);
  out['c:paintMain'].push(rear);
  out['c:seat'].push(box(0.3, 0.1, 0.58, { y: 0.8, z: -0.36, r: 0.045 }));
  out['c:trim'].push(box(0.22, 0.12, 0.08, { y: 0.4, z: -0.86, r: 0.03 }));
  // steering column + handlebar + headlight
  out['c:paintMain'].push(cylinder(0.05, 0.05, 0.6, { rx: -18, y: 0.48, z: zf - 0.08, seg: 14 }));
  out['c:paintMain'].push(box(0.62, 0.08, 0.12, { y: 1.08, z: zf - 0.24, r: 0.035 }));
  out['c:lightsVC'].push(vc(cylinder(0.07, 0.07, 0.04, { rx: 90, y: 1.07, z: zf - 0.16, seg: 18 }), '#e9ece9'));
  for (const sx of [-1, 1]) out['c:trim'].push(cylinder(0.02, 0.02, 0.1, { rz: 90, x: sx * 0.34, y: 1.08, z: zf - 0.25, seg: 8 }));
  // front mudguard
  const ff = new THREE.CylinderGeometry(R + 0.04, R + 0.04, 0.12, 14, 1, true, 0.1, 2.0); ff.rotateZ(Math.PI / 2); ff.translate(0, R, zf);
  out['c:paintMainD'].push(ff);
  out['c:steel'].push(rod([0, R, zf], [0, 0.55, zf - 0.08], 0.022, { seg: 8 }));
  out['c:lightsVC'].push(vcBox(0.14, 0.05, 0.03, { y: 0.62, z: -0.86, r: 0.01 }, '#a0141c'));
  return out;
}

function bicicletta(p) {
  const out = { 'c:paintMain': [], 'c:trim': [], 'c:steel': [], 'c:seat': [] };
  const R = 0.34, wb = 1.04, zf = wb / 2 + 0.02, zr = -wb / 2 + 0.02, y = R;
  thinWheel(out, zf, y, R, 0.04, { spokes: 24, role: 'c:steel' });
  thinWheel(out, zr, y, R, 0.045, { spokes: 24, role: 'c:steel' });
  const bb = [0, 0.3, -0.02], seatTop = [0, 0.88, -0.2], head = [0, 0.86, zf - 0.17], headLow = [0, 0.7, zf - 0.13];
  const r = 0.017;
  const T = (a, b, rr = r) => out['c:paintMain'].push(rod(a, b, rr, { seg: 8 }));
  T(bb, seatTop); T(seatTop, head, 0.016); T(bb, headLow, 0.02); T(head, headLow, 0.022);
  for (const sx of [-1, 1]) { T([sx * 0.04, y, zr], bb, 0.011); T([sx * 0.04, y, zr], seatTop, 0.01); T([sx * 0.04, y, zf], [sx * 0.02, headLow[1] - 0.02, headLow[2] - 0.02], 0.012); }
  // seatpost + saddle
  out['c:steel'].push(rod(seatTop, [0, 0.98, -0.23], 0.012, { seg: 8 }));
  const saddle = sphere(0.1, { ws: 16, hs: 10 }); saddle.scale(0.8, 0.35, 1.5); saddle.translate(0, 1.0, -0.24);
  out['c:seat'].push(saddle);
  // stem + handlebar
  out['c:steel'].push(rod(head, [0, 1.0, zf - 0.22], 0.012, { seg: 8 }));
  out['c:steel'].push(tube([[-0.3, 1.02, zf - 0.32], [-0.2, 1.0, zf - 0.22], [0, 1.0, zf - 0.2], [0.2, 1.0, zf - 0.22], [0.3, 1.02, zf - 0.32]], 0.011, { segs: 12, rs: 6 }));
  for (const sx of [-1, 1]) out['c:trim'].push(cylinder(0.016, 0.016, 0.11, { rz: 90, x: sx * 0.32, y: 1.02, z: zf - 0.33, seg: 8 }));
  // crank, chainring, pedals, chain
  const ring = new THREE.TorusGeometry(0.095, 0.006, 4, 24); ring.rotateY(Math.PI / 2); ring.translate(0.05, bb[1], bb[2]);
  out['c:steel'].push(ring);
  for (const sx of [-1, 1]) {
    out['c:steel'].push(rod([sx * 0.06, bb[1], bb[2]], [sx * 0.07, bb[1] - 0.17 * sx, bb[2] + 0.02 * sx], 0.01, { seg: 5 }));
    out['c:trim'].push(box(0.09, 0.02, 0.06, { x: sx * 0.12, y: bb[1] - 0.17 * sx, z: bb[2] + 0.02 * sx, r: 0.006 }));
  }
  out['c:trim'].push(rod([0.05, bb[1] + 0.09, bb[2]], [0.05, y + 0.04, zr], 0.004, { seg: 3 }), rod([0.05, bb[1] - 0.09, bb[2]], [0.05, y - 0.04, zr], 0.004, { seg: 3 }));
  // fenders
  for (const [z, a0] of [[zf, 0.3], [zr, 1.4]]) {
    const f = new THREE.CylinderGeometry(R + 0.03, R + 0.03, 0.05, 16, 1, true, a0, 1.9); f.rotateZ(Math.PI / 2); f.translate(0, y, z);
    (out['c:paintMainD'] ||= []).push(f);
  }
  // kickstand
  out['c:trim'].push(rod([0.04, 0.3, -0.1], [0.2, 0.01, -0.22], 0.007, { seg: 4 }));
  return out;
}

// ------------------------------------------------------------------ registry
const S = seedParam;
const BODY = seg('body', 'Carrozzeria', [['berlina', 'Berlina'], ['wagon', 'Station wagon']], 'berlina');
const mk = (id, label, color, params, build, extra = {}) => ({ id, label, cat: 'esterni', sub: 'veicoli', color, params: [...params, S(1)], build, vehicle: true, palette: 'car', ...extra });

export const VEHICLE_TYPES = [
  mk('es_utilitaria', 'Utilitaria', '#c0392b', [seg('doors', 'Porte', [['3', '3 porte'], ['5', '5 porte']], '5')], (p) => car('utilitaria', p), { tags: 'auto macchina piccola city car', len: 3.65 }),
  mk('es_berlina', 'Berlina', '#1f3a6b', [BODY], (p) => car('berlina', p), { tags: 'auto macchina sedan station wagon', len: 4.7 }),
  mk('es_suv', 'SUV', '#5d6066', [], (p) => car('suv', p), { tags: 'auto fuoristrada crossover', len: 4.6 }),
  mk('es_sportiva', 'Sportiva', '#d9b23a', [], (p) => car('sportiva', p), { tags: 'auto coupé corsa', len: 4.45 }),
  mk('es_pickup', 'Pick-up', '#7a2f1f', [], (p) => car('pickup', p), { tags: 'auto cassone fuoristrada', len: 5.35 }),
  mk('es_furgone', 'Furgone', '#f2f2ef', [], (p) => car('furgone', p), { tags: 'van furgoncino consegne', len: 5.4 }),
  mk('es_taxi', 'Taxi', '#f2f2ef', [BODY], (p) => car('taxi', p), { tags: 'auto tassì', len: 4.7 }),
  mk('es_polizia', 'Polizia', '#2b5c9e', [BODY], (p) => car('polizia', p), { tags: 'auto volante pattuglia carabinieri', len: 4.7 }),
  mk('es_ambulanza', 'Ambulanza', '#f4f4f0', [], (p) => car('ambulanza', p), { tags: 'soccorso 118 ospedale', len: 5.4 }),
  mk('es_autobus', 'Autobus', '#c96a2b', [range('length', 'Lunghezza', 8, 18, 0.5, 12)], autobus, { tags: 'bus pullman mezzi pubblici', len: 12 }),
  mk('es_camion', 'Camion', '#2f4a6b', [seg('cargo', 'Carico', [['cassone', 'Furgonato'], ['telone', 'Telone'], ['cisterna', 'Cisterna']], 'cassone'), range('length', 'Lunghezza', 7, 11, 0.25, 8.5)], camion, { tags: 'tir autocarro', len: 8.5 }),
  mk('es_moto', 'Moto', '#8c1c1c', [], moto, { tags: 'motocicletta motore', len: 2.1, two: true }),
  mk('es_scooter', 'Scooter', '#8fb7a8', [], scooter, { tags: 'vespa motorino', len: 1.75, two: true }),
  mk('es_bici', 'Bicicletta', '#2f4f3a', [], bicicletta, { tags: 'bici ciclista', len: 1.75, two: true }),
];

/** Extra roles used only here (registered by index.js through roles.js extras). */
export const VEHICLE_ROLES = {
  'c:trimD': () => ({ kind: 'prop', color: '#141416', roughness: 0.7, side: 'double' }),
  'c:paintMainD': (c) => ({ kind: 'prop', color: c, roughness: 0.32, metalness: 0.25, side: 'double' }),
  'c:mainShadeT': (c) => ({ kind: 'prop', color: '#' + new THREE.Color(c).lerp(new THREE.Color('#d8d4c8'), 0.55).getHexString(), roughness: 0.9, sheen: 0.3 }),
  'c:steelT': () => ({ kind: 'prop', color: '#a9adb2', metalness: 0.8, roughness: 0.35 }),
};

export { flag, DEG, place };
