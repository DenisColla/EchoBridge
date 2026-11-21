// Facade composer: turns a compact description (floors, bays, window kind,
// ground floor use, balconies…) into a wall with openings and all its parts,
// in the facade frame (x along the wall, y up, +z out). Used by most styles.
import { wallWithHoles, windowAt, doorAt, shopfront, balcony, bays, bayCount, archOpening } from './parts.js';
import { SKIP, orient } from './kit.js';

/** Floor level (m) of storey k (0 = ground). */
export const floorY = (F, k) => (k === 0 ? 0 : F.gh + (k - 1) * F.fh);

/**
 * F = {
 *   L, floors, gh, fh, top,                   // geometry (top = wall top)
 *   pitch (bay pitch, m) | bays, margin,
 *   win: {w, h, sill, type, shutters, surround, depth, grille},
 *   winFor(k, i, n) -> partial window override (per floor / bay), or null for a blank bay,
 *   ground: 'residential'|'shops'|'lobby'|'portico'|'blank'|'garage'|'none',
 *   door: {bay ('center'|'left'|'right'|index), w, h, type, arched, surround, steps, canopy},
 *   shop: {awning, signs[]},
 *   balconies: 'none'|'some'|'all'|'continuous'|'alternate'|'french', rail, balconyDepth, consoles,
 *   balconyFloors: (k) -> bool,
 *   groundWall: descriptor for the ground floor band (bugnato, stone…), blank: no openings at all
 * }
 */
export function buildFacade(b, P, F) {
  const L = F.L, R = P.rand;
  const top = F.top ?? floorY(F, F.floors);
  const margin = F.margin ?? Math.min(1.2, L * 0.12);
  if (F.blank || L < 1.2) {
    wallWithHoles(b, F.groundWall || P.wall, 0, L, 0, Math.min(top, F.gh), []);
    if (top > F.gh) wallWithHoles(b, P.wall, 0, L, F.gh, top, []);
    return;
  }
  const n = F.bays ?? bayCount(L - 2 * margin, F.pitch ?? 3.2);
  const cx = bays(L, n, margin);
  const holes = F.holes ? [...F.holes] : [], later = [];
  const W = F.win || {};
  // ---------------------------------------------------------- ground floor
  const g = F.ground || 'residential';
  let doorBay = -1;
  if (F.door && g !== 'blank' && g !== 'none') {
    const pos = F.door.bay ?? 'center';
    doorBay = pos === 'center' ? Math.floor((n - 1) / 2 + (n % 2 ? 0 : R.int(0, 1))) : pos === 'left' ? 0 : pos === 'right' ? n - 1 : Math.max(0, Math.min(n - 1, pos | 0));
  }
  const pitchW = n > 1 ? cx[1] - cx[0] : L - 2 * margin;
  if (g === 'shops') {
    // shops take groups of 1-2 bays; the residential door keeps its bay
    let i = 0, si = 0;
    while (i < n) {
      if (i === doorBay) {
        const D = F.door;
        const dw = Math.min(D.w ?? 1.4, pitchW - 0.5), dh = Math.min(D.h ?? 2.9, F.gh - 0.4);
        const x = cx[i] - dw / 2;
        holes.push({ x0: x, x1: x + dw, y0: 0, y1: dh });
        later.push(() => doorAt(b, P, { x, w: dw, h: dh, type: D.type || 'portone', arched: D.arched, surround: D.surround, canopy: D.canopy }));
        i++; continue;
      }
      const span = i + 1 < n && i + 1 !== doorBay && R.chance(0.55) ? 2 : 1;
      const x0 = cx[i] - pitchW / 2 + 0.3, x1 = cx[i + span - 1] + pitchW / 2 - 0.3, h = Math.min(3.1, F.gh - 0.75);
      holes.push({ x0, x1, y0: 0, y1: h });
      const signs = F.shop?.signs;
      const aw = F.shop?.awning === false ? null : (F.shop?.awning ?? (R.chance(0.6) ? P.awning : null));
      later.push(() => shopfront(b, P, { x: x0, w: x1 - x0, h, sign: signs ? signs[si % signs.length] : undefined, awning: aw }));
      i += span; si++;
    }
  } else if (g === 'portico') {
    // arcade: the facade line is set back behind piers (built by the style); here: plain openings
    for (let i = 0; i < n; i++) {
      const w = pitchW - 0.7, x = cx[i] - w / 2, h = F.gh - 0.5;
      holes.push({ x0: x, x1: x + w, y0: 0, y1: h });
      later.push(() => archOpening(b, P, { x, y: 0, w, h, depth: 0.5, sill: false }, { glass: false, frame: false }));
    }
  } else if (g === 'lobby') {
    const w = Math.min(L - 2 * margin, Math.max(3, L * 0.45)), x = (L - w) / 2, h = F.gh - 0.5;
    holes.push({ x0: x, x1: x + w, y0: 0, y1: h });
    later.push(() => doorAt(b, P, { x, w, h, type: 'glass', canopy: F.door?.canopy }));
  } else if (g === 'garage') {
    for (let i = 0; i < n; i++) {
      const w = Math.min(2.6, pitchW - 0.6), x = cx[i] - w / 2, h = Math.min(2.4, F.gh - 0.4);
      if (i === doorBay) {
        holes.push({ x0: cx[i] - 0.5, x1: cx[i] + 0.5, y0: 0, y1: 2.2 });
        later.push(() => doorAt(b, P, { x: cx[i] - 0.5, w: 1.0, h: 2.2, type: 'single' }));
        continue;
      }
      holes.push({ x0: x, x1: x + w, y0: 0, y1: h });
      later.push(() => doorAt(b, P, { x, w, h, type: 'garage' }));
    }
  } else if (g === 'residential') {
    for (let i = 0; i < n; i++) {
      if (i === doorBay) {
        const D = F.door;
        const dw = Math.min(D.w ?? 1.2, pitchW - 0.4), dh = Math.min(D.h ?? 2.4, F.gh - 0.3);
        const x = cx[i] - dw / 2, y = D.raised ?? 0;
        holes.push({ x0: x, x1: x + dw, y0: y, y1: y + dh });
        later.push(() => doorAt(b, P, { x, y, w: dw, h: dh, type: D.type || 'single', arched: D.arched, surround: D.surround, canopy: D.canopy, steps: y > 0.05 }));
        continue;
      }
      const o = { ...W, ...(F.groundWin || {}) };
      const ov = F.winFor ? F.winFor(0, i, n) : {};
      if (ov === null) continue;
      Object.assign(o, ov);
      const w = o.w ?? 1.1, h = Math.min(o.h ?? 1.5, F.gh - (o.sill ?? 1.0) - 0.35);
      const x = cx[i] - w / 2, y = o.sill ?? 1.0;
      holes.push({ x0: x, x1: x + w, y0: y, y1: y + h });
      later.push(() => windowAt(b, P, { ...o, x, y, w, h, grille: o.grille ?? F.grille }));
    }
  }
  // ---------------------------------------------------------- upper floors
  const balc = F.balconies || 'none';
  for (let k = 1; k < F.floors; k++) {
    const fy = floorY(F, k);
    const fh = k === F.floors - 1 && F.lastFh ? F.lastFh : F.fh;
    const wantBalc = balc !== 'none' && (!F.balconyFloors || F.balconyFloors(k));
    let contStart = -1;
    for (let i = 0; i < n; i++) {
      const ov = F.winFor ? F.winFor(k, i, n) : {};
      if (ov === null) continue;
      const o = { ...W, ...ov };
      let hasBalc = wantBalc && (balc === 'all' || balc === 'continuous' || (balc === 'alternate' && (i + k) % 2 === 0) || (balc === 'some' && R.chance(0.45)) || (balc === 'center' && Math.abs(i - (n - 1) / 2) < 0.6) || o.balcony);
      if (o.balcony === false) hasBalc = false;
      const french = hasBalc || o.type === 'french';
      const w = o.w ?? 1.1;
      const sill = french ? 0 : o.sill ?? 0.9;
      const h = french ? Math.min(fh - 0.55, (o.h ?? 1.5) + (o.sill ?? 0.9) - 0.05) : Math.min(o.h ?? 1.5, fh - sill - 0.35);
      const x = cx[i] - w / 2, y = fy + sill;
      holes.push({ x0: x, x1: x + w, y0: y, y1: y + h });
      const type = french && o.type !== 'arched' && o.type !== 'modern' && o.type !== 'ribbon' ? 'french' : o.type;
      later.push(() => windowAt(b, P, { ...o, type, x, y, w, h, sill: !french }));
      if (hasBalc && balc !== 'continuous') {
        const bw = o.balconyW ?? (balc === 'center' ? Math.min(pitchW * 2.2, w + 2.2) : Math.min(pitchW - 0.25, w + 0.9));
        const dep = o.balconyDepth ?? F.balconyDepth ?? 1.0;
        later.push(() => balcony(b, P, cx[i] - bw / 2, cx[i] + bw / 2, fy, dep, F.rail || 'bars', { consoles: F.consoles }));
      }
      if (hasBalc && balc === 'continuous' && contStart < 0) contStart = i;
    }
    if (wantBalc && balc === 'continuous') {
      const x0 = F.contFull ? 0.0 : Math.max(0, cx[0] - pitchW / 2 + 0.15), x1 = F.contFull ? L : Math.min(L, cx[n - 1] + pitchW / 2 - 0.15);
      later.push(() => balcony(b, P, x0, x1, fy, F.balconyDepth ?? 1.3, F.rail || "bars", { consoles: F.consoles, sides: !F.contFull }));
    }
  }
  // ---------------------------------------------------------- wall surface
  const gw = F.groundWall || P.wall;
  wallWithHoles(b, gw, 0, L, 0, Math.min(top, F.gh), holes);
  if (top > F.gh) wallWithHoles(b, P.wall, 0, L, F.gh, top, holes);
  for (const fn of later) fn();
}

/** Plain wall with a few small windows (party walls exposed above neighbours, sides of sheds…). */
export function sideFacade(b, P, { L, floors, gh, fh, top, pitch = 4, win = {}, blank = false, groundWall }) {
  buildFacade(b, P, { L, floors, gh, fh, top, pitch, win: { w: 0.9, h: 1.3, type: 'casement', ...win }, ground: blank ? 'blank' : 'residential', blank, groundWall });
}

/** Floor-line bands (string courses) around a footprint. */
export function bands(b, d, path, levels, { out = 0.05, h = 0.14 } = {}) {
  for (const y of levels) b.sweep(d, path, [[0, y], [out, y + 0.02], [out, y + h - 0.02], [0, y + h]]);
}

/** Classical cornice profile swept around a footprint at the wall top y. Returns the cornice top. */
export function cornice(b, d, path, y, size = 1, { modillions = false, dent = null } = {}) {
  const s = size;
  const prof = [[0, y], [0.06 * s, y + 0.04 * s], [0.06 * s, y + 0.14 * s], [0.14 * s, y + 0.2 * s], [0.16 * s, y + 0.3 * s], [0.34 * s, y + 0.36 * s], [0.42 * s, y + 0.44 * s], [0.46 * s, y + 0.5 * s], [0.46 * s, y + 0.58 * s], [0, y + 0.58 * s]];
  b.sweep(d, path, prof);
  if (modillions) {
    // brackets under the corona, along every edge
    const P = orient(path);
    for (let i = 0; i < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length];
      const L = Math.hypot(bx - ax, bz - az), n = Math.floor(L / (0.55 * s));
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      b.push().frame(ax, az, ux, uz);
      for (let k = 1; k < n; k++) {
        const x = (L * k) / n;
        b.box(dent || d, x - 0.05 * s, y + 0.2 * s, 0, x + 0.05 * s, y + 0.34 * s, 0.32 * s, SKIP.nz | SKIP.py);
      }
      b.pop();
    }
  }
  return y + 0.58 * s;
}

/** Plinth (base course) around a footprint. */
export function plinth(b, d, path, h = 0.6, out = 0.05) {
  b.sweep(d, path, [[out, 0], [out, h], [0, h + out]]);
}
