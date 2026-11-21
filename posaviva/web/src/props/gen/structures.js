// Architectural interior pieces: "Stanza" room generator (walls with door and
// window openings, floor, optional ceiling, baseboards, open side for the
// camera), doors (with opening angle), windows (with shutters), indoor
// staircases (straight / L, open or closed risers, railings), floors, bar
// counter with back shelf and stools.
import * as THREE from 'three';
import { add, box, boxOn, cylinder, rod, sphere, torus, planeXZ, planeXY, range, int, seg, flag, seed, rng, colorize, merge, centerParts, handle, knob } from './util.js';
import { woodFloor, tiles, checker, marble, concrete } from '../textures.js';

export const FLOORS = [['legno', 'Parquet'], ['piastrelle', 'Piastrelle'], ['scacchi', 'Scacchi'], ['marmo', 'Marmo'], ['cemento', 'Cemento'], ['moquette', 'Moquette']];
export function floorSpec(kind) {
  if (kind === 'legno') return { kind: 'prop', color: '#ffffff', map: woodFloor('medio'), roughness: 0.55, tile: 1.2 };
  if (kind === 'scuro') return { kind: 'prop', color: '#ffffff', map: woodFloor('scuro'), roughness: 0.5, tile: 1.2 };
  if (kind === 'piastrelle') return { kind: 'prop', color: '#ffffff', map: tiles('#e8e4dc', '#a39d93'), roughness: 0.3, tile: 1.2 };
  if (kind === 'scacchi') return { kind: 'prop', color: '#ffffff', map: checker(), roughness: 0.3, tile: 1.2 };
  if (kind === 'marmo') return { kind: 'prop', color: '#ffffff', map: marble(), roughness: 0.2, tile: 1.6 };
  if (kind === 'cemento') return { kind: 'prop', color: '#ffffff', map: concrete(), roughness: 0.85, tile: 2.0 };
  return { kind: 'prop', color: '#8c7f73', roughness: 0.98, tile: 1 };
}
const specOf = (s) => { const o = { ...s }; delete o.tile; return o; };

/**
 * Wall along X centered at the origin, thickness along Z (interior face +Z),
 * with openings [{kind: 'door'|'window', cx, w, h, y}] -> parts (roles: main, trim, glass, door, metal).
 */
function wall(L, H, T, openings = [], o = {}) {
  const parts = {};
  const ops = openings.filter((q) => q.cx - q.w / 2 > -L / 2 + 0.05 && q.cx + q.w / 2 < L / 2 - 0.05).sort((a, b) => a.cx - b.cx);
  let x = -L / 2;
  for (const q of ops) {
    const a = q.cx - q.w / 2, b = q.cx + q.w / 2;
    if (a - x > 0.002) add(parts, 'main', boxOn(a - x, H, T, { x: (x + a) / 2 }));
    if (H - (q.y + q.h) > 0.002) add(parts, 'main', boxOn(q.w, H - (q.y + q.h), T, { x: q.cx, y: q.y + q.h }));
    if (q.y > 0.002) add(parts, 'main', boxOn(q.w, q.y, T, { x: q.cx }));
    // casing on both faces + reveal
    const c = 0.07, ct = 0.016;
    for (const s of [-1, 1]) {
      const z = s * (T / 2 + ct / 2 - 0.002), y0 = q.kind === 'door' ? 0 : q.y - c;
      add(parts, 'trim', boxOn(c, q.y + q.h + c - y0, ct, { x: a - c / 2, y: y0, z }), boxOn(c, q.y + q.h + c - y0, ct, { x: b + c / 2, y: y0, z }), box(q.w, c, ct, { x: q.cx, y: q.y + q.h + c / 2, z }));
      if (q.kind === 'window') add(parts, 'trim', box(q.w, c, ct, { x: q.cx, y: q.y - c / 2, z }));
    }
    add(parts, 'trim', boxOn(0.02, q.h, T, { x: a + 0.01, y: q.y }), boxOn(0.02, q.h, T, { x: b - 0.01, y: q.y }), box(q.w, 0.02, T, { x: q.cx, y: q.y + q.h - 0.01 }));
    if (q.kind === 'window') {
      add(parts, 'trim', box(q.w + 0.2, 0.035, T + 0.07, { x: q.cx, y: q.y - 0.0175, r: 0.006 }));
      const f = 0.05, fd = 0.06;
      add(parts, 'trim', box(q.w, f, fd, { x: q.cx, y: q.y + f / 2 }), box(q.w, f, fd, { x: q.cx, y: q.y + q.h - f / 2 }), box(f, q.h, fd, { x: a + f / 2, y: q.y + q.h / 2 }), box(f, q.h, fd, { x: b - f / 2, y: q.y + q.h / 2 }), box(0.04, q.h - 2 * f, fd * 0.8, { x: q.cx, y: q.y + q.h / 2 }));
      add(parts, 'glass', box(q.w - 2 * f, q.h - 2 * f, 0.006, { x: q.cx, y: q.y + q.h / 2 }));
    } else if (q.kind === 'door' && o.doorLeaf) {
      add(parts, 'door', boxOn(q.w - 0.03, q.h - 0.015, 0.04, { x: q.cx, z: -T / 2 + 0.03, r: 0.004 }));
      knob(parts, q.cx + q.w / 2 - 0.09, 1.0, -T / 2 + 0.05, 'gold');
    }
    x = b;
  }
  if (L / 2 - x > 0.002) add(parts, 'main', boxOn(L / 2 - x, H, T, { x: (x + L / 2) / 2 }));
  if (o.baseboard) {
    let bx = -L / 2;
    for (const q of [...ops.filter((q) => q.kind === 'door'), { cx: L / 2 + 1, w: 0 }]) {
      const a = Math.min(L / 2, q.cx - q.w / 2 - 0.07);
      if (a - bx > 0.01) add(parts, 'trim', boxOn(a - bx, 0.08, 0.012, { x: (a + bx) / 2, z: T / 2 + 0.006 }));
      bx = q.cx + q.w / 2 + 0.07;
    }
  }
  return parts;
}

function stanza(p) {
  const W = p.width, D = p.depth, H = p.height, T = 0.12;
  const parts = {};
  const floor = floorSpec(p.floor);
  parts.$specs = { floorTop: specOf(floor) };
  add(parts, 'floorTop', planeXZ(W + 2 * T, D + 2 * T, { y: 0.008, tile: floor.tile }));
  add(parts, 'dark', boxOn(W + 2 * T, 0.006, D + 2 * T, { y: 0.0015 }));
  if (p.ceiling) add(parts, 'ceiling', planeXZ(W + 2 * T, D + 2 * T, { y: H, down: true }));
  const sides = { fondo: [W, 0, -D / 2 - T / 2, 0], sinistra: [D, -W / 2 - T / 2, 0, 90], destra: [D, W / 2 + T / 2, 0, -90], davanti: [W, 0, D / 2 + T / 2, 180] };
  const walls = p.walls === '4' ? ['fondo', 'sinistra', 'destra', 'davanti'] : p.walls === '2' ? ['fondo', 'sinistra'] : ['fondo', 'sinistra', 'destra'];
  for (const name of walls) {
    const [L, x, z, ry] = sides[name];
    const ops = [];
    if (p.door === name) ops.push({ kind: 'door', cx: L * 0.25 * (name === 'fondo' ? 1 : -1), w: 0.9, h: 2.1, y: 0 });
    if (p.window === name) ops.push({ kind: 'window', cx: p.door === name ? -L * 0.2 : 0, w: Math.min(1.4, L - 0.6), h: Math.min(1.35, H - 1.2), y: 0.95 });
    // walls cover the corners: side walls extend over the back/front wall thickness
    const len = name === 'fondo' || name === 'davanti' ? L + 2 * T : L;
    merge(parts, wall(len, H, T, ops, { baseboard: p.baseboard, doorLeaf: true }), { x, z, ry });
  }
  return parts;
}

function porta(p) {
  const W = p.width, H = p.height, parts = {}, T = 0.04, c = 0.07;
  // frame (casing) standing free, front +Z
  add(parts, 'trim', boxOn(c, H + c, 0.12, { x: -W / 2 - c / 2, r: 0.004 }), boxOn(c, H + c, 0.12, { x: W / 2 + c / 2, r: 0.004 }), box(W + 2 * c, c, 0.12, { y: H + c / 2, r: 0.004 }));
  if (p.wall) add(parts, 'main', boxOn(0.6, H + 0.5, 0.1, { x: -W / 2 - c - 0.3 }), boxOn(0.6, H + 0.5, 0.1, { x: W / 2 + c + 0.3 }), boxOn(W + 2 * c, 0.5 - c, 0.1, { y: H + c }));
  const leaf = {};
  const lw = W - 0.01;
  add(leaf, 'door', boxOn(lw, H - 0.01, T, { x: lw / 2, r: 0.004 }));
  if (p.style === 'pannelli') for (const [y0, h] of [[0.12, H * 0.4], [H * 0.55, H * 0.38]]) {
    const fw = lw - 0.24;
    add(leaf, 'doorShade', boxOn(fw, 0.03, 0.012, { x: lw / 2, y: y0, z: T / 2 }), boxOn(fw, 0.03, 0.012, { x: lw / 2, y: y0 + h - 0.03, z: T / 2 }), boxOn(0.03, h, 0.012, { x: 0.12 + 0.015, y: y0, z: T / 2 }), boxOn(0.03, h, 0.012, { x: lw - 0.12 - 0.015, y: y0, z: T / 2 }));
  } else if (p.style === 'vetro') add(leaf, 'glass', boxOn(lw - 0.24, H * 0.55, T + 0.004, { x: lw / 2, y: H * 0.35 }));
  for (const s of [-1, 1]) add(leaf, 'gold', rod([lw - 0.07, 1.02, s * (T / 2)], [lw - 0.07, 1.02, s * (T / 2 + 0.05)], 0.008), rod([lw - 0.07, 1.02, s * (T / 2 + 0.05)], [lw - 0.19, 1.02, s * (T / 2 + 0.05)], 0.009), box(0.03, 0.14, 0.008, { x: lw - 0.07, y: 1.0, z: s * (T / 2 + 0.004), r: 0.003 }));
  merge(parts, leaf, { x: -W / 2 + 0.005, ry: -p.open });
  return parts;
}

function finestra(p) {
  const W = p.width, H = p.height, parts = {}, f = 0.06, d = 0.08;
  add(parts, 'trim', boxOn(W, f, d), boxOn(W, f, d, { y: H - f }), boxOn(f, H, d, { x: -W / 2 + f / 2 }), boxOn(f, H, d, { x: W / 2 - f / 2 }));
  const n = p.leaves, lw = (W - 2 * f) / n;
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + f + (i + 0.5) * lw;
    const s = 0.045;
    add(parts, 'trim', boxOn(lw, s, 0.05, { x, y: f }), boxOn(lw, s, 0.05, { x, y: H - f - s }), boxOn(s, H - 2 * f, 0.05, { x: x - lw / 2 + s / 2, y: f }), boxOn(s, H - 2 * f, 0.05, { x: x + lw / 2 - s / 2, y: f }));
    if (p.bars) add(parts, 'trim', box(lw - 2 * s, 0.025, 0.035, { x, y: H / 2 }));
    add(parts, 'glass', boxOn(lw - 2 * s, H - 2 * f - 2 * s, 0.006, { x, y: f + s }));
    knob(parts, x + (i % 2 ? -1 : 1) * (lw / 2 - 0.03), H / 2, 0.03, 'metal');
  }
  add(parts, 'trim', box(W + 0.1, 0.035, 0.18, { y: -0.0175, z: 0.04, r: 0.006 }));
  if (p.shutters) {
    for (const s of [-1, 1]) {
      const sw = W / 2, sx = s * (W / 2 + sw / 2 + 0.01);
      add(parts, 'main', boxOn(sw, 0.05, 0.035, { x: sx, z: 0.08 }), boxOn(sw, 0.05, 0.035, { x: sx, y: H - 0.05, z: 0.08 }), boxOn(0.05, H, 0.035, { x: sx - sw / 2 + 0.025, z: 0.08 }), boxOn(0.05, H, 0.035, { x: sx + sw / 2 - 0.025, z: 0.08 }));
      const nl = Math.round(H / 0.06);
      for (let k = 1; k < nl; k++) add(parts, 'main', box(sw - 0.1, 0.045, 0.01, { x: sx, y: (k * H) / nl, z: 0.08, rx: -40, r: 0 }));
    }
  }
  return parts;
}

function scalaInterna(p) {
  const n = p.steps, W = p.width, R = 0.18, Tr = 0.27, parts = {};
  const flight = (count, y0) => {
    const f = {};
    for (let i = 0; i < count; i++) {
      const y = y0 + R * (i + 1), z = -(i + 0.5) * Tr;
      if (p.style === 'chiusa') add(f, 'main', boxOn(W, y, Tr, { z, r: 0.004 }));
      else add(f, 'main', boxOn(W, 0.045, Tr + 0.03, { y: y - 0.045, z, r: 0.006 }));
    }
    if (p.style !== 'chiusa') for (const s of [-1, 1]) {
      const len = Math.hypot(count * Tr, count * R);
      add(f, 'metal', box(0.03, 0.25, len + 0.2, { x: s * (W / 2 + 0.015), y: y0 + (count * R) / 2 + 0.05, z: -(count * Tr) / 2, rx: (Math.atan2(R, Tr) * 180) / Math.PI }));
    }
    const sides = p.railing === 'due' ? [-1, 1] : p.railing === 'una' ? [1] : [];
    for (const s of sides) {
      const x = s * (W / 2 - 0.04);
      for (let i = 0; i < count; i += 1) { const z = -(i + 0.5) * Tr; add(f, 'darkMetal', rod([x, y0 + R * (i + 1), z], [x, y0 + R * (i + 1) + 0.9, z], 0.01, { seg: 8 })); }
      add(f, 'wood', rod([x, y0 + R + 0.9, 0.0], [x, y0 + R * count + 0.9, -(count - 0.5) * Tr - 0.1], 0.025, { seg: 12 }));
    }
    return f;
  };
  if (p.shape === 'L' && n >= 6) {
    const a = Math.floor(n / 2), b = n - a;
    merge(parts, flight(a, 0));
    const ly = R * (a + 1);
    // landing
    add(parts, 'main', p.style === 'chiusa' ? boxOn(W, ly, W, { z: -a * Tr - W / 2, r: 0.004 }) : boxOn(W, 0.06, W, { y: ly - 0.06, z: -a * Tr - W / 2, r: 0.006 }));
    if (p.style !== 'chiusa') add(parts, 'metal', boxOn(0.08, ly - 0.06, 0.08, { x: -W / 2 + 0.05, z: -a * Tr - W + 0.05 }), boxOn(0.08, ly - 0.06, 0.08, { x: W / 2 - 0.05, z: -a * Tr - W + 0.05 }));
    merge(parts, flight(b - 1, ly - R), { ry: -90, x: W / 2, z: -a * Tr - W / 2 });
  } else merge(parts, flight(n, 0));
  return centerParts(parts);
}

function pavimento(p) {
  const parts = {}, floor = floorSpec(p.kind);
  parts.$specs = { floorTop: specOf(floor) };
  add(parts, 'floorTop', planeXZ(p.width, p.depth, { y: 0.01, tile: floor.tile }));
  add(parts, 'dark', boxOn(p.width, 0.009, p.depth));
  return parts;
}

function bancone(p) {
  const L = p.length, r = rng(p.seed), parts = {}, H = 1.1, D = 0.6;
  const front = {};
  add(front, 'main', boxOn(L, H - 0.05, D - 0.1, { z: -0.05, r: 0.006 }));
  add(front, 'woodDark', boxOn(L + 0.06, 0.05, D + 0.1, { y: H - 0.05, r: 0.01 }));
  add(front, 'gold', rod([-L / 2, 0.18, D / 2 - 0.02], [L / 2, 0.18, D / 2 - 0.02], 0.02));
  const panels = Math.max(1, Math.round(L / 0.8));
  for (let i = 0; i < panels; i++) add(front, 'mainShade', boxOn(L / panels - 0.12, H - 0.35, 0.015, { x: -L / 2 + (i + 0.5) * (L / panels), y: 0.22, z: D / 2 - 0.1 + 0.0075, r: 0.004 }));
  // back counter (bar worker side) + taps
  add(front, 'steel', boxOn(L, 0.85, 0.5, { z: -D / 2 - 0.55, r: 0.004 }));
  for (let k = 0; k < Math.max(1, Math.round(L / 1.5)); k++) {
    const x = -L / 2 + 0.6 + k * 1.5;
    add(front, 'chrome', rod([x, H, -0.1], [x, H + 0.35, -0.1], 0.02), rod([x - 0.1, H + 0.3, -0.1], [x + 0.1, H + 0.3, -0.1], 0.015));
    for (let t = -1; t <= 1; t++) add(front, 'black', rod([x + t * 0.08, H + 0.3, -0.1], [x + t * 0.08, H + 0.18, -0.03], 0.008), cylinder(0.012, 0.012, 0.08, { x: x + t * 0.08, y: H + 0.33, z: -0.1, seg: 8 }));
  }
  merge(parts, front);
  if (p.shelf) {
    const sz = -D / 2 - 1.25;
    add(parts, 'woodDark', boxOn(L, 2.2, 0.03, { z: sz - 0.2 }));
    for (const y of [1.0, 1.4, 1.8]) {
      add(parts, 'woodDark', boxOn(L, 0.025, 0.28, { y, z: sz - 0.06 }));
      for (let x = -L / 2 + 0.06; x < L / 2 - 0.05; x += r.range(0.075, 0.11)) {
        const kind = r.int(0, 3), h = [0.3, 0.24, 0.28, 0.2][kind], rr = [0.037, 0.032, 0.045, 0.04][kind];
        const col = r.pick(['#1f4d2e', '#6b3a17', '#d9d4c3', '#3c1f5c', '#8a1c1c', '#d2a63b', '#1d3557']);
        const b = cylinder(rr, rr, h * 0.62, { x, y: y + 0.025, z: sz - 0.06, seg: 10, bevel: 0.003 });
        const neck = cylinder(rr * 0.35, rr * 0.35, h * 0.38, { x, y: y + 0.025 + h * 0.62, z: sz - 0.06, seg: 6, bevel: 0 });
        add(parts, 'vcGloss', colorize(b, col), colorize(neck, col));
      }
    }
    add(parts, 'mirror', boxOn(L - 0.2, 0.3, 0.01, { y: 0.92 + 1.15, z: sz - 0.18 }));
  }
  const ns = p.stools;
  for (let i = 0; i < ns; i++) {
    const x = -L / 2 + (i + 0.5) * (L / ns), z = D / 2 + 0.3;
    add(parts, 'leather', cylinder(0.17, 0.17, 0.07, { x, y: 0.72, z, seg: 24, bevel: 0.025 }));
    add(parts, 'chrome', rod([x, 0.04, z], [x, 0.72, z], 0.025), cylinder(0.2, 0.22, 0.03, { x, z, seg: 24 }), torus(0.16, 0.01, { rx: 90, x, y: 0.3, z, rs: 6, ts: 28 }));
  }
  return centerParts(parts);
}

export const STRUCTURE_TYPES = [
  { id: 'stanza', label: 'Stanza', cat: 'strutture', sub: 'stanze', color: '#e4ddd0', noPickRoles: ['floorTop', 'dark', 'ceiling'], tags: 'stanza camera pareti muri pavimento soffitto interno', params: [
    range('width', 'Larghezza', 2, 12, 0.1, 4.5), range('depth', 'Profondità', 2, 12, 0.1, 4.0), range('height', 'Altezza', 2.3, 4.5, 0.05, 2.7),
    seg('walls', 'Pareti', [['3', 'Tre (aperta davanti)'], ['2', 'Due (angolo)'], ['4', 'Quattro']], '3'),
    seg('door', 'Porta', [['fondo', 'In fondo'], ['sinistra', 'Sinistra'], ['destra', 'Destra'], ['nessuna', 'Nessuna']], 'sinistra'),
    seg('window', 'Finestra', [['fondo', 'In fondo'], ['sinistra', 'Sinistra'], ['destra', 'Destra'], ['nessuna', 'Nessuna']], 'fondo'),
    seg('floor', 'Pavimento', FLOORS, 'legno'), flag('baseboard', 'Battiscopa', true), flag('ceiling', 'Soffitto', false),
  ], build: stanza },
  { id: 'porta', label: 'Porta', cat: 'strutture', sub: 'porte-finestre', color: '#e8e4dc', tags: 'porta ingresso uscio', params: [
    seg('style', 'Modello', [['pannelli', 'A pannelli'], ['liscia', 'Liscia'], ['vetro', 'Con vetro']], 'pannelli'), range('open', 'Apertura', 0, 110, 1, 30, ''),
    range('width', 'Larghezza', 0.6, 1.2, 0.01, 0.85), range('height', 'Altezza', 1.9, 2.5, 0.01, 2.1), flag('wall', 'Con muro', false),
  ], build: porta },
  { id: 'finestra', label: 'Finestra', cat: 'strutture', sub: 'porte-finestre', color: '#2f5a3a', mount: 'window', spawnY: 0.95, tags: 'finestra persiane imposte vetro', params: [
    int('leaves', 'Ante', 1, 3, 2), range('width', 'Larghezza', 0.5, 2.4, 0.05, 1.2), range('height', 'Altezza', 0.6, 2.2, 0.05, 1.4), flag('shutters', 'Persiane', true), flag('bars', 'Traversi', true),
  ], build: finestra },
  { id: 'scala_interna', label: 'Scala interna', cat: 'strutture', sub: 'scale', color: '#b98c5f', tags: 'scala gradini scalinata ringhiera', params: [
    seg('shape', 'Forma', [['dritta', 'Dritta'], ['L', 'A L']], 'dritta'), seg('style', 'Gradini', [['aperta', 'Aperti'], ['chiusa', 'Pieni']], 'aperta'), int('steps', 'Gradini', 3, 18, 14),
    range('width', 'Larghezza', 0.7, 1.6, 0.05, 0.9), seg('railing', 'Ringhiera', [['una', 'Un lato'], ['due', 'Due lati'], ['nessuna', 'Nessuna']], 'una'),
  ], build: scalaInterna },
  { id: 'pavimento', label: 'Pavimento', cat: 'strutture', sub: 'stanze', color: '#c49a6c', tags: 'pavimento parquet piastrelle marmo', resizable: true, params: [
    seg('kind', 'Tipo', FLOORS, 'legno'), range('width', 'Larghezza', 0.5, 12, 0.1, 4), range('depth', 'Profondità', 0.5, 12, 0.1, 4),
  ], build: pavimento },
  { id: 'bancone', label: 'Bancone bar', cat: 'cucina', sub: 'mobili', color: '#7a1f24', tags: 'bar pub bancone birra spina bottiglie sgabelli', params: [
    range('length', 'Lunghezza', 1.5, 6, 0.1, 3.0), int('stools', 'Sgabelli', 0, 8, 4), flag('shelf', 'Scaffale bottiglie', true), seed(11),
  ], build: bancone },
];
