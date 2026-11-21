// Shared helpers of the procedural interior generators.
import * as THREE from 'three';
import { box, boxOn, cylinder, lathe, rod, sphere, colorize } from '../geo.js';
import { BOOK_COLORS } from '../textures.js';

export * from '../geo.js';
export * from '../params.js';

/** Pushes geometries into parts[role]. */
export function add(parts, role, ...geos) {
  const list = parts[role] || (parts[role] = []);
  for (const g of geos) if (g) list.push(g);
  return parts;
}

/** Shifts every geometry so the footprint (x/z bounds) is centered on the origin. */
export function centerParts(parts) {
  const b = new THREE.Box3(), tmp = new THREE.Box3();
  for (const [k, list] of Object.entries(parts)) {
    if (k === '$specs') continue;
    for (const g of list) { g.computeBoundingBox(); tmp.copy(g.boundingBox); b.union(tmp); }
  }
  if (b.isEmpty()) return parts;
  const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  if (Math.abs(cx) < 1e-5 && Math.abs(cz) < 1e-5) return parts;
  for (const [k, list] of Object.entries(parts)) if (k !== '$specs') for (const g of list) g.translate(-cx, 0, -cz);
  return parts;
}

/** Moves every geometry of `src` into `dst` with an extra placement {x, y, z, ry (degrees)}. */
export function merge(dst, src, t = {}) {
  const m = new THREE.Matrix4().makeRotationY(((t.ry || 0) * Math.PI) / 180);
  m.setPosition(t.x || 0, t.y || 0, t.z || 0);
  for (const [k, list] of Object.entries(src)) {
    if (k === '$specs') { dst.$specs = { ...(dst.$specs || {}), ...list }; continue; }
    for (const g of list) { g.applyMatrix4(m); add(dst, k, g); }
  }
  return dst;
}

/**
 * Fills a shelf with books (vertex-colored, role 'books') from x0 to x1 standing
 * on y, back against zBack, max height hMax, depth up to dMax. fill 0..1.
 * Occasionally lays a small stack flat, leans the last book, or leaves a gap
 * with a decorative object (role 'decor' / 'ceramic' / 'leaf').
 */
export function fillShelf(parts, r, x0, x1, y, zBack, dMax, hMax, fill = 0.8, objects = true) {
  let x = x0 + 0.01;
  const end = x0 + (x1 - x0) * Math.max(0, Math.min(1, fill + (r() - 0.5) * 0.25));
  while (x < x1 - 0.03) {
    if (x > end) break;
    const roll = r();
    if (objects && roll < 0.07 && x1 - x > 0.2) {
      // decorative object
      const kind = r.int(0, 3), cx = x + 0.08;
      if (kind === 0) add(parts, 'ceramic', lathe([[0, 0], [0.045, 0], [0.06, 0.05], [0.05, 0.13], [0.025, 0.17], [0.03, Math.min(hMax, 0.2)], [0, Math.min(hMax, 0.2)]], { x: cx, y, z: zBack + dMax / 2, seg: 20 }));
      else if (kind === 1) add(parts, 'decor', box(0.12, Math.min(hMax * 0.5, 0.1), 0.12, { x: cx, y: y + Math.min(hMax * 0.5, 0.1) / 2, z: zBack + dMax / 2, r: 0.008 }));
      else if (kind === 2) { add(parts, 'pot', cylinder(0.045, 0.055, 0.08, { x: cx, y, z: zBack + dMax / 2, seg: 16 })); add(parts, 'leaf', sphere(0.075, { x: cx, y: y + 0.12, z: zBack + dMax / 2, ws: 10, hs: 8 })); }
      else add(parts, 'frame', box(0.13, Math.min(hMax * 0.8, 0.17), 0.015, { x: cx, y: y + Math.min(hMax * 0.8, 0.17) / 2, z: zBack + 0.03, rx: -8, r: 0.003 }));
      x += 0.17;
      continue;
    }
    if (roll < 0.14 && x1 - x > 0.25) {
      // flat stack
      const n = r.int(2, 5), w = r.range(0.17, 0.24), d = Math.min(dMax, r.range(0.12, 0.2));
      let yy = y;
      for (let i = 0; i < n; i++) {
        const t = r.range(0.022, 0.045);
        add(parts, 'books', colorize(box(w + r.range(-0.02, 0.02), t, d, { x: x + w / 2 + 0.005, y: yy + t / 2, z: zBack + d / 2 + 0.01, ry: r.range(-6, 6), r: 0.003, seg: 1 }), r.pick(BOOK_COLORS)));
        yy += t;
      }
      x += w + 0.02;
      continue;
    }
    const w = r.range(0.018, 0.055), h = Math.min(hMax - 0.01, r.range(0.16, 0.3)), d = Math.min(dMax, r.range(0.12, 0.22));
    if (h < 0.06) break;
    add(parts, 'books', colorize(box(w, h, d, { x: x + w / 2, y: y + h / 2, z: zBack + d / 2 + 0.005, r: 0.003, seg: 1 }), r.pick(BOOK_COLORS)));
    x += w + (r() < 0.15 ? 0.004 : 0.0005);
  }
  // a leaning book at the end of a row
  if (x < x1 - 0.06 && x > x0 + 0.1 && r() < 0.5) {
    const h = Math.min(hMax - 0.02, 0.22), w = 0.03, d = Math.min(dMax, 0.16);
    const a = 18;
    add(parts, 'books', colorize(box(w, h, d, { x: x + w / 2 + Math.sin((a * Math.PI) / 180) * h / 2, y: y + (Math.cos((a * Math.PI) / 180) * h) / 2 + 0.003, z: zBack + d / 2 + 0.005, rz: -a, r: 0.003, seg: 1 }), r.pick(BOOK_COLORS)));
  }
}

/** Simple drawer / door handle (bar) centered at (x, y, z) on a front facing +Z. */
export function handle(parts, x, y, z, len = 0.12, vertical = false, role = 'metal') {
  const r = 0.006;
  if (vertical) add(parts, role, rod([x, y - len / 2, z + 0.03], [x, y + len / 2, z + 0.03], r, { seg: 8 }), rod([x, y - len / 2 + 0.01, z], [x, y - len / 2 + 0.01, z + 0.03], r * 0.8, { seg: 6 }), rod([x, y + len / 2 - 0.01, z], [x, y + len / 2 - 0.01, z + 0.03], r * 0.8, { seg: 6 }));
  else add(parts, role, rod([x - len / 2, y, z + 0.03], [x + len / 2, y, z + 0.03], r, { seg: 8 }), rod([x - len / 2 + 0.01, y, z], [x - len / 2 + 0.01, y, z + 0.03], r * 0.8, { seg: 6 }), rod([x + len / 2 - 0.01, y, z], [x + len / 2 - 0.01, y, z + 0.03], r * 0.8, { seg: 6 }));
}

/** Knob handle. */
export function knob(parts, x, y, z, role = 'metal') {
  add(parts, role, cylinder(0.008, 0.014, 0.025, { x, y, z, rx: 90, seg: 12, bevel: 0.004 }));
}

export { boxOn, box };
