// Urban styles: 1960s apartment block, modern condominium, historic European
// palazzo (neoclassical / liberty / Parisian), shop, bar-restaurant with dehors.
import { Builder, M, contextOf, palette, boxFacades, rect, bush, eachFacade } from './common.js';
import { bands, cornice, plinth, buildFacade, floorY } from '../facade.js';
import { flatRoof, hipRoof, gableRoof, mansardRoof } from '../roofs.js';
import { clutter, chimney, antenna } from '../rooftop.js';
import { SKIP, inset, orient } from '../kit.js';
import { bays, railing, shopfront, doorAt, downpipes } from '../parts.js';

/** Stacked corner stones (quoins) on every corner of a footprint between y0 and y1. */
export function quoins(b, d, path, y0, y1, h = 0.32) {
  const P = orient(path), n = P.length;
  for (let i = 0; i < n; i++) {
    const [x, z] = P[i], [ax, az] = P[(i - 1 + n) % n], [bx, bz] = P[(i + 1) % n];
    const la = Math.hypot(ax - x, az - z), lb = Math.hypot(bx - x, bz - z);
    const ua = [(ax - x) / la, (az - z) / la], ub = [(bx - x) / lb, (bz - z) / lb];
    let k = 0;
    for (let y = y0; y + h <= y1 + 1e-6; y += h, k++) {
      const wa = k % 2 ? 0.38 : 0.62, wb = k % 2 ? 0.62 : 0.38, t = 0.035;
      // two slabs hugging the corner (outward = away from the other edge direction)
      const nA = [-ub[0], -ub[1]], nB = [-ua[0], -ua[1]];
      b.quad(d, [x + ua[0] * wa + nA[0] * t, y + 0.01, z + ua[1] * wa + nA[1] * t], [x + nA[0] * t + nB[0] * t, y + 0.01, z + nA[1] * t + nB[1] * t], [x + nA[0] * t + nB[0] * t, y + h - 0.01, z + nA[1] * t + nB[1] * t], [x + ua[0] * wa + nA[0] * t, y + h - 0.01, z + ua[1] * wa + nA[1] * t], null, [nA[0], 0, nA[1]]);
      b.quad(d, [x + nA[0] * t + nB[0] * t, y + 0.01, z + nA[1] * t + nB[1] * t], [x + ub[0] * wb + nB[0] * t, y + 0.01, z + ub[1] * wb + nB[1] * t], [x + ub[0] * wb + nB[0] * t, y + h - 0.01, z + ub[1] * wb + nB[1] * t], [x + nA[0] * t + nB[0] * t, y + h - 0.01, z + nA[1] * t + nB[1] * t], null, [nB[0], 0, nB[1]]);
      // returns (end faces)
      b.quad(d, [x + ua[0] * wa, y + 0.01, z + ua[1] * wa], [x + ua[0] * wa + nA[0] * t, y + 0.01, z + ua[1] * wa + nA[1] * t], [x + ua[0] * wa + nA[0] * t, y + h - 0.01, z + ua[1] * wa + nA[1] * t], [x + ua[0] * wa, y + h - 0.01, z + ua[1] * wa], null, [ua[0], 0, ua[1]]);
      b.quad(d, [x + ub[0] * wb + nB[0] * t, y + 0.01, z + ub[1] * wb + nB[1] * t], [x + ub[0] * wb, y + 0.01, z + ub[1] * wb], [x + ub[0] * wb, y + h - 0.01, z + ub[1] * wb], [x + ub[0] * wb + nB[0] * t, y + h - 0.01, z + ub[1] * wb + nB[1] * t], null, [ub[0], 0, ub[1]]);
      b.quad(d, [x + ua[0] * wa + nA[0] * t, y + h - 0.01, z + ua[1] * wa + nA[1] * t], [x + nA[0] * t + nB[0] * t, y + h - 0.01, z + nA[1] * t + nB[1] * t], [x + ub[0] * wb + nB[0] * t, y + h - 0.01, z + ub[1] * wb + nB[1] * t], [x, y + h - 0.01, z], null, [0, 1, 0]);
    }
  }
}

/** Pitched or flat roof for a rectangular W × D block at height top. */
function roofFor(b, P, kind, W, D, top, R, { clutterKind = 'old', pitch = 24, oh = 0.6, tex = null } = {}) {
  const path = rect(W, D);
  if (kind === 'piano') {
    flatRoof(b, { wall: P.wall, coping: P.coping, inner: P.wall, roof: P.roofMembrane }, path, top, { ph: 0.95 });
    clutter(b, P, -W / 2 + 0.5, W / 2 - 0.5, -D / 2 + 0.5, D / 2 - 0.5, top, clutterKind, 1);
    return top + 1;
  }
  const M2 = { top: tex || P.roofTile, under: P.soffit, edge: P.fascia, gable: P.wall, ridge: tex || P.roofTile, gutter: P.gutter };
  const ry = kind === 'falde2' ? gableRoof(b, M2, { W, D, y: top, pitch, oh, rake: 0.45 }) : hipRoof(b, M2, { W, D, y: top, pitch, oh });
  // chimneys and antennas through the slopes
  const n = Math.max(1, Math.round(W / 8));
  for (let i = 0; i < n; i++) {
    const x = -W / 2 + (W * (i + 0.5)) / n + R.range(-1, 1), z = R.range(-D / 4, D / 4);
    const yRoof = top + (Math.min(D / 2 - Math.abs(z), W / 2 - Math.abs(x))) * Math.tan((pitch * Math.PI) / 180);
    chimney(b, P, x, z, yRoof, R.range(0.9, 1.4), 0.55, 0.45);
    if (R.chance(0.8)) antenna(b, P, x + 0.6, z + 0.3, yRoof - 0.2, R.range(2.2, 3.4), R.range(0, 3));
  }
  return ry;
}

// =============================================================== palazzina anni '60
export function palazzina60(p, b = new Builder()) {
  const ctx = contextOf(p, 1), R = ctx.rand, v = p.variant;
  const P = palette(ctx, {
    wallTex: v === 'b' ? 'klinker' : v === 'c' ? 'brick' : 'plaster',
    rolling: R.pick(['#d6d2c8', '#8a6a4a', '#6f7a84', '#e4dfd2', '#5a4a3a']),
    frame: R.pick(['#f2f0ea', '#9aa0a6', '#6b4a2f']),
    door: '#3b3d42',
    trim: v === 'c' ? '#e9e4d8' : R.pick(['#efe9dd', '#e2ddd2', '#d9d2c2']),
    ac: 0.08 + ctx.wear * 0.07, plants: 0.45,
  });
  if (v !== 'a') P.parapet = M('concrete', '#e6e2d8', { wear: ctx.wear });
  const W = p.width, D = p.depth, floors = p.floors, shops = p.shops;
  const gh = shops ? 4.0 : 3.3, fh = 3.0, top = gh + (floors - 1) * fh;
  const balc = p.balc === 'none' ? 'none' : p.balc === 'all' ? (v === 'a' ? 'continuous' : 'all') : 'alternate';
  P.groundWall = shops ? M('travertine', '#e2dccd', { wear: ctx.wear }) : null;
  const F = {
    floors, gh, fh, top, pitch: 3.1, margin: 1.0,
    win: { w: 1.25, h: 1.45, sill: 0.9, type: 'casement', shutters: 'rolling', depth: 0.18 },
    ground: shops ? 'shops' : 'residential', groundWall: P.groundWall,
    door: { bay: 'center', type: 'glass', w: 1.7, h: shops ? 3.0 : 2.6, canopy: { mat: P.slab, depth: 1.3 } },
    balconies: balc, rail: v === 'a' ? 'bars' : 'solid', balconyDepth: 1.2,
  };
  const path = boxFacades(b, P, W, D, F, { side: { pitch: 3.8, balconies: 'none' }, back: { balconies: balc === 'none' ? 'none' : 'all', rail: 'bars' } });
  const levels = [];
  for (let k = 1; k < floors; k++) levels.push(floorY(F, k) - 0.22);
  if (v !== 'b') bands(b, P.trim, path, levels, { out: 0.04, h: 0.18 });
  plinth(b, P.coping, path, 0.12, 0.04);
  if (p.roof !== 'piano') downpipes(b, P, W, D, top);
  roofFor(b, P, p.roof, W, D, top, R, { clutterKind: 'old', pitch: 22 });
  return b;
}

// =============================================================== condominio moderno
export function condominio(p, b = new Builder()) {
  const ctx = contextOf(p, 2), R = ctx.rand, v = p.variant;
  const P = palette(ctx, {
    wallTex: v === 'c' ? 'brick' : 'plaster',
    frame: v === 'b' ? '#2a2d31' : R.pick(['#3b3d42', '#6f7174', '#f1efea']),
    trim: v === 'b' ? '#4a4c50' : '#f1efea', rolling: '#5d6064', metal: '#2b2d31',
    ac: 0.04 + ctx.wear * 0.04, plants: 0.5,
  });
  P.parapet = P.railGlass;
  P.slab = M('concrete', v === 'b' ? '#bdbab4' : '#ece9e2', { wear: ctx.wear, r: 0.8 });
  P.accent = M('wood', R.pick(['#a0703f', '#8a5a3b', '#b78a5a']), { wear: ctx.wear, r: 0.7 });
  const W = p.width, D = p.depth, floors = p.floors, attic = p.attic;
  const gh = 4.2, fh = 3.1;
  const body = attic ? floors - 1 : floors;
  const top = gh + (body - 1) * fh;
  const F = {
    floors: body, gh, fh, top, pitch: 3.6, margin: 1.4,
    win: { w: 2.2, h: 2.3, sill: 0.25, type: 'modern', shutters: null, depth: 0.22 },
    ground: p.shops ? 'shops' : 'lobby', groundWall: M('travertine', '#d8d2c4', { wear: ctx.wear }),
    door: { canopy: { mat: P.slab, depth: 2.0 } },
    balconies: p.balc === 'none' ? 'none' : p.balc === 'all' ? 'all' : 'alternate', rail: 'glass', balconyDepth: 1.8,
    shop: { awning: false },
  };
  F.winFor = (k, i, n) => (p.balc !== 'none' && (i + k) % 2 === 0 ? { balconyW: 3.4 } : {});
  const path = boxFacades(b, P, W, D, F, { side: { pitch: 4.2, win: { w: 1.4, h: 1.6, sill: 0.8, type: 'modern' }, balconies: 'none' }, back: {} });
  // slab edges as crisp bands, vertical wood-clad fins between bays on the front
  const levels = [];
  for (let k = 1; k <= body; k++) levels.push(floorY(F, k) - 0.3);
  bands(b, P.slab, path, levels, { out: 0.06, h: 0.32 });
  b.push().translate(-W / 2, 0, D / 2);
  const nb = Math.max(1, Math.round((W - 2.8) / 3.6));
  const xs = bays(W, nb, 1.4);
  for (let i = 0; i <= nb; i++) {
    if (i % 2) continue;
    const x = i === 0 ? xs[0] - (xs[1] - xs[0] || 3.6) / 2 : i === nb ? xs[nb - 1] + (xs[1] - xs[0] || 3.6) / 2 : (xs[i - 1] + xs[i]) / 2;
    b.box(P.accent, x - 0.3, gh, 0, x + 0.3, top - 0.3, 0.12, SKIP.nz);
  }
  b.pop();
  plinth(b, P.coping, path, 0.12, 0.03);
  let roofY = top;
  if (attic) {
    // set-back penthouse with a terrace (glass railing on the main roof)
    const aw = W - 3.2, ad = D - 3.2, ah = 3.1;
    flatRoof(b, { wall: P.wall, coping: P.coping, inner: P.wall, roof: M('paving', '#c9c4ba', { wear: ctx.wear }) }, path, top, { ph: 0.0, coping: true });
    railing(b, P, orient(inset(path, 0.15)).concat([orient(inset(path, 0.15))[0]]).map(([x, z]) => [x, z]), top, 'glass');
    b.push().translate(0, 0, -0.6);
    const ap = rect(aw, ad);
    const AF = { floors: 1, gh: ah, fh: ah, top: ah, pitch: 3.0, margin: 0.8, win: { w: 2.4, h: 2.4, sill: 0.15, type: 'modern', depth: 0.15 }, ground: 'residential' };
    b.push().translate(0, top, 0);
    boxFacades(b, P, aw, ad, AF, { side: { win: { w: 1.6, h: 2.2, sill: 0.3, type: 'modern' } } });
    roofY = flatRoof(b, { wall: P.wall, coping: P.coping, inner: P.wall, roof: P.roofMembrane }, ap, ah, { ph: 0.5 });
    clutter(b, P, -aw / 2 + 0.4, aw / 2 - 0.4, -ad / 2 + 0.4, ad / 2 - 0.4, ah, 'modern', 1);
    // pergola slab overhang
    b.box(P.slab, -aw / 2 - 0.2, ah + 0.5, ad / 2, aw / 2 + 0.2, ah + 0.7, ad / 2 + 1.4, 0);
    b.pop();
    b.pop();
  } else {
    flatRoof(b, { wall: P.wall, coping: P.coping, inner: P.wall, roof: P.roofMembrane }, path, top, { ph: 1.0 });
    clutter(b, P, -W / 2 + 0.6, W / 2 - 0.6, -D / 2 + 0.6, D / 2 - 0.6, top, 'modern', 1);
  }
  void roofY;
  return b;
}

// =============================================================== palazzo storico
export function storico(p, b = new Builder()) {
  const ctx = contextOf(p, 3), R = ctx.rand, v = p.variant; // 'neo' | 'liberty' | 'parigi'
  const paris = v === 'parigi', liberty = v === 'liberty';
  const P = palette(ctx, {
    wallTex: paris ? 'stone' : 'plaster',
    trim: paris ? '#e9e2d2' : R.pick(['#efe8da', '#e8dfcc', '#f3ede2']),
    trimTex: paris ? 'stone' : 'plaster',
    shutter: paris ? '#d6d0c4' : undefined,
    frame: paris ? '#efece4' : R.pick(['#f2efe8', '#5a3b26', '#3f5f3a']),
    door: R.pick(['#3a2a1e', '#1f3d2a', '#2f3b47', '#5a3b26']), metal: '#1f2124',
    roof: paris ? '#5d6670' : undefined,
  });
  P.groundWall = M(paris ? 'stone' : 'bugnato', paris ? ctx.main : R.pick(['#d8cfbd', '#cfc2a6', '#e0d8c6']), { wear: ctx.wear, k: paris ? 0.97 : 1 });
  P.slab = P.trim;
  const W = p.width, D = p.depth, floors = p.floors;
  const gh = 4.6, fh = 3.7, top = gh + (floors - 1) * fh;
  const shopG = p.shops;
  const F = {
    floors, gh, fh, top, pitch: 3.4, margin: 1.5,
    win: { w: 1.25, h: 2.1, sill: 0.75, type: 'casement', shutters: paris ? null : 'louver', depth: 0.32 },
    ground: shopG ? 'shops' : 'residential', groundWall: P.groundWall,
    groundWin: { type: 'arched', w: 1.3, h: 2.6, sill: 1.1, grille: true, surround: null, shutters: null },
    door: { bay: 'center', type: 'portone', w: 2.2, h: 3.9, arched: true },
    balconies: paris ? 'continuous' : 'center', rail: paris || liberty ? 'bars' : 'balusters', consoles: true, balconyDepth: paris ? 0.7 : 1.0,
    balconyFloors: paris ? (k) => k === 1 || k === floors - 1 : (k) => k === 1,
    shop: { awning: R.chance(0.6) ? undefined : false },
  };
  F.winFor = (k, i, n) => {
    if (k === 0) return {};
    if (paris) return { type: 'casement', h: k === floors - 1 ? 1.9 : 2.3, sill: 0.4, surround: k === 1 ? 'cornice' : 'band', balcony: k === 1 || k === floors - 1 ? undefined : false };
    if (k === 1) return { h: 2.35, w: 1.3, sill: 0.6, surround: liberty ? 'segment' : i % 2 ? 'segment' : 'pediment' };
    if (k === floors - 1 && floors > 3) return liberty ? { type: 'arched', h: 1.8, w: 1.1, sill: 0.8, shutters: null } : { h: 1.35, w: 1.05, sill: 0.9, surround: 'band' };
    return { h: 2.0, surround: 'cornice' };
  };
  const path = boxFacades(b, P, W, D, F, { side: { pitch: 3.6, balconies: 'none', ground: 'residential', groundWin: { type: 'casement', w: 1.1, h: 1.6, sill: 1.4, grille: true } }, back: { balconies: 'none', ground: 'residential', door: null } });
  // string courses: over the ground floor (heavy) and under the piano nobile sills
  b.sweep(P.trim, path, [[0, gh - 0.05], [0.14, gh], [0.14, gh + 0.22], [0.06, gh + 0.28], [0, gh + 0.3]]);
  const lv = [];
  for (let k = 2; k < floors; k++) lv.push(floorY(F, k) + 0.45);
  bands(b, P.trim, path, lv, { out: 0.06, h: 0.16 });
  if (!paris) quoins(b, P.trim, path, gh + 0.3, top - 0.05);
  plinth(b, P.coping, path, 0.15, 0.06);
  const ct = cornice(b, P.trim, path, top, paris ? 1.0 : 1.25, { modillions: !paris });
  if (paris) {
    // Haussmann: zinc mansard with dormers over every second bay
    const slate = M('seam', '#6d767f', { wear: ctx.wear, r: 0.45, m: 0.5 });
    const dorm = [];
    const nb = Math.max(1, Math.round((W - 3) / 3.4)), xs = bays(W, nb, 1.5);
    for (const x of xs) dorm.push({ side: 'front', x }, { side: 'back', x });
    mansardRoof(b, { slate, top: slate, edge: P.trim, ridge: slate, dormer: P.trim }, { W, D, y: ct, hm: 3.2, inset: 1.1, dormers: dorm }, P);
    for (let i = 0; i < Math.max(2, Math.round(W / 6)); i++) chimney(b, { ...P, chimney: M('brick', '#b5643f', { wear: ctx.wear }) }, -W / 2 + 1.5 + i * ((W - 3) / Math.max(1, Math.round(W / 6) - 1)), R.chance(0.5) ? -D / 2 + 1.1 : D / 2 - 1.1, ct + 3.0, 1.6, 0.6, 1.4);
  } else if (p.roof === 'piano') {
    flatRoof(b, { wall: P.trim, coping: P.coping, inner: P.wall, roof: P.roofMembrane }, inset(path, -0.0), ct, { ph: 0.7 });
    clutter(b, P, -W / 2 + 0.8, W / 2 - 0.8, -D / 2 + 0.8, D / 2 - 0.8, ct, 'old', 1);
  } else {
    roofFor(b, P, 'falde', W, D, ct, R, { pitch: 24, oh: 0.2 });
  }
  return b;
}

// =============================================================== negozio con vetrina
export function negozio(p, b = new Builder()) {
  const ctx = contextOf(p, 4), R = ctx.rand, v = p.variant; // 'bottega' | 'moderno' | 'market'
  const P = palette(ctx, {
    wallTex: v === 'moderno' ? 'plaster' : R.pick(['plaster', 'plaster', 'brick']),
    trim: '#ece6d8', door: '#3a2a1e',
  });
  const W = p.width, D = p.depth, floors = p.floors;
  const gh = 4.2, fh = 3.1, top = gh + (floors - 1) * fh;
  const path = rect(W, D);
  const frameMat = v === 'bottega' ? M('woodV', R.pick(['#3f5f3a', '#5a3b26', '#7a1f24', '#1d3b5c']), { r: 0.55 })
    : v === 'market' ? M(null, '#c9ccd0', { r: 0.4, m: 0.6, d: true }) : M(null, '#2a2d31', { r: 0.4, m: 0.6, d: true });
  const shut = R.pick(['louver', 'rolling', null]);
  const balc = floors > 1 && R.chance(0.6) ? 'center' : 'none';
  eachFacade(b, path, (e, i) => {
    const L = e.len;
    if (i === 0) {
      const sw = floors > 1 ? L - 2.4 : L - 1.0, sx = 0.5, sh = 3.2, doorX = sx + sw + 0.3;
      const holes = [{ x0: sx, x1: sx + sw, y0: 0, y1: sh }];
      if (floors > 1) holes.push({ x0: doorX, x1: doorX + 1.1, y0: 0, y1: 2.5 });
      buildFacade(b, P, {
        L, floors, gh, fh, top, pitch: 3.2, margin: 0.9, ground: 'none', holes,
        win: { w: 1.2, h: 1.5, sill: 0.9, type: 'casement', shutters: shut, depth: 0.2 }, balconies: balc, rail: 'bars',
      });
      shopfront(b, { ...P, darkFrame: frameMat }, { x: sx, w: sw, h: sh, sign: p.sign || undefined, awning: v === 'moderno' ? null : P.awning, frameMat, riserMat: v === 'bottega' ? frameMat : P.trim, awningDepth: 1.6 });
      if (v === 'bottega') {
        for (const x of [sx - 0.3, sx + sw]) b.box(frameMat, x, 0, 0, x + 0.3, sh + 0.95, 0.12, SKIP.nz);
        b.box(frameMat, sx - 0.4, sh + 0.85, 0, sx + sw + 0.4, sh + 1.05, 0.2, SKIP.nz);
      }
      if (floors > 1) doorAt(b, P, { x: doorX, w: 1.1, h: 2.5, type: 'single' });
    } else {
      buildFacade(b, P, {
        L, floors, gh, fh, top, pitch: 3.6, margin: 1.0, win: { w: 1.0, h: 1.4, sill: 1.0, type: 'casement', shutters: shut || 'louver' },
        ground: i === 2 ? 'residential' : 'blank', door: i === 2 ? { bay: 'center', type: 'single' } : null, blank: i !== 2 && (floors === 1 || P.party),
      });
    }
  });
  plinth(b, P.coping, path, 0.12, 0.03);
  if (p.roof === 'piano' || floors === 1) {
    flatRoof(b, { wall: P.wall, coping: P.coping, inner: P.wall, roof: P.roofMembrane }, path, top, { ph: 0.6 });
    clutter(b, P, -W / 2 + 0.5, W / 2 - 0.5, -D / 2 + 0.5, D / 2 - 0.5, top, 'mixed', 0.7);
  } else {
    cornice(b, P.trim, path, top, 0.6);
    roofFor(b, P, 'falde2', W, D, top + 0.35, R, { pitch: 26, oh: 0.45 });
  }
  return b;
}

// =============================================================== bar / ristorante con dehors
export function bar(p, b = new Builder()) {
  const ctx = contextOf(p, 5), R = ctx.rand;
  const P = palette(ctx, { wallTex: R.pick(['plaster', 'plaster', 'stucco']), trim: '#efe9dd' });
  const W = p.width, D = p.depth, floors = p.floors;
  const gh = 4.2, fh = 3.1, top = gh + (floors - 1) * fh;
  const F = {
    floors, gh, fh, top, pitch: 3.2, margin: 1.0,
    win: { w: 1.15, h: 1.5, sill: 0.9, type: 'casement', shutters: 'louver', depth: 0.22 },
    ground: 'shops', door: floors > 1 ? { bay: 'right', type: 'single', w: 1.1, h: 2.5 } : null,
    shop: { signs: [p.sign || R.pick(['BAR', 'CAFFÈ', 'RISTORANTE', 'TRATTORIA', 'PIZZERIA', 'BIRRERIA'])], awning: P.awning },
    balconies: floors > 1 ? 'some' : 'none', rail: 'bars',
  };
  const path = boxFacades(b, P, W, D, F, { side: { pitch: 3.8 }, back: {} });
  plinth(b, P.coping, path, 0.12, 0.03);
  if (floors > 1) bands(b, P.trim, path, [gh - 0.1], { out: 0.06, h: 0.2 });
  if (p.roof === 'piano') {
    flatRoof(b, { wall: P.wall, coping: P.coping, inner: P.wall, roof: P.roofMembrane }, path, top, { ph: 0.8 });
    clutter(b, P, -W / 2 + 0.5, W / 2 - 0.5, -D / 2 + 0.5, D / 2 - 0.5, top, 'old', 0.8);
  } else {
    cornice(b, P.trim, path, top, 0.7);
    roofFor(b, P, 'falde', W, D, top + 0.4, R, { pitch: 24, oh: 0.3 });
  }
  // ---- dehors: wooden deck, planters, tables, chairs, umbrellas
  if (p.dehors) dehors(b, P, R, W, D / 2, p.umbrellas);
  return b;
}

/** Outdoor seating area in front of a facade at z = zf (spans x in [-W/2, W/2]). */
export function dehors(b, P, R, W, zf, umbrellas = true) {
  const deck = M('woodV', '#8a6a4a', { r: 0.75, wear: P.wear });
  const dw = Math.min(W - 0.6, Math.max(4, W * 0.8)), dd = 3.2, z0 = zf + 0.5, x0 = -dw / 2;
  b.box(deck, x0, 0, z0, x0 + dw, 0.12, z0 + dd, SKIP.ny);
  // planters along the front and the sides
  const planter = M(null, R.pick(['#3b3b40', '#6b4a2f', '#e8e4dc']), { r: 0.6, d: true });
  for (let x = x0 + 0.1; x + 0.9 <= x0 + dw; x += 1.0) {
    b.box(planter, x, 0.12, z0 + dd - 0.45, x + 0.9, 0.62, z0 + dd - 0.05, SKIP.ny);
    b.dome(P.plant, x + 0.45, 0.6, z0 + dd - 0.25, 0.32, 7, 2, 0.9);
  }
  const tableM = M(null, '#e9e6df', { r: 0.4, m: 0.3, d: true }), chairM = M(null, R.pick(['#2b2d31', '#7a1f24', '#1f5c3a', '#c9a227']), { r: 0.5, m: 0.3, d: true });
  const umb = M(null, R.pick(['#f2efe8', '#7a1f24', '#2f4a6b', '#e8dcc4']), { r: 0.85, side: 'double', d: true });
  const nT = Math.max(1, Math.floor(dw / 1.9));
  for (let i = 0; i < nT; i++) {
    const tx = x0 + (dw * (i + 0.5)) / nT, tz = z0 + dd * 0.45 + (i % 2 ? 0.25 : -0.1);
    // round bistro table
    b.cyl(tableM, tx, tz, 0.035, 0.035, 0.12, 0.84, 6, { top: false });
    b.cyl(tableM, tx, tz, 0.3, 0.3, 0.84, 0.87, 14, { top: true, bottom: true });
    b.cyl(tableM, tx, tz, 0.22, 0.22, 0.12, 0.14, 10, { top: true });
    // chairs facing the table
    for (const a of [Math.PI / 2, -Math.PI / 2, ...(R.chance(0.5) ? [0] : [])]) {
      const cx = tx + Math.sin(a) * 0.6, cz = tz + Math.cos(a) * 0.6;
      b.push().translate(cx, 0.12, cz).rotateY(a + Math.PI);
      b.box(chairM, -0.21, 0.43, -0.2, 0.21, 0.47, 0.2, 0);
      for (const [lx, lz] of [[-0.18, -0.17], [0.18, -0.17], [-0.18, 0.17], [0.18, 0.17]]) b.box(chairM, lx - 0.015, 0, lz - 0.015, lx + 0.015, 0.43, lz + 0.015, SKIP.ny);
      b.box(chairM, -0.21, 0.47, 0.17, 0.21, 0.88, 0.2, 0);
      b.pop();
    }
    if (umbrellas && i % 2 === 0) {
      b.cyl(P.metal, tx, tz, 0.02, 0.02, 0.87, 2.35, 6, { top: false });
      b.cyl(umb, tx, tz, 1.25, 0.04, 2.0, 2.45, 8, { top: false, bottom: false, smooth: false });
      b.cyl(umb, tx, tz, 1.25, 1.25, 1.88, 2.0, 8, { top: false, bottom: false, smooth: false });
    }
  }
  void bush;
}

