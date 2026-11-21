// Street furniture: lamps, traffic lights, road signs, bus stop, benches, bins,
// dumpsters, hydrant, poles, fences / railings, low walls, barriers, cones,
// phone booth, newsstand, drinking fountain, bollards, potted trees, post box,
// parking meter, bike rack. Real sizes (Italian street furniture where it has a
// recognizable look). The prop color paints the main painted metal ('c:paintMainM').
import * as THREE from 'three';
import { box, boxOn, cylinder, lathe, rod, sphere, torus, tube, roundedSlab, place, loft } from './util.js';
import { seed as seedParam, seg, range, int, flag } from '../props/params.js';
import { SIGN_TYPES, SIGN_SHAPE } from './tex.js';
import { treeInto } from './nature.js';

const P = 'c:paintMainM';
const push = (out, role, ...g) => (out[role] ||= []).push(...g);
function vcol(g, hex) {
  const c = new THREE.Color(hex).convertSRGBToLinear();
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// ------------------------------------------------------------------ lamps
function lampione(p) {
  const out = {}, H = p.height, st = p.style;
  if (st === 'classico') {
    push(out, P, lathe([[0, 0], [0.2, 0], [0.2, 0.08], [0.16, 0.12], [0.15, 0.45], [0.11, 0.55], [0.1, 0.62], [0.075, 0.7], [0.065, H - 0.95], [0.09, H - 0.9], [0.09, H - 0.82], [0.06, H - 0.78], [0, H - 0.78]], { seg: 16 }));
    for (const y of [0.8, H - 1.3]) push(out, P, torus(0.075, 0.015, { rx: 90, y, rs: 6, ts: 16 }));
    // lantern: tapered glass body, frame, roof, finial
    const y0 = H - 0.78;
    push(out, P, cylinder(0.12, 0.16, 0.06, { y: y0, seg: 4, bevel: 0.005, ry: 45 }));
    push(out, 'c:lampGlass', cylinder(0.16, 0.22, 0.48, { y: y0 + 0.06, seg: 4, bevel: 0.002, ry: 45 }));
    for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + (k * Math.PI) / 2; push(out, P, rod([Math.cos(a) * 0.16, y0 + 0.06, Math.sin(a) * 0.16], [Math.cos(a) * 0.225, y0 + 0.54, Math.sin(a) * 0.225], 0.01, { seg: 5 })); }
    push(out, P, cylinder(0.26, 0.04, 0.2, { y: y0 + 0.54, seg: 4, bevel: 0.004, ry: 45 }), sphere(0.035, { y: y0 + 0.77, ws: 10, hs: 8 }), cylinder(0.01, 0.002, 0.08, { y: y0 + 0.8, seg: 6 }));
  } else if (st === 'sfera') {
    push(out, P, lathe([[0, 0], [0.13, 0], [0.13, 0.1], [0.09, 0.15], [0.06, 0.3], [0.05, H - 0.4], [0.07, H - 0.35], [0, H - 0.35]], { seg: 14 }));
    push(out, 'c:lampGlass', sphere(0.24, { y: H - 0.12, ws: 20, hs: 14 }));
    push(out, P, cylinder(0.09, 0.07, 0.05, { y: H - 0.37, seg: 14 }));
  } else {
    // pole (galvanized or painted), arm(s) and LED heads
    const role = st === 'stradale' ? 'c:galv' : P;
    push(out, role, cylinder(0.11, 0.06, H, { seg: 12, bevel: 0.01 }), cylinder(0.16, 0.16, 0.5, { seg: 12, bevel: 0.01 }));
    const arms = st === 'doppio' ? [1, -1] : [1];
    const reach = st === 'stradale' ? 2.2 : 1.3;
    for (const s of arms) {
      const pts = st === 'stradale'
        ? [[0, H - 0.05, 0], [0, H + 0.4, 0], [0, H + 0.6, s * 0.4], [0, H + 0.55, s * 1.2], [0, H + 0.42, s * reach]]
        : [[0, H - 0.3, 0], [0, H + 0.05, s * 0.25], [0, H + 0.15, s * 0.8], [0, H + 0.12, s * reach]];
      push(out, role, tube(pts, 0.035, { segs: 20, rs: 8 }));
      const end = pts[pts.length - 1];
      push(out, role, box(0.28, 0.07, 0.62, { x: 0, y: end[1] - 0.02, z: end[2] + s * 0.22, rx: s * 4, r: 0.03 }));
      push(out, 'c:lampGlass', box(0.22, 0.012, 0.5, { y: end[1] - 0.06, z: end[2] + s * 0.22, rx: s * 4, r: 0.004 }));
    }
  }
  return out;
}

// ------------------------------------------------------------------ traffic light
function semaforo(p) {
  const out = {}, lit = p.light;
  const head = (x, y, z, ry = 0, ped = false) => {
    const n = ped ? 2 : 3, hh = n * 0.3 + 0.08;
    push(out, 'c:trim', box(0.32, hh, 0.24, { x, y: y + hh / 2, z, ry, r: 0.03 }));
    const fwd = [Math.sin((ry * Math.PI) / 180), Math.cos((ry * Math.PI) / 180)];
    // backplate with white border
    push(out, 'c:trim', box(0.5, hh + 0.14, 0.02, { x: x - fwd[0] * 0.13, y: y + hh / 2, z: z - fwd[1] * 0.13, ry, r: 0.01 }));
    const cols = ped ? [['rosso', '#ff3b2f', '#3a1210'], ['verde', '#2fe07a', '#0e3320']] : [['rosso', '#ff3b2f', '#3a1210'], ['giallo', '#ffc21a', '#3f300a'], ['verde', '#2fe07a', '#0e3320']];
    cols.forEach(([name, on, off], i) => {
      const yy = y + hh - 0.19 - i * 0.3;
      const disc = cylinder(0.1, 0.1, 0.03, { rx: 90, seg: 18 });
      place(disc, { ry, x: x + fwd[0] * 0.115, y: yy, z: z + fwd[1] * 0.115 });
      push(out, 'c:lightsVC', vcol(disc, lit === name ? on : off));
      const visor = new THREE.CylinderGeometry(0.125, 0.125, 0.16, 14, 1, true, Math.PI / 2 - 0.3, Math.PI + 0.6);
      visor.rotateX(Math.PI / 2); visor.translate(0, 0, 0.08);
      place(visor, { ry, x: x + fwd[0] * 0.12, y: yy, z: z + fwd[1] * 0.12 });
      push(out, 'c:trimD', visor);
    });
  };
  if (p.kind === 'sbraccio') {
    push(out, 'c:galv', cylinder(0.12, 0.09, 6.0, { seg: 12 }), cylinder(0.17, 0.17, 0.4, { seg: 12 }));
    push(out, 'c:galv', rod([0, 5.7, 0], [-p.reach, 5.7, 0], 0.07, { seg: 10 }), rod([0, 4.9, 0], [-p.reach * 0.45, 5.68, 0], 0.035, { seg: 8 }));
    head(-p.reach + 0.3, 4.6, 0.12, 0);
    head(0, 2.3, 0.18, 0);
  } else {
    push(out, 'c:galv', cylinder(0.065, 0.06, 3.1, { seg: 12 }), cylinder(0.12, 0.12, 0.25, { seg: 12 }));
    head(0, 2.15, 0.17, 0);
  }
  if (p.ped) head(0, 1.2, -0.17, 180, true);
  // push-button box for pedestrians
  if (p.ped) push(out, 'c:yellowPaint', box(0.12, 0.2, 0.08, { y: 1.05, z: 0.1, r: 0.015 }));
  return out;
}

// ------------------------------------------------------------------ road signs
/** Sign plate outline in canvas pixels (matches tex.js signTex drawings). */
function signOutline(kind) {
  const shape = SIGN_SHAPE[kind];
  const cx = 128, cy = 128;
  if (shape === 'circle') { const o = []; for (let i = 0; i < 40; i++) { const a = (i / 40) * Math.PI * 2; o.push([cx + Math.cos(a) * 121, cy + Math.sin(a) * 121]); } return { o, W: 256, H: 256 }; }
  if (shape === 'oct') { const o = []; for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; o.push([cx + Math.cos(a) * 119, cy + Math.sin(a) * 119]); } return { o, W: 256, H: 256 }; }
  if (shape === 'tri') return { o: [[cx, cy - 112], [cx + 121, cy + 94], [cx - 121, cy + 94]], W: 256, H: 256 };
  if (shape === 'tri_down') return { o: [[cx, cy + 112], [cx - 121, cy - 94], [cx + 121, cy - 94]], W: 256, H: 256 };
  if (shape === 'rect' || shape === 'wide') return { o: [[4, 4], [252, 4], [252, 124], [4, 124]], W: 256, H: 128 };
  return { o: [[6, 6], [250, 6], [250, 250], [6, 250]], W: 256, H: 256 };
}
function signPlate(kind, size, out, { y, z = 0.05, x = 0 }) {
  const { o, W, H } = signOutline(kind);
  const sx = size * (W === 256 && H === 128 ? (kind === 'direzione' ? 2.0 : 1.4) : 1), sy = sx * (H / W);
  const toL = ([px, py]) => new THREE.Vector2(((px / W) - 0.5) * sx, (0.5 - py / H) * sy);
  const shape = new THREE.Shape(o.map(toL));
  const face = new THREE.ShapeGeometry(shape, 6);
  const pp = face.attributes.position, uv = face.attributes.uv;
  for (let i = 0; i < pp.count; i++) uv.setXY(i, pp.getX(i) / sx + 0.5, pp.getY(i) / sy + 0.5);
  face.translate(x, y, z + 0.011);
  push(out, 'c:sign:' + kind, face);
  const plate = new THREE.ExtrudeGeometry(shape, { depth: 0.01, bevelEnabled: false, curveSegments: 6 });
  plate.translate(x, y, z);
  push(out, 'c:signBack', plate);
  return sy;
}
function cartello(p) {
  const out = {}, kind = p.kind, H = p.height;
  const size = SIGN_SHAPE[kind] === 'tri' || SIGN_SHAPE[kind] === 'tri_down' ? 0.9 : 0.62;
  push(out, 'c:galv', cylinder(0.03, 0.03, H + 0.1, { seg: 10 }), sphere(0.032, { y: H + 0.1, ws: 8, hs: 6 }));
  const yc = H - 0.4;
  signPlate(kind, size, out, { y: yc, z: 0.035 });
  if (p.second !== 'nessuno') signPlate(p.second, 0.55, out, { y: yc - 0.75, z: 0.035 });
  // clamps
  for (const dy of [0.15, -0.15]) push(out, 'c:galv', box(0.09, 0.03, 0.05, { y: yc + dy, z: 0.018 }));
  return out;
}

// ------------------------------------------------------------------ bus stop
function fermata(p) {
  const out = {}, W = p.width, D = 1.4, H = 2.45;
  for (const x of [-W / 2 + 0.05, W / 2 - 0.05]) for (const z of [-D / 2 + 0.05, D / 2 - 0.25]) push(out, 'c:steel', boxOn(0.07, H, 0.07, { x, z, r: 0.01 }));
  push(out, P, box(W + 0.3, 0.1, D + 0.25, { y: H + 0.05, z: 0.05, rx: -3, r: 0.02 }));
  push(out, 'c:glassT', box(W - 0.1, 1.9, 0.012, { y: 1.15, z: -D / 2 + 0.05 }));
  push(out, 'c:glassT', box(0.012, 1.9, D - 0.35, { x: -W / 2 + 0.05, y: 1.15, z: -0.1 }));
  // advertising panel on the other side, bench along the back
  push(out, 'c:steel', box(0.08, 1.9, D - 0.35, { x: W / 2 - 0.05, y: 1.15, z: -0.1, r: 0.01 }));
  for (const s of [-1, 1]) push(out, 'c:poster', box(0.01, 1.7, D - 0.55, { x: W / 2 - 0.05 + s * 0.045, y: 1.15, z: -0.1 }));
  const bw = Math.min(W - 0.6, 2.2);
  push(out, 'c:wood', box(bw, 0.05, 0.38, { y: 0.47, z: -D / 2 + 0.3, r: 0.01 }));
  for (const x of [-bw / 2 + 0.1, bw / 2 - 0.1]) push(out, 'c:steel', boxOn(0.05, 0.45, 0.32, { x, z: -D / 2 + 0.3, r: 0.008 }));
  // stop sign pole
  push(out, 'c:galv', cylinder(0.035, 0.035, 2.9, { x: W / 2 + 0.6, z: D / 2 - 0.1, seg: 10 }));
  push(out, 'c:decalFermata', box(0.5, 0.35, 0.03, { x: W / 2 + 0.6, y: 2.65, z: D / 2 - 0.06, r: 0.01 }));
  push(out, 'c:poster', box(0.32, 0.45, 0.02, { x: W / 2 + 0.6, y: 1.6, z: D / 2 - 0.06 }));
  return out;
}

// ------------------------------------------------------------------ benches, bins, dumpsters
function panchina(p) {
  const out = {}, L = p.length;
  if (p.style === 'moderna') {
    push(out, 'c:concrete', boxOn(L, 0.4, 0.5, { r: 0.03 }));
    push(out, 'c:wood', box(L - 0.05, 0.05, 0.52, { y: 0.425, r: 0.01 }));
    return out;
  }
  const legs = p.style === 'parco' ? 'c:wood' : P;
  const n = Math.max(2, Math.ceil(L / 1.6) + 1);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + 0.12 + (i * (L - 0.24)) / (n - 1);
    if (p.style === 'parco') {
      push(out, legs, boxOn(0.08, 0.42, 0.08, { x, z: 0.15, r: 0.01 }), boxOn(0.08, 0.85, 0.08, { x, z: -0.2, r: 0.01 }), box(0.06, 0.06, 0.5, { x, y: 0.4, z: -0.02, r: 0.01 }));
    } else {
      // cast iron side: curved leg + armrest (swept tube profile)
      push(out, legs, tube([[x, 0, 0.26], [x, 0.22, 0.2], [x, 0.4, 0.15], [x, 0.42, -0.05], [x, 0.44, -0.2]], 0.025, { segs: 12, rs: 6 }));
      push(out, legs, tube([[x, 0, -0.26], [x, 0.25, -0.22], [x, 0.44, -0.2], [x, 0.7, -0.27], [x, 0.88, -0.32]], 0.025, { segs: 12, rs: 6 }));
      if (i === 0 || i === n - 1) push(out, legs, tube([[x, 0.42, -0.2], [x, 0.63, -0.15], [x, 0.66, 0.1], [x, 0.6, 0.24], [x, 0.42, 0.18]], 0.02, { segs: 14, rs: 6 }));
    }
  }
  // seat + back slats
  for (let k = 0; k < 4; k++) push(out, 'c:wood', box(L, 0.035, 0.085, { y: 0.43, z: 0.15 - k * 0.1, r: 0.008 }));
  for (let k = 0; k < 3; k++) push(out, 'c:wood', box(L, 0.085, 0.03, { y: 0.55 + k * 0.11, z: -0.24 - k * 0.025, rx: -12, r: 0.008 }));
  return out;
}
function cestino(p) {
  const out = {};
  if (p.style === 'palo') {
    push(out, 'c:metalDark', cylinder(0.035, 0.035, 1.05, { seg: 10 }));
    push(out, P, lathe([[0.17, 0], [0.19, 0.5], [0.205, 0.5], [0.205, 0.53], [0.18, 0.53], [0.165, 0.02], [0, 0.02], [0, 0]], { seg: 20, x: 0, y: 0.45, z: 0.22 }));
    push(out, 'c:metalDark', box(0.06, 0.12, 0.08, { y: 0.85, z: 0.06 }));
  } else if (p.style === 'differenziata') {
    const cols = ['#2f6b3a', '#e2b21e', '#2f5aa8', '#7a7d80'];
    cols.forEach((c, i) => {
      const x = (i - 1.5) * 0.46;
      push(out, 'c:plasticVC', vcol(box(0.42, 0.85, 0.42, { x, y: 0.425, r: 0.04 }), c));
      push(out, 'c:plasticVC', vcol(box(0.44, 0.06, 0.44, { x, y: 0.88, r: 0.02 }), c));
      push(out, 'c:trim', box(0.2, 0.03, 0.01, { x, y: 0.75, z: 0.212 }));
    });
  } else {
    push(out, P, cylinder(0.25, 0.25, 0.85, { seg: 24, bevel: 0.01 }));
    push(out, P, lathe([[0.26, 0], [0.26, 0.05], [0.2, 0.15], [0.06, 0.2], [0, 0.2]], { y: 0.85, seg: 24 }));
    push(out, 'c:trim', box(0.2, 0.06, 0.08, { y: 0.92, z: 0.18 }));
  }
  return out;
}
function cassonetto(p) {
  const out = {}, W = 1.7, H = 1.55, D = 1.1;
  push(out, P, box(W, H - 0.25, D, { y: 0.2 + (H - 0.25) / 2, r: 0.06 }));
  push(out, P, box(W + 0.06, 0.1, D + 0.08, { y: H - 0.02, rx: -5, r: 0.03 }));
  push(out, 'c:whitePaint', box(0.6, 0.22, 0.01, { y: H - 0.45, z: D / 2 + 0.003 }));
  push(out, 'c:trim', box(W - 0.2, 0.08, 0.06, { y: 0.32, z: D / 2 + 0.02, r: 0.02 }), box(0.25, 0.05, 0.2, { x: 0.5, y: 0.2, z: D / 2 + 0.1 }));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { push(out, 'c:tire', cylinder(0.09, 0.09, 0.06, { rz: 90, x: sx * (W / 2 - 0.15) - 0.03, y: 0.09, z: sz * (D / 2 - 0.15), seg: 12 })); push(out, 'c:trim', box(0.06, 0.12, 0.08, { x: sx * (W / 2 - 0.15), y: 0.18, z: sz * (D / 2 - 0.15) })); }
  return out;
}
function idrante(p) {
  const out = {};
  push(out, 'c:redPaint', lathe([[0, 0], [0.16, 0], [0.16, 0.05], [0.11, 0.08], [0.1, 0.62], [0.12, 0.65], [0.12, 0.69], [0.09, 0.72], [0.05, 0.8], [0, 0.82]], { seg: 20 }));
  for (const s of [-1, 1]) {
    push(out, 'c:redPaint', cylinder(0.045, 0.045, 0.09, { rz: s * 90, y: 0.48, seg: 14 }));
    push(out, 'c:steel', cylinder(0.055, 0.055, 0.03, { rz: s * 90, x: s * 0.085, y: 0.48, seg: 6 }));
  }
  push(out, 'c:steel', cylinder(0.03, 0.03, 0.04, { y: 0.81, seg: 5 }));
  return out;
}
function palo(p) {
  const out = {}, H = p.height;
  if (p.style === 'legno') {
    push(out, 'c:woodDark', cylinder(0.13, 0.1, H, { seg: 10, bevel: 0.01 }));
    push(out, 'c:woodDark', box(1.8, 0.1, 0.1, { y: H - 0.45, r: 0.01 }));
    for (const x of [-0.8, -0.35, 0.35, 0.8]) push(out, 'c:whitePaint', cylinder(0.035, 0.03, 0.14, { x, y: H - 0.4, seg: 8 }));
    for (let y = 2.2; y < H - 1; y += 0.45) push(out, 'c:steel', rod([0, y, 0], [y % 0.9 < 0.45 ? 0.22 : -0.22, y, 0], 0.01, { seg: 4 }));
  } else if (p.style === 'bandiera') {
    push(out, 'c:steel', cylinder(0.05, 0.03, H, { seg: 10 }), sphere(0.05, { y: H, ws: 10, hs: 8 }));
    const flagG = new THREE.PlaneGeometry(1.5, 1.0, 8, 4);
    const pp = flagG.attributes.position;
    for (let i = 0; i < pp.count; i++) { const x = pp.getX(i) + 0.75; pp.setXYZ(i, x + 0.05, pp.getY(i) + H - 0.6, Math.sin(x * 3) * 0.08 * x); }
    flagG.computeVertexNormals();
    push(out, 'c:flag', flagG);
  } else {
    push(out, 'c:galv', cylinder(0.04, 0.04, H, { seg: 10 }), cylinder(0.045, 0.045, 0.04, { y: H, seg: 10 }));
  }
  return out;
}

// ------------------------------------------------------------------ fences, walls, barriers
function recinzione(p) {
  const out = {}, L = p.length, H = p.height, st = p.style;
  const posts = Math.max(2, Math.round(L / (st === 'rete' ? 2.5 : 2)) + 1);
  const px = (i) => -L / 2 + (i * L) / (posts - 1);
  if (st === 'ringhiera' || st === 'cancellata') {
    const role = st === 'ringhiera' ? P : 'c:metalDark';
    for (let i = 0; i < posts; i++) push(out, role, boxOn(0.05, H + 0.04, 0.05, { x: px(i), r: 0.005 }));
    push(out, role, box(L, 0.04, 0.05, { y: H - 0.02, r: 0.005 }), box(L, 0.03, 0.03, { y: 0.1 }));
    const n = Math.floor(L / 0.12);
    for (let i = 1; i < n; i++) {
      const x = -L / 2 + (i * L) / n;
      push(out, role, box(0.018, H - 0.1, 0.018, { x, y: 0.05 + (H - 0.1) / 2, r: 0 }));
      if (st === 'cancellata') push(out, 'c:metalDark', cylinder(0.022, 0.001, 0.09, { x, y: H, seg: 4 }));
    }
  } else if (st === 'staccionata') {
    for (let i = 0; i < posts; i++) push(out, 'c:wood', cylinder(0.06, 0.055, H + 0.1, { x: px(i), seg: 8 }));
    for (const y of [H * 0.4, H * 0.85]) push(out, 'c:wood', cylinder(0.045, 0.045, L, { rz: 90, x: L / 2, y, z: 0.07, seg: 8 }));
  } else if (st === 'legno') {
    const n = Math.floor(L / 0.13);
    for (let i = 0; i < n; i++) {
      const x = -L / 2 + 0.065 + i * (L / n);
      push(out, 'c:wood', boxOn(0.11, H, 0.025, { x, r: 0.004 }), cylinder(0.078, 0.001, 0.08, { rx: 0, x, y: H, seg: 4, ry: 45 }));
    }
    for (const y of [0.25, H - 0.3]) push(out, 'c:woodDark', box(L, 0.08, 0.025, { y, z: -0.026 }));
  } else if (st === 'rete') {
    for (let i = 0; i < posts; i++) push(out, 'c:galv', cylinder(0.025, 0.025, H, { x: px(i), seg: 8 }));
    push(out, 'c:galv', cylinder(0.018, 0.018, L, { rz: 90, x: L / 2, y: H - 0.03, seg: 8 }));
    const mesh = new THREE.PlaneGeometry(L, H - 0.08);
    const uv = mesh.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L * 2, uv.getY(i) * (H - 0.08) * 2);
    mesh.translate(0, (H - 0.08) / 2 + 0.03, 0.03);
    push(out, 'c:chain', mesh);
  } else if (st === 'parapedonale') {
    // pedestrian guard rail: red/white tubes on posts
    for (let i = 0; i < posts; i++) push(out, 'c:whitePaint', cylinder(0.035, 0.035, H, { x: px(i), seg: 10 }));
    push(out, 'c:redPaint', cylinder(0.03, 0.03, L, { rz: 90, x: L / 2, y: H - 0.05, seg: 10 }), cylinder(0.02, 0.02, L, { rz: 90, x: L / 2, y: H * 0.5, seg: 8 }));
  }
  return out;
}
function muretto(p) {
  const out = {}, L = p.length, H = p.height, T = p.thickness;
  const role = { mattoni: 'c:brickTex', pietra: 'c:stone', cemento: 'c:concrete', intonaco: P }[p.material] || 'c:concrete';
  const g = boxOn(L, H, T, { r: 0.01 });
  // box-projected uvs in meters (textures tile)
  const pp = g.attributes.position, nn = g.attributes.normal, uv = g.attributes.uv;
  const tile = p.material === 'mattoni' ? 1 : 1.5;
  for (let i = 0; i < pp.count; i++) {
    const ax = Math.abs(nn.getX(i)), ay = Math.abs(nn.getY(i));
    uv.setXY(i, (ax > 0.5 ? pp.getZ(i) : pp.getX(i)) / tile, (ay > 0.5 ? pp.getZ(i) : pp.getY(i)) / tile);
  }
  push(out, role, g);
  if (p.cap) push(out, p.material === 'intonaco' ? 'c:curb' : 'c:concrete', box(L + 0.06, 0.06, T + 0.08, { y: H + 0.03, r: 0.012 }));
  return out;
}
function transenna(p) {
  const out = {}, st = p.style;
  if (st === 'jersey') {
    const L = p.length;
    const prof = [[-0.3, 0], [0.3, 0], [0.3, 0.08], [0.2, 0.33], [0.08, 0.8], [-0.08, 0.8], [-0.2, 0.33], [-0.3, 0.08]];
    const rings = [-L / 2, L / 2].map((x) => prof.map(([z, y]) => [x, y, z]));
    let g = loft(rings, { closed: true, capStart: true, capEnd: true });
    if (g.attributes.normal.getY(4) < 0) { g.dispose(); g = loft(rings, { closed: true, capStart: true, capEnd: true, flip: true }); }
    const pp = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pp.count; i++) uv.setXY(i, pp.getX(i) / 1.5, (pp.getY(i) + pp.getZ(i)) / 1.5);
    push(out, 'c:concrete', g);
    return out;
  }
  if (st === 'cantiere') {
    const L = p.length;
    const n = Math.max(4, Math.round(L / 0.25));
    for (let i = 0; i < n; i++) { const x = -L / 2 + (i + 0.5) * (L / n); push(out, 'c:plasticVC', vcol(box(L / n, 0.2, 0.03, { x, y: 0.95 }), i % 2 ? '#f2f2ee' : '#d8261c')); }
    for (const s of [-1, 1]) {
      push(out, 'c:galv', rod([s * (L / 2 - 0.1), 0.05, 0.25], [s * (L / 2 - 0.1), 1.05, 0], 0.02, { seg: 6 }), rod([s * (L / 2 - 0.1), 0.05, -0.25], [s * (L / 2 - 0.1), 1.05, 0], 0.02, { seg: 6 }));
      push(out, 'c:plasticVC', vcol(box(0.2, 0.06, 0.6, { x: s * (L / 2 - 0.1), y: 0.03, r: 0.02 }), '#2c2c2c'));
    }
    return out;
  }
  // crowd-control barrier (2 m)
  const L = 2.0, H = 1.1;
  push(out, 'c:galv', tube([[-L / 2, 0.15, 0], [-L / 2, H, 0], [L / 2, H, 0], [L / 2, 0.15, 0]], 0.02, { segs: 24, rs: 8 }));
  push(out, 'c:galv', rod([-L / 2, 0.25, 0], [L / 2, 0.25, 0], 0.018, { seg: 8 }));
  for (let i = 1; i < 14; i++) { const x = -L / 2 + (i * L) / 14; push(out, 'c:galv', rod([x, 0.25, 0], [x, H, 0], 0.008, { seg: 5 })); }
  for (const s of [-1, 1]) push(out, 'c:galv', rod([s * L / 2, 0.15, 0], [s * L / 2, 0.01, 0.35], 0.018, { seg: 6 }), rod([s * L / 2, 0.15, 0], [s * L / 2, 0.01, -0.35], 0.018, { seg: 6 }));
  return out;
}
function cono(p) {
  const out = {}, H = p.size;
  const k = H / 0.75;
  push(out, 'c:plasticVC', vcol(box(0.38 * k, 0.03 * k, 0.38 * k, { y: 0.015 * k, r: 0.02 * k }), '#2a2a2a'));
  const bands = [[0.03, 0.2, '#ef5a1a'], [0.2, 0.3, '#f2f2ee'], [0.3, 0.45, '#ef5a1a'], [0.45, 0.53, '#f2f2ee'], [0.53, 0.75, '#ef5a1a']];
  for (const [a, b, c] of bands) {
    const ra = 0.15 * (1 - a / 0.82), rb = 0.15 * (1 - b / 0.82);
    push(out, 'c:plasticVC', vcol(lathe([[ra * k, a * k], [rb * k, b * k]], { seg: 20 }), c));
  }
  push(out, 'c:plasticVC', vcol(lathe([[0.15 * (1 - 0.75 / 0.82) * k, 0.75 * k], [0, 0.755 * k]], { seg: 20 }), '#ef5a1a'));
  return out;
}

// ------------------------------------------------------------------ booths, kiosks, fountains, bollards, planters
function cabina(p) {
  const out = {};
  if (p.style === 'inglese') {
    const W = 0.95, H = 2.5;
    push(out, 'c:redPaint', boxOn(W, 0.12, W, { r: 0.01 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) push(out, 'c:redPaint', boxOn(0.1, H - 0.2, 0.1, { x: sx * (W / 2 - 0.05), z: sz * (W / 2 - 0.05), r: 0.01 }));
    push(out, 'c:redPaint', box(W + 0.06, 0.2, W + 0.06, { y: H - 0.1, r: 0.02 }), lathe([[0.55, 0], [0.5, 0.08], [0.3, 0.16], [0, 0.2]], { y: H, seg: 4, ry: 45 }));
    for (const [ry, dx, dz] of [[0, 0, 1], [90, 1, 0], [180, 0, -1], [270, -1, 0]]) {
      const cx = dx * (W / 2 - 0.02), cz = dz * (W / 2 - 0.02);
      for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) {
        const g = box(0.2, 0.22, 0.012, { x: (c - 1) * 0.24, y: 0.85 + r * 0.25 });
        place(g, { ry, x: cx, z: cz });
        push(out, 'c:glassT', g);
      }
      const frame = box(W - 0.15, H - 0.75, 0.03, { y: 0.15 + (H - 0.75) / 2 + 0.25 });
      place(frame, { ry, x: cx * 0.98, z: cz * 0.98 });
      push(out, 'c:redPaint', frame);
      const sign = box(W - 0.25, 0.14, 0.02, { y: H - 0.12 });
      place(sign, { ry, x: dx * (W / 2 + 0.03), z: dz * (W / 2 + 0.03) });
      push(out, 'c:decalTel', sign);
    }
    return out;
  }
  // Italian booth: grey frame, glass on three sides, phone unit
  const W = 1.0, H = 2.3;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) push(out, P, boxOn(0.06, H, 0.06, { x: sx * (W / 2 - 0.03), z: sz * (W / 2 - 0.03), r: 0.01 }));
  push(out, P, box(W + 0.12, 0.12, W + 0.12, { y: H + 0.06, r: 0.03 }));
  push(out, 'c:glassT', box(W - 0.06, H - 0.4, 0.012, { y: 0.2 + (H - 0.4) / 2, z: -W / 2 + 0.03 }), box(0.012, H - 0.4, W - 0.06, { x: W / 2 - 0.03, y: 0.2 + (H - 0.4) / 2 }), box(0.012, H - 0.4, W - 0.06, { x: -W / 2 + 0.03, y: 0.2 + (H - 0.4) / 2 }));
  push(out, 'c:trim', box(0.3, 0.45, 0.14, { y: 1.35, z: -W / 2 + 0.12, r: 0.03 }));
  push(out, 'c:lightsVC', vcol(box(0.62, 0.1, 0.02, { y: H - 0.05, z: W / 2 + 0.07 }), '#e9e9e4'));
  return out;
}
function edicola(p) {
  const out = {}, W = 3.0, D = 2.0, H = 2.5;
  push(out, P, boxOn(W, H, D, { r: 0.04 }));
  push(out, P, box(W + 0.5, 0.12, D + 0.5, { y: H + 0.06, r: 0.03 }), box(W + 0.3, 0.3, D + 0.3, { y: H + 0.27, r: 0.04 }));
  // open front with counter, magazine walls
  push(out, 'c:trim', box(W - 0.4, 1.1, 0.02, { y: 1.55, z: D / 2 + 0.003 }));
  push(out, 'c:mags', box(W - 0.5, 1.0, 0.02, { y: 1.55, z: D / 2 + 0.012 }));
  push(out, 'c:wood', box(W - 0.3, 0.06, 0.4, { y: 0.98, z: D / 2 + 0.15, r: 0.01 }));
  for (const s of [-1, 1]) {
    push(out, 'c:mags', box(0.02, 1.0, D - 0.4, { x: s * (W / 2 + 0.012), y: 1.5 }));
    push(out, 'c:steel', box(0.04, 0.02, D - 0.4, { x: s * (W / 2 + 0.05), y: 1.0 }));
  }
  // awning (sloped) on the front
  push(out, 'c:awning', box(W + 0.4, 0.04, 0.9, { y: H - 0.05, z: D / 2 + 0.4, rx: 14, r: 0.01 }));
  push(out, 'c:decalEdicola', box(1.6, 0.26, 0.02, { y: H + 0.27, z: D / 2 + 0.16 }));
  return out;
}
function fontanella(p) {
  const out = {};
  push(out, 'c:stone', box(0.9, 0.06, 0.7, { y: 0.03, r: 0.01 }));
  push(out, 'c:iron', box(0.45, 0.012, 0.3, { y: 0.065, z: 0.12 }));
  push(out, 'c:nasone', lathe([[0, 0.06], [0.17, 0.06], [0.17, 0.1], [0.14, 0.13], [0.14, 0.86], [0.16, 0.9], [0.16, 0.95], [0.1, 1.0], [0, 1.02]], { seg: 20 }));
  push(out, 'c:nasone', tube([[0, 0.78, 0.12], [0, 0.8, 0.22], [0, 0.74, 0.3], [0, 0.66, 0.32]], 0.022, { segs: 14, rs: 8 }));
  return out;
}
function dissuasore(p) {
  const out = {}, n = p.count, st = p.style;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 1.4;
    if (st === 'cemento') push(out, 'c:concrete', lathe([[0, 0], [0.26, 0], [0.25, 0.1], [0.2, 0.25], [0.1, 0.33], [0, 0.35]], { seg: 20, x }));
    else if (st === 'pietra') push(out, 'c:stone', lathe([[0, 0], [0.16, 0], [0.15, 0.55], [0.12, 0.65], [0, 0.7]], { seg: 14, x }));
    else { push(out, 'c:metalDark', cylinder(0.055, 0.055, 0.85, { x, seg: 12 }), sphere(0.07, { x, y: 0.9, ws: 12, hs: 8 })); push(out, 'c:yellowPaint', cylinder(0.057, 0.057, 0.05, { x, y: 0.7, seg: 12 })); }
    if (p.chain && i < n - 1) {
      const y = st === 'cemento' ? 0.3 : 0.65;
      const pts = [];
      for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push([x + t * 1.4, y - Math.sin(Math.PI * t) * 0.2, 0]); }
      push(out, 'c:metalDark', tube(pts, 0.012, { segs: 20, rs: 5 }));
    }
  }
  return out;
}
function alberoVaso(p) {
  const out = {}, S = p.potSize;
  const role = p.pot === 'legno' ? 'c:wood' : p.pot === 'terracotta' ? 'c:terracotta' : 'c:concrete';
  if (p.pot === 'terracotta') push(out, role, lathe([[0, 0], [S * 0.38, 0], [S * 0.5, S * 0.75], [S * 0.55, S * 0.8], [S * 0.5, S * 0.8], [0, S * 0.75]], { seg: 24 }));
  else push(out, role, boxOn(S, S * 0.75, S, { r: 0.02 }));
  push(out, 'c:dirt', p.pot === 'terracotta' ? cylinder(S * 0.47, S * 0.47, 0.01, { y: S * 0.72, seg: 20 }) : box(S - 0.08, 0.01, S - 0.08, { y: S * 0.75 - 0.03 }));
  const sub = {};
  const y0 = S * 0.73;
  if (p.plant === 'sfera') {
    push(out, 'c:woodDark', cylinder(0.03, 0.025, p.height * 0.6, { y: y0, seg: 6 }));
    // a clipped ball: reuse a bush-like blob
    const ball = new THREE.IcosahedronGeometry(p.height * 0.28, 2);
    ball.translate(0, y0 + p.height * 0.6 + p.height * 0.2, 0);
    push(out, 'c:foliageVC1', vcol(ball, '#cfd6c6'));
    return out;
  }
  treeInto(sub, p.plant === 'conifera' ? 'cipresso' : 'latifoglia', { height: p.height, seed: p.seed, season: 'estate', width: p.plant === 'conifera' ? 0.8 : 0.75 }, {});
  for (const [role2, list] of Object.entries(sub)) for (const g of list) { g.translate(0, y0, 0); push(out, role2, g); }
  return out;
}
function cassettaPostale(p) {
  const out = {};
  push(out, 'c:metalDark', cylinder(0.04, 0.04, 0.9, { seg: 10 }));
  push(out, 'c:redPaint', box(0.42, 0.55, 0.3, { y: 1.15, r: 0.05 }), cylinder(0.21, 0.21, 0.3, { rx: 90, y: 1.42, z: -0.15, seg: 18 }));
  push(out, 'c:trim', box(0.24, 0.03, 0.02, { y: 1.28, z: 0.152 }));
  push(out, 'c:whitePaint', box(0.3, 0.1, 0.01, { y: 1.05, z: 0.152 }));
  return out;
}
function parchimetro(p) {
  const out = {};
  push(out, 'c:metalDark', boxOn(0.2, 0.9, 0.15, { r: 0.02 }));
  push(out, 'c:paintB2', box(0.34, 0.55, 0.25, { y: 1.18, r: 0.04 }));
  push(out, 'c:lightsVC', vcol(box(0.2, 0.12, 0.01, { y: 1.3, z: 0.126 }), '#9fd0ff'), vcol(box(0.2, 0.18, 0.01, { y: 1.08, z: 0.126 }), '#e8e8e4'));
  push(out, 'c:sign:parcheggio', box(0.2, 0.2, 0.01, { y: 1.53, z: 0.0 }));
  return out;
}
function rastrelliera(p) {
  const out = {}, n = p.count;
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.8;
    push(out, 'c:galv', tube([[x, 0, -0.35], [x, 0.7, -0.35], [x, 0.85, -0.2], [x, 0.85, 0.2], [x, 0.7, 0.35], [x, 0, 0.35]], 0.024, { segs: 24, rs: 8 }));
  }
  return out;
}

// ------------------------------------------------------------------ registry
const S = seedParam;
const F = (id, label, color, params, build, extra = {}) => ({ id, label, cat: 'esterni', sub: 'arredo', color, params, build, palette: 'metal', ...extra });
export const STREET_TYPES = [
  F('es_lampione', 'Lampione', '#2c3a33', [seg('style', 'Stile', [['classico', 'Classico'], ['moderno', 'Moderno'], ['doppio', 'Doppio'], ['sfera', 'A sfera'], ['stradale', 'Stradale']], 'classico'), range('height', 'Altezza', 2.5, 12, 0.1, 4.2)], lampione,
    { tags: 'lampione luce lampada strada' }),
  F('es_semaforo', 'Semaforo', '#2c2f33', [seg('light', 'Luce accesa', [['rosso', 'Rosso'], ['giallo', 'Giallo'], ['verde', 'Verde'], ['spento', 'Spento']], 'rosso'), seg('kind', 'Tipo', [['palo', 'Palo'], ['sbraccio', 'A sbraccio']], 'palo'),
    range('reach', 'Sbraccio', 2, 7, 0.1, 4.5), flag('ped', 'Pedonale', true)], semaforo, { tags: 'semaforo incrocio rosso verde', noColor: true }),
  F('es_cartello', 'Cartello stradale', '#9aa0a6', [seg('kind', 'Cartello', SIGN_TYPES, 'stop'), seg('second', 'Secondo cartello', [['nessuno', 'Nessuno'], ...SIGN_TYPES.filter(([k]) => k !== 'direzione' && k !== 'senso_unico')], 'nessuno'), range('height', 'Altezza', 1.8, 3.5, 0.05, 2.6)], cartello,
    { tags: 'cartello segnale stop precedenza divieto', noColor: true }),
  F('es_fermata', 'Fermata autobus', '#4a5560', [range('width', 'Larghezza', 2, 6, 0.1, 3.6)], fermata, { tags: 'pensilina fermata bus attesa' }),
  F('es_panchina', 'Panchina', '#2c3a33', [seg('style', 'Stile', [['classica', 'Classica'], ['parco', 'Parco'], ['moderna', 'Moderna']], 'classica'), range('length', 'Lunghezza', 1, 4, 0.1, 1.8)], panchina, { tags: 'panchina panca seduta parco' }),
  F('es_cestino', 'Cestino', '#2c3a33', [seg('style', 'Tipo', [['palo', 'Su palo'], ['colonna', 'A colonna'], ['differenziata', 'Differenziata']], 'palo')], cestino, { tags: 'cestino rifiuti spazzatura' }),
  F('es_cassonetto', 'Cassonetto', '#2f6b3a', [], cassonetto, { tags: 'cassonetto rifiuti differenziata', palette: 'bins' }),
  F('es_idrante', 'Idrante', '#b3261e', [], idrante, { tags: 'idrante pompieri acqua', noColor: true }),
  F('es_palo', 'Palo', '#8a8f94', [seg('style', 'Tipo', [['legno', 'Della luce'], ['metallo', 'Metallico'], ['bandiera', 'Bandiera']], 'legno'), range('height', 'Altezza', 1, 12, 0.1, 8)], palo, { tags: 'palo luce telefono bandiera', noColor: true }),
  F('es_recinzione', 'Recinzione', '#2c3a33', [seg('style', 'Tipo', [['ringhiera', 'Ringhiera'], ['cancellata', 'Cancellata'], ['staccionata', 'Staccionata'], ['legno', 'Palizzata'], ['rete', 'Rete'], ['parapedonale', 'Parapedonale']], 'ringhiera'),
    range('length', 'Lunghezza', 1, 12, 0.1, 4), range('height', 'Altezza', 0.6, 2.5, 0.05, 1.1)], recinzione, { tags: 'recinzione ringhiera staccionata rete cancello', heavy: true }),
  F('es_muretto', 'Muretto', '#d8d2c6', [seg('material', 'Materiale', [['mattoni', 'Mattoni'], ['pietra', 'Pietra'], ['cemento', 'Cemento'], ['intonaco', 'Intonaco']], 'mattoni'),
    range('length', 'Lunghezza', 0.5, 12, 0.1, 3), range('height', 'Altezza', 0.2, 2.5, 0.05, 0.8), range('thickness', 'Spessore', 0.15, 0.6, 0.01, 0.3), flag('cap', 'Copertina', true)], muretto, { tags: 'muretto muro mattoni pietra', palette: 'plaster' }),
  F('es_transenna', 'Transenna', '#9ea3a6', [seg('style', 'Tipo', [['mobile', 'Mobile'], ['cantiere', 'Cantiere'], ['jersey', 'New Jersey']], 'mobile'), range('length', 'Lunghezza', 1, 4, 0.1, 2)], transenna, { tags: 'transenna barriera cantiere lavori', noColor: true }),
  F('es_cono', 'Cono stradale', '#ef5a1a', [range('size', 'Altezza', 0.3, 1.0, 0.05, 0.75)], cono, { tags: 'cono birillo lavori', noColor: true }),
  F('es_cabina', 'Cabina telefonica', '#8e969d', [seg('style', 'Stile', [['italiana', 'Italiana'], ['inglese', 'Inglese']], 'italiana')], cabina, { tags: 'cabina telefono londra' }),
  F('es_edicola', 'Edicola', '#2f5a3e', [], edicola, { tags: 'edicola giornalaio chiosco giornali' }),
  F('es_fontanella', 'Fontanella', '#3a3d40', [], fontanella, { tags: 'fontanella nasone acqua roma', noColor: true }),
  F('es_dissuasori', 'Dissuasori', '#2c2f33', [seg('style', 'Tipo', [['metallo', 'Metallo'], ['cemento', 'Cemento'], ['pietra', 'Pietra']], 'metallo'), int('count', 'Quanti', 1, 8, 3), flag('chain', 'Catena', false)], dissuasore,
    { tags: 'dissuasori paletti panettoni bollard', noColor: true }),
  F('es_vaso_albero', 'Albero in vaso', '#6f8f4a', [seg('plant', 'Pianta', [['albero', 'Alberello'], ['conifera', 'Cipresso'], ['sfera', 'Sfera']], 'albero'), seg('pot', 'Vaso', [['cemento', 'Cemento'], ['legno', 'Legno'], ['terracotta', 'Terracotta']], 'cemento'),
    range('potSize', 'Vaso', 0.5, 1.5, 0.05, 0.9), range('height', 'Altezza pianta', 1, 5, 0.1, 2.8), S(1)], alberoVaso, { tags: 'vaso fioriera albero pianta', palette: 'leaf' }),
  F('es_cassetta', 'Cassetta postale', '#b3261e', [], cassettaPostale, { tags: 'posta lettere buca', noColor: true }),
  F('es_parchimetro', 'Parchimetro', '#2f5aa8', [], parchimetro, { tags: 'parchimetro sosta parcheggio', noColor: true }),
  F('es_rastrelliera', 'Rastrelliera bici', '#9ea3a6', [int('count', 'Posti', 1, 8, 4)], rastrelliera, { tags: 'rastrelliera biciclette', noColor: true }),
];

export const STREET_ROLES = {
  'c:flag': () => ({ kind: 'prop', color: '#ffffff', map: null, roughness: 0.8, side: 'double' }),
  'c:terracotta': () => ({ kind: 'prop', color: '#b5653d', roughness: 0.85 }),
  'c:nasone': () => ({ kind: 'prop', color: '#3c4043', metalness: 0.45, roughness: 0.55 }),
  'c:paintB2': () => ({ kind: 'prop', color: '#2f5aa8', roughness: 0.45 }),
  'c:awning': () => ({ kind: 'prop', color: '#2f5a3e', roughness: 0.8, side: 'double' }),
};
