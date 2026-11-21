// Bathroom: toilet, bidet, washbasin (pedestal / vanity with mirror), bathtub
// (built-in / clawfoot), shower box, towel rail, washing machine.
import * as THREE from 'three';
import { add, box, boxOn, cylinder, lathe, rod, sphere, torus, tube, shell, range, seg, flag, handle, centerParts } from './util.js';

/** Rounded bowl as a lathe (outer + inner wall), squashed to an oval. */
function bowl(rx, rz, h, wall, t = {}) {
  const prof = [[0, h * 0.05], [rx * 0.45, 0], [rx * 0.8, h * 0.25], [rx, h * 0.8], [rx, h], [rx - wall, h], [rx - wall * 1.2, h * 0.8], [(rx - wall) * 0.75, h * 0.3], [0, h * 0.22]];
  const g = lathe(prof, { seg: 40 });
  g.scale(1, 1, rz / rx);
  if (t.x || t.y || t.z) g.translate(t.x || 0, t.y || 0, t.z || 0);
  return g;
}

function wc(p) {
  const parts = {};
  // pedestal + bowl, tank or wall-hung
  const hung = p.style === 'sospeso';
  if (!hung) add(parts, 'ceramic', lathe([[0, 0], [0.13, 0], [0.12, 0.05], [0.1, 0.2], [0.14, 0.3], [0, 0.3]], { z: 0.06, seg: 32 }).scale(1, 1, 1.35));
  add(parts, 'ceramic', bowl(0.19, 0.25, 0.14, 0.02, { y: hung ? 0.27 : 0.26, z: 0.08 }));
  add(parts, 'ceramic', boxOn(0.34, 0.07, 0.18, { y: hung ? 0.3 : 0.3, z: -0.18, r: 0.03 }));
  // seat + lid
  add(parts, 'plasticW', torus(0.16, 0.022, { rx: 90, y: 0.415, z: 0.09, rs: 10, ts: 40 }).scale(1, 1, 1.3).translate(0, 0, 0));
  add(parts, 'plasticW', box(0.36, 0.42, 0.025, { y: 0.63, z: -0.12, rx: -8, r: 0.012 }));
  if (p.style === 'cassetta') add(parts, 'ceramic', boxOn(0.4, 0.38, 0.18, { y: 0.38, z: -0.22, r: 0.02 }), boxOn(0.42, 0.03, 0.2, { y: 0.76, z: -0.22, r: 0.012 }));
  else add(parts, 'chrome', box(0.2, 0.13, 0.01, { y: 1.0, z: -0.3, r: 0.005 }));
  if (hung) add(parts, 'ceramic', boxOn(0.36, 0.34, 0.12, { y: 0.07, z: -0.26, r: 0.02 }));
  return parts;
}

function bidet() {
  const parts = {};
  add(parts, 'ceramic', lathe([[0, 0], [0.13, 0], [0.12, 0.05], [0.1, 0.2], [0.14, 0.26], [0, 0.26]], { z: 0.06, seg: 32 }).scale(1, 1, 1.3));
  add(parts, 'ceramic', bowl(0.18, 0.25, 0.16, 0.025, { y: 0.24, z: 0.06 }));
  add(parts, 'chrome', cylinder(0.02, 0.018, 0.06, { y: 0.4, z: -0.13, seg: 12 }), rod([0, 0.45, -0.13], [0, 0.45, -0.07], 0.01));
  return parts;
}

function lavabo(p) {
  const parts = {}, W = p.width;
  if (p.style === 'colonna') {
    add(parts, 'ceramic', lathe([[0, 0], [0.12, 0], [0.1, 0.06], [0.085, 0.6], [0.14, 0.72], [0, 0.72]], { seg: 32 }).scale(1, 1, 0.8));
    add(parts, 'ceramic', bowl(0.29, 0.22, 0.17, 0.025, { y: 0.7, z: 0.0 }));
  } else {
    add(parts, 'main', boxOn(W, 0.5, 0.46, { y: 0.32, z: 0, r: 0.006 }));
    const n = W > 0.9 ? 2 : 1;
    for (let i = 0; i < n; i++) { const x = (i - (n - 1) / 2) * (W / n); add(parts, 'mainShade', boxOn(W / n - 0.01, 0.22, 0.015, { x, y: 0.33 + 0.25, z: 0.235, r: 0.003 }), boxOn(W / n - 0.01, 0.22, 0.015, { x, y: 0.335, z: 0.235, r: 0.003 })); handle(parts, x, 0.77, 0.25, 0.12); handle(parts, x, 0.53, 0.25, 0.12); }
    add(parts, 'ceramic', boxOn(W + 0.02, 0.06, 0.48, { y: 0.82, r: 0.02 }));
    add(parts, 'steelDark', boxOn(Math.min(0.46, W - 0.14), 0.002, 0.3, { y: 0.881, z: 0.02, r: 0.03 }));
  }
  const ty = p.style === 'colonna' ? 0.87 : 0.88, tz = p.style === 'colonna' ? -0.16 : -0.17;
  add(parts, 'chrome', cylinder(0.022, 0.018, 0.12, { y: ty, z: tz, seg: 14 }), tube([[0, ty + 0.11, tz], [0, ty + 0.16, tz + 0.02], [0, ty + 0.15, tz + 0.1]], 0.011, { segs: 10, rs: 8 }), rod([0, ty + 0.13, tz], [0, ty + 0.18, tz - 0.06], 0.008));
  if (p.mirror) {
    const mw = p.style === 'colonna' ? 0.6 : Math.min(W, 1.2);
    add(parts, 'frame', boxOn(mw + 0.04, 0.84, 0.025, { y: 1.15, z: -0.26, r: 0.006 }));
    add(parts, 'mirror', boxOn(mw - 0.02, 0.78, 0.004, { y: 1.18, z: -0.245 }));
    add(parts, 'bulb', boxOn(mw * 0.7, 0.04, 0.05, { y: 2.02, z: -0.23, r: 0.01 }));
  }
  return parts;
}

function vasca(p) {
  const parts = {}, L = p.length, W = 0.75;
  if (p.style === 'piedini') {
    // clawfoot: outer lathe-like shell from a rounded rectangle extrusion approximated by a scaled lathe
    const g = lathe([[0, 0.12], [0.3, 0.1], [0.36, 0.2], [0.38, 0.62], [0.4, 0.66], [0.36, 0.66], [0.34, 0.6], [0.32, 0.22], [0, 0.18]], { seg: 48 });
    g.scale(L / 0.8, 1, W / 0.8);
    add(parts, 'ceramic', g);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(parts, 'gold', sphere(0.045, { x: sx * L * 0.34, y: 0.07, z: sz * W * 0.3, ws: 12, hs: 8 }), rod([sx * L * 0.34, 0.03, sz * W * 0.3], [sx * L * 0.31, 0.16, sz * W * 0.27], 0.022));
    add(parts, 'water', cylinder(L * 0.4, L * 0.4, 0.003, { y: 0.45, seg: 40, bevel: 0 }).scale(1, 1, (W * 0.95) / L));
  } else {
    add(parts, 'tilesWall', boxOn(L, 0.55, W, { r: 0.004 }));
    add(parts, 'ceramic', boxOn(L, 0.04, W, { y: 0.55, r: 0.015 }));
    add(parts, 'steelDark', boxOn(L - 0.16, 0.002, W - 0.16, { y: 0.592, r: 0.08 }));
    add(parts, 'chrome', tube([[L / 2 - 0.12, 0.6, -W / 2 + 0.05], [L / 2 - 0.12, 0.68, -W / 2 + 0.06], [L / 2 - 0.12, 0.68, -W / 2 + 0.2]], 0.012, { segs: 8, rs: 8 }));
  }
  return parts;
}

function doccia(p) {
  const parts = {}, S = p.size;
  add(parts, 'ceramic', boxOn(S, 0.06, S, { r: 0.012 }));
  add(parts, 'chrome', cylinder(0.035, 0.035, 0.002, { y: 0.061, seg: 16 }));
  const H = 2.0;
  for (const [x, z, w, ry] of [[0, S / 2, S, 0], [S / 2, 0, S, 90]]) add(parts, 'glass', boxOn(w - 0.02, H, 0.008, { x, y: 0.07, z, ry }));
  for (const [x, z] of [[S / 2, S / 2], [-S / 2, S / 2], [S / 2, -S / 2]]) add(parts, 'chrome', boxOn(0.02, H, 0.02, { x, y: 0.06, z }));
  add(parts, 'chrome', box(S, 0.02, 0.02, { y: H + 0.06, z: S / 2 }), box(0.02, 0.02, S, { x: S / 2, y: H + 0.06 }));
  add(parts, 'chrome', rod([-S / 2 + 0.05, 1.0, -S / 2 + 0.03], [-S / 2 + 0.05, 2.0, -S / 2 + 0.03], 0.012), rod([-S / 2 + 0.05, 2.0, -S / 2 + 0.03], [-S / 2 + 0.05, 2.0, -S / 2 + 0.25], 0.01), cylinder(0.1, 0.1, 0.015, { x: -S / 2 + 0.05, y: 1.98, z: -S / 2 + 0.28, seg: 24 }));
  return parts;
}

function portasciugamani(p) {
  const parts = {};
  for (const s of [-1, 1]) add(parts, 'chrome', rod([s * 0.25, 0, 0], [s * 0.25, 0.9, 0], 0.012), cylinder(0.08, 0.08, 0.012, { x: s * 0.25, seg: 18 }));
  for (const y of [0.55, 0.9]) add(parts, 'chrome', rod([-0.25, y, 0], [0.25, y, 0], 0.01));
  if (p.towels) {
    add(parts, 'soft', box(0.4, 0.5, 0.03, { y: 0.66, z: 0.03, r: 0.012 }), box(0.4, 0.5, 0.03, { y: 0.66, z: -0.03, r: 0.012 }));
    add(parts, 'linen', box(0.36, 0.3, 0.025, { y: 0.77, z: 0.06, r: 0.01 }));
  }
  return parts;
}

function lavatrice(p) {
  const parts = {};
  add(parts, 'appliance', boxOn(0.6, 0.85, 0.58, { r: 0.012 }));
  add(parts, 'plasticW', boxOn(0.58, 0.12, 0.01, { y: 0.71, z: 0.29, r: 0.004 }));
  add(parts, 'black', box(0.12, 0.05, 0.006, { x: 0.08, y: 0.77, z: 0.296 }));
  add(parts, 'chrome', cylinder(0.025, 0.025, 0.02, { x: -0.17, y: 0.77, z: 0.29, rx: 90, seg: 16 }));
  add(parts, 'chrome', torus(0.19, 0.025, { y: 0.4, z: 0.3, rs: 10, ts: 40 }));
  add(parts, 'glass', cylinder(0.17, 0.17, 0.01, { y: 0.4, z: 0.3, rx: 90, seg: 32 }));
  if (p.stack) add(parts, 'appliance', boxOn(0.6, 0.85, 0.58, { y: 0.86, r: 0.012 }), torus(0.19, 0.022, { y: 1.27, z: 0.3, rs: 10, ts: 40 }).translate(0, 0, 0));
  return parts;
}

export const BATH_TYPES = [
  { id: 'wc', label: 'WC', cat: 'bagno', sub: 'sanitari', color: '#f3f2ee', tags: 'water gabinetto toilette', params: [seg('style', 'Modello', [['cassetta', 'Con cassetta'], ['sospeso', 'Sospeso'], ['muro', 'A pavimento']], 'cassetta')], build: wc },
  { id: 'bidet', label: 'Bidet', cat: 'bagno', sub: 'sanitari', color: '#f3f2ee', tags: 'sanitari', params: [], build: bidet },
  { id: 'lavabo', label: 'Lavabo', cat: 'bagno', sub: 'sanitari', color: '#e8e4dc', tags: 'lavandino specchio mobile bagno', params: [seg('style', 'Modello', [['mobile', 'Con mobile'], ['colonna', 'A colonna']], 'mobile'), range('width', 'Larghezza mobile', 0.6, 1.6, 0.05, 0.9), flag('mirror', 'Specchio', true)], build: lavabo },
  { id: 'vasca', label: 'Vasca da bagno', cat: 'bagno', sub: 'sanitari', color: '#f3f2ee', tags: 'bagno vasca', params: [seg('style', 'Modello', [['incasso', 'Da incasso'], ['piedini', 'Con piedini']], 'incasso'), range('length', 'Lunghezza', 1.4, 1.9, 0.05, 1.7)], build: vasca },
  { id: 'doccia', label: 'Box doccia', cat: 'bagno', sub: 'sanitari', color: '#f3f2ee', tags: 'doccia vetro', params: [range('size', 'Lato', 0.7, 1.2, 0.05, 0.9)], build: doccia },
  { id: 'portasciugamani', label: 'Portasciugamani', cat: 'bagno', sub: 'accessori', color: '#6d8fb0', tags: 'asciugamani', params: [flag('towels', 'Asciugamani', true)], build: portasciugamani },
  { id: 'lavatrice', label: 'Lavatrice', cat: 'bagno', sub: 'mobili', color: '#e8e4dc', tags: 'bucato asciugatrice elettrodomestico', params: [flag('stack', 'Con asciugatrice sopra', false)], build: lavatrice },
];
