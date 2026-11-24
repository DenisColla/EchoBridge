// Special buildings: industrial shed, petrol station, church with bell tower,
// castle / medieval tower, classical temple, lighthouse.
import { Builder, M, contextOf, palette, eachFacade, rect, bush } from './common.js';
import { buildFacade, plinth, bands, cornice } from '../facade.js';
import { flatRoof, gableRoof, hipRoof, coneRoof } from '../roofs.js';
import { acUnit, antenna } from '../rooftop.js';
import { SKIP, inset, orient } from '../kit.js';
import { wallWithHoles, windowAt, doorAt, archOpening, shopfront, sign, railing, bays, roundOpening, frameRing, glassPane } from '../parts.js';
import { ACCENTS } from '../mats.js';

const DEG = Math.PI / 180;

// =============================================================== capannone industriale
export function capannone(p, b = new Builder()) {
  const ctx = contextOf(p, 31), R = ctx.rand, v = p.variant; // 'cemento' | 'lamiera' | 'storico'
  const P = palette(ctx, { wallTex: v === 'lamiera' ? 'corrugated' : v === 'storico' ? 'brick' : 'precast', frame: '#3a3d42', door: '#3a3d42' });
  P.garage = M('panels', R.pick(['#c9ccd0', '#5d6b7a', '#7a2f24', '#e8e4dc', '#c9a227']), { r: 0.5, m: 0.4 });
  P.frame = M(null, '#3a3d42', { r: 0.4, m: 0.6, d: true });
  const W = p.width, D = p.depth, H = p.height;
  const path = rect(W, D);
  const roofMetal = M('seam', R.pick(ACCENTS.metalRoof), { wear: ctx.wear, r: 0.45, m: 0.5 });
  eachFacade(b, path, (e, i) => {
    const L = e.len, holes = [], later = [];
    if (i === 0 || (i === 2 && R.chance(0.5))) {
      const nd = Math.max(1, Math.min(4, Math.floor(L / 9)));
      const xs = bays(L, nd, 2.5);
      for (const x of xs) {
        const w = 4.2, h = Math.min(H - 1.5, 4.8);
        holes.push({ x0: x - w / 2, x1: x + w / 2, y0: 0, y1: h });
        later.push(() => doorAt(b, P, { x: x - w / 2, w, h, type: 'garage', depth: 0.25 }));
      }
      if (i === 0) {
        const x = 1.0;
        holes.push({ x0: x, x1: x + 1.0, y0: 0, y1: 2.2 });
        later.push(() => doorAt(b, P, { x, w: 1.0, h: 2.2, type: 'single', canopy: { mat: P.metal, depth: 1.0 } }));
      }
    }
    // high ribbon windows
    if (v !== 'storico') {
      const y = H - 2.0, n = Math.max(1, Math.floor((L - 2) / 6));
      for (const x of bays(L, n, 1.0)) {
        const w = Math.min(4.8, (L - 2) / n - 0.8);
        holes.push({ x0: x - w / 2, x1: x + w / 2, y0: y, y1: y + 1.1 });
        later.push(() => windowAt(b, P, { x: x - w / 2, y, w, h: 1.1, type: 'ribbon', depth: 0.15, sill: false }));
      }
    } else {
      const n = Math.max(2, Math.floor(L / 4));
      for (const x of bays(L, n, 1.5)) {
        const y = 2.0, h = Math.min(4.2, H - 3.2), w = 1.8;
        if (holes.some((q) => x + w / 2 > q.x0 - 0.3 && x - w / 2 < q.x1 + 0.3 && q.y0 < 1)) continue;
        holes.push({ x0: x - w / 2, x1: x + w / 2, y0: y, y1: y + h });
        later.push(() => windowAt(b, P, { x: x - w / 2, y, w, h, type: 'arched', depth: 0.3 }));
      }
    }
    wallWithHoles(b, P.wall, 0, L, 0, H, holes);
    for (const fn of later) fn();
  });
  // base course + roof
  plinth(b, M('concrete', '#a9a59c', { wear: ctx.wear }), path, 0.14, 0.03);
  if (v === 'storico') {
    // sawtooth roof with north-light glazing
    const nT = Math.max(2, Math.round(D / 6)), tD = D / nT, th = 2.6;
    const glz = M(null, '#9fb3c0', { r: 0.1, m: 0.5 });
    for (let k = 0; k < nT; k++) {
      const z0 = D / 2 - k * tD, z1 = z0 - tD;
      b.quad(roofMetal, [-W / 2 - 0.3, H, z0 + 0.3], [W / 2 + 0.3, H, z0 + 0.3], [W / 2 + 0.3, H + th, z1], [-W / 2 - 0.3, H + th, z1], null, [0, 1, 0.5]);
      b.quad(glz, [W / 2, H, z1], [-W / 2, H, z1], [-W / 2, H + th, z1], [W / 2, H + th, z1], null, [0, 0, -1]);
      for (let x = -W / 2 + 1.5; x < W / 2; x += 1.5) b.box(P.frame, x - 0.04, H, z1 - 0.05, x + 0.04, H + th, z1 + 0.02, 0);
      for (const s of [-1, 1]) b.tri(P.wall, [s * W / 2, H, z0], [s * W / 2, H, z1], [s * W / 2, H + th, z1], [s, 0, 0]);
    }
    // tall factory chimney
    const cx = W / 2 + 2.5, cz = -D / 2 + 3;
    b.box(P.wall, cx - 1.6, 0, cz - 1.6, cx + 1.6, 3, cz + 1.6, SKIP.ny);
    b.cyl(P.wall, cx, cz, 1.25, 0.75, 3, H + 18, 14, { top: false });
    b.cyl(P.coping, cx, cz, 0.9, 0.9, H + 18, H + 18.6, 14, { top: true });
  } else if (p.roof === 'curvo') {
    // barrel vault
    const seg = 10, rise = Math.min(W * 0.18, 5);
    for (let i = 0; i < seg; i++) {
      const a0 = -1 + (2 * i) / seg, a1 = -1 + (2 * (i + 1)) / seg;
      const x0 = (a0 * (W + 0.6)) / 2, x1 = (a1 * (W + 0.6)) / 2, y0 = H + rise * (1 - a0 * a0), y1 = H + rise * (1 - a1 * a1);
      b.quad(roofMetal, [x0, y0, D / 2 + 0.4], [x1, y1, D / 2 + 0.4], [x1, y1, -D / 2 - 0.4], [x0, y0, -D / 2 - 0.4], null, [-(y1 - y0), x1 - x0, 0]);
      for (const s of [-1, 1]) b.tri(P.wall, [x0, H, s * D / 2], [x1, H, s * D / 2], [(x0 + x1) / 2, (y0 + y1) / 2 - 0.02, s * D / 2], [0, 0, s]);
      for (const s of [-1, 1]) b.quad(P.wall, [x0, H, s * D / 2], [x1, H, s * D / 2], [x1, y1, s * D / 2], [x0, y0, s * D / 2], null, [0, 0, s]);
    }
  } else {
    gableRoof(b, { top: roofMetal, under: roofMetal, edge: P.metal, gable: P.wall, ridge: roofMetal, gutter: P.gutter }, { W, D, y: H, pitch: 8, oh: 0.4, rake: 0.3, axis: 'z', t: 0.18 });
    // roof ventilators
    for (let k = -1; k <= 1; k++) b.cyl(P.metal, 0, (k * D) / 3, 0.4, 0.3, H + (W / 2) * Math.tan(8 * DEG) - 0.1, H + (W / 2) * Math.tan(8 * DEG) + 0.6, 10, { top: true });
  }
  // office annex
  if (p.office) {
    const ow = Math.min(10, W * 0.35), od = 6, oh2 = 6.4, ox = -W / 2 - ow / 2, oz = D / 2 - od / 2;
    const PO = { ...P, wall: M('plaster', '#e8e4dc', { wear: ctx.wear }) };
    b.push().translate(ox + 0.001, 0, oz);
    eachFacade(b, rect(ow, od), (e, i) => buildFacade(b, PO, { L: e.len, floors: 2, gh: 3.2, fh: 3.2, top: oh2, pitch: 2.6, margin: 0.6, blank: i === 1, win: { w: Math.min(e.len - 1.2, 5), h: 1.3, sill: 0.9, type: 'ribbon' }, bays: i === 1 ? 1 : 1, ground: 'residential', door: i === 0 ? { bay: 0, type: 'glass', w: 1.4, h: 2.4 } : null }));
    flatRoof(b, { wall: PO.wall, coping: P.coping, inner: PO.wall, roof: P.roofMembrane }, rect(ow, od), oh2, { ph: 0.5 });
    acUnit(b, P, 0, 0, oh2, 0);
    b.pop();
  }
  // signage on the front
  b.push().translate(-W / 2, 0, D / 2);
  sign(b, P, W / 2 - 3, H - 1.3, 6, 1.1, R.pick(['OFFICINA', 'MERCATO', 'MARKET']));
  b.pop();
  return b;
}

// =============================================================== stazione di servizio
export function benzinaio(p, b = new Builder()) {
  const ctx = contextOf(p, 32);
  const P = palette(ctx, { wallTex: 'plaster', wallColor: '#ece9e2', frame: '#2a2d31', door: '#2a2d31' });
  const brand = M(null, ctx.main, { r: 0.45 });
  const white = M(null, '#f4f2ee', { r: 0.5 });
  const steel = M(null, '#c9ccd0', { r: 0.35, m: 0.7 });
  const W = p.width, D = p.depth, H = 5.2;
  const pad = M('asphalt', '#7c7a76', { wear: ctx.wear, r: 0.95 });
  const conc = M('concrete', '#c9c4ba', { wear: ctx.wear });
  // forecourt slab
  b.box(conc, -W / 2 - 3, 0, -D / 2 - 12, W / 2 + 3, 0.04, D / 2 + 5, SKIP.ny);
  // canopy
  const cz = 0, cw = W, cd = D;
  b.box(white, -cw / 2, H, -cd / 2, cw / 2, H + 0.25, cd / 2, 0);
  b.box(brand, -cw / 2 - 0.08, H + 0.25, -cd / 2 - 0.08, cw / 2 + 0.08, H + 1.05, cd / 2 + 0.08, SKIP.ny);
  b.box(white, -cw / 2 - 0.1, H + 0.75, cd / 2 + 0.05, cw / 2 + 0.1, H + 0.95, cd / 2 + 0.12, 0);
  b.push().translate(-3, 0, cd / 2 + 0.09);
  sign(b, { ...P, darkFrame: brand }, 0, H + 0.32, 6, 0.66, 'FUEL', brand);
  b.pop();
  // under-canopy lights
  const lamp = M(null, '#fffaf0', { r: 0.2, lit: ctx.lights > 0 });
  for (let x = -cw / 2 + 2; x < cw / 2 - 1; x += 3) for (let z = -cd / 2 + 2; z < cd / 2 - 1; z += 3) b.box(lamp, x - 0.5, H - 0.03, z - 0.5, x + 0.5, H, z + 0.5, SKIP.py);
  // columns + islands with pumps
  const nIs = Math.max(1, Math.round(W / 7));
  const xs = bays(W, nIs, 1.5);
  for (const x of xs) {
    for (const z of [-cd / 2 + 2.2, cd / 2 - 2.2]) b.box(steel, x - 0.25, 0, z - 0.25, x + 0.25, H, z + 0.25, SKIP.ny | SKIP.py);
    b.box(conc, x - 0.7, 0.04, -cd / 2 + 1.4, x + 0.7, 0.22, cd / 2 - 1.4, SKIP.ny);
    for (const z of [-cd / 4 + 0.5, cd / 4 - 0.5]) {
      b.box(white, x - 0.35, 0.22, z - 0.55, x + 0.35, 1.9, z + 0.55, SKIP.ny);
      b.box(brand, x - 0.37, 1.6, z - 0.57, x + 0.37, 1.95, z + 0.57, 0);
      b.box(M(null, '#111318', { r: 0.2 }), x - 0.36, 1.1, z - 0.3, x + 0.36, 1.45, z + 0.3, 0);
      for (const s of [-1, 1]) b.rod(P.metal, [x + s * 0.36, 1.2, z + 0.4], [x + s * 0.55, 0.7, z + 0.4], 0.02, 4);
    }
    for (const z of [-cd / 2 + 1.2, cd / 2 - 1.2]) b.cyl(M(null, '#c9a227', { r: 0.5, d: true }), x, z, 0.08, 0.08, 0, 0.9, 8, { top: true });
  }
  // shop building behind the canopy
  const sw = Math.min(14, W * 0.7), sd = 8, sh = 3.6, sz = -cd / 2 - 3 - sd / 2;
  b.push().translate(0, 0, sz);
  eachFacade(b, rect(sw, sd), (e, i) => {
    if (i === 0) {
      const L = e.len, gw = L - 2;
      wallWithHoles(b, P.wall, 0, L, 0, sh, [{ x0: 1, x1: 1 + gw, y0: 0, y1: 2.8 }]);
      shopfront(b, { ...P, awning: null }, { x: 1, w: gw, h: 2.8, sign: 'MARKET', awning: null });
    } else buildFacade(b, P, { L: e.len, floors: 1, gh: sh, fh: sh, top: sh, pitch: 4, margin: 1, blank: true, ground: 'blank' });
  });
  b.box(brand, -sw / 2 - 0.1, sh, -sd / 2 - 0.1, sw / 2 + 0.1, sh + 0.7, sd / 2 + 0.1, SKIP.ny);
  b.prism(rect(sw, sd), sh + 0.5, sh + 0.6, { top: P.roofMembrane });
  acUnit(b, P, sw / 4, 0, sh + 0.6, 0);
  b.pop();
  // price totem
  const tx = W / 2 + 1.5, tz = cd / 2 + 3.5;
  b.box(white, tx - 0.9, 0, tz - 0.3, tx + 0.9, 6.5, tz + 0.3, SKIP.ny);
  b.box(brand, tx - 0.95, 5.0, tz - 0.32, tx + 0.95, 6.6, tz + 0.32, 0);
  const pr = M(null, '#111318', { r: 0.25 });
  for (let k = 0; k < 3; k++) b.box(pr, tx - 0.75, 1.4 + k * 1.1, tz + 0.3, tx + 0.75, 2.3 + k * 1.1, tz + 0.33, SKIP.nz);
  // air tower and a few bins / planters
  bush(b, P, -W / 2 - 1.5, cd / 2 + 2.5, 0, 0.6);
  bush(b, P, -W / 2 - 1.5, cd / 2 + 4, 0, 0.5);
  void cz; void pad;
  return b;
}

// =============================================================== chiesa con campanile
export function chiesa(p, b = new Builder()) {
  const ctx = contextOf(p, 33), R = ctx.rand, v = p.variant; // 'romanica' | 'classica' | 'gotica'
  const P = palette(ctx, { wallTex: v === 'romanica' ? R.pick(['brick', 'stone']) : v === 'gotica' ? 'castle' : 'plaster', trim: v === 'classica' ? '#f1ece2' : '#d9cfbd', trimTex: v === 'classica' ? 'plaster' : 'stone', frame: '#3a2a1e', door: '#4a2f20' });
  P.stained = M(null, R.pick(['#3d4f73', '#5a3d6b', '#2f5a6b']), { r: 0.15, m: 0.35, lit: ctx.lights > 0 });
  if (v !== 'classica') P.trim = M('stone', v === 'gotica' ? '#bfb7a8' : '#d9cfbd', { wear: ctx.wear });
  const W = p.width, D = p.depth, H = p.height;
  const pitch = v === 'gotica' ? 50 : 28;
  const nave = rect(W, D);
  const gotic = v === 'gotica';
  eachFacade(b, nave, (e, i) => {
    const L = e.len, holes = [], later = [];
    if (i === 0) {
      // main facade: portal, rose window, side windows
      const dw = 2.6, dh = Math.min(5.2, H * 0.42);
      holes.push({ x0: L / 2 - dw / 2, x1: L / 2 + dw / 2, y0: 0, y1: dh });
      later.push(() => doorAt(b, P, { x: L / 2 - dw / 2, w: dw, h: dh, type: 'portone', arched: true, depth: 0.6 }));
      const rr = Math.min(W * 0.16, 2.4), ry = Math.min(H - rr - 0.8, dh + rr + 1.4);
      holes.push({ x0: L / 2 - rr, x1: L / 2 + rr, y0: ry - rr, y1: ry + rr });
      later.push(() => roundOpening(b, P, L / 2, ry, rr, { depth: 0.45, spokes: gotic ? 12 : 8 }));
      if (W > 12) for (const x of [L * 0.2, L * 0.8]) {
        const w = 1.2, y = 1.5, h = Math.min(4, dh);
        holes.push({ x0: x - w / 2, x1: x + w / 2, y0: y, y1: y + h });
        later.push(() => windowAt(b, P, { x: x - w / 2, y, w, h, type: 'arched', depth: 0.4 }));
      }
    } else if (i === 1 || i === 3) {
      const n = Math.max(2, Math.floor(L / 4.5));
      for (const x of bays(L, n, 2)) {
        const w = gotic ? 1.4 : 1.6, y = gotic ? 2.4 : H * 0.45, h = gotic ? H - 4 : Math.min(3.6, H * 0.4);
        holes.push({ x0: x - w / 2, x1: x + w / 2, y0: y, y1: y + h });
        later.push(() => windowAt(b, P, { x: x - w / 2, y, w, h, type: 'arched', depth: 0.45 }));
        if (gotic) later.push(() => { // buttresses between windows
          const bx = x + L / n / 2;
          if (bx < L - 1) for (const [z0, z1, y0, y1] of [[0, 1.4, 0, H * 0.55], [0, 0.9, H * 0.55, H - 0.5]]) b.box(P.trim, bx - 0.4, y0, z0, bx + 0.4, y1, z1, SKIP.nz | SKIP.ny);
        });
      }
    }
    wallWithHoles(b, P.wall, 0, L, 0, H, holes);
    for (const fn of later) fn();
  });
  plinth(b, P.trim, nave, 0.3, 0.06);
  // facade: pilasters + pediment / gable cornice
  b.push().translate(-W / 2, 0, D / 2);
  if (v === 'classica') {
    for (const x of [0.4, W * 0.3, W * 0.7, W - 0.4]) b.box(P.trim, x - 0.35, 0.6, 0, x + 0.35, H - 0.1, 0.25, SKIP.nz);
    b.box(P.trim, -0.3, H - 0.9, 0, W + 0.3, H, 0.4, SKIP.nz);
  } else {
    for (const x of [0.5, W - 0.5]) b.box(P.trim, x - 0.5, 0, 0, x + 0.5, H, 0.35, SKIP.nz);
  }
  b.pop();
  const ry = gableRoof(b, { top: v === 'gotica' ? M('slate', '#4a4c52', { wear: ctx.wear }) : P.roofTile, under: P.wall, edge: P.trim, gable: P.wall, ridge: v === 'gotica' ? M(null, '#3d4046', { r: 0.6 }) : P.roofTile }, { W, D, y: H, pitch, oh: 0.35, rake: 0.25, axis: 'z', t: 0.35 });
  // front gable: raking cornice + cross
  const gy = H + (W / 2) * Math.tan(pitch * DEG);
  b.push().translate(0, 0, D / 2 + 0.3);
  const cross = M(null, '#c9a227', { r: 0.35, m: 0.85, d: true });
  b.box(P.trim, -0.12, gy + 0.2, -0.1, 0.12, gy + 2.2, 0.1, 0);
  b.box(P.trim, -0.6, gy + 1.4, -0.1, 0.6, gy + 1.62, 0.1, 0);
  void cross;
  b.pop();
  // apse
  if (p.apse) {
    const ar = W * 0.32, ah = H - 1.2;
    b.cyl(P.wall, 0, -D / 2, ar, ar, 0, ah, 16, { top: false, a0: Math.PI / 2, a1: Math.PI * 1.5 });
    coneRoof(b, P.roofTile, 0, -D / 2, ar, ah, ar * 0.6, 16, { oh: 0.25 });
    // flat side of the half-cone against the nave: the gable wall covers it
  }
  // bell tower
  if (p.tower) {
    const tw = Math.max(3.6, W * 0.32), th = p.towerHeight, tx = W / 2 + tw / 2 + 0.6, tz = D / 2 - tw / 2 - 1.0;
    b.push().translate(tx, 0, tz);
    const tp = rect(tw, tw);
    const bellY = th - 6.5;
    eachFacade(b, tp, (e) => {
      const L = e.len, holes = [], later = [];
      // slit windows along the shaft
      for (let y = 4; y < bellY - 3; y += 6) { holes.push({ x0: L / 2 - 0.25, x1: L / 2 + 0.25, y0: y, y1: y + 1.4 }); later.push(((yy) => () => windowAt(b, P, { x: L / 2 - 0.25, y: yy, w: 0.5, h: 1.4, type: 'arched', depth: 0.4 }))(y)); }
      // belfry: twin arched openings (bifora)
      const bw = Math.min(1.3, (L - 1.2) / 2 - 0.3);
      for (const x of [L / 2 - bw - 0.15, L / 2 + 0.15]) {
        holes.push({ x0: x, x1: x + bw, y0: bellY, y1: bellY + 3.6 });
        later.push(((xx) => () => archOpening(b, P, { x: xx, y: bellY, w: bw, h: 3.6, depth: tw / 2 - 0.4, sill: false }, { glass: false, frame: false }))(x));
      }
      // clock face
      holes.push({ x0: L / 2 - 0.9, x1: L / 2 + 0.9, y0: bellY - 3.0, y1: bellY - 1.2 });
      later.push(() => clock(b, L / 2, bellY - 2.1, 0.9));
      wallWithHoles(b, P.wall, 0, L, 0, th, holes);
      for (const fn of later) fn();
    });
    bands(b, P.trim, tp, [bellY - 0.5, th - 0.3], { out: 0.12, h: 0.3 });
    plinth(b, P.trim, tp, 1.0, 0.08);
    // dark interior of the belfry + a bell
    b.box(M(null, '#2a2724', { r: 0.9 }), -tw / 2 + 0.45, bellY, -tw / 2 + 0.45, tw / 2 - 0.45, bellY + 3.6, tw / 2 - 0.45, SKIP.ny);
    b.lathe(M(null, '#8a6a3a', { r: 0.4, m: 0.8, d: true }), 0, 0, [[0.62, bellY + 1.2], [0.5, bellY + 1.5], [0.36, bellY + 2.3], [0.3, bellY + 2.5], [0.0, bellY + 2.55]], 12);
    if (v === 'gotica') coneRoof(b, M('slate', '#4a4c52', { wear: ctx.wear }), 0, 0, tw * 0.68, th, tw * 3.2, 8, { oh: 0.15 });
    else hipRoof(b, { top: P.roofTile, under: P.wall, edge: P.trim }, { W: tw + 0.2, D: tw + 0.2, y: th, pitch: 55, oh: 0.25 });
    const sy = th + (v === 'gotica' ? tw * 3.2 : (tw / 2) * Math.tan(55 * DEG)) + 0.1;
    const goldC = M(null, '#c9a227', { r: 0.35, m: 0.85, d: true });
    b.box(goldC, -0.05, sy, -0.05, 0.05, sy + 1.6, 0.05, 0);
    b.box(goldC, -0.4, sy + 1.0, -0.05, 0.4, sy + 1.12, 0.05, 0);
    b.pop();
  }
  // churchyard steps
  b.box(P.trim, -W / 2 + 1, 0, D / 2, W / 2 - 1, 0.16, D / 2 + 1.2, SKIP.ny);
  b.box(P.trim, -W / 2 + 1.3, 0.16, D / 2, W / 2 - 1.3, 0.32, D / 2 + 0.8, SKIP.ny);
  void ry;
  return b;
}

/** Clock dial in a facade frame (disc + hands). */
function clock(b, cx, cy, r) {
  const face = M(null, '#f4f1ea', { r: 0.5, d: true }), dark = M(null, '#1d1d1d', { r: 0.4, d: true });
  b.push().translate(cx, cy, 0).rotateX(Math.PI / 2);
  b.cyl(face, 0, 0, r, r, -0.02, 0.06, 24, { top: true, bottom: false });
  b.pop();
  b.push().translate(cx, cy, 0.07);
  for (let k = 0; k < 12; k++) { b.push().rotateZ((k / 12) * Math.PI * 2); b.box(dark, -0.03, r * 0.78, 0, 0.03, r * 0.92, 0.02, 0); b.pop(); }
  b.push().rotateZ(-0.9); b.box(dark, -0.035, 0, 0.02, 0.035, r * 0.55, 0.04, 0); b.pop();
  b.push().rotateZ(2.1); b.box(dark, -0.025, 0, 0.04, 0.025, r * 0.8, 0.06, 0); b.pop();
  b.pop();
}

// =============================================================== castello / torre medievale
/** Crenellated parapet along a closed footprint at height y. */
function crenellate(b, d, path, y, { h = 1.0, mw = 0.8, gap = 0.6, t = 0.5 } = {}) {
  const P = orient(path);
  b.sweep(d, path, [[0, y], [0, y + h], [-t, y + h], [-t, y]]);
  for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length];
    const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.floor((L + gap) / (mw + gap)));
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    b.push().frame(ax, az, ux, uz);
    const used = n * mw + (n - 1) * gap, x0 = (L - used) / 2;
    for (let k = 0; k < n; k++) b.box(d, x0 + k * (mw + gap), y + h, -t, x0 + k * (mw + gap) + mw, y + h + 0.9, 0, SKIP.ny);
    b.pop();
  }
}

/** Corbelled machicolation band under the parapet. */
function machicolation(b, d, path, y, out = 0.45) {
  b.sweep(d, path, [[0, y - 0.9], [out * 0.4, y - 0.6], [out, y - 0.15], [out, y], [0, y]]);
}

export function castello(p, b = new Builder()) {
  const ctx = contextOf(p, 34), v = p.variant; // 'torre' | 'castello'
  const P = palette(ctx, { wallTex: 'castle', frame: '#3a2a1e', door: '#4a2f20', trim: '#bfb7a8', trimTex: 'stone' });
  P.trim = M('castle', ctx.main, { k: 0.92, wear: ctx.wear });
  const slate = M('slate', '#4a4c52', { wear: ctx.wear });
  const conic = p.roof === 'conico';
  const tower = (x, z, r, h, round, { slits = true, door = false } = {}) => {
    b.push().translate(x, 0, z);
    if (round) {
      b.cyl(P.wall, 0, 0, r * 1.08, r, 0, h, 20, { top: false });
      b.cyl(P.wall, 0, 0, r * 1.12, r * 1.12, h, h + 0.4, 20, { top: false });
      b.cyl(P.trim, 0, 0, r, r + 0.45, h - 0.8, h, 20, { top: false });
      if (conic) coneRoof(b, slate, 0, 0, r + 0.5, h + 1.3, r * 2.6, 16, { oh: 0.3 });
      else {
        b.cyl(P.wall, 0, 0, r + 0.45, r + 0.45, h, h + 1.3, 20, { top: false });
        b.cyl(P.wall, 0, 0, r - 0.05, r - 0.05, h, h + 1.3, 20, { top: false, inner: true });
        b.lathe(P.trim, 0, 0, [[r + 0.45, h + 1.3], [r - 0.05, h + 1.3]], 20);
        b.cyl(M('paving', '#8a857c', { wear: 2 }), 0, 0, r - 0.05, r - 0.05, h - 0.2, h + 0.3, 20, { top: true });
        const nM = Math.max(6, Math.round((2 * Math.PI * r) / 1.4));
        for (let k = 0; k < nM; k++) {
          b.push().rotateY((k / nM) * Math.PI * 2).translate(0, 0, r + 0.2);
          b.box(P.wall, -0.36, h + 1.3, -0.25, 0.36, h + 2.2, 0.25, SKIP.ny);
          b.pop();
        }
      }
      if (slits) for (let y = 3; y < h - 3; y += 4.5) for (const a of [0.3, 2.1, 4.0]) {
        b.push().rotateY(a + y * 0.3).translate(0, 0, r * 1.04);
        b.box(M(null, '#1d1b19', { r: 0.9, d: true }), -0.1, y, -0.05, 0.1, y + 1.2, 0.02, 0);
        b.pop();
      }
    } else {
      const tp = rect(2 * r, 2 * r);
      eachFacade(b, tp, (e, i) => {
        const L = e.len, holes = [], later = [];
        if (slits) for (let y = 3; y < h - 3; y += 4.5) { holes.push({ x0: L / 2 - 0.12, x1: L / 2 + 0.12, y0: y, y1: y + 1.3 }); later.push(((yy) => () => windowAt(b, { ...P, glass: M(null, '#1d1b19', { r: 0.9 }), glassLit: M(null, '#1d1b19', { r: 0.9 }) }, { x: L / 2 - 0.12, y: yy, w: 0.24, h: 1.3, type: 'simple', depth: 0.5, mullion: false }))(y)); }
        if (door && i === 0) { holes.push({ x0: L / 2 - 1, x1: L / 2 + 1, y0: 0, y1: 3.2 }); later.push(() => doorAt(b, P, { x: L / 2 - 1, w: 2, h: 3.2, type: 'barn', arched: true, depth: 0.9 })); }
        if (i === 0 && h > 14) { const y = h - 6; holes.push({ x0: L / 2 - 0.6, x1: L / 2 + 0.6, y0: y, y1: y + 2 }); later.push(() => windowAt(b, P, { x: L / 2 - 0.6, y, w: 1.2, h: 2, type: 'arched', depth: 0.6 })); }
        wallWithHoles(b, P.wall, 0, L, 0, h, holes);
        for (const fn of later) fn();
      });
      machicolation(b, P.trim, tp, h);
      if (conic) hipRoof(b, { top: slate, under: P.wall, edge: P.trim, ridge: slate }, { W: 2 * r + 0.9, D: 2 * r + 0.9, y: h + 0.1, pitch: 62, oh: 0.25 });
      else { crenellate(b, P.wall, inset(tp, -0.45), h); b.prism(inset(tp, 0.05), h - 0.3, h + 0.2, { top: M('paving', '#8a857c', { wear: 2 }) }); }
      plinth(b, P.trim, tp, door ? 0.25 : 1.4, door ? 0.06 : 0.25);
    }
    b.pop();
  };
  if (v === 'torre') {
    const r = p.width / 2, h = p.height;
    tower(0, 0, r, h, p.shape === 'tonda', { door: true });
    if (p.shape === 'tonda') {
      // door in the round tower base
      b.push().translate(0, 0, r * 1.06);
      b.box(P.trim, -1.2, 0, -0.2, 1.2, 3.6, 0.15, SKIP.ny);
      b.quad(P.door, [-0.8, 0, 0.16], [0.8, 0, 0.16], [0.8, 2.8, 0.16], [-0.8, 2.8, 0.16]);
      b.pop();
    }
  } else {
    // curtain walls + 4 corner towers + gatehouse + keep
    const S = p.width, h = Math.max(8, p.height * 0.45), tr = 3.2;
    const wall = rect(S, S);
    eachFacade(b, wall, (e, i) => {
      const L = e.len, holes = [];
      if (i === 0) holes.push({ x0: L / 2 - 2, x1: L / 2 + 2, y0: 0, y1: 4.6 });
      wallWithHoles(b, P.wall, 0, L, 0, h, holes);
      if (i === 0) archOpening(b, P, { x: L / 2 - 2, y: 0, w: 4, h: 4.6, depth: 2.4, sill: false }, { glass: false, frame: false });
    });
    // inner faces of the curtain walls
    eachFacade(b, inset(wall, 2.4), (e) => b.quad(P.wall, [e.len, 0, 0], [0, 0, 0], [0, h, 0], [e.len, h, 0], null, [0, 0, -1]));
    crenellate(b, P.wall, wall, h, { t: 2.4 });
    b.prism(inset(wall, 0.4), h - 0.05, h, { top: M('paving', '#8a857c', { wear: 2 }) });
    machicolation(b, P.trim, wall, h);
    for (const [x, z] of wall) tower(x, z, tr, h + 4, true, {});
    // gatehouse towers flanking the gate
    for (const s of [-1, 1]) tower(s * 3.4, S / 2 + 0.6, 1.8, h + 2.5, false, { slits: true });
    // keep
    tower(-S * 0.12, -S * 0.12, Math.max(3, S * 0.13), p.height, false, { door: true });
    b.box(M('paving', '#8a857c', { wear: 2 }), -S / 2 + 2.4, 0, -S / 2 + 2.4, S / 2 - 2.4, 0.03, S / 2 - 2.4, SKIP.ny);
  }
  return b;
}

// =============================================================== tempio classico
export function tempio(p, b = new Builder()) {
  const ctx = contextOf(p, 35), R = ctx.rand, v = p.variant; // 'dorico' | 'ionico' | 'rovina'
  const ruin = v === 'rovina';
  const mar = M('marble', ctx.main, { wear: ruin ? Math.max(2, ctx.wear) : ctx.wear, r: 0.55 });
  const marD = M('marble', ctx.main, { k: 0.94, wear: ruin ? 2 : ctx.wear, r: 0.6 });
  const W = p.width, D = p.depth;
  const nF = p.columns, cr = (W / nF) * 0.19, ch = cr * (v === 'ionico' ? 18 : 13);
  const step = 0.42, nS = 3, base = nS * step;
  // crepidoma
  for (let s = 0; s < nS; s++) b.box(mar, -W / 2 - (nS - s) * 0.55, s * step, -D / 2 - (nS - s) * 0.55, W / 2 + (nS - s) * 0.55, (s + 1) * step, D / 2 + (nS - s) * 0.55, s ? SKIP.ny : 0);
  const ix = W / 2 - cr * 1.4, iz = D / 2 - cr * 1.4;
  const nS2 = Math.max(4, Math.round((nF - 1) * (D / W)) + 1);
  const cols = [];
  for (let i = 0; i < nF; i++) { const x = -ix + (2 * ix * i) / (nF - 1); cols.push([x, iz], [x, -iz]); }
  for (let j = 1; j < nS2 - 1; j++) { const z = -iz + (2 * iz * j) / (nS2 - 1); cols.push([ix, z], [-ix, z]); }
  const colProf = (r, h) => {
    const pr = [];
    if (v === 'ionico') pr.push([r * 1.35, 0], [r * 1.35, r * 0.18], [r * 1.18, r * 0.3], [r * 1.25, r * 0.42], [r * 1.05, r * 0.55]);
    else pr.push([r * 1.02, 0]);
    for (let k = 0; k <= 6; k++) { const t = k / 6; pr.push([r * (1 - 0.18 * t * t + 0.03 * Math.sin(Math.PI * t)), (v === 'ionico' ? r * 0.55 : 0) + t * (h - r * 0.9)]); }
    pr.push([r * 0.9, h - r * 0.9], [r * 1.3, h - r * 0.4], [r * 1.35, h - r * 0.35], [0, h - r * 0.35]);
    return pr;
  };
  cols.forEach(([x, z], k) => {
    let h = ch;
    if (ruin && R.chance(0.35)) { if (R.chance(0.4)) return; h = ch * R.range(0.25, 0.8); }
    const broken = h < ch;
    const up = (pr) => pr.map(([r, y]) => [r, y + base]);
    if (broken) {
      const pr = colProf(cr, ch).filter(([, y]) => y < h);
      pr.push([cr * 0.85, h], [0, h + 0.1]);
      b.lathe(mar, x, z, up(pr), 16);
    } else {
      b.lathe(mar, x, z, up(colProf(cr, h)), 16);
      b.box(mar, x - cr * 1.45, base + h - cr * 0.35, z - cr * 1.45, x + cr * 1.45, base + h, z + cr * 1.45, 0);
      if (v === 'ionico') for (const s of [-1, 1]) { b.push().translate(x + s * cr * 1.2, base + h - cr * 0.7, z).rotateZ(Math.PI / 2); b.cyl(mar, 0, 0, cr * 0.32, cr * 0.32, -cr * 1.4, cr * 1.4, 10, { top: true, bottom: true }); b.pop(); }
    }
    // fluting hint: thin dark grooves are too costly; columns get flat facets instead
    void k;
  });
  // entablature
  const ey = base + ch;
  const eW = ix + cr * 1.5, eD = iz + cr * 1.5;
  const epath = rect(2 * eW, 2 * eD);
  if (!ruin || R.chance(0.3)) {
    b.prism(epath, ey, ey + cr * 1.6, { sides: mar, bottom: marD });
    // frieze with triglyphs (doric) / plain (ionic)
    b.prism(inset(epath, -0.02), ey + cr * 1.6, ey + cr * 3.0, { sides: marD });
    if (v !== 'ionico') eachFacadeTri(b, marD, epath, ey + cr * 1.65, cr);
    const ct = cornice(b, mar, epath, ey + cr * 3.0, cr * 1.6);
    if (!ruin) {
      // pediments + roof (ridge along z)
      const pitch = 14;
      const ry = gableRoof(b, { top: M('tiles', '#cfc8bb', { wear: ctx.wear, r: 0.7 }), under: marD, edge: mar, gable: marD, ridge: mar }, { W: 2 * eW + 0.3, D: 2 * eD + 0.3, y: ct, pitch, oh: 0.25, rake: 0.2, axis: 'z', t: 0.3 });
      // tympanum frame (raking cornice) on both ends
      for (const s of [1, -1]) {
        const zf = s * (eD + 0.25);
        b.push().translate(0, 0, zf).rotateY(s > 0 ? 0 : Math.PI);
        b.quad(mar, [-eW - 0.3, ct - 0.05, 0.25], [0, ry + 0.05, 0.25], [0, ry + 0.05, 0], [-eW - 0.3, ct - 0.05, 0], null, [-0.3, 1, 0]);
        b.quad(mar, [0, ry + 0.05, 0.25], [eW + 0.3, ct - 0.05, 0.25], [eW + 0.3, ct - 0.05, 0], [0, ry + 0.05, 0], null, [0.3, 1, 0]);
        b.quad(mar, [-eW - 0.3, ct - 0.35, 0.25], [eW + 0.3, ct - 0.35, 0.25], [eW + 0.3, ct - 0.05, 0.25], [-eW - 0.3, ct - 0.05, 0.25], null, [0, 0, 1]);
        b.pop();
      }
    }
  }
  // cella
  const cW = 2 * ix - cr * 5, cD = 2 * iz - cr * 7;
  if (cW > 2 && cD > 2) {
    const cell = rect(cW, cD);
    const ch2 = ruin ? ch * 0.5 : ch;
    eachFacade(b, cell, (e, i) => {
      const holes = i === 0 ? [{ x0: e.len / 2 - 1.4, x1: e.len / 2 + 1.4, y0: 0, y1: Math.min(ch2 - 0.6, 5.5) }] : [];
      b.push().translate(0, base, 0);
      wallWithHoles(b, marD, 0, e.len, 0, ch2, holes);
      if (i === 0) doorAt(b, { ...palette(ctx, {}), wall: marD, door: M(null, '#6b5130', { r: 0.4, m: 0.7 }) }, { x: e.len / 2 - 1.4, w: 2.8, h: Math.min(ch2 - 0.6, 5.5), type: 'portone', depth: 0.8, full: true });
      b.pop();
    });
  }
  return b;
}

function eachFacadeTri(b, d, path, y, cr) {
  const P = orient(path);
  for (let i = 0; i < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length];
    const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    const n = Math.floor(L / (cr * 2.6));
    b.push().frame(ax, az, ux, uz);
    for (let k = 0; k <= n; k++) {
      const x = (L * k) / n;
      b.box(d, x - cr * 0.4, y, 0, x + cr * 0.4, y + cr * 1.3, 0.06, SKIP.nz);
    }
    b.pop();
  }
}

// =============================================================== faro
export function faro(p, b = new Builder()) {
  const ctx = contextOf(p, 36), R = ctx.rand, v = p.variant; // 'strisce' | 'bianco' | 'pietra'
  const white = M('plaster', '#f2efe8', { wear: ctx.wear, r: 0.8 });
  const band = M('plaster', ctx.main, { wear: ctx.wear, r: 0.8 });
  const stone = M('castle', '#b9b0a0', { wear: ctx.wear });
  const dark = M(null, '#2a2d31', { r: 0.4, m: 0.6 });
  const H = p.height, r0 = p.radius, r1 = r0 * 0.68;
  const P = palette(ctx, { wallTex: 'plaster', wallColor: '#f2efe8', frame: '#2a2d31', door: '#2a2d31' });
  // base platform (octagonal)
  const oct = [];
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; oct.push([Math.sin(a) * (r0 + 2), Math.cos(a) * (r0 + 2)]); }
  b.prism(oct, 0, 1.0, { sides: stone, top: M('paving', '#a9a59c', { wear: ctx.wear }) });
  // tapered shaft in bands
  const nb = v === 'strisce' ? 6 : 1;
  for (let k = 0; k < nb; k++) {
    const y0 = 1 + ((H - 1) * k) / nb, y1 = 1 + ((H - 1) * (k + 1)) / nb;
    const ra = r0 + (r1 - r0) * ((y0 - 1) / (H - 1)), rb = r0 + (r1 - r0) * ((y1 - 1) / (H - 1));
    b.cyl(v === 'pietra' ? stone : v === 'strisce' && k % 2 ? band : white, 0, 0, ra, rb, y0, y1, 24, { top: false });
  }
  // small windows spiralling up
  for (let y = 4, a = 0; y < H - 4; y += 3.6, a += 1.7) {
    const rr = r0 + (r1 - r0) * ((y - 1) / (H - 1));
    b.push().rotateY(a).translate(0, 0, rr - 0.06);
    b.box(dark, -0.25, y, -0.1, 0.25, y + 0.9, 0.06, 0);
    b.box(white, -0.35, y - 0.08, -0.05, 0.35, y, 0.18, 0);
    b.pop();
  }
  // door
  b.push().translate(0, 0, r0 - 0.05);
  b.box(white, -0.9, 1, -0.3, 0.9, 3.8, 0.35, SKIP.ny);
  b.quad(P.door, [-0.6, 1, 0.36], [0.6, 1, 0.36], [0.6, 3.2, 0.36], [-0.6, 3.2, 0.36]);
  b.pop();
  // gallery: corbels, slab, railing
  const gy = H;
  b.cyl(white, 0, 0, r1, r1 + 1.1, gy - 1.0, gy - 0.25, 24, { top: false, bottom: false });
  b.cyl(dark, 0, 0, r1 + 1.15, r1 + 1.15, gy - 0.25, gy, 24, { top: true, bottom: true });
  const ring = [];
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI * 2; ring.push([Math.sin(a) * (r1 + 1.0), Math.cos(a) * (r1 + 1.0)]); }
  b.push().translate(0, 0, 0);
  railing(b, { ...P, metal: dark }, ring, gy, 'bars');
  b.pop();
  // lantern room
  const lr = r1 * 0.72, lh = 2.8;
  b.cyl(dark, 0, 0, lr, lr, gy, gy + 0.8, 12, { top: false });
  const lens = M(null, '#d9ecf2', { r: 0.05, m: 0.3, op: 0.55, lit: ctx.lights > 0 });
  b.cyl(lens, 0, 0, lr, lr, gy + 0.8, gy + lh, 12, { top: false, smooth: false });
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; b.rod(dark, [Math.sin(a) * lr, gy + 0.8, Math.cos(a) * lr], [Math.sin(a) * lr, gy + lh, Math.cos(a) * lr], 0.05, 4); }
  b.cyl(M(null, '#fff3c4', { r: 0.2, lit: ctx.lights > 0 }), 0, 0, 0.45, 0.45, gy + 1.2, gy + 2.2, 12, { top: true, bottom: true });
  b.dome(M(null, v === 'strisce' ? '#7a1f24' : '#2a2d31', { r: 0.4, m: 0.6 }), 0, gy + lh, 0, lr + 0.2, 16, 5, 0.75);
  b.cyl(dark, 0, 0, 0.2, 0.12, gy + lh + lr * 0.7, gy + lh + lr * 0.7 + 0.6, 8, { top: true });
  b.lathe(dark, 0, 0, [[0, gy + lh + lr * 0.7 + 0.6], [0.22, gy + lh + lr * 0.7 + 0.8], [0, gy + lh + lr * 0.7 + 1.0]], 8);
  // keeper's house
  if (p.house) {
    const hw = 7, hd = 5.5, hx = r0 + 2 + hw / 2 - 1.5;
    b.push().translate(hx, 1.0, 0);
    eachFacade(b, rect(hw, hd), (e, i) => buildFacade(b, P, { L: e.len, floors: 1, gh: 3, fh: 3, top: 3, pitch: 2.6, margin: 0.8, blank: i === 3, win: { w: 0.9, h: 1.2, sill: 0.9, type: 'casement', shutters: 'louver' }, ground: 'residential', door: i === 0 ? { bay: 'center', type: 'single' } : null }));
    gableRoof(b, { top: M('tiles', '#94503a', { wear: ctx.wear }), under: white, edge: white, gable: white, ridge: M('tiles', '#94503a') }, { W: hw, D: hd, y: 3, pitch: 26, oh: 0.4, rake: 0.3, axis: 'x' });
    b.pop();
  }
  void R; void flatRoof; void antenna; void frameRing; void glassPane; void ACCENTS; void plinth; void hipRoof;
  return b;
}
