// Towers: glass skyscraper, setback ("wedding cake") tower, twisting / oval
// tower, Art Deco tower. Curtain walls are textured quads (mullion grid in the
// texture + real fins / slab edges in geometry) to keep tall buildings light.
import { Builder, M, contextOf, palette, eachFacade, rect } from './common.js';
import { buildFacade, plinth } from '../facade.js';
import { flatRoof } from '../roofs.js';
import { clutter, antenna } from '../rooftop.js';
import { SKIP, inset, edgesOf } from '../kit.js';
import { wallWithHoles, windowAt, doorAt, bays } from '../parts.js';

const FH = 3.8; // office floor-to-floor

/** Curtain-wall material for a floor height (texture tile = 8 modules × 4 floors). */
const cwMat = (ctx, fh, lit) => M('cw', ctx.main, { r: 0.12, m: 0.55, size: [12, 4 * fh], lit, ns: 1 });

/** Footprint of a given shape: 'prisma' (rect), 'smussato' (chamfered), 'ovale' (ellipse-ish). */
function footprint(shape, W, D, seg = 24) {
  if (shape === 'smussato') {
    const c = Math.min(W, D) * 0.18;
    return [[-W / 2 + c, D / 2], [W / 2 - c, D / 2], [W / 2, D / 2 - c], [W / 2, -D / 2 + c], [W / 2 - c, -D / 2], [-W / 2 + c, -D / 2], [-W / 2, -D / 2 + c], [-W / 2, D / 2 - c]];
  }
  if (shape === 'ovale') {
    const pts = [];
    for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pts.push([Math.sin(a) * W / 2, Math.cos(a) * D / 2]); }
    return pts;
  }
  return rect(W, D);
}

/** Curtain wall prism + slab edge lines every `every` floors + vertical fins every `fin` m. */
function glassShaft(b, P, path, y0, floors, fh, cw, { every = 1, fin = 3, finDepth = 0.35 } = {}) {
  const y1 = y0 + floors * fh;
  b.prism(path, y0, y1, { sides: cw });
  // slab edges (light aluminium bands)
  if (every) for (let k = every; k < floors; k += every) b.sweep(P.band, path, [[0, y0 + k * fh - 0.12], [0.06, y0 + k * fh - 0.1], [0.06, y0 + k * fh + 0.1], [0, y0 + k * fh + 0.12]]);
  // vertical fins (detail)
  if (fin) for (const e of edgesOf(path)) {
    const n = Math.max(1, Math.round(e.len / fin));
    b.push().frame(e.x, e.z, e.ux, e.uz);
    for (let i = 0; i <= n; i++) {
      const x = (e.len * i) / n;
      b.box(P.fin, x - 0.05, y0 + 0.2, 0, x + 0.05, y1 - 0.05, finDepth, SKIP.nz | SKIP.ny);
    }
    b.pop();
  }
  return y1;
}

function towerPalette(ctx, R) {
  const P = palette(ctx, { wallTex: 'travertine', wallColor: R.pick(['#d9d3c6', '#cfc8ba', '#e6e1d6', '#bfb7a8']), frame: '#3a3d42', door: '#2a2d31', trim: '#e6e1d6' });
  P.band = M(null, R.pick(['#c9ccd0', '#e8e8e6', '#9aa1a8']), { r: 0.35, m: 0.6 });
  P.fin = M(null, R.pick(['#c9ccd0', '#d8d8d6', '#5d6064']), { r: 0.35, m: 0.6, d: true });
  P.frame = M(null, '#3a3d42', { r: 0.4, m: 0.6, d: true });
  return P;
}

/** Podium (base) with stone cladding, glazed lobby and canopy. */
function podium(b, P, W, D, floors, { lobby = true } = {}) {
  const gh = 5.0, fh = 4.2, top = gh + (floors - 1) * fh;
  eachFacade(b, rect(W, D), (e, i) => buildFacade(b, P, {
    L: e.len, floors, gh, fh, top, pitch: 3.0, margin: 1.2,
    win: { w: 2.2, h: 2.8, sill: 0.6, type: 'modern', depth: 0.3 },
    ground: i === 0 && lobby ? 'lobby' : i === 2 ? 'residential' : 'shops', door: i === 0 ? { canopy: { mat: P.band, depth: 3.0 } } : null,
    groundWin: { w: 2.4, h: 3.4, sill: 0.4, type: 'modern' }, shop: { awning: false, signs: ['BANCA', 'CAFÉ', 'MARKET', 'OTTICA', 'BOUTIQUE'] },
  }));
  return top;
}

// =============================================================== grattacielo in vetro
export function grattacielo(p, b = new Builder()) {
  const ctx = contextOf(p, 21), R = ctx.rand;
  const P = towerPalette(ctx, R);
  const W = p.width, D = p.depth, floors = p.floors, shape = p.shape;
  const cw = cwMat(ctx, FH, ctx.lights > 0);
  // podium
  const pf = 2, pW = W + 6, pD = D + 6;
  const ptop = podium(b, P, pW, pD, pf);
  const ppath = rect(pW, pD);
  flatRoof(b, { wall: P.wall, coping: P.coping, inner: P.wall, roof: M('paving', '#b9b4aa', { wear: ctx.wear }) }, ppath, ptop, { ph: 1.1 });
  plinth(b, P.coping, ppath, 0.12, 0.04);
  // shaft
  const path = footprint(shape, W, D);
  const y1 = glassShaft(b, P, path, ptop, floors - pf, FH, cw, { every: 1, fin: shape === 'ovale' ? 0 : 3 });
  // crown: setback mechanical floors behind a louvered screen + spire
  const cpath = inset(path, 1.5);
  const crownH = 7;
  b.prism(cpath, y1, y1 + crownH, { sides: M('panels', '#c9ccd0', { r: 0.4, m: 0.5, size: [2, 2] }), top: P.roofMembrane });
  b.sweep(P.band, path, [[0, y1 - 0.05], [0.12, y1], [0.12, y1 + 1.1], [-0.2, y1 + 1.1], [-0.2, y1]]);
  b.prism(inset(path, 0.2), y1 - 0.2, y1, { top: P.roofMembrane });
  clutter(b, P, -W / 2 + 1.0, -W / 2 + 1.0 + Math.min(4, W * 0.15), -D / 2 + 1, D / 2 - 1, y1, 'modern', 0.5);
  if (p.spire) {
    b.cyl(P.band, 0, 0, 0.9, 0.5, y1 + crownH, y1 + crownH + 4, 12, { top: true });
    b.cyl(P.band, 0, 0, 0.35, 0.08, y1 + crownH + 4, y1 + crownH + 4 + Math.min(40, floors * 0.8), 8, { top: false });
  } else {
    antenna(b, P, W * 0.2, 0, y1 + crownH, 4, 0);
  }
  return b;
}

// =============================================================== grattacielo a gradoni
export function gradoni(p, b = new Builder()) {
  const ctx = contextOf(p, 22), R = ctx.rand, glass = p.variant === 'vetro';
  const P = towerPalette(ctx, R);
  if (!glass) {
    P.wall = M(R.pick(['brick', 'stone', 'travertine']), ctx.main, { wear: ctx.wear, r: 0.9 });
    P.frame = M(null, '#2a2d31', { r: 0.4, m: 0.5, d: true });
  }
  let W = p.width, D = p.depth;
  const tiers = p.tiers, floors = p.floors, fh = glass ? FH : 3.6;
  const per = [];
  // tier heights: the base tier is the tallest
  let rest = floors;
  for (let t = 0; t < tiers; t++) { const f = t === tiers - 1 ? rest : Math.max(2, Math.round(rest * (t === 0 ? 0.45 : 0.4))); per.push(f); rest -= f; }
  let y = 0;
  const step = Math.max(2.5, Math.min(W, D) * 0.12);
  for (let t = 0; t < tiers; t++) {
    const path = rect(W, D), f = Math.max(1, per[t]);
    if (glass) {
      if (t === 0) {
        // base tier: stone podium floors then glass
        const top = podium(b, P, W, D, 2);
        glassShaft(b, P, path, top, Math.max(1, f - 2), fh, cwMat(ctx, fh, ctx.lights > 0), { every: 1, fin: 3 });
        y = top + Math.max(1, f - 2) * fh;
      } else {
        glassShaft(b, P, path, y, f, fh, cwMat(ctx, fh, ctx.lights > 0), { every: 1, fin: 3 });
        y += f * fh;
      }
    } else {
      b.push().translate(0, y, 0);
      eachFacade(b, path, (e, i) => {
        const n = Math.max(2, Math.round(e.len / 1.7));
        stoneFacade(b, P, e.len, f, fh, n, { door: t === 0 && i === 0, gh: t === 0 ? 5.2 : fh });
      });
      b.pop();
      y += (t === 0 ? 5.2 - fh : 0) + f * fh;
    }
    // terrace parapet on the setback
    const nextW = W - 2 * step, nextD = D - 2 * step;
    if (t < tiers - 1) {
      flatRoof(b, { wall: P.wall, coping: P.coping, inner: P.wall, roof: P.roofMembrane }, path, y, { ph: 1.1 });
      b.sweep(P.coping, path, [[0, y - 0.6], [0.25, y - 0.5], [0.25, y - 0.1], [0, y]]);
    } else {
      flatRoof(b, { wall: P.wall, coping: P.coping, inner: P.wall, roof: P.roofMembrane }, path, y, { ph: 1.2 });
      clutter(b, P, -W / 2 + 0.8, W / 2 - 0.8, -D / 2 + 0.8, D / 2 - 0.8, y, glass ? 'modern' : 'old', 0.8);
      if (p.spire) {
        b.cyl(P.band, 0, 0, 0.6, 0.2, y, y + 3, 8, { top: true });
        b.cyl(P.band, 0, 0, 0.15, 0.03, y + 3, y + 3 + floors * 0.5, 6, { top: false });
      }
    }
    W = nextW; D = nextD;
    if (W < 6 || D < 6) break;
  }
  return b;
}

/** Stone facade with vertical piers, recessed windows and dark spandrels (setback / Art Deco). */
function stoneFacade(b, P, L, floors, fh, n, { door = false, gh = fh, pier = true } = {}) {
  const top = gh + (floors - 1) * fh;
  const cx = bays(L, n, 0.9);
  const pw = (L - 1.8) / n;
  const holes = [], later = [];
  // ground floor: entrance in the middle bays, big windows elsewhere
  for (let i = 0; i < n; i++) {
    if (door && Math.abs(i - (n - 1) / 2) < 1.1) {
      const w = pw - 0.3, x = cx[i] - w / 2, h = gh - 1.0;
      holes.push({ x0: x, x1: x + w, y0: 0, y1: h });
      later.push(() => doorAt(b, P, { x, w, h, type: 'glass', depth: 0.45 }));
      continue;
    }
    const w = pw - 0.5, x = cx[i] - w / 2, y = 0.8, h = gh - 1.8;
    holes.push({ x0: x, x1: x + w, y0: y, y1: y + h });
    later.push(() => windowAt(b, P, { x, y, w, h, type: 'simple', depth: 0.3 }));
  }
  for (let k = 1; k < floors; k++) {
    const fy = gh + (k - 1) * fh;
    for (let i = 0; i < n; i++) {
      const w = pw - (pier ? 0.6 : 0.5), x = cx[i] - w / 2, y = fy + 0.85, h = fh - 1.35;
      holes.push({ x0: x, x1: x + w, y0: y, y1: y + h });
      later.push(() => windowAt(b, P, { x, y, w, h, type: 'simple', depth: 0.28 }));
      if (pier) later.push(() => b.box(P.darkMetal, x, fy - 0.45, -0.06, x + w, y, 0.0, SKIP.nz));
    }
  }
  wallWithHoles(b, P.wall, 0, L, 0, top, holes);
  for (const fn of later) fn();
  if (pier) for (let i = 0; i <= n; i++) {
    const x = i === 0 ? 0.45 : i === n ? L - 0.45 : (cx[i - 1] + cx[i]) / 2;
    b.box(P.trim || P.wall, x - 0.28, gh, 0, x + 0.28, top - 0.1, 0.22, SKIP.nz | SKIP.ny);
  }
}

// =============================================================== torre twist / ovale
export function twist(p, b = new Builder()) {
  const ctx = contextOf(p, 23), R = ctx.rand;
  const P = towerPalette(ctx, R);
  const W = p.width, D = p.depth, floors = p.floors, fh = 3.6;
  const cw = cwMat(ctx, fh, ctx.lights > 0);
  const slab = M('concrete', '#eceae4', { r: 0.6, wear: ctx.wear });
  const lobbyH = 6;
  // lobby (round glass drum)
  b.cyl(M(null, '#9fb3c0', { r: 0.06, m: 0.5 }), 0, 0, Math.min(W, D) * 0.42, Math.min(W, D) * 0.42, 0, lobbyH - 0.4, 24, { top: false });
  let y = lobbyH;
  if (p.variant === 'ovale') {
    // gherkin-like bulging profile: per floor band radius
    for (let k = 0; k < floors; k++) {
      const t = (k + 0.5) / floors, s = 0.62 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.08)) - 0.25 * t * t;
      const t2 = (k + 1.5) / floors, s2 = 0.62 + 0.55 * Math.sin(Math.PI * Math.min(1, t2 * 1.08)) - 0.25 * t2 * t2;
      const rx = (W / 2) * s, rx2 = (W / 2) * Math.max(0.12, s2);
      b.cyl(cw, 0, 0, rx, rx2, y, y + fh - 0.25, 28, { top: false });
      b.cyl(slab, 0, 0, rx2 + 0.08, rx2 + 0.08, y + fh - 0.25, y + fh, 28, { top: k === floors - 1, bottom: k === 0 });
      y += fh;
    }
    b.dome(cw, 0, y, 0, Math.max(1.2, (W / 2) * 0.12), 12, 3);
  } else {
    const total = (p.twist * Math.PI) / 180;
    for (let k = 0; k < floors; k++) {
      const a = (total * k) / floors;
      b.push().translate(0, y, 0).rotateY(a);
      const path = footprint('smussato', W, D);
      b.prism(path, 0, fh - 0.3, { sides: cw });
      b.prism(inset(path, -0.25), fh - 0.3, fh, { sides: slab, top: k === floors - 1 ? P.roofMembrane : null, bottom: slab });
      b.pop();
      y += fh;
    }
    const a = (total * (floors - 1)) / floors;
    b.push().rotateY(a);
    b.prism(inset(footprint('smussato', W, D), 2), y, y + 4, { sides: M('panels', '#c9ccd0', { r: 0.4, m: 0.5 }), top: P.roofMembrane });
    antenna(b, P, 0, 0, y + 4, 6, 0);
    b.pop();
  }
  b.cyl(slab, 0, 0, Math.min(W, D) * 0.45, Math.min(W, D) * 0.45, lobbyH - 0.4, lobbyH, 24, { top: false, bottom: true });
  // forecourt
  b.cyl(M('paving', '#c9c4ba', { wear: ctx.wear }), 0, 0, Math.max(W, D) * 0.75, Math.max(W, D) * 0.75, 0, 0.05, 32, { top: true });
  return b;
}

// =============================================================== art deco
export function artdeco(p, b = new Builder()) {
  const ctx = contextOf(p, 24), R = ctx.rand;
  const P = palette(ctx, { wallTex: R.pick(['travertine', 'stone']), trim: R.pick(['#e6dfd0', '#d9cfbd']), frame: '#2a2d31', door: '#4a3a20' });
  P.darkMetal = M(null, R.pick(['#3b3530', '#2f3b47', '#4a3a28']), { r: 0.5, m: 0.4, d: true });
  P.metal = M(null, '#b8934e', { r: 0.35, m: 0.85, d: true }); // bronze
  P.darkFrame = P.metal;
  P.trim = M(P.wall.tex, ctx.main, { k: 1.06, wear: ctx.wear, r: 0.85 });
  const W = p.width, D = p.depth, floors = p.floors, fh = 3.5, gh = 5.6;
  // main shaft
  const f1 = Math.max(4, Math.round(floors * 0.7)), f2 = Math.max(2, Math.round(floors * 0.18)), f3 = Math.max(1, floors - f1 - f2);
  const tiers = [[W, D, f1], [W - 5, D - 5, f2], [W - 9, D - 9, f3]];
  let y = 0;
  tiers.forEach(([tw, td, tf], t) => {
    if (tw < 5 || td < 5) return;
    const path = rect(tw, td);
    b.push().translate(0, y, 0);
    eachFacade(b, path, (e, i) => {
      const n = Math.max(2, Math.round(e.len / 2.2));
      if (P.party && t === 0 && (i === 1 || i === 3)) wallWithHoles(b, P.wall, 0, e.len, 0, gh + (tf - 1) * fh, []);
      else stoneFacade(b, P, e.len, tf, fh, n, { door: t === 0 && i === 0, gh: t === 0 ? gh : fh });
    });
    b.pop();
    y += (t === 0 ? gh - fh : 0) + tf * fh;
    // stepped parapet / zigzag-like setbacks
    b.sweep(P.trim, path, [[0, y], [0.2, y + 0.1], [0.2, y + 0.5], [0.05, y + 0.6], [0.05, y + 1.1], [0.25, y + 1.2], [0.25, y + 1.4], [-0.3, y + 1.4], [-0.3, y]]);
    b.prism(inset(path, 0.3), y - 0.1, y + 0.05, { top: P.roofMembrane });
    // corner finials
    for (const [cx, cz] of path) b.box(P.trim, cx - (cx > 0 ? 1.2 : 0), y, cz - (cz > 0 ? 1.2 : 0), cx + (cx > 0 ? 0 : 1.2), y + 2.4, cz + (cz > 0 ? 0 : 1.2), SKIP.ny);
  });
  // ziggurat crown + spire
  const cw0 = Math.max(4, W - 12), cd0 = Math.max(4, D - 12);
  for (let k = 0; k < 4; k++) {
    const s = 1 - k * 0.22;
    b.box(P.trim, -cw0 * s / 2, y + k * 1.6, -cd0 * s / 2, cw0 * s / 2, y + (k + 1) * 1.6, cd0 * s / 2, SKIP.ny);
    b.box(P.metal, -cw0 * s / 2 - 0.05, y + (k + 1) * 1.6 - 0.25, -cd0 * s / 2 - 0.05, cw0 * s / 2 + 0.05, y + (k + 1) * 1.6 - 0.1, cd0 * s / 2 + 0.05, 0);
  }
  b.cyl(P.metal, 0, 0, 0.5, 0.05, y + 6.4, y + 6.4 + Math.max(8, floors * 0.6), 8, { top: false });
  // bronze canopy & lamps at the entrance
  b.box(P.metal, -3.5, gh - 1.0, D / 2, 3.5, gh - 0.8, D / 2 + 2.2, 0);
  plinth(b, M('stone', '#3d3a36', { wear: ctx.wear }), rect(W, D), 0.15, 0.06);
  return b;
}

