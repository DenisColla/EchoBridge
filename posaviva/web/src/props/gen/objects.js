// Decorations, plants, tableware and containers: rugs, paintings, curtains,
// mirrors, flower vases, globe, cushions; potted plants (several species, new
// variant on "Rigenera"); plates, glasses, bottles, place settings; cardboard
// boxes, box piles, waste bins.
import * as THREE from 'three';
import { add, box, boxOn, cylinder, lathe, rod, sphere, torus, tube, planeXZ, planeXY, range, int, seg, flag, seed, rng, colorize, centerParts } from './util.js';
import { rug, painting } from '../textures.js';

// ------------------------------------------------------------------------------------------ decor
function tappeto(p) {
  const W = p.width, D = p.shape === 'tondo' ? p.width : p.depth;
  const $specs = { rugTop: (c) => ({ kind: 'prop', color: '#ffffff', map: rug(p.pattern, p.seed, c), roughness: 0.95 }) };
  const parts = { $specs };
  if (p.shape === 'tondo') {
    const g = new THREE.CircleGeometry(W / 2, 64);
    g.rotateX(-Math.PI / 2); g.translate(0, 0.012, 0);
    add(parts, 'rugTop', g);
    add(parts, 'soft', cylinder(W / 2, W / 2, 0.011, { seg: 64, bevel: 0.004 }));
  } else {
    add(parts, 'rugTop', planeXZ(W, D, { y: 0.012 }));
    add(parts, 'soft', boxOn(W, 0.011, D, { r: 0.004 }));
    if (p.pattern === 'persiano') for (const s of [-1, 1]) for (let i = 0; i < Math.round(W / 0.025); i++) add(parts, 'linen', box(0.006, 0.003, 0.06, { x: -W / 2 + 0.0125 + i * 0.025, y: 0.003, z: s * (D / 2 + 0.03), r: 0 }));
  }
  return parts;
}

function quadro(p) {
  const W = p.width, H = W * (p.format === 'verticale' ? 1.3 : p.format === 'quadrato' ? 1 : 0.72);
  const $specs = { canvasFace: { kind: 'prop', color: '#ffffff', map: painting(p.subject, p.seed), roughness: 0.8 } };
  const parts = { $specs };
  const f = p.frame === 'sottile' ? 0.025 : p.frame === 'nessuna' ? 0 : 0.07;
  const ft = p.frame === 'nessuna' ? 0.03 : 0.04;
  if (f > 0) {
    const role = p.frame === 'dorata' ? 'gold' : 'frame';
    add(parts, role, boxOn(W + 2 * f, f, ft, { y: 0, r: 0.006 }), boxOn(W + 2 * f, f, ft, { y: H + f, r: 0.006 }),
      boxOn(f, H, ft, { x: -W / 2 - f / 2, y: f, r: 0.006 }), boxOn(f, H, ft, { x: W / 2 + f / 2, y: f, r: 0.006 }));
  }
  add(parts, 'linen', boxOn(W, H, ft * 0.6, { y: f, z: -ft * 0.2 }));
  add(parts, 'canvasFace', planeXY(W, H, { y: f, z: ft * 0.1 + 0.0005 }));
  if (p.easel) {
    // studio easel: the painting rests on it
    for (const s of [-1, 1]) add(parts, 'wood', rod([s * (W * 0.45 + 0.1), -0.9, 0.3], [s * 0.05, H + 0.35, -0.02], 0.016));
    add(parts, 'wood', rod([0, -0.9, -0.55], [0, H + 0.3, -0.06], 0.016), box(W + 0.1, 0.03, 0.08, { y: -0.015, z: 0.02 }));
    for (const k of Object.keys(parts)) if (k !== '$specs') for (const g of parts[k]) g.translate(0, 0.9, 0);
  }
  return parts;
}

function tende(p) {
  const W = p.width, H = p.height, open = p.open, parts = {};
  const panels = [-1, 1];
  add(parts, 'darkMetal', rod([-W / 2 - 0.1, H + 0.02, 0.06], [W / 2 + 0.1, H + 0.02, 0.06], 0.012), sphere(0.025, { x: -W / 2 - 0.12, y: H + 0.02, z: 0.06, ws: 10, hs: 8 }), sphere(0.025, { x: W / 2 + 0.12, y: H + 0.02, z: 0.06, ws: 10, hs: 8 }));
  for (const s of panels) {
    const pw = (W / 2) * (1 - open * 0.75) + 0.08;
    const folds = Math.max(4, Math.round(pw / 0.09));
    const geo = new THREE.PlaneGeometry(1, H, folds * 6, 8);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + 0.5, y = pos.getY(i) + H / 2;
      const x0 = s < 0 ? -W / 2 - 0.08 + u * pw : W / 2 + 0.08 - u * pw;
      const amp = 0.035 * (1 + open * 1.2) * (0.7 + 0.3 * (y / H));
      pos.setXYZ(i, x0, y - 0.0, 0.06 + Math.sin(u * folds * Math.PI * 2) * amp);
    }
    geo.computeVertexNormals();
    add(parts, 'curtain', geo);
  }
  return parts;
}

function specchio(p) {
  const parts = {};
  if (p.style === 'terra') {
    add(parts, 'frame', boxOn(0.62, 1.72, 0.04, { y: 0.02, z: 0, rx: -6, r: 0.01 }).translate(0, 0, -0.08));
    add(parts, 'mirror', boxOn(0.54, 1.64, 0.004, { y: 0.06, rx: -6 }).translate(0, 0, -0.058));
    add(parts, 'frame', rod([0, 1.1, -0.2], [0, 0.0, -0.45], 0.012));
    return centerParts(parts);
  }
  // oval wall mirror
  const g = new THREE.CircleGeometry(0.3, 48); g.scale(1, 1.4, 1); g.translate(0, 0.45, 0.012);
  add(parts, 'mirror', g);
  add(parts, p.style === 'dorato' ? 'gold' : 'frame', torus(0.31, 0.025, { rs: 8, ts: 48 }).scale(1, 1.4, 1).translate(0, 0.45, 0));
  return parts;
}

function vasoFiori(p) {
  const r = rng(p.seed), parts = {};
  const H = 0.25;
  add(parts, p.vase === 'vetro' ? 'glass' : 'ceramic', lathe([[0, 0], [0.06, 0], [0.08, 0.06], [0.07, 0.17], [0.045, 0.23], [0.05, H], [0.042, H], [0.036, 0.23], [0, 0.22]], { seg: 28 }));
  const cols = p.kind === 'rose' ? ['#b3122e', '#d7263d', '#f4a4b4', '#f7f1e3'] : p.kind === 'tulipani' ? ['#e63946', '#ffb703', '#fb8500', '#c77dff'] : ['#ffd23f', '#f7f7f7', '#7b6cff', '#ef476f', '#ffffff'];
  const n = r.int(7, 12);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, spread = r.range(0.02, 0.12), h = r.range(0.42, 0.62);
    const tip = [Math.cos(a) * spread, h, Math.sin(a) * spread];
    add(parts, 'stem', tube([[0, 0.12, 0], [tip[0] * 0.3, H + 0.05, tip[2] * 0.3], tip], 0.0035, { segs: 8, rs: 5 }));
    const c = r.pick(cols);
    if (p.kind === 'tulipani') add(parts, 'petals', colorize(lathe([[0, 0], [0.02, 0.005], [0.026, 0.03], [0.018, 0.055], [0, 0.05]], { x: tip[0], y: tip[1] - 0.01, z: tip[2], seg: 6 }), c));
    else if (p.kind === 'rose') add(parts, 'petals', colorize(sphere(0.026, { x: tip[0], y: tip[1] + 0.01, z: tip[2], ws: 8, hs: 6 }).scale(1, 0.8, 1), c));
    else for (let k = 0; k < 6; k++) { const b = (k / 6) * Math.PI * 2; add(parts, 'petals', colorize(sphere(0.014, { ws: 6, hs: 4 }).scale(1.8, 0.4, 0.9).rotateY(-b).translate(tip[0] + Math.cos(b) * 0.022, tip[1], tip[2] + Math.sin(b) * 0.022), c)); }
    if (p.kind !== 'rose' && p.kind !== 'tulipani') add(parts, 'petals', colorize(sphere(0.011, { x: tip[0], y: tip[1] + 0.004, z: tip[2], ws: 6, hs: 4 }), '#e0a800'));
    if (r() < 0.6) add(parts, 'leaf', leafGeo(0.07, 0.025, [tip[0] * 0.5, H + 0.08 + r() * 0.1, tip[2] * 0.5], a, 40));
  }
  return parts;
}

function mappamondo() {
  const parts = {};
  add(parts, 'woodDark', lathe([[0, 0], [0.11, 0], [0.1, 0.03], [0.03, 0.05], [0.02, 0.12], [0, 0.12]], { seg: 28 }));
  add(parts, 'gold', torus(0.17, 0.006, { y: 0.32, rz: 23, rs: 6, ts: 48, arc: Math.PI }).rotateZ(0));
  add(parts, 'globe', sphere(0.15, { y: 0.32, ws: 32, hs: 20 }));
  return parts;
}

function cuscino(p) {
  const parts = {}, S = p.size;
  const g = box(S, S, 0.16, { r: 0.07, seg: 4 });
  // puff it: bulge the middle, pinch the corners
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (S / 2), y = pos.getY(i) / (S / 2), z = pos.getZ(i);
    const k = (1 - x * x * 0.85) * (1 - y * y * 0.85);
    pos.setZ(i, z * (0.35 + 0.9 * k));
  }
  g.computeVertexNormals();
  g.rotateX(p.lying ? -Math.PI / 2 : -0.25);
  g.computeBoundingBox();
  g.translate(0, -g.boundingBox.min.y, 0);
  add(parts, 'soft', g);
  return parts;
}

// ------------------------------------------------------------------------------------------ plants
/** One leaf blade: a bent quad strip from the base point along an angle (yaw a, pitch tilt deg). */
function leafGeo(len, wid, base, yaw, tilt, droop = 0.35, segs = 6) {
  const pos = [], idx = [], uv = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, w = wid * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.02)) * (t < 0.12 ? t / 0.12 : 1);
    const el = ((90 - tilt) * Math.PI) / 180 - droop * t * t * 1.6;
    const along = len * t;
    const cx = Math.cos(el) * along, cy = Math.sin(el) * along;
    for (const s of [-1, 1]) { pos.push(cx, cy, s * w / 2 + Math.abs(s * w) * 0.15 * Math.sin(t * Math.PI)); uv.push((s + 1) / 2, t); }
  }
  for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.rotateY(-yaw);
  g.translate(base[0], base[1], base[2]);
  return g;
}

function pianta(p) {
  const r = rng(p.seed), parts = {}, H = p.height;
  // pot
  const potH = Math.max(0.14, H * 0.22), potR = Math.max(0.09, H * 0.13);
  if (p.pot === 'cesto') add(parts, 'wicker', lathe([[0, 0], [potR * 0.85, 0], [potR, potH * 0.9], [potR * 1.03, potH], [potR * 0.95, potH], [0, potH * 0.85]], { seg: 28 }));
  else add(parts, p.pot === 'bianco' ? 'ceramic' : 'pot', lathe([[0, 0], [potR * 0.78, 0], [potR * 0.8, 0.01], [potR, potH * 0.88], [potR * 1.06, potH * 0.9], [potR * 1.06, potH], [potR * 0.96, potH], [0, potH * 0.9]], { seg: 28 }));
  add(parts, 'soil', cylinder(potR * 0.94, potR * 0.94, 0.01, { y: potH * 0.86, seg: 24 }));
  const top = potH * 0.88;
  const sp = p.species;
  const leafRole = sp === 'cactus' || sp === 'sansevieria' ? 'leaf2' : 'leaf';
  if (sp === 'monstera') {
    const n = r.int(7, 11);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, tilt = r.range(15, 55), len = H * r.range(0.45, 0.75);
      const el = ((90 - tilt) * Math.PI) / 180;
      const end = [Math.cos(a) * Math.cos(el) * len, top + Math.sin(el) * len, Math.sin(a) * Math.cos(el) * len];
      add(parts, 'stem', tube([[0, top, 0], [end[0] * 0.5, top + (end[1] - top) * 0.6, end[2] * 0.5], end], 0.006, { segs: 8, rs: 5 }));
      add(parts, leafRole, leafGeo(H * 0.32, H * 0.26, end, a, tilt + 40, 0.5, 8));
    }
  } else if (sp === 'sansevieria') {
    const n = r.int(9, 15);
    for (let i = 0; i < n; i++) add(parts, leafRole, leafGeo(H * r.range(0.6, 0.95), H * 0.07, [r.range(-potR, potR) * 0.6, top, r.range(-potR, potR) * 0.6], r() * Math.PI * 2, r.range(0, 14), 0.02, 6));
  } else if (sp === 'cactus') {
    const cr = potR * 0.55, ch = H - potH;
    add(parts, leafRole, lathe([[0, 0], [cr, 0.02], [cr * 1.02, ch * 0.7], [cr * 0.8, ch * 0.93], [0, ch]], { y: top - 0.01, seg: 14 }));
    for (let k = 0; k < r.int(1, 3); k++) {
      const a = r() * Math.PI * 2, y0 = top + ch * r.range(0.3, 0.6), out = cr * 1.6;
      add(parts, leafRole, tube([[Math.cos(a) * cr * 0.8, y0, Math.sin(a) * cr * 0.8], [Math.cos(a) * out, y0 + 0.02, Math.sin(a) * out], [Math.cos(a) * out, y0 + ch * 0.35, Math.sin(a) * out]], cr * 0.45, { segs: 12, rs: 12 }), sphere(cr * 0.45, { x: Math.cos(a) * out, y: y0 + ch * 0.35, z: Math.sin(a) * out, ws: 12, hs: 8 }));
    }
  } else if (sp === 'palma') {
    const n = r.int(3, 5);
    for (let s = 0; s < n; s++) {
      const a = r() * Math.PI * 2, lean = r.range(0.02, 0.18), h = H * r.range(0.55, 0.9);
      const tip = [Math.cos(a) * lean * h, top + h, Math.sin(a) * lean * h];
      add(parts, 'stem', tube([[0, top, 0], [tip[0] * 0.5, top + h * 0.5, tip[2] * 0.5], tip], 0.007, { segs: 8, rs: 5 }));
      for (let f = 0; f < 9; f++) {
        const fa = a + (f - 4) * 0.35 + r.range(-0.1, 0.1);
        add(parts, leafRole, leafGeo(H * 0.26, 0.035, tip, fa, r.range(40, 75), 0.7, 6));
      }
    }
  } else if (sp === 'felce') {
    const n = r.int(14, 22);
    for (let i = 0; i < n; i++) add(parts, leafRole, leafGeo(H * r.range(0.45, 0.65), H * 0.09, [0, top, 0], r() * Math.PI * 2, r.range(35, 75), 0.9, 8));
  } else {
    // ficus: trunk + many small leaves in a crown
    const th = H * 0.55;
    add(parts, 'wood', tube([[0, top, 0], [0.02, top + th * 0.5, -0.01], [0, top + th, 0.01]], 0.012, { segs: 8, rs: 6 }));
    const cy = top + th + H * 0.12, cr = H * 0.22;
    for (let i = 0; i < 120; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, rr = cr * Math.cbrt(r());
      const pt = [Math.sqrt(1 - u * u) * Math.cos(a) * rr, cy + u * rr * 0.8, Math.sqrt(1 - u * u) * Math.sin(a) * rr];
      add(parts, leafRole, leafGeo(0.06, 0.03, pt, r() * Math.PI * 2, r.range(20, 80), 0.3, 3));
    }
  }
  return parts;
}

// ------------------------------------------------------------------------------------------ tableware
function piatto(p) {
  const parts = {};
  const R = p.kind === 'fondo' ? 0.11 : 0.13, d = p.kind === 'fondo' ? 0.045 : 0.022;
  add(parts, 'ceramic', lathe([[0, 0], [R * 0.55, 0], [R * 0.6, 0.008], [R, d], [R - 0.004, d + 0.002], [R * 0.58, 0.012], [0, 0.01]], { seg: 40 }));
  if (p.food) {
    const r = rng(p.seed || 1);
    if (p.food === 'pasta') for (let i = 0; i < 30; i++) add(parts, 'food', tube([[r.range(-0.05, 0.05), 0.015, r.range(-0.05, 0.05)], [r.range(-0.05, 0.05), 0.03 + r() * 0.015, r.range(-0.05, 0.05)], [r.range(-0.05, 0.05), 0.02, r.range(-0.05, 0.05)]], 0.003, { segs: 8, rs: 4 }));
    else if (p.food === 'bistecca') { add(parts, 'meat', box(0.14, 0.022, 0.09, { y: 0.022, r: 0.01, ry: 20 })); add(parts, 'leaf', sphere(0.025, { x: 0.06, y: 0.025, z: 0.05, ws: 8, hs: 6 })); }
    else if (p.food === 'pizza') add(parts, 'pizza', cylinder(0.12, 0.12, 0.012, { y: 0.012, seg: 32, bevel: 0.005 }));
  }
  return parts;
}

function bicchiere(p) {
  const parts = {};
  const prof = {
    acqua: [[0, 0], [0.032, 0], [0.036, 0.1], [0.034, 0.1], [0.03, 0.006], [0, 0.006]],
    vino: [[0, 0], [0.035, 0], [0.034, 0.003], [0.004, 0.006], [0.004, 0.09], [0.03, 0.11], [0.04, 0.15], [0.033, 0.2], [0.031, 0.2], [0.038, 0.15], [0.028, 0.112], [0, 0.1]],
    boccale: [[0, 0], [0.042, 0], [0.045, 0.15], [0.041, 0.15], [0.037, 0.012], [0, 0.012]],
    flute: [[0, 0], [0.03, 0], [0.004, 0.006], [0.004, 0.1], [0.02, 0.13], [0.025, 0.22], [0.023, 0.22], [0.018, 0.13], [0, 0.11]],
  }[p.kind] || [];
  add(parts, 'glass', lathe(prof, { seg: 28 }));
  if (p.full) {
    const lvl = { acqua: [0.03, 0.07], vino: [0.03, 0.135], boccale: [0.038, 0.12], flute: [0.02, 0.18] }[p.kind];
    const y0 = { acqua: 0.007, vino: 0.11, boccale: 0.013, flute: 0.115 }[p.kind];
    const liq = p.kind === 'vino' ? 'wine' : p.kind === 'boccale' ? 'beer' : p.kind === 'flute' ? 'beer' : 'water';
    add(parts, liq, lathe([[0, y0], [lvl[0] * 0.85, y0], [lvl[0], lvl[1]], [0, lvl[1]]], { seg: 24 }));
  }
  // grip space (hand prop): the hand closes around the bowl / body
  return shiftY(parts, -({ acqua: 0.05, vino: 0.15, flute: 0.17, boccale: 0.07 }[p.kind] || 0.05));
}

function shiftY(parts, dy) {
  for (const [k, list] of Object.entries(parts)) if (k !== '$specs') for (const g of list) g.translate(0, dy, 0);
  return parts;
}

function bottiglia(p) {
  const parts = {};
  const shapes = {
    vino: [[0, 0], [0.037, 0], [0.038, 0.2], [0.03, 0.24], [0.015, 0.27], [0.014, 0.31], [0, 0.31]],
    birra: [[0, 0], [0.031, 0], [0.032, 0.13], [0.024, 0.17], [0.013, 0.2], [0.013, 0.23], [0, 0.23]],
    acqua: [[0, 0], [0.04, 0], [0.042, 0.02], [0.04, 0.1], [0.042, 0.2], [0.025, 0.26], [0.016, 0.28], [0.016, 0.3], [0, 0.3]],
    liquore: [[0, 0], [0.045, 0], [0.046, 0.14], [0.03, 0.17], [0.015, 0.19], [0.015, 0.25], [0, 0.25]],
  };
  const role = p.kind === 'vino' ? 'bottleGreen' : p.kind === 'birra' ? 'bottleBrown' : p.kind === 'acqua' ? 'glass' : 'bottleClear';
  add(parts, role, lathe(shapes[p.kind], { seg: 28 }));
  const top = shapes[p.kind].at(-1)[1];
  add(parts, p.kind === 'vino' ? 'cork' : 'cap', cylinder(0.016, 0.016, 0.02, { y: top - 0.012, seg: 14 }));
  const lh = { vino: [0.06, 0.08], birra: [0.04, 0.07], acqua: [0.06, 0.09], liquore: [0.04, 0.08] }[p.kind];
  const lr = shapes[p.kind][1][0] + 0.001;
  add(parts, 'label', cylinder(lr, lr, lh[1], { y: lh[0], seg: 28, bevel: 0 }));
  return shiftY(parts, -({ vino: 0.1, birra: 0.07, acqua: 0.1, liquore: 0.07 }[p.kind] || 0.08));
}

function coperto(p) {
  const parts = {};
  add(parts, 'ceramic', lathe([[0, 0], [0.07, 0], [0.075, 0.006], [0.135, 0.02], [0.131, 0.022], [0.075, 0.011], [0, 0.009]], { seg: 40 }));
  if (p.deep) add(parts, 'ceramic', lathe([[0, 0.012], [0.05, 0.012], [0.11, 0.045], [0.106, 0.047], [0.05, 0.02], [0, 0.02]], { seg: 36 }));
  // cutlery
  add(parts, 'chrome', box(0.016, 0.003, 0.19, { x: -0.16, y: 0.0015, r: 0.0012 }), box(0.022, 0.003, 0.045, { x: -0.16, y: 0.0015, z: -0.115, r: 0.0012 }));
  for (let k = -1; k <= 2; k++) add(parts, 'chrome', box(0.003, 0.003, 0.04, { x: -0.16 + (k - 0.5) * 0.006, y: 0.0015, z: -0.155 }));
  add(parts, 'chrome', box(0.018, 0.003, 0.22, { x: 0.16, y: 0.0015, r: 0.0012 }));
  add(parts, 'chrome', box(0.012, 0.003, 0.19, { x: 0.19, y: 0.0015, r: 0.0012 }), sphere(0.02, { x: 0.19, y: 0.004, z: -0.1, ws: 10, hs: 6 }).scale(1, 0.2, 1.4));
  add(parts, 'linen', box(0.16, 0.006, 0.16, { x: -0.19, y: 0.003, z: 0.05, ry: 10, r: 0.002 }));
  if (p.glass) add(parts, 'glass', lathe([[0, 0], [0.032, 0], [0.004, 0.006], [0.004, 0.08], [0.03, 0.1], [0.036, 0.14], [0.03, 0.18], [0.028, 0.18], [0.034, 0.14], [0, 0.09]], { x: 0.14, z: -0.18, seg: 20 }));
  return parts;
}

// ------------------------------------------------------------------------------------------ containers
function scatola(p) {
  const { width: W, depth: D, height: H } = p, parts = {};
  add(parts, 'cardboard', boxOn(W, H, D, { r: 0.004 }));
  if (p.open) {
    for (const s of [-1, 1]) {
      add(parts, 'cardboard', box(W - 0.004, 0.004, D / 2, { x: 0, y: H + Math.sin(0.5) * D / 4, z: s * (D / 2 + Math.cos(0.5) * D / 4), rx: s * 30 }));
      add(parts, 'cardboard', box(W / 2, 0.004, D - 0.004, { x: s * (W / 2 + Math.cos(0.4) * W / 4), y: H + Math.sin(0.4) * W / 4, rz: s * -23 }));
    }
    add(parts, 'dark', box(W - 0.012, 0.002, D - 0.012, { y: H - 0.01 }));
  } else add(parts, 'tape', box(0.05, 0.002, D + 0.002, { y: H + 0.001 }), box(0.05, H * 0.25, 0.002, { y: H - H * 0.125, z: D / 2 + 0.001 }), box(0.05, H * 0.25, 0.002, { y: H - H * 0.125, z: -D / 2 - 0.001 }));
  return parts;
}

function pilaScatole(p) {
  const r = rng(p.seed), parts = {};
  const n = p.count;
  const placed = [];
  for (let i = 0; i < n; i++) {
    const w = r.range(0.3, 0.6), d = r.range(0.25, 0.45), h = r.range(0.2, 0.45);
    let x = r.range(-0.5, 0.5), z = r.range(-0.3, 0.3), y = 0;
    // stack on a previous box when overlapping
    for (const b of placed) if (Math.abs(b.x - x) < (b.w + w) / 2 && Math.abs(b.z - z) < (b.d + d) / 2) y = Math.max(y, b.y + b.h);
    if (y > 1.4) { y = 0; x += 0.7; }
    const ry = r.range(-12, 12);
    add(parts, 'cardboard', boxOn(w, h, d, { x, y, z, ry, r: 0.004 }));
    add(parts, 'tape', boxOn(0.05, 0.002, d + 0.002, { x, y: y + h, z, ry }));
    placed.push({ x, z, w, d, h, y });
  }
  return centerParts(parts);
}

function cestino(p) {
  const parts = {};
  if (p.style === 'pedale') {
    add(parts, 'steel', lathe([[0, 0], [0.13, 0], [0.135, 0.02], [0.14, 0.42], [0, 0.42]], { seg: 32 }), lathe([[0, 0.42], [0.145, 0.42], [0.145, 0.44], [0.12, 0.47], [0, 0.48]], { seg: 32 }));
    add(parts, 'black', box(0.1, 0.02, 0.08, { y: 0.02, z: 0.16, r: 0.005 }));
  } else if (p.style === 'rete') {
    add(parts, 'black', lathe([[0, 0], [0.13, 0], [0.16, 0.32], [0.155, 0.32], [0.125, 0.01], [0, 0.01]], { seg: 32 }));
    add(parts, 'paper', sphere(0.06, { y: 0.07, x: 0.02, ws: 8, hs: 6 }), sphere(0.05, { y: 0.12, x: -0.04, z: 0.03, ws: 8, hs: 6 }));
  } else {
    add(parts, 'main', lathe([[0, 0], [0.22, 0], [0.24, 0.85], [0.235, 0.85], [0.215, 0.01], [0, 0.01]], { seg: 32 }), lathe([[0, 0.84], [0.25, 0.84], [0.25, 0.88], [0, 0.9]], { seg: 32 }));
  }
  return parts;
}

export const OBJECT_TYPES = [
  { id: 'tappeto', label: 'Tappeto', cat: 'decorazioni', sub: 'tessili', color: '#7a1f24', tags: 'tappeto persiano moquette', params: [
    seg('shape', 'Forma', [['rettangolo', 'Rettangolare'], ['tondo', 'Tondo']], 'rettangolo'), seg('pattern', 'Motivo', [['persiano', 'Persiano'], ['moderno', 'Moderno'], ['righe', 'Righe'], ['geometrico', 'Geometrico']], 'persiano'),
    range('width', 'Larghezza', 0.6, 4.0, 0.05, 2.0), range('depth', 'Profondità', 0.4, 3.0, 0.05, 1.4), seed(9),
  ], build: tappeto },
  { id: 'quadro', label: 'Quadro', cat: 'decorazioni', sub: 'quadri', color: '#8a5a3b', mount: 'wall', tags: 'dipinto tela pittura arte cornice cavalletto', params: [
    seg('subject', 'Soggetto', [['paesaggio', 'Paesaggio'], ['astratto', 'Astratto'], ['geometrico', 'Geometrico'], ['mare', 'Mare'], ['notte', 'Notte']], 'paesaggio'),
    seg('format', 'Formato', [['orizzontale', 'Orizzontale'], ['verticale', 'Verticale'], ['quadrato', 'Quadrato']], 'orizzontale'), seg('frame', 'Cornice', [['legno', 'Legno'], ['dorata', 'Dorata'], ['sottile', 'Sottile'], ['nessuna', 'Nessuna']], 'legno'),
    range('width', 'Larghezza', 0.2, 2.0, 0.05, 0.8), flag('easel', 'Su cavalletto', false), seed(12),
  ], build: quadro },
  { id: 'tende', label: 'Tende', cat: 'decorazioni', sub: 'tessili', color: '#d9cbb3', mount: 'curtain', tags: 'tenda finestra drappeggio', params: [range('width', 'Larghezza', 0.8, 4, 0.05, 1.8), range('height', 'Altezza', 1.2, 3, 0.05, 2.4), range('open', 'Apertura', 0, 1, 0.05, 0.5, '')], build: tende },
  { id: 'specchio', label: 'Specchio', cat: 'decorazioni', sub: 'quadri', color: '#3b3b40', tags: 'specchio', params: [seg('style', 'Modello', [['terra', 'Da terra'], ['ovale', 'Ovale da muro'], ['dorato', 'Dorato da muro']], 'terra')], build: specchio },
  { id: 'vaso_fiori', label: 'Vaso di fiori', cat: 'decorazioni', sub: 'vasi', color: '#e8e4dc', tags: 'fiori mazzo bouquet rose tulipani margherite', params: [seg('kind', 'Fiori', [['margherite', 'Margherite'], ['rose', 'Rose'], ['tulipani', 'Tulipani']], 'rose'), seg('vase', 'Vaso', [['ceramica', 'Ceramica'], ['vetro', 'Vetro']], 'ceramica'), seed(4)], build: vasoFiori },
  { id: 'mappamondo', label: 'Mappamondo', cat: 'decorazioni', sub: 'varie', color: '#2f4a6b', tags: 'globo studio geografia', params: [], build: mappamondo },
  { id: 'cuscino', label: 'Cuscino', cat: 'decorazioni', sub: 'tessili', color: '#c9a227', tags: 'cuscino divano letto', params: [range('size', 'Lato', 0.3, 0.7, 0.01, 0.45), flag('lying', 'Disteso', true)], build: cuscino },
  { id: 'pianta', label: 'Pianta in vaso', cat: 'piante', sub: 'piante', color: '#4f6b3a', tags: 'pianta vaso verde ficus monstera cactus palma felce sansevieria', params: [
    seg('species', 'Specie', [['ficus', 'Ficus'], ['monstera', 'Monstera'], ['sansevieria', 'Sansevieria'], ['palma', 'Palma'], ['felce', 'Felce'], ['cactus', 'Cactus']], 'monstera'),
    range('height', 'Altezza', 0.3, 2.2, 0.05, 1.0), seg('pot', 'Vaso', [['terracotta', 'Terracotta'], ['bianco', 'Bianco'], ['cesto', 'Cesto']], 'terracotta'), seed(7),
  ], build: pianta },
  { id: 'piatto', label: 'Piatto', cat: 'cibo', sub: 'stoviglie', color: '#f3f2ee', tags: 'piatto cibo pasta pizza bistecca', params: [seg('kind', 'Tipo', [['piano', 'Piano'], ['fondo', 'Fondo']], 'piano'), seg('food', 'Cibo', [['', 'Vuoto'], ['pasta', 'Pasta'], ['bistecca', 'Bistecca'], ['pizza', 'Pizza']], ''), seed(1)], build: piatto },
  { id: 'bicchiere', label: 'Bicchiere', cat: 'cibo', sub: 'stoviglie', color: '#cfe3ea', tags: 'calice vino birra boccale flute acqua', params: [seg('kind', 'Tipo', [['acqua', 'Acqua'], ['vino', 'Calice'], ['flute', 'Flute'], ['boccale', 'Boccale']], 'vino'), flag('full', 'Pieno', true)], build: bicchiere,
    hand: { radius: 0.032, presets: ['cup', 'grip'], rest: () => [0, 0, 0], slide: () => [-0.05, 0.05] } },
  { id: 'bottiglia', label: 'Bottiglia', cat: 'cibo', sub: 'bevande', color: '#2f4a3a', tags: 'vino birra acqua liquore', params: [seg('kind', 'Tipo', [['vino', 'Vino'], ['birra', 'Birra'], ['acqua', 'Acqua'], ['liquore', 'Liquore']], 'vino')], build: bottiglia,
    hand: { radius: 0.034, presets: ['grip', 'cup'], rest: () => [0, 0, 0], slide: () => [-0.1, 0.12] } },
  { id: 'coperto', label: 'Coperto apparecchiato', cat: 'cibo', sub: 'stoviglie', color: '#f3f2ee', tags: 'piatto posate forchetta coltello tavola apparecchiata', params: [flag('deep', 'Piatto fondo', true), flag('glass', 'Calice', true)], build: coperto },
  { id: 'scatola', label: 'Scatola di cartone', cat: 'contenitori', sub: 'scatole', color: '#b58a5a', tags: 'scatola pacco trasloco cartone', resizable: true, params: [
    flag('open', 'Aperta', false), range('width', 'Larghezza', 0.1, 1.2, 0.01, 0.5), range('depth', 'Profondità', 0.1, 1.2, 0.01, 0.35), range('height', 'Altezza', 0.1, 1.0, 0.01, 0.35),
  ], build: scatola },
  { id: 'pila_scatole', label: 'Pila di scatole', cat: 'contenitori', sub: 'scatole', color: '#b58a5a', tags: 'scatole trasloco magazzino', params: [int('count', 'Scatole', 2, 12, 6), seed(10)], build: pilaScatole },
  { id: 'cestino', label: 'Cestino dei rifiuti', cat: 'contenitori', sub: 'cesti-secchi', color: '#4f6b3a', tags: 'pattumiera spazzatura bidone', params: [seg('style', 'Modello', [['pedale', 'A pedale'], ['rete', 'Ufficio'], ['bidone', 'Bidone']], 'pedale')], build: cestino },
];
export { leafGeo };
