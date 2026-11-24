// Houses: modern villa, terraced houses, farmhouse (cascina), mountain hut
// (baita), traditional Japanese house.
import { Builder, M, contextOf, palette, eachFacade, rect, bush } from './common.js';
import { buildFacade, plinth } from '../facade.js';
import { gableRoof, hipRoof, shedRoof } from '../roofs.js';
import { chimney, antenna, solarPanels } from '../rooftop.js';
import { SKIP } from '../kit.js';
import { railing, windowAt, doorAt, wallWithHoles } from '../parts.js';
import { ACCENTS } from '../mats.js';

// =============================================================== villetta moderna
export function villetta(p, b = new Builder()) {
  const ctx = contextOf(p, 11), R = ctx.rand, v = p.variant; // 'cubica' | 'falda' | 'elle'
  const P = palette(ctx, { wallTex: 'plaster', frame: R.pick(['#2a2d31', '#3b3d42', '#4a4c50']), door: '#2a2d31', trim: '#f2f0ea' });
  P.frame = P.darkFrame;
  const clad = M(R.pick(['wood', 'woodV']), R.pick(['#a0703f', '#8a5a3b', '#6b4a2f', '#b78a5a']), { wear: ctx.wear, r: 0.7 });
  const stone = M(R.pick(['stone', 'travertine']), R.pick(['#8f8a80', '#bfb39b', '#6f6b66']), { wear: ctx.wear, r: 0.85 });
  const slab = M('plaster', '#f4f2ee', { wear: ctx.wear, r: 0.8 });
  const W = p.width, D = p.depth, two = p.floors > 1;
  const h0 = 3.2, h1 = 3.0;
  const big = { w: 2.8, h: 2.55, sill: 0.08, type: 'modern', depth: 0.2 };
  // ---- ground volume
  const g = rect(W, D);
  const groundFace = (L, i) => {
    if (i === 0) return { L, floors: 1, gh: h0, fh: h0, top: h0, pitch: 3.4, margin: 0.8, win: big, ground: 'residential', door: { bay: 'left', type: 'glass', w: 1.3, h: 2.5 }, winFor: (k, j, n) => (j === n - 1 && n > 2 ? { w: 1.2, h: 1.2, sill: 1.1, type: 'square' } : {}) };
    if (i === 2) return { L, floors: 1, gh: h0, fh: h0, top: h0, pitch: 3.6, margin: 1.0, win: big, ground: 'residential' };
    return { L, floors: 1, gh: h0, fh: h0, top: h0, pitch: 4, margin: 1.2, win: { w: 1.4, h: 1.3, sill: 1.0, type: 'modern' }, ground: 'residential' };
  };
  const PW = { ...P, wall: v === 'elle' ? stone : P.wall };
  eachFacade(b, g, (e, i) => buildFacade(b, PW, groundFace(e.len, i)));
  // ---- upper volume (cantilevered, clad)
  let topY = h0;
  if (two) {
    const W2 = Math.max(5, W * (v === 'elle' ? 0.55 : 0.68)), D2 = Math.min(D + 1.6, D * 1.15), ox = v === 'elle' ? -(W - W2) / 2 : (W - W2) / 2 - 0.6, oz = v === 'elle' ? -0.5 : 0.8;
    b.push().translate(ox, h0, oz);
    const PU = { ...P, wall: v === 'cubica' ? clad : P.wall };
    eachFacade(b, rect(W2, D2), (e, i) => buildFacade(b, PU, { L: e.len, floors: 1, gh: h1, fh: h1, top: h1, pitch: 3.8, margin: 0.7, ground: 'residential',
      win: i === 0 ? { w: Math.min(e.len - 1.4, 4.6), h: 1.25, sill: 0.9, type: 'ribbon' } : { w: 1.8, h: 2.3, sill: 0.2, type: 'modern' }, bays: i === 0 ? 1 : undefined }));
    // underside of the overhang + roof
    b.prism(rect(W2, D2), -0.001, 0.0, { bottom: slab });
    if (v === 'falda') shedRoof(b, { top: M('seam', '#4a4c50', { r: 0.45, m: 0.5 }), under: slab, edge: P.darkFrame, gable: PU.wall, back: PU.wall }, { W: W2, D: D2, y: h1, pitch: 9, oh: 0.5, t: 0.2 });
    else {
      b.box(slab, -W2 / 2 - 0.35, h1, -D2 / 2 - 0.35, W2 / 2 + 0.35, h1 + 0.3, D2 / 2 + 0.35, 0);
      if (R.chance(0.6)) solarPanels(b, P, 0, 0, h1 + 0.3, 1, Math.max(2, Math.floor(W2 / 1.2) - 1), 0);
    }
    b.pop();
    topY = h0 + h1;
  }
  // ground roof: thin overhanging slab (terrace where not covered)
  b.box(slab, -W / 2 - 0.4, h0, -D / 2 - 0.4, W / 2 + 0.4, h0 + 0.28, D / 2 + 0.8, 0);
  if (two) railing(b, { ...P, railGlass: M(null, '#b9cbd4', { r: 0.05, m: 0.4, op: 0.35, d: true }) }, [[-W / 2 - 0.3, D / 2 + 0.7], [W / 2 + 0.3, D / 2 + 0.7]], h0 + 0.28, 'glass');
  // feature wall in stone at the entrance, paths and planting
  b.box(stone, -W / 2 - 0.6, 0, D / 2 - 0.2, -W / 2 + 0.0, 2.6, D / 2 + 1.6, SKIP.ny);
  b.box(M('paving', '#c9c4ba', { wear: ctx.wear }), -W / 2 + 0.3, 0, D / 2, -W / 2 + 1.8, 0.04, D / 2 + 4, SKIP.ny);
  for (let i = 0; i < 4; i++) bush(b, P, W / 2 - 0.8 - i * 1.4, D / 2 + 1.0 + R.range(0, 0.4), 0, R.range(0.35, 0.55));
  void topY;
  return b;
}

// =============================================================== casa a schiera
export function schiera(p, b = new Builder()) {
  const ctx = contextOf(p, 12), R = ctx.rand, v = p.variant; // 'italiana' | 'inglese' | 'nordica'
  const n = p.units, uw = p.unitWidth, D = p.depth, floors = p.floors;
  const total = n * uw;
  const fh = 2.9, gh = v === 'inglese' ? 3.0 : 3.0;
  const plColors = v === 'nordica' ? ['#c0504d', '#e9c98f', '#2f4a6b', '#4f6b3a', '#e8e4dc', '#8a3d2b', '#d9a46a'] : v === 'inglese' ? ['#9c4a33', '#8a3d2b', '#b35d3c', '#7b4a35', '#a0583a'] : ['#e8dcc4', '#e9c98f', '#d9a46a', '#c97b54', '#e3b8a6', '#cfd6cc', '#e7d3b8'];
  for (let u = 0; u < n; u++) {
    const UR = R.fork(u + 1);
    const uctx = { ...ctx, rand: UR };
    const color = u === 0 ? ctx.main : UR.pick(plColors);
    const P = palette(uctx, {
      wallTex: v === 'inglese' ? 'brick' : v === 'nordica' ? 'wood' : 'plaster', wallColor: color,
      trim: v === 'inglese' ? '#f4f1ea' : '#ece6d8', frame: v === 'italiana' ? UR.pick(['#f2f0ea', '#6b4a2f']) : '#f4f1ea',
      door: UR.pick(ACCENTS.door.concat(['#1d3b5c', '#7a1f24', '#2f5a3a'])),
    });
    const ux = -total / 2 + uw * (u + 0.5);
    const extra = v === 'nordica' ? UR.range(-0.4, 1.2) : 0;
    const top = gh + (floors - 1) * fh + extra;
    b.push().translate(ux, 0, 0);
    eachFacade(b, rect(uw, D), (e, i) => {
      const party = (i === 1 && u < n - 1) || (i === 3 && u > 0);
      const front = i === 0;
      buildFacade(b, P, {
        L: e.len, floors, gh, fh, top, pitch: uw > 6 ? 2.6 : 2.4, margin: 0.8, blank: party, bays: front ? 2 : undefined,
        win: { w: v === 'nordica' ? 0.9 : 1.05, h: v === 'nordica' ? 1.7 : 1.45, sill: 0.85, type: 'casement', shutters: v === 'italiana' ? 'louver' : null, depth: 0.16, surround: v === 'inglese' ? 'band' : null },
        ground: 'residential', door: front ? { bay: u % 2 ? 'left' : 'right', type: 'single', w: 1.0, h: 2.3, raised: v === 'inglese' ? 0.45 : 0.15, canopy: v === 'italiana' ? { mat: P.trim, depth: 0.9 } : null } : i === 2 ? { bay: 'center', type: 'glass', w: 1.6, h: 2.3 } : null,
        balconies: v === 'italiana' && front ? 'center' : 'none', rail: 'bars', balconyDepth: 0.8,
      });
    });
    // bay window (inglese) on the ground floor front
    if (v === 'inglese') {
      const bx = (u % 2 ? 0.25 : -0.25) * uw, bw = uw * 0.42;
      b.push().translate(bx, 0, D / 2);
      bayWindow(b, P, bw, 0.7, 0.45, gh - 0.2);
      b.pop();
    }
    plinth(b, P.coping, rect(uw, D), 0.14, 0.03);
    // roof: gable facing the street (nordica / inglese) or ridge along the row
    const M2 = { top: v === 'nordica' ? M('tiles', '#6d4a3a', { wear: ctx.wear }) : v === 'inglese' ? M('slate', UR.pick(ACCENTS.slate), { wear: ctx.wear }) : P.roofTile, under: P.soffit, edge: P.fascia, gable: P.wall, ridge: v === 'inglese' ? M(null, '#3d4046', { r: 0.6 }) : P.roofTile, gutter: P.gutter };
    if (v === 'nordica') {
      const ry = gableRoof(b, M2, { W: uw, D, y: top, pitch: 52, oh: 0.25, rake: 0.12, axis: 'z' });
      // gable attic window
      b.push().translate(-uw / 2, 0, D / 2);
      const wy = top + 0.6;
      windowAt(b, P, { x: uw / 2 - 0.45, y: wy, w: 0.9, h: Math.min(1.3, (ry - top) * 0.45), type: 'casement', depth: 0.14 });
      b.pop();
      // hole in gable is not cut: draw the window on a small proud panel instead
      b.box(P.trim, -0.6, top + 0.45, D / 2, 0.6, top + 0.55, D / 2 + 0.08, 0);
    } else {
      gableRoof(b, M2, { W: uw + (u === 0 || u === n - 1 ? 0 : 0.001), D, y: top, pitch: v === 'inglese' ? 38 : 26, oh: 0.45, rake: u === 0 || u === n - 1 ? 0.3 : 0.0, axis: 'x' });
      if (UR.chance(0.6)) chimney(b, P, uw * 0.3, -D * 0.2, top + D * 0.3 * Math.tan(((v === 'inglese' ? 38 : 26) * Math.PI) / 180), 1.0, 0.5, 0.5);
      if (v === 'italiana' && UR.chance(0.7)) antenna(b, P, -uw * 0.2, -D * 0.1, top + D * 0.4 * Math.tan((26 * Math.PI) / 180), 2.2, UR.range(0, 3));
    }
    // front garden: low wall / hedge + path
    const P2 = P;
    if (p.gardens) {
      const gd = 2.4;
      b.box(P2.coping, -uw / 2 + 0.02, 0, D / 2 + gd - 0.25, uw / 2 - 0.02, 0.55, D / 2 + gd, SKIP.ny);
      if (u === 0) b.box(P2.coping, -uw / 2, 0, D / 2, -uw / 2 + 0.2, 0.55, D / 2 + gd, SKIP.ny);
      if (u === n - 1) b.box(P2.coping, uw / 2 - 0.2, 0, D / 2, uw / 2, 0.55, D / 2 + gd, SKIP.ny);
      b.box(P2.paving, (u % 2 ? -0.25 : 0.25) * uw - 0.6, 0, D / 2, (u % 2 ? -0.25 : 0.25) * uw + 0.6, 0.03, D / 2 + gd - 0.25, SKIP.ny);
      bush(b, P2, (u % 2 ? 0.25 : -0.25) * uw, D / 2 + 1.1, 0, 0.55);
    }
    b.pop();
  }
  return b;
}

/** Three-sided bay window (inglese) in a facade frame, centered at x = 0, projecting `dep`. */
function bayWindow(b, P, w, dep, y0, y1) {
  const side = dep * 1.2, front = w - 2 * dep * 0.7;
  const pts = [[-w / 2, 0], [-front / 2, dep], [front / 2, dep], [w / 2, 0]];
  for (let i = 0; i < 3; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    b.push().frame(ax, az, ux, uz);
    wallWithHoles(b, P.trim, 0, L, 0, y1, [{ x0: 0.12, x1: L - 0.12, y0: y0 + 0.45, y1: y1 - 0.25 }]);
    windowAt(b, P, { x: 0.12, y: y0 + 0.45, w: L - 0.24, h: y1 - y0 - 0.7, type: 'casement', depth: 0.08 });
    b.pop();
  }
  b.poly(P.slate || P.roofTile, [[-w / 2, y1, 0], [w / 2, y1, 0], [front / 2 + 0.05, y1 - 0.25, dep + 0.08], [-front / 2 - 0.05, y1 - 0.25, dep + 0.08]].reverse(), [0, 1, 0.5]);
  b.poly(P.trim, [[-w / 2, y1, 0], [-front / 2, y1, dep], [front / 2, y1, dep], [w / 2, y1, 0]], [0, 1, 0]);
  void side;
}

// =============================================================== cascina
export function cascina(p, b = new Builder()) {
  const ctx = contextOf(p, 13), R = ctx.rand, v = p.variant; // 'pietra' | 'intonaco'
  const P = palette(ctx, { wallTex: v === 'pietra' ? 'rubble' : 'stucco', trim: '#e6dccb', shutter: R.pick(['#3f5f3a', '#6b4a2f', '#5a3b26', '#7c8a7a']), frame: '#5a3b26', door: '#5a3b26' });
  const brick = M('brick', '#a0583a', { wear: Math.max(1, ctx.wear), r: 0.9 });
  const W = p.width, D = p.depth, floors = p.floors;
  const gh = 3.0, fh = 2.9, top = gh + (floors - 1) * fh;
  const barnW = p.barn ? Math.max(6, W * 0.55) : 0;
  const total = W + barnW;
  const hx = -total / 2 + W / 2; // house center
  b.push().translate(hx, 0, 0);
  eachFacade(b, rect(W, D), (e, i) => buildFacade(b, P, {
    L: e.len, floors, gh, fh, top, pitch: 3.0, margin: 0.9, blank: i === 1 && barnW > 0,
    win: { w: 0.95, h: 1.3, sill: 0.95, type: 'casement', shutters: R.chance(0.5) ? 'louver' : 'panel', depth: 0.32 },
    ground: 'residential', door: i === 0 ? { bay: 'center', type: 'portone', w: 1.3, h: 2.3, arched: v === 'pietra' } : i === 2 ? { bay: 'left', type: 'single' } : null,
    balconies: i === 0 && R.chance(0.5) ? 'center' : 'none', rail: 'bars', balconyDepth: 0.8,
  }));
  b.pop();
  const roofM = { top: P.roofTile, under: P.wood, edge: P.wood, gable: P.wall, ridge: P.roofTile, gutter: P.gutter };
  gableRoof(b, roofM, { cx: hx, W, D, y: top, pitch: 24, oh: 0.75, rake: 0.4, axis: 'x' });
  chimney(b, { ...P, chimney: P.wall }, hx + W * 0.28, -D * 0.15, top + (D / 2 - D * 0.15) * Math.tan((24 * Math.PI) / 180), 1.2, 0.6, 0.6);
  // ---- barn / fienile with portico on brick pillars
  if (barnW) {
    const bx = hx + W / 2 + barnW / 2, bh = top - 0.4;
    // back wall + side walls (rubble), open front with pillars, hayloft floor
    b.push().translate(bx, 0, 0);
    const n = Math.max(2, Math.round(barnW / 3.2));
    const pw = 0.6;
    for (let i = 0; i <= n; i++) {
      const x = -barnW / 2 + 0.05 + (barnW - 0.1 - pw) * (i / n);
      b.box(brick, x, 0, D / 2 - pw, x + pw, bh, D / 2, SKIP.ny);
    }
    // back and right walls
    b.push().frame(barnW / 2, -D / 2, -1, 0);
    wallWithHoles(b, P.wall, 0, barnW, 0, bh, [{ x0: barnW / 2 - 1.5, x1: barnW / 2 + 1.5, y0: 0, y1: 3.0 }]);
    doorAt(b, P, { x: barnW / 2 - 1.5, w: 3.0, h: 3.0, type: 'barn', depth: 0.3 });
    b.pop();
    b.push().frame(barnW / 2, D / 2, 0, -1);
    wallWithHoles(b, P.wall, 0, D, 0, bh, [{ x0: D / 2 - 0.6, x1: D / 2 + 0.6, y0: bh - 2.2, y1: bh - 1.0 }]);
    b.pop();
    // interior back wall face (visible through the portico) + hayloft with boards
    b.quad(P.wall, [-barnW / 2, 0, -D / 2 + 0.4], [barnW / 2, 0, -D / 2 + 0.4], [barnW / 2, bh, -D / 2 + 0.4], [-barnW / 2, bh, -D / 2 + 0.4]);
    b.quad(P.wall, [barnW / 2 - 0.4, 0, -D / 2], [barnW / 2 - 0.4, 0, D / 2], [barnW / 2 - 0.4, bh, D / 2], [barnW / 2 - 0.4, bh, -D / 2], null, [-1, 0, 0]);
    b.box(M('paving', '#9a8f80', { wear: 2 }), -barnW / 2, 0, -D / 2 + 0.4, barnW / 2 - 0.4, 0.03, D / 2, SKIP.ny);
    b.box(P.wood, -barnW / 2, 3.2, -D / 2 + 0.4, barnW / 2, 3.4, D / 2 - pw, 0);
    const boards = M('woodV', '#8a6a4a', { wear: Math.max(1, ctx.wear), r: 0.85 });
    b.box(boards, -barnW / 2 + 0.6, 3.4, D / 2 - pw - 0.1, barnW / 2 - 0.6, 4.4, D / 2 - pw, 0);
    // hay bales on the loft and on the ground
    const hay = M('stucco', '#d8b86a', { r: 0.95, d: true });
    for (let i = 0; i < Math.floor(barnW / 1.4); i++) b.box(hay, -barnW / 2 + 0.6 + i * 1.3, 3.4, -D / 2 + 0.8, -barnW / 2 + 1.8 + i * 1.3, 3.4 + 0.5 * (1 + (i % 2)), -D / 2 + 2.2, SKIP.ny);
    for (let i = 0; i < 3; i++) b.cyl(hay, -barnW / 4 + i * 1.6, -D / 2 + 1.8, 0.7, 0.7, 0, 1.2, 12, { top: true });
    b.pop();
    gableRoof(b, { ...roofM, gable: P.wall }, { cx: bx, W: barnW, D, y: bh, pitch: 24, oh: 0.75, rake: 0.4, axis: 'x' });
  }
  // farmyard: a cart wheel-less wagon? keep simple: low stone wall + trees are city/exterior props
  return b;
}

// =============================================================== baita di montagna
export function baita(p, b = new Builder()) {
  const ctx = contextOf(p, 14), R = ctx.rand, v = p.variant; // 'tronchi' | 'assi'
  const P = palette(ctx, { wallTex: 'rubble', wallColor: '#b7ad9c', trim: '#7a5634', shutter: R.pick(['#3f5f3a', '#7a1f24', '#5a3b26']), frame: '#5a3b26', door: '#4a2f20', sill: '#7a5634' });
  P.shutter = M('woodV', R.pick(['#3f5f3a', '#7a1f24', '#4f6b3a', '#5a3b26']), { r: 0.7, d: true });
  P.sill = M('woodV', '#6b4a2f', { r: 0.7, d: true });
  const wood = M(v === 'tronchi' ? 'logs' : 'woodV', ctx.main, { wear: ctx.wear, r: 0.75 });
  const W = p.width, D = p.depth;
  const gh = 2.7, fh = 2.6, floors = p.floors, top = gh + (floors - 1) * fh;
  const PW = { ...P, wall: wood, groundWall: P.wall, woodRail: M('woodV', '#6b4a2f', { r: 0.7, d: true }) };
  eachFacade(b, rect(W, D), (e, i) => buildFacade(b, PW, {
    L: e.len, floors, gh, fh, top, pitch: 2.6, margin: 0.8, groundWall: P.wall,
    win: { w: 0.85, h: 1.1, sill: 0.95, type: 'casement', shutters: 'panel', depth: 0.3 },
    ground: 'residential', door: i === 0 ? { bay: 'center', type: 'portone', w: 1.1, h: 2.1 } : null,
    balconies: 'none',
  }));
  // wooden balcony along the gable front at every upper floor
  for (let k = 1; k < floors; k++) {
    const fy = gh + (k - 1) * fh;
    b.push().translate(-W / 2, 0, D / 2);
    b.box(PW.woodRail, -0.4, fy - 0.18, 0, W + 0.4, fy, 1.3, 0);
    // brackets
    for (let i = 0; i <= 3; i++) b.box(PW.woodRail, -0.2 + (W + 0.4) * (i / 3) - 0.08, fy - 0.6, 0, -0.2 + (W + 0.4) * (i / 3) + 0.08, fy - 0.18, 1.1, SKIP.nz);
    railing(b, PW, [[-0.35, 1.25], [W + 0.35, 1.25]], fy, 'wood', { left: [-0.35, 0.02], right: [W + 0.35, 0.02] });
    b.pop();
  }
  // steep roof with big overhangs, stone slabs or shingles
  const roofTop = M(p.roof === 'pietra' ? 'slate' : 'tiles', p.roof === 'pietra' ? '#8a8a86' : '#5a4a3a', { wear: ctx.wear, r: 0.85 });
  gableRoof(b, { top: roofTop, under: M('woodV', '#7a5634', { r: 0.8 }), edge: M('woodV', '#6b4a2f', { r: 0.8 }), gable: wood, ridge: roofTop }, { W, D, y: top, pitch: 36, oh: 1.0, rake: 1.2, axis: 'z', t: 0.3 });
  chimney(b, { ...P, chimney: P.wall, trim: M('stone', '#8a8a86') }, W * 0.25, -D * 0.2, top + (W / 2 - W * 0.25) * Math.tan((36 * Math.PI) / 180), 1.2, 0.7, 0.7);
  // woodpile against the side wall
  const logs = M('logs', '#8a6a4a', { r: 0.85, d: true });
  const wpX = W / 2 + 0.35;
  for (let r = 0; r < 5; r++) for (let i = 0; i < 8; i++) {
    const zc = -D / 3 + i * 0.21 + (r % 2) * 0.1, yc = 0.11 + r * 0.19;
    b.push().translate(wpX, yc, zc).rotateZ(Math.PI / 2);
    b.cyl(logs, 0, 0, 0.1, 0.1, -0.5, 0.5, 6, { top: true, bottom: true });
    b.pop();
  }
  return b;
}

// =============================================================== casa giapponese
export function giapponese(p, b = new Builder()) {
  const ctx = contextOf(p, 15), R = ctx.rand, v = p.variant; // 'minka' | 'machiya'
  const W = p.width, D = p.depth, two = v === 'machiya';
  const dark = M('woodV', R.pick(['#3a2a1e', '#2e2620', '#4a3424']), { r: 0.7, wear: ctx.wear });
  const post = M('woodV', '#3a2a1e', { r: 0.7, d: false });
  const plaster = M('plaster', ctx.main, { wear: ctx.wear, r: 0.9 });
  const shoji = M('shoji', '#ffffff', { r: 0.9 });
  const stone = M('rubble', '#9a958c', { wear: ctx.wear });
  const roofT = M('tiles', R.pick(['#4a4c52', '#55575c', '#3d4046']), { wear: ctx.wear, r: 0.55, m: 0.2 });
  const deck = M('woodV', '#7a5a3a', { wear: ctx.wear, r: 0.7 });
  const fy = 0.55; // raised floor
  const H1 = 2.7, H2 = 2.4;
  // stone base and veranda (engawa)
  b.box(stone, -W / 2, 0, -D / 2, W / 2, fy - 0.12, D / 2, SKIP.ny);
  b.box(deck, -W / 2 - 1.0, fy - 0.12, -D / 2 - 0.4, W / 2 + 1.0, fy, D / 2 + 1.0, 0);
  for (const x of [-W / 2 - 0.9, W / 2 + 0.9]) for (const z of [D / 2 + 0.9, -D / 2 - 0.3]) b.box(post, x - 0.07, 0, z - 0.07, x + 0.07, fy - 0.12, z + 0.07, SKIP.ny);
  // stepping stone
  b.box(stone, -0.6, 0, D / 2 + 1.1, 0.6, 0.25, D / 2 + 1.7, SKIP.ny);
  // walls between posts: shoji on the front/sides at floor 1, plaster on the back and upper parts
  const storey = (y0, h, front) => {
    eachFacade(b, rect(W, D), (e, i) => {
      const L = e.len, n = Math.max(2, Math.round(L / 1.82));
      for (let k = 0; k < n; k++) {
        const x0 = (L * k) / n, x1 = (L * (k + 1)) / n;
        const isShoji = front && i !== 2 && !(i === 0 && k === Math.floor(n / 2) && !two);
        if (isShoji) {
          // shoji panel recessed between posts, transom plaster above
          b.quad(shoji, [x0, y0, -0.05], [x1, y0, -0.05], [x1, y0 + h * 0.78, -0.05], [x0, y0 + h * 0.78, -0.05]);
          b.quad(plaster, [x0, y0 + h * 0.78, 0], [x1, y0 + h * 0.78, 0], [x1, y0 + h, 0], [x0, y0 + h, 0]);
          b.box(dark, x0, y0 + h * 0.78 - 0.06, -0.06, x1, y0 + h * 0.78 + 0.04, 0.02, SKIP.nz);
          b.box(dark, x0, y0, -0.06, x1, y0 + 0.06, 0.0, SKIP.nz);
        } else if (i === 0 && k === Math.floor(n / 2) && !two) {
          // entrance (genkan) with a noren curtain
          b.quad(M('woodV', '#2e2620', { r: 0.8 }), [x0, y0, -0.25], [x1, y0, -0.25], [x1, y0 + h * 0.78, -0.25], [x0, y0 + h * 0.78, -0.25]);
          b.quad(plaster, [x0, y0 + h * 0.78, 0], [x1, y0 + h * 0.78, 0], [x1, y0 + h, 0], [x0, y0 + h, 0]);
          b.box(M(null, R.pick(['#1d3b5c', '#7a1f24', '#2a2d31']), { r: 0.9, side: 'double', d: true }), x0 + 0.1, y0 + h * 0.78 - 0.7, 0.02, x1 - 0.1, y0 + h * 0.78 - 0.02, 0.03, 0);
          for (const s of [x0, x1]) b.quad(plaster, [s, y0, s === x0 ? -0.25 : 0], [s, y0, s === x0 ? 0 : -0.25], [s, y0 + h * 0.78, s === x0 ? 0 : -0.25], [s, y0 + h * 0.78, s === x0 ? -0.25 : 0], null, [s === x0 ? 1 : -1, 0, 0]);
        } else {
          b.quad(plaster, [x0, y0, 0], [x1, y0, 0], [x1, y0 + h, 0], [x0, y0 + h, 0]);
          // small lattice window in plaster walls
          if (R.chance(0.35) && h > 2) {
            const wx = (x0 + x1) / 2;
            b.box(dark, wx - 0.4, y0 + 1.0, 0, wx + 0.4, y0 + 1.06, 0.04, SKIP.nz);
            for (let j = 0; j < 6; j++) b.box(dark, wx - 0.38 + j * 0.15, y0 + 1.06, 0, wx - 0.34 + j * 0.15, y0 + 1.7, 0.04, SKIP.nz | SKIP.ny);
            b.box(dark, wx - 0.4, y0 + 1.7, 0, wx + 0.4, y0 + 1.76, 0.04, SKIP.nz);
          }
        }
        // posts
        b.box(post, x0 - 0.075, y0 - 0.02, -0.08, x0 + 0.075, y0 + h, 0.07, SKIP.ny);
      }
      // beams
      b.box(dark, -0.05, y0 + h - 0.22, -0.06, L + 0.05, y0 + h, 0.09, 0);
    });
  };
  storey(fy, H1, true);
  let top = fy + H1;
  if (two) {
    // pent roof (hisashi) between the floors, upper storey set back slightly
    const M1 = { top: roofT, under: dark, edge: dark, ridge: null };
    eachFacade(b, rect(W, D), (e) => {
      b.quad(M1.top, [-0.6, top - 0.15, 1.1], [e.len + 0.6, top - 0.15, 1.1], [e.len + 0.6, top + 0.35, 0], [-0.6, top + 0.35, 0], null, [0, 1, 0.5]);
      b.quad(M1.under, [-0.6, top - 0.2, 1.1], [e.len + 0.6, top - 0.2, 1.1], [e.len + 0.6, top + 0.3, 0], [-0.6, top + 0.3, 0], null, [0, -1, -0.5]);
      b.box(M1.edge, -0.6, top - 0.28, 1.05, e.len + 0.6, top - 0.12, 1.15, 0);
    });
    storey(top, H2, true);
    top += H2;
  }
  // big hip roof with wide eaves and ridge ornaments (oni-gawara)
  const ry = hipRoof(b, { top: roofT, under: dark, edge: dark, ridge: M('tiles', '#3a3c42', { r: 0.6 }) }, { W: W + 0.2, D: D + 0.2, y: top, pitch: two ? 28 : 34, oh: 1.3, t: 0.3 });
  const alongX = W >= D, r = Math.abs(W - D) / 2;
  for (const s of [-1, 1]) {
    const x = alongX ? s * r : 0, z = alongX ? 0 : s * r;
    b.box(roofT, x - 0.25, ry - 0.1, z - 0.25, x + 0.25, ry + 0.45, z + 0.25, SKIP.ny);
  }
  return b;
}

