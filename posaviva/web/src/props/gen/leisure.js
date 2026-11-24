// Sport, games, music and accessories: dumbbell (hand), weight bench with
// barbell, pool table, ping-pong table, piano (upright / grand), guitar,
// punching bag, basketball, skateboard, treadmill; shoes (sneakers, dress
// shoes, pumps, boots) and backpack.
import * as THREE from 'three';
import { add, box, boxOn, cylinder, lathe, rod, sphere, torus, tube, extrudeXZ, range, int, seg, flag, seed, rng, colorize, centerParts, merge } from './util.js';

function manubrio(p) {
  const parts = {}, kg = p.kg, R = 0.05 + kg * 0.004, T = 0.02 + kg * 0.0022;
  add(parts, 'darkMetal', cylinder(0.016, 0.016, 0.14, { y: -0.07, seg: 14 }));
  for (const s of [-1, 1]) {
    for (let k = 0; k < 2; k++) add(parts, 'black', cylinder(R - k * 0.012, R - k * 0.012, T * 0.5, { y: s > 0 ? 0.07 + k * T * 0.5 : -0.07 - (k + 1) * T * 0.5, seg: 24, bevel: 0.004 }));
    add(parts, 'chrome', cylinder(0.022, 0.022, 0.015, { y: s > 0 ? 0.07 + T : -0.07 - T - 0.015, seg: 14 }));
  }
  return parts;
}

function pancaPesi(p) {
  const parts = {};
  add(parts, 'soft', boxOn(0.3, 0.07, 1.2, { y: 0.43, r: 0.03 }));
  add(parts, 'darkMetal', boxOn(0.06, 0.43, 0.06, { z: 0.45 }), boxOn(0.06, 0.43, 0.06, { z: -0.45 }), box(0.5, 0.05, 0.06, { y: 0.025, z: 0.45 }), box(0.5, 0.05, 0.06, { y: 0.025, z: -0.45 }));
  if (p.rack) {
    for (const s of [-1, 1]) add(parts, 'darkMetal', boxOn(0.06, 1.15, 0.06, { x: s * 0.55, z: -0.5 }), box(0.06, 0.05, 0.5, { x: s * 0.55, y: 0.025, z: -0.5 }), box(0.1, 0.04, 0.06, { x: s * 0.55, y: 1.07, z: -0.44 }));
    const y = 1.12, z = -0.44;
    add(parts, 'chrome', rod([-1.05, y, z], [1.05, y, z], 0.014));
    for (const s of [-1, 1]) for (let k = 0; k < p.plates; k++) add(parts, 'black', cylinder(0.225 - k * 0.03, 0.225 - k * 0.03, 0.035, { x: s * (0.72 + k * 0.04), y, z, rz: 90, seg: 32 }).translate(s * 0.0175, 0, 0));
  }
  return centerParts(parts);
}

function biliardo(p) {
  const parts = {}, L = p.size === 'grande' ? 2.84 : 2.24, W = L / 2, H = 0.8;
  add(parts, 'felt', boxOn(L, 0.04, W, { y: H - 0.04 }));
  for (const s of [-1, 1]) add(parts, 'wood', boxOn(L + 0.2, 0.08, 0.1, { y: H - 0.06, z: s * (W / 2 + 0.05), r: 0.015 }), boxOn(0.1, 0.08, W, { x: s * (L / 2 + 0.05), y: H - 0.06, r: 0.015 }));
  for (const s of [-1, 1]) add(parts, 'felt', box(L - 0.1, 0.04, 0.03, { y: H + 0.0, z: s * (W / 2 - 0.0), r: 0.01 }), box(0.03, 0.04, W - 0.1, { x: s * (L / 2), y: H, r: 0.01 }));
  add(parts, 'wood', boxOn(L, 0.2, W, { y: H - 0.26, r: 0.01 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(parts, 'wood', lathe([[0, 0], [0.08, 0], [0.07, 0.05], [0.05, 0.25], [0.07, 0.5], [0.06, H - 0.26], [0, H - 0.26]], { x: sx * (L / 2 - 0.12), z: sz * (W / 2 - 0.12), seg: 16 }));
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]]) add(parts, 'black', cylinder(0.055, 0.055, 0.03, { x: x * (L / 2 - 0.0), y: H - 0.02, z: z * (W / 2 - 0.0), seg: 16 }));
  if (p.balls) {
    const r = rng(5), cols = ['#f2d22e', '#1f4fbf', '#d0312d', '#5b2a86', '#ef7d1a', '#1f7a3a', '#7a1f24', '#111111'];
    // triangle rack + cue ball
    let i = 0;
    for (let row = 0; row < 5; row++) for (let k = 0; k <= row; k++) {
      const c = cols[i++ % cols.length];
      add(parts, 'vcGloss', colorize(sphere(0.028, { x: L * 0.2 + row * 0.049, y: H + 0.028, z: (k - row / 2) * 0.057, ws: 14, hs: 10 }), c));
    }
    add(parts, 'ceramic', sphere(0.028, { x: -L * 0.25, y: H + 0.028, ws: 14, hs: 10 }));
    add(parts, 'wood', rod([-L * 0.3, H + 0.04, 0.02], [-L * 0.3 - 1.3, H + 0.18, 0.3], 0.011, { r2: 0.006 }));
    void r;
  }
  return parts;
}

function pingpong() {
  const parts = {}, L = 2.74, W = 1.525, H = 0.76;
  add(parts, 'tableBlue', boxOn(L, 0.025, W, { y: H - 0.025, r: 0.004 }));
  add(parts, 'linen', box(0.02, 0.002, W, { y: H + 0.001 }), box(L, 0.002, 0.02, { y: H + 0.001, z: W / 2 - 0.01 }), box(L, 0.002, 0.02, { y: H + 0.001, z: -W / 2 + 0.01 }), box(L, 0.002, 0.004, { y: H + 0.001 }));
  add(parts, 'black', box(0.004, 0.15, W + 0.3, { y: H + 0.075 }));
  add(parts, 'darkMetal', rod([0, H + 0.15, -W / 2 - 0.15], [0, H + 0.15, W / 2 + 0.15], 0.006));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(parts, 'darkMetal', rod([sx * (L / 2 - 0.3), 0, sz * (W / 2 - 0.15)], [sx * (L / 2 - 0.3), H - 0.025, sz * (W / 2 - 0.15)], 0.02));
  return parts;
}

function pianoforte(p) {
  const parts = {};
  if (p.style === 'coda') {
    // grand piano: kidney-shaped body extruded, lid propped open
    const pts = [];
    const L = 1.8, W = 1.5;
    pts.push([-W / 2, 0.6]);
    pts.push([W / 2, 0.6]);
    for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push([W / 2 - t * 0.25, 0.6 - t * L * 0.55]); }
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI; pts.push([W / 2 - 0.25 - (1 - Math.cos(a)) * 0.45, 0.6 - L * 0.55 - Math.sin(a) * 0.5]); }
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([-W / 2 + 0.0 + (1 - t) * 0.12, -1.2 + t * 1.8]); }
    add(parts, 'piano', extrudeXZ(pts.reverse(), 0.3, { y: 0.62, bevel: 0.01 }));
    // lid hinged on the straight (left) side, propped open
    const lid = extrudeXZ(pts, 0.02, {});
    lid.translate(W / 2, 0, 0); lid.rotateZ(0.55); lid.translate(-W / 2, 0.93, 0);
    add(parts, 'piano', lid);
    for (const [x, z] of [[-0.6, 0.45], [0.6, 0.45], [0.05, -1.05]]) add(parts, 'piano', lathe([[0, 0], [0.06, 0], [0.05, 0.1], [0.045, 0.62], [0, 0.62]], { x, z, seg: 14 }));
    add(parts, 'piano', boxOn(1.3, 0.1, 0.3, { y: 0.72, z: 0.75, r: 0.01 }));
    keys(parts, 1.2, 0.8, 0.72);
    add(parts, 'gold', rod([0.45, 0.93, -0.4], [0.45, 0.93 + Math.sin(0.55) * 1.2 - 0.05, -0.4], 0.008));
    return centerParts(parts);
  }
  add(parts, 'piano', boxOn(1.48, 1.25, 0.32, { z: -0.12, r: 0.01 }), boxOn(1.48, 0.08, 0.6, { y: 1.25, z: 0.0, r: 0.01 }).translate(0, -0.08, 0));
  for (const s of [-1, 1]) add(parts, 'piano', boxOn(0.05, 0.72, 0.62, { x: s * 0.715, z: 0.0, r: 0.008 }));
  add(parts, 'piano', boxOn(1.38, 0.07, 0.6, { y: 0.66, z: 0.0, r: 0.006 }), box(1.38, 0.2, 0.02, { y: 0.9, z: 0.04, rx: -12 }));
  keys(parts, 1.3, 0.0, 0.73);
  add(parts, 'gold', boxOn(0.03, 0.02, 0.06, { x: -0.06, y: 0.05, z: 0.16 }), boxOn(0.03, 0.02, 0.06, { x: 0.06, y: 0.05, z: 0.16 }));
  if (p.bench) add(parts, 'piano', boxOn(0.8, 0.06, 0.36, { y: 0.46, z: 0.65, r: 0.01 }), ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => boxOn(0.04, 0.46, 0.04, { x: sx * 0.36, z: 0.65 + sz * 0.15 }))));
  return centerParts(parts);
}

function keys(parts, W, z0, y) {
  add(parts, 'keysWhite', boxOn(W, 0.02, 0.15, { y, z: z0 + 0.22, r: 0.002 }));
  const n = 52, kw = W / n;
  const black = [1, 3, 6, 8, 10];
  for (let i = 0; i < n; i++) {
    add(parts, 'black', box(0.0012, 0.003, 0.15, { x: -W / 2 + i * kw, y: y + 0.0205, z: z0 + 0.22, r: 0 }));
    const note = (i + 5) % 7; // pattern C D E F G A B with blacks after C D F G A
    if ([0, 1, 3, 4, 5].includes(note) && i < n - 1) add(parts, 'black', boxOn(kw * 0.55, 0.012, 0.09, { x: -W / 2 + (i + 1) * kw, y: y + 0.02, z: z0 + 0.19, r: 0.002, seg: 1 }));
  }
  void black;
}

function chitarra(p) {
  const parts = {};
  const body = (sx, sz, h) => lathe([[0, 0], [1, 0], [1, h], [0, h]].map(([a, b]) => [a, b]), { seg: 40 }).scale(sx, 1, sz);
  // body: two overlapping ellipses (lower + upper bout) extruded along Z (thickness)
  const shape = new THREE.Shape();
  const pts = [];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const y = Math.sin(a), x = Math.cos(a);
    const rad = y < 0 ? 0.19 : 0.15 + 0.03 * (1 - y);
    const waist = 1 - 0.18 * Math.exp(-Math.pow((y + 0.05) * 3, 2));
    pts.push(new THREE.Vector2(x * rad * waist * (p.style === 'elettrica' ? 0.9 : 1), y * 0.25 + 0.0));
  }
  shape.setFromPoints(pts);
  const depth = p.style === 'elettrica' ? 0.045 : 0.1;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 24 });
  g.translate(0, 0, -depth / 2);
  add(parts, p.style === 'elettrica' ? 'main' : 'woodLight', g);
  add(parts, 'woodDark', box(0.05, 0.48, 0.025, { y: 0.48, z: 0.0, r: 0.006 }), box(0.07, 0.16, 0.02, { y: 0.8, z: -0.01, rx: 10, r: 0.008 }));
  if (p.style !== 'elettrica') add(parts, 'black', cylinder(0.05, 0.05, 0.002, { y: 0.1, z: depth / 2 + 0.006, rx: 90, seg: 32 }));
  else add(parts, 'black', box(0.08, 0.04, 0.004, { y: 0.0, z: depth / 2 + 0.006, r: 0.004 }), box(0.08, 0.04, 0.004, { y: -0.08, z: depth / 2 + 0.006, r: 0.004 }));
  add(parts, 'black', box(0.1, 0.015, 0.012, { y: -0.12, z: depth / 2 + 0.008, r: 0.004 }));
  for (let k = 0; k < 6; k++) add(parts, 'chrome', rod([(k - 2.5) * 0.007, -0.12, depth / 2 + 0.012], [(k - 2.5) * 0.006, 0.72, 0.016], 0.0007, { seg: 4 }));
  void body;
  // grip space: the hand closes around the neck
  for (const list of Object.values(parts)) for (const gg of list) gg.translate(0, -0.55, 0);
  return parts;
}

function sacco(p) {
  const parts = {}, H = 2.1;
  add(parts, 'darkMetal', boxOn(0.06, H, 0.06, { z: -0.5 }), box(0.06, 0.06, 0.6, { y: H - 0.03, z: -0.22 }), box(0.6, 0.04, 0.7, { y: 0.02, z: -0.3 }));
  add(parts, 'darkMetal', rod([0, H - 0.06, 0.05], [0, H - 0.3, 0.05], 0.004));
  add(parts, 'leather', lathe([[0, 0], [0.12, 0], [0.17, 0.03], [0.17, 0.95], [0.15, 1.0], [0, 1.0]], { y: H - 1.32, z: 0.05, seg: 28 }));
  add(parts, 'main', cylinder(0.172, 0.172, 0.12, { y: H - 0.9, z: 0.05, seg: 28, bevel: 0 }));
  return centerParts(parts);
}

function basket() {
  const parts = {};
  add(parts, 'basketball', sphere(0.12, { y: 0.12, ws: 32, hs: 20 }));
  for (const rz of [0, 90]) add(parts, 'black', torus(0.1205, 0.0018, { y: 0.12, rz, rs: 4, ts: 48 }));
  add(parts, 'black', torus(0.1205, 0.0018, { y: 0.12, rx: 90, rs: 4, ts: 48 }));
  return parts;
}

function skateboard() {
  const parts = {};
  const pts = [];
  for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; const c = Math.cos(a), s = Math.sin(a); pts.push([Math.sign(c) * Math.min(Math.abs(c) * 0.3 + 0.1, 0.4), s * 0.1]); }
  add(parts, 'main', extrudeXZ(pts.map(([x, z]) => [x, z]), 0.012, { y: 0.08, bevel: 0.003 }));
  add(parts, 'black', extrudeXZ(pts.map(([x, z]) => [x * 0.98, z * 0.96]), 0.002, { y: 0.092 }));
  for (const s of [-1, 1]) {
    add(parts, 'metal', box(0.04, 0.03, 0.16, { x: s * 0.27, y: 0.06, r: 0.005 }));
    for (const z of [-0.08, 0.08]) add(parts, 'plasticW', cylinder(0.027, 0.027, 0.03, { x: s * 0.27, y: 0.027, z: z + (z > 0 ? 0 : -0.03), rx: 90, seg: 16 }).translate(0, 0, z > 0 ? 0 : 0.03));
  }
  return parts;
}

function tapis() {
  const parts = {};
  add(parts, 'black', boxOn(0.8, 0.18, 1.9, { r: 0.03 }), boxOn(0.5, 0.01, 1.5, { y: 0.18, z: 0.1 }));
  for (const s of [-1, 1]) add(parts, 'darkMetal', rod([s * 0.35, 0.15, -0.75], [s * 0.35, 1.3, -0.85], 0.025));
  add(parts, 'black', box(0.75, 0.25, 0.12, { y: 1.35, z: -0.85, rx: -25, r: 0.02 }));
  add(parts, 'screenOn', box(0.3, 0.12, 0.004, { y: 1.37, z: -0.79, rx: -25 }));
  for (const s of [-1, 1]) add(parts, 'chrome', rod([s * 0.35, 1.1, -0.82], [s * 0.35, 1.1, -0.45], 0.016));
  return parts;
}

// ------------------------------------------------------------------------------------------ shoes & bags
function shoe(style, mirror) {
  const parts = {}, L = style === 'stivale' ? 0.29 : 0.28, NU = 28, NV = 14;
  const W = style === 'decollete' ? 0.04 : 0.046;
  const hw = (u) => {
    let w = W * (0.66 + 0.34 * Math.sin(Math.min(1, u * 1.15) * Math.PI * 0.82));
    if (u > 0.82) w *= Math.sqrt(Math.max(0, 1 - Math.pow((u - 0.82) / 0.18, 2)));
    if (u < 0.08) w *= Math.sqrt(Math.max(0.02, u / 0.08));
    return Math.max(0.002, w);
  };
  const hh = (u) => {
    const prof = { sneaker: [0.075, 0.085, 0.07, 0.045, 0.03], elegante: [0.065, 0.07, 0.06, 0.035, 0.022], decollete: [0.055, 0.03, 0.025, 0.03, 0.018], stivale: [0.1, 0.12, 0.08, 0.05, 0.03] }[style];
    const t = u * 4, i = Math.min(3, Math.floor(t)), f = t - i;
    return prof[i] * (1 - f) + prof[i + 1] * f;
  };
  const SOLE = style === 'sneaker' ? 0.03 : style === 'stivale' ? 0.025 : 0.012;
  const lift = (u) => (style === 'decollete' ? 0.085 * (1 - THREE.MathUtils.smoothstep(u, 0.3, 0.72)) : style === 'elegante' || style === 'stivale' ? 0.02 * (1 - THREE.MathUtils.smoothstep(u, 0.25, 0.35)) : 0);
  // upper as a parametric shell over the sole
  const pos = [], idx = [];
  for (let i = 0; i <= NU; i++) {
    const u = i / NU;
    for (let j = 0; j <= NV; j++) {
      const v = (j / NV) * Math.PI;
      const z = -L / 2 + u * L;
      pos.push(Math.cos(v) * hw(u), SOLE + lift(u) + Math.sin(v) * hh(u), z);
    }
  }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + NV + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  const up = new THREE.BufferGeometry();
  up.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  up.setIndex(idx);
  up.computeVertexNormals();
  add(parts, style === 'sneaker' ? 'plasticW' : 'shoe', up);
  // collar opening (dark) and laces / details
  const open = style === 'decollete' ? [0.08, 0.55] : [0.06, 0.36];
  const oz = -L / 2 + ((open[0] + open[1]) / 2) * L, ol = (open[1] - open[0]) * L / 2;
  const oy = SOLE + lift((open[0] + open[1]) / 2) + hh((open[0] + open[1]) / 2) * (style === 'decollete' ? 0.9 : 0.97);
  add(parts, 'black', sphere(1, { ws: 20, hs: 6 }).scale(hw(0.3) * 0.8, 0.006, ol).translate(0, oy, oz));
  if (style === 'stivale') add(parts, 'shoe', lathe([[0.05, 0], [0.055, 0.22], [0.052, 0.24], [0.047, 0.24], [0.045, 0.0]], { seg: 24 }).scale(1, 1, 1.15).translate(0, oy - 0.01, oz));
  if (style === 'sneaker') for (let k = 0; k < 5; k++) { const u = 0.4 + k * 0.07; add(parts, 'linen', box(hw(u) * 1.1, 0.006, 0.008, { y: SOLE + hh(u) + 0.002, z: -L / 2 + u * L })); }
  // sole outline
  const outline = [];
  for (let i = 0; i <= NU; i++) { const u = i / NU; outline.push([hw(u) + 0.004, -L / 2 + u * L]); }
  for (let i = NU; i >= 0; i--) { const u = i / NU; outline.push([-(hw(u) + 0.004), -L / 2 + u * L]); }
  const soleGeo = extrudeXZ(outline.map(([x, z]) => [x, -z]).reverse().map(([x, z]) => [x, -z]), SOLE, {});
  if (style === 'decollete' || style === 'elegante' || style === 'stivale') {
    // bend the sole with the foot pitch
    const sp = soleGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) { const u = (sp.getZ(i) + L / 2) / L; sp.setY(i, sp.getY(i) + lift(u)); }
    soleGeo.computeVertexNormals();
  }
  add(parts, style === 'sneaker' ? 'plasticW' : 'black', soleGeo);
  if (style === 'decollete') add(parts, 'black', boxOn(0.016, 0.085, 0.018, { z: -L / 2 + 0.03, r: 0.004 }).scale(1, 1, 1));
  if (style === 'elegante' || style === 'stivale') add(parts, 'black', boxOn(hw(0.1) * 1.7, 0.03, 0.06, { z: -L / 2 + 0.035, r: 0.006 }));
  if (mirror) for (const list of Object.values(parts)) for (const g of list) { g.scale(-1, 1, 1); flipWinding(g); }
  return parts;
}

function flipWinding(g) {
  if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } g.index.needsUpdate = true; }
  else { const p = g.attributes.position.array; for (let i = 0; i < p.length; i += 9) for (let k = 0; k < 3; k++) { const t = p[i + 3 + k]; p[i + 3 + k] = p[i + 6 + k]; p[i + 6 + k] = t; } }
  g.computeVertexNormals();
}

function scarpe(p) {
  const parts = {};
  merge(parts, shoe(p.style, false), { x: 0.065, ry: -6 });
  if (p.pair) merge(parts, shoe(p.style, true), { x: -0.065, ry: 6, z: 0.02 });
  return parts;
}

function zaino() {
  const parts = {};
  add(parts, 'main', boxOn(0.3, 0.42, 0.16, { r: 0.06 }), boxOn(0.24, 0.18, 0.06, { y: 0.04, z: 0.1, r: 0.03 }));
  add(parts, 'mainShade', box(0.31, 0.04, 0.17, { y: 0.4, r: 0.02 }));
  add(parts, 'black', tube([[-0.06, 0.42, -0.02], [0, 0.47, -0.02], [0.06, 0.42, -0.02]], 0.008, { segs: 10, rs: 6 }));
  for (const s of [-1, 1]) add(parts, 'black', tube([[s * 0.09, 0.4, -0.085], [s * 0.1, 0.25, -0.11], [s * 0.11, 0.05, -0.09]], 0.01, { segs: 10, rs: 6 }).scale(1, 1, 1));
  add(parts, 'metal', box(0.18, 0.006, 0.006, { y: 0.21, z: 0.13 }));
  return parts;
}

export const LEISURE_TYPES = [
  { id: 'manubrio', label: 'Manubrio', cat: 'sport', sub: 'palestra', color: '#3b3b40', tags: 'peso palestra fitness', params: [range('kg', 'Peso (kg)', 2, 30, 1, 10, '')], build: manubrio,
    hand: { radius: 0.016, presets: ['grip'], rest: () => [0, 0, -90], slide: () => [-0.04, 0.04] } },
  { id: 'panca_pesi', label: 'Panca con bilanciere', cat: 'sport', sub: 'palestra', color: '#7a1f24', tags: 'palestra pesi panca bilanciere', params: [flag('rack', 'Bilanciere', true), int('plates', 'Dischi per lato', 1, 4, 2)], build: pancaPesi },
  { id: 'biliardo', label: 'Tavolo da biliardo', cat: 'sport', sub: 'giochi', color: '#1f6b3a', tags: 'biliardo pool stecca bar', params: [seg('size', 'Misura', [['normale', 'Normale'], ['grande', 'Grande']], 'normale'), flag('balls', 'Bilie e stecca', true)], build: biliardo },
  { id: 'pingpong', label: 'Tavolo da ping-pong', cat: 'sport', sub: 'giochi', color: '#1f4fbf', tags: 'tennis tavolo', params: [], build: pingpong },
  { id: 'pianoforte', label: 'Pianoforte', cat: 'sport', sub: 'musica', color: '#141416', tags: 'piano musica strumento', params: [seg('style', 'Modello', [['verticale', 'Verticale'], ['coda', 'A coda']], 'verticale'), flag('bench', 'Panchetta', true)], build: pianoforte },
  { id: 'chitarra', label: 'Chitarra', cat: 'sport', sub: 'musica', color: '#c0504d', tags: 'chitarra musica strumento rock', params: [seg('style', 'Modello', [['acustica', 'Acustica'], ['elettrica', 'Elettrica']], 'acustica')], build: chitarra,
    hand: { radius: 0.022, presets: ['grip'], rest: () => [-90, 0, 0], slide: () => [-0.1, 0.25] } },
  { id: 'sacco_boxe', label: 'Sacco da boxe', cat: 'sport', sub: 'palestra', color: '#7a1f24', tags: 'boxe pugilato palestra', params: [], build: sacco },
  { id: 'basket', label: 'Pallone da basket', cat: 'sport', sub: 'palloni', color: '#d9822b', tags: 'pallacanestro palla', params: [], build: basket },
  { id: 'skateboard', label: 'Skateboard', cat: 'sport', sub: 'giochi', color: '#c0504d', tags: 'skate tavola', params: [], build: skateboard },
  { id: 'tapis', label: 'Tapis roulant', cat: 'sport', sub: 'palestra', color: '#3b3b40', tags: 'corsa palestra fitness', params: [], build: tapis },
  { id: 'scarpe', label: 'Scarpe', cat: 'accessori', sub: 'scarpe', color: '#7b4a2b', tags: 'scarpe sneakers tacchi stivali eleganti', params: [seg('style', 'Modello', [['sneaker', 'Sneakers'], ['elegante', 'Eleganti'], ['decollete', 'Décolleté'], ['stivale', 'Stivali']], 'sneaker'), flag('pair', 'Paio', true)], build: scarpe },
  { id: 'zaino', label: 'Zaino', cat: 'accessori', sub: 'borse-valigie', color: '#2f4a6b', tags: 'zaino scuola borsa', params: [], build: zaino },
];
