// Geometry helpers shared by the exterior generators (roads, vehicles, trees,
// street furniture). Everything returns BufferGeometry in prop space: meters,
// Y up, front +Z. Parts sharing a material role are merged by the props module
// (one draw call per role), so generators only push geometries into role lists.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { place, colorize } from '../props/geo.js';

export { rng } from '../props/params.js';
export * from '../props/geo.js';

const DEG = Math.PI / 180;

// ------------------------------------------------------------------ noise
/** Small seeded 3D value noise (smooth, cheap) + fractal sum. */
export function makeNoise(seed = 1) {
  const P = new Uint8Array(512);
  let s = (seed * 2654435761) >>> 0;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const perm = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
  const V = new Float32Array(256);
  for (let i = 0; i < 256; i++) V[i] = rnd() * 2 - 1;
  const fade = (t) => t * t * (3 - 2 * t);
  const lerp = (a, b, t) => a + (b - a) * t;
  const h = (x, y, z) => V[P[P[P[x & 255] + (y & 255)] + (z & 255)]];
  function n3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    return lerp(
      lerp(lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u), lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
      lerp(lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
  }
  n3.fbm = (x, y, z, oct = 3) => { let a = 0, f = 1, amp = 1, n = 0; for (let i = 0; i < oct; i++) { a += n3(x * f, y * f, z * f) * amp; n += amp; f *= 2.03; amp *= 0.5; } return a / n; };
  return n3;
}

// ------------------------------------------------------------------ simple builders
/** Box from min/max corners (no rounding unless r). */
export function boxMM(x0, y0, z0, x1, y1, z1, r = 0) {
  const g = r > 0 ? null : new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  if (g) { g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2); return g; }
  return null;
}

/** Applies yaw (degrees) then translation to a geometry. */
export function at(geo, x = 0, y = 0, z = 0, ry = 0) { return place(geo, { x, y, z, ry }); }

/** Clones and transforms (for repeated parts merged later). */
export function copyAt(geo, t) { return place(geo.clone(), t); }

/** Merges a list into a single geometry (keeps the inputs). */
export function mergeAll(list) {
  const geos = list.filter(Boolean).map((g) => {
    const c = g.index ? g.toNonIndexed() : g.clone();
    for (const n of Object.keys(c.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv' && n !== 'color') c.deleteAttribute(n);
    if (!c.attributes.normal) c.computeVertexNormals();
    if (!c.attributes.uv) c.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(c.attributes.position.count * 2), 2));
    return c;
  });
  if (!geos.length) return null;
  const withColor = geos.some((g) => g.attributes.color);
  if (withColor) for (const g of geos) if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  else for (const g of geos) g.deleteAttribute('color');
  return mergeGeometries(geos, false);
}

/** Vertex-colored copy (sRGB hex). */
export function tint(geo, hex) { return colorize(geo, hex); }

/**
 * Builds a triangle mesh from rings of points (each ring an array of [x,y,z]
 * with the same count). `closed` joins the last point of each ring to the first;
 * `capStart` / `capEnd` close the ends with a fan. uvs: u = ring parameter
 * (0..1 or meters with uScale), v = ring index or the given vs[].
 */
export function loft(rings, { closed = true, capStart = false, capEnd = false, vs = null, uScale = 0, flip = false } = {}) {
  const n = rings.length, m = rings[0].length;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < n; i++) {
    const r = rings[i];
    let acc = 0;
    for (let j = 0; j < m; j++) {
      if (j > 0 && uScale) { const a = r[j - 1], b = r[j]; acc += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); }
      pos.push(r[j][0], r[j][1], r[j][2]);
      uv.push(uScale ? acc / uScale : j / (closed ? m : m - 1), vs ? vs[i] : i / (n - 1));
    }
    if (closed) { // seam vertex (for uvs)
      const a = r[m - 1], b = r[0];
      if (uScale) acc += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      pos.push(b[0], b[1], b[2]);
      uv.push(uScale ? acc / uScale : 1, vs ? vs[i] : i / (n - 1));
    }
  }
  const M = closed ? m + 1 : m;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < M - 1; j++) {
      const a = i * M + j, b = a + 1, c = a + M, d = c + 1;
      if (flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  const capFan = (ri, reverse) => {
    const r = rings[ri];
    let cx = 0, cy = 0, cz = 0;
    for (const p of r) { cx += p[0]; cy += p[1]; cz += p[2]; }
    cx /= m; cy /= m; cz /= m;
    const base = pos.length / 3;
    pos.push(cx, cy, cz); uv.push(0.5, 0.5);
    for (let j = 0; j < m; j++) { pos.push(r[j][0], r[j][1], r[j][2]); uv.push(0.5, 0.5); }
    for (let j = 0; j < m; j++) {
      const a = base + 1 + j, b = base + 1 + ((j + 1) % m);
      if (reverse !== flip) idx.push(base, a, b); else idx.push(base, b, a);
    }
  };
  if (capStart) capFan(0, true);
  if (capEnd) capFan(n - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Tapered tube along a polyline/curve of points [[x,y,z]...] with radii r[]
 * (one per point, or a number). `sides` radial segments. Parallel-transport
 * frames (no twisting). Caps optional. uv: u around (0..1), v along (meters / vScale).
 */
export function taperTube(points, radii, { sides = 8, capStart = false, capEnd = true, vScale = 1, noise = null, noiseAmp = 0 } = {}) {
  const n = points.length;
  const P = points.map((p) => new THREE.Vector3(...p));
  const R = typeof radii === 'number' ? new Array(n).fill(radii) : radii;
  const T = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    T.push(b.clone().sub(a).normalize());
  }
  // initial normal: any perpendicular
  let N = new THREE.Vector3(0, 0, 1);
  if (Math.abs(T[0].dot(N)) > 0.9) N.set(1, 0, 0);
  N.sub(T[0].clone().multiplyScalar(T[0].dot(N))).normalize();
  const rings = [], vs = [];
  let len = 0;
  const q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      q.setFromUnitVectors(T[i - 1], T[i]);
      N.applyQuaternion(q).normalize();
      len += P[i].distanceTo(P[i - 1]);
    }
    const B = new THREE.Vector3().crossVectors(T[i], N).normalize();
    const ring = [];
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      let r = R[i];
      if (noise) r *= 1 + noiseAmp * noise(P[i].x * 3 + c * 2, P[i].y * 3, P[i].z * 3 + s * 2);
      ring.push([P[i].x + (N.x * c + B.x * s) * r, P[i].y + (N.y * c + B.y * s) * r, P[i].z + (N.z * c + B.z * s) * r]);
    }
    rings.push(ring);
    vs.push(len / vScale);
  }
  return loft(rings, { closed: true, capStart, capEnd, vs });
}

/** Icosphere (non-indexed later by merge) with optional per-vertex displacement fn(v: Vector3, n: Vector3) -> scale. */
export function blob(radius, detail = 1, displace = null) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  if (displace) {
    const p = g.attributes.position, v = new THREE.Vector3(), nn = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      nn.copy(v).normalize();
      const k = displace(v, nn);
      v.multiplyScalar(k);
      p.setXYZ(i, v.x, v.y, v.z);
    }
  }
  return mergeVerticesSimple(g);
}

/** Welds the vertices of a non-indexed geometry by position (for smooth normals). */
export function mergeVerticesSimple(g) {
  if (g.index) { const ni = g.toNonIndexed(); g.dispose(); g = ni; }
  const p = g.attributes.position;
  const map = new Map(), pos = [], idx = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let j = map.get(k);
    if (j === undefined) { j = pos.length / 3; map.set(k, j); pos.push(x, y, z); }
    idx.push(j);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.dispose();
  return out;
}

/** Flat polygon (points [[x, z]...], counter-clockwise from above) at height y, facing up; uv = meters / tile. */
export function polyXZ(points, y = 0, tile = 1) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ShapeGeometry(shape, 12);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / tile, p.getZ(i) / tile);
  return g;
}

/** Ring sector (annulus) facing up at height y: inner/outer radius, start/end angle (radians, from +Z toward +X). */
export function annulus(r0, r1, a0, a1, y = 0, { seg = 48, tile = 0 } = {}) {
  const pos = [], uv = [], idx = [];
  const n = Math.max(2, Math.ceil(seg * Math.abs(a1 - a0) / (Math.PI * 2)));
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n), s = Math.sin(a), c = Math.cos(a);
    for (const r of [r0, r1]) {
      pos.push(s * r, y, c * r);
      if (tile) uv.push(s * r / tile, c * r / tile); else uv.push(i / n, r === r0 ? 0 : 1);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    if (a1 > a0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Extrudes a closed 2D profile (points [[u, v]...] counter-clockwise) along a
 * path of frames: frames = [{p: [x,y,z], t: [x,y,z] (tangent), n: [x,y,z] (profile "up")}].
 * Profile u goes along the binormal (t × n), v along n.
 */
export function sweep(profile, frames, { closed = true, capStart = true, capEnd = true, uScale = 1 } = {}) {
  const rings = [];
  const vs = [];
  let acc = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const t = new THREE.Vector3(...f.t).normalize(), nn = new THREE.Vector3(...f.n).normalize();
    const b = new THREE.Vector3().crossVectors(t, nn).normalize();
    if (i > 0) acc += Math.hypot(f.p[0] - frames[i - 1].p[0], f.p[1] - frames[i - 1].p[1], f.p[2] - frames[i - 1].p[2]);
    vs.push(acc / uScale);
    rings.push(profile.map(([u, v]) => [f.p[0] + b.x * u + nn.x * v, f.p[1] + b.y * u + nn.y * v, f.p[2] + b.z * u + nn.z * v]));
  }
  return loft(rings, { closed, capStart, capEnd, vs });
}

/** Points on a horizontal arc (center cx, cz, radius, angles from +Z toward +X), y constant. */
export function arcPoints(cx, cz, r, a0, a1, n, y = 0) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); out.push([cx + Math.sin(a) * r, y, cz + Math.cos(a) * r]); }
  return out;
}

/** Thin flat strip (ribbon) facing up along a horizontal polyline [[x, z]...], width w, at height y. uv v = meters. */
export function stripXZ(pts, w, y, { tile = 1 } = {}) {
  const pos = [], uv = [], idx = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = tz, nz = -tx; // right-hand normal
    if (i > 0) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    pos.push(pts[i][0] - nx * w / 2, y, pts[i][1] - nz * w / 2, pts[i][0] + nx * w / 2, y, pts[i][1] + nz * w / 2);
    uv.push(0, acc / tile, 1, acc / tile);
  }
  for (let i = 0; i < pts.length - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure it faces up
  const nrm = g.attributes.normal;
  if (nrm.count && nrm.getY(0) < 0) { g.setIndex(idx.map((_, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]])); g.computeVertexNormals(); }
  return g;
}

/** Re-projects uvs of a geometry as planar XZ (top view) in meters / tile. */
export function uvTop(geo, tile = 1, ox = 0, oz = 0) {
  const p = geo.attributes.position;
  let uv = geo.attributes.uv;
  if (!uv) { uv = new THREE.BufferAttribute(new Float32Array(p.count * 2), 2); geo.setAttribute('uv', uv); }
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + ox) / tile, (p.getZ(i) + oz) / tile);
  return geo;
}

/** Box-projected uvs (dominant normal axis) in meters / tile: good for walls, rocks, curbs. */
export function uvBox(geo, tile = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new THREE.BufferAttribute(new Float32Array(p.count * 2), 2);
  for (let i = 0; i < p.count; i += 3) {
    // face normal from the 3 vertex normals
    let nx = 0, ny = 0, nz = 0;
    for (let k = 0; k < 3; k++) { nx += n.getX(i + k); ny += n.getY(i + k); nz += n.getZ(i + k); }
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    for (let k = 0; k < 3; k++) {
      const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k);
      if (ay >= ax && ay >= az) uv.setXY(i + k, x / tile, z / tile);
      else if (ax >= az) uv.setXY(i + k, z / tile, y / tile);
      else uv.setXY(i + k, x / tile, y / tile);
    }
  }
  g.setAttribute('uv', uv);
  if (g !== geo) geo.dispose();
  return g;
}

/** Cylinder along X (wheels, axles): radius, width, centered at (x, y, z). */
export function cylX(r, w, x, y, z, seg = 24) {
  const g = new THREE.CylinderGeometry(r, r, w, seg, 1, false);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** Lathe around X (tires, rims): profile [[radius, xOffset]...]. */
export function latheX(profile, x, y, z, seg = 28) {
  const g = new THREE.LatheGeometry(profile.map(([r, o]) => new THREE.Vector2(Math.max(0, r), o)), seg);
  g.rotateZ(-Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

export { DEG, place, mergeGeometries };
