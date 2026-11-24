// Rooftop clutter and small structures: chimneys, AC units, water tanks,
// TV antennas, satellite dishes, stair bulkheads, solar panels, skylights.
// Everything sits on y = base and uses detail materials (hidden far away).
import { SKIP, inset } from './kit.js';

export function chimney(b, P, x, z, y0, h = 1.4, w = 0.55, d = 0.45) {
  const C = P.chimney || P.wall;
  b.box(C, x - w / 2, y0 - 1.2, z - d / 2, x + w / 2, y0 + h, z + d / 2, SKIP.ny);
  b.box(P.trim || C, x - w / 2 - 0.06, y0 + h, z - d / 2 - 0.06, x + w / 2 + 0.06, y0 + h + 0.08, z + d / 2 + 0.06, 0);
  // little roof cap on posts (Italian style) or pots
  if (P.rand.chance(0.5)) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(P.trim || C, x + sx * (w / 2 - 0.05) - 0.04, y0 + h + 0.08, z + sz * (d / 2 - 0.05) - 0.04, x + sx * (w / 2 - 0.05) + 0.04, y0 + h + 0.3, z + sz * (d / 2 - 0.05) + 0.04, SKIP.ny | SKIP.py);
    b.push().translate(x, y0 + h + 0.3, z);
    b.quad(P.roofTile || C, [-w / 2 - 0.12, 0, d / 2 + 0.1], [w / 2 + 0.12, 0, d / 2 + 0.1], [w / 2 + 0.12, 0.2, 0], [-w / 2 - 0.12, 0.2, 0], null, [0, 1, 1]);
    b.quad(P.roofTile || C, [w / 2 + 0.12, 0, -d / 2 - 0.1], [-w / 2 - 0.12, 0, -d / 2 - 0.1], [-w / 2 - 0.12, 0.2, 0], [w / 2 + 0.12, 0.2, 0], null, [0, 1, -1]);
    b.pop();
  } else {
    b.cyl(P.pot || P.metal, x - w * 0.18, z, 0.09, 0.07, y0 + h + 0.08, y0 + h + 0.4, 8, { top: true });
    if (w > 0.5) b.cyl(P.pot || P.metal, x + w * 0.2, z, 0.09, 0.07, y0 + h + 0.08, y0 + h + 0.34, 8, { top: true });
  }
}

export function acUnit(b, P, x, z, y0, rot = 0) {
  b.push().translate(x, y0, z).rotateY(rot);
  const U = P.unit || P.metal;
  b.box(U, -0.45, 0.1, -0.35, 0.45, 0.85, 0.35, SKIP.ny);
  b.box(P.darkMetal || P.metal, -0.42, 0, -0.32, -0.36, 0.1, 0.32, SKIP.ny);
  b.box(P.darkMetal || P.metal, 0.36, 0, -0.32, 0.42, 0.1, 0.32, SKIP.ny);
  b.cyl(P.darkMetal || P.metal, 0, 0, 0.28, 0.28, 0.85, 0.88, 12, { top: true });
  b.box(P.darkMetal || P.metal, -0.03, 0.88, -0.25, 0.03, 0.9, 0.25, SKIP.ny);
  b.pop();
}

/** Classic wooden (NY style) or metal water tank on legs. */
export function waterTank(b, P, x, z, y0, wood = true) {
  const T = wood ? P.tankWood || P.wood || P.metal : P.metal;
  const r = 1.0, h = 1.8, leg = 1.6;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.box(P.darkMetal || P.metal, x + sx * 0.7 - 0.06, y0, z + sz * 0.7 - 0.06, x + sx * 0.7 + 0.06, y0 + leg, z + sz * 0.7 + 0.06, SKIP.ny);
  b.box(P.darkMetal || P.metal, x - 0.85, y0 + leg - 0.12, z - 0.85, x + 0.85, y0 + leg, z + 0.85, 0);
  b.cyl(T, x, z, r, r * 0.97, y0 + leg, y0 + leg + h, 14, { top: false, bottom: true });
  for (const k of [0.2, 0.55, 0.85]) b.cyl(P.darkMetal || P.metal, x, z, r * (1 - k * 0.03) + 0.015, r * (1 - k * 0.03) + 0.015, y0 + leg + h * k, y0 + leg + h * k + 0.04, 14, { top: false });
  b.cyl(T, x, z, r * 1.04, 0.05, y0 + leg + h, y0 + leg + h + 0.6, 14, { top: false, bottom: true });
}

/** TV antenna mast with crossbar elements (very Italian rooftop). */
export function antenna(b, P, x, z, y0, h = 2.6, rot = 0) {
  const A = P.antenna || P.metal;
  b.push().translate(x, y0, z).rotateY(rot);
  b.rod(A, [0, 0, 0], [0, h, 0], 0.02, 4);
  for (const [yy, L, n] of [[h - 0.1, 1.4, 7], [h - 0.65, 1.0, 5]]) {
    b.rod(A, [0, yy, -L / 2], [0, yy, L / 2], 0.009, 4);
    for (let i = 0; i < n; i++) { const zz = -L / 2 + (L * (i + 0.5)) / n, e = 0.28 + 0.12 * (1 - i / n); b.rod(A, [-e, yy, zz], [e, yy, zz], 0.005, 3); }
  }
  b.pop();
}

export function dish(b, P, x, z, y0, rot = 0) {
  b.push().translate(x, y0, z).rotateY(rot);
  b.rod(P.metal, [0, 0, 0], [0, 0.9, 0], 0.025, 5);
  b.push().translate(0, 1.05, 0.05).rotateX(-1.15);
  b.lathe(P.dishMat || P.trim || P.metal, 0, 0, [[0.0, 0.0], [0.2, 0.02], [0.33, 0.07], [0.36, 0.09], [0.0, 0.03]], 12);
  b.pop();
  b.rod(P.metal, [0, 0.95, 0.05], [0, 1.18, 0.5], 0.008, 3);
  b.pop();
}

/** Stair / lift bulkhead with door and flat roof. */
export function bulkhead(b, P, x, z, y0, w = 2.6, d = 2.4, h = 2.6, rot = 0) {
  b.push().translate(x, y0, z).rotateY(rot);
  const W = P.wall;
  b.box(W, -w / 2, 0, -d / 2, w / 2, h, d / 2, SKIP.ny | SKIP.pz);
  // front with door
  const dw = 0.9;
  b.quad(W, [-w / 2, 0, d / 2], [-dw / 2, 0, d / 2], [-dw / 2, h, d / 2], [-w / 2, h, d / 2]);
  b.quad(W, [dw / 2, 0, d / 2], [w / 2, 0, d / 2], [w / 2, h, d / 2], [dw / 2, h, d / 2]);
  b.quad(W, [-dw / 2, 2.1, d / 2], [dw / 2, 2.1, d / 2], [dw / 2, h, d / 2], [-dw / 2, h, d / 2]);
  b.quad(P.door || P.metal, [-dw / 2, 0, d / 2 - 0.05], [dw / 2, 0, d / 2 - 0.05], [dw / 2, 2.1, d / 2 - 0.05], [-dw / 2, 2.1, d / 2 - 0.05]);
  b.box(P.coping || P.trim || W, -w / 2 - 0.08, h, -d / 2 - 0.08, w / 2 + 0.08, h + 0.12, d / 2 + 0.08, 0);
  b.pop();
}

export function solarPanels(b, P, x, z, y0, rows = 2, cols = 4, rot = 0) {
  b.push().translate(x, y0, z).rotateY(rot);
  const S = P.solar || P.glass, pw = 1.0, pd = 1.65;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const px = (c - (cols - 1) / 2) * (pw + 0.05), pz = (r - (rows - 1) / 2) * (pd * 0.9 + 0.8);
    b.push().translate(px, 0.35, pz).rotateX(-0.45);
    b.box(S, -pw / 2, 0, -pd / 2, pw / 2, 0.04, pd / 2, SKIP.ny);
    b.pop();
    b.box(P.metal, px - 0.03, 0, pz + pd * 0.35, px + 0.03, 0.35, pz + pd * 0.35 + 0.05, SKIP.ny);
  }
  b.pop();
}

export function skylight(b, P, x, z, y0, w = 1.2, d = 1.2) {
  b.box(P.coping || P.trim, x - w / 2, y0, z - d / 2, x + w / 2, y0 + 0.3, z + d / 2, SKIP.ny | SKIP.py);
  b.push().translate(x, y0 + 0.3, z);
  b.quad(P.glass, [-w / 2, 0, d / 2], [w / 2, 0, d / 2], [w / 2, 0.25, 0], [-w / 2, 0.25, 0], [[0.02, 0.02], [0.23, 0.02], [0.23, 0.23], [0.02, 0.23]], [0, 1, 1]);
  b.quad(P.glass, [w / 2, 0, -d / 2], [-w / 2, 0, -d / 2], [-w / 2, 0.25, 0], [w / 2, 0.25, 0], [[0.02, 0.02], [0.23, 0.02], [0.23, 0.23], [0.02, 0.23]], [0, 1, -1]);
  b.tri(P.coping || P.trim, [-w / 2, 0, d / 2], [-w / 2, 0.25, 0], [-w / 2, 0, -d / 2], [-1, 0, 0]);
  b.tri(P.coping || P.trim, [w / 2, 0, -d / 2], [w / 2, 0.25, 0], [w / 2, 0, d / 2], [1, 0, 0]);
  b.pop();
}

/**
 * Scatter rooftop clutter on a flat roof rectangle [x0,x1] × [z0,z1] at y.
 * kind: 'old' (antennas, tanks, chimneys) | 'modern' (AC, solar, bulkhead) | 'mixed'
 */
export function clutter(b, P, x0, x1, z0, z1, y, kind = 'mixed', density = 1) {
  const R = P.rand;
  const W = x1 - x0, D = z1 - z0;
  if (W < 2 || D < 2) return;
  const taken = [];
  const free = (x, z, r) => taken.every(([a, c, s]) => Math.hypot(a - x, c - z) > s + r) && x - r > x0 && x + r < x1 && z - r > z0 && z + r < z1;
  const spot = (r) => {
    for (let k = 0; k < 14; k++) {
      const x = R.range(x0 + r, x1 - r), z = R.range(z0 + r, z1 - r);
      if (free(x, z, r)) { taken.push([x, z, r]); return [x, z]; }
    }
    return null;
  };
  const area = W * D;
  if (kind !== 'old' && area > 40) { const s = spot(1.8); if (s) bulkhead(b, P, s[0], s[1], y, 2.6, 2.4, 2.5, R.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2])); }
  if (kind === 'old' && area > 60 && R.chance(0.5)) { const s = spot(1.3); if (s) waterTank(b, P, s[0], s[1], y, true); }
  const nAC = Math.round((kind === 'old' ? 0.5 : 2) * density * Math.min(6, area / 40));
  for (let i = 0; i < nAC; i++) { const s = spot(0.7); if (s) acUnit(b, P, s[0], s[1], y, R.pick([0, Math.PI / 2])); }
  const nAnt = Math.round((kind === 'modern' ? 0.6 : 2) * density * Math.min(4, area / 60) + (kind === 'modern' ? 0 : 1));
  for (let i = 0; i < nAnt; i++) { const s = spot(0.6); if (s) antenna(b, P, s[0], s[1], y, R.range(1.8, 3.2), R.range(0, Math.PI)); }
  const nDish = R.int(0, kind === 'modern' ? 1 : 2);
  for (let i = 0; i < nDish; i++) { const s = spot(0.5); if (s) dish(b, P, s[0], s[1], y, R.range(-1, 1)); }
  if (kind !== 'modern') {
    const nCh = R.int(1, 3);
    for (let i = 0; i < nCh; i++) { const s = spot(0.5); if (s) chimney(b, P, s[0], s[1], y, R.range(0.8, 1.4), 0.5, 0.4); }
  }
  if (kind === 'modern' && area > 50 && R.chance(0.6)) { const s = spot(2.4); if (s) solarPanels(b, P, s[0], s[1], y, 1, 3, 0); }
  if (area > 30 && R.chance(0.5)) { const s = spot(0.9); if (s) skylight(b, P, s[0], s[1], y); }
}

export { inset };
