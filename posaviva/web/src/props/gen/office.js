// Office, electronics and lights: open-space workstation (cubicle), filing
// cabinet, whiteboard, printer, water cooler; flat TV, monitor, PC tower,
// laptop, speaker; floor lamp, table lamp, pendant, ceiling lamp, studio light.
import { add, box, boxOn, cylinder, lathe, rod, sphere, torus, tube, planeXY, range, int, seg, flag, seed, rng, handle, merge, centerParts } from './util.js';
import { board, screen } from '../textures.js';

// ------------------------------------------------------------------------------------------ office
function partition(parts, x, z, len, h, ry) {
  // fabric panel in a metal frame (built along X, then turned)
  const p = {};
  add(p, 'fabric', boxOn(len - 0.04, h - 0.05, 0.05, { y: 0.03, r: 0.01 }));
  add(p, 'metal', boxOn(0.03, h, 0.06, { x: -len / 2 + 0.015 }), boxOn(0.03, h, 0.06, { x: len / 2 - 0.015 }), box(len, 0.03, 0.06, { y: h - 0.015 }));
  merge(parts, p, { x, z, ry });
}

function postazione(p) {
  const r = rng(p.seed), parts = {}, W = p.width, D = p.depth, H = p.wallH;
  partition(parts, 0, -D / 2, W, H, 0);
  partition(parts, -W / 2, 0, D, H, 90);
  if (p.shape === 'U') partition(parts, W / 2, 0, D, H, 90);
  // L desk along the back and the left panel
  const T = 0.03, y = 0.73;
  add(parts, 'main', boxOn(W - 0.12, T, 0.75, { y: y - T, z: -D / 2 + 0.06 + 0.375, r: 0.006 }));
  add(parts, 'main', boxOn(0.7, T, D - 0.9, { x: -W / 2 + 0.06 + 0.35, y: y - T, z: -D / 2 + 0.81 + (D - 0.9) / 2, r: 0.006 }));
  add(parts, 'darkMetal', boxOn(0.04, y - T, 0.6, { x: W / 2 - 0.12, z: -D / 2 + 0.43 }), boxOn(0.04, y - T, 0.04, { x: -W / 2 + 0.7, z: D / 2 - 0.2 }));
  // drawer pedestal on wheels
  add(parts, 'metal', boxOn(0.4, 0.56, 0.55, { x: W / 2 - 0.4, y: 0.04, z: -D / 2 + 0.4, r: 0.006 }));
  for (let i = 0; i < 3; i++) handle(parts, W / 2 - 0.4, 0.2 + i * 0.17, -D / 2 + 0.675, 0.1);
  // monitors + keyboard + clutter via a desk-like scatter
  const mx = -W * 0.08, mz = -D / 2 + 0.25;
  const n = p.monitors;
  for (let i = 0; i < n; i++) {
    const x = mx + (i - (n - 1) / 2) * 0.58, ry = n > 1 ? (i - (n - 1) / 2) * -14 : 0;
    const m = {};
    add(m, 'black', boxOn(0.2, 0.012, 0.16, { r: 0.004 }), boxOn(0.04, 0.2, 0.025, { z: -0.02 }), box(0.56, 0.33, 0.025, { y: 0.12 + 0.165, r: 0.006 }));
    add(m, 'screenOn', box(0.54, 0.31, 0.002, { y: 0.12 + 0.165, z: 0.0135 }));
    merge(parts, m, { x, y, z: mz, ry });
  }
  add(parts, 'black', boxOn(0.44, 0.02, 0.14, { x: mx, y, z: mz + 0.35, r: 0.005 }), boxOn(0.06, 0.03, 0.1, { x: mx + 0.32, y, z: mz + 0.35, r: 0.015 }));
  for (let k = 0; k < Math.round(p.clutter * 5); k++) {
    const x = r.range(-W / 2 + 0.2, W / 2 - 0.2), z = r.range(-D / 2 + 0.2, -D / 2 + 0.6);
    if (Math.abs(x - mx) < 0.4 * n) continue;
    const kind = r.int(0, 2);
    if (kind === 0) add(parts, 'mug', lathe([[0, 0], [0.038, 0], [0.04, 0.095], [0.036, 0.095], [0.036, 0.01], [0, 0.01]], { x, y, z, seg: 16 }));
    else if (kind === 1) for (let i = 0; i < 3; i++) add(parts, 'paper', boxOn(0.21, 0.002, 0.297, { x: x + r.range(-0.03, 0.03), y: y + i * 0.002, z, ry: r.range(-25, 25) }));
    else { add(parts, 'pot', cylinder(0.05, 0.06, 0.09, { x, y, z, seg: 14 })); add(parts, 'leaf', sphere(0.08, { x, y: y + 0.14, z, ws: 10, hs: 8 })); }
  }
  if (p.chair) {
    // simple office chair
    const cx = mx, cz = mz + 0.85;
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; add(parts, 'black', rod([cx, 0.07, cz], [cx + Math.cos(a) * 0.3, 0.05, cz + Math.sin(a) * 0.3], 0.02, { seg: 6 }), sphere(0.025, { x: cx + Math.cos(a) * 0.3, y: 0.025, z: cz + Math.sin(a) * 0.3, ws: 8, hs: 6 })); }
    add(parts, 'chrome', cylinder(0.025, 0.025, 0.33, { x: cx, y: 0.07, z: cz, seg: 12 }));
    add(parts, 'fabric', boxOn(0.48, 0.08, 0.46, { x: cx, y: 0.4, z: cz, r: 0.035 }), box(0.44, 0.5, 0.07, { x: cx, y: 0.82, z: cz + 0.27, rx: 8, r: 0.03 }));
    add(parts, 'black', rod([cx, 0.42, cz + 0.2], [cx, 0.62, cz + 0.27], 0.02));
  }
  return centerParts(parts);
}

function schedario(p) {
  const parts = {}, n = p.drawers, H = n * 0.33 + 0.04;
  add(parts, 'main', boxOn(0.46, H, 0.62, { r: 0.006 }));
  for (let i = 0; i < n; i++) {
    const y = 0.03 + i * 0.33;
    add(parts, 'main', boxOn(0.43, 0.31, 0.015, { y, z: 0.31, r: 0.004 }));
    add(parts, 'chrome', box(0.12, 0.02, 0.02, { y: y + 0.22, z: 0.33, r: 0.006 }), box(0.07, 0.035, 0.004, { y: y + 0.26, z: 0.318 }));
  }
  return parts;
}

function lavagna(p) {
  const parts = {}, W = p.width, kind = p.kind;
  const $specs = { boardFace: { kind: 'prop', color: '#ffffff', map: board(kind), roughness: kind === 'nera' ? 0.9 : 0.25 } };
  const H = W * 0.5;
  if (p.stand) {
    for (const s of [-1, 1]) {
      add(parts, 'metal', rod([s * (W / 2 + 0.03), 0.05, 0], [s * (W / 2 + 0.03), 0.8 + H + 0.05, 0], 0.016));
      add(parts, 'metal', rod([s * (W / 2 + 0.03), 0.06, -0.3], [s * (W / 2 + 0.03), 0.06, 0.3], 0.014));
      for (const z of [-0.3, 0.3]) add(parts, 'black', sphere(0.025, { x: s * (W / 2 + 0.03), y: 0.025, z, ws: 8, hs: 6 }));
    }
  }
  const y0 = p.stand ? 0.85 : 0;
  add(parts, 'frame', boxOn(W + 0.04, H + 0.04, 0.03, { y: y0 - 0.02, r: 0.008 }));
  add(parts, 'boardFace', planeXY(W, H, { y: y0, z: 0.0155 }));
  add(parts, 'frame', box(W * 0.6, 0.02, 0.06, { y: y0 - 0.01, z: 0.04 }));
  return { ...parts, $specs };
}

function stampante() {
  const parts = {};
  add(parts, 'plasticW', boxOn(0.45, 0.24, 0.4, { r: 0.02 }));
  add(parts, 'black', boxOn(0.4, 0.008, 0.25, { y: 0.24, z: -0.02, r: 0.004 }), box(0.06, 0.04, 0.005, { x: 0.15, y: 0.2, z: 0.2 }));
  add(parts, 'black', box(0.32, 0.012, 0.12, { y: 0.1, z: 0.24, r: 0.003 }));
  add(parts, 'paper', box(0.21, 0.004, 0.1, { y: 0.11, z: 0.25 }));
  return parts;
}

function erogatore() {
  const parts = {};
  add(parts, 'plasticW', boxOn(0.32, 0.95, 0.32, { r: 0.02 }));
  add(parts, 'black', box(0.18, 0.2, 0.02, { y: 0.78, z: 0.16, r: 0.01 }));
  for (const [x, c] of [[-0.05, 'chrome'], [0.05, 'chrome']]) add(parts, c, box(0.03, 0.04, 0.04, { x, y: 0.84, z: 0.18 }));
  add(parts, 'water', lathe([[0, 0], [0.13, 0], [0.135, 0.05], [0.135, 0.33], [0.11, 0.38], [0.04, 0.42], [0.03, 0.45], [0, 0.45]], { y: 0.95, seg: 28 }));
  return parts;
}

// ------------------------------------------------------------------------------------------ electronics
function tv(p) {
  const parts = {}, inch = p.size, diag = inch * 0.0254, W = diag * 0.8716, H = diag * 0.4903;
  const $specs = { tvScreen: { kind: 'prop', color: '#ffffff', map: screen(p.content), roughness: 0.15 } };
  if (p.mount === 'muro') {
    add(parts, 'black', box(W + 0.02, H + 0.02, 0.03, { y: H / 2 + 0.01, r: 0.005 }));
    add(parts, 'tvScreen', planeXY(W - 0.01, H - 0.01, { y: 0.015, z: 0.0151 }));
    return { ...parts, $specs };
  }
  const y0 = 0.07;
  add(parts, 'black', box(W + 0.02, H + 0.02, 0.035, { y: y0 + H / 2 + 0.01, z: 0.0, r: 0.006 }));
  add(parts, 'tvScreen', planeXY(W - 0.01, H - 0.01, { y: y0 + 0.015, z: 0.0176 }));
  for (const s of [-1, 1]) add(parts, 'black', rod([s * W * 0.38, y0 + 0.03, 0], [s * W * 0.42, 0.0, 0.1], 0.01), rod([s * W * 0.38, y0 + 0.03, 0], [s * W * 0.42, 0, -0.08], 0.01));
  return { ...parts, $specs };
}

function monitor(p) {
  const parts = {}, W = p.size * 0.0254 * 0.8716, H = p.size * 0.0254 * 0.4903;
  const $specs = { monScreen: { kind: 'prop', color: '#ffffff', map: screen(p.content), roughness: 0.15 } };
  add(parts, 'black', boxOn(0.22, 0.012, 0.18, { r: 0.005 }), boxOn(0.045, 0.22, 0.03, { z: -0.04 }));
  add(parts, 'black', box(W + 0.02, H + 0.02, 0.03, { y: 0.12 + H / 2, z: -0.02, r: 0.006 }));
  add(parts, 'monScreen', planeXY(W - 0.005, H - 0.005, { y: 0.12 + 0.0025 - 0.0, z: -0.0045 }));
  if (p.keyboard) {
    add(parts, 'black', boxOn(0.44, 0.022, 0.14, { z: 0.26, r: 0.005 }));
    add(parts, 'plastic', boxOn(0.42, 0.006, 0.12, { y: 0.02, z: 0.26, r: 0.002 }));
    add(parts, 'black', sphere(0.03, { ws: 12, hs: 8 }).scale(1, 0.45, 1.5).translate(0.32, 0.013, 0.26));
  }
  return { ...parts, $specs };
}

function pc() {
  const parts = {};
  add(parts, 'black', boxOn(0.2, 0.45, 0.45, { r: 0.008 }));
  add(parts, 'glass', box(0.005, 0.38, 0.38, { x: 0.101, y: 0.23 }));
  add(parts, 'bulb', torus(0.05, 0.006, { x: 0.09, y: 0.3, z: 0.05, ry: 90, rs: 6, ts: 24 }), torus(0.05, 0.006, { x: 0.09, y: 0.16, z: 0.05, ry: 90, rs: 6, ts: 24 }));
  add(parts, 'metal', cylinder(0.008, 0.008, 0.004, { x: 0.04, y: 0.42, z: 0.225, rx: 90, seg: 12 }));
  return parts;
}

function laptop(p) {
  const parts = {}, W = 0.34, D = 0.24, a = (p.open * Math.PI) / 180;
  const $specs = { lapScreen: { kind: 'prop', color: '#ffffff', map: screen(p.content), roughness: 0.15 } };
  add(parts, 'metal', boxOn(W, 0.016, D, { r: 0.006 }));
  add(parts, 'black', boxOn(W - 0.04, 0.002, D * 0.45, { y: 0.016, z: -0.02 }), boxOn(0.1, 0.002, 0.06, { y: 0.016, z: D / 2 - 0.045 }));
  // lid hinged at the back edge
  const cy = 0.016 + (D / 2) * Math.sin(a), cz = -D / 2 + (D / 2) * Math.cos(a);
  const deg = 90 - p.open;
  add(parts, 'metal', box(W, D, 0.008, { y: cy, z: cz, rx: deg, r: 0.004 }));
  const scr = planeXY(W - 0.03, D - 0.03);
  scr.translate(0, -(D - 0.03) / 2, 0.0042);
  scr.rotateX((deg * Math.PI) / 180);
  scr.translate(0, cy, cz);
  add(parts, 'lapScreen', scr);
  return { ...parts, $specs };
}

function cassa(p) {
  const parts = {}, H = p.style === 'torre' ? 1.0 : 0.32, W = p.style === 'torre' ? 0.22 : 0.18;
  add(parts, 'woodDark', boxOn(W, H, W * 1.3, { r: 0.008 }));
  const cones = p.style === 'torre' ? [0.75, 0.5, 0.25] : [0.65, 0.3];
  for (const f of cones) { const rr = W * (f === cones[0] ? 0.22 : 0.36); add(parts, 'black', cylinder(rr, rr * 0.6, 0.01, { y: H * f, z: W * 0.65, rx: 90, seg: 24 }), torus(rr, 0.006, { y: H * f, z: W * 0.66, rs: 6, ts: 24 })); }
  return parts;
}

// ------------------------------------------------------------------------------------------ lights
function lampadaTerra(p) {
  const parts = {};
  if (p.style === 'arco') {
    add(parts, 'marble', boxOn(0.3, 0.08, 0.22, { x: -0.6, r: 0.01 }));
    add(parts, 'chrome', tube([[-0.6, 0.08, 0], [-0.62, 1.2, 0], [-0.4, 1.9, 0], [0.1, 2.05, 0], [0.45, 1.85, 0]], 0.014, { segs: 60, rs: 8 }));
    add(parts, 'chrome', lathe([[0.0, 0.18], [0.04, 0.18], [0.17, 0.0], [0.165, -0.005], [0, 0.12]], { x: 0.45, y: 1.6, seg: 32 }));
    add(parts, 'bulb', sphere(0.04, { x: 0.45, y: 1.64, ws: 12, hs: 8 }));
    return centerParts(parts);
  }
  if (p.style === 'treppiede') {
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; add(parts, 'woodLight', rod([Math.cos(a) * 0.32, 0, Math.sin(a) * 0.32], [0, 1.15, 0], 0.016, { r2: 0.012 })); }
    add(parts, 'shade', lathe([[0.25, 1.1], [0.23, 1.45]], { seg: 36 }));
    add(parts, 'bulb', sphere(0.04, { y: 1.22, ws: 12, hs: 8 }));
    return parts;
  }
  add(parts, 'gold', lathe([[0, 0], [0.16, 0], [0.15, 0.03], [0.04, 0.06], [0, 0.06]], { seg: 32 }), cylinder(0.014, 0.014, 1.4, { y: 0.05, seg: 12 }));
  add(parts, 'shade', lathe([[0.24, 1.25], [0.16, 1.6]], { seg: 36 }));
  add(parts, 'bulb', sphere(0.04, { y: 1.38, ws: 12, hs: 8 }));
  return parts;
}

function abatjour(p) {
  const parts = {};
  if (p.style === 'ceramica') add(parts, 'ceramic', lathe([[0, 0], [0.07, 0], [0.1, 0.08], [0.09, 0.2], [0.03, 0.27], [0.02, 0.3], [0, 0.3]], { seg: 28 }));
  else add(parts, 'gold', lathe([[0, 0], [0.08, 0], [0.075, 0.015], [0.015, 0.03], [0.012, 0.3], [0, 0.3]], { seg: 28 }));
  add(parts, 'shade', lathe([[0.17, 0.27], [0.11, 0.47]], { seg: 32 }));
  add(parts, 'bulb', sphere(0.03, { y: 0.34, ws: 10, hs: 8 }));
  return parts;
}

function sospensione(p) {
  const parts = {}, L = p.cable;
  add(parts, 'black', cylinder(0.05, 0.05, 0.03, { y: L + 0.25, seg: 18 }), rod([0, 0.25, 0], [0, L + 0.25, 0], 0.003, { seg: 6 }));
  if (p.style === 'globo') add(parts, 'glassLamp', sphere(0.16, { y: 0.16, ws: 28, hs: 18 }));
  else if (p.style === 'campana') add(parts, 'main', lathe([[0.0, 0.25], [0.04, 0.25], [0.06, 0.2], [0.09, 0.12], [0.2, 0.02], [0.21, 0.0], [0.205, -0.004], [0.08, 0.1], [0, 0.12]], { seg: 36 }));
  else add(parts, 'main', lathe([[0.0, 0.25], [0.03, 0.25], [0.15, 0.0], [0.148, -0.003], [0, 0.18]], { seg: 32 }));
  add(parts, 'bulb', sphere(0.045, { y: 0.07, ws: 12, hs: 8 }));
  return parts;
}

function plafoniera(p) {
  const parts = {};
  if (p.style === 'neon') {
    add(parts, 'metal', boxOn(1.22, 0.05, 0.2, { y: -0.05, r: 0.01 }));
    add(parts, 'bulb', rod([-0.58, -0.04, 0], [0.58, -0.04, 0], 0.015, { seg: 10 }));
  } else {
    add(parts, 'metal', cylinder(0.2, 0.2, 0.02, { y: -0.02, seg: 32 }));
    add(parts, 'glassLamp', lathe([[0.19, -0.02], [0.18, -0.06], [0.12, -0.1], [0, -0.11]], { seg: 32 }));
  }
  // origin on the ceiling mount: shift so y=0 is the bottom (catalog convention) — spawned at the ceiling
  for (const k of Object.keys(parts)) for (const g of parts[k]) g.translate(0, p.style === 'neon' ? 0.05 : 0.11, 0);
  return parts;
}

function faretto(p) {
  const parts = {}, H = p.height;
  for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + Math.PI / 6; add(parts, 'black', rod([Math.cos(a) * 0.45, 0.0, Math.sin(a) * 0.45], [0, 0.55, 0], 0.012)); }
  add(parts, 'black', rod([0, 0.4, 0], [0, H, 0], 0.017));
  if (p.style === 'softbox') {
    add(parts, 'black', cylinder(0.06, 0.06, 0.14, { y: H - 0.05, z: -0.05, rx: 90, seg: 16 }));
    // pyramid box (4-sided lathe) facing +Z
    add(parts, 'blackD', lathe([[0.08, 0.0], [0.5, 0.35]], { seg: 4 }).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).translate(0, H, 0.08));
    add(parts, 'diffuser', box(0.7, 0.7, 0.005, { y: H, z: 0.43, rz: 0 }));
  } else {
    add(parts, 'black', cylinder(0.09, 0.12, 0.25, { y: H, z: -0.05, rx: 90, seg: 24 }), torus(0.12, 0.01, { y: H, z: 0.2, rs: 6, ts: 24 }));
    add(parts, 'bulb', cylinder(0.11, 0.11, 0.005, { y: H, z: 0.198, rx: 90, seg: 24 }));
    for (const s of [-1, 1]) add(parts, 'black', box(0.004, 0.22, 0.14, { x: s * 0.17, y: H, z: 0.27, ry: s * -30 }));
  }
  return parts;
}

export const OFFICE_TYPES = [
  { id: 'postazione', label: 'Postazione open space', cat: 'ufficio', sub: 'mobili', color: '#c9c3b8', tags: 'cubicolo ufficio scrivania pannelli impiegato', params: [
    seg('shape', 'Pannelli', [['L', 'Ad angolo'], ['U', 'Su tre lati']], 'U'), range('width', 'Larghezza', 1.4, 2.6, 0.05, 1.8), range('depth', 'Profondità', 1.4, 2.4, 0.05, 1.8),
    range('wallH', 'Altezza pannelli', 1.0, 1.8, 0.05, 1.35), int('monitors', 'Monitor', 1, 3, 2), flag('chair', 'Sedia', true), range('clutter', 'Disordine', 0, 1, 0.05, 0.5, ''), seed(8),
  ], build: postazione },
  { id: 'schedario', label: 'Schedario metallico', cat: 'ufficio', sub: 'mobili', color: '#8c949c', tags: 'archivio cassetti ufficio', params: [int('drawers', 'Cassetti', 2, 5, 4)], build: schedario },
  { id: 'lavagna', label: 'Lavagna', cat: 'ufficio', sub: 'scuola', color: '#c3c7ce', tags: 'lavagna bianca nera aula riunione', params: [seg('kind', 'Tipo', [['bianca', 'Bianca'], ['nera', 'Nera (gesso)']], 'bianca'), range('width', 'Larghezza', 0.8, 3.0, 0.1, 1.6), flag('stand', 'Con cavalletto', true)], build: lavagna },
  { id: 'stampante', label: 'Stampante', cat: 'ufficio', sub: 'mobili', color: '#e8e4dc', tags: 'fotocopiatrice', params: [], build: stampante },
  { id: 'erogatore', label: 'Erogatore d’acqua', cat: 'ufficio', sub: 'mobili', color: '#e8e4dc', tags: 'acqua boccione distributore', params: [], build: erogatore },
  { id: 'tv', label: 'TV a schermo piatto', cat: 'elettronica', sub: 'tv-audio', color: '#3b3b40', tags: 'televisore schermo', params: [range('size', 'Pollici', 24, 85, 1, 50, ''), seg('mount', 'Supporto', [['piedini', 'Piedini'], ['muro', 'A muro']], 'piedini'), seg('content', 'Schermo', [['video', 'Film'], ['spento', 'Spento'], ['desktop', 'Menu']], 'video')], build: tv },
  { id: 'monitor', label: 'Monitor', cat: 'elettronica', sub: 'computer', color: '#3b3b40', tags: 'computer schermo pc', params: [range('size', 'Pollici', 19, 34, 1, 24, ''), seg('content', 'Schermo', [['desktop', 'Desktop'], ['codice', 'Codice'], ['spento', 'Spento']], 'desktop'), flag('keyboard', 'Tastiera e mouse', true)], build: monitor },
  { id: 'pc', label: 'Computer fisso', cat: 'elettronica', sub: 'computer', color: '#3b3b40', tags: 'pc case gaming', params: [], build: pc },
  { id: 'laptop', label: 'Portatile', cat: 'elettronica', sub: 'computer', color: '#3b3b40', tags: 'laptop notebook computer', params: [range('open', 'Apertura', 0, 120, 1, 105, ''), seg('content', 'Schermo', [['desktop', 'Desktop'], ['codice', 'Codice'], ['video', 'Video']], 'desktop')], build: laptop },
  { id: 'cassa', label: 'Cassa audio', cat: 'elettronica', sub: 'tv-audio', color: '#3b3b40', tags: 'altoparlante stereo musica', params: [seg('style', 'Modello', [['scaffale', 'Da scaffale'], ['torre', 'A torre']], 'scaffale')], build: cassa },
  { id: 'lampada_terra', label: 'Lampada da terra', cat: 'luci', sub: 'terra-tavolo', color: '#3b3b40', tags: 'piantana salotto', params: [seg('style', 'Modello', [['classica', 'Classica'], ['arco', 'Ad arco'], ['treppiede', 'Treppiede']], 'classica')], build: lampadaTerra },
  { id: 'abatjour', label: 'Abat-jour', cat: 'luci', sub: 'terra-tavolo', color: '#e8e4dc', tags: 'lampada comodino tavolo', params: [seg('style', 'Base', [['ottone', 'Ottone'], ['ceramica', 'Ceramica']], 'ceramica')], build: abatjour },
  { id: 'sospensione', label: 'Lampada a sospensione', cat: 'luci', sub: 'soffitto', color: '#2f4a6b', mount: 'ceil', tags: 'lampadario pendente', params: [seg('style', 'Paralume', [['cono', 'Cono'], ['campana', 'Campana'], ['globo', 'Globo']], 'campana'), range('cable', 'Cavo', 0.2, 1.6, 0.05, 0.7)], build: sospensione },
  { id: 'plafoniera', label: 'Plafoniera', cat: 'luci', sub: 'soffitto', color: '#e8e4dc', mount: 'ceil', tags: 'luce soffitto neon', params: [seg('style', 'Modello', [['tonda', 'Tonda'], ['neon', 'Neon']], 'tonda')], build: plafoniera },
  { id: 'faretto', label: 'Luce da studio', cat: 'luci', sub: 'terra-tavolo', color: '#3b3b40', tags: 'set fotografico softbox riflettore cinema', params: [seg('style', 'Modello', [['softbox', 'Softbox'], ['spot', 'Faro']], 'softbox'), range('height', 'Altezza', 1.0, 2.4, 0.05, 1.7)], build: faretto },
];
